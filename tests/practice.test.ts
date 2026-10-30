import { describe, it, expect } from "vitest";
import { arrange } from "../src/arrange.js";
import { pitchString } from "../src/model.js";
import { pitchToMidi } from "../src/pitch.js";
import { levels } from "../src/profiles.js";
import { SCALES, TONICS, scaleById, scalePitches } from "../src/theory.js";
import { numberQ as value } from "../src/time.js";
import { validateFrettedArrangement } from "../src/validate.js";
import {
  BILLBOARD_SONGS,
  PROGRESSIONS,
  PROGRESSION_VERSIONS,
  arrangeFor,
  chordOfNumeral,
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
