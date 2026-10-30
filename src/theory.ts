import { detect } from "@tonaljs/chord-detect";
import { pitchToMidi, transposePitch } from "./pitch.js";
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

/**
 * A scale: its intervals above the tonic within an octave, ascending, and descending where they differ (the classical
 * melodic minor descends as the natural minor; the chromatic scale is spelled with sharps up and flats down).
 * `quality` chooses the tonic spellings (TONICS) and `mode` names the key of a score.
 */
export interface Scale {
  readonly id: string;
  readonly name: string;
  readonly quality: "major" | "minor";
  readonly mode: string;
  readonly up: readonly string[];
  readonly down?: readonly string[];
}
const MAJOR = ["1P", "2M", "3M", "4P", "5P", "6M", "7M"],
  MINOR = ["1P", "2M", "3m", "4P", "5P", "6m", "7m"];
export const SCALES: readonly Scale[] = [
  { id: "major", name: "Major", quality: "major", mode: "major", up: MAJOR },
  { id: "natural-minor", name: "Natural minor", quality: "minor", mode: "minor", up: MINOR },
  { id: "harmonic-minor", name: "Harmonic minor", quality: "minor", mode: "minor", up: ["1P", "2M", "3m", "4P", "5P", "6m", "7M"] },
  { id: "melodic-minor", name: "Melodic minor", quality: "minor", mode: "minor", up: ["1P", "2M", "3m", "4P", "5P", "6M", "7M"], down: MINOR },
  { id: "major-pentatonic", name: "Major pentatonic", quality: "major", mode: "major", up: ["1P", "2M", "3M", "5P", "6M"] },
  { id: "minor-pentatonic", name: "Minor pentatonic", quality: "minor", mode: "minor", up: ["1P", "3m", "4P", "5P", "7m"] },
  { id: "blues", name: "Blues", quality: "minor", mode: "minor", up: ["1P", "3m", "4P", "5d", "5P", "7m"] },
  { id: "dorian", name: "Dorian", quality: "minor", mode: "dorian", up: ["1P", "2M", "3m", "4P", "5P", "6M", "7m"] },
  { id: "phrygian", name: "Phrygian", quality: "minor", mode: "phrygian", up: ["1P", "2m", "3m", "4P", "5P", "6m", "7m"] },
  { id: "lydian", name: "Lydian", quality: "major", mode: "lydian", up: ["1P", "2M", "3M", "4A", "5P", "6M", "7M"] },
  { id: "mixolydian", name: "Mixolydian", quality: "major", mode: "mixolydian", up: ["1P", "2M", "3M", "4P", "5P", "6M", "7m"] },
  { id: "locrian", name: "Locrian", quality: "minor", mode: "locrian", up: ["1P", "2m", "3m", "4P", "5d", "6m", "7m"] },
  {
    id: "chromatic", name: "Chromatic", quality: "major", mode: "major",
    up: ["1P", "1A", "2M", "2A", "3M", "4P", "4A", "5P", "5A", "6M", "6A", "7M"],
    down: ["1P", "2m", "2M", "3m", "3M", "4P", "5d", "5P", "6m", "6M", "7m", "7M"],
  },
];
/** Tonics as usually written, C upward: the key with fewer accidentals (F♯ for the tritone, as major and minor). */
export const TONICS: Readonly<Record<Scale["quality"], readonly string[]>> = {
  major: ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"],
  minor: ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"],
};
export function scaleById(id: string): Scale {
  const scale = SCALES.find((s) => s.id === id);
  if (!scale) throw new RangeError(`Unknown scale: ${id}`);
  return scale;
}
/**
 * A scale's spelled pitches from `tonic` (a pitch with octave) over whole octaves: up to the top tonic, then (with
 * `direction` "up-down") back down to the tonic. Every degree keeps its letter (F♯ major has E♯, A blues E♭).
 */
export function scalePitches(
  tonic: string,
  scale: Scale | string,
  { octaves = 1, direction = "up-down" }: { octaves?: number; direction?: "up" | "up-down" } = {},
): string[] {
  const { up, down = up } = typeof scale === "string" ? scaleById(scale) : scale;
  if (!Number.isSafeInteger(octaves) || octaves < 1) throw new RangeError(`Invalid octave count: ${octaves}`);
  pitchToMidi(tonic);
  const base = (o: number) => (o ? transposePitch(tonic, `${1 + 7 * o}P`) : tonic);
  const rising = Array.from({ length: octaves }, (_, o) => up.map((i) => transposePitch(base(o), i))).flat();
  const top = base(octaves);
  if (direction === "up") return [...rising, top];
  const falling = Array.from({ length: octaves }, (_, k) => octaves - 1 - k).flatMap((o) =>
    down.slice(1).reverse().map((i) => transposePitch(base(o), i)).concat(base(o)),
  );
  return [...rising, top, ...falling];
}
