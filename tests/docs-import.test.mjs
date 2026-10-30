import { it, expect } from "vitest";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { docsServer } from "../scripts/serve-docs.mjs";
import { tabFor, instrumentFor, songFromChart, prepare, strokesFor, limitsExceeded, CHART_SCHEMA, songs, suggestCapo, customInstrumentId,
  intervalOf, cacheKey, arrangeFor, cacheable, searched, retime, tempoFor, hardestVersion, hardestNotes, pieceFromScore, versionById } from "../docs/assets/songs.mjs";
import { arrange, compilePlayer, createScore } from "../docs/assets/scorify/index.mjs";

it("serves only listed private scores locally, excludes symlink escapes, and leaves static docs private-free", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "scorify-private-"));
  const outside = path.join(dir, "outside.json"), scores = path.join(dir, "scores");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(scores);
  await writeFile(outside, '{"outside":true}');
  await writeFile(path.join(scores, "song.scorify.json"), '{"score":true}');
  await symlink(outside, path.join(scores, "escape.scorify.json"));
  await writeFile(path.join(scores, "index.json"), JSON.stringify([
    { id: "song", file: "song.scorify.json", instrument: "guitar" },
    { id: "escape", file: "escape.scorify.json" },
    { id: "charted", file: "song.scorify.json", chart: "song.chart.json" },
  ]));
  await writeFile(path.join(scores, "song.chart.json"), '{"chart":true}');
  await writeFile(path.join(scores, "other.chart.json"), '{"chart":false}');
  await mkdir(path.join(scores, "cache"));
  await writeFile(path.join(scores, "cache", "index.json"), '{"entries":{}}');
  await writeFile(path.join(scores, "cache", "0a1b-2c.json.gz"), "gz");
  await symlink(outside, path.join(scores, "cache", "ffff.json.gz"));
  const server = docsServer({ privateScoresRoot: scores });
  const plain = docsServer({ privateScoresRoot: null });
  try {
    for (const s of [server, plain]) await new Promise((resolve, reject) => { s.once("error", reject); s.listen(0, "127.0.0.1", resolve); });
    const get = p => fetch(`http://127.0.0.1:${server.address().port}${p}`);
    expect(await (await get("/")).text()).toContain('name="scorify-local-scores"');
    const entries = await (await get("/__private-scores/index.json")).json();
    const score = await get(entries[0].url);
    expect(score.headers.get("cache-control")).toBe("no-store");
    expect(await score.json()).toEqual({ score: true });
    const charted = entries.find(e => e.id === "charted");
    expect(await (await get(charted.chartUrl)).json()).toEqual({ chart: true });
    for (const file of ["escape.scorify.json", "unlisted.scorify.json", "original.mxl", "%2e%2e%2foutside.json", "other.chart.json"]) {
      expect((await get(`/__private-scores/${file}`)).status).toBe(404);
    }
    expect(await (await get("/__private-scores/cache/index.json")).json()).toEqual({ entries: {} });
    const cached = await get("/__private-scores/cache/0a1b-2c.json.gz");
    expect([cached.headers.get("content-type"), cached.headers.get("cache-control"), await cached.text()]).toEqual(["application/gzip", "no-store", "gz"]);
    for (const file of ["cache/ffff.json.gz", "cache/%2e%2e%2findex.json", "cache/%2e%2e%2fsong.scorify.json", "cache/Z.json.gz", "cache/missing.json.gz"]) {
      expect((await get(`/__private-scores/${file}`)).status).toBe(404);
    }
    const html = await (await fetch(`http://127.0.0.1:${plain.address().port}/`)).text();
    expect(html).not.toContain('name="scorify-local-scores"');
  } finally {
    for (const s of [server, plain]) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); }
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps vocal pitch, pickup, melisma and rest timing separate from adapted accompaniment", () => {
  const score = { notes: [], rests: [{ onset: [8, 1], duration: [4, 1] }], harmony: [], keyMap: [], tempoMap: [{ quarterBpm: 80 }] };
  const piece = { id: "fixture", title: "Vocal timing", time: [4, 4], pad: 1, score: { notation: { lyricLanguages: ["fr"] } } };
  const data = tabFor(piece, { status: "success", score, annotations: [] }, instrumentFor("guitar"), {
    vocal: [[0, 0.5, "C4", ["La"]], [0.5, 0.5, "D4", [""]], [2, 1, "E4", [""]], [3, 1, "F#4", ["fin"]]],
  });
  const tracks = data.scores[0].tracks;
  expect(tracks.find(t => t.id === "verse-1").items[0]).toEqual({ measure: 1, beat: 2, beats: 1, text: "La" });
  expect(tracks.find(t => t.id === "verse-1").lang).toBe("fr");
  expect(tracks.find(t => t.id === "vocal-pitches").items).toEqual([
    { measure: 1, beat: 2, beats: 0.5, text: "C4" }, { measure: 1, beat: 2.5, beats: 0.5, text: "D4" },
    { measure: 1, beat: 4, beats: 1, text: "E4" }, { measure: 2, beat: 1, beats: 1, text: "F#4" },
  ]);
  expect(data.scores[0].measures).toBe(4);
});

