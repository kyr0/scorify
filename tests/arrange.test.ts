import { describe, it, expect } from "vitest";
import {
  arrange,
  arrangeAsync,
  createScore,
  parsePitch,
  q,
  concertUkulele,
  classicalGuitar,
  createFrettedInstrument,
  compilePlayer,
  levels,
  pitchString,
  createArrangementSession,
} from "../src/index.js";
import type {
  NoteEvent,
  Score,
  ArrangementOptions,
  ArrangementSuccess,
} from "../src/index.js";
const n = (
  id: string,
  pitch: string,
  onset = 0,
  duration = 1,
  extra: Partial<NoteEvent> = {},
): NoteEvent => ({
  id,
  pitch: parsePitch(pitch),
  onset: q(onset),
  duration: q(duration),
  partId: "p",
  voiceId: "v",
  ...extra,
});
const exact = { strategy: "exact", maxExpandedStates: 1000000 } as const;
const easy = {
  level: "maestro",
  overrides: { maxAttacksPerSecond: 100 },
} as const;
function success(
  score: Score,
  options: ArrangementOptions,
): ArrangementSuccess {
  const r = arrange(score, options);
  expect(r.status, JSON.stringify(r)).toBe("success");
  if (r.status !== "success") throw new Error(r.status);
  return r;
}
describe("exact fretted search", () => {
  it("assigns reentrant high G by sounding pitch and keeps input immutable", () => {
    const score = createScore([n("a", "G4")]),
      before = JSON.stringify(score);
    const r = success(score, { instrument: concertUkulele(), search: exact });
    expect(r.annotations[0]!.assignments[0]).toMatchObject({
      stringNumber: 4,
      absoluteFret: 0,
      finger: 0,
    });
    expect(r.optimality).toBe("proven-in-model");
    expect(JSON.stringify(score)).toBe(before);
  });
  it("handles low G and configurable capo/alternate tuning", () => {
    for (const instrument of [
      concertUkulele({ tuning: "lowG" }),
      classicalGuitar({
        tuning: ["D2", "A2", "D3", "G3", "B3", "E4"],
        capoFret: 2,
      }),
    ]) {
      const pitch = instrument.id.startsWith("ukulele") ? "G3" : "E2";
      const r = success(createScore([n("a", pitch)]), {
        instrument,
        search: exact,
      });
      expect(r.annotations[0]!.assignments[0]!.finger).toBe(0);
    }
  });
  it("keeps six open guitar strings with no fretting fingers", () => {
    const pitches = ["E2", "A2", "D3", "G3", "B3", "E4"];
    const r = success(createScore(pitches.map((p, i) => n(String(i), p))), {
      instrument: classicalGuitar({ fretCount: 0 }),
      player: easy,
      search: exact,
    });
    expect(r.annotations[0]!.assignments).toHaveLength(6);
    expect(r.annotations[0]!.contacts).toHaveLength(0);
  });
  it("permits a six-string barre and rejects it when forbidden", () => {
    const instrument = createFrettedInstrument(
      "six",
      "six",
      ["E2", "A2", "D3", "G3", "B3", "E4"],
      { fretCount: 1 },
    );
    const score = createScore(
      ["F2", "Bb2", "Eb3", "Ab3", "C4", "F4"].map((p, i) => n(String(i), p)),
    );
    const r = success(score, { instrument, player: easy, search: exact });
    expect(
      r.annotations[0]!.contacts.some((c) => c.toString - c.fromString === 5),
    ).toBe(true);
    expect(
      arrange(score, {
        instrument,
        player: {
          ...easy,
          overrides: { ...easy.overrides, allowBarre: false },
        },
        search: exact,
      }).status,
    ).toBe("infeasible");
  });
  it("rejects an open string crossed by a barre", () => {
    const instrument = createFrettedInstrument(
      "five",
      "five",
      ["C2", "C3", "C4", "C5", "C6"],
      { fretCount: 1 },
    );
    const score = createScore(
      ["C#2", "C3", "C#4", "C#5", "C#6"].map((p, i) => n(String(i), p)),
    );
    const r = success(score, { instrument, search: exact });
    expect(
      r.annotations[0]!.contacts.every(
        (c) => !(c.fromString === 0 && c.toString > 1),
      ),
    ).toBe(true);
  });
  it("rejects simultaneously reachable pitches that compete for one string", () => {
    const instrument = createFrettedInstrument("one", "one", ["C4"], {
      fretCount: 12,
    });
    expect(
      arrange(createScore([n("a", "C4"), n("b", "E4")]), {
        instrument,
        search: exact,
      }).status,
    ).toBe("infeasible");
  });
  it("treats overlapping unisons as two independent physical notes", () => {
    const one = createFrettedInstrument("one", "one", ["C4"], { fretCount: 0 });
    expect(
      arrange(
        createScore([n("a", "C4"), n("b", "C4", 0, 1, { voiceId: "v2" })]),
        { instrument: one, search: exact },
      ).status,
    ).toBe("infeasible");
  });
  it("avoids a locally easy string that a sustained note would block later", () => {
    const instrument = createFrettedInstrument("two", "two", ["C4", "G4"], {
      fretCount: 7,
    });
    const r = success(
      createScore([n("held", "G4", 0, 2), n("later", "C4", 1)]),
      { instrument, search: exact },
    );
    expect(
      r.annotations[0]!.assignments.find((a) => a.id === "held")!.stringNumber,
    ).toBe(1);
  });
  it("keeps tied fragments at a single physical location without reattack", () => {
    const r = success(
      createScore([
        n("a", "C4", 0, 1, { tieGroupId: "t" }),
        n("b", "C4", 1, 1, { tieGroupId: "t" }),
      ]),
      { instrument: concertUkulele(), search: exact },
    );
    expect(r.score.notes).toHaveLength(2);
    expect(r.annotations.flatMap((a) => a.attackIds)).toEqual(["a"]);
    expect(r.annotations[0]!.assignments[0]!.noteIds).toEqual(["a", "b"]);
  });
  it("rejects a held finger changing to a distant chord without release time", () => {
    const instrument = createFrettedInstrument(
      "four",
      "four",
      ["C2", "C3", "C4", "C5"],
      { fretCount: 12 },
    );
    const score = createScore(
      ["C#2", "D3", "D#4", "E5"]
        .map((p, i) => n("a" + i, p))
        .concat(["F2", "F#3", "G4", "G#5"].map((p, i) => n("b" + i, p, 1))),
    );
    expect(
      arrange(score, {
        instrument,
        player: {
          ...easy,
          overrides: { allowBarre: false, maxAttacksPerSecond: 100 },
        },
        search: exact,
      }).status,
    ).toBe("infeasible");
  });
  it("a rest or explicit gate provides time for the same hand shift", () => {
    const instrument = createFrettedInstrument(
      "four",
      "four",
      ["C2", "C3", "C4", "C5"],
      { fretCount: 12 },
    );
    for (const gate of [false, true]) {
      const first = ["C#2", "D3", "D#4", "E5"].map((p, i) =>
        n("a" + i, p, 0, 1, gate ? { gateDuration: q(1, 2) } : {}),
      );
      const second = ["F2", "F#3", "G4", "G#5"].map((p, i) =>
        n("b" + i, p, gate ? 1 : 2),
      );
      success(createScore([...first, ...second]), {
        instrument,
        player: {
          ...easy,
          overrides: { allowBarre: false, maxAttacksPerSecond: 100 },
        },
        search: exact,
      });
    }
  });
  it("honors tempo-dependent shift speed across tempo changes", () => {
    const instrument = createFrettedInstrument(
      "four",
      "four",
      ["C2", "C3", "C4", "C5"],
      { fretCount: 12 },
    );
    const notes = [
      ...["C#2", "D3", "D#4", "E5"].map((p, i) => n("a" + i, p)),
      ...["F2", "F#3", "G4", "G#5"].map((p, i) => n("b" + i, p, 2)),
    ];
    const opts = {
      instrument,
      player: {
        ...easy,
        overrides: {
          allowBarre: false,
          maxAttacksPerSecond: 100,
          maxShiftFretsPerSecond: 5,
        },
      },
      search: exact,
    };
    success(
      createScore(notes, { tempoMap: [{ at: q(0), quarterBpm: 60 }] }),
      opts,
    );
    expect(
      arrange(
        createScore(notes, {
          tempoMap: [
            { at: q(0), quarterBpm: 60 },
            { at: q(1), quarterBpm: 600 },
          ],
        }),
        opts,
      ).status,
    ).toBe("infeasible");
  });
  it("requires geometry for millimetre caps", () => {
    expect(
      arrange(createScore([n("a", "C4")]), {
        instrument: concertUkulele(),
        player: { overrides: { maxReachMm: 50 } },
      }).status,
    ).toBe("invalid-input");
    const instrument = {
      ...concertUkulele(),
      scaleLengthMm: 380,
      stringSpacingMm: 10,
    };
    success(createScore([n("a", "C4")]), {
      instrument,
      player: { overrides: { maxReachMm: 50 } },
      search: exact,
    });
  });
  it("treats equal fret spans differently under real geometry", () => {
    const instrument = {
      ...createFrettedInstrument("two", "two", ["C3", "C5"], { fretCount: 24 }),
      scaleLengthMm: 650,
      stringSpacingMm: 10,
    };
    const low = createScore([n("a", "C#3"), n("b", "E5")]),
      high = createScore([n("a", "C#4"), n("b", "E6")]);
    const options = {
      instrument,
      search: exact,
      player: { overrides: { maxReachMm: 70, maxFretSpan: 4 } },
    };
    expect(arrange(low, options).status).toBe("infeasible");
    success(high, options);
  });
  it("strums cannot cross unintended strings without explicit muting capability", () => {
    const instrument = createFrettedInstrument(
        "three",
        "three",
        ["C3", "E3", "G3"],
        { fretCount: 0 },
      ),
      score = createScore([n("a", "C3"), n("b", "G3")]);
    expect(
      arrange(score, {
        instrument,
        player: { overrides: { rightHand: "strum" } },
        search: exact,
      }).status,
    ).toBe("infeasible");
    const r = success(score, {
      instrument,
      player: { overrides: { rightHand: "strum", allowMutedStrum: true } },
      search: exact,
    });
    expect(r.annotations[0]!.mutedStringIds).toContain("s2");
  });
  it("rejects unsupported techniques instead of silently removing them", () => {
    expect(
      arrange(createScore([n("a", "C4", 0, 1, { techniques: ["bend"] })]), {
        instrument: concertUkulele(),
        mode: "adaptive",
      }).status,
    ).toBe("unsupported");
  });
  it("unconstrained transforms work outside the instrument range", () => {
    const r = success(createScore([n("a", "C2")]), {
      mode: "unconstrained",
      transform: { interval: "2M", tempoScale: 0.5 },
    });
    expect(pitchString(r.score.notes[0]!.pitch)).toBe("D2");
    expect(r.score.tempoMap[0]!.quarterBpm).toBe(60);
    expect(r.annotations).toEqual([]);
  });
  it("distinguishes budget exhaustion from infeasibility and supports cancellation", () => {
    const score = createScore([n("a", "D4")]);
    expect(
      arrange(score, {
        instrument: concertUkulele(),
        search: { maxExpandedStates: 1 },
      }).status,
    ).toBe("search-exhausted");
    expect(
      arrange(score, {
        instrument: concertUkulele(),
        signal: { aborted: true },
      }).status,
    ).toBe("cancelled");
    expect(
      arrange(createScore([n("a", "C2")]), {
        instrument: concertUkulele(),
        search: exact,
      }).status,
    ).toBe("infeasible");
  });
  it("DP agrees with exhaustive oracle and unpruned beam on a finite small graph", () => {
    const instrument = createFrettedInstrument("two", "two", ["C4", "D4"], {
        fretCount: 2,
      }),
      score = createScore([n("a", "D4"), n("b", "D4", 2)]);
    const results = ["exact", "exhaustive", "beam"].map((strategy) =>
      success(score, {
        instrument,
        search: {
          strategy: strategy as "exact",
          beamWidth: 10000,
          maxCandidatesPerFrame: 10000,
          maxExpandedStates: 1000000,
        },
      }),
    );
    for (const r of results) {
      expect(r.cost.total).toBeCloseTo(results[0]!.cost.total, 12);
      expect(r.optimality).toBe("proven-in-model");
    }
  });
  it("is deterministic under fixed bounds", () => {
    const score = createScore([n("a", "E4"), n("b", "G4", 2)]),
      opts = { instrument: concertUkulele(), search: { beamWidth: 2 } };
    expect(arrange(score, opts)).toEqual(arrange(score, opts));
  });
});
describe("adaptive policies", () => {
  it("keeps required chromatic melody while omitting marked ornaments", () => {
    const score = createScore([
      n("m", "C#4", 0, 1, { role: "melody" }),
      n("o", "E4", 0, 1, { role: "ornament" }),
    ]);
    const r = success(score, {
      instrument: concertUkulele(),
      mode: "adaptive",
      player: { level: "baby" },
      search: exact,
    });
    expect(r.score.notes.map((n) => n.id)).toEqual(["m"]);
    expect(r.edits).toContainEqual(
      expect.objectContaining({ kind: "omit", sourceIds: ["o"] }),
    );
    expect(r.sourceMap.o).toEqual([]);
  });
  it("uses explicitly permitted octave shifts and reports them once", () => {
    const score = createScore([n("m", "C3", 0, 4, { role: "melody" })]);
    expect(
      arrange(score, {
        instrument: concertUkulele(),
        mode: "adaptive",
        search: exact,
      }).status,
    ).toBe("infeasible");
    const r = success(score, {
      instrument: concertUkulele(),
      mode: "adaptive",
      adaptation: { allowOctaveShift: true },
      search: exact,
    });
    expect(pitchString(r.score.notes[0]!.pitch)).toBe("C4");
    expect(r.edits.filter((e) => e.kind === "octave")).toHaveLength(1);
  });
  it("locks and explicit prohibitions take precedence over low levels", () => {
    const score = createScore([
      n("o", "C4", 0, 1, { role: "ornament", locked: { keep: true } }),
    ]);
    expect(
      arrange(score, {
        instrument: concertUkulele(),
        mode: "adaptive",
        player: { level: "baby" },
        search: exact,
      }).status,
    ).toBe("infeasible");
    expect(
      arrange(createScore([n("m", "C3", 0, 1, { locked: { pitch: true } })]), {
        instrument: concertUkulele(),
        mode: "adaptive",
        adaptation: { allowOctaveShift: true },
        search: exact,
      }).status,
    ).toBe("infeasible");
  });
  it("jointly removes accompaniment when string capacity requires it", () => {
    const score = createScore([
        n("m", "C4", 0, 1, { role: "melody" }),
        n("h", "E4", 0, 1, { role: "harmony" }),
      ]),
      instrument = createFrettedInstrument("one", "one", ["C4"]);
    const r = success(score, {
      instrument,
      mode: "adaptive",
      adaptation: { allowAccompanimentOmission: true },
      search: exact,
    });
    expect(r.score.notes.map((n) => n.id)).toEqual(["m"]);
    expect(r.cost.musicalLoss).toBeGreaterThan(0);
  });
  it("selects an explicit earlier gate to make a transition possible", () => {
    const instrument = createFrettedInstrument(
      "four",
      "four",
      ["C2", "C3", "C4", "C5"],
      { fretCount: 12 },
    );
    const notes = [
      ...["C#2", "D3", "D#4", "E5"].map((p, i) => n("a" + i, p)),
      ...["F2", "F#3", "G4", "G#5"].map((p, i) => n("b" + i, p, 1)),
    ];
    const r = success(createScore(notes), {
      instrument,
      mode: "adaptive",
      adaptation: { allowHoldShortening: true },
      player: { overrides: { allowBarre: false, maxAttacksPerSecond: 100 } },
      search: {
        strategy: "beam",
        beamWidth: 128,
        maxExpandedStates: 1000000,
        maxCandidatesPerFrame: 256,
      },
    });
    expect(r.edits.some((e) => e.kind === "hold")).toBe(true);
  });
  it("all levels compile monotonically and overrides remain independent", () => {
    const profiles = levels.map((level) => compilePlayer({ level }));
    for (let i = 1; i < profiles.length; i++) {
      expect(profiles[i]!.maxFretSpan).toBeGreaterThanOrEqual(
        profiles[i - 1]!.maxFretSpan,
      );
      expect(profiles[i]!.complexity).toBeGreaterThanOrEqual(
        profiles[i - 1]!.complexity,
      );
    }
    expect(
      compilePlayer({ level: "expert", overrides: { maxFretSpan: 1 } })
        .maxFretSpan,
    ).toBe(1);
    expect(() => compilePlayer({ complexity: 2 })).toThrow();
  });
  it("keeps lower difficulties low on the neck with a soft cost that never drops a note", () => {
    expect(levels.map((level) => compilePlayer({ level }).highFretCosts)).toEqual([
      ...Array(4).fill([{ above: 8, perFret: 1 }, { above: 10, perFret: 4 }]),
      [{ above: 10, perFret: 4 }],
      [{ above: 10, perFret: 4 }],
      [],
    ]);
    expect(() =>
      compilePlayer({ overrides: { highFretCosts: [{ above: -1, perFret: 1 }] } }),
    ).toThrow(RangeError);
    // E5 and G5 lie only at fret 12 and above on a guitar; B4 and A4 lie at frets 4-5, 9-10 and 12-14.
    const run = createScore(
      ["E5", "D5", "C5", "B4", "A4", "G4", "E5", "G5"].map((p, i) =>
        n(`n${i}`, p, i, 1, { role: "melody" }),
      ),
    );
    const frets = (level: (typeof levels)[number]) => {
      const r = success(run, {
        instrument: classicalGuitar(),
        mode: "adaptive",
        adaptation: { allowOctaveShift: true, allowAccompanimentOmission: true },
        player: { level, overrides: { maxAttacksPerSecond: 100, maxPickedPerBar: 100 } },
      });
      // Every note is kept at its pitch: the cost moves the hand, not the music.
      expect(r.cost.musicalLoss).toBe(0);
      expect(r.score.notes.map((x) => pitchString(x.pitch))).toEqual(
        run.notes.map((x) => pitchString(x.pitch)),
      );
      return r.annotations.map((a) => Math.max(...a.assignments.map((x) => x.relativeFret)));
    };
    // B4 and A4: semi-pro stays at or below fret 8, pro at or below 10, maestro moves up to 12.
    expect(frets("semi-pro").slice(3, 5).every((f) => f <= 8)).toBe(true);
    expect(frets("pro").slice(3, 5).every((f) => f <= 10)).toBe(true);
    expect(Math.max(...frets("maestro").slice(3, 5))).toBeGreaterThan(10);
    expect(frets("semi-pro")[7]).toBe(15);
  });
  it("maestro still reports impossible instrument requirements", () => {
    expect(
      arrange(createScore([n("a", "C1")]), {
        instrument: concertUkulele(),
        mode: "adaptive",
        player: { level: "maestro" },
        search: exact,
      }).status,
    ).toBe("infeasible");
  });
  it("async scheduling can cancel ongoing work", async () => {
    const token = { aborted: false };
    const result = await arrangeAsync(
      createScore([n("a", "E4"), n("b", "G4", 2)]),
      { instrument: concertUkulele(), signal: token },
      {
        yieldEvery: 1,
        schedule: async () => {
          token.aborted = true;
        },
      },
    );
    expect(result.status).toBe("cancelled");
  });
  it("level recomputation always uses the original and cache results are isolated", async () => {
    const source = createScore([
        n("a", "C4", 0, 1, { role: "melody" }),
        n("o", "E4", 0, 1, { role: "ornament" }),
      ]),
      session = createArrangementSession(source);
    const baby = await session.recompute({
      instrument: concertUkulele(),
      mode: "adaptive",
      player: { level: "baby" },
    });
    const high = await session.recompute({
      instrument: concertUkulele(),
      mode: "adaptive",
      player: { level: "maestro" },
    });
    expect(baby.status).toBe("success");
    expect(high.status).toBe("success");
    if (baby.status === "success" && high.status === "success") {
      expect(baby.score.notes).toHaveLength(1);
      expect(high.score.notes).toHaveLength(2);
    }
    (source.notes as NoteEvent[]).pop();
    const cached = await session.recompute({
      instrument: concertUkulele(),
      mode: "adaptive",
      player: { level: "maestro" },
    });
    if (cached.status === "success") expect(cached.score.notes).toHaveLength(2);
  });
});
