import { describe, it, expect } from "vitest";
import {
  EffectChain,
  applyEffects,
  delayForTempo,
  effectsTailSeconds,
  resolveEffects,
} from "../src/audio-effects.js";
import { renderPerformance } from "../src/audio-dsp.js";
import type { SynthesisInput } from "../src/audio-dsp.js";
import {
  installAudioWorklet,
  installEffectsWorklet,
  AUDIO_PROCESSOR_NAME,
  EFFECTS_PROCESSOR_NAME,
} from "../src/audio-worklet.js";

const RATE = 48000;
const input: SynthesisInput = {
  strings: ["a", "b"],
  durationSeconds: 0.6,
  events: [0, 0.2, 0.4].map((at, k) => ({
    id: `n${k}`,
    stringId: k % 2 ? "b" : "a",
    frequency: [196, 262, 330][k]!,
    onsetSeconds: at,
    endSeconds: at + 0.18,
    excitationSeed: 17 + k,
    velocity: 0.8,
    brightness: 0.6,
    pluckPosition: 0.2,
    decaySeconds: 1,
    muted: false,
  })),
};
const impulse = (seconds: number) => {
  const left = new Float32Array(Math.round(seconds * RATE)),
    right = new Float32Array(left.length);
  left[0] = right[0] = 0.5;
  return { left, right };
};
const energy = (x: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) sum += x[i]! * x[i]!;
  return sum;
};
const ALL = { saturation: true, delay: true, reverb: true };

describe("post effects", () => {
  it("leaves audio untouched with every effect off and validates settings", () => {
    const dry = renderPerformance(input, { sampleRate: RATE });
    expect(applyEffects(dry, {})).toBe(dry);
    const off = renderPerformance(input, { sampleRate: RATE, effects: { delay: false } });
    expect(off.channels[0]).toEqual(dry.channels[0]);
    expect(() => resolveEffects({ reverb: "yes" as unknown as boolean })).toThrow(RangeError);
    expect(() => resolveEffects({ delaySeconds: 2 })).toThrow(RangeError);
    expect(delayForTempo(80)).toBeCloseTo(0.5625, 10);
    expect(effectsTailSeconds({ reverb: true })).toBe(2.5);
    expect(effectsTailSeconds({ delay: true, delaySeconds: 0.5 })).toBe(4);
  });

  it("is deterministic and independent of the block size", () => {
    const dry = renderPerformance(input, { sampleRate: RATE }),
      whole = applyEffects(dry, ALL),
      left = new Float32Array(whole.channels[0].length),
      right = new Float32Array(left.length);
    left.set(dry.channels[0]);
    right.set(dry.channels[1]);
    const chain = new EffectChain(RATE, ALL);
    for (let at = 0, k = 0; at < left.length; k++) {
      const count = Math.min([1, 127, 128, 333][k % 4]!, left.length - at);
      chain.process(left, right, at, count);
      at += count;
    }
    expect(left).toEqual(whole.channels[0]);
    expect(right).toEqual(whole.channels[1]);
    expect(applyEffects(dry, ALL).channels[1]).toEqual(whole.channels[1]);
    // renderPerformance with effects is the dry render through the same chain, tail included.
    const rendered = renderPerformance(input, { sampleRate: RATE, effects: ALL });
    expect(rendered.channels[0].length).toBe(whole.channels[0].length);
    expect(rendered.channels[0]).toEqual(whole.channels[0]);
  });

  it("saturates softly: quiet signals at unity gain, peaks rounded off", () => {
    const n = 4800,
      quiet = new Float32Array(n),
      loud = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      quiet[i] = 0.01 * Math.sin((2 * Math.PI * 220 * i) / RATE);
      loud[i] = 0.9 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    }
    const q = Float32Array.from(quiet),
      l = Float32Array.from(loud);
    new EffectChain(RATE, { saturation: true }).process(q, Float32Array.from(quiet));
    new EffectChain(RATE, { saturation: true }).process(l, Float32Array.from(loud));
    expect(Math.max(...q.map((v, i) => Math.abs(v - quiet[i]!)))).toBeLessThan(0.002);
    expect(Math.max(...l)).toBeLessThan(0.42);
    expect(Math.max(...l)).toBeGreaterThan(0.35);
  });

  it("echoes at the delay time, each repeat weaker, and rings out after being switched off", () => {
    const { left, right } = impulse(2.5),
      chain = new EffectChain(RATE, { delay: true, delaySeconds: 0.3 });
    chain.process(left, right, 0, RATE / 2);
    chain.set({ delay: false });
    chain.process(left, right, RATE / 2, left.length - RATE / 2);
    const peakNear = (seconds: number) => {
      let best = 0,
        at = 0;
      for (let i = Math.round((seconds - 0.02) * RATE); i < Math.round((seconds + 0.02) * RATE); i++)
        if (Math.abs(left[i]!) > best) [best, at] = [Math.abs(left[i]!), i];
      return { best, seconds: at / RATE };
    };
    const first = peakNear(0.3),
      second = peakNear(0.6),
      third = peakNear(0.9);
    expect(Math.abs(first.seconds - 0.3)).toBeLessThan(0.006);
    expect(first.best).toBeGreaterThan(0.005);
    // Switched off at 0.5 s: the second and third echoes still sound, each weaker than the one before.
    expect(second.best).toBeGreaterThan(0.0005);
    expect(second.best).toBeLessThan(first.best);
    expect(third.best).toBeLessThan(second.best);
    expect(energy(left, 0.05, 0.25)).toBeLessThan(1e-12);
  });

  it("adds a decaying room and stays bounded", () => {
    const { left, right } = impulse(3);
    new EffectChain(RATE, { reverb: true }).process(left, right);
    const early = energy(left, 0.05, 0.4),
      late = energy(left, 1.8, 2.4);
    expect(early).toBeGreaterThan(1e-5);
    expect(late).toBeLessThan(early / 100);
    expect(left.every(Number.isFinite) && right.every(Number.isFinite)).toBe(true);
    // The two sides differ: a stereo room.
    expect(energy(left.map((v, i) => v - right[i]!), 0.05, 0.4)).toBeGreaterThan(0);
  });

  it("switches without clicks", () => {
    const n = RATE / 2,
      left = new Float32Array(n);
    for (let i = 0; i < n; i++) left[i] = 0.6 * Math.sin((2 * Math.PI * 110 * i) / RATE);
    const right = Float32Array.from(left),
      chain = new EffectChain(RATE, {});
    chain.process(left, right, 0, n / 2);
    chain.set({ saturation: true, reverb: true });
    chain.process(left, right, n / 2, n / 2);
    let jump = 0;
    for (let i = 1; i < n; i++) jump = Math.max(jump, Math.abs(left[i]! - left[i - 1]!));
    // A 110 Hz sine at 0.6 moves at most 0.0087 per sample; switching adds no step.
    expect(jump).toBeLessThan(0.02);
  });
});

