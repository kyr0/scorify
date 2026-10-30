import { PluckedStringSynth } from "./audio-dsp.js";
import { EffectChain, effectsTailSeconds, resolveEffects } from "./audio-effects.js";
import type { EffectSettings, ResolvedEffects } from "./audio-effects.js";
import type { SynthesisInput, SynthOptions } from "./audio/types.js";
export const AUDIO_PROCESSOR_NAME = "scorify-plucked-strings-v1";
/** Effects for any audio routed through an AudioWorkletNode (see createEffectsNode in scorify/audio). */
export const EFFECTS_PROCESSOR_NAME = "scorify-effects-v1";
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
  registerProcessor(name: string, constructor: new () => ProcessorBase): void;
  sampleRate: number;
  currentFrame: number;
}
interface Loaded {
  id: number;
  engine: PluckedStringSynth;
  /** Post effects of this job: a fresh chain from its start, so its samples equal renderPerformance with them. */
  chain: EffectChain | undefined;
  start: number;
  end: number;
  tail: number;
  fadeEnd: number | null;
}
/** Called automatically only in an AudioWorkletGlobalScope; testable with an injected host. */
export function installAudioWorklet(host: WorkletHost): void {
  class Processor extends host.AudioWorkletProcessor {
    active: Loaded | undefined;
    pending: Loaded | undefined;
    disposed = false;
    constructor() {
      super();
      this.port.onmessage = (e) => {
        const m = e.data as {
          type?: string;
          id?: number;
          input?: SynthesisInput;
          options?: SynthOptions;
          tailSeconds?: number;
          when?: number;
          effects?: EffectSettings;
        };
        try {
          if (m.type === "load") {
            if (!Number.isSafeInteger(m.id) || m.id! < 1 || !m.input)
              throw new RangeError("Invalid load");
            if (this.pending) {
              this.finish(this.pending, "stopped");
              this.pending = undefined;
            }
            const tail = m.tailSeconds ?? 0.35;
            if (!Number.isFinite(tail) || tail < 0 || tail > 30)
              throw new RangeError("Invalid tail");
            const effects = m.effects ? resolveEffects(m.effects) : undefined,
              wet = !!effects && (effects.saturation || effects.delay || effects.reverb);
            this.pending = {
              id: m.id!,
              engine: new PluckedStringSynth(
                m.input,
                host.sampleRate,
                m.options,
              ),
              chain: wet ? new EffectChain(host.sampleRate, effects) : undefined,
              start: Infinity,
              end: Infinity,
              tail: tail + (wet ? effectsTailSeconds(effects) : 0),
              fadeEnd: null,
            };
            this.port.postMessage({ type: "ready", id: m.id });
          } else if (m.type === "effects") {
            // Live switching for the playing job: a chain is added if there was none; its tail extends the end.
            const effects = resolveEffects(m.effects ?? {});
            for (const job of [this.active, this.pending]) {
              if (!job) continue;
              if (job.chain) job.chain.set(effects);
              else job.chain = new EffectChain(host.sampleRate, effects);
              this.extend(job, job.chain.settings);
            }
          } else if (m.type === "start") {
            if (!this.pending || this.pending.id !== m.id) return;
            const start = Math.ceil(m.when! * host.sampleRate);
            if (!Number.isSafeInteger(start) || start < host.currentFrame)
              throw new RangeError("Audio start deadline missed");
            this.pending.start = start;
            this.pending.end =
              start +
              Math.ceil(
                (this.pending.engine.input.durationSeconds +
                  this.pending.tail) *
                  host.sampleRate,
              );
          } else if (m.type === "stop") {
            if (this.pending) {
              this.finish(this.pending, "stopped");
              this.pending = undefined;
            }
            if (this.active) {
              this.active.engine.stop();
              this.active.fadeEnd =
                host.currentFrame +
                Math.max(1, Math.round(0.01 * host.sampleRate));
            }
          } else if (m.type === "dispose") {
            this.disposed = true;
            this.active = undefined;
            this.pending = undefined;
            this.port.close();
          }
        } catch (error) {
          this.port.postMessage({
            type: "error",
            id: m.id,
            message: error instanceof Error ? error.message : String(error),
          });
          if (this.pending?.id === m.id) this.pending = undefined;
        }
      };
    }
    extend(job: Loaded, effects: ResolvedEffects): void {
      if (job.start === Infinity) return;
      const end =
        job.start +
        Math.ceil(
          (job.engine.input.durationSeconds + job.tail + effectsTailSeconds(effects)) * host.sampleRate,
        );
      if (end > job.end && job.fadeEnd === null) job.end = end;
    }
    finish(job: Loaded, reason: "ended" | "stopped"): void {
      this.port.postMessage({
        type: "ended",
        id: job.id,
        reason,
        stats: job.engine.stats,
      });
    }
    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      if (this.disposed) return false;
      const output = outputs[0],
        left = output?.[0],
        right = output?.[1];
      if (!left || !right) return true;
      left.fill(0);
      right.fill(0);
      let offset = 0;
      while (offset < left.length) {
        const absolute = host.currentFrame + offset;
        if (this.pending && this.pending.start <= absolute) {
          if (this.active) this.finish(this.active, "stopped");
          this.active = this.pending;
          this.pending = undefined;
          this.port.postMessage({
            type: "started",
            id: this.active.id,
            when: this.active.start / host.sampleRate,
          });
        }
        if (
          this.active &&
          absolute >= Math.min(this.active.end, this.active.fadeEnd ?? Infinity)
        ) {
          this.finish(
            this.active,
            this.active.fadeEnd === null ? "ended" : "stopped",
          );
          this.active = undefined;
          continue;
        }
        const stop = Math.min(
            host.currentFrame + left.length,
            this.pending?.start ?? Infinity,
            this.active?.end ?? Infinity,
            this.active?.fadeEnd ?? Infinity,
          ),
          count = stop - absolute;
        if (count <= 0) break;
        if (this.active) {
          this.active.engine.process(left, right, offset, count);
          this.active.chain?.process(left, right, offset, count);
          if (this.active.fadeEnd !== null) {
            const length = Math.max(1, Math.round(0.01 * host.sampleRate));
            for (let i = offset; i < offset + count; i++) {
              const gain = Math.max(
                0,
                Math.min(
                  1,
                  (this.active.fadeEnd - host.currentFrame - i) / length,
                ),
              );
              left[i] = left[i]! * gain;
              right[i] = right[i]! * gain;
            }
          }
        }
        offset += count;
      }
      // Resolve a completion exactly on a render-quantum boundary without an extra quantum.
      if (
        this.active &&
        host.currentFrame + left.length >=
          Math.min(this.active.end, this.active.fadeEnd ?? Infinity)
      ) {
        this.finish(
          this.active,
          this.active.fadeEnd === null ? "ended" : "stopped",
        );
        this.active = undefined;
      }
      return true;
    }
  }
  host.registerProcessor(AUDIO_PROCESSOR_NAME, Processor);
}
/**
 * The effects processor: stereo input (a mono input is used on both sides) through one EffectChain to a stereo
 * output. `processorOptions.effects` sets it up; `{ type: "effects", effects }` switches effects while it runs;
 * `{ type: "dispose" }` ends it. It keeps running without input, so tails ring out.
 */
