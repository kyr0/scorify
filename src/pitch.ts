import { midi, transpose } from "@tonaljs/note";

/** Sounding scientific pitch, in MIDI range 0..127 for the research baseline. */
export function pitchToMidi(pitch: string): number {
  const value = midi(pitch);
  if (value === null || !Number.isInteger(value)) {
    throw new RangeError(
      `Expected a sounding pitch with octave in MIDI range: ${pitch}`,
    );
  }
  return value;
}

/** Spelled interval transposition; does not adapt an arrangement or its fingering. */
export function transposePitch(pitch: string, interval: string): string {
  pitchToMidi(pitch);
  const result = transpose(pitch, interval);
  if (!result) throw new RangeError(`Invalid interval: ${interval}`);
  pitchToMidi(result);
  return result;
}
