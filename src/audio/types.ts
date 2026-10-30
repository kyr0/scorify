import type { EffectSettings } from "../audio-effects.js";
/** Serializable input to the DSP; no score/theory/browser dependency. */
export interface PluckTone {
  readonly velocity: number;
  readonly brightness: number;
  readonly pluckPosition: number;
  /** Nominal loss time; frequency-dependent damping can shorten actual T60. */
  readonly decaySeconds: number;
  readonly muted: boolean;
}
export interface StringExcitation extends PluckTone {
  readonly id: string;
  readonly stringId: string;
  readonly frequency: number;
  readonly onsetSeconds: number;
  readonly endSeconds: number;
  readonly excitationSeed: number;
  /** Sounding detune from `frequency`, strictly within one cent (slow string drift). Default 0. */
  readonly detuneCents?: number;
}
export interface SynthesisInput {
  readonly strings: readonly string[];
  readonly events: readonly StringExcitation[];
  readonly durationSeconds: number;
  readonly preset?: AudioPreset;
}
export interface BodyMode {
  readonly frequency: number;
  readonly q: number;
  readonly gain: number;
}
export interface AudioPreset {
  readonly id: string;
  readonly tone: PluckTone;
  readonly body: readonly BodyMode[];
  readonly bodyMix: number;
}
export interface SynthOptions {
  readonly preset?: AudioPreset;
  readonly gain?: number;
  readonly stereoWidth?: number;
  readonly saturation?: number;
  readonly releaseSeconds?: number;
  readonly bodyMix?: number;
  readonly maxEvents?: number;
}
export interface RenderOptions extends SynthOptions {
  readonly sampleRate?: number;
  readonly tailSeconds?: number;
  readonly maxSeconds?: number;
  /** Post effects after the strings (see audio-effects); their tail is added to `tailSeconds`. */
  readonly effects?: EffectSettings;
}
export function finiteRange(
  value: number,
  min: number,
  max: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new RangeError(`${label} must be in [${min}, ${max}]`);
}
export function validateTone(t: PluckTone): void {
  finiteRange(t.velocity, 0, 1, "Velocity");
  finiteRange(t.brightness, 0, 1, "Brightness");
  finiteRange(t.pluckPosition, 0.02, 0.98, "Pluck position");
  finiteRange(t.decaySeconds, 0.02, 30, "Decay");
  if (typeof t.muted !== "boolean")
    throw new RangeError("Muted must be boolean");
}
/** FNV-1a plus avalanche; length-prefix components avoid identity collisions. */
export function seedHash(...parts: readonly (string | number)[]): number {
  let h = 2166136261;
  for (const part of parts) {
    const text = String(part),
      s = `${text.length}:${text}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
export function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function signedRandom(
  seed: string | number,
  id: string,
  channel: string,
): number {
  return randomGenerator(seedHash(seed, id, channel))() * 2 - 1;
}
export function ukuleleAudioPreset(): AudioPreset {
  return {
    id: "scorify-ukulele-1",
    tone: {
      velocity: 0.7,
      brightness: 0.65,
      pluckPosition: 0.22,
      decaySeconds: 1.8,
      muted: false,
    },
    body: [
      { frequency: 310, q: 2.5, gain: 0.7 },
      { frequency: 620, q: 3, gain: 0.4 },
      { frequency: 1180, q: 2, gain: 0.25 },
    ],
    bodyMix: 0.25,
  };
}
export function classicalGuitarAudioPreset(): AudioPreset {
  return {
    id: "scorify-classical-guitar-1",
    tone: {
      velocity: 0.7,
      brightness: 0.45,
      pluckPosition: 0.18,
      decaySeconds: 3.5,
      muted: false,
    },
    body: [
      { frequency: 110, q: 3, gain: 0.7 },
      { frequency: 210, q: 3, gain: 0.45 },
      { frequency: 420, q: 2.5, gain: 0.3 },
      { frequency: 1000, q: 2, gain: 0.2 },
    ],
    bodyMix: 0.3,
  };
}