export function installEffectsWorklet(host: WorkletHost): void {
  class Effects extends host.AudioWorkletProcessor {
    chain: EffectChain;
    disposed = false;
    constructor(options?: unknown) {
      super(options);
      const initial = (options as { processorOptions?: { effects?: EffectSettings } } | undefined)?.processorOptions?.effects;
      this.chain = new EffectChain(host.sampleRate, initial ?? {});
      this.port.onmessage = (e) => {
        const m = e.data as { type?: string; effects?: EffectSettings };
        try {
          if (m.type === "effects") this.chain.set(m.effects ?? {});
          else if (m.type === "dispose") {
            this.disposed = true;
            this.port.close();
          }
        } catch (error) {
          this.port.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
      };
    }
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      if (this.disposed) return false;
      const left = outputs[0]?.[0],
        right = outputs[0]?.[1];
      if (!left || !right) return true;
      const input = inputs[0] ?? [],
        inL = input[0],
        inR = input[1] ?? inL;
      if (inL) left.set(inL);
      else left.fill(0);
      if (inR) right.set(inR);
      else right.fill(0);
      this.chain.process(left, right);
      return true;
    }
  }
  host.registerProcessor(EFFECTS_PROCESSOR_NAME, Effects);
}
const host = globalThis as unknown as WorkletHost;
if (
  typeof host.AudioWorkletProcessor === "function" &&
  typeof host.registerProcessor === "function"
) {
  installAudioWorklet(host);
  installEffectsWorklet(host);
}
