import { SearchOptions, ArrangementResult, ArrangementSuccess, ArrangementOptions } from './arrange.mjs';
import { Score } from './model.mjs';
import { Tempo, Q } from './index.mjs';
import { ScaleDirection } from './theory.mjs';
import { Level, PlayerCapabilities, AdaptationPolicy, PlayerOptions } from './profiles.mjs';
import { FrettedInstrument } from './fretted.mjs';
import { TransformOptions } from './transforms.mjs';
import { FrettedAnnotation } from './fingering.mjs';
import './adapters.mjs';

/** Tones of a voicing by string, bass edge first: 0 the lowest played string, -1 the highest; "all" every string. */
type Tones = "all" | readonly number[];
/** A pattern hit, `at` quarters after the bar line; with a stroke it is strummed, without it picked. */
interface Hit {
    readonly at: number;
    readonly tones: Tones;
    readonly stroke?: "down" | "up";
    /** Quarters the strings ring (a chop or a skank); otherwise until struck again or the chord ends. */
    readonly length?: number;
}
/** An alternating bass hit: the voicing's root, its fifth (below when the strings reach it) or a semitone into the next root. */
interface BassHit {
    readonly at: number;
    readonly tone: "root" | "fifth" | "approach";
}
/** Every `every`-th bar (or the listed `bars`), the hits from `from` on give way to a sixteenth run of scale `steps`. */
interface Fill {
    readonly from: number;
    readonly steps: readonly number[];
    readonly every?: number;
    readonly bars?: readonly number[];
}
/**
 * Single tones at `at` (quarters after the bar line), walking the strings of whatever voicing sounds: up from the bass,
 * down from the top, or up and back; it starts again at every chord.
 */
interface Arpeggio {
    readonly direction: "up" | "down" | "up-down";
    readonly at: readonly number[];
}
/** The layers one version plays over the chords. */
interface VersionLayers {
    readonly pattern: readonly Hit[];
    /** Picked in place of the pattern, over every voicing's strings. */
    readonly arpeggio?: Arpeggio;
    /** The hit a held bar strikes once (else the first hit of the pattern). */
    readonly hold?: Hit;
    readonly bass?: readonly BassHit[];
    readonly fill?: Fill;
    /** Quarters a tone lets go before the chord changes (at most half its length). */
    readonly release?: number;
    /** Play the song's `simpleProgression`. */
    readonly simple?: boolean;
    /** Count a strum once against the attack rate (versions that only strum); reported with every arrangement. */
    readonly countStrokes?: boolean;
}
interface SongVersion extends VersionLayers {
    readonly id: string;
    readonly difficulty: Level;
    readonly label: string;
    readonly estimated?: boolean;
}
/** A sung note: onset and length in quarters from the start, sounding pitch, and its syllable (or one per verse). */
type VocalEntry = readonly [onset: number, length: number, pitch: string, words: string | readonly string[]];
interface PieceBase {
    readonly id: string;
    readonly title: string;
    readonly credit?: string;
    readonly description?: string;
    /** The catalog instrument a piece opens on (see INSTRUMENTS). */
    readonly instrument: string;
    readonly time: readonly [number, number];
    /** Quarters per counted beat (1.5 in 6/8). */
    readonly beat: number;
    /** The piece's own tempo in counted beats per minute. */
    readonly bpm: number;
    /** Quarters a tab pads before the first bar so bar lines fall where written. */
    readonly pad?: number;
    /** Lines reported with every arrangement of the piece. */
    readonly notes?: readonly string[];
    readonly lyricLanguages?: readonly string[];
}
/**
 * A chord-chart song: a bar of chords for every bar ("C Am": two halves; "N.C.": silent), the key for fills, and its
 * versions. `holds` are bars (from 1) that strike once per chord and ring; `ending` is one more held bar.
 */
