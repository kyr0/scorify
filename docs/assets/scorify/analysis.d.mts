import { Score, HarmonySpan } from './model.mjs';
import { Q } from './index.mjs';

interface HarmonyOptions {
    readonly window?: Q;
    readonly respectProvided?: boolean;
    readonly maxWindows?: number;
}
/** Meter-aligned windows collect arpeggios; scores are heuristic ranks, not probabilities. */
declare function analyzeHarmony(score: Score, options?: HarmonyOptions): HarmonySpan[];

export { analyzeHarmony };
export type { HarmonyOptions };
//# sourceMappingURL=analysis.d.mts.map
