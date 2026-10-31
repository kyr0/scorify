import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const target = new URL("../docs/assets/scorify/", import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(new URL("../dist/", import.meta.url), target, { recursive: true });
await cp(new URL("../THIRD-PARTY-LICENSES.txt", import.meta.url), new URL("THIRD-PARTY-LICENSES.txt", target));
// The playground's arrangement cache is valid for one cache version: build.mjs names it after src/VERSION, which
// every attempt fingerprint includes. Change VERSION when a library change should search the cached arrangements
// again; until then they replay (each replayed result is validated first, so a stale one costs fidelity, never safety).
const version = (await readFile(new URL("../src/VERSION", import.meta.url), "utf8")).trim();
if (!/^[\w.-]{1,64}$/.test(version)) throw new Error(`src/VERSION must be one word of letters, digits, dots, dashes or underscores, not "${version}"`);
await writeFile(new URL("build.mjs", target), `export const build = "${version}";\n`);

// The page loads its modules from one immutable directory per build, assets/v/<hash>/ (the page's own modules and the
// library under scorify/), named after their contents. GitHub Pages serves every file for ten minutes under one URL,
// so unversioned modules let a browser mix two deploys (a new songs.mjs importing what an old scorify/songs.mjs lacks);
// a query string cannot help, since Pages ignores it. Inside one directory every relative import, the worker and the
// worklets belong to one build. The last KEEP builds stay, so a page cached before a deploy still finds its own files.
// docs/assets/scorify/ stays the library's stable path for Node tools (precompute, checks).
const KEEP = 3;
const assets = new URL("../docs/assets/", import.meta.url), versions = new URL("v/", assets), pages = ["app.mjs", "songs.mjs"];
const modules = (await readdir(target)).filter((file) => file.endsWith(".mjs")).sort();
const hash = createHash("sha256");
for (const file of pages) hash.update(`${file}\0`).update(await readFile(new URL(file, assets)));
for (const file of modules) hash.update(`scorify/${file}\0`).update(await readFile(new URL(file, target)));
const id = hash.digest("hex").slice(0, 12), build = new URL(`${id}/`, versions);
await rm(build, { recursive: true, force: true });
await mkdir(new URL("scorify/", build), { recursive: true });
for (const file of pages) await cp(new URL(file, assets), new URL(file, build));
for (const file of modules) await cp(new URL(file, target), new URL(`scorify/${file}`, build));
await cp(new URL("../THIRD-PARTY-LICENSES.txt", import.meta.url), new URL("scorify/THIRD-PARTY-LICENSES.txt", build));
const manifest = new URL("builds.json", versions);
const earlier = await readFile(manifest, "utf8").then(JSON.parse, () => []);
const kept = [...earlier.filter((b) => b !== id), id].slice(-KEEP);
for (const entry of await readdir(versions)) if (entry !== "builds.json" && !kept.includes(entry)) await rm(new URL(`${entry}/`, versions), { recursive: true, force: true });
await writeFile(manifest, `${JSON.stringify(kept, null, 2)}\n`);
const page = new URL("../docs/index.html", import.meta.url), html = await readFile(page, "utf8");
const script = /<script type="module" src="assets\/(?:v\/[0-9a-f]+\/)?app\.mjs"><\/script>/,
  styles = /href="assets\/site\.css(?:\?v=[0-9a-f]+)?"/;
if (!script.test(html) || !styles.test(html)) throw new Error("docs/index.html has no app.mjs module script or site.css link to point at the build");
// The stylesheet's query only avoids a cached copy: the new page fetches the new stylesheet.
const css = createHash("sha256").update(await readFile(new URL("site.css", assets))).digest("hex").slice(0, 12);
await writeFile(page, html.replace(script, `<script type="module" src="assets/v/${id}/app.mjs"></script>`).replace(styles, `href="assets/site.css?v=${css}"`));
console.log(`Built docs/ with local ESM, worker and audio modules (page modules in assets/v/${id}/). Serve with bun run dev:docs.`);
