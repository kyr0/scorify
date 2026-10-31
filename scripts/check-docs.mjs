// Drives the docs site in Chromium: every demo song (and the bundled imported score) must arrange, draw a tab from the
// solver's assignments, compile a validated performance and play; Play/Pause/Resume, Space and the tab's loop must make
// sound; lower difficulties must pick simpler versions; songs must re-arrange for other instruments and fall back to an
// easier version honestly; score files and score sets opened from disk must arrange and be remembered; usual configurations
// must replay the precomputed cache; the suggested capo must toggle; custom settings must re-compute, export, save and import. Needs `bun run build:docs` (the
// page's versioned build directory must hold the current sources) and
// network access to cdn.jsdelivr.net (defuss-shadcn is loaded from there, pinned by SRI). SCORIFY_DOCS_SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { docsServer } from "./serve-docs.mjs";

// The page runs the build directory index.html names (assets/v/<hash>/); it must hold the current sources and library.
{
  const docs = new URL("../docs/", import.meta.url), html = await readFile(new URL("index.html", docs), "utf8");
  const build = /src="(assets\/v\/[0-9a-f]+\/)app\.mjs"/.exec(html)?.[1];
  assert.ok(build, "docs/index.html loads no versioned build; run bun run build:docs");
  const same = async (source, copy) => (await readFile(new URL(source, docs))).equals(await readFile(new URL(copy, docs)).catch(() => Buffer.alloc(0)));
  const library = (await readdir(new URL("assets/scorify/", docs))).filter((file) => file.endsWith(".mjs"));
  for (const [source, copy] of [["assets/app.mjs", `${build}app.mjs`], ["assets/songs.mjs", `${build}songs.mjs`], ...library.map((file) => [`assets/scorify/${file}`, `${build}scorify/${file}`])])
    assert.ok(await same(source, copy), `docs/${copy} is not docs/${source}: run bun run build:docs`);
}
const server = docsServer({ privateScoresRoot: null });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const shots = process.env.SCORIFY_DOCS_SHOTS;
if (shots) await mkdir(shots, { recursive: true });
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", ...(process.env.SCORIFY_CHROMIUM_ARGS ? JSON.parse(process.env.SCORIFY_CHROMIUM_ARGS) : [])],
    ...(process.env.SCORIFY_CHROMIUM_PATH ? { executablePath: process.env.SCORIFY_CHROMIUM_PATH } : {}),
  });
  const report = {};
  for (const scheme of ["light", "dark"]) {
    const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
    // The tuner's "microphone": a sawtooth whose pitch the check sets (window.__tone), through a real MediaStream.
    await page.addInitScript(() => {
      if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const context = new AudioContext();
        await context.resume();
        const tone = new OscillatorNode(context, { type: "sawtooth", frequency: 110 }), out = context.createMediaStreamDestination();
        tone.connect(new GainNode(context, { gain: 0.3 })).connect(out);
        tone.start();
        Object.assign(window, { __tone: tone, __microphone: out.stream, __constraints: constraints });
        return out.stream;
      };
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("requestfailed", (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.goto(`${origin}/`);
    const settled = () => page.waitForFunction(() => {
      const status = document.getElementById("playground").dataset.status;
      return status && !["loading", "searching"].includes(status);
    }, undefined, { timeout: 30000 });

    await page.waitForSelector('[data-song="greensleeves"][data-loaded]', { timeout: 10000 });
    const snapshot = () => page.evaluate(() => {
      const tab = document.getElementById("song-tab");
      const data = tab.api.getState().config.data;
      return {
        status: document.getElementById("playground").dataset.status,
        problem: document.getElementById("problem").hidden ? null : document.getElementById("problem").textContent.trim(),
        notes: document.getElementById("fact-notes").textContent,
        items: data.scores[0].tracks.find((t) => t.kind === "tab")?.items.length ?? 0,
        charts: document.querySelectorAll(".sc-charts .chord-chart").length,
        hits: tab.querySelectorAll(".fretboard-hit").length,
        neck: !!document.getElementById("live-neck").api,
        time: data.scores[0].time,
        instrument: document.getElementById("instrument").value,
        message: document.getElementById("story").textContent,
      };
    });
    const counts = (state) => state.notes.split(/ \/ | · /).map(Number);
    const choose = async (selector, value) => { await page.selectOption(selector, value); await settled(); return snapshot(); };

    const play = async () => {
      await page.click("#play");
      await page.waitForFunction(() => document.getElementById("playground").dataset.playback === "playing", undefined, { timeout: 15000 });
    };
    // From a stop or a pause, playback counts in one bar before the sound starts.
    const countedIn = () => page.waitForFunction(() => document.getElementById("playground").dataset.counting === "false", undefined, { timeout: 15000 });
    const transport = () => page.evaluate(() => ({
      playback: document.getElementById("playground").dataset.playback,
      tab: document.getElementById("song-tab").dataset.stateName,
      position: document.getElementById("song-tab").api.getState().config.position,
      label: document.querySelector("#play span").textContent,
    }));

    // The page opens at maestro, which plays 20% faster than the piece's own tempo (Rainbow: 80 BPM).
    await settled();
    assert.deepEqual([await page.inputValue("#level"), await page.inputValue("#tempo")], ["maestro", "96"]);
    // Every piece opens at the chosen difficulty (maestro): the version written for it, fingered as written.
    for (const [song, bpm] of [["rainbow", 96], ["wicked", 130], ["rising", 115], ["greensleeves", 48]]) {
      await page.click(`[data-song="${song}"]`);
      await settled();
      assert.equal(Number(await page.inputValue("#tempo")), bpm, `${song}: maestro starts 20% above the original tempo`);
      const state = await snapshot();
      assert.equal(state.status, "success", `${song}: ${state.problem}`);
      const [kept, total] = counts(state);
      if (song === "greensleeves") {
        // The bundled import defaults to melody and bass, and says what it left out.
        assert.equal(total, 235, "greensleeves: totals count the whole imported score");
        assert.ok(kept === 130, `greensleeves: melody and bass are kept (${state.notes})`);
        assert.match(state.message, /left out 105 notes of the other voices/);
      } else {
        assert.ok(total > 0 && kept === total, `${song}: every note of the version is kept (${state.notes})`);
        assert.ok(state.charts > 0, `${song}: chord charts render`);
        assert.match(state.message, /the version written for maestro/);
      }
      assert.ok(state.items > 0 && state.hits > 0, `${song}: the tab draws the solver's notes`);
      assert.ok(state.neck, `${song}: the neck renders`);
      // The guide voice can sing only a piece with a sung part.
      const sings = await page.evaluate(() => document.getElementById("song-tab").api.getState().config.data.scores[0].tracks.some((t) => t.label === "Voice"));
      assert.equal(await page.isDisabled("#guide-voice"), !sings, `${song}: the Voice switch is ${sings ? "on offer" : "disabled"}`);
      if (song === "rising") {
        const words = await page.evaluate(() => document.getElementById("song-tab").api.getState().config.data.scores[0].tracks.find((t) => t.kind === "lyrics")?.items.map((i) => i.text));
        assert.equal(words?.[0], "There", "rising: the sung lane carries the traditional words");
      }
      if (scheme === "light") {
        await play();
        await countedIn();
        await page.waitForTimeout(1500);
        const playing = await transport();
        assert.ok(playing.position > 0 && playing.tab === "playing", `${song}: the tab follows the audio clock (${playing.position})`);
        assert.equal(playing.label, "Pause");
        if (shots) await page.locator("#playground").screenshot({ path: path.join(shots, `${song}-playing.png`) });
        await page.click("#stop");
      }
      report[song] = state;
    }

    if (scheme === "light") {
      // Play becomes Pause, then Resume; Space (nothing focused) and the tab's loop make sound too.
      await page.click('[data-song="rainbow"]');
      await settled();
      await play();
      await countedIn();
      await page.waitForTimeout(800);
      await page.click("#play");
      const paused = await transport();
      assert.equal(paused.playback, "paused");
      assert.equal(paused.label, "Resume");
      await page.click("#play");
      await page.waitForFunction(() => document.getElementById("playground").dataset.playback === "playing");
      const resumed = await transport();
      assert.ok(resumed.position >= paused.position - 0.05, `resume goes on from the pause (${paused.position} → ${resumed.position})`);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press("Space");
      assert.equal((await transport()).playback, "paused", "Space pauses the sound");
      await page.keyboard.press("Space");
      await page.waitForFunction(() => document.getElementById("playground").dataset.playback === "playing", undefined, { timeout: 10000 });
      await countedIn();
      const takes = () => page.evaluate(() => Number(document.getElementById("playground").dataset.takes));
      const before = await takes();
      await page.evaluate(() => document.getElementById("song-tab").api.setState("playing", { loop: { start: 3, end: 3 } }));
      const positions = [];
      for (let i = 0; i < 5; i++) { await page.waitForTimeout(700); positions.push((await transport()).position); }
      assert.ok(positions.every((p) => p >= 8 - 0.05 && p < 12 + 0.05), `the loop holds the sound in measure 3 (${positions})`);
      assert.ok(positions.some((p, i) => i && p < positions[i - 1]), `the loop goes round (${positions})`);
      // Every playback, and every pass of a loop, is a new take.
      assert.ok((await takes()) >= before + 3, `each loop pass is performed afresh (${before} → ${await takes()})`);

      // The bar numbers are the loop header: a double click clears the loop, a drag forward loops a range, a drag back
      // clears it; the sound keeps going without the loop.
      const loopNow = () => page.evaluate(() => document.getElementById("song-tab").api.getState().config.loop);
      const number = (bar) => page.locator(`#song-tab .fretboard-measure[data-measure="${bar}"] .fretboard-number`);
      await number(3).dblclick();
      await page.waitForTimeout(200);
      assert.equal(await loopNow(), null, "a double click on the loop header clears the loop");
      assert.equal((await transport()).playback, "playing");
      const drag = async (from, to, back = 0) => {
        const a = await number(from).boundingBox(), b = await number(to).boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 - back, b.y + b.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(200);
      };
      await drag(2, 3);
      assert.deepEqual(await loopNow(), { start: 2, end: 3 }, "a drag forward along the header loops the bars it covers");
      await drag(3, 2);
      assert.equal(await loopNow(), null, "a drag back clears the loop");
      await number(2).click();
      assert.deepEqual(await loopNow(), { start: 2, end: 2 }, "a single click still loops one bar");
      await drag(2, 2, 20);
      assert.equal(await loopNow(), null, "a drag back within one bar clears it too");

      // The chord sounding now leads the voicings, alone in a golden aura; the next one stands right of it and blinks
      // in the bar before it comes (Rainbow changes chord every bar).
      await page.waitForFunction(() => document.querySelector(".sc-charts > .sc-chart-slot[data-soon]"), undefined, { timeout: 5000 });
      const charts = await page.evaluate(() => [...document.querySelectorAll(".sc-charts > .sc-chart-slot")].map((slot) => ({
        chord: slot.querySelector(".chord-chart").dataset.chord, aura: slot.classList.contains("aura") && slot.classList.contains("aura-gold"),
        active: !!slot.querySelector(".chord-chart[data-active]"), next: slot.hasAttribute("data-next"), soon: slot.hasAttribute("data-soon") })));
      assert.ok(charts.length > 2 && charts[0].active && charts[0].aura, `the active chord leads in a golden aura (${JSON.stringify(charts)})`);
      assert.equal(charts.filter((c) => c.aura).length, 1, "only the active chord has an aura");
      assert.ok(charts[1].next && charts[1].soon && charts[1].chord !== charts[0].chord, `the next chord is second and blinks (${JSON.stringify(charts)})`);
      assert.equal(charts.filter((c) => c.next).length, 1, "one next chord");
      await page.click("#stop");

      // The end of the song: the playhead runs to the end, holds while the last notes ring, then goes to the start
      // once, without flickering between the two.
      const { beats, last } = await page.evaluate(() => {
        const config = document.getElementById("song-tab").api.getState().config, beats = Number(config.signature.split("/")[0]);
        return { beats, last: config.data.scores[0].measures * beats };
      });
      await page.evaluate((at) => document.getElementById("song-tab").api.setState("playing", { position: at }), last - beats);
      await page.waitForFunction(() => document.getElementById("playground").dataset.playback === "playing", undefined, { timeout: 10000 });
      const ending = [];
      for (let i = 0; i < 400; i++) {
        const now = await transport();
        ending.push(now.position);
        if (now.playback !== "playing" && now.position === 0) { for (let k = 0; k < 10; k++) { await page.waitForTimeout(30); ending.push((await transport()).position); } break; }
        await page.waitForTimeout(25);
      }
      const jumps = ending.filter((p, i) => i && p < ending[i - 1] - 0.5).length;
      assert.equal(jumps, 1, `the song ends with one jump to the start (${ending.map((p) => p.toFixed(2)).join(" ")})`);
      assert.ok(ending.at(-1) === 0 && Math.max(...ending) > last - 0.5, "the playhead reaches the end before it rewinds");

      // The neck scrolls to keep the sounding notes in view when it is wider than its panel.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() => { document.getElementById("live-neck").style.inlineSize = "12rem"; });
      let hidden = 0, overflowing = false;
      for (let bar = 0; bar < last / beats; bar++) {
        await page.evaluate((at) => document.getElementById("song-tab").api.setState("default", { position: at }), bar * beats + 0.01);
        await page.waitForTimeout(80);
        const view = await page.evaluate(() => {
          const neck = document.getElementById("live-neck"), box = neck.getBoundingClientRect();
          return { overflow: neck.scrollWidth > neck.clientWidth + 1, out: [...neck.querySelectorAll('.fretboard-neck-dot[data-role="active"]')]
            .filter((d) => { const r = d.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1; }).length };
        });
        overflowing ||= view.overflow;
        hidden += view.out;
      }
      assert.ok(overflowing, "the narrowed neck overflows its panel");
      assert.equal(hidden, 0, "every sounding note on the neck is scrolled into view");
      await page.evaluate(() => { document.getElementById("live-neck").style.inlineSize = ""; });
      await page.emulateMedia({ reducedMotion: null });

      // Tempo is playback only: any tempo keeps the fingering on show, found at the piece's own tempo, without a search.
      const tempo = async bpm => {
        await page.evaluate(value => { const slider = document.getElementById("tempo"); slider.value = String(value); slider.dispatchEvent(new Event("input")); slider.dispatchEvent(new Event("change")); }, bpm);
        await settled();
        return { ...(await snapshot()), search: await page.textContent("#fact-search") };
      };
      const shown = await snapshot(), slower = await tempo(70);
      assert.equal(slower.status, "success");
      assert.match(slower.message, /Fingered at the piece's tempo, 80 BPM; 70 BPM changes playback only/);
      assert.doesNotMatch(slower.search, /BPM/);
      assert.equal(slower.notes, shown.notes);
      const faster = await tempo(140);
      assert.deepEqual([faster.status, faster.notes], ["success", shown.notes], "a faster tempo keeps the fingering too");
      // The tempo slider marks the piece's original tempo; the mark brings it back.
      await tempo(120);
      assert.equal(await page.evaluate(() => document.getElementById("tempo-original").hasAttribute("data-current")), false);
      await page.click("#tempo-original");
      await settled();
      assert.equal(await page.inputValue("#tempo"), "80", "the original-tempo mark restores Rainbow's 80 BPM");
      const offset = await page.evaluate(() => {
        // The thumb (1.25rem = 20px) centers at 10px + (width - 20px) * fraction; the mark must sit under it.
        const slider = document.getElementById("tempo"), mark = document.getElementById("tempo-original").getBoundingClientRect(), box = slider.getBoundingClientRect();
        const fraction = (slider.value - slider.min) / (slider.max - slider.min);
        return mark.left + mark.width / 2 - (box.left + 10 + (box.width - 20) * fraction);
      });
      assert.ok(Math.abs(offset) < 2, `the mark sits under the thumb at the original tempo (${offset.toFixed(1)}px off)`);
      assert.equal(await page.evaluate(() => document.getElementById("tempo-original").hasAttribute("data-current")), true);

      // The highest fret is the instrument's (a ukulele's usual 18, marked under the track): a hard limit that searches
      // again, is reported, and is remembered for the instrument; the mark brings the usual neck back.
      const topFret = () => page.evaluate(() => Math.max(0, ...document.getElementById("song-tab").api.getState().config.data.scores[0].tracks
        .find((t) => t.kind === "tab").items.flatMap((i) => i.notes ?? []).map((n) => n.fret)));
      const neck = async frets => {
        await page.evaluate(value => { const slider = document.getElementById("frets"); slider.value = String(value); slider.dispatchEvent(new Event("input")); slider.dispatchEvent(new Event("change")); }, frets);
        await settled();
        return snapshot();
      };
      assert.deepEqual([await page.inputValue("#frets"), await page.evaluate(() => document.getElementById("frets-usual").hasAttribute("data-current"))], ["18", true]);
      const usualTop = await topFret(), short = await neck(5);
      assert.equal(short.status, "success", short.problem);
      assert.ok(await topFret() <= 5, `nothing above the highest fret (${await topFret()}; ${usualTop} on the usual neck)`);
      assert.match(short.message, /Frets up to 5 only \(the instrument's usual highest fret is 18\)/i);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("scorify-demo-necks-1"))), { "uke-high-g": 5 });
      await page.click('[data-song="wicked"]');
      await settled();
      await page.click('[data-song="rainbow"]');
      await settled();
      assert.equal(await page.inputValue("#frets"), "5", "the highest fret stays with the instrument");
      await page.click("#frets-usual");
      await settled();
      assert.equal(await page.inputValue("#frets"), "18");
      assert.equal(await page.evaluate(() => localStorage.getItem("scorify-demo-necks-1")), "{}");
      assert.equal((await snapshot()).notes, shown.notes, "the usual neck plays the cached arrangement again");
      await page.click("#tempo-original");
      await settled();

      // Play counts in one bar (80 BPM, 4/4: 3 s) with the playhead held at the start, whether or not the metronome
      // is on; a loop's next pass does not count in again.
      // A tempo change keeps the place (the checks above leave the playhead inside the song); this one starts at the top.
      await page.evaluate(() => document.getElementById("song-tab").api.setState("default", { loop: null, position: 0 }));
      const started = Date.now();
      await play();
      assert.equal(await page.evaluate(() => document.getElementById("playground").dataset.counting), "true");
      const held = [];
      for (let i = 0; i < 4; i++) { await page.waitForTimeout(500); held.push((await transport()).position); }
      assert.ok(held.every((p) => p < 0.1), `the playhead waits at the start during the count-in (${held})`);
      await countedIn();
      const counted = (Date.now() - started) / 1000;
      assert.ok(counted > 2.6 && counted < 4.5, `the count-in lasts one bar (${counted.toFixed(2)} s)`);
      await page.waitForTimeout(1000);
      assert.ok((await transport()).position > 0.5, "the song starts after the count-in");
      // A new tempo keeps the place: playback goes on from the same beat without a count-in, and a pause stays put.
      const place = (await transport()).position;
      await tempo(100);
      await page.waitForTimeout(400);
      const after = await transport();
      assert.equal(after.playback, "playing", "playback goes on at the new tempo");
      assert.equal(await page.evaluate(() => document.getElementById("playground").dataset.counting), "false", "a new tempo does not count in");
      assert.ok(after.position > place - 0.25 && after.position < place + 2, `a new tempo plays on from where it was (${place.toFixed(2)} → ${after.position.toFixed(2)})`);
      await page.click("#play");
      const halted = await transport();
      await tempo(80);
      const still = await transport();
      assert.equal(still.playback, "paused", "a pause stays a pause at a new tempo");
      assert.ok(Math.abs(still.position - halted.position) < 0.01, `a pause stays where it was (${halted.position.toFixed(2)} → ${still.position.toFixed(2)})`);
      await page.click("#stop");
      // The practice switches are remembered; the Loop swap plays the song again from the start when it ends.
      assert.equal(await page.textContent("label[for=guide-metronome]"), "Beat");
      assert.ok(await page.isChecked("#guide-metronome"), "the Beat is on by default");
      await page.click("label[for=guide-metronome]");
      await page.click(".sc-loop");
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("scorify-demo-practice-2"))), { voice: true, metronome: false, loop: true });
      assert.equal(await page.textContent(".sc-loop .swap-on"), "Loop");
      await page.evaluate((at) => document.getElementById("song-tab").api.setState("playing", { position: at }), last - beats);
      await countedIn();
      assert.equal(await page.evaluate(() => document.getElementById("playground").dataset.loop), "song");
      const around = [];
      for (let i = 0; i < 60 && !(around.length && around.at(-1) < beats); i++) { await page.waitForTimeout(250); around.push((await transport()).position); }
      assert.ok(around.at(-1) < beats && Math.max(...around) > last - beats, `the song goes round to its start (${around.map((p) => p.toFixed(1)).join(" ")})`);
      await page.waitForTimeout(1000);
      const again = await transport();
      assert.ok(again.playback === "playing" && again.position > around.at(-1), `and plays on, without a count-in (${again.position})`);
      assert.equal(await page.evaluate(() => document.getElementById("playground").dataset.counting), "false");
      await page.click(".sc-loop");
      await page.click("label[for=guide-metronome]");
      await page.click("#stop");
      report.transport = "play, pause, resume, Space, loop, a new take per playback and loop pass, loop header gestures, golden active chord, blinking next chord, clean ending, neck follows, original tempo, count-in, tempo change in place, song loop, practice switches";
    }

    if (scheme === "light") {
      // The tuner: the strings of the chosen instrument, the nearest one heard through the pitch-detector worklet, its
      // cents on the tacho, a picked string, and the microphone released on stop.
      await choose("#instrument", "guitar");
      const strings = () => page.$$eval("#tuner-strings [data-string]", (bs) => bs.map((b) => b.textContent));
      await page.waitForFunction(() => document.querySelectorAll("#tuner-strings [data-string]").length === 7);
      assert.deepEqual(await strings(), ["Auto", "E2", "A2", "D3", "G3", "B3", "E4"]);
      await page.click("#tuner-listen");
      await page.waitForFunction(() => document.querySelector('#tuner-strings [data-string="s5"][data-heard]'), undefined, { timeout: 10000 });
      assert.deepEqual(await page.evaluate(() => window.__constraints), { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const dial = () => page.evaluate(() => ({ cents: df$.shadcn.tacho.value("#tuner"), label: document.querySelector("#tuner .tacho-label").textContent,
        caption: document.querySelector("#tuner .tacho-caption").textContent, status: document.getElementById("tuner-status").textContent }));
      await page.evaluate(() => { window.__tone.frequency.value = 110 * 2 ** (30 / 1200); });
      await page.waitForFunction(() => Math.abs(df$.shadcn.tacho.value("#tuner") - 30) < 2, undefined, { timeout: 10000 });
      const sharp = await dial();
      assert.equal(sharp.label, "A");
      assert.match(sharp.caption, /^A2 · \+(2[89]|3[0-2]) ct$/);
      assert.match(sharp.status, /String 5 \(A2\) is sharp/);
      await page.evaluate(() => { window.__tone.frequency.value = 329.6276; });
      await page.waitForFunction(() => document.querySelector('#tuner-strings [data-string="s1"][data-in-tune]'), undefined, { timeout: 10000 });
      assert.match((await dial()).status, /String 1 \(E4\) is in tune/);
      // A picked string is tuned whatever is heard: E4 is far above D3.
      await page.click('#tuner-strings [data-string="s4"]');
      await page.waitForFunction(() => document.querySelector("#tuner .tacho-label").textContent === "D", undefined, { timeout: 10000 });
      assert.match((await dial()).status, /String 4 \(D3\) is sharp/);
      // Another instrument: its strings, and the detector reconfigured while listening.
      await choose("#instrument", "uke-high-g");
      await page.waitForFunction(() => document.querySelectorAll("#tuner-strings [data-string]").length === 5);
      assert.deepEqual(await strings(), ["Auto", "G4", "C4", "E4", "A4"]);
      await page.evaluate(() => { window.__tone.frequency.value = 261.6256 * 2 ** (-8 / 1200); });
      await page.waitForFunction(() => document.querySelector('#tuner-strings [data-string="s3"][data-heard]'), undefined, { timeout: 10000 });
      await page.waitForFunction(() => Math.abs(df$.shadcn.tacho.value("#tuner") + 8) < 2, undefined, { timeout: 10000 })
        .catch(async () => assert.fail(`C4 eight cents flat on the ukulele: ${JSON.stringify(await dial())}`));
      assert.match((await dial()).caption, /^C4 · /);
      await page.click("#tuner-listen");
      assert.equal(await page.getAttribute("#tuner-listen", "aria-pressed"), "false");
      assert.ok(await page.evaluate(() => window.__microphone.getTracks().every((t) => t.readyState === "ended")), "stop releases the microphone");
      report.tuner = "strings per instrument, nearest string, cents, in tune, picked string, reconfigure, microphone released";
    }

    // Lower difficulties pick simpler versions: fewer notes, each still fingered as written.
    await page.click('[data-song="rainbow"]');
    await settled();
    const sizes = {};
    for (const level of ["baby", "amateur", "pro", "maestro"]) {
      const state = await choose("#level", level);
      assert.equal(state.status, "success", `rainbow at ${level}: ${state.problem}`);
      assert.match(state.message, new RegExp(`the version written for ${level}`));
      const [kept, full] = counts(state);
      sizes[level] = kept;
      // Every version is compared with the maestro version.
      assert.equal(await page.textContent("#fact-notes-label"), "Notes vs. the maestro version");
      sizes[`${level}-of`] = full;
    }
    assert.ok(sizes.baby < sizes.amateur && sizes.amateur < sizes.pro, `simpler versions have fewer notes (${JSON.stringify(sizes)})`);
    assert.ok(["baby-of", "amateur-of", "pro-of"].every(k => sizes[k] === sizes.maestro), `every version counts against the maestro version (${JSON.stringify(sizes)})`);
    report.difficulty = sizes;

    // The same piece re-arranges for other instruments; tunings and string counts change with them.
    for (const [instrument, strings] of [["guitar", 6], ["uke-baritone", 4], ["guitar-8", 8]]) {
      const state = await choose("#instrument", instrument);
      assert.equal(state.status, "success", `rainbow on ${instrument}: ${state.problem}`);
      const [kept, total] = counts(state);
      assert.ok(kept === total, `rainbow on ${instrument}: every note is kept (${state.notes})`);
      const tuning = await page.evaluate(() => document.getElementById("song-tab").api.getState().config.data.tuning.length);
      assert.equal(tuning, strings, `rainbow on ${instrument}: the tab has ${strings} strings`);
      report[`rainbow-${instrument}`] = state.notes;
    }

    // A version that does not play on an instrument gives way to the next easier one, and the status says why.
    await page.click('[data-song="wicked"]');
    await settled();
    {
      const state = await choose("#instrument", "uke-high-g");
      assert.equal(state.status, "success", `wicked on ukulele: ${state.problem}`);
      assert.match(state.message, /Did not play: maestro version: proved impossible within the model/);
      assert.equal(await page.textContent("#fact-level"), "maestro · expert version");
    }
    // A beam can prune the only path through a chord change; the widest retry finds Rising Sun's semi-pro version.
    await page.click('[data-song="rising"]');
    await settled();
    {
      await choose("#instrument", "uke-low-g");
      const state = await choose("#level", "semi-pro");
      assert.equal(state.status, "success", `rising on low-G ukulele: ${state.problem}`);
      assert.equal(await page.textContent("#fact-level"), "semi-pro", `rising on low-G ukulele plays its semi-pro version (${state.message})`);
      report["rising-uke-low-g-semi-pro"] = state.notes;
      await page.selectOption("#level", "maestro");
    }

    await page.click('[data-song="greensleeves"]');
    await settled();
    {
      const state = await choose("#instrument", "uke-high-g");
      assert.equal(state.status, "success", `greensleeves on ukulele: ${state.problem}`);
      assert.match(state.message, /Adaptive mode/);
      await choose("#instrument", "guitar");
      const all = await choose("#voices", "all");
      assert.equal(all.status, "success", `greensleeves, all voices: ${all.problem}`);
      const [kept, total] = counts(all);
      assert.ok(kept === 235 && total === 235, `greensleeves, all voices on guitar keep every note (${all.notes})`);
      report["greensleeves-all"] = all.notes;
      await page.selectOption("#voices", "outer");
    }

    // Score files from the skill, opened from disk, get cards and arrange: a single score and a score set.
    const reel = JSON.parse(await readFile("skills/score-import/tests/fixtures/reel.scorify.json", "utf8"));
    const duet = JSON.parse(await readFile("skills/score-import/tests/fixtures/duet.scorify.json", "utf8"));
    const setFile = path.join(await mkdtemp(path.join(tmpdir(), "scorify-docs-")), "fixtures.scorify-set.json");
    await writeFile(setFile, JSON.stringify({ schema: "scorify-set-1", title: "Fixture set", variants: [
      { id: "reel", label: "Reel", difficulty: "amateur", score: reel },
      { id: "duet", label: "Duet", difficulty: "pro", score: duet },
    ] }));
    await page.setInputFiles("#score-file", [path.resolve("skills/score-import/tests/fixtures/reel.scorify.json"), setFile]);
    await page.waitForFunction(() => document.querySelectorAll(".sc-song[data-loaded]").length === 3, undefined, { timeout: 10000 });
    await settled();
    {
      const state = await snapshot();
      assert.equal(state.status, "success", `opened score set: ${state.problem}`);
      assert.match(await page.textContent(".sc-song[aria-pressed=true] .sc-song-meta"), /2 versions/);
      const easy = await choose("#level", "amateur");
      assert.match(easy.message, /“Reel”, the version written for amateur/);
      report.opened = easy.notes;
    }
    // A sung part is shown, not played: one lane of words per verse, and its notes are not counted.
    await page.setInputFiles("#score-file", path.resolve("skills/score-import/tests/fixtures/verses.scorify.json"));
    await page.waitForFunction(() => document.querySelectorAll(".sc-song[data-loaded]").length === 4, undefined, { timeout: 10000 });
    await settled();
    {
      const state = await snapshot();
      assert.equal(state.status, "success", `opened sung score: ${state.problem}`);
      const lanes = await page.evaluate(() => document.getElementById("song-tab").api.getState().config.data.scores[0].tracks
        .filter((t) => t.kind === "lyrics" && t.id !== "vocal-pitches").map((t) => t.items.map((i) => i.text).join(" ")));
      assert.deepEqual(lanes, ["Here we go a- round, now we go home.", "Sing the sec- ond verse just the same way."], "verses: every verse gets its lane");
      const [kept, total] = counts(state);
      assert.ok(kept === 7 && total === 7, `verses: only the accompaniment is played (${state.notes})`);
      assert.match(state.message, /sung part \(9 notes\)/);
      report.verses = lanes.length;
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll(".sc-song[data-loaded]").length === 4, undefined, { timeout: 15000 });
      await settled();
      report.remembered = await page.locator(".sc-song[data-loaded]").count();
    }

    if (scheme === "light") {
      // Precomputed arrangements replay without a search; the suggested capo toggles between two cached arrangements,
      // and its chords are named by the shapes fingered behind it.
      const view = () => page.evaluate(() => ({
        status: document.getElementById("playground").dataset.status,
        search: document.getElementById("fact-search").textContent, title: document.getElementById("tab-title").textContent,
        tuning: document.getElementById("fact-tuning").textContent, mode: document.getElementById("mode-badge").textContent,
        capo: document.querySelector(".sc-capo").hidden ? null : document.getElementById("capo-label").textContent,
        chords: [...new Set((document.getElementById("song-tab").api.getState().config.data.scores[0].tracks.find(t => t.kind === "chords")?.items ?? [])
          .map(i => i.name ?? i.text))].sort().join(" "),
      }));
      await page.click('[data-song="wicked"]');
      await settled();
      let state = await view();
      assert.match(state.search, / · cached$/, "a usual configuration replays the precomputed cache");
      assert.deepEqual([state.chords, state.capo], ["A Bm E", "Capo on fret 2 · Am G D shapes"]);
      await page.click("#capo");
      await settled();
      state = await view();
      assert.deepEqual([state.status, state.chords], ["success", "Am D G"]);
      assert.match(state.title, / · capo 2$/);
      assert.match(state.tuning, / · capo 2$/);
      await page.click("#capo");
      await settled();
      assert.equal((await view()).chords, "A Bm E");

      // Custom mode: a transposed song is searched, suggests its own capo, exports, saves, imports and resets.
      await page.click('[data-song="rainbow"]');
      await choose("#level", "beginner");
      await page.click("#custom-panel summary");
      await page.fill("#c-transpose", "3");
      await page.click("#c-run");
      await settled();
      state = await view();
      assert.equal(state.status, "success");
      assert.match(state.mode, /^Custom · /);
      assert.equal(state.chords, "Ab Bb Cm Eb Gm");
      assert.equal(state.capo, "Capo on fret 3 · C Em Am F G shapes");
      await page.click("#capo");
      await settled();
      assert.equal((await view()).chords, "Am C Em F G");
      const [download] = await Promise.all([page.waitForEvent("download"), page.click("#c-export")]);
      const exported = JSON.parse(await readFile(await download.path(), "utf8"));
      assert.equal(exported.schema, "scorify-arrangement-1");
      assert.deepEqual([exported.piece.type, exported.piece.id, exported.request.capo, exported.request.custom.transpose], ["song", "rainbow", 3, 3]);
      assert.equal(exported.log.at(-1).status, "success");
      await page.click("#c-save");
      await page.waitForSelector("#saved-list li");
      assert.match(await page.locator("#saved-list li").first().innerText(), /Somewhere Over the Rainbow · .* · capo 3 · custom/);
      await page.click("#c-reset");
      await settled();
      state = await view();
      assert.deepEqual([state.mode.startsWith("Custom"), state.capo, await page.isVisible("#custom-state")], [false, null, false]);
      // The file is read asynchronously: mark the playground busy so settled() waits for the import's own arrangement.
      await page.evaluate(() => { document.getElementById("playground").dataset.status = "loading"; });
      await page.setInputFiles("#c-file", { name: "rainbow.arrangement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
      await settled();
      state = await view();
      assert.deepEqual([state.status, state.chords, state.search.endsWith(" · cached")], ["success", "Am C Em F G", true]);
      assert.equal(await page.inputValue("#c-transpose"), "3");
      await page.click("#c-reset");
      await settled();
      report.cache = "precomputed replay, capo toggle and shape names, custom transpose with its own capo, export, save, import, reset";

      // A log this browser kept for the same request (an earlier build's search, say) does not hide the precomputed one:
      // every cached layer is offered for replay, and only matching attempts replay.
      await page.click('[data-song="wicked"]');
      await choose("#level", "amateur");
      await page.evaluate(async () => {
        const { songs, cacheKey } = await import(new URL("assets/songs.mjs", location.href).href);
        const { build } = await import(new URL("assets/scorify/build.mjs", location.href).href);
        const request = { instrumentId: document.getElementById("instrument").value, level: "amateur", bpm: Number(document.getElementById("tempo").value), capo: 0, custom: null };
        const key = cacheKey(songs.find((s) => s.id === "wicked"), request);
        await new Promise((resolve, reject) => {
          const open = indexedDB.open("scorify-demo", 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction("results", "readwrite");
            tx.objectStore("results").put({ key, build, storedAt: Date.now(), log: [{ version: "amateur", simplify: false, status: "search-exhausted", fingerprint: "stale" }] });
            tx.oncomplete = () => { open.result.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
        });
      });
      await page.reload();
      await settled();
      await page.click('[data-song="wicked"]');
      await settled();
      await choose("#level", "amateur");
      assert.equal(await page.inputValue("#level"), "amateur");
      assert.match(await page.textContent("#fact-search"), / · cached$/, "a stale browser entry does not hide the precomputed log");
      assert.equal(JSON.parse(await page.textContent("#result-json")).cache, "the precomputed cache");

      // Sound effects: every effect on by default, switches remembered, the WAV rendered through the library's chain.
      const fx = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-fx]")].map((i) => [i.dataset.fx, i.checked])));
      assert.deepEqual(await fx(), { delay: true, reverb: true, saturation: true });
      await page.click("label[for=fx-delay]");
      assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("scorify-demo-effects-2"))).delay, false);
      await play();
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => document.getElementById("playground").dataset.playback), "playing");
      await page.click("#stop");
      const [wav] = await Promise.all([page.waitForEvent("download"), page.click("#download")]);
      const bytes = await readFile(await wav.path());
      assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
      await page.click("label[for=fx-delay]");
      assert.deepEqual(await fx(), { delay: true, reverb: true, saturation: true });

      // Print: the title, the tab at page width and every chord chart, then the page comes back as it was.
      await page.evaluate(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
      const screenCharts = await page.locator(".sc-charts .chord-chart").count();
      await page.click("#print");
      await page.waitForFunction(() => window.__prints === 1);
      const sheet = await page.evaluate(() => ({
        title: document.querySelector("#print-sheet .sc-print-head h1")?.textContent,
        lines: document.querySelectorAll("#print-sheet .fretboard-line").length,
        charts: document.querySelectorAll("#print-sheet .sc-print-charts .chord-chart").length,
        active: document.querySelectorAll("#print-sheet .chord-chart[data-active]").length,
        dark: document.documentElement.classList.contains("dark"),
      }));
      assert.equal(sheet.title, await page.textContent("#song-title"));
      assert.ok(sheet.lines > 0, "the tab is on the page");
      assert.deepEqual([sheet.charts, sheet.active, sheet.dark], [screenCharts, 0, false]);
      if (shots) await page.pdf({ path: path.join(shots, "print.pdf"), format: "A4" }).catch(() => {});
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      assert.deepEqual(await page.evaluate(() => [document.getElementById("song-tab").closest("#playground") !== null, document.documentElement.hasAttribute("data-printing"), document.getElementById("print-sheet").children.length]), [true, false, 0]);

      // The skill section names both agents and how to install.
      assert.match(await page.textContent("#skill"), /Claude Code[\s\S]*Codex/);
      assert.match(await page.locator("#skill pre[data-tab=claude]").innerText(), /\/plugin install score-import --marketplace kyr0\/scorify/);
      await page.click("#skill label:has(input[value=codex])");
      assert.match(await page.locator("#skill pre[data-tab=codex]").innerText(), /\$skill-installer install https:\/\/github\.com\/kyr0\/scorify\/tree\/main\/skills\/score-import/);
      report.extras = "effects default and remembered, playback and WAV through the library chain, print view with tab and charts, skill install section";

      // The library's vertical tabs: scales on the instrument on show, then the Billboard chord progressions.
      await page.click('[data-song="rainbow"]');
      await settled();
      const tabNotes = () => page.evaluate(() => document.getElementById("song-tab").api.getState().config.data.scores[0].tracks
        .find((t) => t.kind === "tab")?.items.flatMap((i) => i.notes ?? []) ?? []);
      await page.click("#library-tab-scales");
      await settled();
      let practiced = await snapshot();
      assert.equal(practiced.status, "success", practiced.problem);
      assert.deepEqual([await page.textContent("#song-title"), await page.inputValue("#key"), await page.textContent("#rhythm-badge")], ["C major scale", "C", "Scale · 4/4 · eighths"]);
      assert.equal((await tabNotes()).length, 15, "one octave up and down: fifteen notes");
      assert.match(practiced.message, /One octave up and down in eighths, every note as written/);
      // The Key select sets the tonic, spelled as written for the scale's quality.
      practiced = await choose("#key", "F#");
      assert.equal(await page.textContent("#song-title"), "F# major scale");
      await choose("#scale", "natural-minor");
      assert.equal(await page.inputValue("#key"), "F#", "F# stays F# in minor");
      await choose("#scale", "major");
      // Two octaves of F major end on F6: above an 18-fret high-G ukulele, inside a 20-fret one.
      await choose("#key", "F");
      practiced = await choose("#scale-octaves", "2");
      assert.match(practiced.problem ?? "", /2 octaves of the F major scale do not fit the ukulele/);
      assert.equal(await page.isDisabled("#play"), true);
      await page.evaluate(() => { const slider = document.getElementById("frets"); slider.value = "20"; slider.dispatchEvent(new Event("input")); slider.dispatchEvent(new Event("change")); });
      await settled();
      practiced = await snapshot();
      assert.equal(practiced.status, "success", practiced.problem);
      assert.equal((await tabNotes()).length, 29);
      await page.click("#frets-usual");
      await settled();
      assert.match((await snapshot()).problem ?? "", /do not fit/);
      await choose("#scale-octaves", "1");
      // Another meter keeps the note value where it has one: eighths in 4/4 stay eighths in 6/8.
      // Time sits next to Key for scales and progressions only.
      assert.deepEqual(await page.evaluate(() => ["key", "meter", "style"].map((id) => document.getElementById(id).closest(".sc-control").previousElementSibling?.querySelector("select")?.id ?? null)), ["level", "key", "meter"]);
      practiced = await choose("#meter", "6/8");
      assert.deepEqual([practiced.status, await page.inputValue("#scale-rhythm"), await page.textContent("#rhythm-badge")], ["success", "3", "Scale · 6/8 · eighths"]);
      await choose("#meter", "4/4");
      // Play: the scale down, then its chords; chords take neither octaves nor notes per beat.
      practiced = await choose("#style", "down");
      assert.deepEqual([practiced.status, (await tabNotes()).length], ["success", 8]);
      assert.match(practiced.message, /One octave down in eighths/);
      practiced = await choose("#style", "strum");
      assert.equal(practiced.status, "success", practiced.problem);
      // Strummed means strummed at every difficulty: no picked arpeggio or bass.
      assert.doesNotMatch(practiced.message, /arpeggio|bass/i);
      assert.deepEqual([await page.textContent("#song-title"), await page.isDisabled("#scale-octaves"), await page.isDisabled("#scale-rhythm")], ["F major scale in chords", true, true]);
      // Each chord name has an xs button for its next inversion and one back as written. The ukulele's F (2010) has C4
      // lowest, so it is written in second inversion: the button goes on to root position, then F/A, and back.
      const chordNames = () => page.evaluate(() => [...document.querySelectorAll("#song-tab .fretboard-chord")].slice(0, 3).map((e) => e.textContent.trim()));
      const invertLabel = () => page.getAttribute("#song-tab .fretboard-chord >> nth=0 >> .sc-invert", "aria-label");
      assert.deepEqual((await chordNames()).slice(0, 2), ["F", "Gm"]);
      assert.equal(await invertLabel(), "F in bar 1: second inversion; next root position");
      assert.equal(await page.isDisabled("#song-tab .fretboard-chord >> nth=0 >> .sc-invert-reset"), true);
      await page.click("#song-tab .fretboard-chord >> nth=0 >> .sc-invert");
      await settled();
      practiced = await snapshot();
      assert.equal(practiced.status, "success", practiced.problem);
      assert.match(practiced.message, /Inverted as asked: F in bar 1 in root position/);
      assert.deepEqual([(await chordNames())[0], await invertLabel(), await page.isDisabled("#song-tab .fretboard-chord >> nth=0 >> .sc-invert-reset")], ["F", "F in bar 1: root position; next first inversion", false]);
      await page.click("#song-tab .fretboard-chord >> nth=0 >> .sc-invert");
      await settled();
      practiced = await snapshot();
      assert.equal(practiced.status, "success", practiced.problem);
      assert.deepEqual((await chordNames()).slice(0, 2), ["F/A", "Gm"]);
      assert.match(practiced.message, /Inverted as asked: F in bar 1 in first inversion/);
      assert.equal(await invertLabel(), "F in bar 1: first inversion; next second inversion");
      await page.click("#song-tab .fretboard-chord >> nth=0 >> .sc-invert-reset");
      await settled();
      assert.deepEqual([(await snapshot()).status, (await chordNames())[0]], ["success", "F"]);
      practiced = await choose("#style", "up-down");
      assert.deepEqual([await page.isDisabled("#scale-octaves"), await page.textContent("#song-title")], [false, "F major scale"]);
      // A scale without a chord on every degree offers no chords.
      await choose("#scale", "blues");
      assert.equal(await page.isDisabled('#style option[value="strum"]'), true);
      await choose("#scale", "major");
      // Baby plays nothing shorter than a quarter: eighths are reported, not thinned.
      practiced = await choose("#level", "baby");
      assert.match(practiced.problem ?? "", /Baby plays nothing shorter than a quarter note/);
      practiced = await choose("#scale-rhythm", "1");
      assert.equal(practiced.status, "success", practiced.problem);
      await choose("#level", "maestro");

      await page.click("#library-tab-progressions");
      await settled();
      practiced = await snapshot();
      assert.equal(practiced.status, "success", practiced.problem);
      assert.equal(await page.locator("#progression-list .sc-progression").count(), 13);
      assert.deepEqual([await page.textContent("#song-title"), await page.inputValue("#key")], ["I–IV–V–I", "0"]);
      assert.deepEqual([await page.inputValue("#style"), /arpeggio|bass/i.test(practiced.message)], ["strum", false]);
      // Pattern: the versions by difficulty, or a strumming pattern of the meter; a bass under the strum needs a guitar.
      assert.deepEqual([await page.isHidden("#pattern"), await page.inputValue("#pattern"), await page.isDisabled('#pattern option[value="boom-chick"]')], [false, "", true]);
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#pattern optgroup")].map((g) => g.label)), ["Island and reggae", "Pop, rock and funk", "Folk and country", "Swing and blues"]);
      practiced = await choose("#pattern", "island");
      assert.equal(practiced.status, "success", practiced.problem);
      assert.match(practiced.message, /“Island strum: D · D U · U D U”/);
      assert.equal(await page.textContent("#rhythm-badge"), "Progression · 4/4 · 1 version");
      practiced = await choose("#pattern", "");
      assert.equal(await page.textContent("#rhythm-badge"), "Progression · 4/4 · 7 versions");
      assert.match(await page.textContent('[data-progression="I-IV-V-I"]'), /C F G C.*42 of 739 songs/);
      // The Key select moves the progression and the cards' chords.
      practiced = await choose("#key", "2");
      assert.equal(practiced.status, "success", practiced.problem);
      assert.match(await page.textContent('[data-progression="I-bVII-IV-I"]'), /D C G D/);
      await page.click('[data-progression="12-bar-blues"]');
      await settled();
      assert.deepEqual([await page.textContent("#song-title"), await page.inputValue("#key"), await page.getAttribute('[data-progression="12-bar-blues"]', "aria-pressed")], ["12-bar blues", "2", "true"]);
      practiced = await choose("#meter", "12/8");
      assert.deepEqual([practiced.status, await page.textContent("#rhythm-badge"), await page.inputValue("#tempo")], ["success", "Progression · 12/8 · 7 versions", "72"]);
      // Played as an arpeggio, and a chord of it inverted.
      practiced = await choose("#style", "arpeggio-up");
      assert.equal(practiced.status, "success", practiced.problem);
      assert.match(practiced.message, /Arpeggio up, \d+ notes a bar/);
      assert.equal(await page.isHidden("#pattern"), true);
      await page.click("#song-tab .fretboard-chord >> nth=0 >> .sc-invert");
      await settled();
      practiced = await snapshot();
      assert.equal(practiced.status, "success", practiced.problem);
      assert.match((await chordNames())[0], /^D7\/F#$/);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("scorify-demo-library-2"))), {
        scale: { scale: "major", tonic: "F", octaves: 1, perBeat: 1, time: [4, 4], play: "up-down" }, progression: { id: "12-bar-blues", time: [12, 8], style: "arpeggio-up", pattern: "" },
      });
      // Back on Songs, the song that was on show, in its own key.
      await page.click("#library-tab-songs");
      await settled();
      assert.deepEqual([await page.textContent("#song-title"), await page.inputValue("#key"), (await snapshot()).status, await page.isHidden("#meter")], ["Somewhere Over the Rainbow", "0", "success", true]);
      // A song's chords have the buttons too: Rainbow's first C to its first inversion, searched in the browser.
      await page.click("#song-tab .fretboard-chord >> nth=0 >> .sc-invert");
      await settled();
      assert.deepEqual([(await snapshot()).status, (await chordNames())[0]], ["success", "C/E"]);
      await page.click("#song-tab .fretboard-chord >> nth=0 >> .sc-invert-reset");
      await settled();
      assert.deepEqual([(await snapshot()).status, (await chordNames())[0]], ["success", "C"]);
      report.practice = "scale tab (tonic, spelling, neck fit and highest fret, Time and Play next to Key, directions, chords strummed without arpeggios, baby's shortest note), progression tab (Billboard cards, key, strum without arpeggios, strumming patterns, blues, 12/8, arpeggio), inversion buttons in scales, progressions and songs, remembered choices, back to songs";
    }

    // The API tabs and the theme switch are wired by defuss-shadcn and app.mjs.
    await page.click("#tab-options");
    assert.equal(await page.isVisible("#api-options"), true);
    assert.equal(await page.isVisible("#api-functions"), false);
    const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    assert.equal(dark, scheme === "dark");
    await page.locator("label.swap:has(#theme-toggle)").click();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), !dark);

    if (shots) await page.screenshot({ path: path.join(shots, `page-${scheme}.png`), fullPage: true });
    assert.deepEqual(errors, [], `${scheme}: no page errors`);
    await page.close();
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.close();
}
