// The playground's songs and its tab rendering. Arranging them is scorify's songs module (scorify/songs): chord-chart
// songs with a version per difficulty, chord voicings, imported scores and charts, version fallback, cached replay,
// retime and capo suggestions. This file holds the demo's content and draws the defuss-shadcn Fretboard tab; it
// re-exports the library functions the page, the precompute script and the tests use, with the cache version
// (build.mjs, from src/VERSION) in every attempt fingerprint.
import * as library from "./scorify/songs.mjs";
import { ALL, down, up, pick, barQuarters, barsOf, barStart, intervalOf, transposeSymbol, voicingsFor, strokesFor, NO_CHORD } from "./scorify/songs.mjs";
import { build } from "./scorify/build.mjs";
export {
  INSTRUMENTS as instruments, instrumentFor, customInstrumentId, highestFret, LEVEL_TEMPO, tempoFor, intervalOf, barQuarters, voiceChord, voicingsForSong,
  sourceFor, SET_SCHEMA, estimateLevel, pieceFromScore, CHART_SCHEMA, songFromChart, SEARCH, QUICK, WIDE, DEEP, RETRIES, versionsFor, prepare,
  hardestVersion, hardestNotes, stableJson, fingerprint, pieceFingerprint, cacheKey, searched, cacheable, ARRANGEMENT_SCHEMA, suggestCapo,
  strokesFor, limitsExceeded, voicingsFor, versionById, KEY_SHIFTS, keyName, transposeSong,
  scalePiece, scaleOnNeck, scaleRhythms, SCALE_BPM, progressionSong, PROGRESSIONS, BILLBOARD_SONGS,
} from "./scorify/songs.mjs";
export { SCALES, TONICS } from "./scorify/theory.mjs";
export { levels } from "./scorify/index.mjs";
/** The library's arrangeFor, with this build in every attempt fingerprint, and retime (playback tempo only). */
export const arrangeFor = (piece, request, options) => library.arrangeFor(piece, request, { build, ...options });
export const retime = (piece, shown, request) => library.retime(piece, shown, request);

