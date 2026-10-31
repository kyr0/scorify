/**
 * Songs and pieces arranged per difficulty: chord-chart songs with one hand-written version per difficulty (strum and
 * pick patterns, alternating bass, fills), chord charts written for imported scores with a sung part, and imported
 * scores or score sets. For a request (instrument, difficulty, tempo, capo, custom settings) it plays the version written
 * for the difficulty as written (exact mode), falls back to easier versions, and simplifies the easiest one only when
 * none plays, logging every attempt. Logs replay without a search when their inputs fingerprint alike, after
 * independent validation. A fingering found at one tempo can be kept at another when the validator accepts it there
 * (retime); a capo is suggested when it leaves fewer hard chord shapes. Host-neutral; no audio.
 *
 * Chord voicings are proposed from contiguous string runs and ranked like a chord book; scorify judges each proposal
 * by arranging it as one chord. These are heuristics with stated rules, not calibrated difficulty claims.
 */
import { arrange } from "./arrange.js";
import type { ArrangementOptions, ArrangementResult, ArrangementSuccess, SearchOptions } from "./arrange.js";
import { barAt, createScore, parsePitch, pitchString } from "./model.js";
import type { HarmonySpan, NoteEvent, Score } from "./model.js";
import { addQ, q, secondsAt, subQ } from "./time.js";
import type { Q, Tempo } from "./time.js";
import { pitchToMidi, transposePitch } from "./pitch.js";
import { scaleById, scalePitches } from "./theory.js";
import type { ScaleDirection } from "./theory.js";
import { compilePlayer, levels } from "./profiles.js";
import type { AdaptationPolicy, Level, PlayerCapabilities, PlayerOptions } from "./profiles.js";
import { classicalGuitar, concertUkulele, createFrettedInstrument } from "./presets.js";
import type { FrettedInstrument } from "./fretted.js";
import { transformScore, transposeChordSymbol } from "./transforms.js";
import type { TransformOptions } from "./transforms.js";
import { validateFrettedArrangement } from "./validate.js";
import type { FrettedAnnotation } from "./fingering.js";

// ---- songs, versions and hits -----------------------------------------------------------------------------------------
/** Tones of a voicing by string, bass edge first: 0 the lowest played string, -1 the highest; "all" every string. */
export type Tones = "all" | readonly number[];
/** A pattern hit, `at` quarters after the bar line; with a stroke it is strummed, without it picked. */
export interface Hit {
  readonly at: number;
  readonly tones: Tones;
  readonly stroke?: "down" | "up";
  /** Quarters the strings ring (a chop or a skank); otherwise until struck again or the chord ends. */
  readonly length?: number;
}
/** An alternating bass hit: the voicing's root, its fifth (below when the strings reach it) or a semitone into the next root. */
export interface BassHit {
  readonly at: number;
  readonly tone: "root" | "fifth" | "approach";
}
/** Every `every`-th bar (or the listed `bars`), the hits from `from` on give way to a sixteenth run of scale `steps`. */
export interface Fill {
  readonly from: number;
  readonly steps: readonly number[];
  readonly every?: number;
  readonly bars?: readonly number[];
}
/**
 * Single tones at `at` (quarters after the bar line), walking the strings of whatever voicing sounds: up from the bass,
 * down from the top, or up and back; it starts again at every chord.
 */
