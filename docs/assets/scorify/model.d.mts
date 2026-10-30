import { Q, T as Tempo } from './time-B3MQxqrT.mjs';
export { a as addQ, c as ceilGrid, b as compareQ, i as isMultipleQ, k as keyQ, m as mulQ, n as normalizeQ, d as numberQ, q, e as quartersAtSeconds, s as secondsAt, f as secondsBetween, g as subQ, v as validateTempoMap } from './time-B3MQxqrT.mjs';

interface Pitch {
    readonly step: "C" | "D" | "E" | "F" | "G" | "A" | "B";
    readonly alter: number;
    readonly octave: number;
}
interface Part {
    readonly id: string;
    readonly name?: string;
    readonly voices: readonly string[];
    readonly writtenToSounding?: string;
}
interface NoteEvent {
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
interface RestEvent {
    readonly id: string;
    readonly onset: Q;
    readonly duration: Q;
    readonly partId: string;
    readonly voiceId: string;
}
interface Meter {
    readonly at: Q;
    readonly numerator: number;
    readonly denominator: number;
    readonly grouping?: readonly number[];
}
interface Key {
    readonly at: Q;
    readonly tonic: string;
    readonly mode: string;
}
interface HarmonyCandidate {
    readonly symbol: string;
    readonly score: number;
}
interface HarmonySpan {
    readonly id: string;
    readonly onset: Q;
    readonly end: Q;
    readonly candidates: readonly HarmonyCandidate[];
    readonly selected?: string;
    readonly evidenceNoteIds: readonly string[];
    readonly provenance: "provided" | "inferred";
    readonly method: string;
}
interface Score {
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
interface Edit {
    readonly kind: "transpose" | "tempo" | "omit" | "octave" | "rhythm" | "hold" | "quantize" | "harmony-invalidated";
    readonly sourceIds: readonly string[];
    readonly outputIds: readonly string[];
    readonly before: unknown;
    readonly after: unknown;
    readonly reason: string;
    readonly permission: string;
}
declare function pitchString(p: Pitch): string;
declare function parsePitch(s: string): Pitch;
declare function cloneScore(score: Score): Score;
/** The bar (from 0) a time falls in; a meter change starts a new bar, so a pickup written as a short meter is a bar. */
declare function barAt(at: Q, meterMap: readonly Meter[]): number;
declare function validateMeterMap(map: readonly Meter[]): void;
declare function validateScore(score: Score): void;
declare function normalizeScore(score: Score): Score;
/** Convenience constructor. Defaults are explicit creation defaults, never inferred from notes. */
declare function createScore(notes: readonly NoteEvent[], options?: Partial<Omit<Score, "notes" | "schemaVersion" | "temperament">>): Score;
interface SoundingNote {
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
declare function soundingNotes(score: Score): SoundingNote[];
interface Frame {
    readonly at: Q;
    readonly end: Q;
    readonly active: readonly SoundingNote[];
    readonly attacks: readonly SoundingNote[];
    readonly releases: readonly SoundingNote[];
}
declare function scoreFrames(score: Score): Frame[];

export { Q, Tempo, barAt, cloneScore, createScore, normalizeScore, parsePitch, pitchString, scoreFrames, soundingNotes, validateMeterMap, validateScore };
export type { Edit, Frame, HarmonyCandidate, HarmonySpan, Key, Meter, NoteEvent, Part, Pitch, RestEvent, Score, SoundingNote };
//# sourceMappingURL=model.d.mts.map
