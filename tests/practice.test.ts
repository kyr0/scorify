import { describe, it, expect } from "vitest";
import { arrange } from "../src/arrange.js";
import { pitchString } from "../src/model.js";
import { pitchToMidi } from "../src/pitch.js";
import { levels } from "../src/profiles.js";
import { SCALES, TONICS, scaleById, scalePitches } from "../src/theory.js";
import { numberQ as value, numberQ } from "../src/time.js";
import { validateFrettedArrangement } from "../src/validate.js";
import {
  ARPEGGIO_SEARCH,
  ARPEGGIO_TIMES,
  arpeggioVersions,
  BILLBOARD_SONGS,
  INVERSION_NAMES,
  cacheKey,
  chordInversion,
  prepare,
  scaleChordsSong,
  scaleTriads,
  segmentKey,
  voiceChord,
  PROGRESSIONS,
  PROGRESSION_VERSIONS,
  SEARCH,
  STRUM_PATTERNS,
  strumPattern,
  arrangeFor,
  chordOfNumeral,
  down,
  instrumentFor,
  keyName,
  progressionSong,
  scaleOnNeck,
  scalePiece,
  scaleRhythms,
  scaleScore,
  transposeSong,
} from "../src/songs.js";

const search = (source: Parameters<typeof arrange>[0], options: Parameters<typeof arrange>[1]) => arrange(source, options);

