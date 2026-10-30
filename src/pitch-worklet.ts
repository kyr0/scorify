import { createPitchTracker, PITCH_PROCESSOR_NAME } from "./pitch-detect.js";
import type { PitchTracker, PitchTrackerOptions } from "./pitch-detect.js";
export { PITCH_PROCESSOR_NAME };
/** Tracker options a processor accepts; the sample rate is the context's. */
export type PitchProcessorOptions = Omit<PitchTrackerOptions, "sampleRate">;
interface Port {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}
interface ProcessorBase {
  readonly port: Port;
}
interface WorkletHost {
  AudioWorkletProcessor: new (options?: unknown) => ProcessorBase;
  registerProcessor(
    name: string,
    constructor: new (options?: {
      processorOptions?: PitchProcessorOptions;
    }) => ProcessorBase,
  ): void;
  sampleRate: number;
  currentFrame: number;
}
/**
 * Called automatically only in an AudioWorkletGlobalScope; testable with an injected host. The processor mixes its
 * input to mono, runs a pitch tracker on it and posts one `{type: "pitch", ...PitchReading, contextTime}` per hop. It
 * outputs silence. Messages: `{type: "configure", options}` restarts the tracker with new options, `{type: "reset"}`
 * forgets buffered audio, `{type: "stop"}` ends the processor.
 */
export function installPitchWorklet(host: WorkletHost): void {
  class Processor extends host.AudioWorkletProcessor {
    tracker: PitchTracker;
    mono = new Float32Array(128);
    /** Frames pushed into the current tracker; a reading's frame counts from the same origin. */
    consumed = 0;
    stopped = false;
    constructor(options?: { processorOptions?: PitchProcessorOptions }) {
      super(options);
      this.tracker = createPitchTracker({
        ...options?.processorOptions,
        sampleRate: host.sampleRate,
      });
      this.port.onmessage = (e) => {
        const m = e.data as { type?: string; options?: PitchProcessorOptions };
        try {
          if (m.type === "configure") {
            this.tracker = createPitchTracker({
              ...m.options,
              sampleRate: host.sampleRate,
            });
            this.consumed = 0;
            this.port.postMessage({ type: "ready", options: this.tracker.options });
          } else if (m.type === "reset") this.tracker.reset();
          else if (m.type === "stop") {
            this.stopped = true;
            this.port.close();
          }
        } catch (error) {
          this.port.postMessage({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      };
      this.port.postMessage({ type: "ready", options: this.tracker.options });
    }
    process(inputs: Float32Array[][]): boolean {
      if (this.stopped) return false;
      const channels = inputs[0] ?? [];
      if (!channels.length || !channels[0]) return true;
      const length = channels[0].length;
      if (this.mono.length !== length) this.mono = new Float32Array(length);
      const mono = this.mono;
      mono.fill(0);
      for (const channel of channels)
        for (let i = 0; i < length; i++) mono[i] = mono[i]! + channel[i]! / channels.length;
      // This block's first sample is context frame currentFrame and tracker frame `base`.
      const base = this.consumed;
      this.consumed += length;
      for (const reading of this.tracker.push(mono))
        this.port.postMessage({
          type: "pitch",
          ...reading,
          contextTime: (host.currentFrame + reading.frame - base) / host.sampleRate,
        });
      return true;
    }
  }
  host.registerProcessor(PITCH_PROCESSOR_NAME, Processor);
}
const host = globalThis as unknown as WorkletHost;
if (
  typeof host.AudioWorkletProcessor === "function" &&
  typeof host.registerProcessor === "function"
)
  installPitchWorklet(host);
