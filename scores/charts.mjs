// Writes the chord charts (scorify-chart-1) of the playground's public songs: docs/assets/scores/<id>.chart.json, one
// for each score imported from scores/<id>/ (see scores/README.md). Every chart plays the song's own key and bars; the
// versions follow one plan for all of them, by meter:
// - baby and beginner strum the simpler chords (simpleProgression), once a bar and on the beats;
// - amateur and semi-pro strum the full chords, with ups, the strummed progression versions of the library
//   (PROGRESSION_VERSIONS), which never strike more than three quarters of the places on their grid;
// - pro picks a bass note under strums; expert picks an arpeggio in eighths (sixteenths in 2/4); maestro adds sixteenth
//   pushes, and a short run in the bars where the voice holds a note or rests up to the bar line.
// The last bar strikes once and rings. Run with node after `bun run build` (it reads the built library in dist/).
//
//   node scores/charts.mjs
import { readFile, writeFile } from "node:fs/promises";
import { CHART_SCHEMA, PROGRESSION_VERSIONS, writtenStrokes, down, up, pick } from "../dist/songs.mjs";
import { compilePlayer, normalizeScore } from "../dist/index.mjs";

const TOP2 = [-2, -1], TOP3 = [-3, -2, -1];
const value = (x) => x[0] / x[1];
const eighths = (bar, step) => Array.from({ length: Math.round(bar / step) }, (_, k) => k * step);
// A bar of each feel: its length in quarters, the strummed versions up to semi-pro, pro's bass and strum, the arpeggio
// times of expert and maestro, and where maestro's run starts (six sixteenths before the bar line, four in 2/4).
const FEELS = {
  "4/4": {
    bar: 4,
    strums: PROGRESSION_VERSIONS["4/4"],
    pro: { label: "Bass note on 1 and 3, strums on 2 and 4 (D U)", pattern: [pick(0, 0), down(1, TOP3), up(1.5, TOP2), pick(2, 0), down(3, TOP3), up(3.5, TOP2)] },
    expert: eighths(4, 0.5),
    maestro: [0, 0.5, 1, 1.5, 1.75, 2, 2.5, 3, 3.5, 3.75],
    fill: { from: 2.5, steps: [2, 1, 0, -1, 0, 1] },
  },
  "3/4": {
    bar: 3,
    strums: PROGRESSION_VERSIONS["3/4"],
    pro: { label: "Bass note on 1, strums on 2 and 3 (D U D)", pattern: [pick(0, 0), down(1, TOP3), up(1.5, TOP2), down(2, TOP3)] },
    expert: eighths(3, 0.5),
    maestro: [0, 0.5, 1, 1.5, 1.75, 2, 2.5, 2.75],
    fill: { from: 1.5, steps: [2, 1, 0, -1, 0, 1] },
  },
  // Silent Night is written in 3/4 with the long-short rhythm of 6/8: two dotted beats a bar.
  "6/8": {
    bar: 3,
    strums: PROGRESSION_VERSIONS["6/8"],
    pro: { label: "Bass note on 1 and 4, strums on 3 and 6", pattern: [pick(0, 0), down(1, TOP3), pick(1.5, 0), down(2.5, TOP3)] },
    expert: eighths(3, 0.5),
    maestro: [0, 0.5, 1, 1.25, 1.5, 2, 2.5, 2.75],
    fill: { from: 1.5, steps: [2, 1, 0, -1, 0, 1] },
  },
  "2/4": {
    bar: 2,
    strums: [
      { difficulty: "baby", label: "A down strum a bar", pattern: [down(0, TOP3)], release: 0.5, countStrokes: true },
      { difficulty: "beginner", label: "Down strums on 1 and 2", pattern: writtenStrokes("D·D·", 0.5, 1), release: 0.25, countStrokes: true },
      { difficulty: "amateur", label: "D · D U", pattern: writtenStrokes("D·DU", 0.5, 1), countStrokes: true },
      { difficulty: "semi-pro", label: "Sixteenths: D · · U D · D U", pattern: writtenStrokes("D··U D·DU", 0.25, 1), countStrokes: true },
    ],
    pro: { label: "Bass note and strum, twice a bar", pattern: [pick(0, 0), down(0.5, TOP3), pick(1, 0), down(1.5, TOP3)] },
    expert: eighths(2, 0.25),
    maestro: eighths(2, 0.25),
    fill: { from: 1, steps: [1, 2, 1, 0] },
  },
};

