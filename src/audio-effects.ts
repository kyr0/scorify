import type { RenderedAudio } from "./audio-dsp.js";
/**
 * Post effects for rendered strings: a soft saturation, a tape delay and a room reverb, applied in that order. Each is
 * switched on or off on its own; switching ramps over 20 ms, and switching the delay or reverb off lets its tail ring
 * out. The DSP is host-neutral and runs sample by sample with deterministic state, so the same input and settings give
 * the same samples offline, in any block size, and in the AudioWorklet processors.
 */
export interface EffectSettings {
  /** Soft saturation: quiet notes pass at unity gain, peaks are rounded off (tanh with antiderivative antialiasing). */
  readonly saturation?: boolean;
  /** A tape echo every `delaySeconds`: each repeat loses highs and lows and wobbles slightly in pitch. */
  readonly delay?: boolean;
  /** A room reverb (Freeverb's comb and allpass network), about two seconds. */
  readonly reverb?: boolean;
  /** Seconds between echoes, in [0.05, 1.5]; default 0.45. `delayForTempo` gives a dotted eighth. */
  readonly delaySeconds?: number;
}
export interface ResolvedEffects {
  readonly saturation: boolean;
  readonly delay: boolean;
  readonly reverb: boolean;
  readonly delaySeconds: number;
}
export const DEFAULT_DELAY_SECONDS = 0.45;
const RAMP_SECONDS = 0.02,
  DRIVE = 2.5,
  DELAY_FEEDBACK = 0.38,
  DELAY_RETURN = 0.42,
  DELAY_LOWPASS_HZ = 2800,
  DELAY_HIGHPASS_HZ = 160,
  DELAY_GLIDE_SECONDS = 0.05,
  WOW_HZ = 0.55,
  WOW_SECONDS = 0.0015,
  DELAY_REPEATS = 8,
  REVERB_PREDELAY_SECONDS = 0.012,
  REVERB_INPUT = 0.015,
  REVERB_RETURN = 0.4,
  REVERB_FEEDBACK = 0.88,
  REVERB_DAMP = 0.25,
  REVERB_TAIL_SECONDS = 2.5,
  ALLPASS_FEEDBACK = 0.5,
  // Freeverb's tunings in samples at 44.1 kHz, scaled to the sample rate; the right channel is spread by 23 samples.
  COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617],
  ALLPASSES = [556, 441, 341, 225],
  SPREAD = 23;

/** Validated settings with defaults. Throws RangeError on anything else. */
export function resolveEffects(settings: EffectSettings = {}): ResolvedEffects {
  if (!settings || typeof settings !== "object")
    throw new RangeError("Effect settings must be an object");
  for (const key of ["saturation", "delay", "reverb"] as const)
    if (settings[key] !== undefined && typeof settings[key] !== "boolean")
      throw new RangeError(`Effect ${key} must be a boolean`);
  const delaySeconds = settings.delaySeconds ?? DEFAULT_DELAY_SECONDS;
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0.05 || delaySeconds > 1.5)
    throw new RangeError("Effect delaySeconds must be in [0.05, 1.5]");
  return {
    saturation: settings.saturation ?? false,
    delay: settings.delay ?? false,
    reverb: settings.reverb ?? false,
    delaySeconds,
  };
}
/** A dotted eighth (three quarters of a quarter note) at a tempo in quarter notes per minute, at most 1.5 s. */
export function delayForTempo(quarterBpm: number): number {
  if (!Number.isFinite(quarterBpm) || quarterBpm < 20 || quarterBpm > 400)
    throw new RangeError("Tempo must be in [20, 400] quarter BPM");
  return Math.min(1.5, 45 / quarterBpm);
}
/** Seconds the switched-on effects keep sounding after the input stops. */
export function effectsTailSeconds(settings: EffectSettings = {}): number {
  const s = resolveEffects(settings);
  return (
    (s.reverb ? REVERB_TAIL_SECONDS : 0) +
    (s.delay ? s.delaySeconds * DELAY_REPEATS : 0)
  );
}
const onePole = (hz: number, sampleRate: number) =>
  1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
