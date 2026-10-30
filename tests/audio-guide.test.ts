import { describe, it, expect } from "vitest";
import { renderGuideVoice, renderClicks, clickPattern, countIn, GUIDE_VOICE } from "../src/audio-guide.js";
import { renderPerformance } from "../src/audio-dsp.js";

const RATE = 48000;
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i]! ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
};
/** The amplitude of one frequency in a signal (Goertzel). */
const amplitude = (x: Float32Array, hz: number, from: number, to: number) => {
  const w = (2 * Math.PI * hz) / RATE,
    c = 2 * Math.cos(w);
  let s1 = 0,
    s2 = 0;
  for (let i = from; i < to; i++) [s1, s2] = [x[i]! + c * s1 - s2, s1];
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / ((to - from) / 2);
};
const zeroCrossings = (x: Float32Array, from: number, to: number) => {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (Math.sign(x[i]!) !== Math.sign(x[i - 1]!)) n++;
  return n;
};

describe("guide voice", () => {
  const line = [
    { onsetSeconds: 0.1, endSeconds: 0.6, frequency: 440 },
    { onsetSeconds: 0.6, endSeconds: 1.4, frequency: 494 },
  ];
  it("sings each note at its pitch, silent before it and after its release", () => {
    const [left, right] = renderGuideVoice(line, { durationSeconds: 1.6, sampleRate: RATE }).channels;
    expect(left).toEqual(right);
    expect(rms(left, 0, 0.09 * RATE)).toBe(0);
    expect(rms(left, 0.2 * RATE, 0.5 * RATE)).toBeGreaterThan(0.03);
    expect(rms(left, Math.ceil((1.4 + GUIDE_VOICE.releaseSeconds + 0.01) * RATE))).toBeLessThan(1e-4);
    // 0.2 s of a 440 Hz fundamental crosses zero about 176 times, before the vibrato sets in.
    expect(zeroCrossings(left, 0.12 * RATE, 0.32 * RATE)).toBeGreaterThan(160);
    expect(zeroCrossings(left, 0.12 * RATE, 0.32 * RATE)).toBeLessThan(200);
  });
  it("is filtered: the overtones above the lowpass are softened, the fundamental kept", () => {
    // 0.1-0.25 s: before the vibrato, so every harmonic sits on its own frequency.
    const high = [{ onsetSeconds: 0, endSeconds: 1, frequency: 880 }],
      [from, to] = [0.1 * RATE, 0.25 * RATE];
    const soft = renderGuideVoice(high, { durationSeconds: 1, sampleRate: RATE }).channels[0];
    const open = renderGuideVoice(high, { durationSeconds: 1, sampleRate: RATE, lowpassHz: 20000 }).channels[0];
    expect(amplitude(soft, 880, from, to)).toBeGreaterThan(amplitude(open, 880, from, to) * 0.85);
    // The fourth harmonic (3.5 kHz) loses more than 9 dB.
    expect(amplitude(soft, 3520, from, to)).toBeLessThan(amplitude(open, 3520, from, to) * 0.35);
  });
  it("renders a span like the same span of a longer render once its filter settles", () => {
    const whole = renderGuideVoice(line, { durationSeconds: 1.6, sampleRate: RATE }).channels[0];
    const part = renderGuideVoice(line, { startSeconds: 0.5, durationSeconds: 1.1, sampleRate: RATE }).channels[0];
    let worst = 0;
    for (let i = 0.02 * RATE; i < Math.min(part.length, whole.length - 0.5 * RATE); i++) worst = Math.max(worst, Math.abs(part[i]! - whole[i + 0.5 * RATE]!));
    expect(worst).toBeLessThan(1e-4);
  });
  it("stays under the strings it sings with", () => {
    const voice = renderGuideVoice([{ onsetSeconds: 0, endSeconds: 1, frequency: 330 }], { durationSeconds: 1, sampleRate: RATE }).channels[0];
    const strings = renderPerformance(
      {
        strings: ["e"],
        durationSeconds: 1,
        events: [{ id: "n", stringId: "e", frequency: 330, onsetSeconds: 0, endSeconds: 1, excitationSeed: 1, velocity: 0.8, brightness: 0.6, pluckPosition: 0.2, decaySeconds: 1, muted: false }],
      },
      { sampleRate: RATE, tailSeconds: 0 },
    ).channels[0];
    expect(Math.max(...voice.map(Math.abs))).toBeLessThan(0.25);
    expect(rms(voice)).toBeLessThan(rms(strings) * 4);
  });
  it("rejects what it cannot sing", () => {
    expect(() => renderGuideVoice([{ onsetSeconds: 1, endSeconds: 0.5, frequency: 440 }], { durationSeconds: 1 })).toThrow(RangeError);
    expect(() => renderGuideVoice([{ onsetSeconds: 0, endSeconds: 1, frequency: 0 }], { durationSeconds: 1 })).toThrow(RangeError);
    expect(() => renderGuideVoice([], { durationSeconds: 0 })).toThrow(RangeError);
    expect(() => renderGuideVoice([], { durationSeconds: 1, lowpassHz: 50 })).toThrow(RangeError);
  });
});

