import { arrangeAsync } from "./arrange.js";
import { normalizeScore } from "./model.js";
import type {
  ArrangementOptions,
  ArrangementResult,
  SearchProgress,
} from "./arrange.js";
import type { Score } from "./model.js";
export interface MessagePortLike {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
}
export type WorkerRequest =
  | { type: "arrange"; id: number; score: Score; options: ArrangementOptions }
  | { type: "cancel"; id: number };
export type WorkerResponse =
  | { type: "result"; id: number; result: ArrangementResult }
  | { type: "progress"; id: number; progress: SearchProgress };
function cancelled(): ArrangementResult {
  return {
    status: "cancelled",
    diagnostics: ["Superseded or cancelled request"],
    stats: {
      strategy: "worker",
      frames: 0,
      expandedStates: 0,
      discardedCandidates: 0,
      dominatedStates: 0,
      exhaustive: false,
    },
  };
}
// The endpoint yields to the event loop about every SLICE_MS instead of every few steps: nested setTimeout(0) is
// clamped to at least 4 ms in browsers, which made long searches several times slower than a direct arrange().
// Cancel messages are still read between slices, and progress is posted once per slice.
const SLICE_MS = 12;
const host = globalThis as unknown as {
  performance?: { now(): number };
  setTimeout: (f: () => void, ms: number) => unknown;
};
const now = (): number => host.performance?.now() ?? Date.now();
const macrotask = (): Promise<void> =>
  new Promise((resolve) => {
    host.setTimeout(resolve, 0);
  });
/** Install on a dedicated worker global or compatible message port. Returns cleanup. */
export function installWorkerEndpoint(port: MessagePortLike): () => void {
  const jobs = new Map<number, { aborted: boolean }>();
  const listener = (event: { data: unknown }): void => {
    const data = event.data as Partial<WorkerRequest>;
    if (!data || !Number.isSafeInteger(data.id)) return;
    const id = data.id!;
    if (data.type === "cancel") {
      const token = jobs.get(id);
      if (token) token.aborted = true;
      return;
    }
    if (data.type !== "arrange" || !data.score || !data.options) return;
    const prior = jobs.get(id);
    if (prior) prior.aborted = true;
    const token = { aborted: false };
    jobs.set(id, token);
    let latest: SearchProgress | undefined,
      sliceStart = now();
    void arrangeAsync(
      data.score,
      { ...data.options, signal: token },
      {
        yieldEvery: 32,
        onProgress: (progress) => {
          latest = progress;
        },
        schedule: async () => {
          if (now() - sliceStart < SLICE_MS) return;
          if (!token.aborted && latest)
            port.postMessage({
              type: "progress",
              id,
              progress: latest,
            } satisfies WorkerResponse);
          await macrotask();
          sliceStart = now();
        },
      },
    ).then((result) => {
      if (jobs.get(id) === token) {
        jobs.delete(id);
        port.postMessage({
          type: "result",
          id,
          result,
        } satisfies WorkerResponse);
      }
    });
  };
  port.addEventListener("message", listener);
  return () => {
    for (const token of jobs.values()) token.aborted = true;
    jobs.clear();
    port.removeEventListener("message", listener);
  };
}
export interface ArrangementClient {
  arrange(
    score: Score,
    options?: ArrangementOptions,
    onProgress?: (progress: SearchProgress) => void,
  ): Promise<ArrangementResult>;
  cancel(): void;
  dispose(): void;
}
/** Latest request wins; superseded promises resolve cancelled and stale messages are ignored. */
export function createWorkerClient(port: MessagePortLike): ArrangementClient {
  let id = 0,
    disposed = false,
    pending:
      | {
          id: number;
          resolve: (r: ArrangementResult) => void;
          onProgress: ((p: SearchProgress) => void) | undefined;
        }
      | undefined;
  const listener = (e: { data: unknown }) => {
    const response = e.data as WorkerResponse;
    if (!response || response.id !== pending?.id) return;
    if (response.type === "progress") pending?.onProgress?.(response.progress);
    else if (response.type === "result") {
      const current = pending;
      pending = undefined;
      current?.resolve(response.result);
    }
  };
  port.addEventListener("message", listener);
  function cancel(): void {
    if (pending) {
      port.postMessage({
        type: "cancel",
        id: pending.id,
      } satisfies WorkerRequest);
      pending.resolve(cancelled());
      pending = undefined;
    }
  }
  return {
    arrange: (score, options = {}, onProgress) => {
      if (disposed) throw new Error("Worker client disposed");
      if (options.scoring || options.signal)
        throw new RangeError(
          "Worker options must be serializable; use client.cancel() and built-in costs",
        );
      cancel();
      const current = ++id;
      return new Promise((resolve) => {
        pending = { id: current, resolve, onProgress };
        try {
          port.postMessage({
            type: "arrange",
            id: current,
            score,
            options,
          } satisfies WorkerRequest);
        } catch (error) {
          pending = undefined;
          resolve({
            status: "invalid-input",
            diagnostics: [String(error)],
            stats: {
              strategy: "worker",
              frames: 0,
              expandedStates: 0,
              discardedCandidates: 0,
              dominatedStates: 0,
              exhaustive: false,
            },
          });
        }
      });
    },
    cancel,
    dispose: () => {
      cancel();
      disposed = true;
      port.removeEventListener("message", listener);
    },
  };
}
/** Recompute from an immutable original; never compound simplifications between levels. */
export function createArrangementSession(
  source: Score,
  options: { readonly cacheSize?: number } = {},
): {
  recompute: (options: ArrangementOptions) => Promise<ArrangementResult>;
  cancel: () => void;
  clearCache: () => void;
} {
  const original = normalizeScore(source),
    cache = new Map<string, ArrangementResult>(),
    size = options.cacheSize ?? 8;
  if (!Number.isSafeInteger(size) || size < 0)
    throw new RangeError("Invalid cache size");
  let active: { aborted: boolean } | undefined;
  const copy = (r: ArrangementResult): ArrangementResult =>
    JSON.parse(JSON.stringify(r)) as ArrangementResult;
  function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
        .join(",")}}`;
    return JSON.stringify(value);
  }
  return {
    recompute: async (input) => {
      if (active) active.aborted = true;
      const token = { aborted: false };
      active = token;
      const key = stable({
        ...input,
        signal: undefined,
        scoring: input.scoring?.id,
      });
      if (input.signal?.aborted) return cancelled();
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return copy(cached);
      }
      const signal = {
        get aborted() {
          return token.aborted || !!input.signal?.aborted;
        },
      };
      const result = await arrangeAsync(original, { ...input, signal });
      if (token.aborted) return cancelled();
      if (result.status === "success" && size) {
        cache.set(key, copy(result));
        while (cache.size > size) cache.delete(cache.keys().next().value!);
      }
      return result;
    },
    cancel: () => {
      if (active) active.aborted = true;
    },
    clearCache: () => cache.clear(),
  };
}