describe("scales", () => {
  it("spells every degree with its own letter, up and down", () => {
    expect(scalePitches("F#3", "major")).toEqual(["F#3", "G#3", "A#3", "B3", "C#4", "D#4", "E#4", "F#4", "E#4", "D#4", "C#4", "B3", "A#3", "G#3", "F#3"]);
    expect(scalePitches("A3", "blues", { direction: "up" })).toEqual(["A3", "C4", "D4", "Eb4", "E4", "G4", "A4"]);
    // The classical melodic minor rises with a major sixth and seventh and falls as the natural minor.
    expect(scalePitches("A3", "melodic-minor")).toEqual(["A3", "B3", "C4", "D4", "E4", "F#4", "G#4", "A4", "G4", "F4", "E4", "D4", "C4", "B3", "A3"]);
    // Chromatic: sharps up, flats down.
    const chromatic = scalePitches("C4", "chromatic");
    expect(chromatic.slice(0, 4)).toEqual(["C4", "C#4", "D4", "D#4"]);
    expect(chromatic.slice(-4)).toEqual(["Eb4", "D4", "Db4", "C4"]);
    expect(scalePitches("C4", "major-pentatonic", { octaves: 2 })).toHaveLength(21);
    expect(() => scaleById("bebop")).toThrow(RangeError);
    expect(() => scalePitches("C4", "major", { octaves: 0 })).toThrow(RangeError);
  });

  it("offers twelve tonics per quality and rises by step in every scale", () => {
    for (const tonics of Object.values(TONICS)) expect(new Set(tonics.map((t) => pitchToMidi(`${t}4`) % 12)).size).toBe(12);
    for (const scale of SCALES) {
      const up = scalePitches("D4", scale, { direction: "up" }).map(pitchToMidi);
      expect(up.every((m, k) => !k || (m > up[k - 1]! && m - up[k - 1]! <= 3)), scale.id).toBe(true);
      expect(up.at(-1)! - up[0]!).toBe(12);
    }
  });

  it("starts at the lowest tonic the neck holds, up to its highest fret, and never moves notes to fit", () => {
    const exercise = { scale: "major", tonic: "C", octaves: 1, perBeat: 2, time: [4, 4] } as const;
    expect(scaleOnNeck(exercise, instrumentFor("uke-high-g"))?.[0]).toBe("C4");
    expect(scaleOnNeck(exercise, instrumentFor("guitar"))?.[0]).toBe("C3");
    // Two octaves of F major need F6: an 18-fret high-G ukulele ends at D#6, a 20-fret one reaches F6.
    const two = { ...exercise, tonic: "F", octaves: 2 };
    expect(scaleOnNeck(two, instrumentFor("uke-high-g"))).toBeNull();
    expect(() => scaleScore(two, instrumentFor("uke-high-g"))).toThrow(/do not fit/);
    expect(scaleOnNeck(two, instrumentFor("uke-high-g~frets20"))?.at(7)).toBe("F5");
  });

  it("writes even notes per beat in exact time, the last held to the bar line", () => {
    const guitar = instrumentFor("guitar");
    const eighths = scaleScore({ scale: "major", tonic: "C", octaves: 1, perBeat: 2, time: [4, 4] }, guitar);
    expect(eighths.notes.map((n) => pitchString(n.pitch))).toEqual(scalePitches("C3", "major"));
    expect(eighths.notes.slice(0, -1).every((n, k) => value(n.onset) === k / 2 && value(n.duration) === 0.5)).toBe(true);
    // Fifteen notes: the last starts on beat 8 and lasts a beat.
    expect([value(eighths.notes.at(-1)!.onset), value(eighths.notes.at(-1)!.duration)]).toEqual([7, 1]);
    expect(eighths.tempoMap[0]!.quarterBpm).toBe(60);
    expect(eighths.keyMap[0]).toMatchObject({ tonic: "C", mode: "major" });
    // Triplets in 3/4: the last note sounds to the end of its bar.
    const triplets = scaleScore({ scale: "dorian", tonic: "D", octaves: 1, perBeat: 3, time: [3, 4] }, guitar);
    expect(triplets.notes[1]!.onset).toEqual(triplets.notes[1]!.duration);
    expect(value(triplets.notes[1]!.duration)).toBeCloseTo(1 / 3, 12);
    const end = value(triplets.notes.at(-1)!.onset) + value(triplets.notes.at(-1)!.duration);
    expect(end % 3).toBe(0);
    // 6/8 counts dotted quarters: three eighths a beat, 60 beats a minute.
    const compound = scaleScore({ scale: "minor-pentatonic", tonic: "A", octaves: 2, perBeat: 3, time: [6, 8] }, guitar);
    expect(value(compound.notes[0]!.duration)).toBe(0.5);
    expect(compound.tempoMap[0]!.quarterBpm).toBe(90);
    expect(scaleRhythms([6, 8]).map((r) => r.perBeat)).toEqual([1, 3, 6]);
    expect(() => scaleScore({ scale: "major", tonic: "C", octaves: 1, perBeat: 2, time: [6, 8] }, guitar)).toThrow(RangeError);
  });

  it("fingers a scale as written, or reports it: never simplified", async () => {
    const guitar = instrumentFor("guitar"),
      exercise = { scale: "major", tonic: "G", octaves: 2, perBeat: 2, time: [4, 4] } as const;
    const piece = scalePiece(exercise, guitar, { instrumentId: "guitar" });
    expect(piece.exercise).toBe(true);
    const run = await arrangeFor(piece, { instrumentId: "guitar", level: "beginner", bpm: 90, custom: null }, { arrange: search });
    expect(run.status).toBe("success");
    expect(run.prepared?.options.mode).toBe("exact");
    expect(run.result!.score.notes.map((n) => pitchString(n.pitch))).toEqual(scalePitches("G2", "major", { octaves: 2 }));
    expect(validateFrettedArrangement(run.result!.score, run.prepared!.options.instrument, run.result!.annotations, run.prepared!.options.player).valid).toBe(true);
    // Baby plays nothing shorter than a quarter: the eighths are reported, not thinned.
    const baby = await arrangeFor(piece, { instrumentId: "guitar", level: "baby", bpm: 60, custom: null }, { arrange: search });
    expect(baby.status).not.toBe("success");
    expect(baby.log.every((e) => !e.simplify)).toBe(true);
    const quarters = scalePiece({ ...exercise, perBeat: 1 }, guitar, { instrumentId: "guitar" });
    expect((await arrangeFor(quarters, { instrumentId: "guitar", level: "baby", bpm: 60, custom: null }, { arrange: search })).status).toBe("success");
  });
});