interface ChordSong extends PieceBase {
    readonly kind?: "song" | "chart";
    readonly key: string;
    readonly mode: "major" | "minor";
    readonly pickup?: number;
    readonly progression: readonly string[];
    readonly simpleProgression?: readonly string[];
    readonly ending?: string;
    readonly holds?: readonly number[];
    readonly tempoMap?: readonly Tempo[];
    readonly versions: readonly SongVersion[];
    readonly vocal?: readonly VocalEntry[];
    readonly source?: unknown;
}
/** A chord song with one version's layers: what a source score is made from. */
type SongSpec = ChordSong & VersionLayers;
interface ScoreVersion {
    readonly id: string;
    readonly difficulty: Level;
    readonly label: string;
    readonly score: Score;
    readonly estimated?: boolean;
}
interface Texture {
    readonly key: string;
    readonly label: string;
    readonly notes: number;
}
interface ScoreSource {
    source: Score;
    gated: number;
    left: number;
    vocal: VocalEntry[];
    sung: number;
}
/** An imported score or score set; its versions are scores. `texture` is the chosen voices. */
interface ScorePiece extends PieceBase {
    readonly kind: "score";
    readonly score: Score;
    readonly versions: readonly ScoreVersion[];
    readonly textures: readonly Texture[];
    texture: string;
    readonly level: Level;
    readonly rhythm: string;
    /** The piece's chords, inferred from its hardest version and strummed: what baby and beginner play first. */
    readonly chords?: ChordSong;
    /** A practice exercise (scalePiece), made for one instrument's range: played as written or reported, never simplified or moved. */
    readonly exercise?: boolean;
    sources?: Map<string, ScoreSource>;
}
type Piece = ChordSong | ScorePiece;
/** Hit helpers: a down or up strum of `tones` (default every string), or a pick of single tones. */
declare const ALL = "all";
declare const down: (at: number, tones?: Tones) => Hit;
declare const up: (at: number, tones?: Tones) => Hit;
declare const pick: (at: number, ...tones: number[]) => Hit;
interface CatalogInstrument {
    readonly id: string;
    readonly group: string;
    readonly name: string;
    readonly short: string;
    readonly create: () => FrettedInstrument;
}
/** Fretted instruments by id, in physical string order, each with a usual highest fret (ukuleles 18, guitars 19, mandolin 20). */
declare const INSTRUMENTS: readonly CatalogInstrument[];
/**
 * The instrument for a catalog id, or a composite one from customInstrumentId ("guitar~capo2~frets15~tuningD2.A2.D3.G3.B3.E4").
 * Instruments are cached and shared; treat them as immutable.
 */
declare function instrumentFor(id: string): FrettedInstrument;
/**
 * The id of a catalog instrument with a capo, a highest fret other than its own (`frets`, a hard limit) and a custom
 * tuning (spelled pitches, bass edge first).
 */
declare const customInstrumentId: (base: string, { capo, frets, tuning }?: {
    capo?: number;
    frets?: number | undefined;
    tuning?: readonly string[] | undefined;
}) => string;
/** A catalog instrument's own highest fret. */
declare const highestFret: (id: string) => number;
/** Each difficulty's starting tempo as a share of the piece's own: maestro plays 20% faster. An editable policy. */
declare const LEVEL_TEMPO: Readonly<Partial<Record<Level, number>>>;
/** The tempo a difficulty starts at, in the piece's beats per minute. */
declare const tempoFor: (piece: Piece, level: Level) => number;
/** The spelled interval of a number of semitones, compound beyond an octave ("9M": an octave and a whole tone). */
declare function intervalOf(semitones: number): string;
/** A chord symbol moved by an interval, spelled plainly (no double accidentals, E♯, B♯, C♭ or F♭). */
declare const transposeSymbol: (symbol: string, interval: string) => string;
declare const NO_CHORD = "N.C.";
/** A song moved by semitones: its chords, key and sung pitches (fills follow the key). Voicings are found again. */
declare function transposeSong<T extends ChordSong>(song: T, semitones?: number): T;
/** The keys the key selector offers: from a tritone down to a fourth up, the piece's own key at 0. */
declare const KEY_SHIFTS: readonly number[];
/** A piece's key moved by semitones ("Eb major"), or null when the piece does not say its key. */
declare function keyName(piece: Piece, semitones?: number): string | null;
declare const barQuarters: (song: {
    readonly time: readonly [number, number];
}) => number;
/** Where bar `b` starts, in quarters: after the pickup, if the song has one. */
declare const barStart: (song: ChordSong, b: number) => number;
/** Every bar's chords: the progression, then the ending. */
declare const barsOf: (song: ChordSong) => readonly string[];
interface Segment {
    readonly symbol: string;
    readonly from: number;
    readonly to: number;
}
/** The chords of bar `b`, sharing it evenly, from and to in quarters after its bar line; "N.C." leaves its part silent. */
declare function segmentsOf(song: ChordSong, b: number): Segment[];
interface ChordTones {
    readonly names: readonly string[];
    readonly classes: readonly number[];
    readonly bass: number;
    readonly required: readonly number[];
}
/** The spelled tones of a chord symbol (triads, sevenths, half-diminished sevenths, sixths, sus, dim, aug, slash bass). */
declare function chordTones(symbol: string): ChordTones;
type Fret = number | "x";
interface Proposal {
    frets: Fret[];
    pitches: number[];
    rank: number[];
}
/**
 * Chord shapes on contiguous string runs, ranked like a chord book: root (or fifth) in the bass on five or more
 * strings, no unison on neighbouring strings, nothing above the fourth fret, more strings, no barre, fewer fretted
 * notes, lower frets. A span over three frets is never proposed; more than four fretted notes need a barre.
 */
