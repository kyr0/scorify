import { PerformancePlan } from './performance.mjs';
export { HumanizeOptions, PerformanceNote, PerformanceOptions, PerformanceResult, PerformedStroke, StrumOptions, StrumStroke, createPerformance, expandStrumPattern, metricWeight, strumSweepSeconds, validatePerformance } from './performance.mjs';
import { SynthOptions, EffectSettings, SynthesisStats } from './audio-dsp.mjs';
export { AudioPreset, BodyMode, DEFAULT_DELAY_SECONDS, EffectChain, PluckTone, PluckedStringSynth, RenderOptions, RenderedAudio, ResolvedEffects, SYNTHESIS_VERSION, StringExcitation, SynthesisInput, applyEffects, classicalGuitarAudioPreset, delayForTempo, effectsTailSeconds, encodeWav, renderPerformance, resolveEffects, stringTuning, ukuleleAudioPreset } from './audio-dsp.mjs';
export { Click, ClickKind, GUIDE_METRONOME, GUIDE_VOICE, GuideAudio, GuideNote, GuideSpan, GuideVoiceOptions, PatternClick, clickPattern, countIn, renderClicks, renderGuideVoice } from './audio-guide.mjs';
import './model.mjs';
import './time-B3MQxqrT.mjs';
import './profiles.mjs';
import './fretted.mjs';
import './fingering.mjs';
import './adapters.mjs';
import './arrange.mjs';
import './transforms.mjs';

interface PlaybackEnd {
    readonly reason: "ended" | "stopped" | "disposed" | "error";
    readonly stats?: SynthesisStats;
}
interface PlaybackHandle {
    readonly id: number;
    readonly startTime: number;
    readonly finished: Promise<PlaybackEnd>;
    stop(): void;
}
interface PlayOptions extends SynthOptions {
    readonly when?: number;
    readonly leadTime?: number;
    readonly tailSeconds?: number;
    /** Post effects for this playback; the samples equal renderPerformance with the same effects. */
    readonly effects?: EffectSettings;
}
interface AudioPlayer {
    readonly node: AudioWorkletNode;
    play(performance: PerformancePlan, options?: PlayOptions): Promise<PlaybackHandle>;
    stop(): void;
    /** Switch effects of the current playback (ramped; a switched-off delay or reverb rings out). */
    setEffects(effects: EffectSettings): void;
    dispose(): void;
}
/** An AudioWorkletNode running scorify's effect chain on whatever is connected to it. */
interface EffectsNode {
    readonly node: AudioWorkletNode;
    /** Switch effects or change the echo time while audio runs (ramped). */
    set(effects: EffectSettings): void;
    dispose(): void;
}
/**
 * Routes audio through scorify's effects in an AudioWorklet (on an AudioContext or OfflineAudioContext): connect
 * sources to `node`; it is connected to `destination` (default: the context's). Serve audio-worklet.mjs from your
 * app's origin and pass its URL when it is not next to this module.
 */
declare function createEffectsNode(context: BaseAudioContext, options?: {
    readonly workletUrl?: string | URL;
    readonly destination?: AudioNode;
    readonly effects?: EffectSettings;
}): Promise<EffectsNode>;
/** User owns the AudioContext. Call play() from a user gesture when autoplay is restricted. */
declare function createAudioPlayer(context: AudioContext, options?: {
    readonly workletUrl?: string | URL;
    readonly destination?: AudioNode;
}): Promise<AudioPlayer>;

export { EffectSettings, PerformancePlan, SynthOptions, SynthesisStats, createAudioPlayer, createEffectsNode };
export type { AudioPlayer, EffectsNode, PlayOptions, PlaybackEnd, PlaybackHandle };
//# sourceMappingURL=audio.d.mts.map
