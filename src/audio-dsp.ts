import { EffectChain, effectsTailSeconds, resolveEffects } from "./audio-effects.js";
import {
  finiteRange,
  validateTone,
  randomGenerator,
  ukuleleAudioPreset,
} from "./audio/types.js";
import type {
  PluckTone,
  StringExcitation,
  SynthesisInput,
  AudioPreset,
  SynthOptions,
  RenderOptions,
} from "./audio/types.js";
export type {
  PluckTone,
  StringExcitation,
  SynthesisInput,
  AudioPreset,
  SynthOptions,
  RenderOptions,
  BodyMode,
} from "./audio/types.js";
export {
  ukuleleAudioPreset,
  classicalGuitarAudioPreset,
} from "./audio/types.js";
export * from "./audio-effects.js";
export const SYNTHESIS_VERSION = "scorify-waveguide-1";
interface Tuning {
  integerDelay: number;
  allpass: number;
  damping: number;
  gain: number;
}
/** Match loop phase at the requested fundamental, including FIR damping phase. */
export function stringTuning(
  frequency: number,
  sampleRate: number,
  tone: PluckTone,
): Tuning {
  finiteRange(sampleRate, 8000, 192000, "Sample rate");
  finiteRange(frequency, 20, sampleRate / 5, "Frequency");
  validateTone(tone);
  const w = (2 * Math.PI * frequency) / sampleRate,
    damping = 0.5 - 0.45 * tone.brightness;
  const filterDelay =
    Math.atan2(damping * Math.sin(w), 1 - damping + damping * Math.cos(w)) / w;
  const period = sampleRate / frequency,
    integerDelay = Math.floor(period - filterDelay - 0.5),
    fraction = period - filterDelay - integerDelay;
  const ratio = Math.tan((w * fraction) / 2) / Math.tan(w / 2),
    allpass = (1 - ratio) / (1 + ratio);
  return {
    integerDelay,
    allpass,
    damping,
    gain: Math.exp(
      -Math.log(1000) / (frequency * (tone.muted ? 0.035 : tone.decaySeconds)),
    ),
  };
}
interface Prepared extends StringExcitation {
  tuning: Tuning;
  excitation: Float64Array;
  onFrame: number;
  offFrame: number;
}
interface Action {
  frame: number;
  on: boolean;
  event: Prepared;
}
function prepare(event: StringExcitation, sampleRate: number): Prepared {
  const detune = event.detuneCents ?? 0;
  finiteRange(detune, -0.99, 0.99, "Detune (cents)");
  const frequency = event.frequency * 2 ** (detune / 1200),
    tuning = stringTuning(frequency, sampleRate, event),
    length = Math.max(8, Math.round(sampleRate / frequency));
  const random = randomGenerator(event.excitationSeed),
    raw = new Float64Array(length),
    excitation = new Float64Array(length),
    position = Math.max(1, Math.round(length * event.pluckPosition));
  for (let i = 0; i < length; i++) raw[i] = random() * 2 - 1;
  let last = 0,
    mean = 0;
  const smoothing = 0.9 * (1 - event.brightness);
  for (let i = 0; i < length; i++) {
    last =
      (1 - smoothing) * (raw[i]! - raw[(i - position + length) % length]!) +
      smoothing * last;
    excitation[i] = last;
    mean += last;
  }
  mean /= length;
  let energy = 0;
  for (let i = 0; i < length; i++) {
    excitation[i] = excitation[i]! - mean;
    energy += excitation[i]! ** 2;
  }
  const scale =
    energy > 1e-20 ? (event.velocity * 0.22) / Math.sqrt(energy / length) : 0;
  for (let i = 0; i < length; i++) excitation[i] = excitation[i]! * scale;
  const onFrame = Math.round(event.onsetSeconds * sampleRate),
    offFrame = Math.round(event.endSeconds * sampleRate);
  if (offFrame <= onFrame)
    throw new RangeError("Hold shorter than one output sample");
  return { ...event, frequency, tuning, excitation, onFrame, offFrame };
}
class StringVoice {
  readonly buffer: Float64Array;
  write = 0;
  apX = 0;
  apY = 0;
  filterX = 0;
  frequency = 440;
  tuning: Tuning = { integerDelay: 100, allpass: 0, damping: 0.3, gain: 0.99 };
  excitation: Float64Array | undefined;
  excitationIndex = 0;
  currentId: string | undefined;
  released = true;
  releaseGain = 0.99;
  constructor(
    readonly sampleRate: number,
    readonly releaseSeconds: number,
  ) {
    this.buffer = new Float64Array(Math.ceil(sampleRate / 20) + 8);
  }
  pluck(event: Prepared): void {
    this.tuning = event.tuning;
    this.frequency = event.frequency;
    this.releaseGain = Math.min(
      event.tuning.gain,
      Math.exp(-Math.log(1000) / (event.frequency * this.releaseSeconds)),
    );
    this.currentId = event.id;
    this.released = false;
    this.excitation = event.excitation;
    this.excitationIndex = 0;
  }
  release(id: string): void {
    if (id === this.currentId) {
      this.released = true;
      this.excitation = undefined;
    }
  }
  sample(): number {
    const t = this.tuning,
      read =
        (this.write - t.integerDelay + this.buffer.length) % this.buffer.length,
      x = this.buffer[read]!;
    const interpolated = t.allpass * (x - this.apY) + this.apX;
    this.apX = x;
    this.apY = interpolated;
    const filtered = (1 - t.damping) * interpolated + t.damping * this.filterX;
    this.filterX = interpolated;
    const gain = this.released ? this.releaseGain : t.gain;
    const excitation = this.excitation?.[this.excitationIndex++] ?? 0;
    // Energy-bounded string junction; normal operating levels do not reach this guard.
    const value = Math.max(-4, Math.min(4, filtered * gain + excitation));
    this.buffer[this.write] = Math.abs(value) < 1e-20 ? 0 : value;
    this.write = (this.write + 1) % this.buffer.length;
    if (this.excitation && this.excitationIndex >= this.excitation.length)
      this.excitation = undefined;
    return value;
  }
}
class Resonator {
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;
  readonly b0: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
  constructor(frequency: number, q: number, sampleRate: number) {
    const w = (2 * Math.PI * frequency) / sampleRate,
      alpha = Math.sin(w) / (2 * q),
      a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  sample(x: number): number {
    const y =
      this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = Math.abs(y) < 1e-20 ? 0 : y;
    return y;
  }
}
export interface SynthesisStats {
  readonly frames: number;
  readonly clippedSamples: number;
  readonly peakBeforeLimiter: number;
  readonly excitations: number;
}
/** Persistent one-voice-per-physical-string engine shared by offline and worklet rendering. */
export class PluckedStringSynth {
  readonly sampleRate: number;
  readonly input: SynthesisInput;
  readonly options: Required<Omit<SynthOptions, "preset">>;
  readonly preset: AudioPreset;
  private readonly voices: StringVoice[];
  private readonly stringIndex: Map<string, number>;
  private readonly actions: Action[];
  private readonly modes: { left: Resonator; right: Resonator; gain: number }[];
  private readonly pans: readonly (readonly [number, number])[];
  private frame = 0;
  private actionIndex = 0;
  private dcX = [0, 0];
  private dcY = [0, 0];
  private clips = 0;
  private peak = 0;
  private attacks = 0;
  constructor(
    input: SynthesisInput,
    sampleRate = 48000,
    options: SynthOptions = {},
  ) {
    finiteRange(sampleRate, 8000, 192000, "Sample rate");
    if (!Number.isInteger(sampleRate))
      throw new RangeError("Integer sample rate required");
    this.sampleRate = sampleRate;
    this.options = {
      gain: options.gain ?? 0.65,
      stereoWidth: options.stereoWidth ?? 0.35,
      saturation: options.saturation ?? 0,
      releaseSeconds: options.releaseSeconds ?? 0.025,
      bodyMix:
        options.bodyMix ??
        options.preset?.bodyMix ??
        input.preset?.bodyMix ??
        0.25,
      maxEvents: options.maxEvents ?? 10000,
    };
    finiteRange(this.options.gain, 0, 2, "Gain");
    finiteRange(this.options.stereoWidth, 0, 1, "Stereo width");
    finiteRange(this.options.saturation, 0, 1, "Saturation");
    finiteRange(this.options.releaseSeconds, 0.002, 1, "Release");
    finiteRange(this.options.bodyMix, 0, 1, "Body mix");
    if (
      !Number.isSafeInteger(this.options.maxEvents) ||
      this.options.maxEvents < 1 ||
      !Array.isArray(input.events) ||
      input.events.length > this.options.maxEvents
    )
      throw new RangeError("Event budget exceeded/invalid");
    if (
      !Array.isArray(input.strings) ||
      !input.strings.length ||
      input.strings.length > 32 ||
      input.strings.some((s) => typeof s !== "string" || !s) ||
      new Set(input.strings).size !== input.strings.length
    )
      throw new RangeError("Invalid physical strings");
    finiteRange(input.durationSeconds, 0, 86400, "Performance duration");
    this.preset = JSON.parse(
      JSON.stringify(options.preset ?? input.preset ?? ukuleleAudioPreset()),
    ) as AudioPreset;
    validateTone(this.preset.tone);
    if (!Array.isArray(this.preset.body) || this.preset.body.length > 16)
      throw new RangeError("Invalid body modes");
    this.modes = this.preset.body.map((mode) => {
      finiteRange(mode.frequency, 20, sampleRate * 0.45, "Body resonance");
      finiteRange(mode.q, 0.1, 100, "Body Q");
      finiteRange(mode.gain, 0, 2, "Body gain");
      return {
        left: new Resonator(mode.frequency, mode.q, sampleRate),
        right: new Resonator(mode.frequency, mode.q, sampleRate),
        gain: mode.gain,
      };
    });
    this.input = {
      strings: [...input.strings],
      durationSeconds: input.durationSeconds,
      events: input.events.map((e) => ({ ...e })),
    };
    this.stringIndex = new Map(input.strings.map((id, i) => [id, i]));
    this.voices = input.strings.map(
      () => new StringVoice(sampleRate, this.options.releaseSeconds),
    );
    this.pans = input.strings.map((_, i) => {
      const pan =
        input.strings.length === 1
          ? 0
          : ((i / (input.strings.length - 1)) * 2 - 1) *
            this.options.stereoWidth;
      return [
        Math.cos(((pan + 1) * Math.PI) / 4),
        Math.sin(((pan + 1) * Math.PI) / 4),
      ] as const;
    });
    const ids = new Set<string>();
    const events = this.input.events.map((e) => {
      if (
        !e.id ||
        ids.has(e.id) ||
        !this.stringIndex.has(e.stringId) ||
        !Number.isSafeInteger(e.excitationSeed) ||
        e.excitationSeed < 0 ||
        e.excitationSeed > 0xffffffff
      )
        throw new RangeError("Invalid excitation identity");
      ids.add(e.id);
      finiteRange(e.onsetSeconds, 0, input.durationSeconds, "Onset");
      finiteRange(
        e.endSeconds,
        e.onsetSeconds,
        input.durationSeconds,
        "Release",
      );
      return prepare(e, sampleRate);
    });
    // Never silently sum independently sustained ordinary notes onto the same string.
    for (const id of input.strings) {
      const same = events
        .filter((e) => e.stringId === id)
        .sort((a, b) => a.onFrame - b.onFrame);
      for (let i = 1; i < same.length; i++)
        if (same[i]!.onFrame < same[i - 1]!.offFrame)
          throw new RangeError("Overlapping events on one string");
    }
    this.actions = events
      .flatMap((event) => [
        { frame: event.onFrame, on: true, event },
        { frame: event.offFrame, on: false, event },
      ])
      .sort(
        (a, b) =>
          a.frame - b.frame ||
          Number(a.on) - Number(b.on) ||
          a.event.id.localeCompare(b.event.id),
      );
  }
  stop(): void {
    this.actionIndex = this.actions.length;
    for (const voice of this.voices)
      if (voice.currentId) voice.release(voice.currentId);
  }
  get stats(): SynthesisStats {
    return {
      frames: this.frame,
      clippedSamples: this.clips,
      peakBeforeLimiter: this.peak,
      excitations: this.attacks,
    };
  }
  /** Fills any block size. No new arrays or objects are created in the sample loop. */
  process(
    left: Float32Array,
    right: Float32Array,
    offset = 0,
    count = left.length - offset,
  ): void {
    if (
      left.length !== right.length ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(count) ||
      offset < 0 ||
      count < 0 ||
      offset + count > left.length
    )
      throw new RangeError("Invalid channel block");
    const dcPole = Math.exp((-2 * Math.PI * 12) / this.sampleRate),
      normalization = this.options.gain / Math.sqrt(this.voices.length),
      bodyMix = this.options.bodyMix,
      drive = 1 + this.options.saturation * 4;
    for (let i = offset; i < offset + count; i++, this.frame++) {
      while (
        this.actionIndex < this.actions.length &&
        this.actions[this.actionIndex]!.frame <= this.frame
      ) {
        const a = this.actions[this.actionIndex++]!,
          voice = this.voices[this.stringIndex.get(a.event.stringId)!]!;
        if (a.on) {
          voice.pluck(a.event);
          this.attacks++;
        } else voice.release(a.event.id);
      }
      let l = 0,
        r = 0;
      for (let j = 0; j < this.voices.length; j++) {
        const sample = this.voices[j]!.sample();
        l += sample * this.pans[j]![0];
        r += sample * this.pans[j]![1];
      }
      let bodyL = 0,
        bodyR = 0;
      for (const m of this.modes) {
        bodyL += m.left.sample(l) * m.gain;
        bodyR += m.right.sample(r) * m.gain;
      }
      l = ((1 - bodyMix) * l + bodyMix * bodyL) * normalization;
      r = ((1 - bodyMix) * r + bodyMix * bodyR) * normalization;
      const dl = l - this.dcX[0]! + dcPole * this.dcY[0]!,
        dr = r - this.dcX[1]! + dcPole * this.dcY[1]!;
      this.dcX[0] = l;
      this.dcX[1] = r;
      this.dcY[0] = dl;
      this.dcY[1] = dr;
      l = this.options.saturation ? Math.tanh(dl * drive) / drive : dl;
      r = this.options.saturation ? Math.tanh(dr * drive) / drive : dr;
      this.peak = Math.max(this.peak, Math.abs(l), Math.abs(r));
      if (Math.abs(l) > 1) this.clips++;
      if (Math.abs(r) > 1) this.clips++;
      left[i] = Math.max(-1, Math.min(1, l));
      right[i] = Math.max(-1, Math.min(1, r));
    }
  }
}
export interface RenderedAudio {
  readonly sampleRate: number;
  readonly channels: readonly [Float32Array, Float32Array];
  readonly durationSeconds: number;
  readonly stats: SynthesisStats;
}
export function renderPerformance(
  input: SynthesisInput,
  options: RenderOptions = {},
): RenderedAudio {
  const sampleRate = options.sampleRate ?? 48000,
    tail = options.tailSeconds ?? 0.35,
    max = options.maxSeconds ?? 300;
  finiteRange(tail, 0, 30, "Tail");
  finiteRange(max, 0.001, 3600, "Render budget");
  finiteRange(input.durationSeconds, 0, max, "Performance duration");
  const effects = options.effects ? resolveEffects(options.effects) : undefined,
    wet = !!effects && (effects.saturation || effects.delay || effects.reverb);
  const duration = input.durationSeconds + tail + (wet ? effectsTailSeconds(effects) : 0);
  if (duration > max) throw new RangeError("Render duration budget exceeded");
  const frames = Math.ceil(duration * sampleRate);
  if (!Number.isSafeInteger(frames) || frames > sampleRate * max)
    throw new RangeError("Invalid render size");
  const synth = new PluckedStringSynth(input, sampleRate, options),
    left = new Float32Array(frames),
    right = new Float32Array(frames);
  synth.process(left, right);
  if (wet) new EffectChain(sampleRate, effects).process(left, right);
  return {
    sampleRate,
    channels: [left, right],
    durationSeconds: frames / sampleRate,
    stats: synth.stats,
  };
}
/** PCM16 stereo RIFF/WAVE, portable to Node and browsers. */
export function encodeWav(audio: RenderedAudio): Uint8Array {
  const [left, right] = audio.channels;
  if (left.length !== right.length)
    throw new RangeError("Channel length mismatch");
  finiteRange(audio.sampleRate, 8000, 192000, "Sample rate");
  if (!Number.isInteger(audio.sampleRate))
    throw new RangeError("Integer WAV sample rate required");
  const size = left.length * 4;
  if (size > 0xffffffff - 36) throw new RangeError("WAV too large");
  const out = new Uint8Array(44 + size),
    v = new DataView(out.buffer),
    label = (at: number, s: string) => {
      for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
    };
  label(0, "RIFF");
  v.setUint32(4, 36 + size, true);
  label(8, "WAVE");
  label(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, audio.sampleRate, true);
  v.setUint32(28, audio.sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  label(36, "data");
  v.setUint32(40, size, true);
  for (let i = 0; i < left.length; i++)
    for (let c = 0; c < 2; c++) {
      const sample = audio.channels[c]![i]!;
      if (!Number.isFinite(sample))
        throw new RangeError("Nonfinite audio sample");
      const clamped = Math.max(-1, Math.min(1, sample));
      v.setInt16(
        44 + i * 4 + c * 2,
        Math.round(clamped * (clamped < 0 ? 32768 : 32767)),
        true,
      );
    }
  return out;
}
