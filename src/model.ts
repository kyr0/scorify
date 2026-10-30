import { pitchToMidi, transposePitch } from "./pitch.js";
import {
  q,
  normalizeQ,
  compareQ,
  addQ,
  keyQ,
  numberQ,
  validateTempoMap,
} from "./time.js";
import type { Q, Tempo } from "./time.js";
export * from "./time.js";
export interface Pitch {
  readonly step: "C" | "D" | "E" | "F" | "G" | "A" | "B";
  readonly alter: number;
  readonly octave: number;
}
export interface Part {
  readonly id: string;
  readonly name?: string;
  readonly voices: readonly string[];
  readonly writtenToSounding?: string;
}
export interface NoteEvent {
  readonly id: string;
  readonly onset: Q;
  readonly duration: Q;
  readonly pitch: Pitch;
  readonly partId: string;
  readonly voiceId: string;
  readonly role?: "melody" | "bass" | "harmony" | "ornament" | "unknown";
  readonly importance?: number;
  readonly locked?: {
    readonly pitch?: boolean;
    readonly onset?: boolean;
    readonly duration?: boolean;
    readonly keep?: boolean;
  };
  readonly tieGroupId?: string;
  readonly gateDuration?: Q;
  readonly techniques?: readonly string[];
  readonly sourceIds?: readonly string[];
}
export interface RestEvent {
  readonly id: string;
  readonly onset: Q;
  readonly duration: Q;
  readonly partId: string;
  readonly voiceId: string;
}
export interface Meter {
  readonly at: Q;
  readonly numerator: number;
  readonly denominator: number;
  readonly grouping?: readonly number[];
}
export interface Key {
  readonly at: Q;
  readonly tonic: string;
  readonly mode: string;
}
export interface HarmonyCandidate {
  readonly symbol: string;
  readonly score: number;
}
export interface HarmonySpan {
  readonly id: string;
  readonly onset: Q;
  readonly end: Q;
  readonly candidates: readonly HarmonyCandidate[];
  readonly selected?: string;
  readonly evidenceNoteIds: readonly string[];
  readonly provenance: "provided" | "inferred";
  readonly method: string;
}
export interface Score {
  readonly schemaVersion: 1;
  readonly temperament: "12-TET";
  readonly concertAHz: number;
  readonly notes: readonly NoteEvent[];
  readonly rests: readonly RestEvent[];
  readonly parts: readonly Part[];
  readonly tempoMap: readonly Tempo[];
  readonly meterMap: readonly Meter[];
  readonly keyMap: readonly Key[];
  readonly harmony: readonly HarmonySpan[];
  readonly notation?: Readonly<Record<string, unknown>>;
}
export interface Edit {
  readonly kind:
    | "transpose"
    | "tempo"
    | "omit"
    | "octave"
    | "rhythm"
    | "hold"
    | "quantize"
    | "harmony-invalidated";
  readonly sourceIds: readonly string[];
  readonly outputIds: readonly string[];
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string;
  readonly permission: string;
}
export function pitchString(p: Pitch): string {
  if (
    !p ||
    !/^[A-G]$/.test(p.step) ||
    !Number.isSafeInteger(p.alter) ||
    Math.abs(p.alter) > 4 ||
    !Number.isSafeInteger(p.octave)
  )
    throw new RangeError("Invalid spelled pitch");
  const s = `${p.step}${p.alter < 0 ? "b".repeat(-p.alter) : "#".repeat(p.alter)}${p.octave}`;
  pitchToMidi(s);
  return s;
}
export function parsePitch(s: string): Pitch {
  const match = /^([A-G])([#b]*)(-?\d+)$/.exec(s);
  if (!match || (match[2]!.includes("#") && match[2]!.includes("b")))
    throw new RangeError(`Invalid spelled pitch: ${s}`);
  const p: Pitch = {
    step: match[1] as Pitch["step"],
    alter: match[2]!.length * (match[2]!.startsWith("b") ? -1 : 1),
    octave: Number(match[3]),
  };
  pitchString(p);
  return p;
}
export function cloneScore(score: Score): Score {
  return JSON.parse(JSON.stringify(score)) as Score;
}
function mapOrder(map: readonly { at: Q }[], name: string): void {
  map.forEach((p, i) => {
    if (compareQ(p.at, q(0)) < 0 || (i && compareQ(map[i - 1]!.at, p.at) >= 0))
      throw new RangeError(`${name} must be strictly ordered`);
  });
}
function nonempty(s: unknown): s is string {
  return typeof s === "string" && s.length > 0;
}
function assertJsonData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || ancestors.has(value))
    throw new RangeError("Score must be finite, acyclic JSON data");
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    throw new RangeError("Score must contain ordinary JSON objects");
  ancestors.add(value);
  for (const child of Object.values(value)) {
    // Optional object properties may be absent/undefined; arrays must remain dense.
    if (child === undefined && !Array.isArray(value)) continue;
    assertJsonData(child, ancestors);
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length)
    throw new RangeError("Sparse score arrays are not supported");
  ancestors.delete(value);
}
/** The bar (from 0) a time falls in; a meter change starts a new bar, so a pickup written as a short meter is a bar. */
export function barAt(at: Q, meterMap: readonly Meter[]): number {
  let bars = 0;
  for (let i = 0; i < meterMap.length; i++) {
    const m = meterMap[i]!,
      next = meterMap[i + 1],
      length = (m.numerator * 4) / m.denominator;
    if (!next || compareQ(at, next.at) < 0)
      return bars + Math.max(0, Math.floor((numberQ(at) - numberQ(m.at)) / length + 1e-9));
    bars += Math.ceil((numberQ(next.at) - numberQ(m.at)) / length - 1e-9);
  }
  return bars;
}
export function validateMeterMap(map: readonly Meter[]): void {
  if (!map.length || compareQ(map[0]!.at, q(0)))
    throw new RangeError("Meter map must begin at zero");
  mapOrder(map, "Meter");
  for (const m of map) {
    if (
      !Number.isSafeInteger(m.numerator) ||
      m.numerator < 1 ||
      !Number.isSafeInteger(m.denominator) ||
      m.denominator < 1 ||
      !Number.isInteger(Math.log2(m.denominator))
    )
      throw new RangeError("Invalid meter");
    if (
      m.grouping &&
      (m.grouping.some((x) => !Number.isSafeInteger(x) || x < 1) ||
        m.grouping.reduce((a, b) => a + b, 0) !== m.numerator)
    )
      throw new RangeError("Invalid meter grouping");
  }
}
export function validateScore(score: Score): void {
  assertJsonData(score);
  if (
    !score ||
    score.schemaVersion !== 1 ||
    score.temperament !== "12-TET" ||
    !Number.isFinite(score.concertAHz) ||
    score.concertAHz <= 0
  )
    throw new RangeError("Invalid score header");
  for (const name of [
    "notes",
    "rests",
    "parts",
    "tempoMap",
    "meterMap",
    "keyMap",
    "harmony",
  ] as const)
    if (!Array.isArray(score[name]))
      throw new RangeError(`Missing score ${name}`);
  validateTempoMap(score.tempoMap);
  validateMeterMap(score.meterMap);
  mapOrder(score.keyMap, "Key");
  for (const k of score.keyMap) {
    if (!/^[A-G](?:#{1,4}|b{1,4})?$/.test(k.tonic) || !nonempty(k.mode))
      throw new RangeError("Invalid key");
  }
  const parts = new Map<string, Part>();
  for (const p of score.parts) {
    if (
      !nonempty(p.id) ||
      parts.has(p.id) ||
      !Array.isArray(p.voices) ||
      !p.voices.length ||
      p.voices.some((v) => !nonempty(v)) ||
      new Set(p.voices).size !== p.voices.length
    )
      throw new RangeError("Invalid parts or voices");
    if (p.writtenToSounding !== undefined)
      transposePitch("C4", p.writtenToSounding);
    parts.set(p.id, p);
  }
  const ids = new Set<string>();
  for (const e of [...score.notes, ...score.rests]) {
    if (!nonempty(e.id) || ids.has(e.id))
      throw new RangeError("Event IDs must be unique");
    ids.add(e.id);
    if (!parts.get(e.partId)?.voices.includes(e.voiceId))
      throw new RangeError(`Unknown part/voice for ${e.id}`);
    if (compareQ(e.onset, q(0)) < 0 || compareQ(e.duration, q(0)) <= 0)
      throw new RangeError("Invalid event time");
    addQ(e.onset, e.duration);
  }
  const ties = new Map<string, NoteEvent[]>();
  for (const n of score.notes) {
    pitchString(n.pitch);
    if (
      n.role !== undefined &&
      !["melody", "bass", "harmony", "ornament", "unknown"].includes(n.role)
    )
      throw new RangeError("Invalid note role");
    if (
      n.importance !== undefined &&
      (!Number.isFinite(n.importance) || n.importance < 0 || n.importance > 1)
    )
      throw new RangeError("Importance must be in [0,1]");
    if (
      n.gateDuration !== undefined &&
      (compareQ(n.gateDuration, q(0)) <= 0 ||
        compareQ(n.gateDuration, n.duration) > 0)
    )
      throw new RangeError("Gate must be positive and at most duration");
    if (
      n.locked !== undefined &&
      (!n.locked ||
        Array.isArray(n.locked) ||
        typeof n.locked !== "object" ||
        Object.values(n.locked).some((x) => typeof x !== "boolean"))
    )
      throw new RangeError("Invalid note locks");
    if (
      n.techniques !== undefined &&
      (!Array.isArray(n.techniques) || n.techniques.some((t) => !nonempty(t)))
    )
      throw new RangeError("Invalid techniques");
    if (
      n.sourceIds !== undefined &&
      (!Array.isArray(n.sourceIds) || n.sourceIds.some((t) => !nonempty(t)))
    )
      throw new RangeError("Invalid source identities");
    if (n.tieGroupId !== undefined) {
      if (!nonempty(n.tieGroupId)) throw new RangeError("Invalid tie ID");
      const group = ties.get(n.tieGroupId) ?? [];
      group.push(n);
      ties.set(n.tieGroupId, group);
    }
  }
  for (const group of ties.values()) {
    group.sort((a, b) => compareQ(a.onset, b.onset));
    for (let i = 1; i < group.length; i++) {
      const a = group[i - 1]!,
        b = group[i]!;
      if (
        a.partId !== b.partId ||
        a.voiceId !== b.voiceId ||
        pitchString(a.pitch) !== pitchString(b.pitch) ||
        compareQ(addQ(a.onset, a.duration), b.onset) ||
        (a.gateDuration && compareQ(a.gateDuration, a.duration))
      )
        throw new RangeError(
          "Tie fragments must be contiguous, same voice/pitch, without early gates",
        );
    }
  }
  const harmonyIds = new Set<string>();
  for (const h of score.harmony) {
    if (
      !nonempty(h.id) ||
      harmonyIds.has(h.id) ||
      compareQ(h.onset, q(0)) < 0 ||
      compareQ(h.end, h.onset) <= 0 ||
      !["provided", "inferred"].includes(h.provenance) ||
      !nonempty(h.method)
    )
      throw new RangeError("Invalid harmony span");
    harmonyIds.add(h.id);
    if (
      !Array.isArray(h.candidates) ||
      h.candidates.some(
        (c) => !nonempty(c.symbol) || !Number.isFinite(c.score),
      ) ||
      !Array.isArray(h.evidenceNoteIds) ||
      h.evidenceNoteIds.some((id) => !score.notes.some((n) => n.id === id))
    )
      throw new RangeError("Invalid harmony evidence/candidates");
    if (h.selected !== undefined && !nonempty(h.selected))
      throw new RangeError("Invalid selected harmony");
  }
  // A notated rest cannot contradict a note in the same voice. Different voices may overlap.
  for (const r of score.rests)
    for (const n of score.notes)
      if (
        r.partId === n.partId &&
        r.voiceId === n.voiceId &&
        compareQ(r.onset, addQ(n.onset, n.duration)) < 0 &&
        compareQ(n.onset, addQ(r.onset, r.duration)) < 0
      )
        throw new RangeError("Rest overlaps a note in the same voice");
}
export function normalizeScore(score: Score): Score {
  validateScore(score);
  const copy = cloneScore(score);
  const normEvent = <T extends { onset: Q; duration: Q }>(e: T): T => ({
    ...e,
    onset: normalizeQ(e.onset),
    duration: normalizeQ(e.duration),
  });
  return {
    ...copy,
    notes: copy.notes
      .map((n) => ({
        ...normEvent(n),
        ...(n.gateDuration ? { gateDuration: normalizeQ(n.gateDuration) } : {}),
      }))
      .sort((a, b) => compareQ(a.onset, b.onset) || a.id.localeCompare(b.id)),
    rests: copy.rests.map(normEvent),
    tempoMap: copy.tempoMap.map((t) => ({ ...t, at: normalizeQ(t.at) })),
    meterMap: copy.meterMap.map((t) => ({ ...t, at: normalizeQ(t.at) })),
    keyMap: copy.keyMap.map((t) => ({ ...t, at: normalizeQ(t.at) })),
    harmony: copy.harmony.map((h) => ({
      ...h,
      onset: normalizeQ(h.onset),
      end: normalizeQ(h.end),
    })),
  };
}
/** Convenience constructor. Defaults are explicit creation defaults, never inferred from notes. */
export function createScore(
  notes: readonly NoteEvent[],
  options: Partial<Omit<Score, "notes" | "schemaVersion" | "temperament">> = {},
): Score {
  const parts: Part[] = [];
  for (const n of notes) {
    let p = parts.find((p) => p.id === n.partId);
    if (!p) {
      p = { id: n.partId, voices: [] };
      parts.push(p);
    }
    if (!p.voices.includes(n.voiceId)) (p.voices as string[]).push(n.voiceId);
  }
  return normalizeScore({
    schemaVersion: 1,
    temperament: "12-TET",
    concertAHz: 440,
    notes,
    rests: [],
    parts,
    tempoMap: [{ at: q(0), quarterBpm: 120 }],
    meterMap: [{ at: q(0), numerator: 4, denominator: 4 }],
    keyMap: [],
    harmony: [],
    ...options,
  });
}
export interface SoundingNote {
  readonly id: string;
  readonly noteIds: readonly string[];
  readonly notes: readonly NoteEvent[];
  readonly onset: Q;
  readonly end: Q;
  readonly pitch: Pitch;
  readonly partId: string;
  readonly voiceId: string;
}
/** Merge ties for mechanics without destroying notated fragments. */
export function soundingNotes(score: Score): SoundingNote[] {
  const groups = new Map<string, NoteEvent[]>();
  for (const n of score.notes) {
    const key = n.tieGroupId ? `tie:${n.tieGroupId}` : `note:${n.id}`;
    const a = groups.get(key) ?? [];
    a.push(n);
    groups.set(key, a);
  }
  return [...groups.values()]
    .map((notes) => {
      notes.sort((a, b) => compareQ(a.onset, b.onset));
      const first = notes[0]!,
        last = notes.at(-1)!;
      return {
        id: first.id,
        noteIds: notes.map((n) => n.id),
        notes,
        onset: first.onset,
        end: addQ(last.onset, last.gateDuration ?? last.duration),
        pitch: first.pitch,
        partId: first.partId,
        voiceId: first.voiceId,
      };
    })
    .sort((a, b) => compareQ(a.onset, b.onset) || a.id.localeCompare(b.id));
}
export interface Frame {
  readonly at: Q;
  readonly end: Q;
  readonly active: readonly SoundingNote[];
  readonly attacks: readonly SoundingNote[];
  readonly releases: readonly SoundingNote[];
}
export function scoreFrames(score: Score): Frame[] {
  validateScore(score);
  const notes = soundingNotes(score),
    times = new Map<string, Q>();
  for (const n of notes)
    for (const t of [n.onset, n.end]) times.set(keyQ(t), t);
  const ordered = [...times.values()].sort(compareQ);
  return ordered.map((at, i) => ({
    at,
    end: ordered[i + 1] ?? at,
    active: notes.filter(
      (n) => compareQ(n.onset, at) <= 0 && compareQ(n.end, at) > 0,
    ),
    attacks: notes.filter((n) => !compareQ(n.onset, at)),
    releases: notes.filter((n) => !compareQ(n.end, at)),
  }));
}
