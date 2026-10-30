/** Exact quarter-note time. JSON-safe at the boundary; BigInt arithmetic internally. */
export type Q = readonly [numerator: number, denominator: number];
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a;
}
function fromBig(n: bigint, d: bigint): Q {
  if (d === 0n) throw new RangeError("Zero time denominator");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  n /= g;
  d /= g;
  if (n > MAX || n < -MAX || d > MAX)
    throw new RangeError("Rational time overflow");
  return [Number(n), Number(d)];
}
export function q(n: number, d = 1): Q {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d <= 0)
    throw new RangeError(
      "Time requires safe integers and a positive denominator",
    );
  return fromBig(BigInt(n), BigInt(d));
}
export function normalizeQ(value: Q): Q {
  if (!Array.isArray(value) || value.length !== 2)
    throw new RangeError("Expected [numerator, denominator]");
  return q(value[0], value[1]);
}
export function addQ(a: Q, b: Q): Q {
  a = normalizeQ(a);
  b = normalizeQ(b);
  return fromBig(
    BigInt(a[0]) * BigInt(b[1]) + BigInt(b[0]) * BigInt(a[1]),
    BigInt(a[1]) * BigInt(b[1]),
  );
}
export function subQ(a: Q, b: Q): Q {
  return addQ(a, [-b[0], b[1]]);
}
export function mulQ(a: Q, b: Q): Q {
  a = normalizeQ(a);
  b = normalizeQ(b);
  return fromBig(BigInt(a[0]) * BigInt(b[0]), BigInt(a[1]) * BigInt(b[1]));
}
export function compareQ(a: Q, b: Q): number {
  a = normalizeQ(a);
  b = normalizeQ(b);
  const v = BigInt(a[0]) * BigInt(b[1]) - BigInt(b[0]) * BigInt(a[1]);
  return v < 0n ? -1 : v > 0n ? 1 : 0;
}
export function numberQ(a: Q): number {
  a = normalizeQ(a);
  return a[0] / a[1];
}
export function keyQ(a: Q): string {
  a = normalizeQ(a);
  return `${a[0]}/${a[1]}`;
}
export function ceilGrid(at: Q, grid: Q): Q {
  at = normalizeQ(at);
  grid = normalizeQ(grid);
  if (grid[0] <= 0 || at[0] < 0)
    throw new RangeError("Positive grid and nonnegative time required");
  const n = BigInt(at[0]) * BigInt(grid[1]),
    d = BigInt(at[1]) * BigInt(grid[0]);
  return fromBig(((n + d - 1n) / d) * BigInt(grid[0]), BigInt(grid[1]));
}
export interface Tempo {
  readonly at: Q;
  readonly quarterBpm: number;
}
export function validateTempoMap(map: readonly Tempo[]): void {
  if (!map.length || compareQ(map[0]!.at, q(0)) !== 0)
    throw new RangeError("Tempo map must begin at zero");
  map.forEach((t, i) => {
    if (
      !Number.isFinite(t.quarterBpm) ||
      t.quarterBpm <= 0 ||
      compareQ(t.at, q(0)) < 0 ||
      (i > 0 && compareQ(map[i - 1]!.at, t.at) >= 0)
    )
      throw new RangeError("Invalid or unordered tempo map");
  });
}
export function secondsAt(at: Q, map: readonly Tempo[]): number {
  validateTempoMap(map);
  if (compareQ(at, q(0)) < 0) throw new RangeError("Negative time");
  let seconds = 0;
  for (let i = 0; i < map.length; i++) {
    const t = map[i]!;
    if (compareQ(at, t.at) <= 0) break;
    const next = map[i + 1]?.at;
    const end = next && compareQ(next, at) < 0 ? next : at;
    seconds += (numberQ(subQ(end, t.at)) * 60) / t.quarterBpm;
  }
  if (!Number.isFinite(seconds)) throw new RangeError("Seconds overflow");
  return seconds;
}
export function secondsBetween(from: Q, to: Q, map: readonly Tempo[]): number {
  return secondsAt(to, map) - secondsAt(from, map);
}
/** Inverse timing, as a floating point quarter-note coordinate for performed input. */
export function quartersAtSeconds(
  seconds: number,
  map: readonly Tempo[],
): number {
  validateTempoMap(map);
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new RangeError("Invalid performed time");
  let left = seconds;
  for (let i = 0; i < map.length; i++) {
    const t = map[i]!,
      next = map[i + 1];
    const span = next
      ? (numberQ(subQ(next.at, t.at)) * 60) / t.quarterBpm
      : Infinity;
    if (left <= span) return numberQ(t.at) + (left * t.quarterBpm) / 60;
    left -= span;
  }
  throw new RangeError("Invalid timing");
}

export function isMultipleQ(at: Q, grid: Q): boolean {
  at = normalizeQ(at);
  grid = normalizeQ(grid);
  if (grid[0] <= 0) throw new RangeError("Grid must be positive");
  return (
    (BigInt(at[0]) * BigInt(grid[1])) % (BigInt(at[1]) * BigInt(grid[0])) === 0n
  );
}
