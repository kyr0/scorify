import { Q } from './index.mjs';
import { SoundingNote } from './model.mjs';
import { PlayerProfile } from './profiles.mjs';

/** Instrument-specific mechanics; generic score events do not require strings. */
interface AdapterFrame {
    readonly at: Q;
    readonly seconds: number;
    readonly active: readonly SoundingNote[];
    readonly attackIds: readonly string[];
}
interface MechanicsContext {
    readonly player: PlayerProfile;
    readonly tick: () => void;
}
interface TransitionEvaluation<State> {
    readonly valid: boolean;
    readonly state: State;
    readonly cost: number;
    readonly shift: number;
    readonly diagnostics: readonly string[];
}
interface InstrumentAdapter<State, Realization, Annotation> {
    readonly kind: string;
    readonly version: string;
    readonly initialState: () => State;
    enumerate(frame: AdapterFrame, previous: Realization | undefined, context: MechanicsContext): Iterable<Realization>;
    validateState(realization: Realization, frame: AdapterFrame, context: MechanicsContext): readonly string[];
    transition(state: State, from: Realization | undefined, to: Realization, frame: AdapterFrame, context: MechanicsContext): TransitionEvaluation<State>;
    describe(realization: Realization, frame: AdapterFrame, context: MechanicsContext): Annotation;
    stateKey(state: State, realization: Realization): string;
    ergonomicCost(realization: Realization, context: MechanicsContext): number;
}
declare const ADAPTER_CONTRACT_VERSION: 1;

export { ADAPTER_CONTRACT_VERSION };
export type { AdapterFrame, InstrumentAdapter, MechanicsContext, TransitionEvaluation };
//# sourceMappingURL=adapters.d.mts.map
