// Precomputes the playground's usual arrangements, so they appear without a search: every piece on every instrument at
// every difficulty in every key of the key selector, plus the capo the playground suggests for it. Arrangements are fingered at the piece's own tempo;
// any other tempo (maestro's 20% faster included) only changes playback, so the tempo is not part of a configuration. Entries of an earlier run that still replay completely are kept; only the others are searched. The page replays a cached log only
// when the inputs of every attempt still fingerprint alike (pieces, versions, voicings, options and the cache version, src/VERSION),
// and validates a replayed result first; anything else is searched as before.
//
//   node scripts/precompute-docs.mjs            public pieces → docs/assets/cache/
//   node scripts/precompute-docs.mjs --private  the local practice library → work/private-scores/cache/
//   add --check to verify that every cached configuration is present and fresh, without searching (exit 1 if not)
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const songsModule = await import("../docs/assets/songs.mjs");
const { songs, instruments, levels, pieceFromScore, songFromChart, arrangeFor, suggestCapo, cacheKey, cacheable, stableJson, SET_SCHEMA, KEY_SHIFTS } = songsModule;
const { arrange, normalizeScore } = await import("../docs/assets/scorify/index.mjs");
const { build } = await import("../docs/assets/scorify/build.mjs");
const docs = new URL("../docs/", import.meta.url), library = new URL("../work/private-scores/", import.meta.url);
const json = async url => JSON.parse(await readFile(url, "utf8"));

