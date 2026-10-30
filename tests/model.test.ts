import { describe, it, expect } from "vitest";
import {
  q,
  addQ,
  subQ,
  mulQ,
  compareQ,
  secondsAt,
  secondsBetween,
  quartersAtSeconds,
  createScore,
  parsePitch,
  pitchString,
  normalizeScore,
  validateScore,
  soundingNotes,
  scoreFrames,
  transposeScore,
  retimeScore,
  transposeChordSymbol,
  transformScore,
} from "../src/index.js";
import type { NoteEvent } from "../src/model.js";
const note = (
  id = "a",
  pitch = "C4",
  onset = q(0),
  duration = q(1),
): NoteEvent => ({
  id,
  pitch: parsePitch(pitch),
  onset,
  duration,
  partId: "p",
  voiceId: "v",
});
describe("canonical model", () => {
  it("normalizes and computes exact tuplets", () => {
    expect(q(2, 6)).toEqual([1, 3]);
    expect(addQ(q(1, 3), q(2, 3))).toEqual(q(1));
    expect(subQ(q(1), q(3, 4))).toEqual(q(1, 4));
    expect(mulQ(q(2, 3), q(3, 4))).toEqual(q(1, 2));
    expect(compareQ(q(9007199254740990, 9007199254740991), q(1))).toBe(-1);
  });
  it("reduces before range checks and rejects unsafe arithmetic", () => {
    expect(
      addQ(q(Number.MAX_SAFE_INTEGER, 2), q(Number.MAX_SAFE_INTEGER, 2)),
    ).toEqual(q(Number.MAX_SAFE_INTEGER));
    expect(() => addQ(q(Number.MAX_SAFE_INTEGER), q(1))).toThrow(/overflow/);
    expect(() => q(1, 0)).toThrow();
    expect(() => q(0.5)).toThrow();
    expect(() => q(1, -1)).toThrow();
  });
  it("preserves enharmonic spelling and validates pitch objects", () => {
    expect(pitchString(parsePitch("E#4"))).toBe("E#4");
    expect(() => parsePitch("C#b4")).toThrow();
    expect(() => parsePitch("C")).toThrow();
    expect(() => parsePitch("C99")).toThrow();
  });
  it("is immutable, serializable and canonical", () => {
    const s = createScore([note("b", "D4", [2, 2]), note("a", "C4", [0, 3])]);
    const snapshot = JSON.stringify(s);
    expect(normalizeScore(JSON.parse(snapshot))).toEqual(s);
    expect(s.notes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(s.keyMap).toEqual([]);
  });
  it("rejects unknown voices, duplicate ids, invalid maps and zero durations", () => {
    const s = createScore([note()]);
    for (const bad of [
      { ...s, notes: [...s.notes, ...s.notes] },
      { ...s, notes: [{ ...note(), voiceId: "missing" }] },
      { ...s, notes: [{ ...note(), duration: q(0) }] },
      { ...s, tempoMap: [{ at: q(1), quarterBpm: 120 }] },
      { ...s, meterMap: [{ at: q(0), numerator: 4, denominator: 3 }] },
      {
        ...s,
        keyMap: [
          { at: q(2), tonic: "C", mode: "major" },
          { at: q(1), tonic: "D", mode: "minor" },
        ],
      },
    ])
      expect(() => validateScore(bad)).toThrow();
  });
  it("merges contiguous ties while keeping notation and rejects broken ties", () => {
    const notes = [
      { ...note("a"), tieGroupId: "t" },
      { ...note("b", "C4", q(1)), tieGroupId: "t" },
    ];
    const s = createScore(notes);
    expect(soundingNotes(s)).toMatchObject([
      { id: "a", noteIds: ["a", "b"], end: q(2) },
    ]);
    expect(s.notes).toHaveLength(2);
    expect(() =>
      createScore([notes[0]!, { ...notes[1]!, pitch: parsePitch("D4") }]),
    ).toThrow(/Tie/);
    expect(() =>
      createScore([{ ...notes[0]!, gateDuration: q(1, 2) }, notes[1]!]),
    ).toThrow(/Tie/);
  });
  it("releases before attacks and observes gates", () => {
    const s = createScore([
      { ...note("a"), gateDuration: q(1, 2) },
      note("b", "D4", q(1, 2)),
    ]);
    const frames = scoreFrames(s);
    expect(frames[1]!.active.map((n) => n.id)).toEqual(["b"]);
    expect(frames[1]!.releases.map((n) => n.id)).toEqual(["a"]);
  });
  it("distinguishes voices and rejects contradictory rests", () => {
    const n = note();
    expect(() =>
      createScore([n], {
        rests: [
          { id: "r", onset: q(0), duration: q(1), partId: "p", voiceId: "v" },
        ],
      }),
    ).toThrow(/Rest/);
    expect(
      createScore([n], {
        parts: [{ id: "p", voices: ["v", "other"] }],
        rests: [
          {
            id: "r",
            onset: q(0),
            duration: q(1),
            partId: "p",
            voiceId: "other",
          },
        ],
      }).rests,
    ).toHaveLength(1);
  });
  it("retains written-pitch metadata without changing sounding values", () => {
    const s = createScore([note("a", "E2")], {
      parts: [{ id: "p", voices: ["v"], writtenToSounding: "-8P" }],
    });
    expect(pitchString(s.notes[0]!.pitch)).toBe("E2");
    expect(s.parts[0]!.writtenToSounding).toBe("-8P");
  });
});
describe("transforms and tempo maps", () => {
  const map = [
    { at: q(0), quarterBpm: 60 },
    { at: q(2), quarterBpm: 120 },
  ];
  it("integrates a tempo change inside a transition and inverts timing", () => {
    expect(secondsAt(q(4), map)).toBe(3);
    expect(secondsBetween(q(1), q(3), map)).toBe(1.5);
    expect(quartersAtSeconds(2.5, map)).toBe(3);
  });
  it("supports tuplet time across tempo changes", () => {
    const t = q(7, 3);
    expect(quartersAtSeconds(secondsAt(t, map), map)).toBeCloseTo(7 / 3);
  });
  it("transposes notes, modulation keys, roots and slash basses", () => {
    const s = createScore([note("a", "C#4")], {
      keyMap: [
        { at: q(0), tonic: "C#", mode: "major" },
        { at: q(2), tonic: "F#", mode: "minor" },
      ],
      harmony: [
        {
          id: "h",
          onset: q(0),
          end: q(1),
          candidates: [{ symbol: "C#maj7/E#", score: 1 }],
          selected: "C#maj7/E#",
          evidenceNoteIds: ["a"],
          provenance: "provided",
          method: "caller",
        },
      ],
    });
    const t = transposeScore(s, { interval: "3M" });
    expect(pitchString(t.notes[0]!.pitch)).toBe("E#4");
    expect(t.keyMap.map((k) => k.tonic)).toEqual(["E#", "A#"]);
    expect(t.harmony[0]!.selected).toBe("E#maj7/G##");
    expect(transposeScore(t, { interval: "-3M" })).toEqual(s);
  });
  it("scales every tempo segment while preserving musical time", () => {
    const s = createScore([note()], { tempoMap: map });
    const t = retimeScore(s, { scale: 0.5 });
    expect(t.tempoMap.map((t) => t.quarterBpm)).toEqual([30, 60]);
    expect(t.notes).toEqual(s.notes);
    expect(secondsAt(q(4), t.tempoMap)).toBe(6);
    expect(retimeScore(s, { quarterBpm: 90 }).tempoMap).toHaveLength(1);
  });
  it("rejects ambiguous/invalid transformations", () => {
    const s = createScore([note()]);
    expect(() => retimeScore(s, { scale: 1, quarterBpm: 60 })).toThrow();
    expect(() => retimeScore(s, { scale: 0 })).toThrow();
    expect(() => transposeScore(s, { interval: "nonsense" })).toThrow();
    expect(() => transposeChordSymbol("no chord", "2M")).toThrow();
    expect(() =>
      transformScore(s, { tempoScale: 1, quarterBpm: 60 }),
    ).toThrow();
  });
});

it("rejects score metadata that cannot survive an ordinary JSON roundtrip", () => {
  const score = createScore([note()]);
  expect(() =>
    validateScore({ ...score, notation: { callback: () => {} } }),
  ).toThrow(/JSON/);
  expect(() =>
    validateScore({ ...score, notation: { date: new Date() } }),
  ).toThrow(/JSON/);
  expect(() =>
    validateScore({ ...score, notation: { bad: Infinity } }),
  ).toThrow(/JSON/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => validateScore({ ...score, notation: cyclic })).toThrow(/JSON/);
});
