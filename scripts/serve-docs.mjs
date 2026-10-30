import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const localPrefix = "/__private-scores/";
export function docsServer({ privateScoresRoot = fileURLToPath(new URL("../work/private-scores/", import.meta.url)) } = {}) {
  const root = fileURLToPath(new URL("../docs/", import.meta.url));
  const local = address => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
  const manifest = async () => {
    if (!privateScoresRoot) return [];
    try {
      const entries = JSON.parse(await readFile(path.join(privateScoresRoot, "index.json"), "utf8"));
      // An entry may name a chord chart written for its score: the page then plays the chart under the score's voice.
      const named = (name, kind) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && name.endsWith(kind);
      if (!Array.isArray(entries) || entries.some(e => !e || typeof e.id !== "string" || !(named(e.file, ".scorify.json") || named(e.file, ".scorify-set.json"))
        || (e.chart !== undefined && !named(e.chart, ".chart.json")))) throw new Error("Invalid private score manifest");
      return entries.map(({ id, file, instrument, chart }) => ({ id, file, instrument, url: localPrefix + file, ...(chart ? { chart, chartUrl: localPrefix + chart } : {}) }));
    } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  };
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".md": "text/plain", ".txt": "text/plain", ".gz": "application/gzip" };
  return createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname.startsWith(localPrefix)) {
        if (!local(request.socket.remoteAddress)) throw new Error("Local practice only");
        const entries = await manifest(), name = pathname.slice(localPrefix.length);
        let content;
        if (name === "index.json") content = JSON.stringify(entries);
        else if (/^cache\/(index\.json|[0-9a-f-]+\.json\.gz)$/.test(name)) {
          // The library's precomputed arrangements (scripts/precompute-docs.mjs --private).
          const base = await realpath(path.join(privateScoresRoot, "cache")), filename = await realpath(path.join(base, name.slice("cache/".length)));
          if (path.dirname(filename) !== base) throw new Error("Outside the private cache");
          content = await readFile(filename);
        } else {
          if (!entries.some(e => e.file === name || e.chart === name)) throw new Error("Unlisted score");
          const base = await realpath(privateScoresRoot), filename = await realpath(path.join(base, name));
          if (path.dirname(filename) !== base) throw new Error("Outside private scores");
          content = await readFile(filename);
        }
        response.writeHead(200, { "content-type": name.endsWith(".gz") ? "application/gzip" : "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(content);
        return;
      }
      if (pathname.endsWith("/")) pathname += "index.html";
      const filename = path.resolve(root, `.${pathname}`);
      if (!filename.startsWith(root)) throw new Error("Outside docs");
      let content = await readFile(filename);
      // Only the local server advertises these files. The static docs build contains no private scores or URLs.
      if (pathname === "/index.html" && local(request.socket.remoteAddress) && (await manifest()).length) {
        content = content.toString().replace("</head>", `<meta name="scorify-local-scores" content="${localPrefix}index.json"></head>`);
      }
      response.writeHead(200, { "content-type": `${types[path.extname(filename)] ?? "application/octet-stream"}; charset=utf-8`, "cache-control": "no-cache" });
      response.end(content);
    } catch { response.writeHead(404).end("Not found"); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  docsServer().listen(port, "127.0.0.1", () => console.log(`Scorify demo: http://localhost:${port}`));
}
