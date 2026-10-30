import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url)),
  temporary = await mkdtemp(path.join(tmpdir(), "scorify-packed-"));
try {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary],
      { cwd: root, encoding: "utf8" },
    ),
  )[0];
  execFileSync("tar", [
    "-xzf",
    path.join(temporary, packed.filename),
    "-C",
    temporary,
  ]);
  const packageRoot = path.join(temporary, "package"),
    pkg = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    );
  for (const [name, entry] of Object.entries(pkg.exports)) {
    await stat(path.join(packageRoot, entry.types));
    await import(pathToFileURL(path.join(packageRoot, entry.import)));
  }
  for (const file of packed.files.filter((f) => f.path.startsWith("dist/")))
    assert.deepEqual(
      await readFile(path.join(packageRoot, file.path)),
      await readFile(path.join(root, file.path)),
      `Packed bytes mismatch: ${file.path}`,
    );
  const { createScore, parsePitch, q, arrange, concertUkulele } = await import(
    pathToFileURL(path.join(packageRoot, pkg.exports["."].import))
  );
  const result = arrange(
    createScore([
      {
        id: "a",
        pitch: parsePitch("C4"),
        onset: q(0),
        duration: q(1),
        partId: "p",
        voiceId: "v",
      },
    ]),
    { instrument: concertUkulele(), search: { strategy: "exact" } },
  );
  assert.equal(result.status, "success");
  assert.equal(result.optimality, "proven-in-model");
  const { createPerformance, renderPerformance, encodeWav } = await import(
    pathToFileURL(path.join(packageRoot, pkg.exports["./audio"].import))
  );
  const performed = createPerformance(result, concertUkulele(), {
    humanize: 0,
    strum: false,
  });
  assert.equal(performed.status, "success");
  const wav = encodeWav(renderPerformance(performed.performance));
  assert.ok(wav.length > 1000);
  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), "RIFF");
  const consumer = path.join(temporary, "consumer.mts");
  await writeFile(
    consumer,
    `import { createScore, parsePitch, q, arrange, concertUkulele, createWorkerClient, type InstrumentAdapter } from './package/dist/index.mjs';
const score = createScore([{id:'a', pitch:parsePitch('C4'), onset:q(0), duration:q(1), partId:'p', voiceId:'v'}]);
const result = arrange(score, {instrument:concertUkulele(), mode:'adaptive', player:{level:'beginner'}});
if (result.status === 'success') { const fret: number | undefined = result.annotations[0]?.assignments[0]?.absoluteFret; }
// @ts-expect-error invalid player level must fail the public declarations
arrange(score, {player:{level:'wizard'}});
// @ts-expect-error invalid mode must fail the public declarations
arrange(score, {mode:'magical'});
const worker = new Worker(new URL('./package/dist/worker-entry.mjs', import.meta.url), {type:'module'});
createWorkerClient(worker).dispose();
import {createPerformance, createAudioPlayer, renderPerformance, encodeWav, type PerformancePlan} from './package/dist/audio.mjs';
if(result.status==='success') {
 const plan=createPerformance(result,concertUkulele(),{seed:'packed',humanize:0,strum:false});
 if(plan.status==='success') {
  const pcm=renderPerformance(plan.performance,{preset:plan.performance.preset});
  const bytes:Uint8Array=encodeWav(pcm);
  const player=await createAudioPlayer(new AudioContext());
  const playback=await player.play(plan.performance); playback.stop(); player.dispose();
 }
}
// @ts-expect-error invalid direction must fail the public declarations
if(result.status==='success') createPerformance(result,concertUkulele(),{strum:{direction:'sideways'}});
`,
  );
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "--strict",
      "--noEmit",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      consumer,
    ],
    { cwd: temporary, encoding: "utf8" },
  );
  assert.ok(packed.files.some((f) => f.path === "THIRD-PARTY-LICENSES.txt"));
  // Only the build and its notices: never docs/ (the site, its caches), work/, the skill, sources or tests.
  const allowed = new Set(["package.json", "README.md", "LICENSE", "THIRD-PARTY-LICENSES.txt"]),
    stray = packed.files.map((f) => f.path).filter((p) => !p.startsWith("dist/") && !allowed.has(p));
  assert.deepEqual(stray, [], `Unexpected files in the package: ${stray.join(", ")}`);
  console.log(
    JSON.stringify(
      {
        status: "passed",
        fileCount: packed.files.length,
        packedBytes: packed.size,
        unpackedBytes: packed.unpackedSize,
        checks: [
          "all exports and declarations present",
          "byte-identical distribution",
          "packed runtime arrangement",
          "packed performance synthesis and WAV",
          "public declaration consumer with Worker and AudioContext compatibility",
          "third-party notices",
          "nothing packed but dist/ and the notices",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
