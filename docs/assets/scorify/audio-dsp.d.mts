/**
 * Post effects for rendered strings: a soft saturation, a tape delay and a room reverb, applied in that order. Each is
 * switched on or off on its own; switching ramps over 20 ms, and switching the delay or reverb off lets its tail ring
 * out. The DSP is host-neutral and runs sample by sample with deterministic state, so the same input and settings give
 * the same samples offline, in any block size, and in the AudioWorklet processors.
 */
interface EffectSettings {
    /** Soft saturation: quiet notes pass at unity gain, peaks are rounded off (tanh with antiderivative antialiasing). */
    readonly saturation?: boolean;
    /** A tape echo every `delaySeconds`: each repeat loses highs and lows and wobbles slightly in pitch. */
    readonly delay?: boolean;
    /** A room reverb (Freeverb's comb and allpass network), about two seconds. */
    readonly reverb?: boolean;
    /** Seconds between echoes, in [0.05, 1.5]; default 0.45. `delayForTempo` gives a dotted eighth. */
    readonly delaySeconds?: number;
}
interface ResolvedEffects {
    readonly saturation: boolean;
    readonly delay: boolean;
    readonly reverb: boolean;
    readonly delaySeconds: number;
}
declare const DEFAULT_DELAY_SECONDS = 0.45;
/** Validated settings with defaults. Throws RangeError on anything else. */
declare function resolveEffects(settings?: EffectSettings): ResolvedEffects;
/** A dotted eighth (three quarters of a quarter note) at a tempo in quarter notes per minute, at most 1.5 s. */
declare function delayForTempo(quarterBpm: number): number;
/** Seconds the switched-on effects keep sounding after the input stops. */
declare function effectsTailSeconds(settings?: EffectSettings): number;
/**
 * A stereo effect chain with its own state: `process` works in place on any block, `set` switches effects (ramped)
 * and may change the echo time (gliding, as tape does). Delay and reverb run until their tails have died away after
 * being switched off, then idle.
 */
declare class EffectChain {
    readonly sampleRate: number;
    private settingsValue;
    private readonly step;
    private saturation;
    private send;
    private room;
    private delay;
    private readonly glide;
    private phase;
    private readonly saturators;
    private readonly echoes;
    private readonly reverb;
    private delayIdle;
    private roomIdle;
    constructor(sampleRate: number, settings?: EffectSettings);
    get settings(): ResolvedEffects;
    set(settings: EffectSettings): void;
    process(left: Float32Array, right: Float32Array, offset?: number, count?: number): void;
}
/**
 * Rendered audio through the effects, with their tail appended; the input is not changed. With every effect off it
 * returns the input itself.
 */
declare function applyEffects(audio: RenderedAudio, settings: EffectSettings): RenderedAudio;

/** Serializable input to the DSP; no score/theory/browser dependency. */
interface PluckTone {
    readonly velocity: number;
    readonly brightness: number;
    readonly pluckPosition: number;
    /** Nominal loss time; frequency-dependent damping can shorten actual T60. */
    readonly decaySeconds: number;
    readonly muted: boolean;
}
interface StringExcitation extends PluckTone {
    readonly id: string;
    readonly stringId: string;
    readonly frequency: number;
    readonly onsetSeconds: number;
    readonly endSeconds: number;
    readonly excitationSeed: number;
    /** Sounding detune from `frequency`, strictly within one cent (slow string drift). Default 0. */
    readonly detuneCents?: number;
}
interface SynthesisInput {
    readonly strings: readonly string[];
    readonly events: readonly StringExcitation[];
    readonly durationSeconds: number;
    readonly preset?: AudioPreset;
}
interface BodyMode {
    readonly frequency: number;
    readonly q: number;
    readonly gain: number;
}
interface AudioPreset {
    readonly id: string;
    readonly tone: PluckTone;
    readonly body: readonly BodyMode[];
    readonly bodyMix: number;
}
interface SynthOptions {
    readonly preset?: AudioPreset;
    readonly gain?: number;
    readonly stereoWidth?: number;
    readonly saturation?: number;
    readonly releaseSeconds?: number;
    readonly bodyMix?: number;
    readonly maxEvents?: number;
}
interface RenderOptions extends SynthOptions {
    readonly sampleRate?: number;
    readonly tailSeconds?: number;
    readonly maxSeconds?: number;
    /** Post effects after the strings (see audio-effects); their tail is added to `tailSeconds`. */
    readonly effects?: EffectSettings;
}
declare function ukuleleAudioPreset(): AudioPreset;
declare function classicalGuitarAudioPreset(): AudioPreset;

declare const SYNTHESIS_VERSION = "scorify-waveguide-1";
interface Tuning {
    integerDelay: number;
    allpass: number;
    damping: number;
    gain: number;
}
/** Match loop phase at the requested fundamental, including FIR damping phase. */
declare function stringTuning(frequency: number, sampleRate: number, tone: PluckTone): Tuning;
interface SynthesisStats {
    readonly frames: number;
    readonly clippedSamples: number;
    readonly peakBeforeLimiter: number;
    readonly excitations: number;
}
/** Persistent one-voice-per-physical-string engine shared by offline and worklet rendering. */
declare class PluckedStringSynth {
    readonly sampleRate: number;
    readonly input: SynthesisInput;
    readonly options: Required<Omit<SynthOptions, "preset">>;
    readonly preset: AudioPreset;
    private readonly voices;
    private readonly stringIndex;
    private readonly actions;
    private readonly modes;
    private readonly pans;
    private frame;
    private actionIndex;
    private dcX;
    private dcY;
    private clips;
    private peak;
    private attacks;
    constructor(input: SynthesisInput, sampleRate?: number, options?: SynthOptions);
    stop(): void;
    get stats(): SynthesisStats;
    /** Fills any block size. No new arrays or objects are created in the sample loop. */
    process(left: Float32Array, right: Float32Array, offset?: number, count?: number): void;
}
interface RenderedAudio {
    readonly sampleRate: number;
    readonly channels: readonly [Float32Array, Float32Array];
    readonly durationSeconds: number;
    readonly stats: SynthesisStats;
}
declare function renderPerformance(input: SynthesisInput, options?: RenderOptions): RenderedAudio;
/** PCM16 stereo RIFF/WAVE, portable to Node and browsers. */
declare function encodeWav(audio: RenderedAudio): Uint8Array;

export { DEFAULT_DELAY_SECONDS, EffectChain, PluckedStringSynth, SYNTHESIS_VERSION, applyEffects, classicalGuitarAudioPreset, delayForTempo, effectsTailSeconds, encodeWav, renderPerformance, resolveEffects, stringTuning, ukuleleAudioPreset };
export type { AudioPreset, BodyMode, EffectSettings, PluckTone, RenderOptions, RenderedAudio, ResolvedEffects, StringExcitation, SynthOptions, SynthesisInput, SynthesisStats };
//# sourceMappingURL=audio-dsp.d.mts.map