// A three-bar sung score: a pickup syllable, a passage written a minor third low, then the voice alone.
const pitch = (step, octave, alter = 0) => ({ step, alter, octave });
const sungScore = () => ({
  notes: [
    { id: "v1", pitch: pitch("B", 3), onset: [3, 1], duration: [1, 1], partId: "V", voiceId: "1", role: "melody" },
    { id: "v2", pitch: pitch("C", 4, 1), onset: [4, 1], duration: [2, 1], partId: "V", voiceId: "1", role: "melody" },
    { id: "v3", pitch: pitch("F", 4), onset: [8, 1], duration: [4, 1], partId: "V", voiceId: "1", role: "melody" },
    { id: "p1", pitch: pitch("D", 3), onset: [0, 1], duration: [12, 1], partId: "P", voiceId: "1", role: "harmony" },
  ],
  rests: [], meterMap: [{ at: [0, 1], numerator: 4, denominator: 4 }],
  tempoMap: [{ at: [0, 1], quarterBpm: 100 }, { at: [8, 1], quarterBpm: 50 }],
  notation: { vocal: ["V"], lyrics: { v1: "The", v2: "world", v3: "you" }, lyricLanguages: ["en"] },
});
const DOWN = (at, tones = "all") => ({ at, tones, stroke: "down" });
const chart = (overrides = {}) => ({
  schema: CHART_SCHEMA, id: "fixture", title: "Fixture", key: "D", mode: "minor", instrument: "uke-high-g",
  progression: ["Dm C", "G", "N.C."], simpleProgression: ["Dm", "G", "N.C."], holds: [2],
  vocalTranspose: [{ bars: [1, 2], interval: "3m", reason: "bars 1-2 shown a minor third higher" }],
  versions: [
    { difficulty: "beginner", label: "Simple", simple: true, pattern: [DOWN(0), DOWN(2)] },
    { difficulty: "pro", label: "Full", pattern: [DOWN(0), DOWN(1), { at: 2.5, tones: [-2, -1], stroke: "up" }, DOWN(3)] },
  ],
  ...overrides,
});