declare function chordShapes(instrument: FrettedInstrument, tones: ChordTones, { maxFret, maxNotes, inBass }: {
    maxFret: number;
    maxNotes: number;
    inBass?: number;
}): Proposal[];
interface Voicing {
    readonly symbol: string;
    readonly frets: readonly Fret[];
    readonly pitches: readonly string[];
    /** The chord tone asked for in the bass (0 the root, 1 the third, 2 the fifth, 3 the seventh or sixth). */
    readonly inversion?: number;
}
/** Names of the inversions by the chord tone in the bass. */
declare const INVERSION_NAMES: readonly string[];
/** Which chord tone a voicing has in the bass (its lowest sounding pitch): 0 the root, 1 the third, …; -1 another tone. */
declare function chordInversion(symbol: string, pitches: readonly string[]): number;
/** Inversions asked for, by chord segment (segmentKey): which chord tone goes in the bass. */
type Inversions = Readonly<Record<string, number>>;
/** A chord segment's key: its bar and its place in the bar, from 1, and its symbol ("3.1:Eb"). */
declare const segmentKey: (b: number, s: number, symbol: string) => string;
/**
 * The first proposed shape scorify can play as one chord under this level (the rhythm is checked with the song); with
 * `inversion`, only shapes with that chord tone in the bass.
 */
declare function voiceChord(symbol: string, instrumentId: string, { level, rightHand, inversion }: {
    level: Level;
    rightHand: "strum" | "pick";
    inversion?: number;
}): Voicing | null;
/** Every part of the voicings a pattern can sound, as shape signatures ("x-2-3-2"): the player's familiar shapes. */
declare function familiarShapes(voicings: Readonly<Record<string, Voicing>>): string[];
/**
 * The voicing of every chord a song plays, by symbol (and "symbol@inversion" for a segment with an inversion asked
 * for), or the chord no voicing was found for.
 */
declare function voicingsForSong(song: SongSpec, instrumentId: string, level: Level, inversions?: Inversions): {
    voicings: Record<string, Voicing>;
    missing?: never;
} | {
    missing: string;
    voicings?: never;
};
/** A chord segment as played: where it starts (quarters), its symbol, how many tones it has and which one is in the bass. */
interface ChordSegment {
    readonly key: string;
    readonly symbol: string;
    readonly at: number;
    readonly tones: number;
    readonly inversion: number;
    /** The inversion was asked for. */
    readonly asked: boolean;
}
/**
 * One version of a song as a score: its bars of chords with the version's layers (pattern, alternating bass, fills),
 * ending on a held chord. Roles say what may go first if it is simplified: fills are ornaments, the pattern harmony,
 * the bass line bass. The sung part is not in it.
 */
declare function sourceFor(song: SongSpec, voicings: Readonly<Record<string, Voicing>>, instrument: FrettedInstrument, inversions?: Inversions): Score;
declare const SET_SCHEMA = "scorify-set-1";
interface ScoreSet {
    readonly schema: typeof SET_SCHEMA;
    readonly title?: string;
    readonly composer?: string;
    readonly variants: readonly {
        readonly id: string;
        readonly difficulty: Level;
        readonly label?: string;
        readonly score: Score;
    }[];
}
/** The lowest level whose attack rate and polyphony limits a score stays within: an estimate before any fingering. */
declare function estimateLevel(score: Score): Level;
/**
 * A piece from a normalized Score or a score set of normalized scores. A single score is one version at its estimated
 * difficulty. With inner voices it offers all voices, melody and bass (the default), or melody only.
 */
