import { createScore, parsePitch, validateMeterMap } from "./model.js";
import {
  q,
  keyQ,
  compareQ,
  subQ,
  addQ,
  quartersAtSeconds,
  secondsAt,
  validateTempoMap,
} from "./time.js";
import type { Score, Edit, Meter, NoteEvent } from "./model.js";
import type { Q, Tempo } from "./time.js";
export interface PerformedNote {
  readonly id: string;
  readonly pitch: string;
  readonly onsetSeconds: number;
  readonly durationSeconds: number;
  readonly partId: string;
  readonly voiceId: string;
  readonly role?: NoteEvent["role"];
}
export interface QuantizeOptions {
  readonly tempoMap: readonly Tempo[];
  readonly meterMap: readonly Meter[];
  readonly subdivisions?: readonly number[];
  readonly toleranceSeconds?: number;
  readonly maxCandidatesPerNote?: number;
  readonly maxStates?: number;
  readonly maxExpandedStates?: number;
}
export interface TimingAlternative {
  readonly onset: Q;
  readonly duration: Q;
  readonly errorSeconds: number;
}
export type QuantizeResult =
  | {
      readonly status: "success";
      readonly score: Score;
      readonly original: readonly PerformedNote[];
      readonly edits: readonly Edit[];
      readonly alternatives: Readonly<
        Record<string, readonly TimingAlternative[]>
      >;
      readonly optimality: "proven-in-model" | "best-found";
      readonly expandedStates: number;
    }
  | {
      readonly status: "invalid-input" | "infeasible" | "search-exhausted";
      readonly diagnostics: readonly string[];
    };
