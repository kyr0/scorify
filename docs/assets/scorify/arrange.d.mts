import { Score, HarmonySpan, Edit } from './model.mjs';
import { PlayerOptions, AdaptationPolicy, PlayerProfile } from './profiles.mjs';
import { TransformOptions } from './transforms.mjs';
import { FrettedInstrument } from './fretted.mjs';
import { FrettedAnnotation } from './fingering.mjs';
import { AdapterFrame, InstrumentAdapter } from './adapters.mjs';
import './time-B3MQxqrT.mjs';

interface SearchOptions {
    readonly strategy?: "beam" | "exact" | "exhaustive";
    readonly beamWidth?: number;
    readonly maxCandidatesPerFrame?: number;
    readonly maxExpandedStates?: number;
    readonly maxFrames?: number;
    readonly maxInputNotes?: number;
    readonly maxInputEvents?: number;
}
interface Cancellation {
    readonly aborted: boolean;
}
interface SearchProgress {
    readonly frame: number;
    readonly frames: number;
    readonly expandedStates: number;
    readonly frontier: number;
}
interface CostBreakdown {
    readonly musicalLoss: number;
    readonly ergonomicCost: number;
    readonly transitionCost: number;
    readonly styleCost: number;
    readonly total: number;
}
interface SearchStats {
    readonly strategy: string;
    readonly frames: number;
    readonly expandedStates: number;
    readonly discardedCandidates: number;
    readonly dominatedStates: number;
    readonly exhaustive: boolean;
}
interface ArrangementOptions {
    readonly instrument?: FrettedInstrument;
    readonly mode?: "unconstrained" | "exact" | "adaptive";
    readonly transform?: TransformOptions;
    readonly player?: PlayerOptions;
    readonly adaptation?: Partial<AdaptationPolicy>;
    readonly search?: SearchOptions;
    readonly autoTempo?: boolean;
    readonly signal?: Cancellation;
    readonly scoring?: {
        readonly id: string;
        readonly cost: (frame: AdapterFrame, realization: unknown) => number;
    };
}
interface DifficultyReport {
    readonly maxPolyphony: number;
    readonly maxVoices: number;
    readonly maxAttacksInOneSecond: number;
    /** The most notes one bar starts while the right hand picks (0 when it strums). */
    readonly maxPickedInOneBar: number;
    readonly ornamentRetention: number;
    readonly maxFretSpan: number | null;
    readonly maxReachMm: number | null;
    readonly maxShiftFrets: number | null;
    readonly model: string;
    readonly calibrated: false;
}
interface ArrangementSuccess<Annotation = FrettedAnnotation> {
    readonly status: "success";
    readonly score: Score;
    readonly annotations: readonly Annotation[];
    readonly sourceHarmony: readonly HarmonySpan[];
    readonly realizedHarmony: readonly HarmonySpan[];
    readonly edits: readonly Edit[];
    readonly cost: CostBreakdown;
    readonly difficulty: DifficultyReport;
    readonly profile: PlayerProfile;
    readonly optimality: "proven-in-model" | "best-found";
    readonly stats: SearchStats;
    readonly assumptions: readonly string[];
    readonly sourceMap: Readonly<Record<string, readonly string[]>>;
    readonly modelVersions: {
        readonly score: 1;
        readonly adapter: string;
        readonly policy: string;
        readonly scoring: string;
    };
    readonly constraints: {
        readonly valid: true;
        readonly model: string;
    };
}
interface ArrangementFailure {
    readonly status: "infeasible" | "search-exhausted" | "unsupported" | "invalid-input" | "cancelled";
    readonly diagnostics: readonly string[];
    readonly stats: SearchStats;
}
type ArrangementResult<Annotation = FrettedAnnotation> = ArrangementSuccess<Annotation> | ArrangementFailure;
/** Generic search engine; adapters can model future keyboards without fretted fields. */
declare function arrangeSteps<State, Realization, Annotation>(source: Score, options: ArrangementOptions, adapter?: InstrumentAdapter<State, Realization, Annotation>): Generator<SearchProgress, ArrangementResult<Annotation>, void>;
declare function arrangeWithAdapter<State, Realization, Annotation>(source: Score, options: ArrangementOptions, adapter: InstrumentAdapter<State, Realization, Annotation>): ArrangementResult<Annotation>;
declare function arrange(source: Score, options?: ArrangementOptions): ArrangementResult;
interface AsyncOptions {
    readonly yieldEvery?: number;
    readonly schedule?: () => Promise<void>;
    readonly onProgress?: (progress: SearchProgress) => void;
}
declare function arrangeAsync(source: Score, options?: ArrangementOptions, asyncOptions?: AsyncOptions): Promise<ArrangementResult>;

export { arrange, arrangeAsync, arrangeSteps, arrangeWithAdapter };
export type { ArrangementFailure, ArrangementOptions, ArrangementResult, ArrangementSuccess, AsyncOptions, Cancellation, CostBreakdown, DifficultyReport, SearchOptions, SearchProgress, SearchStats };
//# sourceMappingURL=arrange.d.mts.map
