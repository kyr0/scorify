import { describe, it, expect } from "vitest";
import { arrange } from "../src/arrange.js";
import { createScore, parsePitch } from "../src/model.js";
import { q } from "../src/time.js";
import { validateFrettedArrangement } from "../src/validate.js";
import {
  down,
  up,
  pick,
  ALL,
  arrangeFor,
  cacheKey,
  cacheable,
  chordTones,
  customInstrumentId,
  hardestNotes,
  highestFret,
  instrumentFor,
  limitsExceeded,
  pieceFromScore,
  prepare,
  retime,
  searched,
  strokesFor,
  suggestCapo,
  tempoFor,
  voiceChord,
  voicingsFor,
  type ArrangeRequest,
  type ChordSong,
  type SuccessfulRun,
} from "../src/songs.js";

// A small song in B minor with three versions: a strum a bar, a down strum on every beat, and an alternating bass
// under treble strums. Bm is a barre or a partial shape on guitar; a capo on 2 makes it an Am shape. The maestro
// version is proved infeasible within the model on guitar at 90 BPM, so it shows the fallback.
const song: ChordSong = {
  id: "fixture",
  title: "Fixture",
  instrument: "guitar",
  key: "B",
  mode: "minor",
  time: [4, 4],
  beat: 1,
  bpm: 90,
  progression: ["Bm", "A", "E", "Bm"],
  versions: [
    { id: "baby", difficulty: "baby", label: "A strum a bar", pattern: [down(0)], release: 1, countStrokes: true },
    { id: "amateur", difficulty: "amateur", label: "Down strums", pattern: [down(0), down(1), down(2), down(3)], release: 0.5, countStrokes: true },
    {
      id: "maestro",
      difficulty: "maestro",
      label: "Bass and strums",
      pattern: [up(1, [-3, -2, -1]), down(2, [-3, -2, -1]), up(3, [-3, -2, -1])],
      bass: [{ at: 0, tone: "root" }, { at: 2, tone: "fifth" }],
    },
  ],
};
const search = (source: Parameters<typeof arrange>[0], options: Parameters<typeof arrange>[1]) => arrange(source, options);
const request = (level: ArrangeRequest["level"], extra: Partial<ArrangeRequest> = {}): ArrangeRequest => ({ instrumentId: "guitar", level, bpm: 90, capo: 0, custom: null, ...extra });