describe("chord progressions", () => {
  it("reads roman numerals in a key", () => {
    expect(["I", "ii", "iii", "IV", "V", "vi", "bVII", "bIII", "bVI", "V7"].map((n) => chordOfNumeral(n, "C"))).toEqual(["C", "Dm", "Em", "F", "G", "Am", "Bb", "Eb", "Ab", "G7"]);
    expect(["i", "bVI", "bVII", "V"].map((n) => chordOfNumeral(n, "A"))).toEqual(["Am", "F", "G", "E"]);
    expect(() => chordOfNumeral("VIII", "C")).toThrow(RangeError);
  });

  it("ranks the progressions by the Billboard songs that start a phrase with them", () => {
    expect(BILLBOARD_SONGS).toBe(739);
    expect(PROGRESSIONS.map((p) => p.songs)).toEqual([...PROGRESSIONS.map((p) => p.songs)].sort((a, b) => b - a));
    expect(PROGRESSIONS[0]).toMatchObject({ name: "I–IV–V–I", songs: 42 });
    expect(Object.keys(PROGRESSION_VERSIONS)).toEqual(["4/4", "3/4", "6/8", "12/8"]);
    for (const versions of Object.values(PROGRESSION_VERSIONS)) expect(versions.map((v) => v.difficulty)).toEqual([...levels]);
    // The strum style strums at every difficulty, the hardest included: no picked bass, fill or arpeggio.
    for (const [meter, versions] of Object.entries(PROGRESSION_VERSIONS))
      for (const v of versions) {
        expect([meter, v.difficulty, v.bass, v.fill, v.arpeggio]).toEqual([meter, v.difficulty, undefined, undefined, undefined]);
        expect(v.pattern.filter((hit) => !hit.stroke)).toEqual([]);
      }
  });

  it("plays a loop twice and the blues once, then the tonic, in any key", () => {
    const loop = progressionSong(PROGRESSIONS[1]!, [3, 4]);
    expect([...loop.progression, loop.ending]).toEqual(["C", "Am", "F", "G", "C", "Am", "F", "G", "C"]);
    expect(loop).toMatchObject({ key: "C", mode: "major", time: [3, 4], beat: 1 });
    const blues = progressionSong(PROGRESSIONS.find((p) => p.id === "12-bar-blues")!, [12, 8]);
    expect(blues.progression).toHaveLength(12);
    expect(blues.beat).toBe(1.5);
    const minor = progressionSong(PROGRESSIONS.find((p) => p.mode === "minor")!, [6, 8]);
    expect(minor.progression.slice(0, 4)).toEqual(["Am", "F", "G", "Am"]);
    expect(keyName(minor, 3)).toBe("C minor");
    expect(transposeSong(loop, -1).progression.slice(0, 4)).toEqual(["B", "G#m", "E", "F#"]);
    expect(() => progressionSong(PROGRESSIONS[0]!, [5, 4])).toThrow(RangeError);
  });
});

/** Places on a bar's grid (eighths, or the sixteenths or triplet eighths it uses) and the places struck. */
function density(time: readonly [number, number], at: readonly number[]) {
  const bar = (time[0] * 4) / time[1],
    on = (step: number) => at.every((t) => Math.abs(t / step - Math.round(t / step)) < 1e-9),
    step = on(0.5) ? 0.5 : on(1 / 3) ? 1 / 3 : on(0.25) ? 0.25 : 0;
  return { step, places: Math.round(bar / step), struck: new Set(at.map((t) => Math.round(t / step))).size };
}