it("plays a chord chart under an imported voice: chords by segment, holds, silent bars and a reported key correction", () => {
  const song = songFromChart(chart(), sungScore());
  expect(song.vocal.map(v => v[2])).toEqual(["D4", "E4", "F4"]);
  expect(song.vocal.map(v => v[3])).toEqual([["The"], ["world"], ["you"]]);
  expect(song.notes).toContain("bars 1-2 shown a minor third higher");
  expect(song.bpm).toBe(100);

  const full = prepare(song, { instrumentId: "uke-high-g", level: "pro", bpm: 50, version: song.versions[1] });
  expect(full.options.transform).toEqual({ tempoScale: 0.5 });
  expect(full.source.tempoMap.map(t => t.quarterBpm)).toEqual([100, 50]);
  expect(full.source.harmony.map(h => [h.selected, h.onset, h.end])).toEqual([["Dm", [0, 1], [2, 1]], ["C", [2, 1], [4, 1]], ["G", [4, 1], [8, 1]]]);
  const onsets = [...new Set(full.source.notes.map(n => n.onset[0] / n.onset[1]))];
  // Bar 1 strums its pattern across the change to C at beat 3; bar 2 holds G once; bar 3 is silent.
  expect(onsets).toEqual([0, 1, 2.5, 3, 4]);
  const dm = full.source.notes.filter(n => n.onset[0] === 1 && n.onset[1] === 1);
  // Dm rings from beat 2 until C's first strum (beat 3½), not until the bar's midpoint.
  expect(dm.every(n => n.duration[0] / n.duration[1] === 1.5)).toBe(true);
  expect(full.source.notes.filter(n => n.onset[0] === 4).every(n => n.duration[0] / n.duration[1] === 4)).toBe(true);
  expect(full.options.player.overrides.familiarShapes).toContain("2-2-1-0");

  const simple = prepare(song, { instrumentId: "uke-high-g", level: "beginner", bpm: 100, version: song.versions[0] });
  expect(simple.source.harmony.map(h => h.selected)).toEqual(["Dm", "G"]);

  const result = arrange(full.source, full.options);
  expect(result.status).toBe("success");
  expect(strokesFor(full.spec, result).map(s => [s.at[0] / s.at[1], s.direction])).toEqual([[0, "down"], [1, "down"], [2.5, "up"], [3, "down"], [4, "down"]]);
  const data = tabFor(song, result, instrumentFor("uke-high-g"), { spec: full.spec, vocal: full.vocal });
  const chords = data.scores[0].tracks.find(t => t.kind === "chords").items;
  expect(chords.map(c => [c.measure, c.beat, c.name])).toEqual([[1, 1, "Dm"], [1, 3, "C"], [2, 1, "G"], [3, 1, "N.C."]]);
  expect(data.scores[0].tracks.find(t => t.id === "vocal-pitches").items.map(i => i.text)).toEqual(["D4", "E4", "F4"]);
});

it("rejects a chart that does not fit its score", () => {
  expect(() => songFromChart({ ...chart(), schema: "other" }, sungScore())).toThrow(/chord chart/);
  expect(() => songFromChart(chart({ progression: ["Dm", "G"] }), sungScore())).toThrow(/2 bars, the score 3/);
  expect(() => songFromChart(chart({ simpleProgression: ["Dm", "Gx", "N.C."] }), sungScore())).toThrow(/Unsupported chord/);
  expect(() => songFromChart(chart(), { ...sungScore(), notation: {} })).toThrow(/sung part/);
  expect(() => songFromChart(chart({ sungLine: { parts: [{ part: "P", bars: [1, 3] }], reason: "" } }), sungScore())).toThrow(/P, which is not a sung part/);
});

it("follows a tune passed between choir parts, bar span by bar span, and labels the words' language", () => {
  const choir = sungScore();
  choir.notes.push({ id: "a1", pitch: pitch("A", 3), onset: [3, 1], duration: [1, 1], partId: "A", voiceId: "1", role: "harmony" },
    { id: "a2", pitch: pitch("G", 3), onset: [4, 1], duration: [4, 1], partId: "A", voiceId: "1", role: "harmony" });
  choir.notes.sort((a, b) => a.onset[0] - b.onset[0] || a.id.localeCompare(b.id));
  choir.notation = { vocal: ["V", "A"], lyrics: { v1: "The", v2: "world", v3: "you", a1: "Ah", a2: "lone" } };
  const all = songFromChart(chart({ vocalTranspose: [] }), choir);
  expect(all.vocal.map(v => v[2])).toEqual(["A3", "B3", "G3", "C#4", "F4"]);
  const line = songFromChart(chart({ vocalTranspose: [], lyricLanguages: ["ru"],
    sungLine: { parts: [{ part: "V", bars: [1, 1] }, { part: "A", bars: [2, 2] }, { part: "V", bars: [3, 3] }], reason: "the tune moves to A in bar 2" } }), choir);
  expect(line.vocal.map(v => [v[0], v[2], v[3][0]])).toEqual([[3, "B3", "The"], [4, "G3", "lone"], [8, "F4", "you"]]);
  expect(line.notes).toContain("the tune moves to A in bar 2");
  expect(line.notes[0]).toMatch(/sung part \(3 notes\)/);
  expect(line.lyricLanguages).toEqual(["ru"]);
  // A sung part without words is shown by its notes, and the note says the score has none.
  const wordless = songFromChart(chart({ vocalTranspose: [] }), { ...choir, notation: { vocal: ["V"] } });
  expect(wordless.notes[0]).toMatch(/sung part \(3 notes\) comes from the imported score, which has no words for it/);
});

