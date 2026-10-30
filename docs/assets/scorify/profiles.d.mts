import { Q } from './index.mjs';

type Level = "baby" | "beginner" | "amateur" | "semi-pro" | "pro" | "expert" | "maestro";
declare const levels: readonly Level[];
interface PlayerCapabilities {
    readonly maxFretSpan: number;
    readonly maxReachMm?: number;
    readonly maxShiftFretsPerSecond: number;
    readonly maxFingerSpeedMmPerSecond?: number;
    readonly fingerPairMaxMm?: Readonly<Partial<Record<"1-2" | "1-3" | "1-4" | "2-3" | "2-4" | "3-4", number>>>;
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
interface PlayerOptions {
    readonly level?: Level;
    readonly complexity?: number;
    readonly flexibility?: number;
    readonly overrides?: Partial<PlayerCapabilities>;
}
interface PlayerProfile extends PlayerCapabilities {
    readonly level: Level;
    readonly complexity: number;
    readonly flexibility: number;
    readonly version: "scorify-player-1";
    readonly calibrated: false;
    readonly suggestedQuarterBpm: number;
}
declare function compilePlayer(options?: PlayerOptions): PlayerProfile;
interface AdaptationPolicy {
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
declare function compileAdaptation(input?: Partial<AdaptationPolicy>, level?: Level): AdaptationPolicy;

export { compileAdaptation, compilePlayer, levels };
export type { AdaptationPolicy, Level, PlayerCapabilities, PlayerOptions, PlayerProfile };
//# sourceMappingURL=profiles.d.mts.map
