/// <reference lib="dom" />
import { validatePerformance } from "./performance.js";
import type { PerformancePlan } from "./performance.js";
import { resolveEffects } from "./audio-effects.js";
import type { EffectSettings } from "./audio-effects.js";
import type { SynthOptions, SynthesisStats } from "./audio-dsp.js";
export * from "./performance.js";
export * from "./audio-dsp.js";
export * from "./audio-guide.js";
export type {
  HumanizeOptions,
  StrumOptions,
  StrumStroke,
  PerformanceOptions,
  PerformanceNote,
  PerformedStroke,
  PerformancePlan,
  PerformanceResult,
} from "./performance.js";
export interface PlaybackEnd {
  readonly reason: "ended" | "stopped" | "disposed" | "error";
  readonly stats?: SynthesisStats;
}
export interface PlaybackHandle {
  readonly id: number;
  readonly startTime: number;
  readonly finished: Promise<PlaybackEnd>;
  stop(): void;
}
export interface PlayOptions extends SynthOptions {
  readonly when?: number;
  readonly leadTime?: number;
  readonly tailSeconds?: number;
  /** Post effects for this playback; the samples equal renderPerformance with the same effects. */
  readonly effects?: EffectSettings;
}
export interface AudioPlayer {
  readonly node: AudioWorkletNode;
  play(
    performance: PerformancePlan,
    options?: PlayOptions,
  ): Promise<PlaybackHandle>;
  stop(): void;
  /** Switch effects of the current playback (ramped; a switched-off delay or reverb rings out). */
  setEffects(effects: EffectSettings): void;
  dispose(): void;
}
/** An AudioWorkletNode running scorify's effect chain on whatever is connected to it. */
export interface EffectsNode {
  readonly node: AudioWorkletNode;
  /** Switch effects or change the echo time while audio runs (ramped). */
  set(effects: EffectSettings): void;
  dispose(): void;
}
interface Waiter {
  resolve: (value: number) => void;
  reject: (reason: Error) => void;
}
interface Request {
  id: number;
  waiter: Waiter | undefined;
  cancelled: boolean;
  finish: (result: PlaybackEnd) => void;
  finished: Promise<PlaybackEnd>;
}
const modules = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();
function abortError(): Error {
  return new DOMException("Playback request cancelled", "AbortError");
}
/** Loads the worklet module once per context and URL. */
async function loadWorklet(context: BaseAudioContext, workletUrl?: string | URL): Promise<void> {
  const url = String(workletUrl ?? new URL("./audio-worklet.mjs", import.meta.url));
  let loaded = modules.get(context);
  if (!loaded) {
    loaded = new Map();
    modules.set(context, loaded);
  }
  let module = loaded.get(url);
  if (!module) {
    module = context.audioWorklet.addModule(url);
    loaded.set(url, module);
    module.catch(() => loaded!.delete(url));
  }
  await module;
}
/**
 * Routes audio through scorify's effects in an AudioWorklet (on an AudioContext or OfflineAudioContext): connect
 * sources to `node`; it is connected to `destination` (default: the context's). Serve audio-worklet.mjs from your
 * app's origin and pass its URL when it is not next to this module.
 */