class QuantizationBudget extends Error {}
/** Bounded joint on/off grid search with known tempo/meter; preserves voice overlap relations. */
export function quantizePerformance(
  input: readonly PerformedNote[],
  options: QuantizeOptions,
): QuantizeResult {
  try {
    validateTempoMap(options.tempoMap);
    validateMeterMap(options.meterMap);
    const divisions = options.subdivisions ?? [1, 2, 3, 4, 6, 8],
      tolerance = options.toleranceSeconds ?? 0.08,
      cap = options.maxCandidatesPerNote ?? 64,
      maxStates = options.maxStates ?? 256,
      maxExpanded = options.maxExpandedStates ?? 200000;
    if (
      !divisions.length ||
      divisions.some((d) => !Number.isSafeInteger(d) || d < 1 || d > 1024) ||
      !Number.isFinite(tolerance) ||
      tolerance < 0 ||
      [cap, maxStates, maxExpanded].some(
        (n) => !Number.isSafeInteger(n) || n < 1,
      )
    )
      throw new RangeError("Invalid quantization bounds");
    const ids = new Set<string>();
    for (const n of input) {
      parsePitch(n.pitch);
      if (
        !n.id ||
        ids.has(n.id) ||
        !n.partId ||
        !n.voiceId ||
        !Number.isFinite(n.onsetSeconds) ||
        n.onsetSeconds < 0 ||
        !Number.isFinite(n.durationSeconds) ||
        n.durationSeconds <= 0 ||
        !Number.isFinite(n.onsetSeconds + n.durationSeconds)
      )
        throw new RangeError("Invalid performed note");
      ids.add(n.id);
    }
    const notes = [...input].sort(
      (a, b) => a.onsetSeconds - b.onsetSeconds || a.id.localeCompare(b.id),
    );
    let truncated = false,
      expanded = 0;
    const tick = () => {
      if (++expanded > maxExpanded)
        throw new QuantizationBudget("Quantization expansion budget exceeded");
    };
    function candidates(seconds: number): Q[] {
      const result = new Map<string, Q>(),
        lo = quartersAtSeconds(
          Math.max(0, seconds - tolerance),
          options.tempoMap,
        ),
        hi = quartersAtSeconds(seconds + tolerance, options.tempoMap);
      for (let i = 0; i < options.meterMap.length; i++) {
        const m = options.meterMap[i]!,
          next = options.meterMap[i + 1],
          origin = m.at[0] / m.at[1],
          stop = next ? next.at[0] / next.at[1] : Infinity;
        if (hi < origin || lo >= stop) continue;
        for (const d of divisions) {
          const first = Math.max(0, Math.ceil((lo - origin) * d - 1e-9)),
            last = Math.floor((Math.min(hi, stop) - origin) * d + 1e-9);
          if (last - first > 4096)
            throw new QuantizationBudget(
              "Quantization grid too broad; reduce tolerance/subdivisions",
            );
          for (let k = first; k <= last; k++) {
            tick();
            const at = addQ(m.at, q(k, d));
            if (next && compareQ(at, next.at) > 0) continue;
            if (
              Math.abs(secondsAt(at, options.tempoMap) - seconds) <=
              tolerance + 1e-9
            )
              result.set(keyQ(at), at);
          }
        }
      }
      return [...result.values()].sort(compareQ);
    }
    const alternatives: Record<string, TimingAlternative[]> = Object.create(
      null,
    ) as Record<string, TimingAlternative[]>;
    for (const n of notes) {
      const list: TimingAlternative[] = [];
      const onsets = candidates(n.onsetSeconds);
      const ends = candidates(n.onsetSeconds + n.durationSeconds);
      for (const onset of onsets)
        for (const end of ends) {
          tick();
          if (compareQ(end, onset) > 0)
            list.push({
              onset,
              duration: subQ(end, onset),
              errorSeconds:
                Math.abs(secondsAt(onset, options.tempoMap) - n.onsetSeconds) +
                Math.abs(
                  secondsAt(end, options.tempoMap) -
                    n.onsetSeconds -
                    n.durationSeconds,
                ),
            });
        }
      list.sort(
        (a, b) =>
          a.errorSeconds - b.errorSeconds ||
          compareQ(a.onset, b.onset) ||
          compareQ(a.duration, b.duration),
      );
      if (list.length > cap) truncated = true;
      alternatives[n.id] = list.slice(0, cap);
      if (!list.length)
        return {
          status: "infeasible",
          diagnostics: [
            `No positive-duration grid candidate within tolerance for ${n.id}`,
          ],
        };
    }
    interface State {
      chosen: TimingAlternative[];
      cost: number;
    }
    let states: State[] = [{ chosen: [], cost: 0 }];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]!,
        next: State[] = [];
      for (const state of states)
        for (const c of alternatives[n.id]!) {
          tick();
          let valid = true;
          for (let j = 0; j < i; j++) {
            tick();
            const p = notes[j]!,
              pc = state.chosen[j]!;
            if (
              Math.abs(p.onsetSeconds - n.onsetSeconds) < 1e-9 &&
              compareQ(pc.onset, c.onset)
            ) {
              valid = false;
              break;
            }
            if (p.partId !== n.partId || p.voiceId !== n.voiceId) continue;
            const relation =
                n.onsetSeconds - (p.onsetSeconds + p.durationSeconds),
              quant = compareQ(c.onset, addQ(pc.onset, pc.duration));
            if (
              (relation >= -1e-9 && quant < 0) ||
              (relation < -1e-9 && quant >= 0) ||
              (p.onsetSeconds < n.onsetSeconds &&
                compareQ(pc.onset, c.onset) >= 0)
            ) {
              valid = false;
              break;
            }
          }
          if (valid)
            next.push({
              chosen: [...state.chosen, c],
              cost: state.cost + c.errorSeconds,
            });
        }
      next.sort((a, b) => a.cost - b.cost);
      if (next.length > maxStates) truncated = true;
      states = next.slice(0, maxStates);
      if (!states.length)
        return {
          status: truncated ? "search-exhausted" : "infeasible",
          diagnostics: [
            "No timing path preserves simultaneous attacks and voice overlap relations",
          ],
        };
    }
    const best = states[0]!,
      edits: Edit[] = [];
    const output = notes.map((n, i) => {
      const t = best.chosen[i]!;
      edits.push({
        kind: "quantize",
        sourceIds: [n.id],
        outputIds: [n.id],
        before: {
          onsetSeconds: n.onsetSeconds,
          durationSeconds: n.durationSeconds,
        },
        after: { onset: t.onset, duration: t.duration },
        reason: "Known-map bounded timing search",
        permission: "quantizePerformance",
      });
      return {
        id: n.id,
        partId: n.partId,
        voiceId: n.voiceId,
        pitch: parsePitch(n.pitch),
        onset: t.onset,
        duration: t.duration,
        ...(n.role ? { role: n.role } : {}),
        sourceIds: [n.id],
      };
    });
    return {
      status: "success",
      score: createScore(output, {
        tempoMap: options.tempoMap,
        meterMap: options.meterMap,
      }),
      original: input.map((n) => ({ ...n })),
      edits,
      alternatives,
      optimality: truncated ? "best-found" : "proven-in-model",
      expandedStates: expanded,
    };
  } catch (error) {
    return {
      status:
        error instanceof QuantizationBudget
          ? "search-exhausted"
          : "invalid-input",
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }
}
