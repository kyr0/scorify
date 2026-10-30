/** Sounding scientific pitch, in MIDI range 0..127 for the research baseline. */
declare function pitchToMidi(pitch: string): number;
/** Spelled interval transposition; does not adapt an arrangement or its fingering. */
declare function transposePitch(pitch: string, interval: string): string;

/**
 * Pitch-set candidates only, not temporal harmonic inference.
 * Sort by sounding pitch: Tonal uses the first supplied note as the bass.
 */
declare function chordCandidates(pitches: readonly string[]): string[];

export { chordCandidates, pitchToMidi, transposePitch };
//# sourceMappingURL=theory.d.mts.map
