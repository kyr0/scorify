import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { PluckedStringSynth, renderPerformance } from "../dist/audio-dsp.mjs";
const tone = {
  velocity: 0.7,
  brightness: 0.6,
  pluckPosition: 0.22,
  decaySeconds: 3,
  muted: false,
};
function estimate(samples, expected, rate) {
  const center = rate / expected,
    start = Math.round(0.08 * rate),
    end = Math.round(0.25 * rate),
    lags = [],
    values = [];
  for (let lag = Math.floor(center) - 4; lag <= Math.ceil(center) + 4; lag++) {
    let xy = 0,
      x2 = 0,
      y2 = 0;
    for (let i = start; i < end; i++) {
      const x = samples[i],
        y = samples[i + lag];
      xy += x * y;
      x2 += x * x;
      y2 += y * y;
    }
    lags.push(lag);
    values.push(xy / Math.sqrt(x2 * y2));
  }
  const i = values.indexOf(Math.max(...values)),
    a = values[i - 1] ?? values[i],
    b = values[i],
    c = values[i + 1] ?? b,
    delta = (0.5 * (a - c)) / (a - 2 * b + c);
  return rate / (lags[i] + (Number.isFinite(delta) ? delta : 0));
}
const tuning = [];
for (const rate of [44100, 48000, 96000])
  for (const frequency of [
    82.4069, 110, 146.8324, 196, 261.6256, 440, 880, 1318.51,
  ]) {
    const input = {
      strings: ["s"],
      durationSeconds: 0.5,
      events: [
        {
          ...tone,
          id: "n",
          stringId: "s",
          frequency,
          onsetSeconds: 0,
          endSeconds: 0.5,
          excitationSeed: 42,
        },
      ],
    };
    const audio = renderPerformance(input, {
        sampleRate: rate,
        tailSeconds: 0,
        bodyMix: 0,
      }),
      measured = estimate(audio.channels[0], frequency, rate),
      cents = 1200 * Math.log2(measured / frequency);
    assert.ok(Math.abs(cents) < 5);
    tuning.push({ sampleRate: rate, frequency, measured, cents });
  }
const benchmarks = [];
for (const count of [4, 6]) {
  const strings = Array.from({ length: count }, (_, i) => `s${i}`),
    frequencies =
      count === 4
        ? [392, 261.6256, 329.6276, 440]
        : [82.4069, 110, 146.8324, 196, 246.9417, 329.6276],
    events = [];
  for (let stroke = 0; stroke < 20; stroke++)
    for (let i = 0; i < count; i++)
      events.push({
        ...tone,
        id: `${stroke}:${i}`,
        stringId: strings[i],
        frequency: frequencies[i],
        onsetSeconds: stroke * 0.5 + i * 0.006,
        endSeconds: stroke * 0.5 + i * 0.006 + 0.4,
        excitationSeed: stroke * count + i,
      });
  const input = { strings, events, durationSeconds: 10 };
  const runs = [];
  let stats;
  for (let run = 0; run < 4; run++) {
    const start = performance.now(),
      synth = new PluckedStringSynth(input),
      left = new Float32Array(128),
      right = new Float32Array(128),
      prepared = performance.now();
    for (let i = 0; i < 480000; i += 128)
      synth.process(left, right, 0, Math.min(128, 480000 - i));
    const ended = performance.now();
    if (run)
      runs.push({ prepareMs: prepared - start, renderMs: ended - prepared });
    stats = synth.stats;
  }
  runs.sort((a, b) => a.renderMs - b.renderMs);
  assert.equal(stats.clippedSamples, 0);
  benchmarks.push({
    strings: count,
    events: events.length,
    renderSeconds: 10,
    median: runs[1],
    realtimeFactor: 10000 / runs[1].renderMs,
    stats,
  });
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      method:
        "One warmup, median of three runs; 128-frame blocks; synthetic fixtures; not a device realtime guarantee.",
      maxAbsCents: Math.max(...tuning.map((t) => Math.abs(t.cents))),
      tuning,
      benchmarks,
    },
    null,
    2,
  ),
);
