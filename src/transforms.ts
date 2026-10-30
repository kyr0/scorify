import { transpose } from "@tonaljs/note";
import { transposePitch } from "./pitch.js";
import {
  normalizeScore,
  parsePitch,
  pitchString,
  validateScore,
} from "./model.js";
import type { Score, Edit } from "./model.js";
export interface TransformOptions {
  readonly interval?: string;
  readonly tempoScale?: number;
  readonly quarterBpm?: number;
}
export function transposeChordSymbol(symbol: string, interval: string): string {
  const m =
    /^([A-G](?:#{1,4}|b{1,4})?)([^/]*)(?:\/([A-G](?:#{1,4}|b{1,4})?))?$/.exec(
      symbol,
    );
  if (!m) throw new RangeError(`Unsupported chord symbol: ${symbol}`);
  const root = transpose(m[1]!, interval),
    bass = m[3] ? transpose(m[3], interval) : undefined;
  if (!root || (m[3] && !bass))
    throw new RangeError("Invalid chord transposition");
  return `${root}${m[2]}${bass ? `/${bass}` : ""}`;
}
export function transposeScore(
  score: Score,
  { interval }: { readonly interval: string },
): Score {
  const s = normalizeScore(score);
  if (!transpose("C", interval)) throw new RangeError("Invalid interval");
  const result: Score = {
    ...s,
    notes: s.notes.map((n) => ({
      ...n,
      pitch: parsePitch(transposePitch(pitchString(n.pitch), interval)),
    })),
    keyMap: s.keyMap.map((k) => ({
      ...k,
      tonic: transpose(k.tonic, interval),
    })),
    harmony: s.harmony.map((h) => ({
      ...h,
      candidates: h.candidates.map((c) => ({
        ...c,
        symbol: transposeChordSymbol(c.symbol, interval),
      })),
      ...(h.selected
        ? { selected: transposeChordSymbol(h.selected, interval) }
        : {}),
    })),
  };
  validateScore(result);
  return result;
}
export function retimeScore(
  score: Score,
  options: { readonly scale?: number; readonly quarterBpm?: number },
): Score {
  if ((options.scale === undefined) === (options.quarterBpm === undefined))
    throw new RangeError("Supply exactly one of scale or quarterBpm");
  const value = options.scale ?? options.quarterBpm!;
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError("Tempo must be positive and finite");
  const s = normalizeScore(score);
  const result = {
    ...s,
    tempoMap:
      options.quarterBpm !== undefined
        ? [{ at: [0, 1] as const, quarterBpm: value }]
        : s.tempoMap.map((t) => ({ ...t, quarterBpm: t.quarterBpm * value })),
  };
  validateScore(result);
  return result;
}
export function transformScore(
  score: Score,
  options: TransformOptions = {},
): { score: Score; edits: Edit[] } {
  if (options.tempoScale !== undefined && options.quarterBpm !== undefined)
    throw new RangeError("Cannot combine tempoScale and quarterBpm");
  let output = normalizeScore(score);
  const edits: Edit[] = [];
  if (options.interval !== undefined) {
    const next = transposeScore(output, { interval: options.interval });
    if (output.keyMap.length || output.harmony.length) {
      edits.push({
        kind: "transpose",
        sourceIds: [],
        outputIds: [],
        before: { keyMap: output.keyMap, harmony: output.harmony },
        after: { keyMap: next.keyMap, harmony: next.harmony },
        reason: `Global key and harmony interval ${options.interval}`,
        permission: "transform.interval",
      });
    }
    for (let i = 0; i < output.notes.length; i++) {
      const old = output.notes[i]!,
        n = next.notes[i]!;
      if (pitchString(old.pitch) !== pitchString(n.pitch))
        edits.push({
          kind: "transpose",
          sourceIds: [old.id],
          outputIds: [n.id],
          before: old.pitch,
          after: n.pitch,
          reason: `Global interval ${options.interval}`,
          permission: "transform.interval",
        });
    }
    output = next;
  }
  if (options.tempoScale !== undefined || options.quarterBpm !== undefined) {
    const old = output.tempoMap;
    output = retimeScore(
      output,
      options.tempoScale !== undefined
        ? { scale: options.tempoScale }
        : { quarterBpm: options.quarterBpm! },
    );
    edits.push({
      kind: "tempo",
      sourceIds: [],
      outputIds: [],
      before: old,
      after: output.tempoMap,
      reason: "Requested tempo transformation",
      permission:
        options.tempoScale !== undefined
          ? "transform.tempoScale"
          : "transform.quarterBpm",
    });
  }
  return { score: output, edits };
}
