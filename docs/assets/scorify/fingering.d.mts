import { Position, FrettedInstrument } from './fretted.mjs';
import { InstrumentAdapter } from './adapters.mjs';
import { Q } from './index.mjs';
import './model.mjs';
import './profiles.mjs';

interface FrettedAssignment extends Position {
    readonly id: string;
    readonly noteIds: readonly string[];
    readonly finger: 0 | 1 | 2 | 3 | 4;
}
interface FingerContact {
    readonly finger: number;
    readonly fret: number;
    readonly fromString: number;
    readonly toString: number;
}
interface FrettedRealization {
    readonly assignments: readonly FrettedAssignment[];
    readonly contacts: readonly FingerContact[];
    readonly spanFrets: number;
    readonly reachMm: number | null;
    readonly shape: string;
}
interface FingerMemory {
    readonly contact: FingerContact;
    readonly releasedAt: number | null;
}
interface FrettedState {
    readonly fingers: Readonly<Record<number, FingerMemory>>;
}
interface FrettedAnnotation extends FrettedRealization {
    readonly at: Q;
    readonly attackIds: readonly string[];
    readonly mutedStringIds: readonly string[];
    readonly rightHand: "pick" | "strum";
}
declare function createFrettedAdapter(instrument: FrettedInstrument): InstrumentAdapter<FrettedState, FrettedRealization, FrettedAnnotation>;
/** Construct metrics/contact geometry for already assigned notes; validation is separate. */
declare function realizeFrettedAssignments(assignments: readonly FrettedAssignment[], instrument: FrettedInstrument, contacts?: readonly FingerContact[]): FrettedRealization;

export { createFrettedAdapter, realizeFrettedAssignments };
export type { FingerContact, FingerMemory, FrettedAnnotation, FrettedAssignment, FrettedRealization, FrettedState };
//# sourceMappingURL=fingering.d.mts.map