it("counts a strum once only in versions that declare it and only strum", () => {
  const strum = [DOWN(0), DOWN(1), { at: 1.5, tones: "all", stroke: "up" }, { at: 2.5, tones: "all", stroke: "up" }, DOWN(3)];
  const song = songFromChart(chart({ versions: [
    { difficulty: "beginner", label: "Strokes", simple: true, countStrokes: true, release: 0.5, pattern: strum },
    { difficulty: "pro", label: "Strings", simple: true, pattern: strum },
  ] }), sungScore());
  const [strokes, strings] = song.versions.map(version => prepare(song, { instrumentId: "uke-high-g", level: "beginner", bpm: 100, version }));
  const rate = compilePlayer({ level: "beginner" }).maxAttacksPerSecond;
  expect(strokes.options.player.overrides.maxAttacksPerSecond).toBe(rate * 4);
  expect(strokes.notes.at(-1)).toMatch(/a strum counts once: beginner allows 4 strokes a second across up to 4 strings/);
  expect(strings.options.player.overrides.maxAttacksPerSecond).toBeUndefined();
  // At 100 BPM the pattern's densest second holds three strokes, which is twelve strings.
  expect(limitsExceeded(strokes.spec, strokes.source, { bpm: 100, level: "beginner" })).toEqual([]);
  expect(limitsExceeded(strings.spec, strings.source, { bpm: 100, level: "beginner" })[0]).toMatch(/string attacks in one second; this difficulty allows 4/);
  expect(() => songFromChart(chart({ versions: [{ difficulty: "pro", label: "Picked", countStrokes: true, pattern: [{ at: 0, tones: [0] }] }] }), sungScore()))
    .toThrow(/counts strokes but does not only strum/);
});

const pitchClass = ({ step, alter }) => ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[step] + alter;
const search = async (source, options) => arrange(source, options);

it("suggests a capo only when it leaves fewer hard shapes; a capo keeps sounding pitch and moves the fingering", async () => {
  const wicked = songs.find(s => s.id === "wicked"), rainbow = songs.find(s => s.id === "rainbow");
  // Wicked Game in B minor: Bm, A and E are fingered as Am, G and D behind the second fret.
  expect(suggestCapo(wicked, { instrumentId: "guitar", level: "beginner" })).toEqual({ capo: 2, shapes: ["Am", "G", "D"], chords: ["Bm", "A", "E"], hard: [1, 0] });
  expect(suggestCapo(rainbow, { instrumentId: "guitar", level: "beginner" })).toBeNull();
  expect(suggestCapo(rainbow, { instrumentId: "uke-high-g", level: "beginner", custom: { transpose: 3 } })).toMatchObject({ capo: 3, shapes: ["C", "Em", "Am", "F", "G"], chords: ["Eb", "Gm", "Cm", "Ab", "Bb"] });
  expect(suggestCapo(rainbow, { instrumentId: "guitar", level: "beginner", custom: { tuning: ["D2", "A2", "D3", "G3", "B3", "E4"] } })).toBeNull();

  expect(customInstrumentId("guitar", { capo: 2, tuning: ["D2", "A2", "D3", "G3", "B3", "E4"] })).toBe("guitar~capo2~tuningD2.A2.D3.G3.B3.E4");
  expect(instrumentFor("guitar~capo2").strings.map(s => [s.openPitch, s.capoFret])).toEqual(instrumentFor("guitar").strings.map(s => [s.openPitch, 2]));
  expect([3, -2, 14, -12].map(intervalOf)).toEqual(["3m", "-2M", "9M", "-8P"]);

  const request = { instrumentId: "guitar", level: "beginner", bpm: wicked.bpm, custom: null };
  const [open, capo] = await Promise.all([0, 2].map(fret => arrangeFor(wicked, { ...request, capo: fret }, { arrange: search })));
  for (const run of [open, capo]) {
    expect(run.status).toBe("success");
    const bar1 = run.result.score.notes.filter(n => n.onset[0] / n.onset[1] < 4);
    // Bm sounds either way (the open version holds a smaller part of it).
    const classes = new Set(bar1.map(n => (pitchClass(n.pitch) + 12) % 12));
    expect([...classes].every(c => [11, 2, 6].includes(c)) && classes.has(11) && classes.has(2)).toBe(true);
  }
  const fingered = capo.result.annotations.flatMap(a => a.assignments);
  expect(fingered.every(a => a.absoluteFret === a.relativeFret + 2)).toBe(true);
  expect(capo.result.annotations.find(a => a.assignments.length > 2).shape).toBe("x-0-2-2-1-x");
});

