/** Exact quarter-note time. JSON-safe at the boundary; BigInt arithmetic internally. */
type Q = readonly [numerator: number, denominator: number];
declare function q(n: number, d?: number): Q;
declare function normalizeQ(value: Q): Q;
declare function addQ(a: Q, b: Q): Q;
declare function subQ(a: Q, b: Q): Q;
declare function mulQ(a: Q, b: Q): Q;
declare function compareQ(a: Q, b: Q): number;
declare function numberQ(a: Q): number;
declare function keyQ(a: Q): string;
declare function ceilGrid(at: Q, grid: Q): Q;
interface Tempo {
    readonly at: Q;
    readonly quarterBpm: number;
}
declare function validateTempoMap(map: readonly Tempo[]): void;
declare function secondsAt(at: Q, map: readonly Tempo[]): number;
declare function secondsBetween(from: Q, to: Q, map: readonly Tempo[]): number;
/** Inverse timing, as a floating point quarter-note coordinate for performed input. */
declare function quartersAtSeconds(seconds: number, map: readonly Tempo[]): number;
declare function isMultipleQ(at: Q, grid: Q): boolean;

export { addQ as a, compareQ as b, ceilGrid as c, numberQ as d, quartersAtSeconds as e, secondsBetween as f, subQ as g, isMultipleQ as i, keyQ as k, mulQ as m, normalizeQ as n, q, secondsAt as s, validateTempoMap as v };
export type { Q, Tempo as T };
//# sourceMappingURL=time-B3MQxqrT.d.mts.map
