// Optional local-library check: original scores and reports stay outside the static docs tree.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { docsServer } from "./serve-docs.mjs";
import { pitchString, transposePitch } from "../dist/index.mjs";

const root = path.resolve("work/private-scores"), manifest = JSON.parse(await readFile(path.join(root, "index.json")));
assert.ok(manifest.length, "A local practice library is required");
const server = docsServer({ privateScoresRoot: root });
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"],
    ...(process.env.SCORIFY_CHROMIUM_PATH ? { executablePath: process.env.SCORIFY_CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("requestfailed", r => errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const report = [];
  const levels = ["baby", "beginner", "amateur", "semi-pro", "pro", "expert", "maestro"];
  const q = r => r[0] / r[1];
  for (const entry of manifest) {
    const source = JSON.parse(await readFile(path.join(root, entry.file)));
    // A score set holds several versions of a piece, each for a difficulty; the card shows the hardest one's score.
    const set = source.schema === "scorify-set-1";
    const score = set ? source.variants.reduce((a, b) => (levels.indexOf(b.difficulty) >= levels.indexOf(a.difficulty) ? b : a)).score : source;
    const chart = entry.chart ? JSON.parse(await readFile(path.join(root, entry.chart))) : null;
    // A chart may follow the tune through a choir's parts (sungLine) and move a sung passage the edition wrote in
    // another key; every other pitch is shown as imported.
    const bar = score.meterMap[0].numerator * 4 / score.meterMap[0].denominator;
    const onLine = n => !chart?.sungLine || chart.sungLine.parts.some(p => p.part === n.partId && q(n.onset) >= (p.bars[0] - 1) * bar && q(n.onset) < p.bars[1] * bar);
    const vocal = score.notes.filter(n => (score.notation.vocal ?? []).includes(n.partId) && onLine(n));
    const shown = n => {
      const shift = chart?.vocalTranspose?.find(t => q(n.onset) >= (t.bars[0] - 1) * bar && q(n.onset) < t.bars[1] * bar);
      return shift ? transposePitch(pitchString(n.pitch), shift.interval) : pitchString(n.pitch);
    };
    await page.waitForSelector(`[data-song="${entry.id}"][data-loaded]`);
    await page.click(`[data-song="${entry.id}"]`);
    await page.waitForFunction(id => {
      const p = document.getElementById("playground");
      return p.dataset.song === id && !["loading", "searching"].includes(p.dataset.status);
    }, entry.id, { timeout: 60000 });
    const state = await page.evaluate(() => ({
      status: document.getElementById("playground").dataset.status,
      problem: document.getElementById("problem").textContent,
      data: document.getElementById("song-tab").api.getState().config.data.scores[0],
      diagnostics: JSON.parse(document.getElementById("result-json").textContent),
      notes: document.getElementById("fact-notes").textContent,
    }));
    assert.equal(state.status, "success", `${entry.id}: ${state.problem}`);
    assert.equal(await page.textContent("#mode-badge"), state.diagnostics.mode === "adaptive" ? "Adaptive accompaniment" : "Exact mode");
    if (chart) assert.equal(state.diagnostics.mode, "exact", `${entry.id}: a chart plays its versions as written`);
    const pitches = state.data.tracks.find(t => t.id === "vocal-pitches")?.items ?? [];
    const lanes = state.data.tracks.filter(t => t.id.startsWith("verse-"));
    assert.equal(pitches.length, vocal.length);
    if (vocal.length) {
      assert.deepEqual(pitches.map(n => n.text), vocal.map(shown));
      assert.deepEqual(pitches.map(n => (n.measure - 1) * state.data.time[0] + n.beat - 1), vocal.map(n => q(n.onset) * state.data.time[1] / 4));
      assert.deepEqual(pitches.map(n => n.beats), vocal.map(n => q(n.duration) * state.data.time[1] / 4));
      const verses = [score.notation.lyrics ?? {}, ...(score.notation.verses ?? [])];
      if (vocal.some(n => verses.some(v => v[n.id])))
        assert.deepEqual(lanes.map(t => t.items.map(n => n.text)), verses.map(v => vocal.flatMap(n => v[n.id] ? [v[n.id]] : [])));
      // Without words the lane names each note.
      else assert.deepEqual(lanes.map(t => t.items.map(n => n.text)), [vocal.map(n => pitchString(n.pitch).replace(/-?\d+$/, ""))]);
    }
    const tab = state.data.tracks.find(t => t.kind === "tab").items;
    assert.ok(tab.length);
    let levelReport;
    if (chart) {
      // Chords, not a piano part: strums carry the accompaniment, and silent bars read N.C.
      assert.ok(tab.filter(i => i.strum).length > tab.length / 2, `${entry.id}: the accompaniment is strummed`);
      const silent = chart.progression.flatMap((b, k) => (b === "N.C." ? [k + 1] : []));
      const chords = state.data.tracks.find(t => t.kind === "chords").items;
      assert.deepEqual(chords.filter(i => i.name === "N.C.").map(i => i.measure), silent);
      assert.ok(!tab.some(i => silent.includes(i.measure)), `${entry.id}: nothing is played in the unaccompanied bars`);
      const gaps = chart.progression.flatMap((b, k) => (b !== "N.C." && !tab.some(i => i.measure === k + 1) ? [k + 1] : []));
      assert.deepEqual(gaps, [], `${entry.id}: every charted bar is played`);
    }
    await page.click("#play");
    await page.waitForFunction(() => document.getElementById("playground").dataset.playback === "playing");
    await page.waitForFunction(() => document.getElementById("song-tab").api.getState().config.position > 1);
    await page.click("#play");
    assert.equal(await page.getAttribute("#playground", "data-playback"), "paused");
    await page.locator("#song-tab").screenshot({ path: path.join(root, `${entry.id}-${vocal.length ? "vocal" : "tab"}.png`) });
    await page.click("#stop");
    if (chart) {
      // Every difficulty plays the version written for it (or says which easier one it fell back to, and why).
      levelReport = {};
      for (const level of levels) {
        await page.selectOption("#level", level);
        await page.waitForFunction(() => !["loading", "searching"].includes(document.getElementById("playground").dataset.status), null, { timeout: 120000 })
          .catch(async error => { throw new Error(`${entry.id} at ${level}: ${await page.textContent("#status")}`, { cause: error }); });
        const outcome = await page.evaluate(() => ({ status: document.getElementById("playground").dataset.status, level: document.getElementById("fact-level").textContent,
          notes: document.getElementById("fact-notes").textContent, mode: JSON.parse(document.getElementById("result-json").textContent).mode }));
        assert.equal(outcome.status, "success", `${entry.id} at ${level}`);
        assert.equal(outcome.mode, "exact", `${entry.id} at ${level}: no simplification of a chart`);
        assert.equal(outcome.level, level, `${entry.id} at ${level} plays the version written for it on its own instrument`);
        levelReport[level] = `${outcome.level} · ${outcome.notes}`;
      }
    }
    if (!chart && !set) {
      // A single imported score: baby and beginner strum its chords, every difficulty plays from the cache.
      levelReport = {};
      for (const level of levels) {
        await page.selectOption("#level", level);
        await page.waitForFunction(() => !["loading", "searching"].includes(document.getElementById("playground").dataset.status), null, { timeout: 120000 })
          .catch(async error => { throw new Error(`${entry.id} at ${level}: ${await page.textContent("#status")}`, { cause: error }); });
        const outcome = await page.evaluate(() => ({ status: document.getElementById("playground").dataset.status, level: document.getElementById("fact-level").textContent,
          notes: document.getElementById("fact-notes").textContent, search: document.getElementById("fact-search").textContent, version: JSON.parse(document.getElementById("result-json").textContent).version }));
        assert.equal(outcome.status, "success", `${entry.id} at ${level}`);
        if (levels.indexOf(level) <= levels.indexOf("beginner")) assert.match(outcome.version.label, /chords/, `${entry.id} at ${level} strums the piece's chords`);
        assert.match(outcome.search, /cached/, `${entry.id} at ${level} replays the precomputed cache`);
        levelReport[level] = `${outcome.level} · ${outcome.version.label} · ${outcome.notes}`;
      }
    }
    if (set) {
      // A score set plays, at each difficulty, the hardest version written for it or below; below its easiest version
      // it simplifies that one, and says so.
      levelReport = {};
      const written = [...source.variants].sort((a, b) => levels.indexOf(a.difficulty) - levels.indexOf(b.difficulty));
      for (const level of levels) {
        await page.selectOption("#level", level);
        await page.waitForFunction(() => !["loading", "searching"].includes(document.getElementById("playground").dataset.status), null, { timeout: 120000 })
          .catch(async error => { throw new Error(`${entry.id} at ${level}: ${await page.textContent("#status")}`, { cause: error }); });
        const outcome = await page.evaluate(() => ({ status: document.getElementById("playground").dataset.status, level: document.getElementById("fact-level").textContent,
          notes: document.getElementById("fact-notes").textContent, search: document.getElementById("fact-search").textContent }));
        assert.equal(outcome.status, "success", `${entry.id} at ${level}`);
        const played = JSON.parse(await page.textContent("#result-json")).version;
        const version = written.findLast(v => levels.indexOf(v.difficulty) <= levels.indexOf(level));
        const expected = !version ? `${level} · simplified` : version.difficulty === level ? level : `${level} · ${version.difficulty} version`;
        // Baby and beginner strum the piece's chords; above, only the easiest version may need simplifying (an
        // ensemble arrangement on one instrument), and harder ones play as written.
        if (levels.indexOf(level) <= levels.indexOf("beginner")) assert.match(played.label, /chords/, `${entry.id} at ${level} strums the piece's chords`);
        else assert.ok(outcome.level === expected || (version === written[0] && outcome.level === `${level} · simplified`), `${entry.id} at ${level}: ${outcome.level}, expected ${expected}`);
        assert.match(outcome.search, /cached/, `${entry.id} at ${level} replays the precomputed cache`);
        levelReport[level] = `${outcome.level} · ${played.label} · ${outcome.notes}`;
      }
      await page.selectOption("#level", "maestro");
      await page.waitForFunction(() => document.getElementById("playground").dataset.status === "success", null, { timeout: 120000 });
    }
    report.push({ id: entry.id, title: set ? source.title : source.notation.title, vocalNotes: pitches.length, lyricSyllables: lanes.map(t => t.items.length),
      accompaniment: state.notes, playback: "playing, clock advanced, paused, stopped", stats: state.diagnostics.stats,
      adaptation: state.diagnostics.notes, edits: state.diagnostics.editCount, ...(levelReport ? { levels: levelReport } : {}) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#theme-toggle").check();
  await page.locator("#song-tab").screenshot({ path: path.join(root, "wicked-mobile-dark.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Mobile page must not overflow horizontally");
  await page.reload();
  await page.waitForSelector(`[data-song="${manifest[0].id}"][data-loaded]`);
  assert.match(await page.textContent(`[data-song="${manifest[0].id}"] .sc-song-kind`), /^Song · /);
  assert.equal(await page.evaluate(() => localStorage.getItem("scorify-demo-opened-scores")), null, "Server-loaded originals are not duplicated in browser storage");
  assert.deepEqual(errors, []);
  await writeFile(path.join(root, "browser-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