it("replays a cached arrangement only for equal inputs, and searches again when a replayed result is invalid", async () => {
  const rainbow = songs.find(s => s.id === "rainbow");
  const request = { instrumentId: "uke-high-g", level: "baby", bpm: rainbow.bpm, capo: 0, custom: null };
  expect(cacheKey({ ...rainbow, origin: { url: "x" }, cacheBase: "y/" }, request)).toBe(cacheKey(rainbow, request));
  expect(new Set([request, { ...request, capo: 2 }, { ...request, custom: { arrangement: { transpose: 2 } } }]
    .map(r => cacheKey(rainbow, r))).size).toBe(3);
  // The tempo is playback only, so it is not part of the key.
  expect(cacheKey(rainbow, { ...request, bpm: 90 })).toBe(cacheKey(rainbow, request));

  const first = await arrangeFor(rainbow, request, { arrange: search });
  expect(first.status).toBe("success");
  const log = cacheable(first.log), never = () => { throw new Error("searched"); };
  const again = await arrangeFor(rainbow, request, { arrange: never, replay: log });
  expect(again.result.score).toEqual(first.result.score);
  expect(searched(again.log)).toBe(false);
  // Another tempo replays the same log: only the result's tempo map changes.
  const faster = await arrangeFor(rainbow, { ...request, bpm: rainbow.bpm + 10 }, { arrange: never, replay: log });
  expect(faster.result.annotations).toEqual(first.result.annotations);
  expect(faster.result.score.tempoMap[0].quarterBpm).toBe(first.result.score.tempoMap[0].quarterBpm * (rainbow.bpm + 10) / rainbow.bpm);
  // A cached fingering that does not sound the written pitch fails scorify's validator and is searched again.
  const tampered = structuredClone(log), moved = tampered.at(-1).result.annotations[0].assignments[0];
  moved.absoluteFret += 1; moved.relativeFret += 1;
  let searches = 0;
  const repaired = await arrangeFor(rainbow, request, { arrange: (source, options) => { searches++; return search(source, options); }, replay: tampered });
  expect(searches).toBe(1);
  expect(repaired.result.score).toEqual(first.result.score);
  expect(searched(repaired.log)).toBe(true);
});

