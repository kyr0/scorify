import { Score, Edit } from './model.mjs';
import './time-B3MQxqrT.mjs';

interface TransformOptions {
    readonly interval?: string;
    readonly tempoScale?: number;
    readonly quarterBpm?: number;
}
declare function transposeChordSymbol(symbol: string, interval: string): string;
declare function transposeScore(score: Score, { interval }: {
    readonly interval: string;
}): Score;
declare function retimeScore(score: Score, options: {
    readonly scale?: number;
    readonly quarterBpm?: number;
}): Score;
declare function transformScore(score: Score, options?: TransformOptions): {
    score: Score;
    edits: Edit[];
};

export { retimeScore, transformScore, transposeChordSymbol, transposeScore };
export type { TransformOptions };
//# sourceMappingURL=transforms.d.mts.map
