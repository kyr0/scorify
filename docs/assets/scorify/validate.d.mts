import { Score } from './model.mjs';
import { FrettedInstrument } from './fretted.mjs';
import { FrettedAnnotation } from './fingering.mjs';
import { PlayerOptions } from './profiles.mjs';
import './time-B3MQxqrT.mjs';
import './adapters.mjs';

/** Independent replay against output events, not the search engine's internal frames. */
declare function validateFrettedArrangement(score: Score, instrument: FrettedInstrument, annotations: readonly FrettedAnnotation[], player?: PlayerOptions): {
    readonly valid: boolean;
    readonly diagnostics: readonly string[];
};

export { validateFrettedArrangement };
//# sourceMappingURL=validate.d.mts.map