// Each song is a set of versions, one written for every difficulty, as chord symbols and rhythm layers. The playground
// picks the version written for the chosen difficulty and scorify fingers it for the chosen instrument, checking that
// it plays. Somewhere Over the Rainbow and Wicked Game carry no vocal line or lyrics (their melodies and words are
// not transcribed here); House of the Rising Sun carries the traditional vocal line and its words, shown, not played.
//
// A bar of a progression holds one chord symbol, or several sharing the bar evenly ("C Am": two halves); "N.C." is a
// bar, or part of one, without accompaniment. A pattern hit picks tones of the voicing of the chord sounding at its
// time by string, bass edge first: 0 is the lowest played string, -1 the highest, "all" every string. On a reentrant
// ukulele that is string order, not pitch order, as a strumming hand sees it. Each tone rings until the same string is
// struck again, the next chord's first hit or the bar ends.
// - holds: bar numbers (from 1) that strike once at each chord and let it ring (the version's `hold` hit, else the
//   first hit of its pattern), like the ending.
// - bass: an alternating bass under the pattern: the voicing's root and its fifth (below when the strings reach it).
// - fill: every `every`-th bar (or the listed `bars`), the hits from `from` on give way to a sixteenth-note run in the
//   key, `steps` scale degrees from the voicing's top note, taking accidentals from the chord sounding there.
// - vocal: [onset, duration, sounding pitch, syllable] in quarters from the very start (the pickup included).
const DOWN = down, UP = up, PICK = pick;
const TOP2 = [-2, -1], TOP3 = [-3, -2, -1], TOP4 = [-4, -3, -2, -1];
// The traditional vocal line and its first verse: Frank Nordberg's transcription (Musica Viva, ABC X:417, D minor),
// converted with the score-import skill and moved up a fifth to A minor. The pickup quarter is beat 0.
const RISING_VOCAL = [
  [0, 1, "E5", "There"], [1, 2, "A4", "is"], [3, 0.5, "B4", "a"], [3.5, 0.5, "A4", ""], [4, 2, "C5", "house"],
  [6, 0.5, "D5", "in"], [6.5, 0.5, "D#5", ""], [7, 2, "E5", "New"], [9, 0.5, "C5", "Or-"], [9.5, 0.5, "B4", ""],
  [10, 2, "A4", "leans,"], [12, 1, "E5", "they"], [13, 2, "A5", "call"], [15, 1, "E5", "the"], [16, 2, "G5", "ris-"],
  [18, 0.5, "E5", "ing"], [18.5, 0.5, "D5", ""], [19, 4, "E5", "sun."], [24, 0.5, "E5", "And"], [24.5, 0.5, "E5", "it's"],
  [25, 2, "A5", "been"], [27, 1, "A4", "the"], [28, 2, "C5", "ruin"], [30, 1, "D5", "of"], [31, 0.5, "E5", "man-"],
  [31.5, 1.5, "E5", "y"], [33, 0.5, "C5", "poor"], [33.5, 0.5, "B4", ""], [34, 2, "A4", "boy,"], [36, 1, "E5", "and"],
  [37, 2, "E5", "Lord,"], [39, 1, "E5", "I"], [40, 0.5, "E5", "know"], [40.5, 1.5, "E4", ""], [42, 0.5, "C5", "I'm"],
  [42.5, 0.5, "B4", ""], [43, 5, "A4", "one."],
];
export const songs = [
  {
    id: "rainbow",
    title: "Somewhere Over the Rainbow",
    credit: "Harold Arlen · E. Y. Harburg",
    instrument: "uke-high-g",
    key: "C", mode: "major", time: [4, 4], beat: 1, bpm: 80,
    description: "Intro and verse, sixteen bars, strummed. From one strum per bar up to the island strum with sixteenth-note pushes and a melodic fill closing every phrase.",
    progression: ["C", "Em", "Am", "F", "C", "G", "Am", "F", "C", "Em", "F", "C", "F", "C", "G", "Am"],
    ending: "C",
    versions: [
      { difficulty: "baby", label: "Two strings, once a bar", pattern: [DOWN(0, TOP2)], release: 1 },
      { difficulty: "beginner", label: "Down strums on 1 and 3", pattern: [DOWN(0), DOWN(2)], release: 1 },
      { difficulty: "amateur", label: "Down, up, down, up", pattern: [DOWN(0, TOP4), UP(1.5, TOP2), DOWN(2, TOP4), UP(3.5, TOP2)] },
      { difficulty: "semi-pro", label: "Island strum, light ups", pattern: [DOWN(0, TOP4), DOWN(1, TOP4), UP(1.5, TOP2), UP(2.5, TOP2), DOWN(3, TOP4), UP(3.5, TOP2)] },
      { difficulty: "pro", label: "Island strum", pattern: [DOWN(0, TOP4), DOWN(1, TOP4), UP(1.5, TOP4), UP(2.5, TOP4), DOWN(3, TOP4), UP(3.5, TOP4)] },
      { difficulty: "expert", label: "Island strum with pushes", pattern: [DOWN(0), UP(0.75, TOP2), DOWN(1), UP(1.5), UP(2.5), DOWN(3), UP(3.5), UP(3.75, TOP2)] },
      {
        difficulty: "maestro", label: "Pushes and phrase fills",
        pattern: [DOWN(0), UP(0.75, TOP2), DOWN(1), UP(1.5), UP(2.5), DOWN(3), UP(3.5), UP(3.75, TOP2)],
        fill: { every: 4, from: 2.5, steps: [1, 2, 1, 0, -1, 0] },
      },
    ],
  },
  {
    id: "wicked",
    title: "Wicked Game",
    credit: "Chris Isaak",
    instrument: "guitar",
    key: "B", mode: "minor", time: [4, 4], beat: 1, bpm: 108,
    description: "Sixteen bars of the three-chord loop. From a bass note per bar up to an alternating bass under a strum on the treble strings and a run in B minor closing every phrase.",
    progression: ["Bm", "A", "E", "E", "Bm", "A", "E", "E", "Bm", "A", "E", "E", "Bm", "A", "E", "E"],
    ending: "Bm",
    versions: [
      { difficulty: "baby", label: "Root note, once a bar", pattern: [PICK(0, 0)], release: 1 },
      { difficulty: "beginner", label: "Root, then a strum on 3", pattern: [PICK(0, 0), DOWN(2, TOP3)], release: 1 },
      { difficulty: "amateur", label: "Root, strums on 2 and 4", pattern: [PICK(0, 0), DOWN(1, TOP3), DOWN(3, TOP3)] },
      { difficulty: "semi-pro", label: "Root, down-up on 2 and 4", pattern: [PICK(0, 0), DOWN(1, TOP3), UP(1.5, TOP3), DOWN(3, TOP3), UP(3.5, TOP3)] },
      { difficulty: "pro", label: "Root, strum D U · U D U", pattern: [PICK(0, 0), DOWN(1, TOP3), UP(1.5, TOP3), UP(2.5, TOP3), DOWN(3, TOP3), UP(3.5, TOP3)] },
      { difficulty: "expert", label: "Fuller strums", pattern: [PICK(0, 0), DOWN(1, TOP4), UP(1.5, TOP3), UP(2.5, TOP3), DOWN(3, TOP4), UP(3.5, TOP3)] },
      {
        difficulty: "maestro", label: "Alternating bass and phrase fills",
        bass: [{ at: 0, tone: "root" }, { at: 2, tone: "fifth" }],
        pattern: [DOWN(1, TOP3), UP(1.5, TOP3), UP(2.5, TOP3), DOWN(2.75, TOP2), DOWN(3, TOP3)],
        fill: { every: 4, from: 2.5, steps: [2, 1, 0, -1, -2, 0] },
      },
    ],
  },
  {
    id: "rising",
    title: "House of the Rising Sun",
    credit: "Traditional",
    instrument: "guitar",
    key: "A", mode: "minor", time: [3, 4], beat: 1, bpm: 96,
    pickup: 1,
    description: "The traditional tune, sixteen bars and a pickup, with its first verse to sing along. The accompaniment goes from a bass note per bar up to the six-note arpeggio with an alternating bass and phrase fills.",
    progression: ["Am", "C", "D", "F", "Am", "C", "E", "E", "Am", "C", "D", "F", "Am", "E", "Am", "Am"],
    ending: "Am",
    vocal: RISING_VOCAL,
    versions: [
      { difficulty: "baby", label: "Root note, once a bar", pattern: [PICK(0, 0)], release: 1 },
      { difficulty: "beginner", label: "Root, then two strings", pattern: [PICK(0, 0), PICK(1, 1, 2)], release: 0.5 },
      { difficulty: "amateur", label: "Quarter-note arpeggio", pattern: [PICK(0, 0), PICK(1, 1), PICK(2, 2)] },
      { difficulty: "semi-pro", label: "Arpeggio p i m i m i", pattern: [PICK(0, 0), PICK(0.5, 1), PICK(1, 2), PICK(1.5, 1), PICK(2, 2), PICK(2.5, 1)] },
      { difficulty: "pro", label: "Arpeggio over four strings", pattern: [PICK(0, 0), PICK(0.5, -3), PICK(1, -2), PICK(1.5, -1), PICK(2, -2), PICK(2.5, -3)] },
      { difficulty: "expert", label: "Arpeggio with sixteenth pickups", pattern: [PICK(0, 0), PICK(0.5, -3), PICK(1, -2), PICK(1.5, -1), PICK(1.75, -2), PICK(2, -1), PICK(2.5, -3), PICK(2.75, -2)] },
      {
        difficulty: "maestro", label: "Alternating bass and phrase fills",
        pattern: [PICK(0, 0), PICK(0.5, -3), PICK(1, -2), PICK(1.5, -1), PICK(2, 1), PICK(2.5, -2), PICK(2.75, -1)],
        fill: { every: 4, from: 1.5, steps: [2, 1, 0, -1, 0, 1] },
      },
    ],
  },
];
// A pickup shifts every bar line; the tab pads the first bar so they fall where they are written.
// A pickup shifts every bar line; the tab pads the first bar so they fall where they are written.
for (const song of songs) {
  song.pad = song.pickup ? barQuarters(song) - song.pickup : 0;
  for (const version of song.versions) version.id = version.difficulty;
}

