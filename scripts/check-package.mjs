import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { init, parse } from "es-module-lexer";

await init;
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const root = new URL("../", import.meta.url);
assert.equal(pkg.type, "module");
assert.deepEqual(pkg.sideEffects, [
  "./dist/worker-entry.mjs",
  "./dist/audio-worklet.mjs",
  "./dist/pitch-worklet.mjs",
]);
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
const sizes = [];
const graph = new Map();
for (const file of (await readdir(new URL("dist/", root), { recursive: true }))
  .filter((f) => f.endsWith(".mjs"))
  .sort()) {
  const source = await readFile(new URL(`dist/${file}`, root), "utf8");
  const [imports] = parse(source);
  const dependencies = [];
  for (const item of imports) {
    if (item.d === -2) continue; // import.meta
    assert.ok(item.n, `Nonliteral dynamic import in ${file}`);
    assert.match(
      item.n,
      /^\.\.?\//,
      `Bare/external import in ${file}: ${item.n}`,
    );
    await access(new URL(item.n, new URL(`dist/${file}`, root)));
    dependencies.push(new URL(item.n, new URL(`dist/${file}`, root)).href);
  }
  assert.doesNotMatch(
    source,
    /\b(?:require\s*\(|process\.|Buffer\.)/,
    `Node-only runtime usage in ${file}`,
  );
  sizes.push({
    file,
    bytes: Buffer.byteLength(source),
    gzipBytes: gzipSync(source).length,
  });
  graph.set(new URL(`dist/${file}`, root).href, {
    gzipBytes: gzipSync(source).length,
    dependencies,
  });
}
const entryGraphs = [];
for (const [subpath, entry] of Object.entries(pkg.exports)) {
  await access(new URL(entry.types, root));
  await access(new URL(entry.import, root));
  const exports = await import(new URL(entry.import, root));
  if (subpath !== "./worker-entry")
    assert.ok(Object.keys(exports).length > 0, `Empty export: ${subpath}`);
  const visited = new Set();
  function visit(url) {
    if (visited.has(url)) return 0;
    visited.add(url);
    const node = graph.get(url);
    assert.ok(node, `Missing graph node: ${url}`);
    return (
      node.gzipBytes +
      node.dependencies.reduce((sum, dependency) => sum + visit(dependency), 0)
    );
  }
  const gzipBytes = visit(new URL(entry.import, root).href);
  if (subpath === ".")
    for (const file of visited) {
      const source = await readFile(new URL(file), "utf8");
      assert.doesNotMatch(
        source,
        /PluckedStringSynth|AudioWorkletNode|EffectChain|scorify-waveguide-1|scorify-performance-1|scorify-pitch-detector/,
        "Core graph must not include optional audio",
      );
    }
  if (["./audio-dsp", "./audio-effects", "./audio-guide", "./audio-worklet", "./pitch-detect", "./pitch-worklet"].includes(subpath))
    for (const file of visited) {
      assert.ok(
        !/\/(?:arrange|analysis|fingering|theory|model|performance)\.mjs$/.test(
          file,
        ),
        "DSP/worklet must not load score or solver modules",
      );
    }
  entryGraphs.push({ subpath, gzipBytes, files: visited.size });
}
await access(new URL("THIRD-PARTY-LICENSES.txt", root));
console.log(JSON.stringify({ status: "passed", sizes, entryGraphs }, null, 2));