export interface Arpeggio {
  readonly direction: "up" | "down" | "up-down";
  readonly at: readonly number[];
}
/** The layers one version plays over the chords. */
export interface VersionLayers {
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
export interface SongVersion extends VersionLayers {
  readonly id: string;
  readonly difficulty: Level;
  readonly label: string;
  readonly estimated?: boolean;
}
/** A sung note: onset and length in quarters from the start, sounding pitch, and its syllable (or one per verse). */
export type VocalEntry = readonly [onset: number, length: number, pitch: string, words: string | readonly string[]];
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
export interface ChordSong extends PieceBase {
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
export type SongSpec = ChordSong & VersionLayers;
export interface ScoreVersion {
  readonly id: string;
  readonly difficulty: Level;
  readonly label: string;
  readonly score: Score;
  readonly estimated?: boolean;
}
export interface Texture {
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
export interface ScorePiece extends PieceBase {
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
export type Piece = ChordSong | ScorePiece;
const isScore = (piece: Piece): piece is ScorePiece => piece.kind === "score";

/** Hit helpers: a down or up strum of `tones` (default every string), or a pick of single tones. */
export const ALL = "all";
export const down = (at: number, tones: Tones = ALL): Hit => ({ at, tones, stroke: "down" });
export const up = (at: number, tones: Tones = ALL): Hit => ({ at, tones, stroke: "up" });
export const pick = (at: number, ...tones: number[]): Hit => ({ at, tones });

// ---- instruments --------------------------------------------------------------------------------------------------------
export interface CatalogInstrument {
  readonly id: string;
  readonly group: string;
  readonly name: string;
  readonly short: string;
  readonly create: () => FrettedInstrument;
}
/** Fretted instruments by id, in physical string order, each with a usual highest fret (ukuleles 18, guitars 19, mandolin 20). */
export const INSTRUMENTS: readonly CatalogInstrument[] = [
  { id: "uke-high-g", group: "Ukulele", name: "Concert ukulele · high G", short: "ukulele", create: () => concertUkulele() },
  { id: "uke-low-g", group: "Ukulele", name: "Concert ukulele · low G", short: "ukulele", create: () => concertUkulele({ tuning: "lowG" }) },
  { id: "uke-baritone", group: "Ukulele", name: "Baritone ukulele", short: "baritone ukulele", create: () => createFrettedInstrument("ukulele-baritone", "Baritone ukulele", ["D3", "G3", "B3", "E4"], { fretCount: 18 }) },
  { id: "guitar", group: "Guitar", name: "Classical guitar · standard", short: "guitar", create: () => classicalGuitar() },
  { id: "guitar-drop-d", group: "Guitar", name: "Guitar · drop D", short: "guitar", create: () => createFrettedInstrument("guitar-drop-d", "Guitar · drop D", ["D2", "A2", "D3", "G3", "B3", "E4"]) },
  { id: "guitar-7", group: "Guitar", name: "7-string guitar", short: "7-string guitar", create: () => createFrettedInstrument("guitar-7-string", "7-string guitar", ["B1", "E2", "A2", "D3", "G3", "B3", "E4"]) },
  { id: "guitar-8", group: "Guitar", name: "8-string guitar", short: "8-string guitar", create: () => createFrettedInstrument("guitar-8-string", "8-string guitar", ["F#1", "B1", "E2", "A2", "D3", "G3", "B3", "E4"]) },
  { id: "mandolin", group: "Other", name: "Mandolin", short: "mandolin", create: () => createFrettedInstrument("mandolin", "Mandolin", ["G3", "D4", "A4", "E5"], { fretCount: 20 }) },
];
const instrumentCache = new Map<string, FrettedInstrument>();
/**
 * The instrument for a catalog id, or a composite one from customInstrumentId ("guitar~capo2~frets15~tuningD2.A2.D3.G3.B3.E4").
 * Instruments are cached and shared; treat them as immutable.
 */
export function instrumentFor(id: string): FrettedInstrument {
  let instrument = instrumentCache.get(id);
  if (!instrument) {
    const [base, ...changes] = id.split("~"),
      entry = INSTRUMENTS.find((i) => i.id === base);
    if (!entry) throw new RangeError(`Unknown instrument: ${id}`);
    instrument = entry.create();
    const capo = Number(changes.find((c) => c.startsWith("capo"))?.slice(4) ?? 0),
      frets = changes.find((c) => c.startsWith("frets"))?.slice(5),
      tuning = changes.find((c) => c.startsWith("tuning"))?.slice(6).split(".");
    if (capo || frets || tuning)
      instrument = createFrettedInstrument(
        `${instrument.id}-custom`,
        `${instrument.name} (${[capo ? `capo ${capo}` : "", frets ? `${frets} frets` : "", tuning ? tuning.join(" ") : ""].filter(Boolean).join(", ")})`,
        tuning ?? instrument.strings.map((s) => s.openPitch),
        { capoFret: capo, fretCount: frets ? Number(frets) : instrument.strings[0]!.fretCount },
      );
    instrumentCache.set(id, instrument);
  }
  return instrument;
}
/**
 * The id of a catalog instrument with a capo, a highest fret other than its own (`frets`, a hard limit) and a custom
 * tuning (spelled pitches, bass edge first).
 */
export const customInstrumentId = (base: string, { capo = 0, frets, tuning }: { capo?: number; frets?: number | undefined; tuning?: readonly string[] | undefined } = {}): string => {
  if (frets !== undefined && (!Number.isSafeInteger(frets) || frets < 1)) throw new RangeError(`Invalid highest fret: ${frets}`);
  const other = frets !== undefined && frets !== highestFret(base);
  return [base, ...(capo ? [`capo${capo}`] : []), ...(other ? [`frets${frets}`] : []), ...(tuning?.length ? [`tuning${tuning.join(".")}`] : [])].join("~");
};
/** A catalog instrument's own highest fret. */
export const highestFret = (id: string): number => instrumentFor(id.split("~")[0]!).strings[0]!.fretCount;

/** Each difficulty's starting tempo as a share of the piece's own: maestro plays 20% faster. An editable policy. */
export const LEVEL_TEMPO: Readonly<Partial<Record<Level, number>>> = { maestro: 1.2 };
/** The tempo a difficulty starts at, in the piece's beats per minute. */
export const tempoFor = (piece: Piece, level: Level): number => Math.round(piece.bpm * (LEVEL_TEMPO[level] ?? 1));

// ---- transposition --------------------------------------------------------------------------------------------------------
const SIMPLE_INTERVALS = ["1P", "2m", "2M", "3m", "3M", "4P", "4A", "5P", "6m", "6M", "7m", "7M"];
/** The spelled interval of a number of semitones, compound beyond an octave ("9M": an octave and a whole tone). */
export function intervalOf(semitones: number): string {
  const size = Math.abs(semitones),
    simple = SIMPLE_INTERVALS[size % 12]!;
  return `${semitones < 0 ? "-" : ""}${Number.parseInt(simple) + 7 * Math.floor(size / 12)}${simple.slice(-1)}`;
}
const PLAIN_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const pc = (midi: number) => ((midi % 12) + 12) % 12;
/** A note name without a double accidental, E♯, B♯, C♭ or F♭ (B♯ is written C). */
const plainName = (name: string) =>
  /^[A-G][#b]?$/.test(name) && !/^(E#|B#|Cb|Fb)$/.test(name) ? name : PLAIN_NAMES[pc(pitchToMidi(`${name}4`))]!;
const plainPitch = (pitch: string) => {
  const [, name, octave] = /^([A-G](?:##|bb|#|b|x)?)(-?\d+)$/.exec(pitch) ?? [];
  if (!name || octave === undefined) throw new RangeError(`Invalid pitch: ${pitch}`);
  return plainName(name) === name ? pitch : `${plainName(name)}${Math.floor(pitchToMidi(pitch) / 12) - 1}`;
};
/** A chord symbol moved by an interval, spelled plainly (no double accidentals, E♯, B♯, C♭ or F♭). */
export const transposeSymbol = (symbol: string, interval: string): string =>
  transposeChordSymbol(symbol, interval)
    .replace(/^[A-G](?:##|bb|#|b|x)?/, plainName)
    .replace(/\/([A-G](?:##|bb|#|b|x)?)$/, (_, bass: string) => `/${plainName(bass)}`);
export const NO_CHORD = "N.C.";
/** A song moved by semitones: its chords, key and sung pitches (fills follow the key). Voicings are found again. */
export function transposeSong<T extends ChordSong>(song: T, semitones?: number): T {
  if (!semitones) return song;
  const interval = intervalOf(semitones);
  const chart = (bars?: readonly string[]) =>
    bars?.map((bar) => bar.trim().split(/\s+/).map((symbol) => (symbol === NO_CHORD ? symbol : transposeSymbol(symbol, interval))).join(" "));
  return {
    ...song,
    key: plainName(transposePitch(`${song.key}4`, interval).replace(/-?\d+$/, "")),
    progression: chart(song.progression)!,
    ...(song.simpleProgression ? { simpleProgression: chart(song.simpleProgression) } : {}),
    ...(song.ending ? { ending: transposeSymbol(song.ending, interval) } : {}),
    ...(song.vocal ? { vocal: song.vocal.map(([onset, length, pitch, words]) => [onset, length, plainPitch(transposePitch(pitch, interval)), words] as const) } : {}),
  };
}

// ---- bars ---------------------------------------------------------------------------------------------------------------
/** The keys the key selector offers: from a tritone down to a fourth up, the piece's own key at 0. */
export const KEY_SHIFTS: readonly number[] = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
/** A piece's key moved by semitones ("Eb major"), or null when the piece does not say its key. */
export function keyName(piece: Piece, semitones = 0): string | null {
  const key = isScore(piece) ? piece.score.keyMap[0] : { tonic: piece.key, mode: piece.mode };
  if (!key?.tonic) return null;
  return `${plainName(transposePitch(`${key.tonic}4`, intervalOf(semitones)).replace(/-?\d+$/, ""))} ${key.mode === "minor" ? "minor" : "major"}`;
}
export const barQuarters = (song: { readonly time: readonly [number, number] }): number => (song.time[0] * 4) / song.time[1];
const value = (x: Q) => x[0] / x[1];
/** Quarters as exact time: on a triplet grid when they lie on it (arpeggio triplets), else rounded to 32nds as always. */
const at = (quarters: number) => {
  const thirds = quarters * 24;
  return Math.abs(thirds - Math.round(thirds)) < 1e-6 ? q(Math.round(thirds), 24) : q(Math.round(quarters * 8), 8);
};
/** Every note is released a 32nd early, so a re-struck string, a strum sweep and humanized timing never overlap. */
const GAP = q(1, 8);
const strummed = (song: { readonly pattern?: readonly Hit[] }) => !!song.pattern?.some((hit) => hit.stroke);
const tonesOf = (pitches: readonly string[], tones: Tones) =>
  tones === ALL ? pitches.map((_, i) => i) : tones.map((t) => (t < 0 ? pitches.length + t : t)).filter((t) => t >= 0 && t < pitches.length);
/** Where bar `b` starts, in quarters: after the pickup, if the song has one. */
export const barStart = (song: ChordSong, b: number): number => (song.pickup ?? 0) + b * barQuarters(song);
/** Every bar's chords: the progression, then the ending. */
export const barsOf = (song: ChordSong): readonly string[] => (song.ending ? [...song.progression, song.ending] : song.progression);
export interface Segment {
  readonly symbol: string;
  readonly from: number;
  readonly to: number;
}
/** The chords of bar `b`, sharing it evenly, from and to in quarters after its bar line; "N.C." leaves its part silent. */
export function segmentsOf(song: ChordSong, b: number): Segment[] {
  const symbols = barsOf(song)[b]!.trim().split(/\s+/),
    length = barQuarters(song) / symbols.length;
  return symbols.flatMap((symbol, k) => (symbol === NO_CHORD ? [] : [{ symbol, from: k * length, to: (k + 1) * length }]));
}
/** Does bar `b` strike once per chord and let it ring? The ending does, and every bar listed in `holds`. */
const held = (song: ChordSong, b: number) => b >= song.progression.length || !!song.holds?.includes(b + 1);
const fillBar = (song: SongSpec, b: number) =>
  !!song.fill && b < song.progression.length && !held(song, b) && (song.fill.bars ? song.fill.bars.includes(b + 1) : (b + 1) % song.fill.every! === 0);
/** The string an arpeggio picks `k`-th in a chord of `n` strings, bass edge first. */
function arpeggioTone(direction: Arpeggio["direction"], k: number, n: number): number {
  if (n <= 1) return 0;
  if (direction === "up") return k % n;
  if (direction === "down") return n - 1 - (k % n);
  const i = k % (2 * n - 2);
  return i < n ? i : 2 * n - 2 - i;
}
/**
 * The hits bar `b` plays while one of its chords sounds: a fill bar stops at the fill; a held bar strikes once. An
 * arpeggio walks the `size` strings of the chord's voicing.
 */
function hitsIn(song: SongSpec, b: number, segment: Segment, size = 1): Hit[] {
  if (held(song, b)) {
    const hit = song.hold ?? song.pattern[0]!;
    return [{ ...hit, at: segment.from + hit.at }];
  }
  const end = fillBar(song, b) ? Math.min(segment.to, song.fill!.from) : segment.to,
    inside = (at: number) => at >= segment.from - 1e-9 && at < end - 1e-9;
  if (song.arpeggio) return song.arpeggio.at.filter(inside).map((at, k) => pick(at, arpeggioTone(song.arpeggio!.direction, k, size)));
  return song.pattern.filter((hit) => inside(hit.at));
}

// ---- voicings -------------------------------------------------------------------------------------------------------------
const QUALITIES: Readonly<Record<string, readonly string[]>> = {
  "": ["1P", "3M", "5P"], m: ["1P", "3m", "5P"], 7: ["1P", "3M", "5P", "7m"], m7: ["1P", "3m", "5P", "7m"],
  maj7: ["1P", "3M", "5P", "7M"], dim: ["1P", "3m", "5d"], aug: ["1P", "3M", "5A"], sus2: ["1P", "2M", "5P"],
  sus4: ["1P", "4P", "5P"], 6: ["1P", "3M", "5P", "6M"], m6: ["1P", "3m", "5P", "6M"],
};
export interface ChordTones {
  readonly names: readonly string[];
  readonly classes: readonly number[];
  readonly bass: number;
  readonly required: readonly number[];
}
/** The spelled tones of a chord symbol (triads, sevenths, sixths, sus, dim, aug, slash bass). */
export function chordTones(symbol: string): ChordTones {
  const m = /^([A-G](?:#|b)?)(m|7|m7|maj7|dim|aug|sus2|sus4|6|m6)?(?:\/([A-G](?:#|b)?))?$/.exec(symbol);
  if (!m) throw new RangeError(`Unsupported chord symbol: ${symbol}`);
  const names = QUALITIES[m[2] ?? ""]!.map((i) => transposePitch(`${m[1]}4`, i).replace(/-?\d+$/, ""));
  const classes = names.map((n) => pc(pitchToMidi(`${n}4`)));
  return { names, classes, bass: m[3] ? pc(pitchToMidi(`${m[3]}4`)) : classes[0]!, required: classes.slice(0, names.length > 3 ? 4 : 2) };
}
function spell(midi: number, tones: ChordTones): string {
  const name = tones.names[tones.classes.indexOf(pc(midi))]!;
  for (const octave of [Math.floor(midi / 12) - 2, Math.floor(midi / 12) - 1, Math.floor(midi / 12)])
    if (pitchToMidi(`${name}${octave}`) === midi) return `${name}${octave}`;
  throw new RangeError(`Cannot spell ${midi} as ${name}`);
}
export type Fret = number | "x";
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
export function chordShapes(instrument: FrettedInstrument, tones: ChordTones, { maxFret, maxNotes, inBass }: { maxFret: number; maxNotes: number; inBass?: number }): Proposal[] {
  const open = instrument.strings.map((s) => pitchToMidi(s.openPitch) + s.capoFret),
    n = open.length,
    top = Math.min(maxFret, ...instrument.strings.map((s) => s.fretCount - s.capoFret));
  const options = open.map((o) => Array.from({ length: top + 1 }, (_, f) => f).filter((f) => tones.classes.includes(pc(o + f))));
  const found: Proposal[] = [];
  for (let from = 0; from < n; from++)
    for (let to = from + Math.min(3, n) - 1; to < n && to - from + 1 <= maxNotes; to++) {
      const walk = (i: number, frets: number[]): void => {
        if (i > to) {
          const pitches = frets.map((f, k) => open[from + k]! + f),
            fretted = frets.filter((f) => f > 0);
          if (!tones.required.every((c) => pitches.some((p) => pc(p) === c))) return;
          const bass = pc(Math.min(...pitches)),
            fifth = tones.classes[2];
          // An inversion asks for one chord tone in the bass; otherwise the root (or fifth) on five or more strings.
          if (inBass !== undefined ? bass !== inBass : n >= 5 && bass !== tones.bass && bass !== fifth) return;
          if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 3) return;
          let barre = 0;
          if (fretted.length > 4) {
            const low = Math.min(...fretted),
              ends = frets.flatMap((f, k) => (f === low ? [k] : []));
            if (frets.slice(ends[0]!, ends.at(-1)! + 1).some((f) => f < low) || fretted.length - ends.length > 3) return;
            barre = 1;
          }
          const unisons = pitches.slice(1).filter((p, k) => p === pitches[k]).length;
          found.push({
            frets: open.map((_, s) => (s < from || s > to ? "x" : frets[s - from]!)),
            pitches,
            rank: [n >= 5 && bass !== tones.bass ? 1 : 0, unisons, Math.max(0, ...fretted) > 4 ? 1 : 0, -(to - from + 1), barre, fretted.length, Math.max(0, ...fretted)],
          });
          return;
        }
        for (const f of options[i]!) walk(i + 1, [...frets, f]);
      };
      walk(from, []);
    }
  return found.sort((a, b) => {
    const i = a.rank.findIndex((v, k) => v !== b.rank[k]);
    return i < 0 ? 0 : a.rank[i]! - b.rank[i]!;
  });
}
export interface Voicing {
  readonly symbol: string;
  readonly frets: readonly Fret[];
  readonly pitches: readonly string[];
  /** The chord tone asked for in the bass (0 the root, 1 the third, 2 the fifth, 3 the seventh or sixth). */
  readonly inversion?: number;
}
/** Names of the inversions by the chord tone in the bass. */
export const INVERSION_NAMES: readonly string[] = ["root position", "first inversion", "second inversion", "third inversion"];
/** Which chord tone a voicing has in the bass (its lowest sounding pitch): 0 the root, 1 the third, …; -1 another tone. */
export function chordInversion(symbol: string, pitches: readonly string[]): number {
  return chordTones(symbol).classes.indexOf(pc(Math.min(...pitches.map(pitchToMidi))));
}
/** Inversions asked for, by chord segment (segmentKey): which chord tone goes in the bass. */
export type Inversions = Readonly<Record<string, number>>;
/** A chord segment's key: its bar and its place in the bar, from 1, and its symbol ("3.1:Eb"). */
export const segmentKey = (b: number, s: number, symbol: string): string => `${b + 1}.${s + 1}:${symbol}`;
const voicingKey = (symbol: string, inversion: number | undefined) => (inversion === undefined ? symbol : `${symbol}@${inversion}`);
const voicingCache = new Map<string, Voicing | null>();
/**
 * The first proposed shape scorify can play as one chord under this level (the rhythm is checked with the song); with
 * `inversion`, only shapes with that chord tone in the bass.
 */
export function voiceChord(symbol: string, instrumentId: string, { level, rightHand, inversion }: { level: Level; rightHand: "strum" | "pick"; inversion?: number }): Voicing | null {
  const key = `${instrumentId}|${level}|${rightHand}|${symbol}${inversion === undefined ? "" : `|${inversion}`}`;
  if (voicingCache.has(key)) return voicingCache.get(key)!;
  const instrument = instrumentFor(instrumentId),
    tones = chordTones(symbol);
  if (inversion !== undefined && (!Number.isSafeInteger(inversion) || inversion < 0 || inversion >= tones.classes.length))
    throw new RangeError(`${symbol} has no inversion ${inversion}`);
  const maxNotes = Math.min(instrument.strings.length, compilePlayer({ level }).maxPolyphony);
  let tried = 0,
    chosen: Voicing | null = null;
  for (const maxFret of [5, 7, 12]) {
    for (const candidate of chordShapes(instrument, tones, { maxFret, maxNotes, ...(inversion !== undefined ? { inBass: tones.classes[inversion]! } : {}) })) {
      if (++tried > 80) break;
      const pitches = candidate.pitches.map((p) => spell(p, tones));
      const probe = createScore(pitches.map((pitch, i) => ({ id: `probe-${i}`, pitch: parsePitch(pitch), onset: q(0), duration: q(1), partId: "probe", voiceId: "chord", role: "harmony" as const })));
      // Only the fretting hand is probed: the attack rate and the notes picked in a bar belong to the song's rhythm (a
      // version that picks only the root still holds the whole shape).
      const result = arrange(probe, { instrument, mode: "exact", player: { level, overrides: { rightHand, maxAttacksPerSecond: 1000, maxPickedPerBar: 1000 } } });
      if (result.status === "success") {
        chosen = { symbol, frets: candidate.frets, pitches, ...(inversion !== undefined ? { inversion } : {}) };
        break;
      }
    }
    if (chosen) break;
  }
  voicingCache.set(key, chosen);
  return chosen;
}
/** Every part of the voicings a pattern can sound, as shape signatures ("x-2-3-2"): the player's familiar shapes. */
export function familiarShapes(voicings: Readonly<Record<string, Voicing>>): string[] {
  const shapes = new Set<string>();
  for (const { frets } of Object.values(voicings)) {
    const played = frets.flatMap((f, i) => (f === "x" ? [] : [i]));
    for (let mask = 1; mask < 1 << played.length; mask++)
      shapes.add(frets.map((f, i) => (played.includes(i) && mask & (1 << played.indexOf(i)) ? f : "x")).join("-"));
  }
  return [...shapes];
}
/**
 * The voicing of every chord a song plays, by symbol (and "symbol@inversion" for a segment with an inversion asked
 * for), or the chord no voicing was found for.
 */
export function voicingsForSong(
  song: SongSpec,
  instrumentId: string,
  level: Level,
  inversions: Inversions = {},
): { voicings: Record<string, Voicing>; missing?: never } | { missing: string; voicings?: never } {
  const rightHand = strummed(song) ? "strum" : "pick",
    voicings: Record<string, Voicing> = {};
  for (const b of barsOf(song).keys())
    for (const [s, { symbol }] of segmentsOf(song, b).entries()) {
      const inversion = inversions[segmentKey(b, s, symbol)],
        key = voicingKey(symbol, inversion);
      if (key in voicings) continue;
      const voicing = voiceChord(symbol, instrumentId, { level, rightHand, ...(inversion !== undefined ? { inversion } : {}) });
      if (!voicing) return { missing: inversion === undefined ? symbol : `${symbol} (${INVERSION_NAMES[inversion]})` };
      voicings[key] = voicing;
    }
  return { voicings };
}
/** A chord segment as played: where it starts (quarters), its symbol, how many tones it has and which one is in the bass. */
export interface ChordSegment {
  readonly key: string;
  readonly symbol: string;
  readonly at: number;
  readonly tones: number;
  readonly inversion: number;
  /** The inversion was asked for. */
  readonly asked: boolean;
}
function chordSegments(song: SongSpec, voicings: Readonly<Record<string, Voicing>>, inversions: Inversions): ChordSegment[] {
  return [...barsOf(song).keys()].flatMap((b) =>
    segmentsOf(song, b).map((segment, s) => {
      const key = segmentKey(b, s, segment.symbol),
        asked = inversions[key];
      return {
        key,
        symbol: segment.symbol,
        at: barStart(song, b) + segment.from,
        tones: chordTones(segment.symbol).classes.length,
        inversion: chordInversion(segment.symbol, voicings[voicingKey(segment.symbol, asked)]!.pitches),
        asked: asked !== undefined,
      };
    }),
  );
}

// ---- the source a version plays -------------------------------------------------------------------------------------------
const SCALES = { major: ["1P", "2M", "3M", "4P", "5P", "6M", "7M"], minor: ["1P", "2M", "3m", "4P", "5P", "6m", "7m"] } as const;
function ladderOf(song: ChordSong): string[] {
  const names = SCALES[song.mode].map((i) => transposePitch(`${song.key}4`, i).replace(/-?\d+$/, ""));
  const ladder: string[] = [];
  for (let octave = 1; octave <= 7; octave++) for (const name of names) ladder.push(`${name}${octave}`);
  return ladder.sort((a, b) => pitchToMidi(a) - pitchToMidi(b));
}
function rootOf(voicing: Voicing): string {
  const root = pc(pitchToMidi(`${/^[A-G][#b]?/.exec(voicing.symbol)![0]}4`));
  return voicing.pitches.find((p) => pc(pitchToMidi(p)) === root) ?? voicing.pitches[0]!;
}
/** An inverted voicing's bass is the chord tone asked for, its lowest pitch; otherwise the root. */
const bassOf = (voicing: Voicing) => (voicing.inversion ? voicing.pitches.reduce((a, b) => (pitchToMidi(b) < pitchToMidi(a) ? b : a)) : rootOf(voicing));
function bassPitch(tone: BassHit["tone"], voicing: Voicing, next: Voicing, lowest: number): string {
  const root = rootOf(voicing),
    fits = (p: string) => pitchToMidi(p) >= lowest;
  if (tone === "root") return bassOf(voicing);
  if (tone === "fifth") return [transposePitch(root, "-4P"), transposePitch(root, "5P")].find(fits)!;
  const target = bassOf(next);
  return [transposePitch(target, "-2m"), transposePitch(target, "2m")].find(fits)!;
}
/**
 * One version of a song as a score: its bars of chords with the version's layers (pattern, alternating bass, fills),
 * ending on a held chord. Roles say what may go first if it is simplified: fills are ornaments, the pattern harmony,
 * the bass line bass. The sung part is not in it.
 */
export function sourceFor(song: SongSpec, voicings: Readonly<Record<string, Voicing>>, instrument: FrettedInstrument, inversions: Inversions = {}): Score {
  const bar = barQuarters(song),
    bars = barsOf(song),
    notes: NoteEvent[] = [],
    harmony: HarmonySpan[] = [],
    ladder = ladderOf(song);
  const lowest = Math.min(...instrument.strings.map((s) => pitchToMidi(s.openPitch) + s.capoFret));
  const note = (id: string, pitch: string, start: number, length: number, voiceId: string, role: NonNullable<NoteEvent["role"]>) => {
    notes.push({ id, pitch: parsePitch(pitch), onset: at(start), duration: at(length), ...(length > 0.125 ? { gateDuration: subQ(at(length), GAP) } : {}), partId: "arrangement", voiceId, role });
    return id;
  };
  const chords = bars.flatMap((_, b) => segmentsOf(song, b).map((segment, s) => voicings[voicingKey(segment.symbol, inversions[segmentKey(b, s, segment.symbol)])]!));
  let chord = 0;
  bars.forEach((_, b) => {
    const start = barStart(song, b),
      segments = segmentsOf(song, b),
      last = b === bars.length - 1;
    let h = 0;
    segments.forEach((segment, s) => {
      const voicing = chords[chord]!,
        next = chords[++chord] ?? voicing,
        { symbol, pitches } = voicing;
      const hits = hitsIn(song, b, segment, pitches.length),
        ids: string[] = [];
      // A tone rings until its string is struck again, the fill starts, or the chord ends; easy versions let go
      // `release` quarters earlier, never more than half of it.
      const following = segments[s + 1] && hitsIn(song, b, segments[s + 1]!)[0];
      const end = Math.min(following?.at ?? segment.to, fillBar(song, b) ? song.fill!.from : bar);
      hits.forEach((hit, k) => {
        const until = Math.max(end - (last ? 0 : (song.release ?? 0)), hit.at + (end - hit.at) / 2);
        for (const tone of tonesOf(pitches, hit.tones)) {
          const later = hits.slice(k + 1).find((other) => tonesOf(pitches, other.tones).includes(tone));
          const bass = tone === 0 && hit.tones !== ALL && !song.bass;
          const stop = Math.min(later?.at ?? until, hit.length === undefined ? Infinity : hit.at + hit.length);
          ids.push(note(`${song.id}-${b + 1}-${h}-${tone}`, pitches[tone]!, start + hit.at, stop - hit.at, bass ? "bass" : "chords", bass ? "bass" : "harmony"));
        }
        h++;
      });
      if (song.bass && !held(song, b))
        song.bass.forEach((hit, k) => {
          if (hit.at < segment.from - 1e-9 || hit.at >= segment.to - 1e-9) return;
          const stop = Math.min(song.bass![k + 1]?.at ?? bar, segment.to);
          ids.push(note(`${song.id}-${b + 1}-b${k}`, bassPitch(hit.tone, voicing, next, lowest), start + hit.at, stop - hit.at, "bass", "bass"));
        });
      const fill = song.fill;
      if (fill && fillBar(song, b) && fill.from >= segment.from - 1e-9 && fill.from < segment.to - 1e-9) {
        const top = Math.max(...pitches.map((p) => pitchToMidi(p))),
          base = ladder.reduce((found, p, i) => (pitchToMidi(p) <= top ? i : found), -1);
        // A scale step takes the chord's accidental for the same letter (G♯ over an E major chord).
        const names = chordTones(symbol).names,
          inChord = (p: string) => {
            const same = names.find((n) => n[0] === p[0]);
            return same ? `${same}${/-?\d+$/.exec(p)![0]}` : p;
          };
        fill.steps.forEach((step, k) => {
          ids.push(note(`${song.id}-${b + 1}-f${k}`, inChord(ladder[base + step]!), start + fill.from + k / 4, 1 / 4, "fill", "ornament"));
        });
      }
      harmony.push({
        id: `${song.id}-harmony-${b + 1}${segments.length > 1 ? `-${s + 1}` : ""}`,
        onset: at(start + segment.from),
        end: at(start + segment.to),
        selected: symbol,
        candidates: [{ symbol, score: 1 }],
        evidenceNoteIds: ids,
        provenance: "provided",
        method: "hand-authored chart",
      });
    });
  });
  const meter = { numerator: song.time[0], denominator: song.time[1] };
  const meterMap = song.pickup ? [{ at: q(0), numerator: song.pickup * 2, denominator: 8 }, { at: at(song.pickup), ...meter }] : [{ at: q(0), ...meter }];
  return createScore(notes, {
    tempoMap: song.tempoMap ?? [{ at: q(0), quarterBpm: song.bpm * song.beat }],
    meterMap,
    keyMap: [{ at: q(0), tonic: song.key, mode: song.mode }],
    harmony,
  });
}

// ---- imported scores and score sets ---------------------------------------------------------------------------------------
export const SET_SCHEMA = "scorify-set-1";
export interface ScoreSet {
  readonly schema: typeof SET_SCHEMA;
  readonly title?: string;
  readonly composer?: string;
  readonly variants: readonly { readonly id: string; readonly difficulty: Level; readonly label?: string; readonly score: Score }[];
}
interface Notation {
  readonly vocal?: readonly string[];
  readonly lyrics?: Readonly<Record<string, string>>;
  readonly verses?: readonly Readonly<Record<string, string>>[];
  readonly lyricLanguages?: readonly string[];
  readonly title?: string;
  readonly composer?: string;
  readonly description?: string;
  readonly source?: unknown;
}
const notationOf = (score: Score) => (score.notation ?? {}) as Notation;
function densityOf(score: Score): { attacks: number; polyphony: number } {
  const vocal = new Set(notationOf(score).vocal ?? []);
  const notes = score.notes.filter((n) => !vocal.has(n.partId));
  const list = notes.length ? notes : score.notes,
    onsets = list.map((n) => secondsAt(n.onset, score.tempoMap)).sort((a, b) => a - b);
  let attacks = 0,
    first = 0,
    polyphony = 0;
  onsets.forEach((t, last) => {
    while (onsets[first]! <= t - 1 + 1e-9) first++;
    attacks = Math.max(attacks, last - first + 1);
  });
  for (const n of list)
    polyphony = Math.max(polyphony, list.filter((o) => value(o.onset) <= value(n.onset) && value(o.onset) + value(o.duration) > value(n.onset)).length);
  return { attacks, polyphony };
}
/** The lowest level whose attack rate and polyphony limits a score stays within: an estimate before any fingering. */
export function estimateLevel(score: Score): Level {
  const { attacks, polyphony } = densityOf(score);
  return levels.find((level) => {
    const p = compilePlayer({ level });
    return attacks <= p.maxAttacksPerSecond && polyphony <= p.maxPolyphony;
  }) ?? "maestro";
}
/**
 * A piece from a normalized Score or a score set of normalized scores. A single score is one version at its estimated
 * difficulty. With inner voices it offers all voices, melody and bass (the default), or melody only.
 */
export function pieceFromScore(input: Score | ScoreSet, { id, instrument = "guitar" }: { id?: string; instrument?: string } = {}): ScorePiece {
  const set = "schema" in input && input.schema === SET_SCHEMA ? input : null;
  const versions: ScoreVersion[] = set
    ? set.variants.map((v) => ({ id: v.id, difficulty: v.difficulty, label: v.label || v.id, score: v.score }))
    : [{ id: "score", difficulty: estimateLevel(input as Score), label: "As written", score: input as Score, estimated: true }];
  versions.sort((a, b) => levels.indexOf(a.difficulty) - levels.indexOf(b.difficulty));
  const score = versions.at(-1)!.score;
  const [first, next] = score.meterMap,
    length = (m: { numerator: number; denominator: number }) => (m.numerator * 4) / m.denominator;
  const pickup = !!next && value(next.at) === length(first!) && length(first!) < length(next);
  const meter = pickup ? next! : first!,
    info = notationOf(score),
    compound = meter.denominator >= 8 && meter.numerator % 3 === 0 && meter.numerator > 3;
  const beat = (4 / meter.denominator) * (compound ? 3 : 1);
  const played = score.notes.filter((n) => !(info.vocal ?? []).includes(n.partId));
  const count = (roles: string[]) => played.filter((n) => roles.includes(n.role ?? "")).length;
  const all = played.length,
    outer = count(["melody", "bass"]),
    melody = count(["melody"]);
  const textures: Texture[] =
    !set && melody && outer < all
      ? [
          { key: "all", label: "All voices", notes: all },
          { key: "outer", label: "Melody and bass", notes: outer },
          ...(melody < outer ? [{ key: "melody", label: "Melody only", notes: melody }] : []),
        ]
      : [];
  const title = String(set?.title || info.title || "Untitled score");
  return {
    textures,
    texture: textures.length ? "outer" : "all",
    versions,
    level: versions.at(-1)!.difficulty,
    pad: pickup ? length(next!) - length(first!) : 0,
    id: id ?? `score-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    kind: "score",
    score,
    instrument,
    title,
    credit: (set?.composer || info.composer) ?? "Imported score",
    description: info.description
      ? String(info.description)
      : set
        ? `${versions.length} versions, from ${versions[0]!.difficulty} to ${versions.at(-1)!.difficulty}, imported with the score-import skill.`
        : `${score.notes.length} notes in ${score.parts.length} part${score.parts.length === 1 ? "" : "s"}, imported with the score-import skill.`,
    time: [meter.numerator, meter.denominator],
    beat,
    bpm: Math.round(score.tempoMap[0]!.quarterBpm / beat),
    rhythm: `${meter.numerator}/${meter.denominator}`,
    ...chordsOf(score, { id: id ?? "score", title, instrument, pickup: pickup ? length(first!) : 0, meter, beat }),
  };
}

// ---- the chords of an imported score --------------------------------------------------------------------------------------
/** The strummed versions of an imported piece's chords: baby on strong beats and beginner every beat (both the simpler chart), amateur down and up. */
function chordVersions([numerator, denominator]: readonly [number, number], beat: number): SongVersion[] {
  const beats = Array.from({ length: Math.round((numerator * 4) / denominator / beat) }, (_, k) => k * beat),
    strong = beats.length === 3 ? [0] : beats.filter((_, k) => k % 2 === 0);
  return [
    { id: "chords-baby", difficulty: "baby", label: "The piece's main chords, a down strum on the strong beats", simple: true, countStrokes: true, release: beat, pattern: strong.map((at) => down(at)) },
    { id: "chords-beginner", difficulty: "beginner", label: "The piece's main chords, a down strum on every beat", simple: true, countStrokes: true, release: beat / 2, pattern: beats.map((at) => down(at)) },
    {
      id: "chords-amateur",
      difficulty: "amateur",
      label: "The piece's chords, strummed down and up",
      countStrokes: true,
      // Let go a sixteenth before the next strum: held to the next chord, amateur's hand has no time to move.
      release: beat / 4,
      pattern: beats.flatMap((at, k) => (k ? [down(at), up(at + beat / 2)] : [down(at)])),
    },
  ];
}
/**
 * The major or minor triad covering most of a window's sounding time (its lowest note counted twice), or null. A
 * previous chord that scores nearly as well is kept, so passing notes do not change the chord.
 */
function triadOf(notes: readonly { readonly midi: number; readonly weight: number }[], previous: string): string | null {
  if (!notes.length) return null;
  const weights = Array<number>(12).fill(0),
    lowest = Math.min(...notes.map((n) => n.midi));
  for (const n of notes) weights[pc(n.midi)]! += n.weight * (n.midi === lowest ? 2 : 1);
  const total = weights.reduce((a, b) => a + b, 0);
  // Chord tones count, other notes count against it, a root in the bass breaks ties.
  const rate = (root: number, minor: boolean) =>
    2 * [root, (root + (minor ? 3 : 4)) % 12, (root + 7) % 12].reduce((a, t) => a + weights[t]!, 0) - total + (pc(lowest) === root ? 0.25 * weights[root]! : 0);
  let best: { key: string; score: number } | null = null;
  for (let root = 0; root < 12; root++)
    for (const minor of [false, true]) {
      const score = rate(root, minor);
      if (weights[root]! > 0 && (!best || score > best.score + 1e-9)) best = { key: `${root}${minor ? "m" : ""}`, score };
    }
  if (best && previous) {
    const [, root, minor] = /^(\d+)(m?)$/.exec(previous)!;
    if (rate(Number(root), !!minor) >= best.score - 0.15 * total) return previous;
  }
  return best?.key ?? null;
}
/**
 * The chords of an imported score as a chord-chart song: a plain major or minor triad per beat (merged into halves or
 * whole bars where they agree) inferred from the hardest version's played notes, and a simpler chart with one chord
 * per half bar (4/4, 2/2) or bar for baby and beginner; strummed versions for baby, beginner and amateur. Only for
 * one meter (after an optional pickup). A heuristic reading of the notes, reported as one, not a harmonic analysis.
 */
function chordsOf(score: Score, { id, title, instrument, pickup, meter, beat }: { id: string; title: string; instrument: string; pickup: number; meter: { numerator: number; denominator: number }; beat: number }): { chords?: ChordSong } {
  if (score.meterMap.length > (pickup ? 2 : 1)) return {};
  const info = notationOf(score),
    sung = new Set(info.vocal ?? []),
    played = score.notes.filter((n) => !sung.has(n.partId));
  if (!played.length) return {};
  const bar = (meter.numerator * 4) / meter.denominator,
    beats = Math.round(bar / beat),
    halves = beats === 4 ? 2 : 1,
    end = Math.max(...[...score.notes, ...score.rests].map((n) => value(n.onset) + value(n.duration))),
    bars = Math.ceil((end - pickup) / bar - 1e-9);
  const key = score.keyMap[0],
    mode: "major" | "minor" = key?.mode === "minor" ? "minor" : "major";
  // Roots spelled from the key's scale where they belong to it; others as plain names.
  const scale = key ? SCALES[mode].map((i) => transposePitch(`${key.tonic}4`, i).replace(/-?\d+$/, "")) : [];
  const nameOf = (root: number) => scale.find((n) => pc(pitchToMidi(`${n}4`)) === root) ?? PLAIN_NAMES[root]!;
  const symbolOf = (triad: string) => {
    const [, root, minor] = /^(\d+)(m?)$/.exec(triad)!;
    return `${nameOf(Number(root))}${minor}`;
  };
  /** One symbol per window of `parts` to a bar, merged into fewer even parts where they agree. */
  const chart = (parts: number) => {
    let previous = "";
    return Array.from({ length: bars }, (_, b) => {
      const symbols = Array.from({ length: parts }, (_, k) => {
        const from = pickup + b * bar + (k * bar) / parts,
          to = from + bar / parts;
        const sounding = played.flatMap((n) => {
          const on = value(n.onset),
            off = on + value(n.duration);
          return on < to - 1e-9 && off > from + 1e-9 ? [{ midi: pitchToMidi(pitchString(n.pitch)), weight: Math.min(off, to) - Math.max(on, from) }] : [];
        });
        previous = triadOf(sounding, previous) ?? previous;
        return previous ? symbolOf(previous) : NO_CHORD;
      });
      for (const size of [1, 2]) {
        const merged = Array.from({ length: size }, (_, k) => symbols.slice((k * parts) / size, ((k + 1) * parts) / size));
        if (parts % size === 0 && merged.every((group) => group.every((s) => s === group[0]))) return merged.map((group) => group[0]).join(" ");
      }
      return symbols.join(" ");
    });
  };
  const progression = chart(beats),
    simpleProgression = chart(halves);
  const first = progression.flatMap((b) => b.split(" ")).find((symbol) => symbol !== NO_CHORD);
  if (!first) return {};
  const verses = [info.lyrics ?? {}, ...(info.verses ?? [])];
  const vocal: VocalEntry[] = score.notes.filter((n) => sung.has(n.partId)).map((n) => [value(n.onset), value(n.duration), pitchString(n.pitch), verses.map((v) => v[n.id] ?? "")]);
  const root = first.replace(/m$/, "");
  return {
    chords: {
      kind: "chart",
      id: `${id}-chords`,
      title,
      instrument,
      key: key ? nameOf(pc(pitchToMidi(`${key.tonic}4`))) : root,
      mode: key ? mode : first.endsWith("m") ? "minor" : "major",
      time: [meter.numerator, meter.denominator],
      beat,
      pad: 0,
      ...(pickup ? { pickup } : {}),
      bpm: Math.round(score.tempoMap[0]!.quarterBpm / beat),
      tempoMap: score.tempoMap,
      progression,
      simpleProgression,
      holds: [],
      versions: chordVersions([meter.numerator, meter.denominator], beat),
      vocal,
      notes: [
        `the piece's chords are read from the notes of its hardest version, a heuristic: the major or minor triad that sounds longest on each beat (for baby and beginner, in each ${halves === 2 ? "half bar" : "bar"})`,
      ],
    },
  };
}

// ---- chord charts for imported scores -------------------------------------------------------------------------------------
export const CHART_SCHEMA = "scorify-chart-1";
export interface ChordChart {
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
  readonly versions: readonly (Omit<SongVersion, "id"> & { readonly id?: string })[];
  readonly vocalTranspose?: readonly { readonly bars: readonly [number, number]; readonly interval: string; readonly reason: string }[];
  /** The tune's path through a choir's sung parts: the part shown in each span of bars (from 1), and why. */
  readonly sungLine?: { readonly parts: readonly { readonly part: string; readonly bars: readonly [number, number] }[]; readonly reason: string };
  /** The language of each verse's words, when the score does not say. */
  readonly lyricLanguages?: readonly string[];
}
/**
 * A song from a chord chart (schema "scorify-chart-1") and the normalized score it was written for: the chart's
 * versions are played under the score's sung part, words and tempo map; its other parts are not played. The chart needs
 * a bar of chords for every bar of the score; `vocalTranspose` moves (and reports) a sung passage written in another key,
 * `sungLine` shows one sung part per span of bars (a tune passed between choir parts) instead of every sung part.
 */
export function songFromChart(chart: ChordChart, score: Score, { id = chart?.id, instrument = chart?.instrument }: { id?: string | undefined; instrument?: string | undefined } = {}): ChordSong {
  if (chart?.schema !== CHART_SCHEMA) throw new RangeError(`Not a ${CHART_SCHEMA} chord chart`);
  if (score.meterMap.length !== 1) throw new RangeError("A chord chart needs a score in one meter, without a pickup");
  const { numerator, denominator } = score.meterMap[0]!,
    bar = (numerator * 4) / denominator;
  const compound = denominator >= 8 && numerator % 3 === 0 && numerator > 3,
    beat = (4 / denominator) * (compound ? 3 : 1);
  const info = notationOf(score),
    sung = new Set(info.vocal ?? []),
    verses = [info.lyrics ?? {}, ...(info.verses ?? [])];
  const line = chart.sungLine?.parts.map(({ part, bars: [first, last] }) => {
    if (!sung.has(part)) throw new RangeError(`The sung line names ${part}, which is not a sung part`);
    return { part, from: (first - 1) * bar, to: last * bar };
  });
  const voice = score.notes.filter((n) => sung.has(n.partId) && (!line || line.some((p) => p.part === n.partId && value(n.onset) >= p.from && value(n.onset) < p.to)));
  if (!voice.length) throw new RangeError("A chord chart needs a score with a sung part");
  const bars = Math.ceil(Math.max(...[...score.notes, ...score.rests].map((n) => value(n.onset) + value(n.duration))) / bar - 1e-9);
  for (const progression of [chart.progression, chart.simpleProgression ?? chart.progression]) {
    if (progression.length !== bars) throw new RangeError(`The chart has ${progression.length} bars, the score ${bars}`);
    for (const symbol of progression.flatMap((b) => b.trim().split(/\s+/))) if (symbol !== NO_CHORD) chordTones(symbol);
  }
  for (const v of chart.versions)
    if (v.countStrokes && (v.bass || v.fill || ![...v.pattern, ...(v.hold ? [v.hold] : [])].every((hit) => hit.stroke)))
      throw new RangeError(`The ${v.difficulty} version counts strokes but does not only strum`);
  const shifts = (chart.vocalTranspose ?? []).map((t) => ({ ...t, from: (t.bars[0] - 1) * bar, to: t.bars[1] * bar }));
  const vocal: VocalEntry[] = voice.map((n) => {
    const onset = value(n.onset),
      shift = shifts.find((t) => onset >= t.from && onset < t.to),
      pitch = pitchString(n.pitch);
    return [onset, value(n.duration), shift ? transposePitch(pitch, shift.interval) : pitch, verses.map((v) => v[n.id] ?? "")];
  });
  return {
    kind: "chart",
    id: id ?? "chart",
    instrument: instrument ?? "guitar",
    title: chart.title ?? info.title ?? "Untitled song",
    credit: chart.credit ?? info.composer ?? "",
    description: chart.description ?? "",
    key: chart.key,
    mode: chart.mode,
    time: [numerator, denominator],
    beat,
    pad: 0,
    bpm: chart.bpm ?? Math.round(score.tempoMap[0]!.quarterBpm / beat),
    tempoMap: score.tempoMap,
    progression: chart.progression,
    ...(chart.simpleProgression ? { simpleProgression: chart.simpleProgression } : {}),
    holds: chart.holds ?? [],
    versions: chart.versions.map((v) => ({ ...v, id: v.difficulty })).sort((a, b) => levels.indexOf(a.difficulty) - levels.indexOf(b.difficulty)),
    vocal,
    ...((chart.lyricLanguages ?? info.lyricLanguages) ? { lyricLanguages: chart.lyricLanguages ?? info.lyricLanguages } : {}),
    source: info.source,
    notes: [
      vocal.some((v) => [v[3]].flat().some(Boolean))
        ? `the sung part (${vocal.length} notes) and its words come from the imported score; its other parts are not played`
        : `the sung part (${vocal.length} notes) comes from the imported score, which has no words for it; its other parts are not played`,
      ...(chart.sungLine ? [chart.sungLine.reason] : []),
      ...shifts.map((t) => t.reason),
    ],
  };
}

function rangeOf(instrument: FrettedInstrument): [number, number] {
  const open = instrument.strings.map((s) => pitchToMidi(s.openPitch) + s.capoFret);
  return [Math.min(...open), Math.max(...open) + Math.min(15, ...instrument.strings.map((s) => s.fretCount - s.capoFret))];
}
const TEXTURE_ROLES: Readonly<Record<string, readonly string[]>> = { outer: ["melody", "bass"], melody: ["melody"] };
/** The chosen voices of an imported version, notes that hold until the next attack released a 32nd early. */
function sourceForScore(piece: ScorePiece, version: ScoreVersion, texture: string): ScoreSource {
  piece.sources ??= new Map();
  const key = `${version.id}|${texture}`,
    cached = piece.sources.get(key);
  if (cached) return cached;
  const score = version.score,
    info = notationOf(score),
    vocal = new Set(info.vocal ?? []);
  const sung = score.notes.filter((n) => vocal.has(n.partId)),
    played = sung.length < score.notes.length ? score.notes.filter((n) => !vocal.has(n.partId)) : score.notes;
  const roles = TEXTURE_ROLES[texture];
  const kept = roles ? played.filter((n) => roles.includes(n.role ?? "")) : played,
    ids = new Set(kept.map((n) => n.id));
  const onsets = new Set(kept.map((n) => value(n.onset)));
  // The tune is one note at a time: in a chord of the melody voice, the top note is the melody and the others count as
  // harmony, which a simplification may thin.
  const top = new Map<string, number>();
  for (const n of kept)
    if (n.role === "melody") {
      const at = `${n.partId}|${n.voiceId}|${value(n.onset)}`;
      top.set(at, Math.max(top.get(at) ?? -Infinity, pitchToMidi(pitchString(n.pitch))));
    }
  let gated = 0;
  const notes = kept.map((n) => {
    const under = n.role === "melody" && pitchToMidi(pitchString(n.pitch)) < top.get(`${n.partId}|${n.voiceId}|${value(n.onset)}`)!;
    const note = under ? { ...n, role: "harmony" as const } : n;
    if (n.tieGroupId || n.gateDuration || value(n.duration) <= value(GAP) || !onsets.has(value(addQ(n.onset, n.duration)))) return note;
    gated++;
    return { ...note, gateDuration: subQ(n.duration, GAP) };
  });
  const harmony = (score.harmony ?? []).map((h) => ({ ...h, evidenceNoteIds: (h.evidenceNoteIds ?? []).filter((i) => ids.has(i)) }));
  const verses = [info.lyrics ?? {}, ...(info.verses ?? [])];
  const vocalLine: VocalEntry[] = played === score.notes ? [] : sung.map((n) => [value(n.onset), value(n.duration), pitchString(n.pitch), verses.map((v) => v[n.id] ?? "")]);
  const entry = { source: { ...score, notes, harmony }, gated, left: played.length - kept.length, vocal: vocalLine, sung: played === score.notes ? 0 : sung.length };
  piece.sources.set(key, entry);
  return entry;
}

// ---- preparing an attempt -------------------------------------------------------------------------------------------------
/** What a simplified arrangement may change by default: fills, accompaniment notes, octaves. The melody is kept. */
export const SIMPLIFY: Partial<AdaptationPolicy> = { preserveMelody: true, allowOrnamentOmission: true, allowAccompanimentOmission: true, allowOctaveShift: true };
/** Search tiers: the first try, a quick first tier for long adaptive imports, and the wider retries on exhaustion. */
export const SEARCH: SearchOptions = { strategy: "beam", beamWidth: 32, maxCandidatesPerFrame: 512, maxExpandedStates: 10000000 };
export const QUICK: SearchOptions = { strategy: "beam", beamWidth: 8, maxCandidatesPerFrame: 128, maxExpandedStates: 10000000 };
export const WIDE: SearchOptions = { strategy: "beam", beamWidth: 128, maxCandidatesPerFrame: 2048, maxExpandedStates: 40000000 };
export const DEEP: SearchOptions = { strategy: "beam", beamWidth: 2048, maxCandidatesPerFrame: 16384, maxExpandedStates: 4000000 };
/**
 * The first try for arpeggio versions. An arpeggio adds one note a frame, so a narrow beam settles on what is cheap
 * for the first notes of a chord (open strings) and keeps stretches it would never choose for the whole shape: at 32
 * the ukulele's root-position F (2553) became 0-1-9-5, an eight-fret span; at 512 it is played in fifth position.
 */
export const ARPEGGIO_SEARCH: SearchOptions = { strategy: "beam", beamWidth: 512, maxCandidatesPerFrame: 8192, maxExpandedStates: 40000000 };
export const RETRIES: readonly SearchOptions[] = [WIDE, DEEP];

/** Settings that replace what a request otherwise uses; every one is reported in an attempt's notes. */
export interface CustomSettings {
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
export interface ArrangeRequest {
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
export type AnyVersion = SongVersion | ScoreVersion;
export interface PreparedAttempt {
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
export type Prepared = PreparedAttempt | { readonly missing: string };
/** The versions to try for a difficulty, best first: the one written for it (or the nearest easier one), then easier ones. */
export function versionsFor(piece: Piece, level: Level): AnyVersion[] {
  const rank = (l: Level) => levels.indexOf(l),
    easiest = piece.versions[0]!;
  const fit = (piece.versions as readonly AnyVersion[]).filter((v) => rank(v.difficulty) <= rank(level)).sort((a, b) => rank(b.difficulty) - rank(a.difficulty));
  return fit.length ? fit : [easiest];
}
const specOf = (piece: ChordSong, version: SongVersion, transpose?: number): SongSpec =>
  transposeSong({ ...piece, ...version, ...(version.simple && piece.simpleProgression ? { progression: piece.simpleProgression } : {}) } as SongSpec, transpose);
/**
 * Everything one attempt needs: the source score and arrange() options, or why there is none. `simplify: false`
 * arranges the version as written (exact mode); `simplify: true` lets scorify simplify it (adaptive mode). A song's
 * voicings come from the chord finder at the difficulty; an imported score is moved by whole octaves into range.
 */
export function prepare(
  piece: Piece,
  request: ArrangeRequest & { version?: AnyVersion; simplify?: boolean; search?: SearchOptions },
): Prepared {
  const { instrumentId, level, bpm, simplify = false, capo = 0 } = request;
  const version = request.version ?? piece.versions.at(-1)!,
    texture = request.texture ?? (isScore(piece) ? piece.texture : undefined),
    search = request.search ?? SEARCH;
  const asked: CustomSettings = request.custom ?? {},
    // The key selector's transposition, unless custom settings set their own; reported like it.
    custom: CustomSettings = asked.transpose === undefined && request.transpose ? { ...asked, transpose: request.transpose } : asked;
  if (request.frets !== undefined && capo > request.frets) return { missing: `a capo on fret ${capo}, above the highest fret (${request.frets})` };
  const tuned = customInstrumentId(instrumentId, { capo, frets: request.frets, tuning: custom.tuning }),
    instrument = instrumentFor(tuned),
    own = highestFret(instrumentId),
    neck = request.frets !== undefined && request.frets !== own ? [`frets up to ${request.frets} only (the instrument's usual highest fret is ${own})`] : [];
  const player = (overrides: Partial<PlayerCapabilities>): PlayerOptions => ({
    level,
    ...(custom.complexity !== undefined ? { complexity: custom.complexity } : {}),
    ...(custom.flexibility !== undefined ? { flexibility: custom.flexibility } : {}),
    overrides: { ...overrides, ...custom.overrides },
  });
  const adaptation = custom.adaptation ?? SIMPLIFY,
    searching = custom.search ? { ...SEARCH, ...custom.search } : search;
  // A chord version of an imported score is played from the piece's chords, like any chord song.
  const song = !isScore(piece) ? piece : "pattern" in version ? piece.chords : undefined;
  if (song) {
    const spec = specOf(song, version as SongVersion, custom.transpose),
      first = spec.arpeggio && !request.search && !custom.search ? ARPEGGIO_SEARCH : searching;
    const tries = simplify ? levels.slice(levels.indexOf(level)) : [level];
    let found: ReturnType<typeof voicingsForSong> = { missing: "" };
    const inversions = request.inversions ?? {};
    for (const shapes of tries) if ((found = voicingsForSong(spec, tuned, shapes, inversions)).voicings) break;
    if (!found.voicings) return { missing: `no playable ${found.missing} shape on this instrument at this level` };
    // An alternating bass leaves the shape on every bass note, so only versions without one get familiar shapes. A
    // version that counts strokes raises scorify's per-string attack limit to the difficulty's stroke rate across
    // every string, reported in the notes; the solver and the performance check still apply it.
    const rate = compilePlayer({ level }).maxAttacksPerSecond,
      strings = instrument.strings.length;
    const strokes = !!spec.countStrokes && custom.overrides?.maxAttacksPerSecond === undefined;
    const options = player({
      rightHand: strummed(spec) ? "strum" : "pick",
      ...(spec.bass ? {} : { familiarShapes: familiarShapes(found.voicings) }),
      ...(strokes ? { maxAttacksPerSecond: rate * strings } : {}),
    });
    const source = sourceFor(spec, found.voicings, instrument, inversions),
      chords = chordSegments(spec, found.voicings, inversions),
      inverted = chords.filter((c) => c.asked).map((c) => `${c.symbol} in bar ${c.key.split(".")[0]} in ${INVERSION_NAMES[c.inversion]}`),
      // Keys name the chords as played (after transposition, in this version's progression); others are reported.
      unmatched = Object.keys(inversions).filter((key) => !chords.some((c) => c.key === key));
    const transform: TransformOptions = song.tempoMap ? { tempoScale: (bpm * song.beat) / song.tempoMap[0]!.quarterBpm } : { quarterBpm: bpm * song.beat };
    return {
      source,
      spec,
      chords,
      total: source.notes.length,
      vocal: spec.vocal ?? [],
      notes: [
        ...(song.notes ?? []),
        ...(strokes ? [`a strum counts once: ${level} allows ${rate} strokes a second across up to ${strings} strings (${rate * strings} string attacks)`] : []),
        ...customNotes(spec, { capo, custom }),
        ...neck,
        ...(inverted.length ? [`inverted as asked: ${inverted.join(", ")}`] : []),
        ...(unmatched.length ? [`no chord to invert at ${unmatched.join(", ")}`] : []),
      ],
      options: { instrument, mode: simplify ? "adaptive" : "exact", player: options, transform, search: first, ...(simplify ? { adaptation } : {}) },
    };
  }
  if (!isScore(piece) || "pattern" in version) return { missing: "no chords inferred for this piece" };
  const scoreVersion = version;
  const { source, gated, left, vocal, sung } = sourceForScore(piece, scoreVersion, texture ?? "all");
  const shift = custom.transpose ?? 0,
    [low, high] = rangeOf(instrument),
    midis = source.notes.map((n) => pitchToMidi(pitchString(n.pitch)) + shift);
  const outside = (k: number) => midis.filter((m) => m + 12 * k < low || m + 12 * k > high).length;
  const octave = piece.exercise ? 0 : [0, -1, 1, -2, 2].reduce((best, k) => (outside(k) < outside(best) ? k : best), 0);
  const transform: TransformOptions = { tempoScale: (bpm * piece.beat) / source.tempoMap[0]!.quarterBpm, ...(octave || shift ? { interval: intervalOf(shift + 12 * octave) } : {}) };
  const crowded = Math.max(0, ...source.notes.map((n) => source.notes.filter((o) => value(o.onset) <= value(n.onset) && value(o.onset) + value(o.duration) > value(n.onset)).length));
  const forced = !piece.exercise && (outside(octave) > 0 || crowded > instrument.strings.length),
    adaptive = simplify || forced;
  const short = INSTRUMENTS.find((i) => i.id === instrumentId)?.short ?? instrument.name;
  const notes = [
    ...(sung ? [`the sung part (${sung} notes) is shown${vocal.some((v) => [v[3]].flat().some(Boolean)) ? " with its words" : ""}, not played`] : []),
    ...(left ? [`kept ${piece.textures.find((t) => t.key === texture)!.label.toLowerCase()}, left out ${left} notes of the other voices`] : []),
    ...(gated ? [`${gated} legato notes release a 32nd early so the fretting hand can move`] : []),
    ...(octave ? [`moved ${Math.abs(octave) === 1 ? "an octave" : "two octaves"} ${octave < 0 ? "down" : "up"} into the ${short}'s range`] : []),
    ...(forced && !simplify
      ? [`adaptive mode: ${outside(octave) ? `${outside(octave)} notes still out of range` : `up to ${crowded} notes at once on ${instrument.strings.length} strings`}, so octave shifts and dropped accompaniment are allowed; melody is kept`]
      : []),
    ...customNotes(piece, { capo, custom }),
    ...neck,
    ...(Object.keys(request.inversions ?? {}).length ? [`no chords to invert: this version plays the score's notes`] : []),
  ];
  const moved = shift ? vocal.map(([onset, length, pitch, words]) => [onset, length, plainPitch(transposePitch(pitch, intervalOf(shift))), words] as const) : vocal;
  return {
    source,
    spec: piece,
    notes,
    vocal: moved,
    total: scoreVersion.score.notes.length - sung,
    options: { instrument, mode: adaptive ? "adaptive" : "exact", player: player({ rightHand: "pick" }), transform, search: searching, ...(adaptive ? { adaptation } : {}) },
  };
}
/** The hardest version of a piece (the last of the hardest difficulty). */
export const hardestVersion = (piece: Piece): AnyVersion =>
  (piece.versions as readonly AnyVersion[]).reduce((a, b) => (levels.indexOf(b.difficulty) >= levels.indexOf(a.difficulty) ? b : a));
/** How many notes the hardest version plays as written for a request's instrument, capo and custom settings, or null without a chord shape. */
export function hardestNotes(piece: Piece, request: ArrangeRequest): number | null {
  const version = hardestVersion(piece),
    prepared = prepare(piece, { ...request, level: version.difficulty, version, simplify: false });
  return prepared.missing !== undefined ? null : prepared.total;
}
function customNotes(spec: SongSpec | ScorePiece, { capo, custom }: { capo: number; custom: CustomSettings }): string[] {
  const song = "progression" in spec ? spec : null;
  const chords = song ? [...new Set(barsOf(song).flatMap((bar) => bar.trim().split(/\s+/)).filter((s) => s !== NO_CHORD))] : [];
  const shapes = capo && chords.length ? `: fingered as ${[...new Set(chords.map((c) => transposeSymbol(c, intervalOf(-capo))))].join(", ")} shapes, sounding ${chords.join(", ")}` : "";
  const t = custom.transpose ?? 0,
    set = (object: object | undefined) => Object.entries(object ?? {}).map(([k, v]) => `${k} ${v}`).join(", ");
  return [
    ...(capo ? [`capo on fret ${capo}${shapes}`] : []),
    ...(t ? [`transposed ${t > 0 ? "up" : "down"} ${Math.abs(t)} semitone${Math.abs(t) === 1 ? "" : "s"}${song?.key ? ` to ${song.key} ${song.mode}` : ""}`] : []),
    ...(custom.tuning?.length ? [`tuning ${custom.tuning.join(" ")}`] : []),
    ...(custom.complexity !== undefined || custom.flexibility !== undefined ? [`player ${set({ complexity: custom.complexity, flexibility: custom.flexibility })}`.replace(/ \w+ undefined,?/g, "")] : []),
    ...(Object.keys(custom.overrides ?? {}).length ? [`custom limits: ${set(custom.overrides)}`] : []),
    ...(custom.adaptation ? [`adaptive permissions: ${Object.entries(custom.adaptation).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}`] : []),
    ...(custom.search ? [`custom search: ${set(custom.search)}`] : []),
  ];
}

// ---- fingerprints and runs ------------------------------------------------------------------------------------------------
/** JSON with object keys in sorted order, so equal values serialize alike everywhere. */
export const stableJson = (input: unknown): string =>
  JSON.stringify(input, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v,
  );
function cyrb53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
/** A 106-bit fingerprint of any JSON value: a cache key, not a security measure. */
export const fingerprint = (input: unknown): string => {
  const text = stableJson(input);
  return cyrb53(text, 0) + cyrb53(text, 1);
};
const pieceFingerprints = new WeakMap<object, string>();
/** What makes a piece itself: everything but its caches, the chosen voices and where it came from (`origin`, `cacheBase`). */
export function pieceFingerprint(piece: Piece): string {
  let print = pieceFingerprints.get(piece);
  if (!print) {
    const { sources: _s, texture: _t, origin: _o, cacheBase: _c, ...rest } = piece as Piece & { sources?: unknown; texture?: unknown; origin?: unknown; cacheBase?: unknown };
    print = fingerprint(rest);
    pieceFingerprints.set(piece, print);
  }
  return print;
}
/**
 * The cache key of a request: the piece, instrument, difficulty, voices, key, capo, highest fret (when not the
 * instrument's own) and custom settings; not the tempo, which is playback only.
 */
export const cacheKey = (piece: Piece, { instrumentId, level, texture = isScore(piece) ? piece.texture : undefined, capo = 0, transpose = 0, frets, inversions, custom = null }: ArrangeRequest): string =>
  `${pieceFingerprint(piece)}-${fingerprint({
    instrumentId, level, texture: texture ?? null, capo, transpose,
    ...(frets !== undefined && frets !== highestFret(instrumentId) ? { frets } : {}),
    ...(inversions && Object.keys(inversions).length ? { inversions } : {}),
    custom,
  })}`;
/** An attempt's inputs and the build that searches them: equal fingerprints give equal results. */
export const attemptFingerprint = (prepared: PreparedAttempt, build = ""): string => fingerprint({ build, source: prepared.source, options: prepared.options });

export type AttemptStatus = ArrangementResult["status"] | "voicing" | "limits";
export interface LogEntry {
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
export type RunResult = ArrangementSuccess<FrettedAnnotation> & { readonly retimed?: { readonly fromBpm: number } };
export interface Run {
  readonly status: AttemptStatus | "stale";
  readonly log: LogEntry[];
  readonly result?: RunResult;
  readonly prepared?: PreparedAttempt;
  readonly version?: AnyVersion;
  readonly simplify?: boolean;
}
export type SuccessfulRun = Run & { readonly status: "success"; readonly result: RunResult; readonly prepared: PreparedAttempt; readonly version: AnyVersion; readonly simplify: boolean };
export interface RunOptions {
  /** Searches one attempt: a worker client, or scorify's arrange directly. */
  readonly arrange: (source: Score, options: ArrangementOptions) => Promise<ArrangementResult> | ArrangementResult;
  /** An earlier run's log: an attempt with the same inputs is replayed, not searched. */
  readonly replay?: readonly LogEntry[];
  /** Check a replayed fingering with validateFrettedArrangement first (default true). */
  readonly verify?: boolean;
  /** Identifies the solver build in attempt fingerprints, so a new build searches again. */
  readonly build?: string;
  readonly isCurrent?: () => boolean;
  readonly onAttempt?: (attempt: { version: AnyVersion; simplify: boolean }) => unknown;
  readonly onRetry?: (tier: number) => unknown;
}
async function searchTiers(prepared: PreparedAttempt, options: RunOptions, custom: boolean): Promise<ArrangementResult> {
  const isCurrent = options.isCurrent ?? (() => true);
  const quick = !custom && prepared.source.notes.length > 300 && prepared.options.mode === "adaptive";
  let next = await options.arrange(prepared.source, { ...prepared.options, ...(quick ? { search: QUICK } : {}) });
  // Only wider tiers are worth a retry (an arpeggio starts wider than WIDE).
  const wider = RETRIES.filter((search) => (search.beamWidth ?? 0) > (prepared.options.search?.beamWidth ?? 0));
  const retries = custom ? [] : quick ? [prepared.options.search, ...RETRIES] : wider;
  for (const [k, search] of retries.entries()) {
    if (!isCurrent() || next.status !== "search-exhausted") return next;
    await options.onRetry?.(k);
    next = await options.arrange(prepared.source, { ...prepared.options, search });
  }
  return next;
}
/**
 * The arrangement for a request: the version written for the difficulty (or the nearest easier one) as written, then
 * each easier version, then the easiest one simplified. `custom.version` and `custom.mode` narrow that. Attempts whose
 * source exceeds the difficulty's attack rate, polyphony or picked notes per bar are not searched. Every attempt is
 * searched at the piece's own tempo and the result played at the request's (playAt). An imported score's strummed
 * chords are tried first at baby and beginner, and after everything else above. Returns the log of attempts
 * (the successful one carries its result) and, on success, the result, prepared attempt and version.
 */
export async function arrangeFor(piece: Piece, asked: ArrangeRequest, options: RunOptions): Promise<Run> {
  const run = await searchFor(piece, asked, options);
  return run.status === "success" ? playAt(piece, run as SuccessfulRun, asked) : run;
}
/** A version of a piece by id, chord versions of an imported score included. */
export const versionById = (piece: Piece, id: string): AnyVersion | undefined =>
  [...(piece.versions as readonly AnyVersion[]), ...(isScore(piece) ? (piece.chords?.versions ?? []) : [])].find((v) => v.id === id);
/** The strummed chord version of an imported score for a difficulty (the nearest easier one), if it has chords. */
const chordVersionFor = (piece: Piece, level: Level): SongVersion | undefined =>
  isScore(piece) ? piece.chords?.versions.filter((v) => levels.indexOf(v.difficulty) <= levels.indexOf(level)).at(-1) : undefined;
/** An attempt without the difficulty's preference for low positions, which its notes report. */
function withoutPositionCost(prepared: PreparedAttempt): PreparedAttempt {
  const { player } = prepared.options;
  return {
    ...prepared,
    notes: [...prepared.notes, "the search ran out of budget with the difficulty's preference for low positions, so this fingering was searched without it"],
    options: { ...prepared.options, player: { ...player, overrides: { ...player.overrides, highFretCosts: [] } } },
  };
}
/** arrangeFor's search, always at the piece's own tempo. */
async function searchFor(piece: Piece, asked: ArrangeRequest, options: RunOptions): Promise<Run> {
  const request = { ...asked, bpm: piece.bpm },
    { level, custom } = request,
    { replay = [], verify = true, build = "" } = options,
    isCurrent = options.isCurrent ?? (() => true);
  const chosen = custom?.version ? versionById(piece, custom.version) : undefined;
  const candidates = chosen ? [chosen] : versionsFor(piece, level);
  // An imported score's chords come first for baby and beginner, last (before nothing plays) for the other levels.
  const chords = chosen || custom?.mode === "adaptive" ? undefined : chordVersionFor(piece, level),
    first = chords && levels.indexOf(level) <= levels.indexOf("beginner") ? [{ version: chords as AnyVersion, simplify: false }] : [];
  const attempts =
    custom?.mode === "adaptive"
      ? [{ version: candidates[0]!, simplify: true }]
      : [
          ...first,
          ...candidates.map((version) => ({ version, simplify: false })),
          ...(custom?.mode === "exact" ? [] : [{ version: candidates.at(-1)!, simplify: true }]),
          ...(chords && !first.length ? [{ version: chords as AnyVersion, simplify: false }] : []),
        ].filter((a) => !(isScore(piece) && (("pattern" in a.version && a.simplify) || (piece.exercise && a.simplify && custom?.mode !== "adaptive"))));
  const log: LogEntry[] = [];
  for (const { version, simplify } of attempts) {
    await options.onAttempt?.({ version, simplify });
    if (!isCurrent()) return { status: "stale", log };
    const prepared = prepare(piece, { ...request, version, simplify });
    const entry = { version: version.id, simplify };
    if (prepared.missing !== undefined) {
      log.push({ ...entry, status: "voicing", detail: prepared.missing });
      continue;
    }
    const limits = prepared.options.mode === "exact" ? limitsExceeded(prepared.spec, prepared.source, request) : [];
    if (limits.length) {
      log.push({ ...entry, status: "limits", detail: limits.join("; ") });
      continue;
    }
    // The difficulty's preference for low positions is a cost, and a beam ranked by it can prune the only way through
    // a passage high on the neck. When a search runs out with it, the same attempt is searched once more without it,
    // so a preference never costs a playable note; the arrangement says so.
    const tries = [prepared, ...(custom?.search || !compilePlayer(prepared.options.player).highFretCosts.length ? [] : [withoutPositionCost(prepared)])];
    for (const [k, attempt] of tries.entries()) {
      const id = attemptFingerprint(attempt, build);
      let known = replay.find((e) => e.fingerprint === id && e.status !== "cancelled");
      if (known?.status === "success" && verify) {
        const check = known.result ? validateFrettedArrangement(known.result.score, attempt.options.instrument, known.result.annotations, attempt.options.player) : { valid: false };
        if (!check.valid) known = undefined;
      }
      const result: { status: AttemptStatus; result?: RunResult } = known
        ? known.status === "success"
          ? { status: "success", result: known.result! }
          : { status: known.status }
        : await searchTiers(attempt, options, !!custom?.search).then((r) => (r.status === "success" ? { status: r.status, result: r } : { status: r.status }));
      if (!isCurrent()) return { status: "stale", log };
      if (result.status === "cancelled") return { status: "cancelled", log };
      log.push({ ...entry, fingerprint: id, status: result.status, ...(k ? { anyPosition: true } : {}), ...(known ? { replayed: true } : {}), ...(result.result ? { result: result.result } : {}) });
      if (result.result) return { status: "success", result: result.result, prepared: attempt, version, simplify, log };
      if (result.status !== "search-exhausted") break;
    }
  }
  return { status: log.at(-1)?.status ?? "infeasible", log };
}
/**
 * A run played at a request's tempo. The fingering is searched and validated at the piece's own tempo; another tempo
 * only scales the arrangement's tempo map (playback), so it never needs a search. The log keeps the results as
 * searched; the result says from which tempo it was moved (`retimed`) and its attack rate at the new one.
 */
function playAt(piece: Piece, run: SuccessfulRun, request: ArrangeRequest): SuccessfulRun {
  const { result: searched } = run;
  if (request.bpm === piece.bpm && !searched.retimed) return run;
  const prepared = prepare(piece, { ...request, version: run.version, simplify: run.simplify });
  if (prepared.missing !== undefined) return run;
  const score = { ...searched.score, tempoMap: transformScore(prepared.source, prepared.options.transform).score.tempoMap };
  const attacks = searched.annotations.flatMap((a) => a.attackIds.map(() => secondsAt(a.at, score.tempoMap)));
  const { retimed: _r, ...rest } = searched;
  const result: RunResult = {
    ...rest,
    score,
    ...(request.bpm === piece.bpm ? {} : { retimed: { fromBpm: piece.bpm } }),
    difficulty: { ...searched.difficulty, maxAttacksInOneSecond: Math.max(0, ...attacks.map((t) => attacks.filter((s) => s <= t && s > t - 1 + 1e-9).length)) },
  };
  return { ...run, prepared, result };
}
/**
 * The shown arrangement at another tempo, without a search: tempo is playback only. `shown` is a successful run with
 * its `request`; null when `request` differs from it in more than `bpm`.
 */
export function retime(piece: Piece, shown: SuccessfulRun & { readonly request: ArrangeRequest }, request: ArrangeRequest): SuccessfulRun | null {
  if (shown.status !== "success" || stableJson({ ...request, bpm: 0 }) !== stableJson({ ...shown.request, bpm: 0 })) return null;
  const { request: _r, ...run } = shown;
  return playAt(piece, run, request);
}
/** Did a run search anything, or did it only replay its log? */
export const searched = (log: readonly LogEntry[]): boolean => log.some((e) => e.fingerprint && !e.replayed);
/** A log as it is kept: without the replay marks. */
export const cacheable = (log: readonly LogEntry[]): LogEntry[] => log.map(({ replayed: _r, ...entry }) => entry);
/** Exported arrangements: a request, the piece it was made for and the log with its result. */
export const ARRANGEMENT_SCHEMA = "scorify-arrangement-1";

// ---- capo suggestions -----------------------------------------------------------------------------------------------------
/** A chord-book shape's cost: an open chord (an open string, nothing above the third fret, no barre) 1, other 3, barre 4. */
function shapeCost(candidate: Proposal | undefined): number {
  if (!candidate) return Infinity;
  const played = candidate.frets.filter((f): f is number => f !== "x"),
    fretted = played.filter((f) => f > 0),
    barre = fretted.length > 4;
  return played.includes(0) && Math.max(0, ...fretted) <= 3 && !barre ? 1 : barre ? 4 : 3;
}
export interface CapoSuggestion {
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
export function suggestCapo(
  piece: Piece,
  request: { instrumentId: string; level: Level; version?: AnyVersion; transpose?: number | undefined; frets?: number | undefined; custom?: CustomSettings | null | undefined },
): CapoSuggestion | null {
  const custom = { transpose: request.transpose, ...request.custom };
  if (isScore(piece) || custom.tuning?.length) return null;
  const version = (request.version ?? versionsFor(piece, request.level)[0]!) as SongVersion,
    spec = specOf(piece, version, custom.transpose);
  const weights = new Map<string, number>();
  for (const [b] of barsOf(spec).entries()) for (const { symbol, from, to } of segmentsOf(spec, b)) weights.set(symbol, (weights.get(symbol) ?? 0) + to - from);
  const maxNotes = instrumentFor(request.instrumentId).strings.length;
  const rate = (capo: number) => {
    const instrument = instrumentFor(customInstrumentId(request.instrumentId, { capo, frets: request.frets }));
    const costs = [...weights].map(([symbol, weight]) => [weight, shapeCost(chordShapes(instrument, chordTones(symbol), { maxFret: 5, maxNotes })[0])] as const);
    return { capo, hard: costs.filter(([, c]) => c > 1).length, cost: costs.reduce((sum, [weight, c]) => sum + weight * c, 0) };
  };
  // A capo leaves at least five frets above it.
  const open = rate(0),
    capos = Math.max(0, Math.min(maxNotes > 4 ? 7 : 5, (request.frets ?? highestFret(request.instrumentId)) - 5));
  const best = Array.from({ length: capos }, (_, k) => rate(k + 1)).reduce((a, b) => (b.hard < a.hard || (b.hard === a.hard && b.cost < a.cost) ? b : a), open);
  if (!(best.hard < open.hard && best.cost <= open.cost)) return null;
  const shapes = [...new Set([...weights.keys()].map((symbol) => transposeSymbol(symbol, intervalOf(-best.capo))))];
  return { capo: best.capo, shapes, chords: [...weights.keys()], hard: [open.hard, best.hard] };
}

// ---- practice: scales and chord progressions ------------------------------------------------------------------------------
/**
 * A scale exercise: over whole octaves from the tonic in `direction` (up and down unless given), `perBeat` even notes a
 * counted beat, the last held to the bar line.
 */
export interface ScaleExercise {
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
export const SCALE_BPM = 60;
const compoundMeter = ([n, d]: readonly [number, number]) => d >= 8 && n % 3 === 0 && n > 3;
/** Notes per beat a meter offers for scales, with their names. */
export const scaleRhythms = (time: readonly [number, number]): readonly { readonly perBeat: number; readonly name: string }[] =>
  compoundMeter(time)
    ? [{ perBeat: 1, name: "dotted quarters" }, { perBeat: 3, name: "eighths" }, { perBeat: 6, name: "sixteenths" }]
    : [{ perBeat: 1, name: "quarters" }, { perBeat: 2, name: "eighths" }, { perBeat: 3, name: "triplets" }, { perBeat: 4, name: "sixteenths" }];
/** The lowest and highest sounding MIDI notes of an instrument up to its highest fret, a capo counted. */
function neckRange(instrument: FrettedInstrument): [number, number] {
  return [Math.min(...instrument.strings.map((s) => pitchToMidi(s.openPitch) + s.capoFret)), Math.max(...instrument.strings.map((s) => pitchToMidi(s.openPitch) + s.fretCount))];
}
/**
 * An exercise's spelled pitches from the lowest tonic that holds them all on the instrument (up to its highest fret),
 * or null when no octave does. Lower is chosen because low positions are easier; nothing is left out or moved.
 */
export function scaleOnNeck(exercise: ScaleExercise, instrument: FrettedInstrument): string[] | null {
  const [low, high] = neckRange(instrument);
  for (let octave = 0; octave <= 8; octave++) {
    const pitches = scalePitches(`${exercise.tonic}${octave}`, exercise.scale, { octaves: exercise.octaves, direction: exercise.direction ?? "up-down" }),
      midis = pitches.map(pitchToMidi);
    if (Math.min(...midis) < low) continue;
    return Math.max(...midis) <= high ? pitches : null;
  }
  return null;
}
/** The exercise as a score for one instrument (see scaleOnNeck); throws a RangeError when it does not fit. */
export function scaleScore(exercise: ScaleExercise, instrument: FrettedInstrument): Score {
  const scale = scaleById(exercise.scale),
    [n, d] = exercise.time,
    m = compoundMeter(exercise.time) ? 3 : 1;
  if (!scaleRhythms(exercise.time).some((r) => r.perBeat === exercise.perBeat)) throw new RangeError(`Invalid notes per beat in ${n}/${d}: ${exercise.perBeat}`);
  const pitches = scaleOnNeck(exercise, instrument);
  if (!pitches) throw new RangeError(`${exercise.octaves} octave${exercise.octaves === 1 ? "" : "s"} of ${exercise.tonic} ${scale.name.toLowerCase()} do not fit the ${instrument.name} up to its highest fret`);
  const per = exercise.perBeat,
    at = (k: number) => q(4 * m * k, d * per),
    last = pitches.length - 1,
    barBeats = n / m;
  // The last note sounds at least a beat and to the next bar line.
  const end = Math.ceil((last / per + 1) / barBeats - 1e-9) * barBeats * per;
  const notes: NoteEvent[] = pitches.map((pitch, k) => ({
    id: `scale-${k + 1}`,
    pitch: parsePitch(pitch),
    onset: at(k),
    duration: at(k === last ? end - last : 1),
    partId: "scale",
    voiceId: "1",
    role: "melody",
  }));
  return createScore(notes, {
    tempoMap: [{ at: q(0), quarterBpm: SCALE_BPM * (4 * m) / d }],
    meterMap: [{ at: q(0), numerator: n, denominator: d }],
    keyMap: [{ at: q(0), tonic: exercise.tonic, mode: scale.mode }],
    notation: { title: `${exercise.tonic} ${scale.name.toLowerCase()} scale` },
  });
}
/**
 * A scale exercise as a piece for one catalog instrument (its capo, highest fret and tuning in `instrument`): one
 * version, fingered as written at SCALE_BPM, never simplified or moved (`exercise`).
 */
export function scalePiece(exercise: ScaleExercise, instrument: FrettedInstrument, { instrumentId, id }: { instrumentId: string; id?: string }): ScorePiece {
  const score = scaleScore(exercise, instrument),
    scale = scaleById(exercise.scale),
    rhythm = scaleRhythms(exercise.time).find((r) => r.perBeat === exercise.perBeat)!.name,
    [n, d] = exercise.time,
    m = compoundMeter(exercise.time) ? 3 : 1;
  const direction = exercise.direction ?? "up-down",
    label = `${exercise.octaves === 1 ? "One octave" : `${exercise.octaves} octaves`} ${direction.replace("-", " and ")} in ${rhythm}`;
  return {
    kind: "score",
    exercise: true,
    score,
    versions: [{ id: "scale", difficulty: estimateLevel(score), label, score, estimated: true }],
    textures: [],
    texture: "all",
    level: estimateLevel(score),
    pad: 0,
    id: id ?? `scale-${scale.id}-${exercise.tonic}-${exercise.octaves}-${exercise.perBeat}-${n}-${d}${direction === "up-down" ? "" : `-${direction}`}`,
    instrument: instrumentId,
    title: notationOf(score).title as string,
    credit: "Scale exercise",
    description: `${label}, ${score.notes.length} notes from ${pitchString(score.notes[0]!.pitch)}.`,
    time: [n, d],
    beat: (4 * m) / d,
    bpm: SCALE_BPM,
    rhythm: `${n}/${d}`,
  };
}

/**
 * A chord progression by scale degree, a bar each: roman numerals over the tonic, lower case minor, ♭ as "b", "7" a
 * dominant seventh. `songs` is how many of the 739 distinct songs of the McGill Billboard corpus (Billboard Hot 100,
 * 1958–1991; Burgoyne, Wild and Fujinaga 2011, CC0) start a phrase with it (the 12-bar blues: have a 12-bar blues
 * chorus), counted by scripts/billboard-progressions.py over the corpus's chord annotations.
 */
export interface Progression {
  readonly id: string;
  readonly name: string;
  readonly numerals: readonly string[];
  readonly mode: "major" | "minor";
  readonly songs: number;
  readonly note?: string;
}
export const BILLBOARD_SONGS = 739;
/**
 * Every progression that starts on the tonic in at least 12 songs, the 12-bar blues, I–V–vi–IV and the most common
 * minor ones: i–♭VI–♭VII–i, and of the two at four songs the Andalusian cadence (i–♭VII–♭VI–♭VII has four too).
 */
export const PROGRESSIONS: readonly Progression[] = [
  { id: "I-IV-V-I", name: "I–IV–V–I", numerals: ["I", "IV", "V", "I"], mode: "major", songs: 42 },
  { id: "I-vi-IV-V", name: "I–vi–IV–V", numerals: ["I", "vi", "IV", "V"], mode: "major", songs: 28, note: "the fifties or doo-wop progression" },
  { id: "I-IV-I-V", name: "I–IV–I–V", numerals: ["I", "IV", "I", "V"], mode: "major", songs: 28 },
  { id: "I-V-IV-I", name: "I–V–IV–I", numerals: ["I", "V", "IV", "I"], mode: "major", songs: 23 },
  {
    id: "12-bar-blues", name: "12-bar blues", mode: "major", songs: 23,
    numerals: ["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"],
  },
  { id: "I-bVII-IV-I", name: "I–♭VII–IV–I", numerals: ["I", "bVII", "IV", "I"], mode: "major", songs: 22, note: "the Mixolydian rock progression" },
  { id: "I-V-I-IV", name: "I–V–I–IV", numerals: ["I", "V", "I", "IV"], mode: "major", songs: 18 },
  { id: "I-vi-ii-V", name: "I–vi–ii–V", numerals: ["I", "vi", "ii", "V"], mode: "major", songs: 17, note: "the turnaround" },
  { id: "I-V-IV-V", name: "I–V–IV–V", numerals: ["I", "V", "IV", "V"], mode: "major", songs: 12 },
  { id: "I-bIII-IV-I", name: "I–♭III–IV–I", numerals: ["I", "bIII", "IV", "I"], mode: "major", songs: 12 },
  { id: "I-V-vi-IV", name: "I–V–vi–IV", numerals: ["I", "V", "vi", "IV"], mode: "major", songs: 7, note: "rare before 1992, the corpus's last year, and far more common in later hits" },
  { id: "i-bVI-bVII-i", name: "i–♭VI–♭VII–i", numerals: ["i", "bVI", "bVII", "i"], mode: "minor", songs: 5 },
  { id: "i-bVII-bVI-V", name: "i–♭VII–♭VI–V", numerals: ["i", "bVII", "bVI", "V"], mode: "minor", songs: 4, note: "the Andalusian cadence" },
];
const DEGREES: Readonly<Record<string, string>> = { I: "1P", II: "2M", III: "3M", IV: "4P", V: "5P", VI: "6M", VII: "7M" };
/** A roman numeral's chord symbol in a key: "bVII" in C is Bb, "vi" Am, "V7" G7 (spelled plainly). */
export function chordOfNumeral(numeral: string, key: string): string {
  const [, flat, degree, seventh] = /^(b?)(i{1,3}|iv|vi{0,2}|v|I{1,3}|IV|VI{0,2}|V)(7?)$/.exec(numeral) ?? [];
  const interval = degree && DEGREES[degree.toUpperCase()];
  if (!interval) throw new RangeError(`Invalid roman numeral: ${numeral}`);
  const lowered = flat ? `${interval[0]}${interval[1] === "P" ? "d" : "m"}` : interval;
  const root = plainName(transposePitch(`${key}4`, lowered).replace(/-?\d+$/, ""));
  return `${root}${degree === degree.toLowerCase() ? "m" : ""}${seventh}`;
}
const TOP2 = [-2, -1],
  TOP3 = [-3, -2, -1],
  TOP4 = [-4, -3, -2, -1];
type PracticeVersion = Omit<SongVersion, "id">;
/**
 * Strokes as players write them, one slot per `step` quarters: D down, U up, · a rest (spaces are ignored). A down
 * strum on a counted beat (every `beat` quarters) sounds four strings, others three; an up strum the top two or three.
 */
export function writtenStrokes(written: string, step: number, beat: number, ups: Tones = TOP2): Hit[] {
  return [...written.replace(/\s+/g, "")].flatMap((slot, k) => {
    const at = k * step,
      onBeat = Math.abs(at / beat - Math.round(at / beat)) < 1e-9;
    if (slot === "D") return [down(at, onBeat ? TOP4 : TOP3)];
    if (slot === "U") return [up(at, ups)];
    if (slot !== "·") throw new RangeError(`Unknown stroke: ${slot}`);
    return [];
  });
}
/**
 * One strummed version per difficulty for each meter progressions are played in: down strums, then ups, syncopation
 * and sixteenths. Every hit is a strum, and no version strikes more than three quarters of the places on its grid
 * (eighths, or sixteenths when it has them): harder versions rest and push, they do not fill every place.
 */
export const PROGRESSION_VERSIONS: Readonly<Record<string, readonly PracticeVersion[]>> = {
  "4/4": [
    { difficulty: "baby", label: "A down strum a bar", pattern: [down(0, TOP3)], release: 1, countStrokes: true },
    { difficulty: "beginner", label: "Down strums on every beat", pattern: [0, 1, 2, 3].map((at) => down(at, TOP4)), release: 0.5, countStrokes: true },
    { difficulty: "amateur", label: "D · · U D · · U", pattern: [down(0, TOP4), up(1.5, TOP2), down(2, TOP4), up(3.5, TOP2)], countStrokes: true },
    { difficulty: "semi-pro", label: "D · D U · U D U", pattern: [down(0, TOP4), down(1, TOP4), up(1.5, TOP2), up(2.5, TOP2), down(3, TOP4), up(3.5, TOP2)], release: 0.25, countStrokes: true },
    { difficulty: "pro", label: "Sixteenths: D · D U · U D U, twice", pattern: writtenStrokes("D·DU·UDU D·DU·UDU", 0.25, 1), countStrokes: true },
    { difficulty: "expert", label: "Strums with sixteenth pushes", pattern: [down(0, TOP4), up(0.75, TOP2), down(1, TOP4), up(1.5, TOP3), up(2.5, TOP3), down(3, TOP4), up(3.5, TOP3), up(3.75, TOP2)], countStrokes: true },
    { difficulty: "maestro", label: "Syncopated sixteenths: D · · U D · D U · U D · D · · U", pattern: writtenStrokes("D··U D·DU ·UD· D··U", 0.25, 1), countStrokes: true },
  ],
  "3/4": [
    { difficulty: "baby", label: "A down strum a bar", pattern: [down(0, TOP3)], release: 1, countStrokes: true },
    { difficulty: "beginner", label: "Down strums on every beat", pattern: [down(0, TOP4), down(1, TOP3), down(2, TOP3)], release: 0.5, countStrokes: true },
    { difficulty: "amateur", label: "D · D · D U", pattern: writtenStrokes("D·D·DU", 0.5, 1), release: 0.25, countStrokes: true },
    { difficulty: "semi-pro", label: "D · D U D U", pattern: [down(0, TOP4), down(1, TOP3), up(1.5, TOP2), down(2, TOP3), up(2.5, TOP2)], release: 0.25, countStrokes: true },
    { difficulty: "pro", label: "Sixteenths: D · · · D · D U · · D U", pattern: writtenStrokes("D··· D·DU ··DU", 0.25, 1), countStrokes: true },
    { difficulty: "expert", label: "Sixteenths: D · D U · U D U D · U ·", pattern: writtenStrokes("D·DU ·UDU D·U·", 0.25, 1), countStrokes: true },
    { difficulty: "maestro", label: "Syncopated sixteenths: D · · U · U D · D U · U", pattern: writtenStrokes("D··U ·UD· DU·U", 0.25, 1), countStrokes: true },
  ],
  "6/8": [
    { difficulty: "baby", label: "A down strum a bar", pattern: [down(0, TOP3)], release: 1.5, countStrokes: true },
    { difficulty: "beginner", label: "Down strums on 1 and 4", pattern: [down(0, TOP4), down(1.5, TOP4)], release: 0.75, countStrokes: true },
    { difficulty: "amateur", label: "D · D D · D", pattern: [down(0, TOP4), down(1, TOP3), down(1.5, TOP4), down(2.5, TOP3)], countStrokes: true },
    { difficulty: "semi-pro", label: "D · U D D U", pattern: writtenStrokes("D·UDDU", 0.5, 1.5, TOP3), release: 0.25, countStrokes: true },
    { difficulty: "pro", label: "Sixteenths: D · D U D · D · D U D ·", pattern: writtenStrokes("D·DUD· D·DUD·", 0.25, 1.5), countStrokes: true },
    { difficulty: "expert", label: "Sixteenths: D · · U D · D · D U · U", pattern: writtenStrokes("D··UD· D·DU·U", 0.25, 1.5), countStrokes: true },
    { difficulty: "maestro", label: "Syncopated sixteenths: D · · U D U · U D · D U", pattern: writtenStrokes("D··UDU ·UD·DU", 0.25, 1.5), countStrokes: true },
  ],
  "12/8": [
    { difficulty: "baby", label: "A down strum a bar", pattern: [down(0, TOP3)], release: 1.5, countStrokes: true },
    { difficulty: "beginner", label: "Down strums on every beat", pattern: [0, 1.5, 3, 4.5].map((at) => down(at, TOP4)), release: 0.75, countStrokes: true },
    { difficulty: "amateur", label: "Shuffle: down on the long and short eighth", pattern: [0, 1.5, 3, 4.5].flatMap((at) => [down(at, TOP4), down(at + 1, TOP3)]), release: 0.25, countStrokes: true },
    { difficulty: "semi-pro", label: "Shuffle, down and up", pattern: [0, 1.5, 3, 4.5].flatMap((at) => [down(at, TOP4), up(at + 1, TOP3)]), release: 0.25, countStrokes: true },
    { difficulty: "pro", label: "Shuffle pushed: D · U · D U D · U · D U", pattern: writtenStrokes("D·U ·DU D·U ·DU", 0.5, 1.5, TOP3), countStrokes: true },
    { difficulty: "expert", label: "D U D U, a sixteenth push on every beat", pattern: [0, 1.5, 3, 4.5].flatMap((at) => [down(at, TOP4), up(at + 0.5, TOP2), down(at + 1, TOP3), up(at + 1.25, TOP2)]), countStrokes: true },
    { difficulty: "maestro", label: "Syncopated sixteenths, a different push each beat", pattern: writtenStrokes("D··UD· D·DU·U D··UD· D·DUDU", 0.25, 1.5), countStrokes: true },
  ],
};
/** The tempo progressions are played at by meter, in counted beats per minute. */
export const PROGRESSION_BPM: Readonly<Record<string, number>> = { "4/4": 90, "3/4": 96, "6/8": 60, "12/8": 60 };
/** How a progression's chords are played: strummed at every difficulty, or picked as an arpeggio. */
export type ProgressionStyle = "strum" | "arpeggio-up" | "arpeggio-down" | "arpeggio-up-down";
export const PROGRESSION_STYLES: readonly { readonly id: ProgressionStyle; readonly name: string }[] = [
  { id: "strum", name: "Strum" },
  { id: "arpeggio-up", name: "Arpeggio up" },
  { id: "arpeggio-down", name: "Arpeggio down" },
  { id: "arpeggio-up-down", name: "Arpeggio up and down" },
];
const eighths = (bar: number, step: number) => Array.from({ length: Math.round(bar / step) }, (_, k) => k * step);
/**
 * When an arpeggio picks, by meter and difficulty (quarters after the bar line): up to 2, 3, 4, 6 and 8 notes a bar from
 * baby to pro (their picked-notes limits), then triplets or sixteenths.
 */
export const ARPEGGIO_TIMES: Readonly<Record<string, Readonly<Record<Level, readonly number[]>>>> = {
  "4/4": { baby: [0, 2], beginner: [0, 1, 2], amateur: [0, 1, 2, 3], "semi-pro": [0, 1, 1.5, 2, 3, 3.5], pro: eighths(4, 0.5), expert: eighths(4, 1 / 3), maestro: eighths(4, 0.25) },
  "3/4": { baby: [0, 1], beginner: [0, 1, 2], amateur: [0, 1, 1.5, 2], "semi-pro": eighths(3, 0.5), pro: [0, 0.5, 1, 1.5, 1.75, 2, 2.5, 2.75], expert: eighths(3, 1 / 3), maestro: eighths(3, 0.25) },
  "6/8": { baby: [0, 1.5], beginner: [0, 1, 1.5], amateur: [0, 1, 1.5, 2.5], "semi-pro": eighths(3, 0.5), pro: [0, 0.5, 1, 1.25, 1.5, 2, 2.5, 2.75], expert: [0, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.25, 2.5, 2.75], maestro: eighths(3, 0.25) },
  "12/8": { baby: [0, 3], beginner: [0, 1.5, 3], amateur: [0, 1.5, 3, 4.5], "semi-pro": [0, 1, 1.5, 3, 4, 4.5], pro: [0, 1, 1.5, 2.5, 3, 4, 4.5, 5.5], expert: eighths(6, 0.5), maestro: [...eighths(6, 0.5), 1.25, 2.75, 4.25, 5.75].sort((a, b) => a - b) },
};
/** Quarters an arpeggio's tones let go before the chord changes, so the hand can move: more time for easier levels. */
const ARPEGGIO_RELEASE: Readonly<Record<Level, number>> = { baby: 1, beginner: 1, amateur: 0.5, "semi-pro": 0.5, pro: 0.5, expert: 0.25, maestro: 0.25 };
/**
 * One arpeggio version per difficulty for a meter; the last chord is picked once, bass and top. The release never
 * makes a bar's last tone shorter than the level's shortest note (baby's second tone in 6/8 keeps a quarter).
 */
export function arpeggioVersions(time: readonly [number, number], direction: Arpeggio["direction"]): PracticeVersion[] {
  const times = ARPEGGIO_TIMES[`${time[0]}/${time[1]}`];
  if (!times) throw new RangeError(`No arpeggios for ${time[0]}/${time[1]}: ${Object.keys(ARPEGGIO_TIMES).join(", ")}`);
  const name = PROGRESSION_STYLES.find((s) => s.id === `arpeggio-${direction}`)!.name,
    bar = barQuarters({ time });
  return levels.map((difficulty) => {
    // A tone lets go at most half its length early (sourceFor); only a shorter half needs a shorter release.
    const left = bar - times[difficulty].at(-1)!,
      shortest = value(compilePlayer({ level: difficulty }).minDuration);
    return {
      difficulty,
      label: `${name}, ${times[difficulty].length} notes a bar`,
      pattern: [],
      arpeggio: { direction, at: times[difficulty] },
      hold: pick(0, 0, -1),
      release: left / 2 >= shortest ? ARPEGGIO_RELEASE[difficulty] : Math.min(ARPEGGIO_RELEASE[difficulty], Math.max(0, left - shortest)),
    };
  });
}
const versionsOf = (time: readonly [number, number], style: ProgressionStyle): readonly PracticeVersion[] => {
  const meter = `${time[0]}/${time[1]}`;
  if (style === "strum") {
    const versions = PROGRESSION_VERSIONS[meter];
    if (!versions) throw new RangeError(`No versions for ${meter}: ${Object.keys(PROGRESSION_VERSIONS).join(", ")}`);
    return versions;
  }
  if (!PROGRESSION_STYLES.some((s) => s.id === style)) throw new RangeError(`Unknown style: ${style}`);
  return arpeggioVersions(time, style.slice("arpeggio-".length) as Arpeggio["direction"]);
};
/** A strumming pattern: one bar, repeated over a progression in place of the versions by difficulty. */
export interface StrumPattern {
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
const shortened = (hits: readonly Hit[], length: number) => hits.map((hit) => ({ ...hit, length }));
/**
 * Common strumming patterns by style. None strikes more than three quarters of the places on its grid. Chucks and
 * other muted, percussive strokes have no pitch and are not written; a chop or a skank is a short strum.
 */
export const STRUM_PATTERNS: readonly StrumPattern[] = [
  { id: "island", name: "Island strum", style: "Island and reggae", time: [4, 4], strokes: "D · D U · U D U", pattern: writtenStrokes("D·DU·UDU", 0.5, 1, TOP3), bpm: 100, difficulty: "amateur", typical: ["ukulele", "guitar"] },
  { id: "reggae", name: "Reggae skank", style: "Island and reggae", time: [4, 4], strokes: "· · D · · · D ·", pattern: shortened(writtenStrokes("··D···D·", 0.5, 1), 0.5), bpm: 76, difficulty: "beginner", typical: ["guitar", "ukulele"] },
  { id: "ska", name: "Ska upstrokes", style: "Island and reggae", time: [4, 4], strokes: "· U · U · U · U", pattern: shortened(writtenStrokes("·U·U·U·U", 0.5, 1, TOP3), 0.25), bpm: 140, difficulty: "amateur", typical: ["guitar"] },
  { id: "rock", name: "Rock downstrokes", style: "Pop, rock and funk", time: [4, 4], strokes: "D · D D · D D ·", pattern: writtenStrokes("D·DD·DD·", 0.5, 1), bpm: 120, difficulty: "amateur", typical: ["guitar"] },
  { id: "pop", name: "Pop strum", style: "Pop, rock and funk", time: [4, 4], strokes: "D · D U · U D ·", pattern: writtenStrokes("D·DU·UD·", 0.5, 1, TOP3), bpm: 96, difficulty: "amateur", typical: ["guitar", "ukulele"] },
  { id: "funk", name: "Funk sixteenths", style: "Pop, rock and funk", time: [4, 4], strokes: "D · · U · U D · · U D · D U · U", pattern: writtenStrokes("D··U·UD··UD·DU·U", 0.25, 1), bpm: 96, difficulty: "amateur", typical: ["guitar"] },
  { id: "folk", name: "Folk strum", style: "Folk and country", time: [4, 4], strokes: "D · D U D U · U", pattern: writtenStrokes("D·DUDU·U", 0.5, 1, TOP3), bpm: 100, difficulty: "amateur", typical: ["guitar", "ukulele", "mandolin"] },
  { id: "boom-chick", name: "Boom-chick", style: "Folk and country", time: [4, 4], strokes: "B · D · B · D ·", bass: [{ at: 0, tone: "root" }, { at: 2, tone: "fifth" }], pattern: [down(1, TOP3), down(3, TOP3)], bpm: 100, difficulty: "amateur", typical: ["guitar"], strings: 6 },
  { id: "boom-chicka", name: "Boom-chicka", style: "Folk and country", time: [4, 4], strokes: "B · D U B · D U", bass: [{ at: 0, tone: "root" }, { at: 2, tone: "fifth" }], pattern: [down(1, TOP3), up(1.5, TOP2), down(3, TOP3), up(3.5, TOP2)], bpm: 100, difficulty: "amateur", typical: ["guitar"], strings: 6 },
  { id: "chop", name: "Bluegrass chop", style: "Folk and country", time: [4, 4], strokes: "· · D · · · D ·", pattern: shortened(writtenStrokes("··D···D·", 0.5, 1), 0.25), bpm: 120, difficulty: "amateur", typical: ["mandolin"] },
  { id: "swing", name: "Swing strum", style: "Swing and blues", time: [4, 4], strokes: "D · U D · U D · U D · U (triplets)", pattern: writtenStrokes("D·UD·UD·UD·U", 1 / 3, 1, TOP3), bpm: 110, difficulty: "amateur", typical: ["guitar", "ukulele"] },
  { id: "shuffle", name: "Blues shuffle", style: "Swing and blues", time: [12, 8], strokes: "D · U D · U D · U D · U", pattern: writtenStrokes("D·UD·UD·UD·U", 0.5, 1.5, TOP3), bpm: 60, difficulty: "amateur", typical: ["guitar"] },
  { id: "waltz", name: "Waltz strum", style: "Waltz", time: [3, 4], strokes: "D · D U D U", pattern: writtenStrokes("D·DUDU", 0.5, 1), bpm: 96, difficulty: "amateur", typical: ["guitar", "ukulele", "mandolin"] },
  { id: "waltz-push", name: "Waltz with a push", style: "Waltz", time: [3, 4], strokes: "D · D U · U", pattern: writtenStrokes("D·DU·U", 0.5, 1), bpm: 96, difficulty: "amateur", typical: ["guitar", "ukulele"] },
  { id: "waltz-boom", name: "Boom-chick-chick", style: "Waltz", time: [3, 4], strokes: "B · D · D ·", bass: [{ at: 0, tone: "root" }], pattern: [down(1, TOP3), down(2, TOP3)], bpm: 96, difficulty: "amateur", typical: ["guitar"], strings: 6 },
  { id: "ballad-68", name: "6/8 ballad", style: "Ballad", time: [6, 8], strokes: "D · U D · U", pattern: writtenStrokes("D·UD·U", 0.5, 1.5, TOP3), bpm: 60, difficulty: "amateur", typical: ["guitar", "ukulele"] },
];
/** A strumming pattern by id. */
export function strumPattern(id: string): StrumPattern {
  const found = STRUM_PATTERNS.find((p) => p.id === id);
  if (!found) throw new RangeError(`Unknown strumming pattern: ${id}`);
  return found;
}
const patternVersion = (p: StrumPattern): PracticeVersion => ({
  difficulty: p.difficulty,
  label: `${p.name}: ${p.strokes}`,
  pattern: p.pattern,
  ...(p.bass ? { bass: p.bass } : { countStrokes: true }),
});
/**
 * A progression as a chord song in C major (A minor for a minor one), the key selector moving it: a four-bar loop
 * twice, the 12-bar blues once, then the tonic held a bar; one version per difficulty for the meter.
 */
export function progressionSong(
  progression: Progression,
  time: readonly [number, number],
  { instrument = "guitar", style = "strum", pattern }: { instrument?: string; style?: ProgressionStyle; pattern?: string } = {},
): ChordSong {
  const meter = `${time[0]}/${time[1]}`,
    strum = pattern === undefined ? undefined : strumPattern(pattern);
  if (strum && (style !== "strum" || `${strum.time[0]}/${strum.time[1]}` !== meter))
    throw new RangeError(`${strum.name} is a ${strum.time[0]}/${strum.time[1]} strumming pattern; it cannot be played in ${meter} or as an arpeggio`);
  const versions = strum ? [patternVersion(strum)] : versionsOf(time, style);
  const key = progression.mode === "minor" ? "A" : "C",
    chords = progression.numerals.map((n) => chordOfNumeral(n, key)),
    m = compoundMeter(time) ? 3 : 1;
  return {
    id: `progression-${progression.id}-${time[0]}-${time[1]}${style === "strum" ? "" : `-${style}`}${strum ? `-${strum.id}` : ""}`,
    title: progression.name,
    credit: `${progression.songs} of ${BILLBOARD_SONGS} Billboard Hot 100 songs, 1958–1991`,
    description: `${progression.note ? `${progression.note[0]!.toUpperCase()}${progression.note.slice(1)}. ` : ""}${chords.join(" ")} in ${key} ${progression.mode}, a bar each.`,
    instrument,
    key,
    mode: progression.mode,
    time: [time[0], time[1]],
    beat: (4 * m) / time[1],
    bpm: strum?.bpm ?? PROGRESSION_BPM[meter]!,
    progression: chords.length >= 8 ? chords : [...chords, ...chords],
    ending: chordOfNumeral(progression.mode === "minor" ? "i" : "I", key),
    versions: versions.map((v) => ({ ...v, id: v.difficulty })),
  };
}

/** Triad qualities by the semitones of the third and the fifth above the root. */
const TRIADS = { "4,7": "", "3,7": "m", "3,6": "dim", "4,8": "aug" };
/**
 * The triad on every degree of a seven-note scale, spelled plainly ("Bdim", "Caug"), or null for other scales. The
 * melodic minor uses its rising form.
 */
export function scaleTriads(tonic: string, scale: string): string[] | null {
  const pitches = scalePitches(`${tonic}4`, scale, { octaves: 2, direction: "up" });
  if (scaleById(scale).up.length !== 7) return null;
  return Array.from({ length: 7 }, (_, k) => {
    const [root, third, fifth] = [k, k + 2, k + 4].map((i) => pitchToMidi(pitches[i]!));
    const quality = (TRIADS as Readonly<Record<string, string>>)[`${third! - root!},${fifth! - root!}`] ?? "";
    return `${plainName(pitches[k]!.replace(/-?\d+$/, ""))}${quality}`;
  });
}
/**
 * A seven-note scale played as its chords, a bar each: up the degrees to the octave, back down, and the tonic held,
 * in one of the progression styles (strummed or arpeggiated), one version per difficulty.
 */
export function scaleChordsSong(
  { scale, tonic, time }: { scale: string; tonic: string; time: readonly [number, number] },
  { instrument = "guitar", style = "strum" }: { instrument?: string; style?: ProgressionStyle } = {},
): ChordSong {
  const triads = scaleTriads(tonic, scale),
    info = scaleById(scale);
  if (!triads) throw new RangeError(`${info.name} has no chord on every degree: only seven-note scales do`);
  const versions = versionsOf(time, style),
    m = compoundMeter(time) ? 3 : 1;
  return {
    id: `scale-chords-${scale}-${tonic}-${time[0]}-${time[1]}-${style}`,
    title: `${tonic} ${info.name.toLowerCase()} scale in chords`,
    credit: "Scale exercise",
    description: `The triad on every degree, up and back down: ${triads.join(" ")}.`,
    instrument,
    key: tonic,
    mode: info.quality,
    time: [time[0], time[1]],
    beat: (4 * m) / time[1],
    bpm: PROGRESSION_BPM[`${time[0]}/${time[1]}`]!,
    progression: [...triads, triads[0]!, ...triads.slice(1).reverse()],
    ending: triads[0]!,
    versions: versions.map((v) => ({ ...v, id: v.difficulty })),
  };
}

// ---- performance and display helpers ----------------------------------------------------------------------------------
export interface Stroke {
  readonly id: string;
  readonly at: Q;
  readonly direction: "down" | "up";
  readonly spreadSeconds?: number;
}
/** Strum strokes for createPerformance: one per strummed hit that still sounds in `result`; the last chord is a slow down strum. */
export function strokesFor(spec: SongSpec | ScorePiece, result: { readonly score: Score }): Stroke[] {
  if (!("pattern" in spec) || !strummed(spec)) return [];
  const attacked = new Set(result.score.notes.map((n) => value(n.onset))),
    bars = barsOf(spec),
    strokes: Stroke[] = [];
  bars.forEach((_, b) => {
    let h = 0;
    for (const segment of segmentsOf(spec, b))
      for (const hit of hitsIn(spec, b, segment)) {
        const when = at(barStart(spec, b) + hit.at);
        if (b === bars.length - 1) strokes.push({ id: `${spec.id}-stroke-end${h ? `-${h}` : ""}`, at: when, direction: "down", spreadSeconds: 0.06 });
        else if (hit.stroke) strokes.push({ id: `${spec.id}-stroke-${b + 1}-${h}`, at: when, direction: hit.stroke });
        h++;
      }
  });
  return strokes.filter((stroke) => attacked.has(value(stroke.at)));
}
/** Which limits of a difficulty the source itself exceeds at a tempo, before any fingering is searched; picked notes per bar only when it is not strummed. */
export function limitsExceeded(
  spec: { readonly beat: number; readonly bpm: number; readonly countStrokes?: boolean; readonly pattern?: readonly Hit[] },
  source: Score,
  { bpm = spec.bpm, level }: { bpm?: number; level: Level },
): string[] {
  const profile = compilePlayer({ level }),
    scale = (bpm * spec.beat) / source.tempoMap[0]!.quarterBpm;
  const seconds = (x: Q) => secondsAt(x, source.tempoMap) / scale;
  const notes = source.notes.map((n) => ({ on: seconds(n.onset), off: seconds(addQ(n.onset, n.gateDuration ?? n.duration)) }));
  const onsets = (spec.countStrokes ? [...new Set(notes.map((n) => n.on))] : notes.map((n) => n.on)).sort((a, b) => a - b);
  let attacks = 0,
    polyphony = 0;
  for (const t of onsets) {
    attacks = Math.max(attacks, onsets.filter((o) => o > t - 1 + 1e-9 && o <= t).length);
    polyphony = Math.max(polyphony, notes.filter((n) => n.on <= t && n.off > t).length);
  }
  const limits: string[] = [];
  if (attacks > profile.maxAttacksPerSecond) limits.push(`up to ${attacks} ${spec.countStrokes ? "strokes" : "string attacks"} in one second; this difficulty allows ${profile.maxAttacksPerSecond}`);
  if (polyphony > profile.maxPolyphony) limits.push(`${polyphony} notes sounding at once; this difficulty allows ${profile.maxPolyphony}`);
  if (profile.maxPickedPerBar !== undefined && !strummed(spec)) {
    // Per bar: notes and the moments they start at. One note at a time is always allowed.
    const perBar = new Map<number, { notes: number; at: Set<number> }>();
    for (const n of source.notes) {
      const bar = barAt(n.onset, source.meterMap),
        entry = perBar.get(bar) ?? { notes: 0, at: new Set<number>() };
      entry.notes++;
      entry.at.add(value(n.onset));
      perBar.set(bar, entry);
    }
    const over = [...perBar.values()].filter((b) => b.notes > profile.maxPickedPerBar! && b.notes > b.at.size);
    if (over.length)
      limits.push(`up to ${Math.max(...over.map((b) => b.notes))} picked notes in one bar, some together; this difficulty allows ${profile.maxPickedPerBar} unless each sounds alone`);
  }
  return limits;
}
export interface ChordShapeUse {
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
export function voicingsFor(result: { readonly score: Score; readonly annotations: readonly FrettedAnnotation[] }, instrument: FrettedInstrument): ChordShapeUse[] {
  const capo = instrument.strings[0]!.capoFret,
    notes = new Set(result.score.notes.map((n) => n.id));
  return result.score.harmony.filter((h) => h.selected).map((h) => {
    const played = new Map<number, number[]>();
    let barre: number | null = null;
    for (const a of result.annotations) {
      if (value(a.at) < value(h.onset) - 1e-9 || value(a.at) >= value(h.end) - 1e-9) continue;
      for (const p of a.assignments)
        if (p.noteIds.some((i) => a.attackIds.includes(i) && notes.has(i))) played.set(p.stringNumber, [...(played.get(p.stringNumber) ?? []), p.relativeFret]);
      const contact = a.contacts.find((c) => c.toString > c.fromString);
      if (contact && barre === null) barre = contact.fret - capo;
    }
    const inside = (f: number, from: number) => f === 0 || (f >= from && f <= from + 4);
    const covered = (from: number) => [...played.values()].filter((list) => list.some((f) => inside(f, from))).length;
    const from = [...new Set([...played.values()].flat().filter((f) => f > 0))].sort((a, b) => a - b).reduce((best, f) => (covered(f) > covered(best) ? f : best), 1);
    const frets = instrument.strings.map((s) => played.get(s.number)?.find((f) => inside(f, from)) ?? ("x" as const));
    return { chord: h.selected!, at: value(h.onset), frets, barre: barre !== null && inside(barre, from) ? barre : null };
  });
}
