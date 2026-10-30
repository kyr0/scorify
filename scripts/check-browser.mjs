import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { checkAudio, checkPitch } from "./browser-audio.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    if (pathname.endsWith("/")) pathname += "index.html";
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(root) || !(await stat(filename)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const type = filename.endsWith(".html")
      ? "text/html"
      : filename.endsWith(".wav")
        ? "audio/wav"
        : "text/javascript";
    response.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    response.end(await readFile(filename));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SCORIFY_CHROMIUM_PATH
      ? { executablePath: process.env.SCORIFY_CHROMIUM_PATH }
      : {}),
    ...(process.env.SCORIFY_CHROMIUM_ARGS
      ? { args: JSON.parse(process.env.SCORIFY_CHROMIUM_ARGS) }
      : {}),
  });
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) =>
    errors.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(`${origin}/examples/browser/`);
  await page.waitForFunction(() => globalThis.scorifyProbe, undefined, {
    timeout: 10000,
  });
  const result = await page.evaluate(() => globalThis.scorifyProbe);
  assert.equal(result.transposed, "E#4");
  assert.deepEqual(
    result.positions.map((p) => [p.stringNumber, p.absoluteFret]),
    [
      [4, 0],
      [3, 7],
      [2, 3],
    ],
  );
  assert.ok(result.chords.includes("CM"));
  assert.equal(result.workerStatus, "success");
  assert.equal(result.workerOptimality, "proven-in-model");
  await page.waitForFunction(() => globalThis.scorifyArrangement, undefined, {
    timeout: 30000,
  });
  const initial = await page.evaluate(() => globalThis.scorifyArrangement);
  assert.equal(initial.status, "success", JSON.stringify(initial));
  const expert = initial.score.notes.length;
  await page.selectOption("#level", "baby");
  await page.waitForFunction(
    () => globalThis.scorifyArrangement?.profile?.level === "baby",
    undefined,
    { timeout: 30000 },
  );
  const baby = await page.evaluate(() => ({
    status: globalThis.scorifyArrangement.status,
    notes: globalThis.scorifyArrangement.score.notes.length,
  }));
  assert.equal(baby.status, "success");
  assert.ok(baby.notes < expert, "Level change must recompute from the source");
  result.demo = { expertNotes: expert, babyNotes: baby.notes };
  result.audio = await checkAudio(page);
  result.pitch = await checkPitch(page);
  const downloadEvent = page.waitForEvent("download");
  await page.click("#wav");
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "scorify-performance.wav");
  const stream = await download.createReadStream(),
    chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const wav = Buffer.concat(chunks);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  result.audio.downloadBytes = wav.length;
  if (process.env.SCORIFY_SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.SCORIFY_SCREENSHOT_PATH,
      fullPage: true,
    });
  assert.deepEqual(errors, []);
  assert.ok(
    requests.every((url) => url.startsWith(origin + "/")),
    "Unexpected external runtime request",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        browser: await browser.version(),
        requests: requests.length,
        result,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
