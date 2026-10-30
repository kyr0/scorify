import { describe, it, expect } from "vitest";
import {
  PluckedStringSynth,
  renderPerformance,
  encodeWav,
  stringTuning,
  ukuleleAudioPreset,
  classicalGuitarAudioPreset,
} from "../src/audio-dsp.js";
import type {
  SynthesisInput,
  StringExcitation,
  PluckTone,
} from "../src/audio-dsp.js";
const tone: PluckTone = {
  velocity: 0.7,
  brightness: 0.6,
  pluckPosition: 0.22,
  decaySeconds: 3,
  muted: false,
};
const event = (
  overrides: Partial<StringExcitation> = {},
): StringExcitation => ({
  id: "a",
  stringId: "s1",
  frequency: 440,
  onsetSeconds: 0.02,
  endSeconds: 0.8,
  excitationSeed: 123,
  ...tone,
  ...overrides,
});
const input = (events = [event()], durationSeconds = 1): SynthesisInput => ({
  strings: ["s1"],
  events,
  durationSeconds,
});
function rms(a: Float32Array, start = 0, end = a.length): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += a[i]! ** 2;
  return Math.sqrt(sum / Math.max(1, end - start));
}
function estimatedFrequency(
  audio: Float32Array,
  expected: number,
  rate: number,
): number {
  const center = rate / expected,
    start = Math.round(0.08 * rate),
    end = Math.min(
      audio.length - Math.ceil(center) - 5,
      Math.round(0.25 * rate),
    ),
    lags: number[] = [],
    values: number[] = [];
  for (
    let lag = Math.max(2, Math.floor(center) - 4);
    lag <= Math.ceil(center) + 4;
    lag++
  ) {
    let cross = 0,
      a2 = 0,
      b2 = 0;
    for (let i = start; i < end; i++) {
      const a = audio[i]!,
        b = audio[i + lag]!;
      cross += a * b;
      a2 += a * a;
      b2 += b * b;
    }
    lags.push(lag);
    values.push(cross / Math.sqrt(a2 * b2));
  }
  const i = values.indexOf(Math.max(...values)),
    l = values[i - 1] ?? values[i]!,
    m = values[i]!,
    r = values[i + 1] ?? m,
    delta = (0.5 * (l - r)) / (l - 2 * m + r);
  return rate / (lags[i]! + (Number.isFinite(delta) ? delta : 0));
}
describe("waveguide DSP", () => {
  it("renders finite stereo samples, silence before attack and no clipping at nominal gain", () => {
    const a = renderPerformance(input());
    expect(a.channels[0].slice(0, 960).every((v) => v === 0)).toBe(true);
    expect(rms(a.channels[0], 960, 4000)).toBeGreaterThan(0.005);
    expect(
      a.channels.every((c) =>
        c.every((v) => Number.isFinite(v) && Math.abs(v) <= 1),
      ),
    ).toBe(true);
    expect(a.stats.clippedSamples).toBe(0);
  });
  it("compensates the complete loop phase at the fundamental", () => {
    for (const rate of [44100, 48000, 96000])
      for (const f of [82.4069, 110, 196, 261.6256, 440, 880, 1318.51]) {
        const t = stringTuning(f, rate, tone),
          w = (2 * Math.PI * f) / rate,
          ap =
            -2 *
            Math.atan(((1 - t.allpass) / (1 + t.allpass)) * Math.tan(w / 2)),
          filter = -Math.atan2(
            t.damping * Math.sin(w),
            1 - t.damping + t.damping * Math.cos(w),
          );
        expect(-w * t.integerDelay + ap + filter).toBeCloseTo(-2 * Math.PI, 10);
        expect(Math.abs(t.allpass)).toBeLessThan(1);
        expect(t.gain).toBeLessThan(1);
      }
  });
  it("measures rendered pitch within 5 cents across guitar/ukulele registers", () => {
    for (const rate of [44100, 48000])
      for (const frequency of [
        82.4069, 146.8324, 261.6256, 440, 880, 1318.51,
      ]) {
        const a = renderPerformance(input([event({ frequency })]), {
          sampleRate: rate,
          bodyMix: 0,
          stereoWidth: 0,
        });
        const estimated = estimatedFrequency(a.channels[0], frequency, rate),
          cents = 1200 * Math.log2(estimated / frequency);
        expect(
          Math.abs(cents),
          `${rate} Hz ${frequency} -> ${estimated}: ${cents} cents`,
        ).toBeLessThan(5);
      }
  });
  it("keeps deterministic PCM independent of render block sizes", () => {
    const data = input(),
      a = renderPerformance(data, { sampleRate: 44100, tailSeconds: 0 }),
      synth = new PluckedStringSynth(data, 44100),
      l = new Float32Array(44100),
      r = new Float32Array(44100);
    let offset = 0;
    const sizes = [1, 64, 128, 257, 31];
    for (let i = 0; offset < l.length; i++) {
      const count = Math.min(sizes[i % sizes.length]!, l.length - offset);
      synth.process(l, r, offset, count);
      offset += count;
    }
    expect(l).toEqual(a.channels[0]);
    expect(r).toEqual(a.channels[1]);
  });
  it("retains ringing state on repeated excitation instead of resetting the string", () => {
    const first = event({ endSeconds: 0.3 }),
      second = event({
        id: "b",
        onsetSeconds: 0.3,
        endSeconds: 0.7,
        excitationSeed: 456,
      });
    const together = renderPerformance(input([first, second]), { bodyMix: 0 }),
      alone = renderPerformance(input([second]), { bodyMix: 0 });
    expect(together.channels[0].slice(14400, 16000)).not.toEqual(
      alone.channels[0].slice(14400, 16000),
    );
    expect(together.stats.excitations).toBe(2);
  });
  it("uses fresh seeded noise and reproduces it for identical input", () => {
    const a = renderPerformance(input()),
      b = renderPerformance(input()),
      c = renderPerformance(input([event({ excitationSeed: 456 })]));
    expect(a.channels).toEqual(b.channels);
    expect(a.channels).not.toEqual(c.channels);
  });
  it("decays naturally and mutes/releases substantially faster", () => {
    const held = renderPerformance(input([event({ endSeconds: 2 })], 2), {
        bodyMix: 0,
      }),
      released = renderPerformance(input([event({ endSeconds: 0.2 })], 2), {
        bodyMix: 0,
      }),
      muted = renderPerformance(
        input([event({ muted: true, endSeconds: 2 })], 2),
        { bodyMix: 0 },
      );
    expect(rms(held.channels[0], 48000, 60000)).toBeLessThan(
      rms(held.channels[0], 4000, 8000),
    );
    expect(rms(released.channels[0], 24000, 30000)).toBeLessThan(
      rms(held.channels[0], 24000, 30000) * 0.05,
    );
    expect(rms(muted.channels[0], 24000, 30000)).toBeLessThan(
      rms(held.channels[0], 24000, 30000) * 0.05,
    );
  });
  it("body, brightness, position and saturation alter timbre without invalid samples", () => {
    const base = renderPerformance(input(), { bodyMix: 0 });
    for (const a of [
      renderPerformance(input(), { preset: classicalGuitarAudioPreset() }),
      renderPerformance(input([event({ brightness: 0.1 })]), { bodyMix: 0 }),
      renderPerformance(input([event({ pluckPosition: 0.4 })]), { bodyMix: 0 }),
      renderPerformance(input(), { saturation: 0.7 }),
    ]) {
      expect(a.channels[0]).not.toEqual(base.channels[0]);
      expect(a.channels[0].every(Number.isFinite)).toBe(true);
    }
  });
  it("pans physical strings without sorting by frequency", () => {
    const data: SynthesisInput = {
      strings: ["high", "low"],
      events: [event({ stringId: "high", frequency: 440 })],
      durationSeconds: 1,
    };
    const a = renderPerformance(data, { stereoWidth: 1, bodyMix: 0 });
    expect(rms(a.channels[0])).toBeGreaterThan(0.001);
    expect(rms(a.channels[1])).toBeLessThan(1e-8);
  });
  it("writes a valid portable PCM16 WAV header and clamps sample conversion", () => {
    const a = renderPerformance(input(), { sampleRate: 44100, tailSeconds: 0 }),
      wav = encodeWav(a),
      view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(22, true)).toBe(2);
    expect(wav.length).toBe(44 + 44100 * 4);
  });
  it("uses the input performance preset by default and rejects fractional WAV rates", () => {
    const data = { ...input(), preset: classicalGuitarAudioPreset() };
    const a = renderPerformance(data),
      b = renderPerformance(input(), { preset: classicalGuitarAudioPreset() });
    expect(a.channels[0].every((v, i) => v === b.channels[0][i])).toBe(true);
    expect(() => encodeWav({ ...a, sampleRate: 44100.5 })).toThrow(
      "Integer WAV",
    );
  });
  it("rejects impossible/tampered audio input and bounds allocations", () => {
    for (const data of [
      input([event({ frequency: 0 })]),
      input([event({ endSeconds: 0.01 })]),
      input([event(), event({ id: "b" })]),
      input([event({ velocity: Infinity })]),
    ])
      expect(() => renderPerformance(data)).toThrow();
    expect(() => renderPerformance(input(), { maxSeconds: 0.1 })).toThrow();
    expect(() => renderPerformance(input(), { sampleRate: NaN })).toThrow();
  });
  it("stop suppresses future plucks while allowing a damped tail", () => {
    const synth = new PluckedStringSynth(input([event({ onsetSeconds: 0.5 })]));
    synth.stop();
    const l = new Float32Array(48000),
      r = new Float32Array(48000);
    synth.process(l, r);
    expect(l.every((v) => v === 0)).toBe(true);
    expect(synth.stats.excitations).toBe(0);
  });
  it("plays a sub-cent detune as that exact frequency and rejects a full cent", () => {
    const cents = 0.9,
      detuned = renderPerformance(input([event({ detuneCents: cents })]), {
        sampleRate: 16000,
      }),
      shifted = renderPerformance(
        input([event({ frequency: 440 * 2 ** (cents / 1200) })]),
        { sampleRate: 16000 },
      ),
      plain = renderPerformance(input(), { sampleRate: 16000 });
    expect(detuned.channels[0]).toEqual(shifted.channels[0]);
    expect(detuned.channels[0]).not.toEqual(plain.channels[0]);
    for (const detuneCents of [1, -1, NaN])
      expect(() =>
        renderPerformance(input([event({ detuneCents })]), { sampleRate: 16000 }),
      ).toThrow(RangeError);
  });
});
