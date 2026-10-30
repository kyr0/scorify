import { NoteEvent, Meter, Score, Edit } from './model.mjs';
import { Tempo, Q } from './index.mjs';

interface PerformedNote {
    readonly id: string;
    readonly pitch: string;
    readonly onsetSeconds: number;
    readonly durationSeconds: number;
    readonly partId: string;
    readonly voiceId: string;
    readonly role?: NoteEvent["role"];
}
interface QuantizeOptions {
    readonly tempoMap: readonly Tempo[];
    readonly meterMap: readonly Meter[];
    readonly subdivisions?: readonly number[];
    readonly toleranceSeconds?: number;
    readonly maxCandidatesPerNote?: number;
    readonly maxStates?: number;
    readonly maxExpandedStates?: number;
}
interface TimingAlternative {
    readonly onset: Q;
    readonly duration: Q;
    readonly errorSeconds: number;
}
type QuantizeResult = {
    readonly status: "success";
    readonly score: Score;
    readonly original: readonly PerformedNote[];
    readonly edits: readonly Edit[];
    readonly alternatives: Readonly<Record<string, readonly TimingAlternative[]>>;
    readonly optimality: "proven-in-model" | "best-found";
    readonly expandedStates: number;
} | {
    readonly status: "invalid-input" | "infeasible" | "search-exhausted";
    readonly diagnostics: readonly string[];
};
/** Bounded joint on/off grid search with known tempo/meter; preserves voice overlap relations. */
declare function quantizePerformance(input: readonly PerformedNote[], options: QuantizeOptions): QuantizeResult;

export { quantizePerformance };
export type { PerformedNote, QuantizeOptions, QuantizeResult, TimingAlternative };
//# sourceMappingURL=quantize.d.mts.map
