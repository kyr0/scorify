import { FrettedInstrument } from './fretted.mjs';

interface PresetOptions {
    readonly fretCount?: number;
    readonly capoFret?: number;
}
/** Construct configurable strings in physical order, including reentrant tunings. */
declare function createFrettedInstrument(id: string, name: string, tuning: readonly string[], options?: PresetOptions): FrettedInstrument;
/** 19 frets is an editable nominal default, not a claim about every concert uke. */
declare function concertUkulele(options?: PresetOptions & {
    readonly tuning?: "highG" | "lowG";
}): FrettedInstrument;
/** Custom tuning is in physical bass-edge to treble-edge order. */
declare function classicalGuitar(options?: PresetOptions & {
    readonly tuning?: readonly string[];
}): FrettedInstrument;

export { classicalGuitar, concertUkulele, createFrettedInstrument };
export type { PresetOptions };
//# sourceMappingURL=presets.d.mts.map
