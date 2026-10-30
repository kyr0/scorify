import { q, compareQ } from "./time.js";
import type { Q } from "./time.js";
export type Level =
  | "baby"
  | "beginner"
  | "amateur"
  | "semi-pro"
  | "pro"
  | "expert"
  | "maestro";
export const levels: readonly Level[] = [
  "baby",
  "beginner",
  "amateur",
  "semi-pro",
  "pro",
  "expert",
  "maestro",
];
export interface PlayerCapabilities {
  readonly maxFretSpan: number;
  readonly maxReachMm?: number;
  readonly maxShiftFretsPerSecond: number;
  readonly maxFingerSpeedMmPerSecond?: number;
  readonly fingerPairMaxMm?: Readonly<
    Partial<Record<"1-2" | "1-3" | "1-4" | "2-3" | "2-4" | "3-4", number>>
  >;
  readonly fingerSetupSeconds: number;
  readonly maxPolyphony: number;
  readonly maxVoices: number;
  readonly maxAttacksPerSecond: number;
  /**
   * Picked notes a bar may start when the right hand picks, unless each sounds alone: a bar may always pick one note
   * at a time, and notes picked together only while the bar stays within this count. Strummed chords do not count.
   * Unset: no limit.
   */
  readonly maxPickedPerBar?: number;
  readonly allowBarre: boolean;
  readonly maxBarreStrings: number;
  readonly maxFret: number;
  readonly minDuration: Q;
  readonly rhythmGrid?: Q;
  readonly rightHand: "pick" | "strum";
  readonly allowMutedStrum: boolean;
  readonly familiarShapes: readonly string[];
}
export interface PlayerOptions {
  readonly level?: Level;
  readonly complexity?: number;
  readonly flexibility?: number;
  readonly overrides?: Partial<PlayerCapabilities>;
}
export interface PlayerProfile extends PlayerCapabilities {
  readonly level: Level;
  readonly complexity: number;
  readonly flexibility: number;
  readonly version: "scorify-player-1";
  readonly calibrated: false;
  readonly suggestedQuarterBpm: number;
}
const rows: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  boolean,
  number,
  number,
])[] = [
  // span, shift/sec, simultaneous, voices, attacks/sec, complexity, barre, duration denominator, suggested BPM
  [2, 5, 3, 2, 2, 0, false, 1, 50],
  [3, 9, 4, 3, 4, 0.1, false, 2, 65],
  [4, 16, 6, 4, 7, 0.35, true, 4, 85],
  [5, 25, 8, 5, 10, 0.6, true, 8, 100],
  [6, 40, 10, 8, 14, 0.8, true, 16, 120],
  [7, 65, 12, 12, 20, 0.95, true, 32, 140],
  [9, 100, 16, 16, 32, 1, true, 64, 160],
];
/** Picked notes per bar from baby to pro; expert and maestro have no such limit. */
const PICKED_PER_BAR: readonly (number | undefined)[] = [2, 3, 4, 6, 8];
function unit(x: number, label: string): void {
  if (!Number.isFinite(x) || x < 0 || x > 1)
    throw new RangeError(`${label} must be in [0,1]`);
}
export function compilePlayer(options: PlayerOptions = {}): PlayerProfile {
  const level = options.level ?? "maestro",
    index = levels.indexOf(level);
  if (index < 0) throw new RangeError("Unknown player level");
  const r = rows[index]!,
    complexity = options.complexity ?? r[5],
    flexibility = options.flexibility ?? index / 6;
  unit(complexity, "Complexity");
  unit(flexibility, "Flexibility");
  const p: PlayerProfile = {
    level,
    version: "scorify-player-1",
    calibrated: false,
    complexity,
    flexibility,
    suggestedQuarterBpm: r[8],
    maxFretSpan:
      options.flexibility === undefined
        ? r[0]
        : 2 + Math.floor(flexibility * 7),
    maxShiftFretsPerSecond:
      options.flexibility === undefined ? r[1] : 5 + flexibility * 95,
    fingerSetupSeconds: 0.025 * (1 - flexibility),
    maxPolyphony: r[2],
    maxVoices: r[3],
    maxAttacksPerSecond: r[4],
    ...(PICKED_PER_BAR[index] !== undefined ? { maxPickedPerBar: PICKED_PER_BAR[index] } : {}),
    allowBarre: r[6],
    maxBarreStrings: r[6] ? 6 : 1,
    maxFret: 36,
    minDuration: q(1, r[7]),
    rightHand: "pick",
    allowMutedStrum: false,
    familiarShapes: [],
    ...options.overrides,
  };
  for (const k of [
    "maxFretSpan",
    "maxPolyphony",
    "maxVoices",
    "maxBarreStrings",
    "maxFret",
  ] as const)
    if (
      !Number.isSafeInteger(p[k]) ||
      p[k] < (k === "maxFretSpan" || k === "maxFret" ? 0 : 1)
    )
      throw new RangeError(`Invalid ${k}`);
  if (p.maxPickedPerBar !== undefined && (!Number.isSafeInteger(p.maxPickedPerBar) || p.maxPickedPerBar < 1))
    throw new RangeError("Invalid maxPickedPerBar");
  for (const k of ["maxShiftFretsPerSecond", "maxAttacksPerSecond"] as const)
    if (!Number.isFinite(p[k]) || p[k] <= 0)
      throw new RangeError(`Invalid ${k}`);
  if (!Number.isFinite(p.fingerSetupSeconds) || p.fingerSetupSeconds < 0)
    throw new RangeError("Invalid finger setup time");
  for (const k of ["maxReachMm", "maxFingerSpeedMmPerSecond"] as const)
    if (p[k] !== undefined && (!Number.isFinite(p[k]) || p[k]! <= 0))
      throw new RangeError(`Invalid ${k}`);
  if (
    compareQ(p.minDuration, q(0)) <= 0 ||
    (p.rhythmGrid && compareQ(p.rhythmGrid, q(0)) <= 0)
  )
    throw new RangeError("Invalid rhythm capabilities");
  if (
    typeof p.allowBarre !== "boolean" ||
    typeof p.allowMutedStrum !== "boolean" ||
    !["pick", "strum"].includes(p.rightHand) ||
    !Array.isArray(p.familiarShapes) ||
    p.familiarShapes.some((s) => typeof s !== "string")
  )
    throw new RangeError("Invalid player capabilities");
  if (p.fingerPairMaxMm)
    for (const [pair, limit] of Object.entries(p.fingerPairMaxMm))
      if (
        !["1-2", "1-3", "1-4", "2-3", "2-4", "3-4"].includes(pair) ||
        !Number.isFinite(limit) ||
        limit! <= 0
      )
        throw new RangeError("Invalid finger-pair limit");
  return {
    ...p,
    level,
    version: "scorify-player-1",
    calibrated: false,
    complexity,
    flexibility,
    suggestedQuarterBpm: r[8],
    familiarShapes: [...p.familiarShapes],
    ...(p.fingerPairMaxMm ? { fingerPairMaxMm: { ...p.fingerPairMaxMm } } : {}),
  };
}
export interface AdaptationPolicy {
  readonly preserveMelody: boolean;
  readonly protectedNoteIds: readonly string[];
  readonly allowMelodyOmission: boolean;
  readonly allowOrnamentOmission: boolean;
  readonly allowAccompanimentOmission: boolean;
  readonly allowOctaveShift: boolean;
  readonly octaveShifts: readonly number[];
  readonly allowRhythmSimplification: boolean;
  readonly rhythmGrid: Q;
  readonly maxOnsetDelay: Q;
  readonly allowHoldShortening: boolean;
  readonly gateRatios: readonly number[];
  readonly allowAddedOrnaments: false;
  readonly maxOmissions: number;
}
export function compileAdaptation(
  input: Partial<AdaptationPolicy> = {},
  level: Level = "maestro",
): AdaptationPolicy {
  const a: AdaptationPolicy = {
    preserveMelody: true,
    allowMelodyOmission: false,
    protectedNoteIds: [],
    allowOrnamentOmission: true,
    allowAccompanimentOmission: false,
    allowOctaveShift: false,
    octaveShifts: [-1, 1],
    allowRhythmSimplification: false,
    rhythmGrid: q(1, level === "beginner" ? 2 : 1),
    maxOnsetDelay: q(1),
    allowHoldShortening: false,
    gateRatios: [0.5, 0.75],
    allowAddedOrnaments: false,
    maxOmissions: Number.MAX_SAFE_INTEGER,
    ...input,
  };
  if (a.allowAddedOrnaments !== false)
    throw new RangeError("Added ornaments are not supported");
  for (const k of [
    "preserveMelody",
    "allowMelodyOmission",
    "allowOrnamentOmission",
    "allowAccompanimentOmission",
    "allowOctaveShift",
    "allowRhythmSimplification",
    "allowHoldShortening",
  ] as const)
    if (typeof a[k] !== "boolean") throw new RangeError(`Invalid ${k}`);
  if (
    !Number.isSafeInteger(a.maxOmissions) ||
    a.maxOmissions < 0 ||
    !Array.isArray(a.octaveShifts) ||
    a.octaveShifts.length > 6 ||
    a.octaveShifts.some((n) => !Number.isSafeInteger(n) || Math.abs(n) > 5) ||
    !Array.isArray(a.gateRatios) ||
    a.gateRatios.length > 8 ||
    a.gateRatios.some((n) => !Number.isFinite(n) || n <= 0 || n >= 1) ||
    !Array.isArray(a.protectedNoteIds) ||
    a.protectedNoteIds.some((s) => typeof s !== "string")
  )
    throw new RangeError("Invalid adaptation policy");
  if (compareQ(a.rhythmGrid, q(0)) <= 0 || compareQ(a.maxOnsetDelay, q(0)) < 0)
    throw new RangeError("Invalid adaptation rhythm");
  return a;
}
