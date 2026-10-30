import type { Q } from "./time.js";
import type { SoundingNote } from "./model.js";
import type { PlayerProfile } from "./profiles.js";
/** Instrument-specific mechanics; generic score events do not require strings. */
export interface AdapterFrame {
  readonly at: Q;
  readonly seconds: number;
  readonly active: readonly SoundingNote[];
  readonly attackIds: readonly string[];
}
export interface MechanicsContext {
  readonly player: PlayerProfile;
  readonly tick: () => void;
}
export interface TransitionEvaluation<State> {
  readonly valid: boolean;
  readonly state: State;
  readonly cost: number;
  readonly shift: number;
  readonly diagnostics: readonly string[];
}
export interface InstrumentAdapter<State, Realization, Annotation> {
  readonly kind: string;
  readonly version: string;
  readonly initialState: () => State;
  enumerate(
    frame: AdapterFrame,
    previous: Realization | undefined,
    context: MechanicsContext,
  ): Iterable<Realization>;
  validateState(
    realization: Realization,
    frame: AdapterFrame,
    context: MechanicsContext,
  ): readonly string[];
  transition(
    state: State,
    from: Realization | undefined,
    to: Realization,
    frame: AdapterFrame,
    context: MechanicsContext,
  ): TransitionEvaluation<State>;
  describe(
    realization: Realization,
    frame: AdapterFrame,
    context: MechanicsContext,
  ): Annotation;
  stateKey(state: State, realization: Realization): string;
  ergonomicCost(realization: Realization, context: MechanicsContext): number;
}

export const ADAPTER_CONTRACT_VERSION = 1 as const;