declare function pieceFromScore(input: Score | ScoreSet, { id, instrument }?: {
    id?: string;
    instrument?: string;
}): ScorePiece;
declare const CHART_SCHEMA = "scorify-chart-1";
interface ChordChart {
    readonly schema: typeof CHART_SCHEMA;
    readonly id?: string;
    readonly instrument?: string;
    readonly title?: string;
    readonly credit?: string;
    readonly description?: string;
    readonly key: string;
    readonly mode: "major" | "minor";
    readonly bpm?: number;
    readonly progression: readonly string[];
    readonly simpleProgression?: readonly string[];
    readonly holds?: readonly number[];
    readonly versions: readonly (Omit<SongVersion, "id"> & {
        readonly id?: string;
    })[];
    readonly vocalTranspose?: readonly {
        readonly bars: readonly [number, number];
        readonly interval: string;
        readonly reason: string;
    }[];
    /** The tune's path through a choir's sung parts: the part shown in each span of bars (from 1), and why. */
    readonly sungLine?: {
        readonly parts: readonly {
            readonly part: string;
            readonly bars: readonly [number, number];
        }[];
        readonly reason: string;
    };
    /** The language of each verse's words, when the score does not say. */
    readonly lyricLanguages?: readonly string[];
}
/**
 * A song from a chord chart (schema "scorify-chart-1") and the normalized score it was written for: the chart's
 * versions are played under the score's sung part, words and tempo map; its other parts are not played. The chart needs
 * a bar of chords for every bar of the score; `vocalTranspose` moves (and reports) a sung passage written in another key,
 * `sungLine` shows one sung part per span of bars (a tune passed between choir parts) instead of every sung part.
 */
declare function songFromChart(chart: ChordChart, score: Score, { id, instrument }?: {
    id?: string | undefined;
    instrument?: string | undefined;
}): ChordSong;
/** What a simplified arrangement may change by default: fills, accompaniment notes, octaves. The melody is kept. */
declare const SIMPLIFY: Partial<AdaptationPolicy>;
/** Search tiers: the first try, a quick first tier for long adaptive imports, and the wider retries on exhaustion. */
declare const SEARCH: SearchOptions;
declare const QUICK: SearchOptions;
declare const WIDE: SearchOptions;
declare const DEEP: SearchOptions;
/**
 * The first try for arpeggio versions. An arpeggio adds one note a frame, so a narrow beam settles on what is cheap
 * for the first notes of a chord (open strings) and keeps stretches it would never choose for the whole shape: at 32
 * the ukulele's root-position F (2553) became 0-1-9-5, an eight-fret span; at 512 it is played in fifth position.
 */
declare const ARPEGGIO_SEARCH: SearchOptions;
declare const RETRIES: readonly SearchOptions[];
/** Settings that replace what a request otherwise uses; every one is reported in an attempt's notes. */
interface CustomSettings {
    /** Play this version only. */
    readonly version?: string;
    /** "exact": versions as written only; "adaptive": simplify the first version. */
    readonly mode?: "exact" | "adaptive";
    /** Semitones: chord symbols, key and sung pitches move; voicings are found again. */
    readonly transpose?: number;
    /** Sounding pitches, bass edge first. */
    readonly tuning?: readonly string[];
    readonly complexity?: number;
    readonly flexibility?: number;
    readonly overrides?: Partial<PlayerCapabilities>;
    readonly adaptation?: Partial<AdaptationPolicy>;
    /** Run as given, without the wider retries. */
    readonly search?: Partial<SearchOptions>;
}
interface ArrangeRequest {
    readonly instrumentId: string;
    readonly level: Level;
    /** Counted beats per minute. */
    readonly bpm: number;
    readonly texture?: string | undefined;
    /** Capo fret: the song keeps its key and is fingered as lower shapes. */
    readonly capo?: number;
    /** Semitones to move the piece into another key (custom settings' transpose wins). */
    readonly transpose?: number;
    /** The instrument's highest fret, a hard limit; its own (highestFret) when left out. */
    readonly frets?: number | undefined;
    /** Chords to play in another inversion, by segment (segmentKey); a chord song's chords only. */
    readonly inversions?: Inversions | undefined;
    readonly custom?: CustomSettings | null;
}
type AnyVersion = SongVersion | ScoreVersion;
interface PreparedAttempt {
    readonly source: Score;
    readonly spec: SongSpec | ScorePiece;
    /** Notes of the version as written (sung notes excluded). */
    readonly total: number;
    readonly vocal: readonly VocalEntry[];
    /** What the arrangement changes or assumes, one line each. */
    readonly notes: readonly string[];
    /** A chord song's chords as played, with their inversions. */
    readonly chords?: readonly ChordSegment[];
    readonly options: ArrangementOptions & {
        readonly instrument: FrettedInstrument;
        readonly mode: "exact" | "adaptive";
        readonly player: PlayerOptions;
        readonly transform: TransformOptions;
        readonly search: SearchOptions;
    };
    readonly missing?: never;
}
type Prepared = PreparedAttempt | {
    readonly missing: string;
};
/** The versions to try for a difficulty, best first: the one written for it (or the nearest easier one), then easier ones. */
declare function versionsFor(piece: Piece, level: Level): AnyVersion[];
/**
 * Everything one attempt needs: the source score and arrange() options, or why there is none. `simplify: false`
 * arranges the version as written (exact mode); `simplify: true` lets scorify simplify it (adaptive mode). A song's
 * voicings come from the chord finder at the difficulty; an imported score is moved by whole octaves into range.
 */