const logCosh = (u: number) => {
  const a = Math.abs(u);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
};
/** tanh(DRIVE·x)/DRIVE with first-order antiderivative antialiasing. */
class Saturator {
  private previous = 0;
  private integral = 0;
  /** The saturated sample; `track` only follows the input, so switching on later needs no history. */
  process(x: number): number {
    const integral = logCosh(DRIVE * x) / (DRIVE * DRIVE),
      delta = x - this.previous;
    const y =
      Math.abs(delta) < 1e-6
        ? Math.tanh((DRIVE * (x + this.previous)) / 2) / DRIVE
        : (integral - this.integral) / delta;
    this.previous = x;
    this.integral = integral;
    return y;
  }
  track(x: number): void {
    this.previous = x;
    this.integral = logCosh(DRIVE * x) / (DRIVE * DRIVE);
  }
}
class TapeDelay {
  private readonly buffer: Float64Array;
  private write = 0;
  private low = 0;
  private bass = 0;
  constructor(
    frames: number,
    private readonly lowpass: number,
    private readonly highpass: number,
  ) {
    this.buffer = new Float64Array(frames);
  }
  /** The filtered echo `delay` samples back (fractional); `input` is written with the saturated feedback. */
  process(input: number, delay: number): number {
    const size = this.buffer.length,
      position = this.write - delay + size,
      index = Math.floor(position),
      fraction = position - index,
      a = this.buffer[index % size]!,
      b = this.buffer[(index + 1) % size]!,
      echo = a + (b - a) * fraction;
    this.low += (echo - this.low) * this.lowpass;
    this.bass += (this.low - this.bass) * this.highpass;
    const filtered = this.low - this.bass;
    this.buffer[this.write] = input + DELAY_FEEDBACK * Math.tanh(filtered);
    this.write = (this.write + 1) % size;
    return filtered;
  }
  clear(): void {
    this.buffer.fill(0);
    this.low = this.bass = 0;
  }
}
class Comb {
  private readonly buffer: Float64Array;
  private index = 0;
  private store = 0;
  constructor(size: number) {
    this.buffer = new Float64Array(size);
  }
  process(x: number): number {
    const out = this.buffer[this.index]!;
    this.store = out * (1 - REVERB_DAMP) + this.store * REVERB_DAMP;
    this.buffer[this.index] = x + this.store * REVERB_FEEDBACK;
    this.index = (this.index + 1) % this.buffer.length;
    return out;
  }
  clear(): void {
    this.buffer.fill(0);
    this.store = 0;
  }
}
class Allpass {
  private readonly buffer: Float64Array;
  private index = 0;
  constructor(size: number) {
    this.buffer = new Float64Array(size);
  }
  process(x: number): number {
    const stored = this.buffer[this.index]!;
    this.buffer[this.index] = x + stored * ALLPASS_FEEDBACK;
    this.index = (this.index + 1) % this.buffer.length;
    return stored - x;
  }
  clear(): void {
    this.buffer.fill(0);
  }
}
class Room {
  private readonly predelay: Float64Array;
  private index = 0;
  private readonly combs: [Comb[], Comb[]];
  private readonly allpasses: [Allpass[], Allpass[]];
  readonly out: [number, number] = [0, 0];
  constructor(sampleRate: number) {
    const scale = (n: number) => Math.max(1, Math.round((n * sampleRate) / 44100));
    this.predelay = new Float64Array(Math.max(1, Math.round(REVERB_PREDELAY_SECONDS * sampleRate)));
    this.combs = [COMBS.map((n) => new Comb(scale(n))), COMBS.map((n) => new Comb(scale(n + SPREAD)))];
    this.allpasses = [ALLPASSES.map((n) => new Allpass(scale(n))), ALLPASSES.map((n) => new Allpass(scale(n + SPREAD)))];
  }
  /** Mono input in, the stereo room in `out`. */
  process(x: number): void {
    const delayed = this.predelay[this.index]!;
    this.predelay[this.index] = x * REVERB_INPUT;
    this.index = (this.index + 1) % this.predelay.length;
    for (let c = 0; c < 2; c++) {
      let sum = 0;
      for (const comb of this.combs[c]!) sum += comb.process(delayed);
      for (const allpass of this.allpasses[c]!) sum = allpass.process(sum);
      this.out[c] = sum;
    }
  }
  clear(): void {
    this.predelay.fill(0);
    for (const side of this.combs) for (const comb of side) comb.clear();
    for (const side of this.allpasses) for (const allpass of side) allpass.clear();
    this.out[0] = this.out[1] = 0;
  }
}
/**
 * A stereo effect chain with its own state: `process` works in place on any block, `set` switches effects (ramped)
 * and may change the echo time (gliding, as tape does). Delay and reverb run until their tails have died away after
 * being switched off, then idle.
 */