const SONGS = [
  {
    id: "amazing-grace", feel: "3/4", instrument: "guitar", key: "G", mode: "major",
    credit: "John Newton (words, 1779) · tune New Britain (1831)",
    description: "All five verses of the Open Hymnal's edition, in G. Strummed up to semi-pro; pro picks a bass note under the strum, expert and maestro pick an arpeggio.",
    chartSource: "Chords: the usual G, C, D and Em, checked against the edition's four-part setting (E. O. Excell, 1900), which keeps G under most of the tune; G7 leads into C (bars 2, 10) and D7 into the last phrase. Baby and beginner play G, C and D only.",
    progression: ["G", "G G G7", "C", "G", "G", "G", "D", "D7", "G", "G G G7", "C", "G", "Em", "G G D7", "G", "G"],
    simpleProgression: ["G", "G", "C", "G", "G", "G", "D", "D", "G", "G", "C", "G", "G", "D", "G", "G"],
  },
  {
    id: "silent-night", feel: "6/8", instrument: "uke-high-g", key: "Bb", mode: "major",
    credit: "Franz Xaver Gruber · words by Joseph Mohr, English by John Freeman Young",
    description: "Four verses of the Open Hymnal's edition, in B♭, strummed in two long beats a bar up to semi-pro; pro picks a bass note on each beat, expert and maestro pick an arpeggio.",
    chartSource: "Chords read from the edition's four-part setting (Concordia Kinderchöre, 1908): B♭, E♭ and F7, F7 for the second half of bar 11. Baby and beginner play F for F7.",
    progression: ["Bb", "Bb", "F7", "Bb", "Eb", "Bb", "Eb", "Bb", "F7", "Bb", "Bb F7", "Bb"],
    simpleProgression: ["Bb", "Bb", "F", "Bb", "Eb", "Bb", "Eb", "Bb", "F", "Bb", "Bb F", "Bb"],
  },
  {
    id: "auld-lang-syne", feel: "2/4", instrument: "guitar", key: "G", mode: "major", bpm: 50,
    credit: "Traditional · words by Robert Burns",
    description: "Four verses and the chorus, in G and 2/4, at 50 BPM: the edition writes the tune in eighth notes, so this is the usual pace of the song in 4/4. Strummed up to semi-pro; pro picks a bass note under the strum, expert and maestro pick a sixteenth-note arpeggio.",
    chartSource: "Chords read from the edition's four-part setting: G, C and D, with C D (bars 7) and Em D (bar 15) closing the phrases and Bm in bar 14. Baby and beginner play C in bars 7 and 15. The edition's MIDI tempo, 90, is its collection's default for every song.",
    progression: ["G", "D", "G", "C", "G", "D", "C D", "G", "G", "D", "G", "C", "G", "D Bm", "Em D", "G"],
    simpleProgression: ["G", "D", "G", "C", "G", "D", "C", "G", "G", "D", "G", "C", "G", "D", "C", "G"],
  },
  {
    id: "red-river-valley", feel: "4/4", instrument: "guitar", key: "G", mode: "major",
    credit: "Traditional",
    description: "Two verses and the chorus, in G. Strummed up to semi-pro; pro picks a bass note under the strum, expert and maestro pick an arpeggio. The edition repeats the first eight bars for the second half of each verse: those words are its second and fourth rows.",
    chartSource: "Chords read from the edition's four-part setting: G, C and D7, with E7 and A7 leading back in bars 11–12. Baby and beginner play one chord a bar, D for D7.",
    progression: ["G", "C G", "G", "D7", "G", "C", "G D7", "G", "G", "C", "G E7", "A7 D7", "G", "C", "G D7", "G"],
    simpleProgression: ["G", "C", "G", "D", "G", "C", "D", "G", "G", "C", "G", "D", "G", "C", "D", "G"],
  },
  {
    id: "shenandoah", feel: "4/4", cut: true, instrument: "guitar", key: "D", mode: "major", runs: [3, 7, 11, 15],
    credit: "Traditional",
    description: "All four verses of the river song, in D and 2/2 (two half-note beats a bar), at 45 BPM. Strummed up to semi-pro; pro picks a bass note under the strum, expert and maestro pick an arpeggio.",
    chartSource: "Chords read from the edition's four-part setting: D, G, A and Bm, with A7 in bars 2 and 18 and F♯m and Em passing (bars 10, 14). Baby and beginner play one chord a bar.",
    progression: ["D", "D A7", "G D", "D", "G", "G D", "D", "D", "Bm", "Bm F#m", "G", "G", "D", "D Bm", "A", "A", "D", "A7 D", "D"],
    simpleProgression: ["D", "D", "G", "D", "G", "G", "D", "D", "Bm", "Bm", "G", "G", "D", "D", "A", "A", "D", "A", "D"],
  },
  {
    id: "loch-lomond", feel: "4/4", instrument: "uke-high-g", key: "F", mode: "major",
    credit: "Traditional Scottish",
    description: "Three verses and the chorus, in F. Strummed up to semi-pro; pro picks a bass note under the strum, expert and maestro pick an arpeggio.",
    chartSource: "Chords read from the edition's four-part setting, a chord a half bar: F, B♭, C7, Dm, Gm and Am, A7 before the chorus's B♭ (bar 9). Baby and beginner play one chord a bar where they can, C for C7.",
    progression: ["F", "Gm C", "F", "Bb C", "Dm Am", "Gm C7", "F Bb", "C7 F", "F A7", "Bb C7", "F Dm", "Bb F", "Dm Am", "Gm C7", "F Bb", "C7 F", "F"],
    simpleProgression: ["F", "C", "F", "Bb", "Dm", "C", "F", "C F", "F", "Bb", "F", "Bb", "Dm", "C", "F", "C F", "F"],
  },
  {
    id: "scarborough-fair", feel: "3/4", instrument: "guitar", key: "D", mode: "minor",
    credit: "Traditional English ballad",
    description: "The verse as it is usually sung today, in D Dorian, with its words. Strummed up to semi-pro; pro picks a bass note under the strum, expert and maestro pick an arpeggio.",
    chartSource: "Chords from the source's own chord line: Dm, Am, G in bar 7 and Am7. Baby and beginner play Dm in bar 7 and Am for Am7.",
    progression: ["Dm", "Dm", "Am", "Dm", "Am", "Dm", "Dm G G", "Dm", "Dm", "Am", "Dm", "Am", "Dm", "Am7", "Am7", "Dm"],
    simpleProgression: ["Dm", "Dm", "Am", "Dm", "Am", "Dm", "Dm", "Dm", "Dm", "Am", "Dm", "Am", "Dm", "Am", "Am", "Dm"],
  },
  {
    id: "happy-birthday", feel: "3/4", instrument: "uke-high-g", key: "G", mode: "major",
    credit: "Mildred J. Hill and Patty Hill",
    description: "The song in G. Strummed up to semi-pro; pro picks a bass note under the strum, expert and maestro pick an arpeggio. Bar 6, the name, strikes once and rings.",
    chartSource: "The source has no chords; these are the usual ones: G, D, C, with G7 into C and D7 into the last bar. Baby and beginner play G, D and C.",
    progression: ["G", "D", "D", "G", "G G G7", "C", "G G D7", "G"],
    simpleProgression: ["G", "D", "D", "G", "G", "C", "G", "G"],
    holds: [6],
  },
];

