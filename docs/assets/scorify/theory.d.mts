/** Sounding scientific pitch, in MIDI range 0..127 for the research baseline. */
declare function pitchToMidi(pitch: string): number;
/** Spelled interval transposition; does not adapt an arrangement or its fingering. */
declare function transposePitch(pitch: string, interval: string): string;

/**
 * Pitch-set candidates only, not temporal harmonic inference.
 * Sort by sounding pitch: Tonal uses the first supplied note as the bass.
 */
declare function chordCandidates(pitches: readonly string[]): string[];
/**
 * A scale: its intervals above the tonic within an octave, ascending, and descending where they differ (the classical
 * melodic minor descends as the natural minor; the chromatic scale is spelled with sharps up and flats down).
 * `quality` chooses the tonic spellings (TONICS) and `mode` names the key of a score.
 */
interface Scale {
    readonly id: string;
    readonly name: string;
    readonly quality: "major" | "minor";
    readonly mode: string;
    readonly up: readonly string[];
    readonly down?: readonly string[];
}
declare const SCALES: readonly Scale[];
/** Tonics as usually written, C upward: the key with fewer accidentals (F♯ for the tritone, as major and minor). */
declare const TONICS: Readonly<Record<Scale["quality"], readonly string[]>>;
declare function scaleById(id: string): Scale;
/**
 * A scale's spelled pitches from `tonic` (a pitch with octave) over whole octaves: up to the top tonic, then (with
 * `direction` "up-down") back down to the tonic. Every degree keeps its letter (F♯ major has E♯, A blues E♭).
 */
declare function scalePitches(tonic: string, scale: Scale | string, { octaves, direction }?: {
    octaves?: number;
    direction?: "up" | "up-down";
}): string[];

export { SCALES, TONICS, chordCandidates, pitchToMidi, scaleById, scalePitches, transposePitch };
export type { Scale };
//# sourceMappingURL=theory.d.mts.map