it("fingers every request at the piece's own tempo; another tempo only scales playback", async () => {
  const rainbow = songs.find(s => s.id === "rainbow"), never = () => { throw new Error("searched"); };
  expect([tempoFor(rainbow, "amateur"), tempoFor(rainbow, "maestro")]).toEqual([80, 96]);
  const request = { instrumentId: "uke-low-g", level: "pro", bpm: 80, capo: 0, custom: null };
  const shown = { ...(await arrangeFor(rainbow, request, { arrange: search })), request };
  expect([shown.status, shown.version.id, shown.log.length, shown.result.retimed]).toEqual(["success", "pro", 1, undefined]);

  // A request at 110 BPM is the same search: it replays the log, and only its score's tempo differs.
  const fast = await arrangeFor(rainbow, { ...request, bpm: 110 }, { arrange: never, replay: cacheable(shown.log) });
  expect(fast.result.annotations).toEqual(shown.result.annotations);
  expect([fast.result.score.tempoMap[0].quarterBpm, fast.result.retimed]).toEqual([110, { fromBpm: 80 }]);
  expect(cacheable(fast.log)).toEqual(cacheable(shown.log));
  expect(fast.result.difficulty.maxAttacksInOneSecond).toBeGreaterThan(shown.result.difficulty.maxAttacksInOneSecond);

  // retime moves the arrangement on show to any tempo, slower or faster, and back, keeping every fret.
  for (const bpm of [60, 140]) {
    const moved = retime(rainbow, shown, { ...request, bpm });
    expect(moved.result.annotations).toEqual(shown.result.annotations);
    expect(moved.result.score.notes).toEqual(shown.result.score.notes);
    expect([moved.result.score.tempoMap[0].quarterBpm, moved.result.retimed]).toEqual([bpm, { fromBpm: 80 }]);
  }
  const back = retime(rainbow, { ...retime(rainbow, shown, { ...request, bpm: 60 }), request: { ...request, bpm: 60 } }, request);
  expect([back.result.score, back.result.retimed]).toEqual([shown.result.score, undefined]);
  // Only the tempo may differ.
  expect(retime(rainbow, shown, { ...request, bpm: 60, capo: 2 })).toBeNull();
  // On a 7-string guitar the expert strum exceeds expert's attack rate at the piece's 80 BPM, so the pro version
  // plays, whatever tempo the request asks for.
  for (const bpm of [60, 80]) {
    const seven = await arrangeFor(rainbow, { ...request, instrumentId: "guitar-7", level: "expert", bpm }, { arrange: search });
    expect(seven.log.map(e => [e.version, e.status])).toEqual([["expert", "limits"], ["pro", "success"]]);
  }
}, 60000);

it("strums an imported score's inferred chords first at baby and beginner, and keeps picked notes per bar within each difficulty", async () => {
  // Two bars of 4/4 at 60 BPM: C major arpeggiated in eighths over a held C, then A minor and F major a half bar each.
  const arpeggio = (bar, half, pitches) => pitches.map((p, k) => ({ id: `n${bar}${half}${k}`, pitch: pitch(...p), onset: [bar * 4 + half * 2 + k / 2, 1].map((x, i) => (i ? 2 : x * 2)), duration: [1, 2], partId: "P", voiceId: "1", role: k ? "harmony" : "melody" }));
  const notes = [
    ...arpeggio(0, 0, [["E", 3], ["G", 3], ["C", 4], ["G", 3]]), ...arpeggio(0, 1, [["E", 3], ["G", 3], ["C", 4], ["G", 3]]),
    ...arpeggio(1, 0, [["A", 3], ["C", 4], ["E", 4], ["C", 4]]), ...arpeggio(1, 1, [["A", 3], ["C", 4], ["F", 4], ["C", 4]]),
    { id: "bass1", pitch: pitch("C", 3), onset: [0, 1], duration: [4, 1], partId: "B", voiceId: "1", role: "bass" },
    { id: "bass2", pitch: pitch("A", 2), onset: [4, 1], duration: [2, 1], partId: "B", voiceId: "1", role: "bass" },
    { id: "bass3", pitch: pitch("F", 2), onset: [6, 1], duration: [2, 1], partId: "B", voiceId: "1", role: "bass" },
  ];
  const score = createScore(notes, { tempoMap: [{ at: [0, 1], quarterBpm: 60 }], keyMap: [{ at: [0, 1], tonic: "C", mode: "major" }] });
  const piece = pieceFromScore(score, { id: "arp", instrument: "guitar" });
  expect([piece.chords.progression, piece.chords.simpleProgression]).toEqual([["C", "Am F"], ["C", "Am F"]]);
  expect(piece.chords.versions.map(v => v.id)).toEqual(["chords-baby", "chords-beginner", "chords-amateur"]);
  expect(versionById(piece, "chords-beginner").label).toMatch(/main chords/);
  const request = level => ({ instrumentId: "guitar", level, bpm: 60, texture: "all", capo: 0, custom: null });
  const baby = await arrangeFor(piece, request("baby"), { arrange: search });
  expect([baby.status, baby.version.id, baby.result.difficulty.maxPickedInOneBar]).toEqual(["success", "chords-baby", 0]);
  expect(baby.prepared.notes[0]).toMatch(/heuristic/);
  // From amateur the score's own notes come first. Each bar picks eight moments, its bass notes together with an
  // arpeggio note: more than amateur's 4 with notes together, so it is simplified, and the simplification leaves out
  // the doubled bass notes and keeps every moment of the arpeggio.
  const amateur = await arrangeFor(piece, request("amateur"), { arrange: search });
  expect(amateur.log.map(e => [e.version, e.simplify, e.status])).toEqual([["score", false, "limits"], ["score", true, "success"]]);
  expect(amateur.log[0].detail).toBe("up to 10 picked notes in one bar, some together; this difficulty allows 4 unless each sounds alone");
  expect(amateur.result.score.notes.map(n => n.id).filter(id => id.startsWith("bass"))).toEqual([]);
  expect(new Set(amateur.result.score.notes.map(n => n.onset[0] / n.onset[1])).size).toBe(16);
  // Expert and maestro have no such limit: the score plays as written.
  const expert = await arrangeFor(piece, request("expert"), { arrange: search });
  expect([expert.version.id, expert.simplify, expert.result.score.notes.length]).toEqual(["score", false, 19]);
}, 60000);