/** Bars (from 1, after the pickup) where the voice holds a note or rests from `from` to the bar line: no syllable starts there. */
function quietEnds(score, bar, from) {
  const [opening, after] = score.meterMap;
  const pickup = after ? (opening.numerator * 4) / opening.denominator : 0;
  const sung = score.notes.filter((n) => score.notation?.vocal?.includes(n.partId)).map((n) => [value(n.onset), value(n.onset) + value(n.duration)]);
  const end = Math.max(...sung.map(([, off]) => off));
  const bars = Math.ceil((end - pickup) / bar - 1e-9);
  return Array.from({ length: bars }, (_, b) => b + 1).filter((b) => {
    const lo = pickup + (b - 1) * bar + from, hi = pickup + b * bar;
    return !sung.some(([on]) => on > lo - 1e-9 && on < hi - 1e-9);
  });
}

for (const song of SONGS) {
  const data = JSON.parse(await readFile(new URL(`../docs/assets/scores/${song.id}.scorify.json`, import.meta.url), "utf8"));
  const score = { ...normalizeScore(data), notation: data.notation };
  const feel = FEELS[song.feel], last = song.progression.length;
  const holds = [...(song.holds ?? []), last];
  // Runs go where the voice holds or rests; where it holds through most bars, only the phrase ends listed in `runs`.
  const fills = quietEnds(score, feel.bar, feel.fill.from).filter((b) => b < last && !holds.includes(b) && (!song.runs || song.runs.includes(b)));
  const release = (level, at) => {
    const left = feel.bar - at.at(-1), shortest = value(compilePlayer({ level }).minDuration);
    return left / 2 >= shortest ? 0.25 : Math.min(0.25, Math.max(0, left - shortest));
  };
  const arpeggio = (difficulty, at, label, extra = {}) => ({ difficulty, label, pattern: [], arpeggio: { direction: "up-down", at }, hold: pick(0, 0, -1), release: release(difficulty, at), ...extra });
  const unit = feel.bar === 2 ? "sixteenths" : "eighths";
  const versions = [
    // In 2/2 a beat is a half note: the 4/4 strums count quarters.
    ...feel.strums.filter((v) => ["baby", "beginner", "amateur", "semi-pro"].includes(v.difficulty)).map((v) => ({ ...v, label: song.cut ? v.label.replace("every beat", "every quarter") : v.label, ...(v.difficulty === "baby" || v.difficulty === "beginner" ? { simple: true } : {}) })),
    { difficulty: "pro", ...feel.pro },
    arpeggio("expert", feel.expert, `Arpeggio up and down in ${unit}`),
    arpeggio("maestro", feel.maestro, fills.length
      ? `Arpeggio${feel.maestro === feel.expert ? "" : " with sixteenth pushes"}, runs where the voice holds (bar${fills.length > 1 ? "s" : ""} ${fills.join(", ")})`
      : `Arpeggio${feel.maestro === feel.expert ? "" : " with sixteenth pushes"}`,
      fills.length ? { fill: { ...feel.fill, bars: fills } } : {}),
  ];
  const chart = {
    schema: CHART_SCHEMA, id: song.id, title: score.notation?.title, credit: song.credit, instrument: song.instrument,
    key: song.key, mode: song.mode, ...(song.bpm ? { bpm: song.bpm } : {}), lyricLanguages: ["en"],
    description: song.description, chartSource: song.chartSource,
    progression: song.progression, simpleProgression: song.simpleProgression, holds, versions,
  };
  await writeFile(new URL(`../docs/assets/scores/${song.id}.chart.json`, import.meta.url), `${JSON.stringify(chart, null, 1)}\n`);
  console.log(`${song.id}: ${last} bars, ${versions.length} versions, runs in ${fills.length ? fills.join(", ") : "no bars"}`);
}