export class EffectChain {
  readonly sampleRate: number;
  private settingsValue: ResolvedEffects;
  private readonly step: number;
  private saturation = 0;
  private send = 0;
  private room = 0;
  private delay: number;
  private readonly glide: number;
  private phase = 0;
  private readonly saturators = [new Saturator(), new Saturator()] as const;
  private readonly echoes: readonly [TapeDelay, TapeDelay];
  private readonly reverb: Room;
  private delayIdle = Infinity;
  private roomIdle = Infinity;
  constructor(sampleRate: number, settings: EffectSettings = {}) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
      throw new RangeError("Sample rate must be in [8000, 192000]");
    this.sampleRate = sampleRate;
    this.settingsValue = resolveEffects(settings);
    this.step = 1 / Math.max(1, Math.round(RAMP_SECONDS * sampleRate));
    this.glide = onePole(1 / (2 * Math.PI * DELAY_GLIDE_SECONDS), sampleRate);
    this.delay = this.settingsValue.delaySeconds * sampleRate;
    const frames = Math.ceil((1.5 + 2 * WOW_SECONDS) * sampleRate) + 4,
      low = onePole(DELAY_LOWPASS_HZ, sampleRate),
      high = onePole(DELAY_HIGHPASS_HZ, sampleRate);
    this.echoes = [new TapeDelay(frames, low, high), new TapeDelay(frames, low, high)];
    this.reverb = new Room(sampleRate);
    // Switched on from the start, an effect sounds from the first sample.
    this.saturation = this.settingsValue.saturation ? 1 : 0;
    this.send = this.settingsValue.delay ? 1 : 0;
    this.room = this.settingsValue.reverb ? 1 : 0;
    if (this.send) this.delayIdle = 0;
    if (this.room) this.roomIdle = 0;
  }
  get settings(): ResolvedEffects {
    return this.settingsValue;
  }
  set(settings: EffectSettings): void {
    this.settingsValue = resolveEffects({ ...this.settingsValue, ...settings });
  }
  process(left: Float32Array, right: Float32Array, offset = 0, count = left.length - offset): void {
    if (right.length !== left.length || offset < 0 || count < 0 || offset + count > left.length)
      throw new RangeError("Invalid effect block");
    const s = this.settingsValue,
      rate = this.sampleRate,
      targetDelay = s.delaySeconds * rate,
      wowDepth = WOW_SECONDS * rate,
      delayTail = Math.ceil(s.delaySeconds * DELAY_REPEATS * rate),
      roomTail = Math.ceil(REVERB_TAIL_SECONDS * rate);
    const toward = (value: number, on: boolean) =>
      on ? Math.min(1, value + this.step) : Math.max(0, value - this.step);
    for (let i = offset; i < offset + count; i++) {
      this.saturation = toward(this.saturation, s.saturation);
      this.send = toward(this.send, s.delay);
      this.room = toward(this.room, s.reverb);
      let l = left[i]!,
        r = right[i]!;
      if (this.saturation > 0) {
        const sl = this.saturators[0].process(l),
          sr = this.saturators[1].process(r);
        l += this.saturation * (sl - l);
        r += this.saturation * (sr - r);
      } else {
        this.saturators[0].track(l);
        this.saturators[1].track(r);
      }
      // The delay runs while it is fed and for its tail afterwards; then its lines are cleared and it idles.
      this.delayIdle = this.send > 0 ? 0 : this.delayIdle + 1;
      if (this.delayIdle <= delayTail) {
        this.delay += (targetDelay - this.delay) * this.glide;
        this.phase += WOW_HZ / rate;
        if (this.phase >= 1) this.phase -= 1;
        const wow = Math.sin(2 * Math.PI * this.phase) * wowDepth,
          sway = Math.cos(2 * Math.PI * this.phase) * wowDepth;
        const el = this.echoes[0].process(l * this.send, this.delay + wowDepth + wow),
          er = this.echoes[1].process(r * this.send, this.delay + wowDepth + sway);
        l += DELAY_RETURN * el;
        r += DELAY_RETURN * er;
      } else if (this.delayIdle === delayTail + 1) {
        this.echoes[0].clear();
        this.echoes[1].clear();
      }
      this.roomIdle = this.room > 0 ? 0 : this.roomIdle + 1;
      if (this.roomIdle <= roomTail) {
        this.reverb.process((l + r) * this.room);
        l += REVERB_RETURN * this.reverb.out[0];
        r += REVERB_RETURN * this.reverb.out[1];
      } else if (this.roomIdle === roomTail + 1) this.reverb.clear();
      left[i] = l;
      right[i] = r;
    }
  }
}
/**
 * Rendered audio through the effects, with their tail appended; the input is not changed. With every effect off it
 * returns the input itself.
 */
export function applyEffects(audio: RenderedAudio, settings: EffectSettings): RenderedAudio {
  const s = resolveEffects(settings);
  if (!s.saturation && !s.delay && !s.reverb) return audio;
  const [inL, inR] = audio.channels;
  if (inL.length !== inR.length) throw new RangeError("Channel length mismatch");
  const frames = inL.length + Math.ceil(effectsTailSeconds(s) * audio.sampleRate),
    left = new Float32Array(frames),
    right = new Float32Array(frames);
  left.set(inL);
  right.set(inR);
  new EffectChain(audio.sampleRate, s).process(left, right);
  return { ...audio, channels: [left, right], durationSeconds: frames / audio.sampleRate };
}
