import { describe, it, expect } from "vitest";
import {
  detectPitch,
  createPitchTracker,
  minimumWindow,
  PITCH_PROCESSOR_NAME,
} from "../src/pitch-detect.js";
import { installPitchWorklet } from "../src/pitch-worklet.js";
import {
  tuningTargets,
  nearestTarget,
  chromaticNote,
  centsFrom,
} from "../src/tuner.js";
import { renderPerformance } from "../src/audio-dsp.js";
import {
  classicalGuitar,
  concertUkulele,
  createFrettedInstrument,
} from "../src/index.js";

const RATE = 48000;
const cents = (f: number, target: number) => 1200 * Math.log2(f / target);
/** Partials as [harmonic, amplitude]; a little seeded noise keeps it honest. */
function tone(frequency: number, partials: [number, number][] = [[1, 1]], seconds = 0.2, noise = 0) {
  const n = Math.round(seconds * RATE),
    out = new Float32Array(n);
  let seed = 7;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const [h, a] of partials) v += a * Math.sin((2 * Math.PI * frequency * h * i) / RATE + h);
    seed = (seed * 1103515245 + 12345) >>> 0;
    out[i] = 0.3 * v + noise * ((seed / 2 ** 32) * 2 - 1);
  }
  return out;
}
/** One open string plucked by scorify's own waveguide synth. */
function pluck(frequency: number, seconds = 0.6) {
  const audio = renderPerformance(
    {
      strings: ["s"],
      durationSeconds: seconds,
      events: [
        {
          id: "p",
          stringId: "s",
          frequency,
          onsetSeconds: 0,
          endSeconds: seconds,
          excitationSeed: 99,
          velocity: 0.8,
          brightness: 0.55,
          pluckPosition: 0.18,
          decaySeconds: 3,
          muted: false,
        },
      ],
    },
    { sampleRate: RATE, tailSeconds: 0 },
  );
  return audio.channels[0]!;
}
const windowAt = (signal: Float32Array, start: number, size: number) =>
  signal.subarray(start, start + size);

describe("YIN pitch detection", () => {
  it("finds pure tones from 41 Hz to 1.4 kHz within a cent", () => {
    const size = minimumWindow(RATE);
    for (const f of [41.2, 46.25, 61.74, 82.41, 110, 196, 261.63, 440, 659.26, 987.77, 1396.9]) {
      const estimate = detectPitch(windowAt(tone(f), 0, size), RATE);
      expect(estimate, `${f} Hz`).not.toBeNull();
      expect(Math.abs(cents(estimate!.frequency, f)), `${f} Hz`).toBeLessThan(1);
      expect(estimate!.clarity).toBeGreaterThan(0.95);
    }
  });
  it("keeps the fundamental of harmonic-rich tones, including a weak fundamental", () => {
    const size = minimumWindow(RATE),
      shapes: [number, number][][] = [
        [[1, 1], [2, 0.5], [3, 0.33], [4, 0.25], [5, 0.2], [6, 0.17]], // sawtooth-like
        [[1, 0.35], [2, 1], [3, 0.6], [4, 0.3]], // strong octave, weak fundamental
        [[1, 1], [3, 0.33], [5, 0.2], [7, 0.14]], // square-like
      ];
    for (const shape of shapes)
      for (const f of [82.41, 146.83, 392]) {
        const estimate = detectPitch(windowAt(tone(f, shape, 0.2, 0.02), 0, size), RATE);
        expect(estimate, `${f} Hz ${JSON.stringify(shape)}`).not.toBeNull();
        expect(Math.abs(cents(estimate!.frequency, f)), `${f} Hz ${JSON.stringify(shape)}`).toBeLessThan(2);
      }
  });
  it("tunes every open string of guitar and ukulele as plucked by scorify's synth, and hears a detuning", () => {
    const strings = [
      ...tuningTargets(classicalGuitar()),
      ...tuningTargets(concertUkulele({ tuning: "highG" })),
      ...tuningTargets(concertUkulele({ tuning: "lowG" })),
    ];
    const options = { minFrequency: 60 },
      size = minimumWindow(RATE, options);
    for (const target of strings) {
      for (const offset of [0, 20, -35]) {
        const f = target.frequency * 2 ** (offset / 1200),
          signal = pluck(f),
          estimate = detectPitch(windowAt(signal, Math.round(0.1 * RATE), size), RATE, options);
        expect(estimate, `${target.pitch} ${offset}`).not.toBeNull();
        expect(cents(estimate!.frequency, target.frequency), `${target.pitch} ${offset}`).toBeCloseTo(offset, 0);
      }
    }
  });
  it("reports nothing for silence, quiet hiss and white noise", () => {
    const size = minimumWindow(RATE);
    expect(detectPitch(new Float32Array(size), RATE)).toBeNull();
    expect(detectPitch(tone(220, [[1, 0.002]]).subarray(0, size), RATE)).toBeNull();
    const noise = new Float32Array(size);
    let seed = 1;
    for (let i = 0; i < size; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noise[i] = (seed / 2 ** 32) * 2 - 1;
    }
    const estimate = detectPitch(noise, RATE);
    expect(estimate === null || estimate.clarity < 0.8).toBe(true);
  });
  it("rejects invalid options and windows too short for the lowest frequency", () => {
    expect(() => detectPitch(new Float32Array(100), RATE)).toThrow(/too short/);
    expect(() => detectPitch(new Float32Array(4096), 1000)).toThrow(RangeError);
    expect(() => detectPitch(new Float32Array(4096), RATE, { minFrequency: 300, maxFrequency: 310 })).toThrow(RangeError);
    expect(() => detectPitch(new Float32Array(4096), RATE, { threshold: 2 })).toThrow(RangeError);
    expect(minimumWindow(RATE, { minFrequency: 80 })).toBe(2 * 600 + 2);
  });
});