declare function prepare(piece: Piece, request: ArrangeRequest & {
    version?: AnyVersion;
    simplify?: boolean;
    search?: SearchOptions;
}): Prepared;
/** The hardest version of a piece (the last of the hardest difficulty). */
declare const hardestVersion: (piece: Piece) => AnyVersion;
/** How many notes the hardest version plays as written for a request's instrument, capo and custom settings, or null without a chord shape. */
declare function hardestNotes(piece: Piece, request: ArrangeRequest): number | null;
/** JSON with object keys in sorted order, so equal values serialize alike everywhere. */
declare const stableJson: (input: unknown) => string;
/** A 106-bit fingerprint of any JSON value: a cache key, not a security measure. */
declare const fingerprint: (input: unknown) => string;
/** What makes a piece itself: everything but its caches, the chosen voices and where it came from (`origin`, `cacheBase`). */
declare function pieceFingerprint(piece: Piece): string;
/**
 * The cache key of a request: the piece, instrument, difficulty, voices, key, capo, highest fret (when not the
 * instrument's own) and custom settings; not the tempo, which is playback only.
 */
declare const cacheKey: (piece: Piece, { instrumentId, level, texture, capo, transpose, frets, inversions, custom }: ArrangeRequest) => string;
/** An attempt's inputs and the build that searches them: equal fingerprints give equal results. */
declare const attemptFingerprint: (prepared: PreparedAttempt, build?: string) => string;
type AttemptStatus = ArrangementResult["status"] | "voicing" | "limits";
interface LogEntry {
    readonly version: string;
    readonly simplify: boolean;
    readonly status: AttemptStatus;
    readonly detail?: string;
    readonly fingerprint?: string;
    readonly replayed?: boolean;
    readonly result?: RunResult;
    /** Searched again without the difficulty's preference for low positions (`highFretCosts`), after a search that ran out with it. */
    readonly anyPosition?: boolean;
}
/** A successful arrangement; `retimed` says at which tempo (the piece's own) a result played at another one was searched. */
type RunResult = ArrangementSuccess<FrettedAnnotation> & {
    readonly retimed?: {
        readonly fromBpm: number;
    };
};
interface Run {
    readonly status: AttemptStatus | "stale";
    readonly log: LogEntry[];
    readonly result?: RunResult;
    readonly prepared?: PreparedAttempt;
    readonly version?: AnyVersion;
    readonly simplify?: boolean;
}
type SuccessfulRun = Run & {
    readonly status: "success";
    readonly result: RunResult;
    readonly prepared: PreparedAttempt;
    readonly version: AnyVersion;
    readonly simplify: boolean;
};
interface RunOptions {
    /** Searches one attempt: a worker client, or scorify's arrange directly. */
    readonly arrange: (source: Score, options: ArrangementOptions) => Promise<ArrangementResult> | ArrangementResult;
    /** An earlier run's log: an attempt with the same inputs is replayed, not searched. */
    readonly replay?: readonly LogEntry[];
    /** Check a replayed fingering with validateFrettedArrangement first (default true). */
    readonly verify?: boolean;
    /** Identifies the solver build in attempt fingerprints, so a new build searches again. */
    readonly build?: string;
    readonly isCurrent?: () => boolean;
    readonly onAttempt?: (attempt: {
        version: AnyVersion;
        simplify: boolean;
    }) => unknown;
    readonly onRetry?: (tier: number) => unknown;
}
/**
 * The arrangement for a request: the version written for the difficulty (or the nearest easier one) as written, then
 * each easier version, then the easiest one simplified. `custom.version` and `custom.mode` narrow that. Attempts whose
 * source exceeds the difficulty's attack rate, polyphony or picked notes per bar are not searched. Every attempt is
 * searched at the piece's own tempo and the result played at the request's (playAt). An imported score's strummed
 * chords are tried first at baby and beginner, and after everything else above. Returns the log of attempts
 * (the successful one carries its result) and, on success, the result, prepared attempt and version.
 */
declare function arrangeFor(piece: Piece, asked: ArrangeRequest, options: RunOptions): Promise<Run>;
/** A version of a piece by id, chord versions of an imported score included. */
declare const versionById: (piece: Piece, id: string) => AnyVersion | undefined;
/**
 * The shown arrangement at another tempo, without a search: tempo is playback only. `shown` is a successful run with
 * its `request`; null when `request` differs from it in more than `bpm`.
 */
