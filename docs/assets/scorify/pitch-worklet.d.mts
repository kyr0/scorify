import { PitchTrackerOptions } from './pitch-detect.mjs';
export { PITCH_PROCESSOR_NAME } from './pitch-detect.mjs';

/** Tracker options a processor accepts; the sample rate is the context's. */
type PitchProcessorOptions = Omit<PitchTrackerOptions, "sampleRate">;
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
    registerProcessor(name: string, constructor: new (options?: {
        processorOptions?: PitchProcessorOptions;
    }) => ProcessorBase): void;
    sampleRate: number;
    currentFrame: number;
}
/**
 * Called automatically only in an AudioWorkletGlobalScope; testable with an injected host. The processor mixes its
 * input to mono, runs a pitch tracker on it and posts one `{type: "pitch", ...PitchReading, contextTime}` per hop. It
 * outputs silence. Messages: `{type: "configure", options}` restarts the tracker with new options, `{type: "reset"}`
 * forgets buffered audio, `{type: "stop"}` ends the processor.
 */
declare function installPitchWorklet(host: WorkletHost): void;

export { installPitchWorklet };
export type { PitchProcessorOptions };
//# sourceMappingURL=pitch-worklet.d.mts.map
