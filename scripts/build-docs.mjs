import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
console.log("Built docs/ with local ESM, worker and audio modules. Serve with bun run dev:docs.");
