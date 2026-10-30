import { Score, Meter } from './model.mjs';
import { Q } from './index.mjs';
import { PlayerProfile } from './profiles.mjs';
import { FrettedInstrument } from './fretted.mjs';
import { FrettedAnnotation, FrettedAssignment, FingerContact } from './fingering.mjs';
import { ArrangementSuccess } from './arrange.mjs';
import { SynthesisInput, StringExcitation, AudioPreset, PluckTone } from './audio-dsp.mjs';
import './adapters.mjs';
import './transforms.mjs';

interface HumanizeOptions {
    readonly amount?: number;
    readonly timingMs?: number;
    readonly stringTimingMs?: number;
    readonly velocity?: number;
    readonly brightness?: number;
    readonly pluckPosition?: number;
    readonly decay?: number;
    /** Depth of the played dynamics: bar accents, melody and bass over inner notes, a strum's taper. */
    readonly dynamics?: number;
    /** Bound of the slow per-string pitch drift, in cents; always below one cent. */
    readonly driftCents?: number;
}
interface StrumOptions {
    readonly direction?: "down" | "up";
    /** First to last struck string. Default: from the local tempo and the strings the stroke covers. */
    readonly spreadSeconds?: number;
    readonly curve?: number;
    /** Fraction of the sweep's time that falls on the notated onset: 0 starts on it, 0.5 centers the sweep on it. */
    readonly anchor?: number;
    /** Velocity lost from the first to the last struck string at full dynamics (default 0.4 down, 0.3 up). */
    readonly taper?: number;
    /** Only these strings enter the sweep; other score attacks remain individual plucks. */
    readonly stringIds?: readonly string[];
    readonly velocity?: number;
    readonly muted?: boolean;
}
interface StrumStroke extends StrumOptions {
    readonly id: string;
    readonly at: Q;
}
interface PerformanceOptions {
    readonly seed?: string | number;
    readonly humanize?: number | HumanizeOptions;
    readonly strum?: StrumOptions | false;
    readonly strokes?: readonly StrumStroke[];
    readonly leadInSeconds?: number;
    readonly preset?: AudioPreset;
    readonly tone?: Partial<PluckTone>;
    readonly stringTone?: Readonly<Record<string, Partial<PluckTone>>>;
    readonly noteTone?: Readonly<Record<string, Partial<PluckTone>>>;
    readonly timingPolicy?: "constrain" | "strict";
    readonly maxNotes?: number;
    /**
     * Check the player's time-based limits (string attacks per second, shift and finger speed, finger setup time) at
     * the performance's own tempo (default true). False plays a fingering that was searched and validated at another
     * tempo, faster or slower, as a playback speed: the fingering itself (strings, frets, fingers, span, barres, notes
     * at once) and every check of the performance still apply, and the plan records that the time limits were lifted.
     */
    readonly timeLimits?: boolean;
}
interface PerformanceNote extends StringExcitation {
    readonly detuneCents: number;
    readonly noteIds: readonly string[];
    readonly nominalOnsetSeconds: number;
    readonly nominalEndSeconds: number;
    readonly offsetSeconds: number;
    readonly assignment: FrettedAssignment;
    readonly contact: FingerContact | null;
    readonly strokeId: string | null;
}
interface PerformedStroke {
    readonly id: string;
    readonly at: Q;
    readonly direction: "down" | "up";
    readonly noteIds: readonly string[];
    readonly spreadSeconds: number;
    readonly curve: number;
    readonly anchor: number;
    readonly taper: number;
}
interface PerformancePlan extends SynthesisInput {
    readonly schemaVersion: 1;
    readonly version: "scorify-performance-1";
    readonly score: Score;
    readonly instrument: FrettedInstrument;
    readonly profile: PlayerProfile;
    readonly annotations: readonly FrettedAnnotation[];
    readonly events: readonly PerformanceNote[];
    readonly strokes: readonly PerformedStroke[];
    readonly seed: string | number;
    readonly leadInSeconds: number;
    readonly preset: AudioPreset;
    readonly humanization: {
        readonly requested: Required<HumanizeOptions>;
        readonly timingScale: number;
    };
    readonly diagnostics: readonly string[];
    readonly constraints: {
        readonly valid: true;
        readonly model: string;
    };
    /** "lifted": validated without the player's time-based limits (`timeLimits: false`). */
    readonly timeLimits?: "lifted";
}
type PerformanceResult = {
    readonly status: "success";
    readonly performance: PerformancePlan;
} | {
    readonly status: "invalid-input" | "unplayable";
    readonly diagnostics: readonly string[];
};
/**
 * How strong a score time is in its bar: 1 on the downbeat, 0.6 on the middle of an even bar of four or more beats,
 * 0.3 on other beats, -0.3 halfway between beats (a third of a compound beat), -0.6 elsewhere. A first bar that is
 * shorter than the next one is a pickup and counts as the end of a bar of the next meter.
 */
declare function metricWeight(at: Q, meters: readonly Meter[]): number;
/**
 * A strum's sweep time when none is given: about a twentieth of a quarter note across all strings, between 12 and
 * 60 ms, so faster music strums faster; up-strokes are a fifth quicker, and a stroke over fewer strings is shorter.
 */
declare function strumSweepSeconds(quarterSeconds: number, direction: "down" | "up", coveredStrings: number, stringCount: number): number;
/** Expand an explicit rhythmic pattern; no inferred swing or random cumulative timing. */
declare function expandStrumPattern(pattern: {
    readonly id: string;
    readonly length: Q;
    readonly strokes: readonly (StrumOptions & {
        readonly offset: Q;
    })[];
}, repetitions: number, start?: Q): StrumStroke[];
/** Compile a selected fingering to deterministic performed timings, then replay actual mechanics. */
declare function createPerformance(arrangement: ArrangementSuccess, instrument: FrettedInstrument, options?: PerformanceOptions): PerformanceResult;
/** Reconstruct contact state at actual (not nominal) attack/release times. */
declare function validatePerformance(plan: PerformancePlan): {
    readonly valid: boolean;
    readonly diagnostics: readonly string[];
};

export { createPerformance, expandStrumPattern, metricWeight, strumSweepSeconds, validatePerformance };
export type { HumanizeOptions, PerformanceNote, PerformanceOptions, PerformancePlan, PerformanceResult, PerformedStroke, StrumOptions, StrumStroke };
//# sourceMappingURL=performance.d.mts.map