function host(expectName: string, install: (h: any) => void) {
  const messages: any[] = [];
  class Base {
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (m: unknown) => messages.push(m),
      close: () => {},
    };
    constructor(_options?: unknown) {}
  }
  let Constructor: any;
  const h = {
    sampleRate: RATE,
    currentFrame: 0,
    AudioWorkletProcessor: Base,
    registerProcessor: (name: string, ctor: any) => {
      expect(name).toBe(expectName);
      Constructor = ctor;
    },
  };
  install(h);
  return { h, messages, make: (options?: unknown) => new Constructor(options) };
}

describe("post effects in AudioWorklets", () => {
  it("the player's samples with effects equal renderPerformance with them, in any quantum size", () => {
    const { h, messages, make } = host(AUDIO_PROCESSOR_NAME, installAudioWorklet),
      processor = make();
    processor.port.onmessage({ data: { type: "load", id: 1, input, tailSeconds: 0.1, effects: ALL } });
    processor.port.onmessage({ data: { type: "start", id: 1, when: 0 } });
    const expected = renderPerformance(input, { sampleRate: RATE, tailSeconds: 0.1, effects: ALL }),
      actual = new Float32Array(expected.channels[0].length);
    for (let at = 0; at < actual.length; ) {
      const size = Math.min(257, actual.length - at),
        l = new Float32Array(size),
        r = new Float32Array(size);
      processor.process([], [[l, r]]);
      h.currentFrame += size;
      actual.set(l, at);
      at += size;
    }
    expect(actual).toEqual(expected.channels[0]);
    expect(messages.filter((m) => m.type === "ended")).toHaveLength(1);
  });

  it("the effects processor equals the chain on its input, and switches live", () => {
    const { h, make } = host(EFFECTS_PROCESSOR_NAME, installEffectsWorklet),
      processor = make({ processorOptions: { effects: { reverb: true } } }),
      dry = renderPerformance(input, { sampleRate: RATE }),
      frames = dry.channels[0].length,
      out = new Float32Array(frames),
      expectedL = Float32Array.from(dry.channels[0]),
      expectedR = Float32Array.from(dry.channels[1]);
    const chain = new EffectChain(RATE, { reverb: true });
    for (let at = 0; at < frames; at += 128) {
      const size = Math.min(128, frames - at);
      if (at === 128 * 40) {
        processor.port.onmessage({ data: { type: "effects", effects: { delay: true } } });
        chain.set({ delay: true });
      }
      const l = new Float32Array(size),
        r = new Float32Array(size);
      processor.process([[dry.channels[0].subarray(at, at + size), dry.channels[1].subarray(at, at + size)]], [[l, r]]);
      chain.process(expectedL, expectedR, at, size);
      h.currentFrame += size;
      out.set(l, at);
    }
    expect(out).toEqual(expectedL);
    // Without input it keeps running, so tails ring out.
    const l = new Float32Array(128),
      r = new Float32Array(128);
    expect(processor.process([[]], [[l, r]])).toBe(true);
    expect(l.some((v) => v !== 0)).toBe(true);
  });
});