declare function retime(piece: Piece, shown: SuccessfulRun & {
    readonly request: ArrangeRequest;
}, request: ArrangeRequest): SuccessfulRun | null;
/** Did a run search anything, or did it only replay its log? */
declare const searched: (log: readonly LogEntry[]) => boolean;
/** A log as it is kept: without the replay marks. */
declare const cacheable: (log: readonly LogEntry[]) => LogEntry[];
/** Exported arrangements: a request, the piece it was made for and the log with its result. */
declare const ARRANGEMENT_SCHEMA = "scorify-arrangement-1";
interface CapoSuggestion {
    readonly capo: number;
    /** The shapes the hand holds, in order of first use. */
    readonly shapes: readonly string[];
    /** The chords they sound. */
    readonly chords: readonly string[];
    /** Chords that are not open chords without the capo and with it. */
    readonly hard: readonly [number, number];
}
/**
 * A capo that makes a song's chords easier to hold: the fret that leaves the fewest non-open chord shapes, then the
 * cheapest shapes weighted by how long each chord sounds; suggested only when it leaves fewer such chords and costs no
 * more. A heuristic about shapes, not a measured ease. Null without a better fret, for imported scores and custom tunings.
 */
declare function suggestCapo(piece: Piece, request: {
    instrumentId: string;
    level: Level;
    version?: AnyVersion;
    transpose?: number | undefined;
    frets?: number | undefined;
    custom?: CustomSettings | null | undefined;
}): CapoSuggestion | null;
/**
 * A scale exercise: over whole octaves from the tonic in `direction` (up and down unless given), `perBeat` even notes a
 * counted beat, the last held to the bar line.
 */
interface ScaleExercise {
    /** A scale id from SCALES. */
    readonly scale: string;
    /** The tonic's name, as in TONICS ("F#"). */
    readonly tonic: string;
    readonly octaves: number;
    /** Notes per counted beat: 1 to 4 in simple meters; 1, 3 or 6 in 6/8 and 12/8, whose beat is a dotted quarter. */
    readonly perBeat: number;
    readonly time: readonly [number, number];
    readonly direction?: ScaleDirection;
}
/** The tempo a scale exercise is fingered at, in counted beats per minute; another tempo is playback only. */
declare const SCALE_BPM = 60;
/** Notes per beat a meter offers for scales, with their names. */
declare const scaleRhythms: (time: readonly [number, number]) => readonly {
    readonly perBeat: number;
    readonly name: string;
}[];
/**
 * An exercise's spelled pitches from the lowest tonic that holds them all on the instrument (up to its highest fret),
 * or null when no octave does. Lower is chosen because low positions are easier; nothing is left out or moved.
 */
declare function scaleOnNeck(exercise: ScaleExercise, instrument: FrettedInstrument): string[] | null;
/** The exercise as a score for one instrument (see scaleOnNeck); throws a RangeError when it does not fit. */
declare function scaleScore(exercise: ScaleExercise, instrument: FrettedInstrument): Score;
/**
 * A scale exercise as a piece for one catalog instrument (its capo, highest fret and tuning in `instrument`): one
 * version, fingered as written at SCALE_BPM, never simplified or moved (`exercise`).
 */
declare function scalePiece(exercise: ScaleExercise, instrument: FrettedInstrument, { instrumentId, id }: {
    instrumentId: string;
    id?: string;
}): ScorePiece;
/**
 * A chord progression by scale degree: roman numerals over the tonic (C major, A minor), upper case major, lower case
 * minor, "b" a degree lowered against the parallel major (bIII is C in A minor), "°" diminished, "ø7" half-diminished
 * seventh, "7" a dominant (upper case) or minor (lower case) seventh, "maj7" a major seventh, and "V/vi" or "V7/ii" a
 * secondary dominant. Each entry lasts `bars` bars (one each unless given); `ending` is the chord held at the end
 * (the tonic unless given). `songs` is how many of the 739 distinct songs of the McGill Billboard corpus (Billboard
 * Hot 100, 1958–1991; Burgoyne, Wild and Fujinaga 2011, CC0) start a phrase with its chords (sevenths counted as
 * triads; the 12-bar blues: have a 12-bar blues chorus), counted by scripts/billboard-progressions.py; other sources'
 * popularity is not mixed into it.
 */
