interface FrettedString {
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
interface FrettedInstrument {
    readonly kind: "fretted";
    readonly id: string;
    readonly name: string;
    /** Physical order from bass-side edge to treble-side edge, not pitch order. */
    readonly strings: readonly FrettedString[];
    /** Measured or explicitly selected nominal geometry; never assumed by presets. */
    readonly scaleLengthMm?: number;
    readonly stringSpacingMm?: number;
}
interface Position {
    readonly stringId: string;
    readonly stringNumber: number;
    readonly absoluteFret: number;
    readonly relativeFret: number;
    readonly effectiveOpen: boolean;
}
declare function validateInstrument(instrument: FrettedInstrument): void;
/** Enumerate pitch locations only. A location is not a verified hand fingering. */
declare function enumeratePositions(pitch: string, instrument: FrettedInstrument): Position[];
/** Ideal equal-tempered fret position from the original nut, in millimetres. */
declare function fretDistanceMm(scaleLengthMm: number, absoluteFret: number): number;

export { enumeratePositions, fretDistanceMm, validateInstrument };
export type { FrettedInstrument, FrettedString, Position };
//# sourceMappingURL=fretted.d.mts.map