describe("strumming", () => {
  it("never strikes every place of the bar: at most three quarters of its grid", () => {
    const bars = [
      ...Object.entries(PROGRESSION_VERSIONS).flatMap(([meter, versions]) => versions.map((v) => [`${meter} ${v.difficulty}`, meter.split("/").map(Number), v] as const)),
      ...STRUM_PATTERNS.map((p) => [p.id, p.time, p] as const),
    ];
    for (const [name, time, v] of bars) {
      const { step, places, struck } = density(time as [number, number], [...v.pattern.map((h) => h.at), ...(v.bass ?? []).map((h) => h.at)]);
      expect([name, step > 0, struck <= Math.ceil((places * 3) / 4)]).toEqual([name, true, true]);
    }
  });

  it("writes every pattern as it plays: D, U and B on their slots", () => {
    expect(STRUM_PATTERNS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(STRUM_PATTERNS.map((p) => p.id)).size).toBe(STRUM_PATTERNS.length);
    for (const p of STRUM_PATTERNS) {
      const slots = p.strokes.replace(/\(.*\)/, "").replace(/\s+/g, ""),
        step = ((p.time[0] * 4) / p.time[1]) / slots.length,
        hits = new Map([...p.pattern.map((h) => [h.at, h.stroke === "down" ? "D" : "U"] as const), ...(p.bass ?? []).map((h) => [h.at, "B"] as const)]);
      expect([p.id, [...slots].map((c, k) => (c === "·" ? null : c))]).toEqual([p.id, [...slots].map((_, k) => [...hits].find(([at]) => Math.abs(at - k * step) < 1e-9)?.[1] ?? null)]);
      expect(p.pattern.every((h) => h.stroke)).toBe(true);
    }
  });

  it("plays a progression in a strumming pattern, short strums short, at the pattern's tempo", async () => {
    const reggae = progressionSong(PROGRESSIONS[0]!, [4, 4], { instrument: "guitar", pattern: "reggae" });
    expect([reggae.id, reggae.bpm, reggae.versions.map((v) => [v.difficulty, v.label])]).toEqual(["progression-I-IV-V-I-4-4-reggae", 76, [["beginner", "Reggae skank: · · D · · · D ·"]]]);
    const prepared = prepare(reggae, { instrumentId: "guitar", level: "beginner", bpm: 76, custom: null, version: reggae.versions[0]! });
    const bar1 = prepared.source!.notes.filter((n) => numberQ(n.onset) < 4);
    expect([...new Set(bar1.map((n) => numberQ(n.onset)))]).toEqual([1, 3]);
    expect(new Set(bar1.map((n) => numberQ(n.duration)))).toEqual(new Set([0.5]));
    // Every difficulty from the pattern's own plays it as written; an easier one plays it simplified, and says so.
    const island = progressionSong(PROGRESSIONS[0]!, [4, 4], { instrument: "uke-high-g", pattern: "island" });
    const asWritten = await arrangeFor(island, { instrumentId: "uke-high-g", level: "maestro", bpm: island.bpm, custom: null }, { arrange: search });
    expect([asWritten.status, asWritten.simplify, asWritten.version?.label]).toEqual(["success", false, "Island strum: D · D U · U D U"]);
    const easier = await arrangeFor(island, { instrumentId: "uke-high-g", level: "baby", bpm: island.bpm, custom: null }, { arrange: search });
    expect([easier.status, easier.simplify]).toEqual(["success", true]);
    expect(() => progressionSong(PROGRESSIONS[0]!, [3, 4], { pattern: "island" })).toThrow(/4\/4 strumming pattern/);
    expect(() => progressionSong(PROGRESSIONS[0]!, [4, 4], { pattern: "island", style: "arpeggio-up" })).toThrow(RangeError);
    expect(() => strumPattern("nope")).toThrow(/Unknown strumming pattern/);
  });
});

