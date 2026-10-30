import { writeFile, mkdir } from "node:fs/promises";
import { study } from "../examples/audio/studies.mjs";
import { renderPerformance, encodeWav } from "../dist/audio-dsp.mjs";
const directory = new URL("../examples/audio/", import.meta.url);
await mkdir(directory, { recursive: true });
const records = [];
for (const instrument of ["ukulele", "guitar"])
  for (const humanize of [0, 0.65]) {
    const plan = study(instrument, humanize),
      audio = renderPerformance(plan),
      name = `${instrument}-${humanize ? "humanized" : "straight"}.wav`;
    await writeFile(new URL(name, directory), encodeWav(audio));
    records.push({
      file: name,
      notes: plan.events.length,
      durationSeconds: audio.durationSeconds,
      timingScale: plan.humanization.timingScale,
      stats: audio.stats,
    });
  }
await writeFile(
  new URL("RENDERED.json", directory),
  JSON.stringify(records, null, 2) + "\n",
);
console.log(JSON.stringify(records, null, 2));