describe("streaming pitch tracker", () => {
  it("reads one window per hop, at the right frame, from blocks of any size", () => {
    const tracker = createPitchTracker({ sampleRate: RATE, minFrequency: 70 }),
      { windowSize, hopSize } = tracker.options,
      signal = tone(110, [[1, 1], [2, 0.4]], 0.5);
    const readings = [];
    for (let i = 0; i < signal.length; i += 128) readings.push(...tracker.push(signal.subarray(i, i + 128)));
    expect(windowSize).toBe(1374);
    expect(hopSize).toBe(Math.min(windowSize, RATE / 30));
    expect(readings.length).toBe(Math.floor((signal.length - windowSize) / hopSize) + 1);
    expect(readings[0]!.frame).toBe(Math.ceil(windowSize / hopSize) * hopSize);
    for (const r of readings) {
      expect(r.frame % hopSize).toBe(0);
      expect(r.time).toBeCloseTo(r.frame / RATE, 12);
      expect(Math.abs(cents(r.frequency!, 110))).toBeLessThan(1);
    }
    // The same samples in one push give the same readings.
    const again = createPitchTracker({ sampleRate: RATE, minFrequency: 70 });
    expect(again.push(signal)).toEqual(readings);
  });
  it("smooths with a median of the same note and restarts it on a new note or silence", () => {
    const tracker = createPitchTracker({ sampleRate: RATE, minFrequency: 70, smoothing: 3 }),
      a = tracker.push(tone(220, [[1, 1]], 0.3)),
      silence = tracker.push(new Float32Array(Math.round(0.2 * RATE))),
      b = tracker.push(tone(330, [[1, 1]], 0.3));
    expect(Math.abs(cents(a.at(-1)!.frequency!, 220))).toBeLessThan(1);
    expect(silence.at(-1)!.frequency).toBeNull();
    // The first readings of the new note straddle silence and note; once clear, they are the new note only.
    expect(Math.abs(cents(b.at(-1)!.frequency!, 330))).toBeLessThan(1);
    expect(b.filter((r) => r.frequency !== null).every((r) => Math.abs(cents(r.frequency!, 330)) < 50)).toBe(true);
    tracker.reset();
    expect(tracker.push(new Float32Array(100))).toEqual([]);
  });
  it("validates window, hop, clarity and smoothing", () => {
    for (const options of [
      { windowSize: 100 },
      { hopSize: 0 },
      { hopSize: 1e6 },
      { minClarity: 2 },
      { smoothing: 0 },
    ])
      expect(() => createPitchTracker({ sampleRate: RATE, ...options })).toThrow(RangeError);
  });
});