export async function createEffectsNode(
  context: BaseAudioContext,
  options: {
    readonly workletUrl?: string | URL;
    readonly destination?: AudioNode;
    readonly effects?: EffectSettings;
  } = {},
): Promise<EffectsNode> {
  if (context.state === "closed") throw new Error("AudioContext is closed");
  const effects = resolveEffects(options.effects ?? {});
  await loadWorklet(context, options.workletUrl);
  const node = new AudioWorkletNode(context, "scorify-effects-v1", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: { effects },
  });
  node.connect(options.destination ?? context.destination);
  let disposed = false;
  return {
    node,
    set: (next) => {
      resolveEffects(next);
      if (!disposed) node.port.postMessage({ type: "effects", effects: next });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      node.port.postMessage({ type: "dispose" });
      node.port.close();
      node.disconnect();
    },
  };
}
/** User owns the AudioContext. Call play() from a user gesture when autoplay is restricted. */
export async function createAudioPlayer(
  context: AudioContext,
  options: {
    readonly workletUrl?: string | URL;
    readonly destination?: AudioNode;
  } = {},
): Promise<AudioPlayer> {
  if (context.state === "closed") throw new Error("AudioContext is closed");
  await loadWorklet(context, options.workletUrl);
  const node = new AudioWorkletNode(context, "scorify-plucked-strings-v1", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.connect(options.destination ?? context.destination);
  const requests = new Map<number, Request>();
  let generation = 0,
    disposed = false;
  let processorFailure: Error | undefined;
  const finish = (r: Request, result: PlaybackEnd) => {
    r.finish(result);
    requests.delete(r.id);
  };
  const fail = (r: Request, error: Error) => {
    r.waiter?.reject(error);
    r.waiter = undefined;
    finish(r, { reason: "error" });
  };
  node.port.onmessage = (event) => {
    const m = event.data as {
        type: string;
        id: number;
        when?: number;
        message?: string;
        reason?: "ended" | "stopped";
        stats?: SynthesisStats;
      },
      r = requests.get(m.id);
    if (!r) return;
    if (m.type === "error") {
      fail(r, new Error(m.message ?? "Audio processor error"));
      return;
    }
    if (m.type === "ended") {
      r.waiter?.reject(abortError());
      r.waiter = undefined;
      finish(r, {
        reason: m.reason ?? "ended",
        ...(m.stats ? { stats: m.stats } : {}),
      });
      return;
    }
    if (!r.cancelled && (m.type === "ready" || m.type === "started")) {
      r.waiter?.resolve(m.when ?? 0);
      r.waiter = undefined;
    }
  };
  node.onprocessorerror = () => {
    processorFailure = new Error(
      "AudioWorklet processor failed; create a new player",
    );
    for (const r of [...requests.values()]) fail(r, processorFailure);
  };
  const onState = () => {
    if (context.state === "closed")
      for (const r of [...requests.values()])
        fail(r, new Error("AudioContext closed during playback"));
  };
  context.addEventListener("statechange", onState);
  function stop(): void {
    generation++;
    for (const r of requests.values()) {
      r.cancelled = true;
      r.waiter?.reject(abortError());
      r.waiter = undefined;
    }
    if (!disposed) node.port.postMessage({ type: "stop" });
  }
  function wait(r: Request): Promise<number> {
    return new Promise((resolve, reject) => {
      r.waiter = { resolve, reject };
    });
  }
  return {
    node,
    play: async (plan, playOptions = {}) => {
      if (disposed) throw new Error("Audio player disposed");
      if (processorFailure) throw processorFailure;
      plan = structuredClone(plan);
      playOptions = structuredClone(playOptions);
      const checked = validatePerformance(plan);
      if (!checked.valid)
        throw new RangeError(
          `Invalid performance: ${checked.diagnostics.join("; ")}`,
        );
      const leadTime = playOptions.leadTime ?? 0.05;
      if (!Number.isFinite(leadTime) || leadTime < 0.01 || leadTime > 10)
        throw new RangeError("Playback leadTime must be in [0.01,10]");
      stop();
      const id = generation;
      await context.resume();
      if (disposed || id !== generation) throw abortError();
      if (processorFailure) throw processorFailure;
      let resolveEnd!: (result: PlaybackEnd) => void;
      const finished = new Promise<PlaybackEnd>((resolve) => {
        resolveEnd = resolve;
      });
      const r: Request = {
        id,
        waiter: undefined,
        cancelled: false,
        finish: resolveEnd,
        finished,
      };
      requests.set(id, r);
      try {
        const ready = wait(r);
        const {
          when,
          leadTime: _lead,
          tailSeconds,
          effects,
          ...synthOptions
        } = playOptions;
        if (effects) resolveEffects(effects);
        node.port.postMessage({
          type: "load",
          id,
          input: {
            strings: plan.strings,
            events: plan.events.map((e) => ({
              id: e.id,
              stringId: e.stringId,
              frequency: e.frequency,
              onsetSeconds: e.onsetSeconds,
              endSeconds: e.endSeconds,
              excitationSeed: e.excitationSeed,
              detuneCents: e.detuneCents,
              velocity: e.velocity,
              brightness: e.brightness,
              pluckPosition: e.pluckPosition,
              decaySeconds: e.decaySeconds,
              muted: e.muted,
            })),
            durationSeconds: plan.durationSeconds,
          },
          options: { preset: plan.preset, ...synthOptions },
          tailSeconds: tailSeconds ?? 0.35,
          ...(effects ? { effects } : {}),
        });
        await ready;
        if (r.cancelled || id !== generation) throw abortError();
        const startTime = when ?? context.currentTime + leadTime;
        if (
          !Number.isFinite(startTime) ||
          startTime < context.currentTime + 0.005
        )
          throw new RangeError(
            "Explicit start deadline already passed/too close",
          );
        const started = wait(r);
        node.port.postMessage({ type: "start", id, when: startTime });
        const actual = await started;
        return {
          id,
          startTime: actual,
          finished,
          stop: () => {
            if (id === generation) stop();
          },
        };
      } catch (error) {
        r.waiter = undefined;
        requests.delete(id);
        r.finish({ reason: r.cancelled ? "stopped" : "error" });
        if (id === generation) node.port.postMessage({ type: "stop" });
        throw error;
      }
    },
    stop,
    setEffects: (effects) => {
      resolveEffects(effects);
      if (!disposed) node.port.postMessage({ type: "effects", effects });
    },
    dispose: () => {
      if (disposed) return;
      stop();
      disposed = true;
      node.port.postMessage({ type: "dispose" });
      for (const r of [...requests.values()]) finish(r, { reason: "disposed" });
      node.port.onmessage = null;
      node.port.close();
      node.onprocessorerror = null;
      node.disconnect();
      context.removeEventListener("statechange", onState);
    },
  };
}
