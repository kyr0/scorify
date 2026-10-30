import { detect } from "@tonaljs/chord-detect";
import { pitchToMidi } from "./pitch.js";
export { pitchToMidi, transposePitch } from "./pitch.js";

/**
 * Pitch-set candidates only, not temporal harmonic inference.
 * Sort by sounding pitch: Tonal uses the first supplied note as the bass.
 */
export function chordCandidates(pitches: readonly string[]): string[] {
  if (pitches.length === 0) return [];
  const ordered = pitches
    .map((pitch) => ({ pitch, midi: pitchToMidi(pitch) }))
    .sort((a, b) => a.midi - b.midi);
  return detect(ordered.map((note) => note.pitch));
}
