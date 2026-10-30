import { describe, expect, it } from "vitest";
import {
  chordCandidates,
  classicalGuitar,
  concertUkulele,
  createFrettedInstrument,
  enumeratePositions,
  fretDistanceMm,
  pitchToMidi,
  transposePitch,
} from "../src/index.js";

describe("theory boundary", () => {
  it("preserves interval spelling", () => {
    expect(transposePitch("C#4", "3M")).toBe("E#4");
    expect(transposePitch("Eb4", "5P")).toBe("Bb4");
  });
  it("rejects invalid or octave-free input", () => {
    expect(() => pitchToMidi("C")).toThrow();
    expect(() => pitchToMidi("H4")).toThrow();
    expect(() => transposePitch("C4", "garbage")).toThrow();
  });
  it("finds the bass by sounding pitch, not input/string order", () => {
    expect(chordCandidates(["G4", "C4", "E4", "C5"])).toContain("CM");
    expect(chordCandidates(["D4", "A3", "C4", "F#3"])).toContain("D7/F#");
  });
  it("preserves ambiguous harmonic alternatives", () => {
    const candidates = chordCandidates(["E3", "G#3", "B3", "C#4"]);
    expect(candidates).toContain("E6");
    expect(candidates).toContain("C#m7/E");
    expect(chordCandidates([])).toEqual([]);
  });
});

describe("fretted candidates", () => {
  it("preserves high-G physical string order", () => {
    const instrument = concertUkulele();
    expect(instrument.strings.map((s) => s.openPitch)).toEqual([
      "G4",
      "C4",
      "E4",
      "A4",
    ]);
    expect(instrument.strings.map((s) => s.number)).toEqual([4, 3, 2, 1]);
    expect(
      enumeratePositions("G4", instrument).map((p) => [
        p.stringNumber,
        p.absoluteFret,
      ]),
    ).toEqual([
      [4, 0],
      [3, 7],
      [2, 3],
    ]);
  });
  it("low G changes the available register", () => {
    expect(enumeratePositions("G3", concertUkulele())).toEqual([]);
    expect(
      enumeratePositions("G3", concertUkulele({ tuning: "lowG" })),
    ).toEqual([
      {
        stringId: "s4",
        stringNumber: 4,
        absoluteFret: 0,
        relativeFret: 0,
        effectiveOpen: true,
      },
    ]);
  });
  it("supports alternate tuning", () => {
    const dropD = classicalGuitar({
      tuning: ["D2", "A2", "D3", "G3", "B3", "E4"],
    });
    expect(enumeratePositions("D2", dropD)[0]?.stringNumber).toBe(6);
    expect(enumeratePositions("D2", classicalGuitar())).toEqual([]);
  });
  it("distinguishes capo-relative from absolute frets", () => {
    const instrument = classicalGuitar({ capoFret: 2 });
    expect(enumeratePositions("E2", instrument)).toEqual([]);
    expect(enumeratePositions("F#2", instrument)[0]).toEqual({
      stringId: "s6",
      stringNumber: 6,
      absoluteFret: 2,
      relativeFret: 0,
      effectiveOpen: true,
    });
  });
  it("supports per-string capo and fret counts", () => {
    const base = concertUkulele();
    const custom = {
      ...base,
      strings: base.strings.map((s) =>
        s.number === 4 ? { ...s, capoFret: 2, fretCount: 4 } : s,
      ),
    };
    expect(
      enumeratePositions("G4", custom).every((p) => p.stringNumber !== 4),
    ).toBe(true);
    expect(
      enumeratePositions("A4", custom).find((p) => p.stringNumber === 4)
        ?.effectiveOpen,
    ).toBe(true);
  });
  it("respects exact fret limits", () => {
    const one = createFrettedInstrument("one", "One string", ["C4"], {
      fretCount: 3,
    });
    expect(enumeratePositions("Eb4", one)).toHaveLength(1);
    expect(enumeratePositions("E4", one)).toEqual([]);
  });
  it("does not mutate inputs or share mutable preset instances", () => {
    const a = concertUkulele();
    const snapshot = JSON.stringify(a);
    enumeratePositions("C5", a);
    expect(JSON.stringify(a)).toBe(snapshot);
    expect(concertUkulele().strings).not.toBe(a.strings);
  });
  it("rejects malformed instruments", () => {
    expect(() => createFrettedInstrument("x", "x", [])).toThrow();
    expect(() => concertUkulele({ fretCount: -1 })).toThrow();
    expect(() => concertUkulele({ fretCount: 2, capoFret: 3 })).toThrow();
    // Runtime validation matters for vanilla JavaScript callers too.
    expect(() => concertUkulele({ tuning: "invalid" as "highG" })).toThrow();
    const base = concertUkulele();
    expect(() =>
      enumeratePositions("C4", {
        ...base,
        strings: [base.strings[0]!, base.strings[0]!],
      }),
    ).toThrow();
  });
  it("every enumerated position produces the requested pitch", () => {
    for (const instrument of [
      concertUkulele(),
      concertUkulele({ tuning: "lowG" }),
      classicalGuitar(),
    ]) {
      for (const pitch of ["C3", "G3", "C4", "F#4", "A4", "C5", "G5"]) {
        for (const position of enumeratePositions(pitch, instrument)) {
          const string = instrument.strings.find(
            (s) => s.id === position.stringId,
          )!;
          expect(pitchToMidi(string.openPitch) + position.absoluteFret).toBe(
            pitchToMidi(pitch),
          );
        }
      }
    }
  });
});

describe("geometry", () => {
  it("uses physical distance and shrinking fret spacing", () => {
    expect(fretDistanceMm(650, 0)).toBe(0);
    expect(fretDistanceMm(650, 12)).toBe(325);
    const first = fretDistanceMm(650, 1);
    const thirteenth = fretDistanceMm(650, 13) - fretDistanceMm(650, 12);
    expect(thirteenth).toBeCloseTo(first / 2);
    expect(fretDistanceMm(380, 4)).toBeLessThan(fretDistanceMm(650, 4));
  });
  it("rejects invalid geometry", () => {
    expect(() => fretDistanceMm(0, 1)).toThrow();
    expect(() => fretDistanceMm(650, 1.5)).toThrow();
  });
});