/** The pieces exactly as the page builds them: the songs, the score and chart cards of index.html, or the local library. */
async function piecesFor(privateLibrary) {
  if (privateLibrary) {
    return Promise.all((await json(new URL("index.json", library))).map(async entry => {
      const data = await json(new URL(entry.file, library));
      // A score set (several versions of a piece) is normalized version by version, as the page does.
      if (data.schema === SET_SCHEMA)
        return pieceFromScore({ ...data, variants: data.variants.map(v => ({ ...v, score: normalizeScore(v.score) })) }, { id: entry.id, instrument: entry.instrument });
      const score = normalizeScore(data);
      return entry.chart ? songFromChart(await json(new URL(entry.chart, library)), score, { id: entry.id, instrument: entry.instrument })
        : pieceFromScore(score, { id: entry.id, instrument: entry.instrument });
    }));
  }
  const html = await readFile(new URL("index.html", docs), "utf8"), cards = [];
  for (const [, id, url, chart, instrument] of html.matchAll(/data-song="([^"]+)" data-score-url="([^"]+)"(?: data-chart-url="([^"]+)")? data-instrument="([^"]+)"/g)) {
    const score = normalizeScore(await json(new URL(url, docs)));
    cards.push(chart ? songFromChart(await json(new URL(chart, docs)), score, { id, instrument }) : pieceFromScore(score, { id, instrument }));
  }
  return [...songs, ...cards];
}
/** Every usual request: each instrument, difficulty, key and choice of voices, and with the capo suggested there. */
function requestsFor(piece) {
  const textures = piece.textures?.length ? piece.textures.map(t => t.key) : [piece.texture];
  return instruments.flatMap(({ id: instrumentId }) => levels.flatMap(level => textures.flatMap(texture => KEY_SHIFTS.flatMap(transpose => {
    const request = { instrumentId, level, bpm: piece.bpm, texture, capo: 0, transpose, custom: null };
    const capo = suggestCapo(piece, { instrumentId, level, transpose });
    return capo ? [request, { ...request, capo: capo.capo }] : [request];
  }))));
}
const run = (piece, request, replay = [], search = (source, options) => arrange(source, options)) =>
  arrangeFor(piece, request, { arrange: async (source, options) => search(source, options), replay });

if (!isMainThread) {
  const pieces = await piecesFor(workerData.privateLibrary);
  parentPort.on("message", async ({ index, request }) => {
    const piece = pieces[index], started = Date.now();
    const outcome = await run(piece, request);
    parentPort.postMessage({ key: cacheKey(piece, request), log: cacheable(outcome.log), status: outcome.status, version: outcome.version?.id, seconds: (Date.now() - started) / 1000 });
  });
} else {
  const privateLibrary = process.argv.includes("--private"), check = process.argv.includes("--check");
  const target = privateLibrary ? new URL("cache/", library) : new URL("assets/cache/", docs);
  const pieces = await piecesFor(privateLibrary);
  const tasks = pieces.flatMap((piece, index) => requestsFor(piece).map(request => ({ index, request, key: cacheKey(piece, request) })));
  const index = await json(new URL("index.json", target)).catch(() => ({ entries: {} }));
  const label = ({ index: i, request }) => `${pieces[i].id} ${request.instrumentId} ${request.level}${request.transpose ? ` ${request.transpose > 0 ? "+" : ""}${request.transpose}` : ""}${request.texture ? ` ${request.texture}` : ""}${request.capo ? ` capo ${request.capo}` : ""}`;
  /**
   * A task's cached entry, if its log replays completely (an attempt that would have to be searched means its inputs
   * changed). An entry for the same piece and request under another key, whose piece changed only in what the search
   * does not use (its credit or source, say), replays too and is kept under the new key. So does the file of a run
   * that stopped before it wrote the index.
   */
  async function reusable({ index: i, request, key }) {
    const fields = ({ instrumentId, level, texture, capo, transpose = 0, custom }) => stableJson({ instrumentId, level, texture, capo, transpose, custom });
    // --check asks whether the page finds it, so only the request's own key counts there.
    const others = check ? [] : Object.values(index.entries).filter(e => e !== index.entries[key] && e.piece === pieces[i].id && fields(e) === fields(request));
    const orphan = !check && !index.entries[key] && written.has(`${key}.json.gz`) ? [{ file: `${key}.json.gz`, piece: pieces[i].id, ...request }] : [];
    for (const entry of [index.entries[key], ...others, ...orphan].filter(Boolean)) {
      const { log } = JSON.parse(gunzipSync(await readFile(new URL(entry.file, target))));
      const replayed = await run(pieces[i], request, log, () => { throw new Error("stale"); }).catch(() => null);
      if (!replayed || (entry.status && replayed.status !== entry.status)) continue;
      return entry.status ? entry : { ...entry, status: replayed.status, ...(replayed.version ? { version: replayed.version.id } : {}) };
    }
    return null;
  }
  const written = new Set(await readdir(target).catch(() => []));
  const entries = {}, todo = [];
  for (const task of tasks) {
    const entry = await reusable(task);
    if (entry) entries[task.key] = entry;
    else todo.push({ ...task, problem: index.entries[task.key] ? "stale" : "not cached" });
  }
  if (check) {
    console.log(JSON.stringify({ build, configurations: tasks.length, stale: todo.length, examples: todo.slice(0, 10).map(t => `${label(t)}: ${t.problem}`) }, null, 2));
    process.exit(todo.length ? 1 : 0);
  }
  console.log(`${tasks.length - todo.length} of ${tasks.length} cached arrangements are fresh; searching ${todo.length}`);
  await mkdir(target, { recursive: true });
  const jobs = Math.max(1, Math.min(todo.length, Number(process.env.JOBS ?? availableParallelism() - 2)));
  let next = 0, done = 0;
  const crashed = [];
  // A worker that fails (out of memory, say) leaves its configuration uncached and is replaced by a new one.
  const work = () => new Promise(resolve => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { privateLibrary } });
    let task;
    const feed = () => {
      if (next >= todo.length) { void worker.terminate().then(resolve); return; }
      task = todo[next++];
      worker.postMessage({ index: task.index, request: task.request });
    };
    worker.on("message", async ({ key, log, status, version, seconds }) => {
      const file = `${key}.json.gz`;
      await writeFile(new URL(file, target), gzipSync(JSON.stringify({ key, log })));
      entries[key] = { file, piece: pieces[task.index].id, ...task.request, status, ...(version ? { version } : {}) };
      console.log(`${++done}/${todo.length} ${label(task)}: ${status}${version ? ` (${version})` : ""} ${seconds.toFixed(1)} s`);
      feed();
    });
    worker.on("error", error => {
      const what = `${task ? label(task) : "a worker"}: ${error.code ?? error.message}`;
      crashed.push(what);
      console.log(`${task ? ++done : done}/${todo.length} ${what}, not cached`);
      void work().then(resolve);
    });
    worker.once("online", feed);
  });
  await Promise.all(Array.from({ length: jobs }, work));
  // Files of earlier runs that no configuration uses any more are removed.
  const files = new Set(Object.values(entries).map(e => e.file));
  for (const name of await readdir(target)) if (name.endsWith(".json.gz") && !files.has(name)) await rm(new URL(name, target));
  await writeFile(new URL("index.json", target), JSON.stringify({ schema: "scorify-cache-1", build, entries: Object.fromEntries(Object.entries(entries).sort()) }, null, 1) + "\n");
  console.log(`Cached ${Object.keys(entries).length} arrangements in ${fileURLToPath(target)}`);
  if (crashed.length) {
    console.log(`Not cached, the search failed:\n  ${crashed.join("\n  ")}`);
    process.exit(1);
  }
}
