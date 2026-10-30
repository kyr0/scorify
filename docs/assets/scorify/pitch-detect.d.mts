/**
 * Monophonic pitch detection with YIN (de Cheveigné and Kawahara, 2002): the difference function, its cumulative
 * mean normalization, an absolute threshold on the first dip, and parabolic interpolation of the period. Host-neutral
 * and dependency-free, so the same code runs offline, in a Worker and in the AudioWorklet (scorify/pitch-worklet).
 */
/** The AudioWorklet processor name registered by scorify/pitch-worklet. */
declare const PITCH_PROCESSOR_NAME = "scorify-pitch-detector-v1";
interface PitchDetectOptions {
    /** Lowest frequency searched, Hz (default 40: below an 8-string guitar's F#1 tuned a quarter-tone flat). */
    readonly minFrequency?: number;
    /** Highest frequency searched, Hz (default 1500). */
    readonly maxFrequency?: number;
    /** YIN absolute threshold on the normalized difference (default 0.15); lower is stricter. */
    readonly threshold?: number;
    /** Below this RMS the window counts as silence (default 0.003, about -50 dBFS). */
    readonly minRms?: number;
}
interface PitchEstimate {
    /** Fundamental frequency, Hz. */
    readonly frequency: number;
    /** 1 minus the normalized difference at the chosen period: 1 is perfectly periodic. */
    readonly clarity: number;
    readonly rms: number;
}
declare function pitchDetectOptions(options?: PitchDetectOptions): Required<PitchDetectOptions>;
/** The window a detector needs: two of the longest periods searched. */
declare function minimumWindow(sampleRate: number, options?: PitchDetectOptions): number;
/**
 * The pitch of one window of samples, or null for silence or no clear period. The window must hold at least two
 * periods of `minFrequency` (`minimumWindow`); the DC offset is removed first.
 */
declare function detectPitch(samples: ArrayLike<number>, sampleRate: number, options?: PitchDetectOptions): PitchEstimate | null;
interface PitchTrackerOptions extends PitchDetectOptions {
    readonly sampleRate: number;
    /** Samples analysed per detection (default: `minimumWindow`; the cost of a detection grows with window × period). */
    readonly windowSize?: number;
    /** Samples between detections (default: a thirtieth of a second, at most the window). */
    readonly hopSize?: number;
    /** Readings under this clarity are reported without a frequency (default 0.8). */
    readonly minClarity?: number;
    /** Recent readings a smoothed frequency is the median of (default 5); 1 disables smoothing. */
    readonly smoothing?: number;
}
interface PitchReading {
    /** Smoothed frequency, Hz, or null for silence or no clear pitch. */
    readonly frequency: number | null;
    /** This window's own estimate, before smoothing. */
    readonly rawFrequency: number | null;
    readonly clarity: number;
    readonly rms: number;
    /** Input frames consumed when this window ended (its last sample is frame - 1). */
    readonly frame: number;
    readonly time: number;
}
interface PitchTracker {
    readonly options: Readonly<Required<Omit<PitchTrackerOptions, keyof PitchDetectOptions>>> & Required<PitchDetectOptions>;
    /** Append samples; returns one reading per completed hop. */
    push(samples: ArrayLike<number>): PitchReading[];
    /** Forget buffered audio and smoothing history. */
    reset(): void;
}
/**
 * Detect pitch on a stream of samples: a sliding window, one detection per hop, and a median over recent readings of
 * the same note (within a semitone), so a tuner's needle neither jumps between octaves nor jitters.
 */
declare function createPitchTracker(options: PitchTrackerOptions): PitchTracker;

export { PITCH_PROCESSOR_NAME, createPitchTracker, detectPitch, minimumWindow, pitchDetectOptions };
export type { PitchDetectOptions, PitchEstimate, PitchReading, PitchTracker, PitchTrackerOptions };
//# sourceMappingURL=pitch-detect.d.mts.map
