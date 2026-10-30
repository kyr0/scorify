declare const AUDIO_PROCESSOR_NAME = "scorify-plucked-strings-v1";
/** Effects for any audio routed through an AudioWorkletNode (see createEffectsNode in scorify/audio). */
declare const EFFECTS_PROCESSOR_NAME = "scorify-effects-v1";
interface Port {
    onmessage: ((e: {
        data: unknown;
    }) => void) | null;
    postMessage(message: unknown): void;
    close(): void;
}
interface ProcessorBase {
    readonly port: Port;
}
interface WorkletHost {
    AudioWorkletProcessor: new (options?: unknown) => ProcessorBase;
    registerProcessor(name: string, constructor: new () => ProcessorBase): void;
    sampleRate: number;
    currentFrame: number;
}
/** Called automatically only in an AudioWorkletGlobalScope; testable with an injected host. */
declare function installAudioWorklet(host: WorkletHost): void;
/**
 * The effects processor: stereo input (a mono input is used on both sides) through one EffectChain to a stereo
 * output. `processorOptions.effects` sets it up; `{ type: "effects", effects }` switches effects while it runs;
 * `{ type: "dispose" }` ends it. It keeps running without input, so tails ring out.
 */
declare function installEffectsWorklet(host: WorkletHost): void;

export { AUDIO_PROCESSOR_NAME, EFFECTS_PROCESSOR_NAME, installAudioWorklet, installEffectsWorklet };
//# sourceMappingURL=audio-worklet.d.mts.map
