import { FrettedInstrument } from './fretted.mjs';
import { PitchTrackerOptions, PitchReading } from './pitch-detect.mjs';
export { PITCH_PROCESSOR_NAME, PitchDetectOptions, PitchEstimate, PitchTracker, createPitchTracker, detectPitch, minimumWindow, pitchDetectOptions } from './pitch-detect.mjs';

interface TuningTarget {
    readonly stringId: string;
    /** Conventional tab number, 1 at the treble edge. */
    readonly number: number;
    /** Sounding open pitch with the capo applied, e.g. "E2"; the instrument's own spelling without a capo. */
    readonly pitch: string;
    readonly midi: number;
    readonly frequency: number;
}
interface TuningReading {
    readonly target: TuningTarget;
    /** Signed distance from the target, cents (positive: sharp). */
    readonly cents: number;
    readonly inTune: boolean;
}
interface ChromaticNote {
    readonly pitch: string;
    readonly midi: number;
    /** The equal-tempered frequency of that note. */
    readonly frequency: number;
    readonly cents: number;
}
/** Signed cents from `reference` to `frequency`. */
declare function centsFrom(frequency: number, reference: number): number;
/** The open strings to tune, in physical string order, as they should sound (capo included). */
declare function tuningTargets(instrument: FrettedInstrument, options?: {
    readonly concertAHz?: number;
}): TuningTarget[];
/** The target string closest to a frequency (in cents), and how far off it is. */
declare function nearestTarget(frequency: number, targets: readonly TuningTarget[], options?: {
    readonly toleranceCents?: number;
}): TuningReading | null;
/** The nearest equal-tempered note, for chromatic tuning. */
declare function chromaticNote(frequency: number, concertAHz?: number): ChromaticNote;
interface PitchInputReading extends PitchReading {
    /** AudioContext time at the end of the analysed window. */
    readonly contextTime: number;
}
interface PitchInputOptions extends Omit<PitchTrackerOptions, "sampleRate"> {
    /** Analyse this stream instead of asking for the microphone; it is not stopped by `stop()`. */
    readonly stream?: MediaStream;
    /** Or analyse any node of the same context. */
    readonly source?: AudioNode;
    /** Extra microphone constraints; echo cancellation, noise suppression and gain control are off by default. */
    readonly constraints?: MediaTrackConstraints;
    readonly workletUrl?: string | URL;
    readonly onPitch?: (reading: PitchInputReading) => void;
    readonly onError?: (error: Error) => void;
}
interface PitchInput {
    readonly node: AudioWorkletNode;
    /** The microphone stream this input opened, or the one passed in; null for a node source. */
    readonly stream: MediaStream | null;
    readonly stopped: boolean;
    /** Restart detection with new tracker options (for example the range of another instrument). */
    configure(options: Omit<PitchTrackerOptions, "sampleRate">): void;
    /** Disconnect, end the processor and release a microphone this input opened. Idempotent. */
    stop(): void;
}
/**
 * Detect the pitch of live audio in real time: the microphone (or a given stream or node) feeds the pitch-detector
 * AudioWorklet, which posts a reading per hop to `onPitch`. Ask from a user gesture: the browser asks the person for
 * the microphone, and an AudioContext may need resuming. Needs a secure context (HTTPS or localhost).
 */
declare function createPitchInput(context: AudioContext, options?: PitchInputOptions): Promise<PitchInput>;

export { PitchReading, PitchTrackerOptions, centsFrom, chromaticNote, createPitchInput, nearestTarget, tuningTargets };
export type { ChromaticNote, PitchInput, PitchInputOptions, PitchInputReading, TuningReading, TuningTarget };
//# sourceMappingURL=tuner.d.mts.map