describe("inversions, arpeggios and scale chords", () => {
  it("voices a chord with the asked chord tone in the bass", () => {
    const first = voiceChord("C", "guitar", { level: "amateur", rightHand: "strum", inversion: 1 })!;
    expect(first.pitches[0]).toBe("E2");
    expect([chordInversion("C", first.pitches), first.inversion]).toEqual([1, 1]);
    expect(chordInversion("C", voiceChord("C", "uke-high-g", { level: "amateur", rightHand: "strum", inversion: 2 })!.pitches)).toBe(2);
    expect(chordInversion("C", ["G4", "C4", "E4", "C5"])).toBe(0);
    expect(() => voiceChord("C", "guitar", { level: "amateur", rightHand: "strum", inversion: 3 })).toThrow(RangeError);
    expect(INVERSION_NAMES[1]).toBe("first inversion");
  });

  it("inverts one chord of a song as asked, bass line included, and keys the cache by it", async () => {
    // A version with an alternating bass: the bass follows an inverted chord.
    const maestro = { id: "maestro", difficulty: "maestro" as const, label: "Alternating bass", bass: [{ at: 0, tone: "root" as const }, { at: 2, tone: "fifth" as const }], pattern: [down(1, [-3, -2, -1]), down(3, [-3, -2, -1])] },
      song = { ...progressionSong(PROGRESSIONS[0]!, [4, 4]), versions: [maestro] },
      request = { instrumentId: "guitar", level: "maestro" as const, bpm: 90, custom: null },
      key = segmentKey(0, 0, "C");
    expect(key).toBe("1.1:C");
    const plain = prepare(song, { ...request, version: maestro }),
      inverted = prepare(song, { ...request, version: maestro, inversions: { [key]: 1 } });
    if (plain.missing !== undefined || inverted.missing !== undefined) throw new Error("no voicing");
    expect(plain.chords![0]).toMatchObject({ key, symbol: "C", inversion: 0, asked: false, tones: 3 });
    expect(inverted.chords![0]).toMatchObject({ key, inversion: 1, asked: true });
    // Bar 1 only: the alternating bass starts on the chord's third, E, and bar 5's C is as before.
    const lowest = (score: typeof plain.source, from: number, to: number) =>
      score.notes.filter((n) => numberQ(n.onset) >= from && numberQ(n.onset) < to).map((n) => pitchToMidi(pitchString(n.pitch))).sort((a, b) => a - b)[0];
    expect(lowest(inverted.source, 0, 1)! % 12).toBe(4);
    expect(lowest(inverted.source, 16, 17)).toBe(lowest(plain.source, 16, 17));
    expect(inverted.notes.at(-1)).toBe("inverted as asked: C in bar 1 in first inversion");
    // Keys name the chords as played: moved up a tone, bar 1 is D, and a key for C is reported, not dropped silently.
    const moved = prepare(song, { ...request, version: maestro, transpose: 2, inversions: { [key]: 1 } });
    expect([moved.chords?.[0]?.key, moved.chords?.[0]?.asked, moved.notes.at(-1)]).toEqual(["1.1:D", false, "no chord to invert at 1.1:C"]);
    expect(cacheKey(song, { ...request, inversions: { [key]: 1 } })).not.toBe(cacheKey(song, request));
    expect(cacheKey(song, { ...request, inversions: {} })).toBe(cacheKey(song, request));
    const run = await arrangeFor(song, { ...request, inversions: { [key]: 1 } }, { arrange: search });
    expect(run.status).toBe("success");
    expect(validateFrettedArrangement(run.result!.score, run.prepared!.options.instrument, run.result!.annotations, run.prepared!.options.player).valid).toBe(true);
  });

  it("walks the voicing's strings up, down or there and back, a pick at a time, in exact time", () => {
    const strings = (style: "arpeggio-up" | "arpeggio-down" | "arpeggio-up-down") => {
      const song = progressionSong(PROGRESSIONS[0]!, [4, 4], { style }),
        prepared = prepare(song, { instrumentId: "uke-high-g", level: "pro", bpm: song.bpm, custom: null, version: song.versions.find((v) => v.difficulty === "pro")! });
      if (prepared.missing !== undefined) throw new Error(prepared.missing);
      // Bar 1 of C (G4 C4 E4 C5 on the four strings, bass edge first).
      return prepared.source.notes.filter((n) => numberQ(n.onset) < 4).map((n) => pitchString(n.pitch));
    };
    expect(strings("arpeggio-up")).toEqual(["G4", "C4", "E4", "C5", "G4", "C4", "E4", "C5"]);
    expect(strings("arpeggio-down")).toEqual(["C5", "E4", "C4", "G4", "C5", "E4", "C4", "G4"]);
    expect(strings("arpeggio-up-down")).toEqual(["G4", "C4", "E4", "C5", "E4", "C4", "G4", "C4"]);
    // Expert's triplets are exact thirds of a quarter.
    const triplets = progressionSong(PROGRESSIONS[0]!, [4, 4], { style: "arpeggio-up" }),
      expert = prepare(triplets, { instrumentId: "guitar", level: "expert", bpm: 90, custom: null, version: triplets.versions.find((v) => v.difficulty === "expert")! });
    if (expert.missing !== undefined) throw new Error(expert.missing);
    expect(expert.source.notes[1]!.onset).toEqual([1, 3]);
    expect(ARPEGGIO_TIMES["4/4"]!.baby).toEqual([0, 2]);
  });

  it("plays a barre chord as an arpeggio: the barre is laid down around the bass note", async () => {
    const song = progressionSong(PROGRESSIONS[0]!, [4, 4], { style: "arpeggio-up" });
    const run = await arrangeFor(song, { instrumentId: "guitar", level: "pro", bpm: song.bpm, custom: null }, { arrange: search });
    expect([run.status, run.version?.difficulty]).toEqual(["success", "pro"]);
  });

  it("lets an arpeggio's last tone in a bar keep the level's shortest note", async () => {
    // 6/8 at baby picks on 1 and 4; letting go a quarter early left the second tone a dotted eighth.
    expect(arpeggioVersions([6, 8], "up").map((v) => v.release)).toEqual([0.5, 1, 0.5, 0.5, 0.5, 0.25, 0.25]);
    const song = progressionSong(PROGRESSIONS[0]!, [6, 8], { style: "arpeggio-up" });
    const run = await arrangeFor(song, { instrumentId: "guitar", level: "baby", bpm: song.bpm, custom: null }, { arrange: search });
    expect([run.status, run.version?.difficulty, run.simplify]).toEqual(["success", "baby", false]);
  });

  it("searches an arpeggio wide enough to keep an inverted chord's hand together", async () => {
    // Root-position F on the ukulele is voiced 2553. Searched at the songs' usual width (32), its notes, picked one at
    // a time, went on 0, 1, 9 and 5 (an eight-fret span, legal at maestro); arpeggio versions start at 512.
    const song = progressionSong(PROGRESSIONS[0]!, [4, 4], { instrument: "uke-high-g", style: "arpeggio-up" });
    const request = { instrumentId: "uke-high-g", level: "maestro" as const, bpm: song.bpm, inversions: { [segmentKey(1, 0, "F")]: 0 }, custom: null };
    expect(voiceChord("F", "uke-high-g", { level: "maestro", rightHand: "pick", inversion: 0 })?.frets).toEqual([2, 5, 5, 3]);
    const prepared = prepare(song, { ...request, version: song.versions.at(-1)! });
    expect(prepared.options?.search).toEqual(ARPEGGIO_SEARCH);
    const narrow = search(prepared.source!, { ...prepared.options!, search: SEARCH });
    const bar = (r: typeof narrow) => r.annotations.filter((f) => value(f.at) >= 4 && value(f.at) < 8);
    expect(Math.max(...bar(narrow).map((f) => f.spanFrets))).toBe(8);
    const run = await arrangeFor(song, request, { arrange: search });
    expect(run.status).toBe("success");
    expect(Math.max(...bar(run.result!).map((f) => f.spanFrets))).toBeLessThanOrEqual(3);
    expect(run.result!.cost.total).toBeLessThan(narrow.cost.total);
    // Songs keep their first tier: only arpeggio versions start wide.
    expect(prepare(progressionSong(PROGRESSIONS[0]!, [4, 4]), { ...request, version: PROGRESSION_VERSIONS["4/4"]!.at(-1)! }).options?.search).toEqual(SEARCH);
  });

  it("plays a scale in either direction, and a seven-note scale as its chords", () => {
    expect(scalePitches("C4", "major", { direction: "down" })).toEqual(["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"]);
    expect(scalePitches("C4", "major-pentatonic", { direction: "down-up" })).toEqual(["C5", "A4", "G4", "E4", "D4", "C4", "D4", "E4", "G4", "A4", "C5"]);
    const down = scalePiece({ scale: "major", tonic: "C", octaves: 1, perBeat: 2, time: [4, 4], direction: "down" }, instrumentFor("guitar"), { instrumentId: "guitar" });
    expect([down.versions[0]!.label, down.score.notes[0] && pitchString(down.score.notes[0].pitch)]).toEqual(["One octave down in eighths", "C4"]);
    expect(scaleTriads("C", "major")).toEqual(["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
    expect(scaleTriads("A", "harmonic-minor")).toEqual(["Am", "Bdim", "Caug", "Dm", "E", "F", "G#dim"]);
    expect(scaleTriads("G#", "melodic-minor")?.[6]).toBe("Gdim");
    expect(scaleTriads("A", "blues")).toBeNull();
    const chords = scaleChordsSong({ scale: "major", tonic: "D", time: [3, 4] }, { style: "arpeggio-up-down" });
    expect([...chords.progression, chords.ending]).toEqual(["D", "Em", "F#m", "G", "A", "Bm", "C#dim", "D", "C#dim", "Bm", "A", "G", "F#m", "Em", "D"]);
    expect(chords.versions.every((v) => v.arpeggio?.direction === "up-down")).toBe(true);
    expect(() => scaleChordsSong({ scale: "blues", tonic: "A", time: [4, 4] })).toThrow(RangeError);
  });
});
