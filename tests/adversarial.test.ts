import { describe, it, expect } from "vitest";
import {
  arrange,
  arrangeWithAdapter,
  createFrettedAdapter,
  validateFrettedArrangement,
  createScore,
  parsePitch,
  q,
  concertUkulele,
  createFrettedInstrument,
  compilePlayer,
  levels,
  isMultipleQ,
  soundingNotes,
} from "../src/index.js";
import type {
  NoteEvent,
  InstrumentAdapter,
  ArrangementSuccess,
  PlayerOptions,
  Score,
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
function successful(r: ReturnType<typeof arrange>): ArrangementSuccess {
  expect(r.status, JSON.stringify(r)).toBe("success");
  if (r.status !== "success") throw new Error(r.status);
  return r;
}
describe("independent validation and adversarial cases", () => {
  it("preserves a barre footprint after one endpoint note ends", () => {
    const instrument = createFrettedInstrument("pair", "pair", ["C3", "C4"], {
        fretCount: 1,
      }),
      score = createScore([n("short", "C#3"), n("long", "C#4", 0, 2)]),
      adapter = createFrettedAdapter(instrument),
      active = soundingNotes(score),
      context = { player: compilePlayer(), tick: () => {} };
    const firstFrame = {
      at: q(0),
      seconds: 0,
      active,
      attackIds: ["short", "long"],
    };
    const first = [...adapter.enumerate(firstFrame, undefined, context)].find(
      (r) => r.contacts.length === 1,
    )!;
    const state = adapter.transition(
      adapter.initialState(),
      undefined,
      first,
      firstFrame,
      context,
    ).state;
    const secondFrame = {
      at: q(1),
      seconds: 0.5,
      active: active.filter((n) => n.id === "long"),
      attackIds: [],
    };
    const next = [...adapter.enumerate(secondFrame, first, context)][0]!;
    expect(next.contacts).toEqual(first.contacts);
    expect(
      adapter.transition(state, first, next, secondFrame, context).valid,
    ).toBe(true);
  });
  it("detects tampered fingerings and omitted release boundaries", () => {
    const instrument = concertUkulele(),
      r = successful(
        arrange(createScore([n("a", "C4")]), { instrument, search: exact }),
      );
    const tampered = JSON.parse(JSON.stringify(r.annotations));
    tampered[0].assignments[0].absoluteFret++;
    expect(
      validateFrettedArrangement(r.score, instrument, tampered).valid,
    ).toBe(false);
    expect(
      validateFrettedArrangement(
        r.score,
        instrument,
        r.annotations.slice(0, -1),
      ).diagnostics,
    ).toContain("Missing attack or release boundaries");
  });
  it("validates note identities and attacks rather than trusting annotation metadata", () => {
    const instrument = concertUkulele(),
      r = successful(
        arrange(createScore([n("a", "C4")]), { instrument, search: exact }),
      );
    const annotations = JSON.parse(JSON.stringify(r.annotations));
    annotations[0].assignments[0].noteIds = ["invented"];
    annotations[0].attackIds = [];
    const check = validateFrettedArrangement(r.score, instrument, annotations);
    expect(check.valid).toBe(false);
    expect(check.diagnostics).toContain("Incorrect note identities");
    expect(check.diagnostics).toContain("Incorrect attacks");
  });
  it("honors per-string capo in a polyphonic realization", () => {
    const base = createFrettedInstrument("pair", "pair", ["C3", "C4"], {
        fretCount: 5,
      }),
      instrument = {
        ...base,
        strings: base.strings.map((s, i) => ({ ...s, capoFret: i + 1 })),
      };
    const r = successful(
      arrange(createScore([n("a", "C#3"), n("b", "D4")]), {
        instrument,
        search: exact,
      }),
    );
    expect(
      r.annotations[0]!.assignments.every(
        (a) => a.effectiveOpen && a.relativeFret === 0 && a.finger === 0,
      ),
    ).toBe(true);
  });
  it("keeps provided harmonic intent while returning distinct realized harmony", () => {
    const score = createScore(
      [
        n("m", "C4", 0, 1, { role: "melody" }),
        n("o", "B4", 0, 1, { role: "ornament" }),
      ],
      {
        harmony: [
          {
            id: "h",
            onset: q(0),
            end: q(1),
            selected: "CM7",
            candidates: [],
            evidenceNoteIds: ["m", "o"],
            provenance: "provided",
            method: "author",
          },
        ],
      },
    );
    const r = successful(
      arrange(score, {
        instrument: concertUkulele(),
        mode: "adaptive",
        player: { level: "baby" },
        search: exact,
      }),
    );
    expect(r.sourceHarmony[0]!.selected).toBe("CM7");
    expect(r.realizedHarmony[0]!.selected).toBeUndefined();
    expect(r.score.harmony[0]!.evidenceNoteIds).toEqual(["m"]);
  });
  it("provides explicit auto-tempo without overriding a requested tempo", () => {
    const source = createScore([n("m", "C4")]);
    const r = successful(
      arrange(source, {
        instrument: concertUkulele(),
        player: { level: "baby" },
        autoTempo: true,
        search: exact,
      }),
    );
    expect(r.score.tempoMap[0]!.quarterBpm).toBe(50);
    expect(r.edits).toContainEqual(
      expect.objectContaining({ kind: "tempo", permission: "autoTempo" }),
    );
    expect(
      arrange(source, {
        mode: "unconstrained",
        autoTempo: true,
        transform: { tempoScale: 0.5 },
      }).status,
    ).toBe("invalid-input");
  });
  it("can build a slow melody skeleton only with explicit melody-edit permission", () => {
    const score = createScore([
        n("anchor", "C4", 0, 1, {
          role: "melody",
          locked: { keep: true },
          importance: 1,
        }),
        n("passing", "D4", 0, 1, { role: "melody", importance: 0.1 }),
      ]),
      instrument = createFrettedInstrument("one", "one", ["C4"], {
        fretCount: 3,
      });
    const r = successful(
      arrange(score, {
        instrument,
        mode: "adaptive",
        adaptation: { preserveMelody: false, allowMelodyOmission: true },
        search: exact,
      }),
    );
    expect(r.score.notes.map((n) => n.id)).toEqual(["anchor"]);
    expect(r.edits[0]!.permission).toBe("adaptation.allowMelodyOmission");
  });
  it("quantizes symbolic rhythmic vocabulary by a permitted arrangement edit", () => {
    const score = createScore([
      { ...n("m", "C4"), onset: q(1, 3), duration: q(1, 3) },
    ]);
    const r = successful(
      arrange(score, {
        instrument: concertUkulele(),
        mode: "adaptive",
        player: { level: "baby", overrides: { rhythmGrid: q(1) } },
        adaptation: { allowRhythmSimplification: true, rhythmGrid: q(1) },
        search: exact,
      }),
    );
    expect(r.score.notes[0]!.onset).toEqual(q(1));
    expect(r.score.notes[0]!.duration).toEqual(q(1));
    expect(r.edits.filter((e) => e.kind === "rhythm")).toHaveLength(2);
  });
  it("rejects forbidden duration edits and explicit rest conflicts", () => {
    const source = createScore([
      { ...n("m", "C4"), duration: q(1, 3), locked: { duration: true } },
    ]);
    expect(
      arrange(source, {
        instrument: concertUkulele(),
        mode: "adaptive",
        player: { level: "baby" },
        adaptation: { allowRhythmSimplification: true },
        search: exact,
      }).status,
    ).toBe("infeasible");
    const score = createScore(
      [{ ...n("m", "C4"), onset: q(1, 3), duration: q(1, 3) }],
      {
        rests: [
          { id: "r", partId: "p", voiceId: "v", onset: q(1), duration: q(1) },
        ],
      },
    );
    expect(
      arrange(score, {
        instrument: concertUkulele(),
        mode: "adaptive",
        player: { level: "baby", overrides: { rhythmGrid: q(1) } },
        adaptation: { allowRhythmSimplification: true },
        search: exact,
      }).status,
    ).toBe("infeasible");
  });
  it("counts sustained notes and the one-second attack window exactly at every frame", () => {
    // Listed out of onset order, with a note held across later attacks; at 120 BPM a quarter is half a second.
    const instrument = concertUkulele(),
      score = createScore([n("c", "E4", 4, 1), n("held", "C4", 0, 4), n("b", "G4", 2, 1), n("a", "A4", 1, 1)]),
      r = successful(arrange(score, { instrument, search: exact })),
      check = (overrides: PlayerOptions["overrides"]) =>
        validateFrettedArrangement(r.score, instrument, r.annotations, { overrides }).diagnostics;
    // Two notes sound from beat 1 to 4, never three.
    expect(check({ maxPolyphony: 2 })).toEqual([]);
    expect(check({ maxPolyphony: 1 })).toContain("Polyphony/voice limit");
    // Attacks at 0, 0.5, 1, 2 s: the window ending at 1 s holds 0.5 and 1 s, not the attack exactly a second before.
    expect(check({ maxAttacksPerSecond: 2 })).toEqual([]);
    expect(check({ maxAttacksPerSecond: 1 })).toContain("Attack density limit");
    // Unordered frames are still replayed note by note, and reported.
    const swapped = [r.annotations[1]!, r.annotations[0]!, ...r.annotations.slice(2)];
    expect(validateFrettedArrangement(r.score, instrument, swapped).diagnostics).toContain("Annotations must be strictly ordered");
  });
  it("limits notes picked together per bar by difficulty, never one note at a time, and no strum", () => {
    expect(levels.map((level) => compilePlayer({ level }).maxPickedPerBar)).toEqual([2, 3, 4, 6, 8, undefined, undefined]);
    // Bar 1 picks four notes one at a time; bar 2 a two-note chord, then one more note.
    const instrument = concertUkulele(),
      melody = { role: "melody" } as const,
      harmony = { role: "harmony" } as const,
      score = createScore([
        n("a", "C4", 0, 1, melody), n("b", "E4", 1, 1, harmony), n("c", "G4", 2, 1, melody), n("d", "A4", 3, 1, harmony),
        n("e", "C4", 4, 2, melody), n("f", "E4", 4, 2, harmony), n("g", "G4", 6, 2, melody),
      ]),
      r = successful(arrange(score, { instrument, search: exact })),
      check = (overrides: PlayerOptions["overrides"]) =>
        validateFrettedArrangement(r.score, instrument, r.annotations, { overrides }).diagnostics;
    expect(r.difficulty.maxPickedInOneBar).toBe(4);
    // Four single notes pass any limit; bar 2's three notes, two of them together, need a limit of three.
    expect(check({ maxPickedPerBar: 3 })).toEqual([]);
    expect(check({ maxPickedPerBar: 2 })).toContain("Picked notes per bar limit");
    // Exact mode cannot meet two; adaptive mode leaves out the doubled harmony note and keeps every moment of bar 1.
    const two = { overrides: { maxPickedPerBar: 2 } };
    expect(arrange(score, { instrument, player: two, search: exact }).status).toBe("infeasible");
    const fewer = successful(arrange(score, { instrument, mode: "adaptive", player: two, adaptation: { allowAccompanimentOmission: true }, search: exact }));
    expect(fewer.score.notes.map((x) => x.id).sort()).toEqual(["a", "b", "c", "d", "e", "g"]);
    expect(validateFrettedArrangement(fewer.score, instrument, fewer.annotations, two).valid).toBe(true);
    // Strummed, a bar of chords counts nothing against the picking limit.
    const chords = createScore([n("x", "C4", 0, 2), n("y", "E4", 0, 2), n("z", "G4", 0, 2), n("u", "C4", 2, 2), n("v", "E4", 2, 2), n("w", "G4", 2, 2)]),
      strum = { overrides: { rightHand: "strum", maxPickedPerBar: 1 } } as const;
    const strummed = successful(arrange(chords, { instrument, player: strum, search: exact }));
    expect(strummed.difficulty.maxPickedInOneBar).toBe(0);
    expect(validateFrettedArrangement(strummed.score, instrument, strummed.annotations, strum).valid).toBe(true);
  });
  it("thins notes that start together before it empties a moment of the tune", () => {
    // At 120 BPM, two attacks a second: beat 1 starts a melody and a harmony note, beat 2 a lone harmony note. One
    // must go; the weak-beat note would cost less, but leaving out beat 1's harmony note keeps both moments.
    const instrument = concertUkulele(),
      score = createScore([n("m", "C4", 0, 1, { role: "melody" }), n("h", "E4", 0, 1, { role: "harmony" }), n("w", "G4", 1, 1, { role: "harmony" })]),
      r = successful(arrange(score, { instrument, mode: "adaptive", player: { overrides: { maxAttacksPerSecond: 2 } }, adaptation: { allowAccompanimentOmission: true }, search: exact }));
    expect(r.score.notes.map((x) => x.id).sort()).toEqual(["m", "w"]);
  });
  it("grid membership is exact at large rational coordinates", () => {
    expect(isMultipleQ(q(7, 3), q(1, 3))).toBe(true);
    expect(isMultipleQ(q(7, 3), q(1, 2))).toBe(false);
  });
  it("keeps capability hard limits independent from the scoring hook", () => {
    const instrument = createFrettedInstrument("pair", "pair", ["C3", "C5"], {
        fretCount: 4,
      }),
      score = createScore([n("a", "C#3"), n("b", "E5")]);
    expect(
      arrange(score, {
        instrument,
        player: { overrides: { maxFretSpan: 0 } },
        search: exact,
        scoring: { id: "zero", cost: () => 0 },
      }).status,
    ).toBe("infeasible");
    expect(
      arrange(createScore([n("a", "C4")]), {
        instrument: concertUkulele(),
        scoring: { id: "bad", cost: () => -1 },
      }).status,
    ).toBe("invalid-input");
  });
  it("finger-pair geometry caps are enforced", () => {
    const instrument = {
      ...createFrettedInstrument("pair", "pair", ["C3", "C5"], {
        fretCount: 4,
      }),
      scaleLengthMm: 650,
      stringSpacingMm: 10,
    };
    const score = createScore([n("a", "C#3"), n("b", "E5")]);
    const limits = {
      "1-2": 1,
      "1-3": 1,
      "1-4": 1,
      "2-3": 1,
      "2-4": 1,
      "3-4": 1,
    } as const;
    expect(
      arrange(score, {
        instrument,
        player: { overrides: { fingerPairMaxMm: limits } },
        search: exact,
      }).status,
    ).toBe("infeasible");
  });
  it("reports best-found whenever candidate/beam pruning occurs", () => {
    const r = successful(
      arrange(createScore([n("a", "E4")]), {
        instrument: concertUkulele(),
        search: { beamWidth: 1, maxCandidatesPerFrame: 1 },
      }),
    );
    expect(r.stats.exhaustive).toBe(false);
    expect(r.optimality).toBe("best-found");
  });
  it("default data model is usable by a non-string adapter", () => {
    const adapter: InstrumentAdapter<
      null,
      { ids: string[] },
      { at: readonly [number, number]; keys: string[] }
    > = {
      kind: "test-keys",
      version: "test-keys-1",
      initialState: () => null,
      *enumerate(frame) {
        yield { ids: frame.active.map((n) => n.id) };
      },
      validateState: () => [],
      transition: () => ({
        valid: true,
        state: null,
        cost: 0,
        shift: 0,
        diagnostics: [],
      }),
      describe: (r, frame) => ({ at: frame.at, keys: r.ids }),
      stateKey: (_s, r) => JSON.stringify(r),
      ergonomicCost: () => 0,
    };
    const r = arrangeWithAdapter(
      createScore([n("a", "C4")]),
      { search: exact },
      adapter,
    );
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.annotations[0]!.keys).toEqual(["a"]);
      expect(r.difficulty.maxFretSpan).toBeNull();
    }
  });
  it("cross-checks dozens of tiny cases against exhaustive search and output replay", () => {
    const instrument = createFrettedInstrument("pair", "pair", ["C4", "D4"], {
      fretCount: 2,
    });
    for (const first of ["C4", "C#4", "D4", "D#4", "E4"])
      for (const second of ["C4", "D4", "E4"]) {
        const score = createScore([n("a", first), n("b", second, 2)]);
        const a = arrange(score, { instrument, search: exact }),
          b = arrange(score, {
            instrument,
            search: { ...exact, strategy: "exhaustive" },
          });
        expect(a.status).toBe(b.status);
        if (a.status === "success" && b.status === "success") {
          expect(a.cost.total).toBeCloseTo(b.cost.total, 12);
          expect(
            validateFrettedArrangement(a.score, instrument, a.annotations)
              .valid,
          ).toBe(true);
        }
      }
  });
});

