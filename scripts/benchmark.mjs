import { performance } from "node:perf_hooks";
import {
  arrange,
  createScore,
  parsePitch,
  q,
  concertUkulele,
  classicalGuitar,
  validateFrettedArrangement,
} from "../dist/index.mjs";
const melody = ["C4", "E4", "G4", "A4", "G4", "E4", "D4", "C4"];
function study(count, ornaments = false) {
  const notes = Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    pitch: parsePitch(melody[i % melody.length]),
    onset: q(i * 2),
    duration: q(1),
    partId: "p",
    voiceId: "melody",
    role: "melody",
  }));
  if (ornaments)
    for (let i = 0; i < count; i++)
      notes.push({
        id: `o${i}`,
        pitch: parsePitch("D4"),
        onset: q(i * 2 + 1),
        duration: q(1, 2),
        partId: "p",
        voiceId: "melody",
        role: "ornament",
      });
  return createScore(notes);
}
const cases = [
  {
    name: "ukulele 8-note exact",
    score: study(8),
    options: {
      instrument: concertUkulele(),
      search: { strategy: "exact", maxExpandedStates: 1000000 },
    },
  },
  {
    name: "ukulele 64-note beam",
    score: study(64),
    options: {
      instrument: concertUkulele(),
      search: { beamWidth: 24, maxExpandedStates: 1000000 },
    },
  },
  {
    name: "guitar 64-note beam",
    score: study(64),
    options: {
      instrument: classicalGuitar(),
      search: { beamWidth: 24, maxExpandedStates: 1000000 },
    },
  },
  {
    name: "baby reduction 128 input notes",
    score: study(64, true),
    options: {
      instrument: concertUkulele(),
      mode: "adaptive",
      player: { level: "baby" },
      autoTempo: true,
      search: { beamWidth: 24, maxExpandedStates: 1000000 },
    },
  },
];
const results = [];
for (const c of cases) {
  arrange(c.score, c.options);
  const durations = [];
  let result;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    result = arrange(c.score, c.options);
    durations.push(performance.now() - start);
  }
  if (result.status !== "success")
    throw new Error(`${c.name}: ${JSON.stringify(result)}`);
  const validation = validateFrettedArrangement(
    result.score,
    c.options.instrument,
    result.annotations,
    c.options.player,
  );
  if (!validation.valid) throw new Error(validation.diagnostics.join("; "));
  results.push({
    name: c.name,
    inputNotes: c.score.notes.length,
    outputNotes: result.score.notes.length,
    medianMs: Number(durations.sort((a, b) => a - b)[1].toFixed(2)),
    expandedStates: result.stats.expandedStates,
    optimality: result.optimality,
  });
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      fixture:
        "Original synthetic study, one warmup + three runs; not a general latency guarantee",
      results,
    },
    null,
    2,
  ),
);