const value = x => x[0] / x[1];
const shapeText = frets => frets.some(f => typeof f === "number" && f > 9) ? frets.join(" ") : frets.join("");

/**
 * A defuss-shadcn Fretboard song (version 1), built only from the solver's string and fret assignments, plus a lane
 * for the sung part: its words, or its note names when it has none.
 */
export function tabFor(piece, result, instrument, { spec = piece, vocal = [] } = {}) {
  if (result.status !== "success") throw new Error("Only a successful arrangement has a tab");
  const bar = barQuarters(piece), unit = piece.time[1] / 4, pad = piece.pad ?? 0; // the Fretboard counts time-signature beats, scorify quarters
  const place = at => {
    const quarters = at + pad, measure = Math.floor(quarters / bar + 1e-9);
    return { measure: measure + 1, beat: (quarters - measure * bar) * unit + 1 };
  };
  // One chart per chord name; spans that play fewer strings of the same voicing merge into it, a different voicing gets its own chart.
  // With a capo, a song's chords are named by the shapes the hand holds, as on a capo chart: capo 2, Am for B minor.
  const capo = instrument.strings[0].capoFret, shapeOf = chord => (capo && spec.progression ? transposeSymbol(chord, intervalOf(-capo)) : chord);
  const charts = [], chordItems = voicingsFor(result, instrument).map(found => ({ ...found, chord: shapeOf(found.chord) })).map(v => {
    if (v.frets.every(f => f === "x")) return { ...place(v.at), name: v.chord };
    const same = charts.filter(c => c.chord === v.chord);
    let chart = same.find(c => c.frets.every((f, i) => f === "x" || v.frets[i] === "x" || f === v.frets[i]));
    if (chart) {
      chart.frets = chart.frets.map((f, i) => (f === "x" ? v.frets[i] : f));
      chart.barre ??= v.barre;
    } else charts.push(chart = { ...v, name: same.length ? `${v.chord} (${same.length + 1})` : v.chord });
    return { ...place(v.at), name: chart.name };
  });
  // Bars a chart leaves silent read "N.C.", so a rest in the accompaniment is not mistaken for a missing chord.
  if (spec.progression) barsOf(spec).forEach((symbols, b) => symbols.trim().split(/\s+/).forEach((symbol, k, all) => {
    if (symbol === NO_CHORD) chordItems.push({ ...place(barStart(spec, b) + (k * bar) / all.length), name: NO_CHORD });
  }));
  chordItems.sort((a, b) => a.measure - b.measure || a.beat - b.beat);
  const notes = new Map(result.score.notes.map(n => [n.id, n]));
  const strokes = new Map(strokesFor(spec, result).map(s => [value(s.at), s.direction]));
  const items = result.annotations.flatMap(a => {
    const attacked = a.assignments.filter(p => p.noteIds.some(id => a.attackIds.includes(id) && notes.has(id)));
    if (!attacked.length) return [];
    const start = value(a.at), direction = strokes.get(start);
    const length = Math.max(...attacked.map(p => value(notes.get(p.noteIds.find(id => a.attackIds.includes(id))).duration)));
    return [{
      ...place(start), beats: length * unit,
      notes: attacked.map(p => ({ string: p.stringNumber, fret: p.relativeFret })),
      ...(direction && attacked.length > 1 ? { strum: direction } : {}),
    }];
  });
  // The sung part, a lane per verse: one item per syllable, lasting over the notes it is sung on; note names when it
  // has no words. A vocal entry is [onset, length, pitch, syllable or [syllable of each verse]].
  const texts = vocal.map(v => (Array.isArray(v[3]) ? v[3] : [v[3]]));
  const lanes = Array.from({ length: Math.max(1, ...texts.map(t => t.length)) }, (_, verse) => {
    const worded = texts.some(t => t[verse]);
    return vocal.flatMap(([onset, , pitch], k) => {
      if (worded && !texts[k][verse]) return [];
      let last = k;
      while (worded && vocal[last + 1] && !texts[last + 1][verse] && vocal[last + 1][0] <= vocal[last][0] + vocal[last][1] + 1e-9) last++;
      return [{ ...place(onset), beats: (vocal[last][0] + vocal[last][1] - onset) * unit, text: worded ? texts[k][verse] : pitch.replace(/-?\d+$/, "") }];
    });
  }).filter((items, verse) => verse === 0 || items.length);
  const end = Math.max(...[...result.score.notes, ...result.score.rests].map(n => value(n.onset) + value(n.duration)), ...vocal.map(v => v[0] + v[1]));
  const key = result.score.keyMap[0];
  return {
    version: 1,
    title: piece.title,
    tuning: instrument.strings.map(s => s.openPitch.replace(/-?\d+$/, "")),
    chords: Object.fromEntries(charts.map(c => [c.name, c.barre ? { frets: shapeText(c.frets), barre: c.barre } : shapeText(c.frets)])),
    scores: [{
      id: piece.id,
      key: key ? `${key.tonic}${key.mode === "minor" ? "m" : ""}` : "",
      time: piece.time,
      bpm: Math.round(result.score.tempoMap[0].quarterBpm * unit),
      measures: Math.max(1, Math.ceil((end + pad) / bar - 1e-9)),
      tracks: [
        { id: "chords", kind: "chords", items: chordItems },
        { id: "tab", kind: "tab", items },
        ...(vocal.length ? lanes.map((items, verse) => ({ id: `verse-${verse + 1}`, kind: "lyrics", label: verse ? String(verse + 1) : "♪", lang: (piece.lyricLanguages ?? piece.score?.notation?.lyricLanguages)?.[verse] ?? "en", items })) : []),
        ...(vocal.length ? [{ id: "vocal-pitches", kind: "lyrics", label: "Voice", items: vocal.map(([onset, duration, pitch]) => ({ ...place(onset), beats: duration * unit, text: pitch })) }] : []),
      ],
    }],
  };
}