it("maestro prioritizes fidelity over accumulated ergonomic cost on long notes", () => {
  const instrument = createFrettedInstrument("one", "one", ["C4"], {
    fretCount: 2,
  });
  const score = createScore([n("h", "D4", 0, 100, { role: "harmony" })]);
  const result = successful(
    arrange(score, {
      instrument,
      mode: "adaptive",
      player: { level: "maestro" },
      adaptation: { allowAccompanimentOmission: true },
      search: exact,
    }),
  );
  expect(result.score.notes).toHaveLength(1);
  expect(result.cost.musicalLoss).toBe(0);
});
it("a short articulation gate is not treated as a short notated rhythm", () => {
  const result = successful(
    arrange(createScore([n("m", "C4", 0, 1, { gateDuration: q(1, 4) })]), {
      instrument: concertUkulele(),
      player: { level: "baby" },
      search: exact,
    }),
  );
  expect(result.score.notes[0]!.gateDuration).toEqual(q(1, 4));
});
it("arbitrary valid IDs do not collide with object prototypes", () => {
  const result = successful(
    arrange(createScore([n("__proto__", "C4")]), {
      instrument: concertUkulele(),
      search: exact,
    }),
  );
  expect(result.sourceMap["__proto__"]).toEqual(["__proto__"]);
  expect(JSON.parse(JSON.stringify(result)).sourceMap["__proto__"]).toEqual([
    "__proto__",
  ]);
});