interface Progression {
    readonly id: string;
    /** The numerals as written ("ii⁷–V⁷–Imaj⁷"). */
    readonly name: string;
    readonly numerals: readonly string[];
    readonly bars?: readonly number[];
    readonly ending?: string;
    readonly mode: "major" | "minor";
    readonly songs: number;
    /** What it is and why it is practised. */
    readonly note: string;
    /** A progression of the same family (I–V–vi–IV and its minor-centred rotation). */
    readonly related?: string;
    readonly sources?: readonly {
        readonly name: string;
        readonly url: string;
    }[];
}
declare const BILLBOARD_SONGS = 739;
/**
 * Twenty-five progressions chosen for recognizability, harmonic variety and practice value, in that order: the
 * fundamental and pop loops, rock and minor progressions, Dorian vamps, borrowed and secondary chords, jazz ii–V–I
 * progressions, longer sequences and the 12-bar blues.
 */
declare const PROGRESSIONS: readonly Progression[];
/**
 * A roman numeral's chord symbol in a key: "bVII" in C is Bb, "vi" Am, "V7" G7, "ii7" Dm7, "Imaj7" Cmaj7, "ii°" Ddim,
 * "iiø7" Dm7b5, "V/vi" E, "V7/ii" A7 (spelled plainly).
 */
declare function chordOfNumeral(numeral: string, key: string): string;
type PracticeVersion = Omit<SongVersion, "id">;
/**
 * Strokes as players write them, one slot per `step` quarters: D down, U up, · a rest (spaces are ignored). A down
 * strum on a counted beat (every `beat` quarters) sounds four strings, others three; an up strum the top two or three.
 */
declare function writtenStrokes(written: string, step: number, beat: number, ups?: Tones): Hit[];
/**
 * One strummed version per difficulty for each meter progressions are played in: down strums, then ups, syncopation
 * and sixteenths. Every hit is a strum, and no version strikes more than three quarters of the places on its grid
 * (eighths, or sixteenths when it has them): harder versions rest and push, they do not fill every place.
 */
declare const PROGRESSION_VERSIONS: Readonly<Record<string, readonly PracticeVersion[]>>;
/** The tempo progressions are played at by meter, in counted beats per minute. */
declare const PROGRESSION_BPM: Readonly<Record<string, number>>;
/** How a progression's chords are played: strummed at every difficulty, or picked as an arpeggio. */
type ProgressionStyle = "strum" | "arpeggio-up" | "arpeggio-down" | "arpeggio-up-down";
declare const PROGRESSION_STYLES: readonly {
    readonly id: ProgressionStyle;
    readonly name: string;
}[];
/**
 * When an arpeggio picks, by meter and difficulty (quarters after the bar line): up to 2, 3, 4, 6 and 8 notes a bar from
 * baby to pro (their picked-notes limits), then triplets or sixteenths.
 */
declare const ARPEGGIO_TIMES: Readonly<Record<string, Readonly<Record<Level, readonly number[]>>>>;
/**
 * One arpeggio version per difficulty for a meter; the last chord is picked once, bass and top. The release never
 * makes a bar's last tone shorter than the level's shortest note (baby's second tone in 6/8 keeps a quarter).
 */
declare function arpeggioVersions(time: readonly [number, number], direction: Arpeggio["direction"]): PracticeVersion[];
/** A strumming pattern: one bar, repeated over a progression in place of the versions by difficulty. */
interface StrumPattern {
    readonly id: string;
    readonly name: string;
    /** The family it is listed under. */
    readonly style: string;
    readonly time: readonly [number, number];
    /** The bar as players write it, a slot per eighth (sixteenth, or triplet eighth, when it has them): D down, U up, B a picked bass note, · a rest. */
    readonly strokes: string;
    readonly pattern: readonly Hit[];
    readonly bass?: readonly BassHit[];
    /** Counted beats a minute it is fingered at. */
    readonly bpm: number;
    /**
     * The easiest difficulty that plays it as written over I–IV–V–I and I–V–vi–IV on the instruments it is typical for
     * (measured); easier ones play it simplified, as any song's easiest version.
     */
    readonly difficulty: Level;
    /** Where it is usually played. */
    readonly typical: readonly ("ukulele" | "guitar" | "mandolin")[];
    /**
     * The fewest strings it needs. A picked bass under a strum needs a guitar's: on four strings the bass string is
     * strummed while the bass still rings (no difficulty below maestro plays it on a ukulele or mandolin).
     */
    readonly strings?: number;
}
/**
 * Common strumming patterns by style. None strikes more than three quarters of the places on its grid. Chucks and
 * other muted, percussive strokes have no pitch and are not written; a chop or a skank is a short strum.
 */
declare const STRUM_PATTERNS: readonly StrumPattern[];
/** A strumming pattern by id. */
declare function strumPattern(id: string): StrumPattern;
/**
 * A progression as a chord song in C major (A minor for a minor one), the key selector moving it: each chord its
 * bars, a loop shorter than eight bars twice, a longer one (the 12-bar blues) once, then its ending held a bar; one
 * version per difficulty for the meter, or a strumming pattern.
 */
