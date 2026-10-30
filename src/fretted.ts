import { pitchToMidi } from "./pitch.js";

export interface FrettedString {
  readonly id: string;
  /** Conventional tab number, 1 at the treble edge; never inferred from pitch. */
  readonly number: number;
  /** Sounding pitch at the original nut, before capo. */
  readonly openPitch: string;
  /** Absolute last fret measured from the original nut. */
  readonly fretCount: number;
  /** Absolute fret of the effective nut; 0 means no capo. */
  readonly capoFret: number;
}

export interface FrettedInstrument {
  readonly kind: "fretted";
  readonly id: string;
  readonly name: string;
  /** Physical order from bass-side edge to treble-side edge, not pitch order. */
  readonly strings: readonly FrettedString[];
  /** Measured or explicitly selected nominal geometry; never assumed by presets. */
  readonly scaleLengthMm?: number;
  readonly stringSpacingMm?: number;
}

export interface Position {
  readonly stringId: string;
  readonly stringNumber: number;
  readonly absoluteFret: number;
  readonly relativeFret: number;
  readonly effectiveOpen: boolean;
}

function nonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
}

export function validateInstrument(instrument: FrettedInstrument): void {
  if (
    instrument.kind !== "fretted" ||
    !instrument.id ||
    !instrument.name ||
    instrument.strings.length === 0
  ) {
    throw new RangeError("Expected a named fretted instrument with strings");
  }
  for (const value of [instrument.scaleLengthMm, instrument.stringSpacingMm]) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0))
      throw new RangeError("Geometry must be positive and finite");
  }
  const ids = new Set<string>();
  const numbers = new Set<number>();
  for (const string of instrument.strings) {
    if (!string.id || ids.has(string.id))
      throw new RangeError("String IDs must be unique");
    nonnegativeInteger(string.number, "String number");
    if (string.number < 1 || numbers.has(string.number)) {
      throw new RangeError("String numbers must be unique positive integers");
    }
    ids.add(string.id);
    numbers.add(string.number);
    pitchToMidi(string.openPitch);
    nonnegativeInteger(string.fretCount, "Fret count");
    nonnegativeInteger(string.capoFret, "Capo fret");
    if (string.capoFret > string.fretCount)
      throw new RangeError("Capo exceeds final fret");
  }
}

/** Enumerate pitch locations only. A location is not a verified hand fingering. */
export function enumeratePositions(
  pitch: string,
  instrument: FrettedInstrument,
): Position[] {
  validateInstrument(instrument);
  const target = pitchToMidi(pitch);
  return instrument.strings.flatMap((string) => {
    const fret = target - pitchToMidi(string.openPitch);
    if (fret < string.capoFret || fret > string.fretCount) return [];
    return [
      {
        stringId: string.id,
        stringNumber: string.number,
        absoluteFret: fret,
        relativeFret: fret - string.capoFret,
        effectiveOpen: fret === string.capoFret,
      },
    ];
  });
}

/** Ideal equal-tempered fret position from the original nut, in millimetres. */
export function fretDistanceMm(
  scaleLengthMm: number,
  absoluteFret: number,
): number {
  if (!Number.isFinite(scaleLengthMm) || scaleLengthMm <= 0) {
    throw new RangeError("Scale length must be positive and finite");
  }
  nonnegativeInteger(absoluteFret, "Fret");
  return scaleLengthMm * (1 - 2 ** (-absoluteFret / 12));
}
