/**
 * Practice sounds beside the strings: a sung line as a soft synthesized voice, and a metronome of a kick and a clap.
 * Host-neutral DSP, rendered offline sample by sample. A metronome click is a pure function of the time since it
 * started (its noise is seeded by its time), so any span of a render equals the same span of a longer one. The voice's
 * oscillators are too; only its lowpass filter carries state, which settles within milliseconds of a span's start.
 */
interface GuideAudio {
    readonly sampleRate: number;
    readonly channels: readonly [Float32Array, Float32Array];
    readonly durationSeconds: number;
}
/** The part of the timeline to render. */
interface GuideSpan {
    /** Where the rendered audio starts on the timeline, in seconds (default 0). */
    readonly startSeconds?: number;
    /** Seconds to render, in (0, 3600]. */
    readonly durationSeconds: number;
    /** Default 48000. */
    readonly sampleRate?: number;
    /** Linear output gain in [0, 4] (default 1). */
    readonly gain?: number;
}
/** A sung note at its sounding pitch. */
interface GuideNote {
    readonly onsetSeconds: number;
    readonly endSeconds: number;
    /** Hertz, in [20, 5000]. */
    readonly frequency: number;
    /** Loudness in [0, 1] (default 1). */
    readonly velocity?: number;
}
interface GuideVoiceOptions extends GuideSpan {
    /** The voice's lowpass corner in hertz, in [200, 20000] (default 1800): the overtones above it are softened. */
    readonly lowpassHz?: number;
}
type ClickKind = "kick" | "clap";
/** One metronome sound; an accented one (a bar's first beat) is louder. */
interface Click {
    readonly atSeconds: number;
    readonly kind: ClickKind;
    readonly accent?: boolean;
}
/** One click of a bar's pattern: its beat (in the meter's beats, from 0), sound and accent. */
interface PatternClick {
    readonly beat: number;
    readonly kind: ClickKind;
    readonly accent: boolean;
}
/**
 * The voice: a fundamental and three weaker overtones (an "oo" more than an "ee"), a vibrato that sets in after a
 * quarter of a second, a soft attack and release, then a two-pole lowpass, so it sings along without biting.
 */
declare const GUIDE_VOICE: {
    readonly harmonics: readonly [1, 0.32, 0.14, 0.06];
    readonly attackSeconds: 0.04;
    readonly releaseSeconds: 0.09;
    readonly vibratoHz: 5.2;
    readonly vibratoCents: 16;
    readonly vibratoDelaySeconds: 0.25;
    readonly vibratoRiseSeconds: 0.3;
    readonly lowpassHz: 1800;
    readonly lowpassQ: 0.6;
    readonly level: 0.07;
};
/**
 * The metronome, after defuss-shadcn's envelope compressor demo: a sine kick falling from 120 to 45 Hz in 0.15 s and
 * dying away in 0.4 s; a clap of white noise through a 1.8 kHz bandpass, three short bursts and a 0.18 s tail; each
 * through a compressor (−24 dB threshold, 4:1, 6 dB knee, 5 ms attack, 150 ms release, 6 dB makeup).
 */
declare const GUIDE_METRONOME: {
    readonly kick: {
        readonly fromHz: 120;
        readonly toHz: 45;
        readonly sweepSeconds: 0.15;
        readonly seconds: 0.4;
        readonly level: 0.9;
    };
    readonly clap: {
        readonly bandpassHz: 1800;
        readonly q: 1;
        readonly bursts: readonly [0, 0.011, 0.022];
        readonly burstSeconds: 0.012;
        readonly tailAt: 0.033;
        readonly tailSeconds: 0.18;
        readonly level: 0.6;
    };
    readonly compressor: {
        readonly thresholdDb: -24;
        readonly ratio: 4;
        readonly kneeDb: 6;
        readonly attackSeconds: 0.005;
        readonly releaseSeconds: 0.15;
        readonly makeupDb: 6;
    };
    readonly unaccented: 0.7;
    readonly level: 0.16;
};
/** Renders a sung line as the guide voice (mono, in both channels). Notes may overlap. Throws RangeError on bad input. */
declare function renderGuideVoice(notes: readonly GuideNote[], options: GuideVoiceOptions): GuideAudio;
/**
 * The metronome's clicks in one bar of a meter: a kick on the first beat (accented); in an even number of pulses a kick
 * on every other one and a clap between (4/4: kick, clap, kick, clap), otherwise claps after the first (3/4: kick,
 * clap, clap). Compound meters (6/8, 9/8, 12/8) click on their dotted pulses.
 */
declare function clickPattern(numerator: number, denominator: number): PatternClick[];
/** One bar of clicks that ends at `endSeconds`, at `beatSeconds` a beat: a count-in before a song or a loop. */
declare function countIn(numerator: number, denominator: number, beatSeconds: number, endSeconds: number): Click[];
/** Renders metronome clicks (mono, in both channels). Throws RangeError on bad input. */
declare function renderClicks(clicks: readonly Click[], span: GuideSpan): GuideAudio;

export { GUIDE_METRONOME, GUIDE_VOICE, clickPattern, countIn, renderClicks, renderGuideVoice };
export type { Click, ClickKind, GuideAudio, GuideNote, GuideSpan, GuideVoiceOptions, PatternClick };
//# sourceMappingURL=audio-guide.d.mts.map