describe("metronome", () => {
  it("kicks on strong beats and claps between", () => {
    const kinds = (n: number, d: number) => clickPattern(n, d).map((c) => `${c.beat}${c.kind[0]}${c.accent ? "!" : ""}`).join(" ");
    expect(kinds(4, 4)).toBe("0k! 1c 2k 3c");
    expect(kinds(3, 4)).toBe("0k! 1c 2c");
    expect(kinds(2, 4)).toBe("0k! 1c");
    expect(kinds(6, 8)).toBe("0k! 3c");
    expect(kinds(12, 8)).toBe("0k! 3c 6k 9c");
    expect(kinds(3, 8)).toBe("0k! 1c 2c");
    expect(() => clickPattern(4, 3)).toThrow(RangeError);
  });
  it("counts in one bar that ends where the song starts", () => {
    const clicks = countIn(4, 4, 0.5, 3);
    expect(clicks.map((c) => c.atSeconds)).toEqual([1, 1.5, 2, 2.5]);
    expect(clicks[0]).toMatchObject({ kind: "kick", accent: true });
  });
  it("sweeps the kick down from 120 Hz and lets it die away", () => {
    const kick = renderClicks([{ atSeconds: 0, kind: "kick", accent: true }], { durationSeconds: 0.6, sampleRate: RATE }).channels[0];
    // Zero crossings in 30 ms: about 7 at the start (~120 Hz), about 3 near the end of the sweep (~45 Hz).
    expect(zeroCrossings(kick, 0, 0.03 * RATE)).toBeGreaterThan(zeroCrossings(kick, 0.2 * RATE, 0.23 * RATE));
    expect(rms(kick, 0.42 * RATE)).toBe(0);
    expect(Math.max(...kick.map(Math.abs))).toBeLessThan(1);
  });
  it("claps in three bursts and a tail", () => {
    const clap = renderClicks([{ atSeconds: 0, kind: "clap" }], { durationSeconds: 0.3, sampleRate: RATE }).channels[0];
    const at = (ms: number) => rms(clap, Math.round((ms / 1000) * RATE), Math.round(((ms + 2) / 1000) * RATE));
    for (const burst of [0.5, 11.5, 22.5]) expect(at(burst)).toBeGreaterThan(at(burst + 8) * 2);
    expect(rms(clap, 0.04 * RATE, 0.1 * RATE)).toBeGreaterThan(0);
  });
  it("accents the first beat, and a span equals the same span of a longer render", () => {
    const clicks = [...countIn(4, 4, 0.5, 2), { atSeconds: 2, kind: "kick" as const, accent: true }];
    const whole = renderClicks(clicks, { durationSeconds: 3, sampleRate: RATE }).channels[0];
    const part = renderClicks(clicks, { startSeconds: 0.75, durationSeconds: 2, sampleRate: RATE }).channels[0];
    expect(part).toEqual(whole.subarray(0.75 * RATE, 0.75 * RATE + part.length));
    expect(rms(whole, 0, 0.1 * RATE)).toBeGreaterThan(rms(whole, 1.0 * RATE, 1.1 * RATE));
  });
  it("rejects unknown sounds and spans", () => {
    expect(() => renderClicks([{ atSeconds: 0, kind: "snare" as "kick" }], { durationSeconds: 1 })).toThrow(RangeError);
    expect(() => renderClicks([], { durationSeconds: 1, sampleRate: 100 })).toThrow(RangeError);
    expect(() => countIn(4, 4, 0, 1)).toThrow(RangeError);
  });
});
