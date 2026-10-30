import { describe, it, expect } from "vitest";
import {
  arrange,
  createScore,
  parsePitch,
  q,
  concertUkulele,
  classicalGuitar,
  createFrettedInstrument,
  realizeFrettedAssignments,
} from "../src/index.js";
import {
  createPerformance,
  validatePerformance,
  expandStrumPattern,
  metricWeight,
  strumSweepSeconds,
} from "../src/performance.js";
import type {
  ArrangementSuccess,
  NoteEvent,
  FrettedInstrument,
} from "../src/index.js";
import type {
  PerformancePlan,
  PerformanceOptions,
} from "../src/performance.js";
const note = (
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
function result(
  notes: readonly NoteEvent[],
  instrument: FrettedInstrument = concertUkulele({ fretCount: 0 }),
  options: Parameters<typeof arrange>[1] = {},
): ArrangementSuccess {
  const r = arrange(createScore(notes), {
    instrument,
    search: { strategy: "exact", maxExpandedStates: 1000000 },
    ...options,
  });
  expect(r.status, JSON.stringify(r)).toBe("success");
  if (r.status !== "success") throw new Error(r.status);
  return r;
}
function plan(
  r: ArrangementSuccess,
  instrument: FrettedInstrument,
  options: PerformanceOptions = {},
): PerformancePlan {
  const p = createPerformance(r, instrument, options);
  expect(p.status, JSON.stringify(p)).toBe("success");
  if (p.status !== "success") throw new Error(p.status);
  return p.performance;
}
const uke = concertUkulele({ fretCount: 0 });
const chord = (prefix = "a", onset = 0) =>
  ["G4", "C4", "E4", "A4"].map((pitch, i) => note(prefix + i, pitch, onset, 1));
describe("performance and humanization", () => {
  it("plays a fingering at another tempo when its time limits are lifted, and says so", () => {
    // Eight open-string attacks searched at 120 BPM (2 a second), then played eight times faster (16 a second).
    const r = result(["G4", "C4", "E4", "A4", "G4", "C4", "E4", "A4"].map((pitch, i) => note(`n${i}`, pitch, i, 1)), uke, { player: { level: "beginner" } });
    const fast = { ...r, score: { ...r.score, tempoMap: r.score.tempoMap.map((t) => ({ ...t, quarterBpm: t.quarterBpm * 8 })) } };
    const checked = createPerformance(fast, uke, { humanize: 0 });
    expect(checked.status).not.toBe("success");
    const lifted = plan(fast, uke, { humanize: 0, timeLimits: false });
    expect(lifted.timeLimits).toBe("lifted");
    expect(lifted.diagnostics.join(" ")).toMatch(/Time-based player limits .* were not checked/);
    expect(lifted.profile).toEqual(r.profile);
    // Fretted notes on an instrument without a scale length play too: no millimetre limit is added where the player
    // had none.
    const fretted = concertUkulele(),
      unmeasured = { ...fretted, scaleLengthMm: undefined } as unknown as FrettedInstrument,
      moving = result(["D4", "F4", "B4", "D5", "F4", "B4"].map((pitch, i) => note(`m${i}`, pitch, i, 1)), unmeasured, { player: { level: "beginner" } });
    expect(plan(moving, unmeasured, { humanize: 0, timeLimits: false }).timeLimits).toBe("lifted");
    expect(validatePerformance(lifted).valid).toBe(true);
    // The plan's own record decides how it is validated again; the fingering is still checked.
    expect(validatePerformance({ ...lifted, timeLimits: undefined } as unknown as PerformancePlan).valid).toBe(false);
    const moved = { ...lifted, events: lifted.events.map((e, i) => (i ? e : { ...e, assignment: { ...e.assignment, fret: e.assignment.fret + 1 } })) };
    expect(validatePerformance(moved as PerformancePlan).valid).toBe(false);
    // At its own tempo the plan is the same either way, apart from the record.
    const own = plan(r, uke, { humanize: 0, timeLimits: false }), strict = plan(r, uke, { humanize: 0 });
    expect(own.events).toEqual(strict.events);
    expect(() => createPerformance(r, uke, { timeLimits: "no" as unknown as boolean })).not.toThrow();
    expect(createPerformance(r, uke, { timeLimits: "no" as unknown as boolean }).status).toBe("invalid-input");
  });
  it("uses physical order for down/up strums on reentrant ukulele", () => {
    const r = result(chord());
    const down = plan(r, uke, {
        humanize: 0,
        strum: { direction: "down", spreadSeconds: 0.06 },
      }),
      up = plan(r, uke, {
        humanize: 0,
        strum: { direction: "up", spreadSeconds: 0.06 },
      });
    expect(down.events.map((e) => e.stringId)).toEqual([
      "s4",
      "s3",
      "s2",
      "s1",
    ]);
    expect(up.events.map((e) => e.stringId)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(
      down.events.at(-1)!.onsetSeconds - down.events[0]!.onsetSeconds,
    ).toBeCloseTo(0.06);
  });
  it("preserves duration, notes, tuning, and original data", () => {
    const r = result(chord()),
      before = JSON.stringify(r),
      p = plan(r, uke, { seed: "x", humanize: 1 });
    for (const e of p.events) {
      expect(e.endSeconds - e.onsetSeconds).toBeCloseTo(
        e.nominalEndSeconds - e.nominalOnsetSeconds,
        12,
      );
      expect(Math.abs(e.offsetSeconds)).toBeLessThan(0.06);
    }
    expect(JSON.stringify(r)).toBe(before);
    expect(validatePerformance(p).valid).toBe(true);
  });
  it("is deterministic for a seed; changes timing and timbre with a different seed", () => {
    const r = result(chord()),
      a = plan(r, uke, { seed: "a" }),
      b = plan(r, uke, { seed: "b" });
    expect(plan(r, uke, { seed: "a" })).toEqual(a);
    expect(a.events.map((e) => e.excitationSeed)).not.toEqual(
      b.events.map((e) => e.excitationSeed),
    );
    expect(a.events.map((e) => e.velocity)).not.toEqual(
      b.events.map((e) => e.velocity),
    );
  });
  it("keeps event-identity variations stable when unrelated notes are removed", () => {
    const r = result([...chord(), note("later", "C4", 3)]),
      short = result(chord());
    const a = plan(r, uke, { seed: "x" }),
      b = plan(short, uke, { seed: "x" });
    expect(a.events.filter((e) => e.id !== "later")).toEqual(b.events);
  });
  it("humanize=0 disables expressive variations but retains fresh deterministic excitations", () => {
    const r = result([note("a", "C4"), note("b", "C4", 2)]),
      p = plan(r, uke, { humanize: 0, strum: false });
    expect(p.events.map((e) => e.offsetSeconds)).toEqual([0, 0]);
    expect(p.events[0]!.velocity).toBe(p.events[1]!.velocity);
    expect(p.events[0]!.excitationSeed).not.toBe(p.events[1]!.excitationSeed);
  });
  it("does not accumulate random onset drift and retains stroke order at maximum variation", () => {
    const notes = Array.from({ length: 12 }, (_, i) =>
        chord("g" + i, 2 * i),
      ).flat(),
      r = result(notes),
      p = plan(r, uke, {
        humanize: { amount: 1, timingMs: 50, stringTimingMs: 20 },
        strum: { spreadSeconds: 0.003 },
      });
    for (const e of p.events)
      expect(Math.abs(e.offsetSeconds)).toBeLessThan(0.055);
    for (const s of p.strokes) {
      const events = s.noteIds.map((id) => p.events.find((e) => e.id === id)!);
      expect(events.map((e) => e.onsetSeconds)).toEqual(
        events.map((e) => e.onsetSeconds).sort((a, b) => a - b),
      );
    }
  });
  it("reduces unsafe jitter instead of allowing repeated notes to overlap", () => {
    const r = result([note("a", "C4"), note("b", "C4", 1), note("c", "C4", 2)]);
    let found = false;
    for (let i = 0; i < 10; i++) {
      const p = plan(r, uke, { seed: i, humanize: 1, strum: false });
      if (p.humanization.timingScale < 1) {
        found = true;
        expect(p.diagnostics.length).toBeGreaterThan(0);
      }
      expect(validatePerformance(p).valid).toBe(true);
    }
    expect(found).toBe(true);
  });
  it("strict mode reports unsafe requested timings without claiming global infeasibility", () => {
    const r = result([note("a", "C4"), note("b", "C4", 1), note("c", "C4", 2)]);
    const statuses = Array.from(
      { length: 10 },
      (_, seed) =>
        createPerformance(r, uke, {
          seed,
          humanize: 1,
          strum: false,
          timingPolicy: "strict",
        }).status,
    );
    expect(statuses).toContain("unplayable");
  });
  it("rejects strums that make actual note durations overlap on a string", () => {
    const r = result([...chord("a", 0), ...chord("b", 1)]);
    const p = createPerformance(r, uke, {
      humanize: 0,
      strokes: [
        { id: "down", at: q(0), direction: "down", spreadSeconds: 0.1 },
        { id: "up", at: q(1), direction: "up", spreadSeconds: 0.1 },
      ],
    });
    expect(p.status).toBe("unplayable");
  });
  it("locks exact onsets and preserves ties as a single excitation", () => {
    const r = result([
        note("a", "C4", 0, 1, { locked: { onset: true }, tieGroupId: "t" }),
        note("b", "C4", 1, 1, { tieGroupId: "t" }),
      ]),
      p = plan(r, uke, { humanize: 1 });
    expect(p.events).toHaveLength(1);
    expect(p.events[0]!.noteIds).toEqual(["a", "b"]);
    expect(p.events[0]!.offsetSeconds).toBe(0);
  });
  it("uses integrated tempo maps and concert tuning", () => {
    const r = result([note("a", "C4", 3)], uke);
    const source = createScore(r.score.notes, {
      tempoMap: [
        { at: q(0), quarterBpm: 60 },
        { at: q(2), quarterBpm: 120 },
      ],
      concertAHz: 432,
    });
    const a = arrange(source, { instrument: uke });
    if (a.status !== "success") throw new Error(a.status);
    const p = plan(a, uke, { humanize: 0 });
    expect(p.events[0]!.nominalOnsetSeconds).toBeCloseTo(2.5 + 0.06);
    expect(p.events[0]!.frequency).toBeCloseTo(432 * 2 ** (-9 / 12));
  });
  it("supports partial sweeps without silently deleting other score notes", () => {
    const r = result(chord()),
      p = plan(r, uke, { humanize: 0, strum: { stringIds: ["s2", "s1"] } });
    expect(p.strokes[0]!.noteIds).toHaveLength(2);
    expect(p.events).toHaveLength(4);
    expect(p.events.filter((e) => e.strokeId === null)).toHaveLength(2);
  });
  it("validates silent intermediate-string muting and blocks held-string crossing", () => {
    const instrument = createFrettedInstrument(
      "three",
      "three",
      ["C3", "E3", "G3"],
      { fretCount: 0 },
    );
    const r = result([note("a", "C3"), note("b", "G3")], instrument);
    expect(createPerformance(r, instrument, { humanize: 0 }).status).toBe(
      "unplayable",
    );
    const allowed = result([note("a", "C3"), note("b", "G3")], instrument, {
      player: { overrides: { allowMutedStrum: true } },
    });
    expect(createPerformance(allowed, instrument, { humanize: 0 }).status).toBe(
      "success",
    );
    const held = result(
      [note("held", "E3", 0, 3), note("a", "C3", 1), note("b", "G3", 1)],
      instrument,
      { player: { overrides: { allowMutedStrum: true } } },
    );
    expect(createPerformance(held, instrument, { humanize: 0 }).status).toBe(
      "unplayable",
    );
  });
  it("supports explicit muted strokes and per-string/note tone controls", () => {
    const p = plan(result(chord()), uke, {
      humanize: 0,
      strum: { muted: true, velocity: 0.5 },
      stringTone: { s4: { brightness: 0.2 } },
      noteTone: { a1: { velocity: 0.3 } },
    });
    expect(p.events.every((e) => e.muted)).toBe(true);
    expect(p.events.find((e) => e.stringId === "s4")!.brightness).toBe(0.2);
    expect(p.events.find((e) => e.id === "a1")!.velocity).toBe(0.15);
  });
  it("rejects tampered actual timing, pitch and provenance", () => {
    const p = plan(result(chord()), uke, { humanize: 0 });
    for (const change of [
      { frequency: 42 },
      { endSeconds: 9 },
      { noteIds: ["fake"] },
      { stringId: "unknown" },
      { nominalOnsetSeconds: NaN },
      { offsetSeconds: Infinity },
      { excitationSeed: 0 },
      { strokeId: "missing" },
    ]) {
      const copy = JSON.parse(JSON.stringify(p));
      Object.assign(copy.events[0], change);
      expect(validatePerformance(copy).valid).toBe(false);
    }
  });
  it("rejects malformed stroke metadata", () => {
    const p = plan(result(chord()), uke, { humanize: 0 });
    for (const change of [
      { direction: "sideways" },
      { spreadSeconds: NaN },
      { curve: 0 },
      { at: q(2) },
      { noteIds: ["a0", "a0"] },
    ]) {
      const copy = JSON.parse(JSON.stringify(p));
      Object.assign(copy.strokes[0], change);
      expect(validatePerformance(copy).valid).toBe(false);
    }
  });
  it("replays actual finger travel when jitter consumes a release gap", () => {
    const instrument = createFrettedInstrument("mono", "mono", ["C3"], {
      fretCount: 5,
    });
    const source = createScore(
      [note("a", "C#3"), note("b", "F3", 0, 1, { onset: q(6, 5) })],
      { tempoMap: [{ at: q(0), quarterBpm: 60 }] },
    );
    const arranged = arrange(source, {
      instrument,
      player: { overrides: { maxShiftFretsPerSecond: 20 } },
      search: { strategy: "exact" },
    });
    if (arranged.status !== "success") throw new Error(arranged.status);
    // Pin a nominally valid same-finger transition: four frets in 200 ms.
    const pinned = {
      ...arranged,
      annotations: arranged.annotations.map((a) => ({
        ...a,
        ...realizeFrettedAssignments(
          a.assignments.map((x) => ({ ...x, finger: 1 as const })),
          instrument,
          a.contacts.map((c) => ({ ...c, finger: 1 as const })),
        ),
      })),
    };
    const strict = createPerformance(pinned, instrument, {
      strum: false,
      seed: 1,
      humanize: { amount: 1, timingMs: 50, stringTimingMs: 0 },
      timingPolicy: "strict",
    });
    expect(strict.status).toBe("unplayable");
    if (strict.status === "success") throw new Error("Expected travel failure");
    expect(strict.diagnostics).toContain(
      "Insufficient released-finger movement time",
    );
    const safe = plan(pinned, instrument, {
      strum: false,
      seed: 1,
      humanize: { amount: 1, timingMs: 50, stringTimingMs: 0 },
    });
    expect(safe.humanization.timingScale).toBe(0);
    expect(validatePerformance(safe).valid).toBe(true);
  });
  it("retains notated duration and trailing rests independently of gates", () => {
    const score = createScore([note("a", "C4", 0, 2, { gateDuration: q(1) })], {
      tempoMap: [{ at: q(0), quarterBpm: 60 }],
      rests: [
        { id: "rest", onset: q(2), duration: q(2), partId: "p", voiceId: "v" },
      ],
    });
    const r = arrange(score, { instrument: uke });
    if (r.status !== "success") throw new Error(r.status);
    const p = plan(r, uke, { humanize: 0, strum: false });
    expect(p.events[0]!.endSeconds).toBeCloseTo(1.06);
    expect(p.durationSeconds).toBeCloseTo(4.06);
    expect(validatePerformance({ ...p, durationSeconds: 1.1 }).valid).toBe(
      false,
    );
  });
  it("supports guitar and custom tuning/capo configurations", () => {
    const instrument = classicalGuitar({ capoFret: 2, fretCount: 2 }),
      r = result(
        ["F#2", "B2", "E3", "A3", "C#4", "F#4"].map((p, i) =>
          note(String(i), p),
        ),
        instrument,
      ),
      p = plan(r, instrument, { humanize: 0 });
    expect(p.events).toHaveLength(6);
    expect(p.preset.id).toContain("guitar");
    expect(p.events.every((e) => e.assignment.relativeFret === 0)).toBe(true);
  });
  it("expands explicit up/down rhythmic patterns with exact rational time", () => {
    const strokes = expandStrumPattern(
      {
        id: "pattern",
        length: q(4),
        strokes: [
          { offset: q(0), direction: "down" },
          { offset: q(3, 2), direction: "up" },
        ],
      },
      2,
      q(1),
    );
    expect(strokes.map((s) => s.at)).toEqual([q(1), q(5, 2), q(5), q(13, 2)]);
    expect(new Set(strokes.map((s) => s.id)).size).toBe(4);
  });
  it("rejects invalid options, unknown stroke times and hidden note omissions", () => {
    const r = result(chord());
    for (const options of [
      { humanize: 2 },
      { seed: Infinity },
      { strum: { spreadSeconds: -1 } },
      { noteTone: { missing: { velocity: 0.2 } } },
      { strokes: [{ id: "s", at: q(5) }] },
      { strum: { stringIds: ["bad"] } },
    ] as PerformanceOptions[])
      expect(createPerformance(r, uke, options).status).toBe("invalid-input");
  });
  it("centers a strum on the beat: early strings before it, late strings after it", () => {
    const r = result(chord()),
      centered = plan(r, uke, { humanize: 0, strum: { spreadSeconds: 0.06 } }),
      leading = plan(r, uke, {
        humanize: 0,
        strum: { spreadSeconds: 0.06, anchor: 0 },
      });
    const offsets = (p: PerformancePlan) =>
      p.events.map((e) => Number(e.offsetSeconds.toFixed(9)));
    expect(offsets(centered)).toEqual([-0.03, -0.01, 0.01, 0.03]);
    expect(offsets(leading)).toEqual([0, 0.02, 0.04, 0.06]);
    expect(centered.strokes[0]!.anchor).toBe(0.5);
    expect(validatePerformance(centered).valid).toBe(true);
    // The early strings need the lead-in; without one the strum cannot start on time.
    expect(
      createPerformance(r, uke, {
        humanize: 0,
        leadInSeconds: 0,
        strum: { spreadSeconds: 0.06 },
      }).status,
    ).toBe("invalid-input");
    const tampered = JSON.parse(JSON.stringify(centered));
    tampered.strokes[0].anchor = 0;
    expect(validatePerformance(tampered).valid).toBe(false);
  });
  it("strums faster at faster tempos, quicker up and over fewer strings", () => {
    const sweep = (bpm: number, strum: PerformanceOptions["strum"] = {}) => {
      const a = arrange(
        createScore(chord(), { tempoMap: [{ at: q(0), quarterBpm: bpm }] }),
        { instrument: uke, search: { strategy: "exact" } },
      );
      if (a.status !== "success") throw new Error(a.status);
      return plan(a, uke, { humanize: 0, strum }).strokes[0]!.spreadSeconds;
    };
    expect(sweep(60)).toBeCloseTo(0.05);
    expect(sweep(180)).toBeCloseTo(0.05 / 3);
    expect(sweep(240)).toBeCloseTo(0.0125);
    expect(sweep(30)).toBeCloseTo(0.06);
    expect(sweep(120, { direction: "up" })).toBeCloseTo(sweep(120) * 0.8);
    expect(sweep(120, { stringIds: ["s2", "s1"] })).toBeCloseTo(sweep(120) / 3);
    expect(strumSweepSeconds(0.5, "down", 5, 6)).toBeCloseTo(0.025);
    expect(strumSweepSeconds(0.5, "down", 0, 6)).toBe(0);
  });
  it("strikes the first string of a strum hardest, keeps the melody on top and plays harder notes brighter", () => {
    const exact = { amount: 1, velocity: 0, brightness: 0 };
    const order = (p: PerformancePlan) =>
      p.strokes[0]!.noteIds.map((id) => p.events.find((e) => e.id === id)!);
    for (const direction of ["down", "up"] as const) {
      const swept = order(
        plan(result(chord()), uke, { humanize: exact, strum: { direction } }),
      );
      const velocities = swept.map((e) => e.velocity);
      expect(velocities).toEqual([...velocities].sort((a, b) => b - a));
      expect(new Set(velocities).size).toBe(4);
      expect(swept.map((e) => e.brightness)).toEqual(
        [...swept.map((e) => e.brightness)].sort((a, b) => b - a),
      );
    }
    const down = order(plan(result(chord()), uke, { humanize: exact })),
      up = order(
        plan(result(chord()), uke, { humanize: exact, strum: { direction: "up" } }),
      );
    expect(up[0]!.velocity).toBeLessThan(down[0]!.velocity);
    const melody = chord().map((n) =>
        n.id === "a1" ? { ...n, role: "melody" as const } : n,
      ),
      sung = order(plan(result(melody), uke, { humanize: exact }));
    expect(Math.max(...sung.map((e) => e.velocity))).toBe(
      sung.find((e) => e.id === "a1")!.velocity,
    );
    // No humanization: every string of the strum at the same velocity.
    const flat = order(plan(result(chord()), uke, { humanize: 0 }));
    expect(new Set(flat.map((e) => e.velocity)).size).toBe(1);
  });
  it("accents strong beats and the melody and thumb in picked notes", () => {
    const four = [{ at: q(0), numerator: 4, denominator: 4 }],
      six = [{ at: q(0), numerator: 6, denominator: 8 }],
      pickup = [
        { at: q(0), numerator: 1, denominator: 4 },
        { at: q(1), numerator: 3, denominator: 4 },
      ];
    expect(
      [q(0), q(2), q(1), q(1, 2), q(1, 4), q(4)].map((t) => metricWeight(t, four)),
    ).toEqual([1, 0.6, 0.3, -0.3, -0.6, 1]);
    expect(
      [q(0), q(3, 2), q(1, 2), q(1, 4)].map((t) => metricWeight(t, six)),
    ).toEqual([1, 0.3, -0.3, -0.6]);
    expect([q(0), q(1), q(2)].map((t) => metricWeight(t, pickup))).toEqual([
      0.3, 1, 0.3,
    ]);
    const exact = { humanize: { amount: 1, velocity: 0 }, strum: false } as const;
    const line = plan(
        result(
          [0, 1, 2, 4].map((eighths, i) =>
            note("n" + i, "C4", 0, 1, { onset: q(eighths, 2), duration: q(1, 2) }),
          ),
        ),
        uke,
        exact,
      ),
      at = (id: string) => line.events.find((e) => e.id === id)!.velocity;
    expect(at("n0")).toBeGreaterThan(at("n3"));
    expect(at("n3")).toBeGreaterThan(at("n2"));
    expect(at("n2")).toBeGreaterThan(at("n1"));
    const roles = plan(
        result([
          note("m", "A4", 0, 1, { role: "melody" }),
          note("i", "E4", 0, 1, { role: "harmony" }),
          note("b", "C4", 0, 1, { role: "bass" }),
        ]),
        uke,
        exact,
      ),
      role = (id: string) => roles.events.find((e) => e.id === id)!.velocity;
    expect(role("m")).toBeGreaterThan(role("b"));
    expect(role("b")).toBeGreaterThan(role("i"));
  });
  it("drifts each string's pitch slowly, always within a cent, and keeps the written frequency", () => {
    const notes = Array.from({ length: 120 }, (_, i) =>
        note("d" + i, i % 2 ? "E4" : "C4", i, 1),
      ),
      p = plan(result(notes), uke, { seed: "drift", humanize: 1, strum: false });
    const detunes = p.events.map((e) => e.detuneCents);
    expect(Math.max(...detunes.map(Math.abs))).toBeLessThanOrEqual(0.5);
    expect(Math.max(...detunes) - Math.min(...detunes)).toBeGreaterThan(0.2);
    for (const stringId of ["s2", "s3"]) {
      const own = p.events.filter((e) => e.stringId === stringId);
      for (let i = 1; i < own.length; i++)
        expect(Math.abs(own[i]!.detuneCents - own[i - 1]!.detuneCents)).toBeLessThan(0.3);
    }
    expect(p.events.find((e) => e.id === "d0")!.frequency).toBeCloseTo(
      440 * 2 ** (-9 / 12),
      9,
    );
    expect(validatePerformance(p).valid).toBe(true);
    const still = plan(result(notes), uke, { humanize: 0, strum: false });
    expect(still.events.every((e) => e.detuneCents === 0)).toBe(true);
    for (const detuneCents of [0.51, 1]) {
      const copy = JSON.parse(JSON.stringify(p));
      copy.events[0].detuneCents = detuneCents;
      expect(validatePerformance(copy).valid).toBe(false);
    }
    expect(
      createPerformance(result(notes), uke, { humanize: { driftCents: 1 } }).status,
    ).toBe("invalid-input");
  });
});
