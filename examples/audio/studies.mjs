// Original test studies, CC0. No third-party song or audio samples.
import {
  arrange,
  createScore,
  parsePitch,
  q,
  concertUkulele,
  classicalGuitar,
} from "../../dist/index.mjs";
import { createPerformance } from "../../dist/performance.mjs";
export function study(instrumentName = "ukulele", humanize = 0.65) {
  const guitar = instrumentName === "guitar",
    instrument = guitar
      ? classicalGuitar({ fretCount: 7 })
      : concertUkulele({ fretCount: 7 });
  const chords = guitar
    ? [
        ["E2", "B2", "E3", "G3", "B3", "E4"],
        ["E2", "A2", "E3", "A3", "B3", "E4"],
        ["G2", "B2", "D3", "G3", "B3", "G4"],
        ["E2", "C3", "E3", "G3", "C4", "E4"],
      ]
    : [
        ["G4", "C4", "E4", "C5"],
        ["A4", "C4", "F4", "A4"],
        ["G4", "D4", "G4", "B4"],
        ["G4", "C4", "E4", "C5"],
      ];
  const notes = chords.flatMap((chord, i) =>
    chord.map((pitch, j) => ({
      id: `chord-${i}-note-${j}`,
      pitch: parsePitch(pitch),
      onset: q(i * 2),
      duration: q(1),
      partId: "study",
      voiceId: "chords",
      role: "harmony",
    })),
  );
  const score = createScore(notes, {
      tempoMap: [{ at: q(0), quarterBpm: 108 }],
    }),
    result = arrange(score, {
      instrument,
      player: { level: "maestro" },
      search: {
        beamWidth: 32,
        maxCandidatesPerFrame: 64,
        maxExpandedStates: 500000,
      },
    });
  if (result.status !== "success") throw new Error(JSON.stringify(result));
  const performed = createPerformance(result, instrument, {
    seed: "scorify-02-study",
    humanize,
    strokes: chords.map((_, i) => ({
      id: `stroke-${i}`,
      at: q(i * 2),
      direction: i % 2 ? "up" : "down",
      spreadSeconds: guitar ? 0.05 : 0.035,
    })),
  });
  if (performed.status !== "success")
    throw new Error(JSON.stringify(performed));
  return performed.performance;
}
