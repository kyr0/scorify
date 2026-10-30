import { validateInstrument } from "./fretted.js";
import type { FrettedInstrument } from "./fretted.js";

export interface PresetOptions {
  readonly fretCount?: number;
  readonly capoFret?: number;
}

/** Construct configurable strings in physical order, including reentrant tunings. */
export function createFrettedInstrument(
  id: string,
  name: string,
  tuning: readonly string[],
  options: PresetOptions = {},
): FrettedInstrument {
  const instrument: FrettedInstrument = {
    kind: "fretted",
    id,
    name,
    strings: tuning.map((openPitch, i) => ({
      id: `s${tuning.length - i}`,
      number: tuning.length - i,
      openPitch,
      fretCount: options.fretCount ?? 19,
      capoFret: options.capoFret ?? 0,
    })),
  };
  validateInstrument(instrument);
  return instrument;
}

/** 19 frets is an editable nominal default, not a claim about every concert uke. */
export function concertUkulele(
  options: PresetOptions & { readonly tuning?: "highG" | "lowG" } = {},
): FrettedInstrument {
  if (
    options.tuning !== undefined &&
    options.tuning !== "highG" &&
    options.tuning !== "lowG"
  ) {
    throw new RangeError("Ukulele tuning must be highG or lowG");
  }
  const lowG = options.tuning === "lowG";
  return createFrettedInstrument(
    lowG ? "ukulele-concert-low-g" : "ukulele-concert-high-g",
    lowG ? "Concert Ukulele — low G" : "Concert Ukulele — high G",
    [lowG ? "G3" : "G4", "C4", "E4", "A4"],
    options,
  );
}

/** Custom tuning is in physical bass-edge to treble-edge order. */
export function classicalGuitar(
  options: PresetOptions & { readonly tuning?: readonly string[] } = {},
): FrettedInstrument {
  return createFrettedInstrument(
    "classical-guitar",
    "Classical Guitar",
    options.tuning ?? ["E2", "A2", "D3", "G3", "B3", "E4"],
    options,
  );
}
