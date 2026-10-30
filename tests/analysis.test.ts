import { describe, it, expect } from "vitest";
import {
  createScore,
  parsePitch,
  q,
  analyzeHarmony,
  quantizePerformance,
  secondsAt,
  pitchString,
} from "../src/index.js";
import type { NoteEvent, PerformedNote } from "../src/index.js";
const n = (
  id: string,
  pitch: string,
  onset: number,
  duration = 1,
): NoteEvent => ({
  id,
  pitch: parsePitch(pitch),
  onset: q(onset),
  duration: q(duration),
  partId: "p",
  voiceId: "v",
});
const map = {
  tempoMap: [{ at: q(0), quarterBpm: 60 }],
  meterMap: [{ at: q(0), numerator: 4, denominator: 4 }],
};
const performed = (
  id: string,
  pitch: string,
  onsetSeconds: number,
  durationSeconds: number,
  voiceId = "v",
): PerformedNote => ({
  id,
  pitch,
  onsetSeconds,
  durationSeconds,
  partId: "p",
  voiceId,
});
describe("harmony windows", () => {
  it("recognizes a non-overlapping arpeggio across a harmonic window", () => {
    const result = analyzeHarmony(
      createScore([n("c", "C4", 0), n("e", "E4", 1), n("g", "G4", 2)]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.candidates.map((c) => c.symbol)).toContain("CM");
    expect(result[0]!.evidenceNoteIds).toEqual(["c", "e", "g"]);
  });
  it("keeps ambiguous alternatives instead of claiming certainty", () => {
    const result = analyzeHarmony(
      createScore(["E4", "G#4", "B4", "C#5"].map((p, i) => n(String(i), p, 0))),
    );
    expect(result[0]!.candidates.map((c) => c.symbol)).toContain("E6");
    expect(result[0]!.candidates.map((c) => c.symbol)).toContain("C#m7/E");
  });
  it("leaves monophonic evidence unknown", () => {
    expect(
      analyzeHarmony(createScore([n("a", "C4", 0)]))[0]!.candidates,
    ).toEqual([]);
    expect(analyzeHarmony(createScore([]))).toEqual([]);
  });
  it("preserves provided intent and exposes realized evidence separately", () => {
    const score = createScore([n("a", "C4", 0, 4)], {
      harmony: [
        {
          id: "intent",
          onset: q(0),
          end: q(4),
          selected: "CM7",
          candidates: [],
          evidenceNoteIds: ["a"],
          provenance: "provided",
          method: "author",
        },
      ],
    });
    expect(analyzeHarmony(score)[0]!.selected).toBe("CM7");
    expect(
      analyzeHarmony(score, { respectProvided: false })[0]!.selected,
    ).toBeUndefined();
  });
  it("uses actual sounding bass for high-G ukulele", () => {
    const result = analyzeHarmony(
      createScore(["G4", "C4", "E4", "A4"].map((p, i) => n(String(i), p, 0))),
    );
    expect(result[0]!.candidates.map((c) => c.symbol)).toContain("C6");
  });
  it("respects meter changes and bounded windows", () => {
    const score = createScore([n("a", "C4", 0, 6)], {
      meterMap: [
        { at: q(0), numerator: 3, denominator: 4 },
        { at: q(3), numerator: 3, denominator: 4 },
      ],
    });
    expect(analyzeHarmony(score).map((h) => h.onset)).toEqual([q(0), q(3)]);
    expect(() =>
      analyzeHarmony(score, { window: q(1, 100), maxWindows: 2 }),
    ).toThrow(/budget/);
  });
});
describe("known-map quantization", () => {
  it("quantizes triplets across a bar boundary with exact rational durations", () => {
    const input = [
      performed("a", "C4", 3.335, 0.332),
      performed("b", "D4", 3.669, 0.329),
      performed("c", "E4", 4.002, 0.332),
    ];
    const r = quantizePerformance(input, {
      ...map,
      subdivisions: [3],
      toleranceSeconds: 0.02,
    });
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.score.notes.map((n) => n.onset)).toEqual([
        q(10, 3),
        q(11, 3),
        q(4),
      ]);
      expect(
        r.score.notes.every((n) => n.duration[0] === 1 && n.duration[1] === 3),
      ).toBe(true);
      expect(r.original).toEqual(input);
      expect(r.edits).toHaveLength(3);
    }
  });
  it("integrates known tempo changes before quantizing performed time", () => {
    const tempoMap = [
      { at: q(0), quarterBpm: 60 },
      { at: q(2), quarterBpm: 120 },
    ];
    const r = quantizePerformance([performed("a", "C4", 2.25, 0.25)], {
      ...map,
      tempoMap,
      subdivisions: [2],
      toleranceSeconds: 0.01,
    });
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.score.notes[0]!.onset).toEqual(q(5, 2));
      expect(r.score.notes[0]!.duration).toEqual(q(1, 2));
    }
  });
  it("preserves intentional overlapping voices and simultaneous chord attacks", () => {
    const input = [
      performed("long", "C4", 0, 2, "bass"),
      performed("first", "E4", 0, 1, "treble"),
      performed("second", "G4", 1, 1, "treble"),
    ];
    const r = quantizePerformance(input, {
      ...map,
      subdivisions: [1],
      toleranceSeconds: 0,
    });
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.score.notes.find((n) => n.id === "long")!.duration).toEqual(
        q(2),
      );
      expect(r.score.notes.filter((n) => n.onset[0] === 0)).toHaveLength(2);
    }
  });
  it("avoids zero-length and colliding repeated notes through joint timing choices", () => {
    const r = quantizePerformance(
      [performed("a", "C4", 0.05, 0.4), performed("b", "C4", 0.46, 0.54)],
      { ...map, subdivisions: [2], toleranceSeconds: 0.1 },
    );
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.score.notes.map((n) => n.onset)).toEqual([q(0), q(1, 2)]);
      expect(r.score.notes.map((n) => n.duration)).toEqual([q(1, 2), q(1, 2)]);
    }
  });
  it("preserves same-voice intentional overlap", () => {
    const r = quantizePerformance(
      [performed("a", "C4", 0, 1.5), performed("b", "E4", 1, 1)],
      { ...map, subdivisions: [2], toleranceSeconds: 0.01 },
    );
    expect(r.status).toBe("success");
    if (r.status === "success")
      expect(r.score.notes[0]!.duration).toEqual(q(3, 2));
  });
  it("returns infeasible for a note with no positive grid duration in tolerance", () => {
    expect(
      quantizePerformance([performed("a", "C4", 0.1, 0.01)], {
        ...map,
        subdivisions: [1],
        toleranceSeconds: 0.02,
      }).status,
    ).toBe("infeasible");
  });
  it("returns honest bounded results and timing alternatives", () => {
    const input = [performed("a", "C4", 0.24, 0.52)];
    const r = quantizePerformance(input, {
      ...map,
      subdivisions: [2, 4],
      toleranceSeconds: 0.3,
      maxCandidatesPerNote: 1,
    });
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.optimality).toBe("best-found");
      expect(r.alternatives.a).toHaveLength(1);
    }
    expect(
      quantizePerformance(
        [performed("a", "C4", 0, 1), performed("b", "D4", 1, 1)],
        {
          ...map,
          subdivisions: [1],
          toleranceSeconds: 0,
          maxExpandedStates: 1,
        },
      ).status,
    ).toBe("search-exhausted");
  });
  it("rejects invalid inputs and leaves the performance unchanged", () => {
    const input = [performed("a", "C4", 0.01, 0.99)],
      copy = JSON.stringify(input);
    quantizePerformance(input, { ...map });
    expect(JSON.stringify(input)).toBe(copy);
    expect(quantizePerformance([performed("a", "C4", 0, 0)], map).status).toBe(
      "invalid-input",
    );
    expect(
      quantizePerformance(input, { ...map, subdivisions: [0] }).status,
    ).toBe("invalid-input");
  });
  it("round-trips already exact timings with no pitch change", () => {
    const input = [
      performed("a", "Db4", 0, 1 / 3),
      performed("b", "F4", 1 / 3, 1 / 3),
    ];
    const r = quantizePerformance(input, {
      ...map,
      subdivisions: [3],
      toleranceSeconds: 0,
    });
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(pitchString(r.score.notes[0]!.pitch)).toBe("Db4");
      expect(secondsAt(r.score.notes[1]!.onset, map.tempoMap)).toBeCloseTo(
        1 / 3,
      );
    }
  });
});

it("bounds candidate construction as well as the quantization path search", () => {
  const r = quantizePerformance(
    [
      {
        id: "a",
        pitch: "C4",
        onsetSeconds: 10,
        durationSeconds: 1,
        partId: "p",
        voiceId: "v",
      },
    ],
    {
      tempoMap: [{ at: q(0), quarterBpm: 60 }],
      meterMap: [{ at: q(0), numerator: 4, denominator: 4 }],
      subdivisions: [64],
      toleranceSeconds: 10,
      maxExpandedStates: 50,
    },
  );
  expect(r.status).toBe("search-exhausted");
});