declare function progressionSong(progression: Progression, time: readonly [number, number], { instrument, style, pattern }?: {
    instrument?: string;
    style?: ProgressionStyle;
    pattern?: string;
}): ChordSong;
/**
 * The triad on every degree of a seven-note scale, spelled plainly ("Bdim", "Caug"), or null for other scales. The
 * melodic minor uses its rising form.
 */
declare function scaleTriads(tonic: string, scale: string): string[] | null;
/**
 * A seven-note scale played as its chords, a bar each: up the degrees to the octave, back down, and the tonic held,
 * in one of the progression styles (strummed or arpeggiated), one version per difficulty.
 */
declare function scaleChordsSong({ scale, tonic, time }: {
    scale: string;
    tonic: string;
    time: readonly [number, number];
}, { instrument, style }?: {
    instrument?: string;
    style?: ProgressionStyle;
}): ChordSong;
interface Stroke {
    readonly id: string;
    readonly at: Q;
    readonly direction: "down" | "up";
    readonly spreadSeconds?: number;
}
/** Strum strokes for createPerformance: one per strummed hit that still sounds in `result`; the last chord is a slow down strum. */
declare function strokesFor(spec: SongSpec | ScorePiece, result: {
    readonly score: Score;
}): Stroke[];
/** Which limits of a difficulty the source itself exceeds at a tempo, before any fingering is searched; picked notes per bar only when it is not strummed. */
declare function limitsExceeded(spec: {
    readonly beat: number;
    readonly bpm: number;
    readonly countStrokes?: boolean;
    readonly pattern?: readonly Hit[];
}, source: Score, { bpm, level }: {
    bpm?: number;
    level: Level;
}): string[];
interface ChordShapeUse {
    readonly chord: string;
    /** Quarters from the start. */
    readonly at: number;
    /** Capo-relative frets in physical string order, "x" where nothing is played in that hand position. */
    readonly frets: readonly Fret[];
    readonly barre: number | null;
}
/**
 * The frets the solver chose under every chord symbol, from the annotations only. One hand position per chord: the
 * five frets holding most of its strings; notes outside it (a run up the neck) are left out of the shape.
 */
declare function voicingsFor(result: {
    readonly score: Score;
    readonly annotations: readonly FrettedAnnotation[];
}, instrument: FrettedInstrument): ChordShapeUse[];

export { ALL, ARPEGGIO_SEARCH, ARPEGGIO_TIMES, ARRANGEMENT_SCHEMA, BILLBOARD_SONGS, CHART_SCHEMA, DEEP, INSTRUMENTS, INVERSION_NAMES, KEY_SHIFTS, LEVEL_TEMPO, NO_CHORD, PROGRESSIONS, PROGRESSION_BPM, PROGRESSION_STYLES, PROGRESSION_VERSIONS, QUICK, RETRIES, SCALE_BPM, SEARCH, SET_SCHEMA, SIMPLIFY, STRUM_PATTERNS, WIDE, arpeggioVersions, arrangeFor, attemptFingerprint, barQuarters, barStart, barsOf, cacheKey, cacheable, chordInversion, chordOfNumeral, chordShapes, chordTones, customInstrumentId, down, estimateLevel, familiarShapes, fingerprint, hardestNotes, hardestVersion, highestFret, instrumentFor, intervalOf, keyName, limitsExceeded, pick, pieceFingerprint, pieceFromScore, prepare, progressionSong, retime, scaleChordsSong, scaleOnNeck, scalePiece, scaleRhythms, scaleScore, scaleTriads, searched, segmentKey, segmentsOf, songFromChart, sourceFor, stableJson, strokesFor, strumPattern, suggestCapo, tempoFor, transposeSong, transposeSymbol, up, versionById, versionsFor, voiceChord, voicingsFor, voicingsForSong, writtenStrokes };
export type { AnyVersion, Arpeggio, ArrangeRequest, AttemptStatus, BassHit, CapoSuggestion, CatalogInstrument, ChordChart, ChordSegment, ChordShapeUse, ChordSong, ChordTones, CustomSettings, Fill, Fret, Hit, Inversions, LogEntry, Piece, Prepared, PreparedAttempt, Progression, ProgressionStyle, Run, RunOptions, RunResult, ScaleExercise, ScorePiece, ScoreSet, ScoreVersion, Segment, SongSpec, SongVersion, Stroke, StrumPattern, SuccessfulRun, Texture, Tones, VersionLayers, VocalEntry, Voicing };
//# sourceMappingURL=songs.d.mts.map
