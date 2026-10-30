import { chordCandidates } from "./theory.js";
import { pitchToMidi } from "./pitch.js";
import { validateScore, pitchString, soundingNotes } from "./model.js";
import { addQ, subQ, q, mulQ, compareQ, keyQ, numberQ } from "./time.js";
import type { Score, HarmonySpan } from "./model.js";
import type { Q } from "./time.js";
export interface HarmonyOptions {
  readonly window?: Q;
  readonly respectProvided?: boolean;
  readonly maxWindows?: number;
}
/** Meter-aligned windows collect arpeggios; scores are heuristic ranks, not probabilities. */
export function analyzeHarmony(
  score: Score,
  options: HarmonyOptions = {},
): HarmonySpan[] {
  validateScore(score);
  if (options.window && compareQ(options.window, q(0)) <= 0)
    throw new RangeError("Harmony window must be positive");
  const max = options.maxWindows ?? 10000;
  if (!Number.isSafeInteger(max) || max < 1)
    throw new RangeError("Invalid window budget");
  const notes = soundingNotes(score);
  let end = q(0);
  for (const n of score.notes) {
    const e = addQ(n.onset, n.duration);
    if (compareQ(e, end) > 0) end = e;
  }
  for (const h of score.harmony) if (compareQ(h.end, end) > 0) end = h.end;
  const boundaries = new Map<string, Q>([
    [keyQ(q(0)), q(0)],
    [keyQ(end), end],
  ]);
  let at = q(0),
    count = 0;
  while (compareQ(at, end) < 0) {
    if (++count > max) throw new RangeError("Harmony window budget exceeded");
    const m = [...score.meterMap]
      .reverse()
      .find((m) => compareQ(m.at, at) <= 0)!;
    let next = addQ(
      at,
      options.window ?? mulQ(q(m.numerator), q(4, m.denominator)),
    );
    const change = score.meterMap.find(
      (m) => compareQ(m.at, at) > 0 && compareQ(m.at, next) < 0,
    );
    if (change) next = change.at;
    if (compareQ(next, end) > 0) next = end;
    boundaries.set(keyQ(next), next);
    at = next;
  }
  const provided =
    options.respectProvided === false
      ? []
      : score.harmony.filter((h) => h.provenance === "provided");
  for (const h of provided) {
    boundaries.set(keyQ(h.onset), h.onset);
    boundaries.set(keyQ(h.end), h.end);
  }
  const times = [...boundaries.values()].sort(compareQ),
    result: HarmonySpan[] = [];
  let previousRoot = "";
  for (let i = 0; i < times.length - 1; i++) {
    const onset = times[i]!,
      stop = times[i + 1]!;
    const authority = provided.find(
      (h) => compareQ(h.onset, onset) <= 0 && compareQ(h.end, stop) >= 0,
    );
    if (authority) {
      result.push({
        ...authority,
        id: `${authority.id}@${keyQ(onset)}`,
        onset,
        end: stop,
        candidates: authority.candidates.map((c) => ({ ...c })),
        evidenceNoteIds: [...authority.evidenceNoteIds],
      });
      previousRoot = authority.selected?.match(/^[A-G][#b]*/)?.[0] ?? "";
      continue;
    }
    const evidence = notes.filter(
      (n) => compareQ(n.onset, stop) < 0 && compareQ(n.end, onset) > 0,
    );
    const pitches = evidence.map((n) => pitchString(n.pitch));
    const pcs = new Set(pitches.map((p) => pitchToMidi(p) % 12));
    const symbols = pcs.size >= 3 ? chordCandidates(pitches) : [];
    const candidates = symbols
      .map((symbol) => {
        const root = symbol.match(/^[A-G][#b]*/)?.[0] ?? "";
        const strong = evidence.filter(
          (n) =>
            !compareQ(n.onset, onset) &&
            pitchString(n.pitch).replace(/-?\d+$/, "") === root,
        ).length;
        const weight = evidence.reduce(
          (a, n) =>
            a +
            Math.max(
              0,
              numberQ(
                subQ(
                  compareQ(n.end, stop) < 0 ? n.end : stop,
                  compareQ(n.onset, onset) > 0 ? n.onset : onset,
                ),
              ),
            ),
          0,
        );
        return {
          symbol,
          score:
            1 +
            (symbol.includes("/") ? 0 : 0.15) +
            strong * 0.1 +
            (root === previousRoot ? 0.05 : 0) +
            Math.min(weight, 16) * 0.001,
        };
      })
      .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    const selected =
      candidates.length === 1 ||
      (candidates[0] &&
        candidates[1] &&
        candidates[0].score - candidates[1].score >= 0.15)
        ? candidates[0]?.symbol
        : undefined;
    result.push({
      id: `h@${keyQ(onset)}`,
      onset,
      end: stop,
      candidates,
      ...(selected ? { selected } : {}),
      evidenceNoteIds: evidence.flatMap((n) => n.noteIds),
      provenance: "inferred",
      method: "scorify-window-harmony-1",
    });
    previousRoot = selected?.match(/^[A-G][#b]*/)?.[0] ?? "";
  }
  return result;
}