describe("songs: versions per difficulty", () => {
  it("voices chords like a chord book and spells them in the chord", () => {
    expect(chordTones("F#m7").names).toEqual(["F#", "A", "C#", "E"]);
    expect(voiceChord("D", "guitar", { level: "beginner", rightHand: "strum" })).toMatchObject({ frets: ["x", "x", 0, 2, 3, 2] });
    expect(voiceChord("D7", "uke-high-g", { level: "beginner", rightHand: "strum" })?.frets).toEqual([2, 2, 2, 3]);
    expect(() => chordTones("H7")).toThrow(RangeError);
    expect(instrumentFor("guitar~capo2").strings.every((s) => s.capoFret === 2)).toBe(true);
  });

  it("plays the version written for the difficulty as written, every note kept", async () => {
    for (const level of ["baby", "amateur"] as const) {
      const run = await arrangeFor(song, request(level), { arrange: search });
      expect(run.log.map((e) => [e.version, e.status])).toEqual([[level, "success"]]);
      expect(run.prepared?.options.mode).toBe("exact");
      expect(run.result?.score.notes.length).toBe(run.prepared?.total);
    }
    // A version proved impossible gives way to the next easier one, and the log says why.
    const maestro = await arrangeFor(song, request("maestro"), { arrange: search });
    expect(maestro.log.map((e) => [e.version, e.status])).toEqual([["maestro", "infeasible"], ["amateur", "success"]]);
    // A difficulty between versions plays the nearest easier one.
    expect((await arrangeFor(song, request("pro"), { arrange: search })).version?.id).toBe("amateur");
    expect(tempoFor(song, "maestro")).toBe(108);
    expect(hardestNotes(song, request("baby"))).toBe((prepare(song, { ...request("maestro"), version: song.versions[2]! }) as { total: number }).total);
  });

  it("falls back to an easier version when the source exceeds the difficulty at this tempo, and says why", async () => {
    // Amateur allows 8 attacks a second; down strums on six strings at 200 BPM are 20 string attacks a second, but
    // the amateur version counts strokes (3.3 a second), so the maestro version on beginner falls back.
    const fast = await arrangeFor(song, request("beginner", { bpm: 200 }), { arrange: search });
    expect(fast.log.map((e) => [e.version, e.status])).toEqual([["baby", "success"]]);
    const spec = prepare(song, { ...request("baby", { bpm: 400 }), version: song.versions[1]! });
    if (spec.missing !== undefined) throw new Error(spec.missing);
    expect(limitsExceeded(spec.spec as ChordSong & { beat: number; bpm: number; countStrokes?: boolean }, spec.source, { bpm: 400, level: "baby" })[0]).toMatch(/strokes in one second; this difficulty allows/);
    expect(spec.notes.some((n) => n.startsWith("a strum counts once"))).toBe(true);
  });

  it("replays a log only for equal inputs and build, after validating it", async () => {
    const first = await arrangeFor(song, request("amateur"), { arrange: search, build: "a" });
    const log = cacheable(first.log),
      never = () => {
        throw new Error("searched");
      };
    const again = await arrangeFor(song, request("amateur"), { arrange: never, replay: log, build: "a" });
    expect(searched(again.log)).toBe(false);
    expect(again.result?.annotations).toEqual(first.result?.annotations);
    await expect(arrangeFor(song, request("amateur"), { arrange: never, replay: log, build: "b" })).rejects.toThrow("searched");
  });

  it("suggests capo 2 for B minor on guitar; the capo moves the fingering, not the sounding pitch", async () => {
    expect(suggestCapo(song, request("baby"))).toEqual({ capo: 2, shapes: ["Am", "G", "D"], chords: ["Bm", "A", "E"], hard: [1, 0] });
    const run = await arrangeFor(song, request("amateur", { capo: 2 }), { arrange: search });
    expect(run.status).toBe("success");
    // Bm, A and E are held as Am, G and D shapes behind the capo: open strings, nothing above the second fret.
    for (const { frets } of voicingsFor(run.result!, run.prepared!.options.instrument)) {
      expect(frets.some((f) => f === 0)).toBe(true);
      expect(frets.every((f) => f === "x" || f <= 3)).toBe(true);
    }
    expect(run.result!.annotations.flatMap((a) => a.assignments).every((p) => p.absoluteFret === p.relativeFret + 2)).toBe(true);
  });

  it("takes the instrument's highest fret as a hard limit, its own by default", async () => {
    expect(["uke-high-g", "uke-low-g", "uke-baritone", "guitar", "mandolin"].map(highestFret)).toEqual([18, 18, 18, 19, 20]);
    expect(customInstrumentId("guitar", { frets: 19 })).toBe("guitar");
    expect(customInstrumentId("guitar", { capo: 2, frets: 7 })).toBe("guitar~capo2~frets7");
    expect(instrumentFor("guitar~capo2~frets7").strings.every((s) => s.fretCount === 7 && s.capoFret === 2)).toBe(true);
    expect(() => customInstrumentId("guitar", { frets: 0 })).toThrow(RangeError);
    // The instrument's own highest fret is the default request, with the same cache key.
    expect(cacheKey(song, request("amateur", { frets: 19 }))).toBe(cacheKey(song, request("amateur")));
    expect(cacheKey(song, request("amateur", { frets: 5 }))).not.toBe(cacheKey(song, request("amateur")));
    const low = await arrangeFor(song, request("amateur", { frets: 5 }), { arrange: search });
    expect(low.status).toBe("success");
    expect(low.prepared!.options.instrument.strings.every((s) => s.fretCount === 5)).toBe(true);
    expect(low.result!.annotations.flatMap((a) => a.assignments).every((p) => p.absoluteFret <= 5)).toBe(true);
    expect(validateFrettedArrangement(low.result!.score, low.prepared!.options.instrument, low.result!.annotations, low.prepared!.options.player).valid).toBe(true);
    // Under the capo's fret there is nothing to finger, and that is reported rather than played on a longer neck.
    expect(prepare(song, request("amateur", { capo: 6, frets: 5 }))).toEqual({ missing: "a capo on fret 6, above the highest fret (5)" });
  });

  it("searches once more without the low-position preference when a search runs out with it", async () => {
    // A search that runs out whenever the difficulty prefers low positions, and plays without that preference.
    const searches: unknown[] = [];
    const picky = (source: Parameters<typeof arrange>[0], options: Parameters<typeof arrange>[1]) => {
      searches.push(options.player?.overrides?.highFretCosts);
      return options.player?.overrides?.highFretCosts ? arrange(source, options) : ({ status: "search-exhausted", diagnostics: [] } as unknown as ReturnType<typeof arrange>);
    };
    const run = await arrangeFor(song, request("amateur"), { arrange: picky });
    expect(run.log.map((e) => [e.version, e.status, !!e.anyPosition])).toEqual([["amateur", "search-exhausted", false], ["amateur", "success", true]]);
    expect(searches.at(-1)).toEqual([]);
    expect(run.prepared!.notes.at(-1)).toMatch(/searched without it/);
    expect(validateFrettedArrangement(run.result!.score, run.prepared!.options.instrument, run.result!.annotations, run.prepared!.options.player).valid).toBe(true);
    // The log replays both attempts without a search; maestro has no preference to lift.
    const never = () => {
      throw new Error("searched");
    };
    const again = await arrangeFor(song, request("amateur"), { arrange: never, replay: cacheable(run.log) });
    expect(again.result?.annotations).toEqual(run.result?.annotations);
    const maestro = await arrangeFor(song, request("maestro", { bpm: 70 }), { arrange: picky });
    expect(maestro.log.some((e) => e.anyPosition)).toBe(false);
  });

  it("keeps a fingering at a slower tempo after validation, and makes strokes for the strums that sound", async () => {
    const shown = { ...(await arrangeFor(song, request("amateur"), { arrange: search })), request: request("amateur") } as SuccessfulRun & { request: ArrangeRequest };
    const slower = retime(song, shown, request("amateur", { bpm: 60 }))!;
    expect(slower.result.annotations).toEqual(shown.result.annotations);
    expect(slower.result.retimed).toEqual({ fromBpm: 90 });
    expect(validateFrettedArrangement(slower.result.score, slower.prepared.options.instrument, slower.result.annotations, slower.prepared.options.player).valid).toBe(true);
    expect(retime(song, shown, request("amateur", { bpm: 60, capo: 2 }))).toBeNull();
    const strokes = strokesFor(shown.prepared.spec, shown.result);
    // Four down strums in each of four bars; the last bar's are slower down strums.
    expect(strokes).toHaveLength(16);
    expect(strokes.at(-1)).toMatchObject({ direction: "down", spreadSeconds: 0.06 });
  });

  it("finds chord shapes for a picking hand whatever its picked-notes limit", () => {
    // Baby picks at most two notes together; a version that picks the root still holds the whole Bm or Am shape.
    for (const [symbol, instrumentId] of [["Bm", "guitar"], ["Am", "guitar"], ["Am", "uke-high-g"]] as const) {
      const shape = voiceChord(symbol, instrumentId, { level: "baby", rightHand: "pick" });
      expect(shape?.pitches.length, `${symbol} on ${instrumentId}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("estimates an imported score's difficulty and offers its voices", () => {
    const notes = ["E4", "C4", "A3", "D3"].flatMap((pitch, voice) =>
      [0, 1, 2, 3].map((beat) => ({ id: `${voice}-${beat}`, pitch: parsePitch(pitch), onset: q(beat), duration: q(1), partId: "p", voiceId: String(voice), role: (["melody", "harmony", "harmony", "bass"] as const)[voice]! })),
    );
    const piece = pieceFromScore(createScore(notes), { id: "chorale" });
    expect(piece.versions[0]).toMatchObject({ estimated: true, difficulty: expect.any(String) });
    expect(piece.textures.map((t) => [t.key, t.notes])).toEqual([["all", 16], ["outer", 8], ["melody", 4]]);
    expect(ALL).toBe("all");
    expect(pick(1, 0, -1)).toEqual({ at: 1, tones: [0, -1] });
    // Its strummed chords count strokes, and every version lets go before the next strum, so the hand can move.
    expect(piece.chords?.progression).toHaveLength(1);
    expect(piece.chords?.versions.map((v) => [v.id, v.countStrokes, v.release])).toEqual([
      ["chords-baby", true, 1],
      ["chords-beginner", true, 0.5],
      ["chords-amateur", true, 0.25],
    ]);
  });
});