describe("pitch-detector AudioWorklet", () => {
  function fixture(processorOptions = {}) {
    const messages: any[] = [];
    let closed = false;
    class Base {
      port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: (m: unknown) => messages.push(m),
        close: () => {
          closed = true;
        },
      };
    }
    let Constructor: any;
    const host = {
      sampleRate: RATE,
      currentFrame: 0,
      AudioWorkletProcessor: Base,
      registerProcessor: (name: string, ctor: any) => {
        expect(name).toBe(PITCH_PROCESSOR_NAME);
        Constructor = ctor;
      },
    };
    installPitchWorklet(host as any);
    const processor = new Constructor({ processorOptions });
    return {
      host,
      messages,
      get closed() {
        return closed;
      },
      send: (data: unknown) => processor.port.onmessage({ data }),
      run(channels: Float32Array[]) {
        let alive = true;
        for (let i = 0; i < channels[0]!.length; i += 128) {
          alive = processor.process([channels.map((c) => c.subarray(i, i + 128))], [[new Float32Array(128)]]);
          host.currentFrame += 128;
        }
        return alive;
      },
      process: (inputs: Float32Array[][]) => processor.process(inputs, [[new Float32Array(128)]]),
    };
  }
  it("posts the same readings as the offline tracker, stamped in context time", () => {
    const f = fixture({ minFrequency: 70 }),
      signal = pluck(146.83, 0.5);
    f.host.currentFrame = 4800; // the context was already running for 0.1 s
    expect(f.run([signal])).toBe(true);
    const offline = createPitchTracker({ sampleRate: RATE, minFrequency: 70 }).push(signal);
    const posted = f.messages.filter((m) => m.type === "pitch");
    expect(f.messages[0]).toMatchObject({ type: "ready" });
    expect(posted.map(({ type: _t, contextTime: _c, ...r }) => r)).toEqual(offline);
    for (const m of posted) expect(m.contextTime).toBeCloseTo((4800 + m.frame) / RATE, 12);
  });
  it("mixes stereo input to mono, survives missing input, reconfigures and stops", () => {
    const f = fixture({ minFrequency: 70 }),
      left = tone(196, [[1, 1]], 0.2),
      right = tone(196, [[1, 1]], 0.2);
    expect(f.process([])).toBe(true);
    expect(f.process([[]])).toBe(true);
    f.run([left, right]);
    const stereo = f.messages.filter((m) => m.type === "pitch" && m.frequency);
    expect(stereo.length).toBeGreaterThan(0);
    expect(Math.abs(cents(stereo.at(-1).frequency, 196))).toBeLessThan(1);
    f.send({ type: "configure", options: { minFrequency: 150, maxFrequency: 600 } });
    expect(f.messages.at(-1)).toMatchObject({ type: "ready", options: { minFrequency: 150, maxFrequency: 600 } });
    f.send({ type: "configure", options: { minFrequency: -1 } });
    expect(f.messages.at(-1)).toMatchObject({ type: "error" });
    f.send({ type: "stop" });
    expect(f.closed).toBe(true);
    expect(f.process([[left.subarray(0, 128)]])).toBe(false);
  });
});

describe("tuning targets", () => {
  it("lists open strings in physical order with concert pitch, capo and custom tunings", () => {
    const guitar = tuningTargets(classicalGuitar());
    expect(guitar.map((t) => t.pitch)).toEqual(["E2", "A2", "D3", "G3", "B3", "E4"]);
    expect(guitar.map((t) => t.number)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(guitar[1]!.frequency).toBeCloseTo(110, 9);
    expect(tuningTargets(concertUkulele({ tuning: "highG" })).map((t) => t.pitch)).toEqual(["G4", "C4", "E4", "A4"]);
    expect(tuningTargets(classicalGuitar({ capoFret: 2 })).map((t) => t.pitch)).toEqual(["F#2", "B2", "E3", "A3", "C#4", "F#4"]);
    expect(tuningTargets(classicalGuitar(), { concertAHz: 432 })[1]!.frequency).toBeCloseTo(108, 9);
    const dropD = createFrettedInstrument("drop", "drop D", ["D2", "A2", "D3", "G3", "B3", "E4"]);
    expect(tuningTargets(dropD)[0]!.pitch).toBe("D2");
    expect(() => tuningTargets(classicalGuitar(), { concertAHz: 100 })).toThrow(RangeError);
  });
  it("finds the nearest string in cents and says whether it is in tune", () => {
    const targets = tuningTargets(classicalGuitar());
    const sharpA = nearestTarget(110 * 2 ** (30 / 1200), targets)!;
    expect(sharpA.target.pitch).toBe("A2");
    expect(sharpA.cents).toBeCloseTo(30, 9);
    expect(sharpA.inTune).toBe(false);
    expect(nearestTarget(329.5, targets)!).toMatchObject({ target: { pitch: "E4" }, inTune: true });
    // Halfway between D3 and G3 in cents, the lower one wins only when closer.
    expect(nearestTarget(130, targets)!.target.pitch).toBe("D3");
    expect(nearestTarget(0, targets)).toBeNull();
    expect(nearestTarget(110, [])).toBeNull();
    expect(chromaticNote(445)).toMatchObject({ pitch: "A4", midi: 69 });
    expect(chromaticNote(445).cents).toBeCloseTo(centsFrom(445, 440), 9);
    expect(chromaticNote(277.18).pitch).toBe("C#4");
  });
});