it("plays the top note of a melody chord as the tune; the notes under it count as harmony", () => {
  const note = (id, step, octave, onset) => ({ id, pitch: pitch(step, octave), onset: [onset, 1], duration: [1, 1], partId: "P", voiceId: "1", role: "melody" });
  const piece = pieceFromScore(createScore([note("low", "E", 4, 0), note("top", "G", 4, 0), note("next", "A", 4, 1)]), { id: "dyad" });
  const roles = prepare(piece, { instrumentId: "guitar", level: "pro", bpm: 120, texture: "all", version: piece.versions[0] }).source.notes.map(n => [n.id, n.role]);
  expect(Object.fromEntries(roles)).toEqual({ low: "harmony", top: "melody", next: "melody" });
});

it("counts the notes of the hardest version as written, whatever the difficulty and tempo", () => {
  const rainbow = songs.find(s => s.id === "rainbow"), request = { instrumentId: "uke-high-g", capo: 0, custom: null };
  expect(hardestVersion(rainbow).id).toBe("maestro");
  const full = prepare(rainbow, { ...request, level: "maestro", bpm: 96, version: hardestVersion(rainbow) }).total;
  expect([hardestNotes(rainbow, { ...request, level: "baby", bpm: 60 }), hardestNotes(rainbow, { ...request, level: "pro", bpm: 120 })]).toEqual([full, full]);
  // Another instrument strums more strings.
  expect(hardestNotes(rainbow, { ...request, instrumentId: "guitar", level: "baby", bpm: 80 })).toBeGreaterThan(full);
});

it("performs a song's fingering at any tempo, with only the time limits lifted", async () => {
  const { createPerformance, validatePerformance } = await import("../docs/assets/scorify/audio.mjs");
  const song = songs.find((s) => s.id === "rainbow");
  // The playground's instruments have no scale length, so no millimetre limit may appear when the time limits go.
  for (const [level, factor] of [["amateur", 1], ["maestro", 2]]) {
    const run = await arrangeFor(song, { instrumentId: "uke-high-g", level, bpm: song.bpm * factor, capo: 0, custom: null }, { arrange: (s, o) => arrange(s, o) });
    expect(run.status).toBe("success");
    const performed = createPerformance(run.result, run.prepared.options.instrument, { humanize: 0.8, strokes: strokesFor(run.prepared.spec, run.result), timeLimits: false });
    expect(performed.status, JSON.stringify(performed.diagnostics)).toBe("success");
    expect(performed.performance.timeLimits).toBe("lifted");
    expect(validatePerformance(performed.performance).valid).toBe(true);
  }
});
