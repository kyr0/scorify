// The landing page script. index.html loads defuss-shadcn (df$) from jsDelivr first; this module wires the page and runs
// the playground on the locally built scorify modules in ./scorify/ (bun run build:docs copies dist/ there).
const $ = id => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// ---- theme: one switch, stored the way other defuss-shadcn pages store it ---------------------------------------------
const themeToggle = $("theme-toggle");
themeToggle.checked = document.documentElement.classList.contains("dark");
themeToggle.addEventListener("change", () => {
  const dark = themeToggle.checked;
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  try { localStorage.setItem("defuss-shadcn-theme", JSON.stringify(dark ? "dark" : "light")); } catch {}
});

// ---- in-page links scroll without adding history entries ------------------------------------------------------------
// Layout offsets ignore transforms, so a section still in its scroll-driven reveal lands at its scroll margin.
document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target.closest('a[href^="#"]');
  let id = "";
  try { id = anchor ? decodeURIComponent(anchor.hash.slice(1)) : ""; } catch { return; }
  const target = id && document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  let top = 0;
  for (let node = target; node; node = node.offsetParent) top += node.offsetTop;
  scrollTo({ top: top - parseFloat(getComputedStyle(target).scrollMarginTop || "0"), behavior: reducedMotion.matches ? "auto" : "smooth" });
  history.replaceState(history.state, "", anchor.hash);
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
});

// ---- copy buttons ---------------------------------------------------------------------------------------------------
async function copyText(text, status, label) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Copied";
  } catch {
    status.textContent = "Copy failed";
  }
  if (!label) return;
  label.textContent = status.textContent;
  setTimeout(() => { label.textContent = "Copy prompt"; }, 2000);
}
for (const button of document.querySelectorAll(".mk-code-block .mk-code-block-copy")) {
  button.addEventListener("click", () => {
    const block = button.closest(".mk-code-block");
    const tab = block.querySelector(".mk-code-block-tabs input:checked")?.value;
    const pre = tab ? block.querySelector(`pre[data-tab="${tab}"]`) : block.querySelector("pre");
    const lines = [...pre.querySelectorAll("code > span")].map(line => line.textContent);
    void copyText(lines.join("\n"), block.querySelector(".mk-code-block-status"));
  });
}
$("copy-prompt").addEventListener("click", () => void copyText(
  [...document.querySelectorAll("#agent-prompt pre:not([data-tone]) code")].map(code => code.textContent).join("\n"),
  $("copy-prompt-status"), $("copy-prompt").querySelector("span")));

// ---- playground -----------------------------------------------------------------------------------------------------
// The worker searches; this page only draws what the solver returned and plays what createPerformance validated.
const playground = $("playground"), tab = $("song-tab");
const LEVELS = { baby: "Baby", beginner: "Beginner", amateur: "Amateur", "semi-pro": "Semi-pro", pro: "Pro", expert: "Expert", maestro: "Maestro" };
const STATUS = {
  infeasible: "proved impossible within the model",
  "search-exhausted": "search budget exhausted, not a proof",
  limits: "exceeds the difficulty before any search",
  voicing: "no chord shape it can play",
};

/** Progress and problems only: a ready arrangement explains itself under "About this arrangement". */
function setStatus(text, busy = false) {
  $("status").hidden = !text && !busy;
  $("status").replaceChildren(...(busy ? [Object.assign(document.createElement("span"), { className: "spinner" })] : []), text);
  $("status").querySelector(".spinner")?.setAttribute("data-size", "sm");
}
function showProblem(title, lines) {
  $("problem-title").textContent = title;
  $("problem-text").replaceChildren(...lines.map(line => Object.assign(document.createElement("p"), { textContent: line })));
  $("problem").hidden = false;
}
function fatal(message) {
  playground.dataset.status = "error";
  playground.setAttribute("aria-busy", "false");
  $("cancel").hidden = true;
  setStatus("The playground is unavailable.");
  showProblem("The playground could not start", [message, "Serve the complete docs/ folder over HTTP (bun run build:docs && bun run dev:docs) and reload."]);
}

async function componentsReady() {
  const deadline = performance.now() + 10000;
  while (!tab.api || !$("live-neck").api || !globalThis.df$?.shadcn?.tacho || !$("tuner")._tacho) {
    if (performance.now() > deadline) throw new Error("The defuss-shadcn Fretboard and Tacho components did not load.");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

try {
  const [songsModule, { createWorkerClient }, { quartersAtSeconds, secondsAt, q, normalizeScore, compilePlayer, pitchToMidi }] = await Promise.all([
    import("./songs.mjs"), import("./scorify/worker.mjs"), import("./scorify/index.mjs"), componentsReady(),
  ]);
  const { songs, instruments, pieceFromScore, songFromChart, tabFor, strokesFor, arrangeFor, retime, versionById, KEY_SHIFTS, keyName, tempoFor, hardestVersion, hardestNotes, cacheKey, cacheable, searched, suggestCapo, highestFret, SET_SCHEMA, ARRANGEMENT_SCHEMA,
    instrumentFor, customInstrumentId, transposeSong, scalePiece, scaleOnNeck, scaleRhythms, progressionSong, PROGRESSIONS, BILLBOARD_SONGS, SCALES, TONICS,
    PROGRESSION_STYLES, scaleChordsSong, scaleTriads, INVERSION_NAMES, STRUM_PATTERNS } = songsModule;
  // The cache version (src/VERSION): results this browser cached under another version are not used.
  const { build } = await import("./scorify/build.mjs");
  const worker = new Worker(new URL("./scorify/worker-entry.mjs", import.meta.url), { type: "module" });
  const client = createWorkerClient(worker);
  const pieces = new Map(songs.map(s => [s.id, s]));
  // Where each piece's precomputed arrangements are, and what an exported arrangement needs to rebuild it.
  for (const song of songs) Object.assign(song, { cacheBase: "assets/cache/", origin: { type: "song", id: song.id } });
  // `arranged`: the successful run on show, with its request, which a tempo change moves (retime: playback only).
  let piece = songs[0], result, instrument, plan, attempt, audio, context, arranged;
  let revision = 0;

  // The instrument picker lists the catalog in songs.mjs, grouped by family.
  const picker = $("instrument");
  for (const group of [...new Set(instruments.map(i => i.group))]) {
    const optgroup = Object.assign(document.createElement("optgroup"), { label: group });
    for (const i of instruments.filter(i => i.group === group)) optgroup.append(new Option(i.name, i.id));
    picker.append(optgroup);
  }

  // ---- transport ------------------------------------------------------------------------------------------------------
  // Every playback is a fresh take: createPerformance with a new seed re-humanizes strums, dynamics and drift within
  // the same validated rules, so no two playbacks sound the same, and every pass of a loop is a new take too. A take is
  // rendered offline (the same samples the AudioWorklet player makes) in segments that are queued one ahead on
  // AudioBufferSourceNodes, with a few milliseconds of crossfade. The tab is the transport: its play toggle, Space, a
  // click on a measure and its loop all go through tab.api.setState, which is wrapped here so they make sound. The
  // audio clock then moves the playhead.
  const setTab = tab.api.setState.bind(tab.api);
  let quiet = false, voice, transport = "stopped", audioRevision = 0, raf = 0, lastDraw = -1, takes = 0, tabBeats = 0;
  // A strum is centered on its beat, so its first strings sound up to ~30 ms early: playback starts and loops PRE
  // seconds before a bar line. RING seconds of earlier notes are rendered so strings already ringing carry into a
  // segment; non-loop playback is rendered in CHUNK-second segments so it starts at once.
  const PRE = 0.05, RING = 4, FADE = 0.008, CHUNK = 6;
  // Sound effects after the rendered strings: scorify's effect chain (scorify/audio-effects), live in an AudioWorklet
  // node and offline in the WAV, so both sound alike. The echo is a dotted eighth at the tempo. The switches are
  // remembered in this browser (a new key, so earlier choices do not hide the defaults); every effect is on by default.
  const EFFECTS_KEY = "scorify-demo-effects-2", effects = { delay: true, reverb: true, saturation: true };
  try {
    const stored = JSON.parse(localStorage.getItem(EFFECTS_KEY) ?? "{}");
    for (const id of Object.keys(effects)) if (typeof stored[id] === "boolean") effects[id] = stored[id];
  } catch { /* storage unavailable: the defaults apply */ }
  let effectsNode, effectsReady;
  const effectSettings = () => ({ ...effects, delaySeconds: audio.delayForTempo(Number($("tempo").value) * piece.beat) });
  for (const input of document.querySelectorAll("[data-fx]")) {
    input.checked = effects[input.dataset.fx];
    input.addEventListener("change", () => {
      effects[input.dataset.fx] = input.checked;
      effectsNode?.set({ [input.dataset.fx]: input.checked });
      try { localStorage.setItem(EFFECTS_KEY, JSON.stringify(effects)); } catch { /* not remembered */ }
    });
  }
  // Practice sounds (scorify/audio-guide): the voice part sung by a soft, lowpassed synthesized voice, and a metronome
  // of a kick on the strong beats and a clap between. Both are rendered with every segment and switched by a gain, so a
  // switch takes effect at once. The voice sings through the effects, in the same room; the metronome stays dry.
  // Playback counts in one bar before it starts (not on a loop's next pass); the Loop swap plays the song again from
  // the beginning when it ends. Remembered in this browser (a new key, as for the effects); the voice and the metronome
  // (the Beat switch) are on by default.
  const PRACTICE_KEY = "scorify-demo-practice-2", practice = { voice: true, metronome: true, loop: false };
  try {
    const stored = JSON.parse(localStorage.getItem(PRACTICE_KEY) ?? "{}");
    for (const id of Object.keys(practice)) if (typeof stored[id] === "boolean") practice[id] = stored[id];
  } catch { /* storage unavailable: the defaults apply */ }
  const rememberPractice = () => { try { localStorage.setItem(PRACTICE_KEY, JSON.stringify(practice)); } catch { /* not remembered */ } };
  let buses, sung = { plan: undefined, notes: [] };
  for (const input of document.querySelectorAll("[data-guide]")) {
    input.checked = practice[input.dataset.guide];
    input.addEventListener("change", () => {
      practice[input.dataset.guide] = input.checked;
      buses?.[input.dataset.guide].gain.setTargetAtTime(input.checked ? 1 : 0, context.currentTime, 0.01);
      rememberPractice();
    });
  }
  $("loop-song").checked = practice.loop;
  $("loop-song").addEventListener("change", () => {
    practice.loop = $("loop-song").checked;
    rememberPractice();
    // While playing without a loop of bars, the song loop takes effect with the next segment.
    if (transport !== "playing" || !voice || loopSeconds()) return;
    voice.loop = loopBounds();
    playground.dataset.loop = voice.loop ? "song" : "off";
  });
  const tabState = (name, config = {}) => { quiet = true; try { return setTab(name, config); } finally { quiet = false; } };
  tab.api.setState = (name, config = {}) => {
    const outcome = setTab(name, config);
    if (!quiet) void follow(name, config);
    return outcome;
  };
  const beatsPerQuarter = () => piece.time[1] / 4;
  /** Seconds into the performance for a tab position (beats from the start, the padded pickup bar included). */
  function secondsAtBeat(beats) {
    const quarters = beats / beatsPerQuarter() - (piece.pad ?? 0);
    return plan.leadInSeconds + (quarters > 0 ? secondsAt(q(Math.round(quarters * 960), 960), plan.score.tempoMap) : 0);
  }
  const beatAtSeconds = seconds => (quartersAtSeconds(Math.max(0, seconds - plan.leadInSeconds), plan.score.tempoMap) + (piece.pad ?? 0)) * beatsPerQuarter();
  /** The tab's loop as performance seconds, or null. */
  function loopSeconds() {
    const loop = tab.api.getState().config.loop;
    return loop ? [secondsAtBeat((loop.start - 1) * piece.time[0]), secondsAtBeat(loop.end * piece.time[0])] : null;
  }
  /** What loops, as sound seconds (PRE early): the tab's loop of bars, else the whole song when Loop is on. */
  function loopBounds() {
    const bounds = loopSeconds() ?? (practice.loop ? [secondsAtBeat(0), secondsAtBeat(tabBeats)] : null);
    return bounds && [Math.max(0, bounds[0] - PRE), bounds[1] - PRE];
  }
  /** Seconds of the beat at a tab beat (the next beat's start minus its own; at the end, the one before). */
  const beatSecondsAt = beat => beat + 1 <= tabBeats ? secondsAtBeat(beat + 1) - secondsAtBeat(beat) : secondsAtBeat(beat) - secondsAtBeat(beat - 1);
  /** The sung line in performance seconds at its sounding pitch, for the guide voice (moves with the tempo). */
  function sungLine() {
    if (sung.plan !== plan) {
      const pad = piece.pad ?? 0, bpq = beatsPerQuarter();
      sung = { plan, notes: (attempt?.vocal ?? []).map(([onset, length, pitch]) => ({
        onsetSeconds: secondsAtBeat((onset + pad) * bpq), endSeconds: secondsAtBeat((onset + length + pad) * bpq),
        frequency: 440 * 2 ** ((pitchToMidi(pitch) - 69) / 12),
      })).filter(n => n.endSeconds > n.onsetSeconds && n.frequency >= 20 && n.frequency <= 5000) };
    }
    return sung.notes;
  }
  /** The metronome's clicks in performance seconds [from, to): the song's beats, not the silent pickup padding. */
  function clicksIn(from, to) {
    const [numerator, denominator] = piece.time, pattern = audio.clickPattern(numerator, denominator), clicks = [];
    const pad = (piece.pad ?? 0) * beatsPerQuarter();
    for (let beat = Math.max(Math.ceil(pad - 1e-6), Math.floor(beatAtSeconds(from)) - 1); beat < tabBeats; beat++) {
      const at = secondsAtBeat(beat);
      if (at >= to) break;
      const click = pattern.find(p => p.beat === beat % numerator);
      if (click && at >= from) clicks.push({ atSeconds: at, kind: click.kind, accent: click.accent });
    }
    return clicks;
  }
  /** The segment sounding now: the last scheduled one that has started (before the first starts, the first). */
  function segmentNow() {
    const { segments } = voice;
    while (segments.length > 1 && segments[1].at <= context.currentTime) segments.shift();
    return segments[0];
  }
  /** Where the sound is now, in seconds into the performance: the clock follows each segment, loop passes included. */
  function nowSeconds() {
    if (!voice) return 0;
    const segment = segmentNow();
    return segment ? segment.from + Math.max(0, context.currentTime - segment.at) : voice.offset;
  }
  /** Where the playhead shows: the sound starts PRE early for centered strums, the playhead at the bar (or mark). */
  const shownSeconds = () => Math.max(nowSeconds(), segmentNow()?.mark ?? voice.mark);
  function buttons() {
    const play = $("play"), label = transport === "playing" ? "Pause" : transport === "paused" ? "Resume" : "Play";
    play.disabled = !plan;
    play.querySelector("span").textContent = label;
    play.setAttribute("aria-label", label);
    play.title = label;
    play.setAttribute("aria-pressed", String(transport === "playing"));
    $("download").disabled = $("print").disabled = !plan;
    $("stop").disabled = transport === "stopped";
  }
  function progress(seconds = 0) {
    const pct = plan ? Math.min(100, Math.max(0, seconds / plan.durationSeconds * 100)) : 0;
    $("play-progress").style.width = `${pct}%`;
    $("play-progress").parentElement.setAttribute("aria-valuenow", String(Math.round(pct)));
  }
  function silence() {
    audioRevision++;
    cancelAnimationFrame(raf);
    for (const node of voice?.nodes ?? []) { node.onended = null; try { node.stop(); } catch { /* not started */ } node.disconnect(); }
    voice = undefined;
  }
  /** Stop the sound; `rewind` puts the playhead back at the start (of the loop, if there is one). */
  function stopAudio({ rewind = true } = {}) {
    silence();
    transport = "stopped";
    delete playground.dataset.playback;
    if (rewind && result) {
      const loop = tab.api.getState().config.loop;
      tabState("default", { position: loop ? (loop.start - 1) * piece.time[0] : 0 });
      progress();
    }
    buttons();
  }
  // The feel is always a loose human one: centered strums, played dynamics, sub-cent drift (scorify/performance).
  // The tempo is playback only: the fingering was searched and validated with the difficulty's time limits at the
  // piece's own tempo, so a performance at any tempo does not check them again (timeLimits: false; the plan says so).
  const HUMANIZE = 0.8;
  const performanceOptions = () => ({ humanize: custom?.performance?.humanize ?? HUMANIZE, strokes: strokesFor(attempt.spec, result), timeLimits: false });
  /** A new take of the arranged fingering; the reference `plan` stands in if a take ever fails its own validation. */
  function performTake() {
    // A custom seed repeats one take; otherwise every playback is a new one.
    const performed = audio.createPerformance(result, instrument, { ...performanceOptions(), seed: custom?.performance?.seed ?? `${piece.id}:${Date.now()}:${++takes}` });
    playground.dataset.takes = String(takes);
    return performed.status === "success" ? performed.performance : plan;
  }
  const bufferOf = rendered => {
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: rendered.channels[0].length, sampleRate: rendered.sampleRate });
    buffer.copyToChannel(rendered.channels[0], 0);
    buffer.copyToChannel(rendered.channels[1], 1);
    return buffer;
  };
  /**
   * Seconds [from, to) of a take as AudioBuffers (to = Infinity: to the end, with the tail) and where `from` is in
   * them: the strings, the guide voice (if the piece has a sung part) and the metronome.
   */
  function renderSpan(take, from, to) {
    const begin = Math.max(0, from - RING), last = to === Infinity, until = last ? take.durationSeconds : to + FADE + 0.02;
    // Releases after the end of the segment are never heard, so notes are cut there and not rendered further.
    const events = take.events.filter(e => e.onsetSeconds >= begin && e.onsetSeconds < (last ? Infinity : to))
      .map(e => ({ ...e, onsetSeconds: e.onsetSeconds - begin, endSeconds: Math.min(e.endSeconds, until) - begin }));
    const rendered = audio.renderPerformance({ strings: take.strings, events, durationSeconds: until - begin, preset: take.preset },
      { sampleRate: context.sampleRate, tailSeconds: last ? 0.5 : 0 });
    const span = { startSeconds: begin, durationSeconds: rendered.channels[0].length / rendered.sampleRate, sampleRate: rendered.sampleRate };
    const line = sungLine();
    return {
      buffer: bufferOf(rendered), offset: from - begin,
      guide: {
        voice: line.length ? bufferOf(audio.renderGuideVoice(line, span)) : null,
        metronome: bufferOf(audio.renderClicks(clicksIn(begin, begin + span.durationSeconds), span)),
      },
    };
  }
  /** A CHUNK-second segment of a take from `from`: up to the loop's end, or to the end of the take with its tail. */
  const segmentFrom = (take, from, when) => {
    const { loop } = voice;
    return { take, from, when, to: loop ? Math.min(loop[1], from + CHUNK) : from + CHUNK >= take.durationSeconds ? Infinity : from + CHUNK };
  };
  /**
   * Render and schedule one segment, then the one after it while this one plays: CHUNK-second pieces of one take, and
   * at a loop's end its next pass from the loop's start, a new take; without a loop the last piece runs to the end of
   * the take. The strings, the guide voice and the metronome play from one render, with the same crossfades.
   */
  function queue(token, segment) {
    if (token !== audioRevision || !voice) return;
    const { take, from, to, when, first, pass } = segment, last = to === Infinity;
    const { buffer, offset, guide } = renderSpan(take, from, to);
    if (token !== audioRevision || !voice) return;
    const at = when ?? context.currentTime + 0.03;
    const sources = [[buffer, effectsNode?.node ?? context.destination], [guide.voice, buses.voice], [guide.metronome, buses.metronome]];
    const [node] = sources.filter(([b]) => b).map(([b, output]) => {
      const source = new AudioBufferSourceNode(context, { buffer: b }), gain = new GainNode(context, { gain: 0 });
      source.connect(gain).connect(output);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(1, at + FADE);
      if (!last) {
        gain.gain.setValueAtTime(1, at + (to - from));
        gain.gain.linearRampToValueAtTime(0, at + (to - from) + FADE);
      }
      source.start(at, offset, last ? undefined : to - from + FADE);
      voice.nodes.add(source);
      source.addEventListener("ended", () => { voice?.nodes.delete(source); gain.disconnect(); });
      return source;
    });
    node.onended = () => {
      if (!last || token !== audioRevision) return;
      // Loop switched on during the song's last piece: the song starts again.
      if (practice.loop && !loopSeconds()) { void start(0, { countIn: false }); return; }
      stopAudio(); summary(); playground.dataset.playback = "ended";
    };
    // The playhead shows the mark (or a loop pass's bar line) until the sound, PRE early, reaches it.
    voice.segments.push({ at, from, mark: first ? voice.mark : pass ? from + PRE : from });
    if (first) { lastDraw = -1; draw(token); }
    if (last) return;
    const next = at + (to - from);
    // Rendered when this segment starts, so one segment is queued ahead; the loop is read then, so Loop takes effect.
    setTimeout(() => {
      if (token !== audioRevision || !voice) return;
      const { loop } = voice;
      queue(token, loop && to >= loop[1] - 1e-6 ? { ...segmentFrom(performTake(), loop[0], next), pass: true } : segmentFrom(take, to, next));
    }, Math.max(0, (at - context.currentTime) * 1000));
  }
  /**
   * Play from a tab position (inside the loop, if there is one). From a stop or a pause it counts in one bar first:
   * the clicks of the bar before the next bar line, at the tempo there (a pickup falls into the count-in's last beats).
   */
  async function start(beats, { countIn = transport !== "playing" } = {}) {
    if (!plan) { tabState("paused"); return; }
    silence();
    const token = audioRevision;
    try {
      context ??= new AudioContext();
      await context.resume();
      effectsNode = await (effectsReady ??= audio.createEffectsNode(context, { workletUrl: new URL("./scorify/audio-worklet.mjs", import.meta.url), effects: effectSettings() }));
      if (token !== audioRevision || !plan) return;
      if (!buses) {
        buses = { voice: new GainNode(context, { gain: practice.voice ? 1 : 0 }), metronome: new GainNode(context, { gain: practice.metronome ? 1 : 0 }) };
        buses.voice.connect(effectsNode?.node ?? context.destination);
        buses.metronome.connect(context.destination);
      }
      const loop = loopBounds();
      // The sound starts PRE before the requested position (mark), where the playhead shows.
      let mark = secondsAtBeat(beats), offset = Math.max(0, mark - PRE);
      if (loop && (offset < loop[0] || offset >= loop[1])) [offset, mark] = [loop[0], loop[0] + PRE];
      else if (!loop && offset >= plan.durationSeconds - 0.01) [offset, mark] = [0, 0];
      const take = performTake();
      voice = { nodes: new Set(), segments: [], offset, loop, mark };
      // The count-in: one bar of clicks ending at the bar line the playback starts on (or, from inside a bar, the next
      // one; the tab's position runs a little ahead of a bar line), heard whether or not the metronome is on, and only
      // before the sound starts. `lead` is the time from its first click to the mark.
      let lead = 0, markAt = context.currentTime + 0.08;
      if (countIn) {
        const [numerator, denominator] = piece.time, at = beatAtSeconds(mark), before = Math.floor(at / numerator + 1e-6) * numerator;
        const line = Math.min(tabBeats, at - before < 0.25 ? before : before + numerator);
        const downbeat = secondsAtBeat(line), beat = beatSecondsAt(line);
        const clicks = audio.countIn(numerator, denominator, beat, downbeat).filter(c => c.atSeconds < mark - 1e-3);
        lead = Math.max(0, numerator * beat - (downbeat - mark));
        if (clicks.length) {
          const first = clicks[0].atSeconds, rendered = audio.renderClicks(clicks, { startSeconds: first, durationSeconds: mark - first + 0.5, sampleRate: context.sampleRate });
          const node = new AudioBufferSourceNode(context, { buffer: bufferOf(rendered) });
          node.connect(context.destination);
          node.start(markAt + lead - (mark - first));
          voice.nodes.add(node);
          node.addEventListener("ended", () => voice?.nodes.delete(node));
        }
      }
      transport = "playing";
      playground.dataset.playback = "playing";
      playground.dataset.loop = loop ? (loopSeconds() ? "bars" : "song") : "off";
      playground.dataset.countIn = lead ? "on" : "off";
      tabState("playing", { position: beatAtSeconds(mark) });
      setStatus(`Playing ${piece.title} on a synthesized ${instruments.find(i => i.id === picker.value).short}${lead ? " after a bar's count-in" : ""}${loop ? (loopSeconds() ? ", looping these bars" : ", looping the song") : ""}, a new take every time. Space pauses.`);
      buttons();
      markAt += lead;
      queue(token, { ...segmentFrom(take, offset, markAt - (mark - offset)), first: true });
    } catch (error) {
      if (token === audioRevision) { stopAudio(); showProblem("Audio unavailable", [error.message]); summary(); }
    }
  }
  function pause() {
    const seconds = shownSeconds();
    silence();
    transport = "paused";
    playground.dataset.playback = "paused";
    tabState("paused", { position: beatAtSeconds(seconds) });
    setStatus("Paused. Space or Resume goes on from here.");
    buttons();
  }
  function draw(token) {
    if (token !== audioRevision || !voice) return;
    const seconds = shownSeconds(), counting = context.currentTime < (voice.segments[0]?.at ?? Infinity);
    progress(seconds);
    // During the count-in the tab, whose own clock would run on, is held at the mark on every frame.
    if (counting !== (playground.dataset.counting === "true")) playground.dataset.counting = String(counting);
    if (counting || Math.abs(seconds - lastDraw) >= 0.05) {
      // The AudioContext is the clock; the tab counts time-signature beats, scorify counts quarters. The tab also runs
      // a clock of its own between these updates and, reaching its end, stops and jumps to the start by itself; while
      // the last notes ring out it would flicker between the end and the start. Near the end it is held paused, at
      // the end, until the sound is over and stopAudio rewinds it once.
      const beat = beatAtSeconds(seconds), end = tabBeats - 1e-3;
      markSoon(beat);
      if (!voice.loop && seconds >= secondsAtBeat(tabBeats) - 0.15) tabState("paused", { position: Math.min(beat, end) });
      else tabState("playing", { position: beat });
      lastDraw = seconds;
    }
    raf = requestAnimationFrame(() => draw(token));
  }
  /** What the tab was asked to do, by its own controls, Space, a click or the buttons below: make it sound. */
  async function follow(name, config) {
    if (name === "playing") {
      if (transport !== "playing" || "position" in config || "loop" in config) await start(tab.api.getState().config.position);
    } else if (name === "paused") {
      if (transport === "playing") pause();
    } else if (transport !== "stopped") stopAudio({ rewind: false });
  }
  $("play").addEventListener("click", () => tab.api.setState(transport === "playing" ? "paused" : "playing"));
  $("stop").addEventListener("click", () => { stopAudio(); summary(); });

  // The tab's bar numbers are its loop header. defuss-shadcn loops a bar on a click (Shift extends the loop); here a
  // drag forward along the numbers loops the bars it covers, and a drag back, or a double click, clears the loop.
  // While dragging, the loop is only drawn; the sound follows when the pointer is released.
  let header, swallowClick = false;
  const barAt = (x, y) => Number(document.elementFromPoint(x, y)?.closest?.("#song-tab .fretboard-measure")?.dataset.measure) || 0;
  tab.addEventListener("pointerdown", event => {
    const number = event.target.closest?.(".fretboard-number");
    if (event.button !== 0 || !number || !result) return;
    header = { pointer: event.pointerId, from: Number(number.closest(".fretboard-measure").dataset.measure), x: event.clientX, loop: undefined };
  });
  window.addEventListener("pointermove", event => {
    if (!header || event.pointerId !== header.pointer) return;
    if (header.loop === undefined && Math.abs(event.clientX - header.x) < 6) return;
    const bar = barAt(event.clientX, event.clientY);
    if (!bar) return;
    const loop = bar < header.from || (bar === header.from && event.clientX < header.x) ? null : { start: header.from, end: bar };
    if (header.loop !== undefined && JSON.stringify(loop) === JSON.stringify(header.loop)) return;
    header.loop = loop;
    tabState(tab.api.getState().name, { loop });
  });
  const release = event => {
    if (!header || event.pointerId !== header.pointer) return;
    const { loop } = header;
    header = undefined;
    if (loop === undefined) return;
    swallowClick = true;
    setTimeout(() => { swallowClick = false; });
    tab.api.setState(tab.api.getState().name, { loop });
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  tab.addEventListener("click", event => {
    const number = event.target.closest?.(".fretboard-number");
    if (swallowClick) { swallowClick = false; event.stopPropagation(); return; }
    // The first click of a double click looped its bar (defuss-shadcn); the second clears the loop.
    if (number && event.detail >= 2) { event.stopPropagation(); tab.api.setState(tab.api.getState().name, { loop: null }); }
  }, true);

  // ---- the neck and the voicings follow the tab --------------------------------------------------------------------
  // The neck is wider than its panel on narrow screens and for high positions: it scrolls sideways to keep the
  // sounding notes in view, with the rest of the chord shape when that fits.
  const neck = $("live-neck"), charts = document.querySelector(".sc-charts");
  function followNeck() {
    if (neck.scrollWidth <= neck.clientWidth + 1) return;
    const box = neck.getBoundingClientRect(), span = dots => {
      const rects = [...neck.querySelectorAll(dots)].map(d => d.getBoundingClientRect());
      return rects.length ? [Math.min(...rects.map(r => r.left)) - box.left + neck.scrollLeft, Math.max(...rects.map(r => r.right)) - box.left + neck.scrollLeft] : null;
    };
    const sounding = span('.fretboard-neck-dot[data-role="active"]');
    if (!sounding) return;
    const shape = span('.fretboard-neck-dot[data-role="active"], .fretboard-neck-dot[data-role="chord"]'), margin = 24;
    const [left, right] = shape && shape[1] - shape[0] + 2 * margin <= neck.clientWidth ? shape : sounding;
    if (left - margin >= neck.scrollLeft && right + margin <= neck.scrollLeft + neck.clientWidth) return;
    neck.scrollTo({ left: Math.max(0, (left + right) / 2 - neck.clientWidth / 2), behavior: reducedMotion.matches ? "auto" : "smooth" });
  }
  // The chord sounding now leads the voicings in a golden aura (defuss-shadcn shapes: aura aura-gold), the next chord
  // stands right of it and, while playing, blinks with the beat in the bar before it comes; the others keep their
  // order. The tab re-renders its charts bare, so each is put back in its slot here.
  let chartFrame = 0, chordTimeline = [], upcoming;
  function arrangeCharts() {
    for (const [k, chart] of [...charts.querySelectorAll(":scope > .chord-chart")].entries()) {
      const slot = Object.assign(document.createElement("div"), { className: "sc-chart-slot" });
      slot.dataset.order = String(k);
      chart.before(slot);
      slot.append(chart);
    }
    const slots = [...charts.querySelectorAll(":scope > .sc-chart-slot")], active = slots.find(s => s.querySelector(".chord-chart[data-active]"));
    const chordOf = slot => slot.querySelector(".chord-chart")?.dataset.chord, current = active && chordOf(active);
    const position = tab.api.getState().config.position;
    upcoming = chordTimeline.find(c => c.at > position + 1e-6 && c.name !== current);
    const next = upcoming && slots.find(slot => slot !== active && chordOf(slot) === upcoming.name);
    for (const slot of slots) {
      for (const name of ["aura", "aura-gold"]) slot.classList.toggle(name, slot === active);
      slot.toggleAttribute("data-next", slot === next);
      if (slot !== next) slot.removeAttribute("data-soon");
    }
    markSoon(position);
    const rank = slot => (slot === active ? 0 : slot === next ? 1 : 2);
    const order = [...slots].sort((a, b) => rank(a) - rank(b) || a.dataset.order - b.dataset.order);
    if (order.every((slot, k) => slots[k] === slot)) return;
    // Slide the charts to their new places (FLIP), unless motion is reduced.
    const before = new Map(slots.map(slot => [slot, slot.getBoundingClientRect()]));
    charts.append(...order);
    if (reducedMotion.matches) return;
    for (const slot of order) {
      const from = before.get(slot), to = slot.getBoundingClientRect();
      if (from.left !== to.left || from.top !== to.top) slot.animate([{ translate: `${from.left - to.left}px ${from.top - to.top}px` }, { translate: "0 0" }], { duration: 220, easing: "ease-out" });
    }
  }
  /** The next chord blinks in the bar before it comes, while playing. */
  function markSoon(position) {
    const slot = charts.querySelector(":scope > .sc-chart-slot[data-next]");
    slot?.toggleAttribute("data-soon", transport === "playing" && !!upcoming && upcoming.at - position <= piece.time[0] + 1e-6);
  }
  const arrangeSoon = () => { cancelAnimationFrame(chartFrame); chartFrame = requestAnimationFrame(arrangeCharts); };
  new MutationObserver(arrangeSoon).observe(charts, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-active"] });
  tab.addEventListener("fretboard-change", () => { arrangeSoon(); requestAnimationFrame(followNeck); });

  // ---- tuner ------------------------------------------------------------------------------------------------------------
  // scorify/tuner: the microphone feeds the pitch-detector AudioWorklet (YIN), and each reading is matched to the nearest
  // string of the instrument chosen below, or to the string picked here, and shown on the defuss-shadcn tacho.
  const tacho = globalThis.df$.shadcn.tacho, dial = $("tuner"), listen = $("tuner-listen");
  let tuner, tunerInput, tunerFor, targets = [], locked = null, heardString = null, unheard = 0, said = "";
  const tunerModule = async () => (tuner ??= await import("./scorify/tuner.mjs"));
  function tunerStatus(text, problem = false) {
    if (text === said) return;
    said = text;
    $("tuner-status").textContent = text;
    $("tuner-status").toggleAttribute("data-problem", problem);
  }
  /** The detector listens from a fifth below the lowest string to a fifth above the highest. */
  const tunerRange = () => ({
    minFrequency: Math.max(20, Math.min(...targets.map(t => t.frequency)) * 2 ** (-7 / 12)),
    maxFrequency: Math.max(...targets.map(t => t.frequency)) * 2 ** (7 / 12),
  });
  async function showTunerStrings() {
    const entry = instruments.find(i => i.id === picker.value);
    tunerFor = entry.id;
    targets = (await tunerModule()).tuningTargets(entry.create());
    locked = heardString = null;
    $("tuner-instrument").textContent = `${entry.name} · ${targets.map(t => t.pitch).join(" ")}`;
    const button = (label, id, title) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: label, title });
      b.dataset.size = "sm"; b.dataset.variant = "outline"; b.dataset.string = id;
      b.setAttribute("aria-pressed", String(id === ""));
      return b;
    };
    $("tuner-strings").replaceChildren(button("Auto", "", "Tune whichever string is played"),
      ...targets.map(t => button(t.pitch, t.stringId, `String ${t.number}: ${t.pitch}, ${t.frequency.toFixed(2)} Hz`)));
    tunerInput?.configure(tunerRange());
  }
  $("tuner-strings").addEventListener("click", event => {
    const b = event.target.closest("[data-string]");
    if (!b) return;
    locked = b.dataset.string || null;
    for (const other of $("tuner-strings").children) other.setAttribute("aria-pressed", String(other === b));
  });
  function markHeard(stringId, inTune = false) {
    heardString = stringId ?? heardString;
    for (const b of $("tuner-strings").children) {
      b.toggleAttribute("data-heard", !!stringId && b.dataset.string === stringId);
      b.toggleAttribute("data-in-tune", !!stringId && inTune && b.dataset.string === stringId);
    }
  }
  function heard(reading) {
    if (!reading.frequency) {
      // About half a second without a clear pitch: the dial rests.
      if (++unheard === 15) { tacho.tune(dial, null); markHeard(null); tunerStatus("Listening… play one string and let it ring."); }
      return;
    }
    unheard = 0;
    const target = (locked && targets.find(t => t.stringId === locked)) || tuner.nearestTarget(reading.frequency, targets).target,
      cents = tuner.centsFrom(reading.frequency, target.frequency), inTune = Math.abs(cents) <= 5;
    tacho.tune(dial, reading.frequency, { strings: [target.pitch] });
    markHeard(target.stringId, inTune);
    tunerStatus(inTune ? `String ${target.number} (${target.pitch}) is in tune.`
      : `String ${target.number} (${target.pitch}) is ${cents > 0 ? "sharp: loosen it" : "flat: tighten it"}.`);
  }
  function stopTuner() {
    tunerInput?.stop();
    tunerInput = undefined;
    tacho.tune(dial, null);
    markHeard(null);
    listen.setAttribute("aria-pressed", "false");
    listen.querySelector("span").textContent = "Listen";
    tunerStatus("");
  }
  const MICROPHONE = {
    NotAllowedError: "The microphone is blocked. Allow it for this page, then press Listen again.",
    NotFoundError: "No microphone was found.",
    NotReadableError: "The microphone is in use by another application.",
  };
  listen.addEventListener("click", async () => {
    if (tunerInput) { stopTuner(); return; }
    listen.disabled = true;
    try {
      const module = await tunerModule();
      context ??= new AudioContext();
      await context.resume();
      tunerStatus("Asking for the microphone…");
      tunerInput = await module.createPitchInput(context, { ...tunerRange(), onPitch: heard, onError: error => tunerStatus(error.message, true) });
      unheard = 0;
      listen.setAttribute("aria-pressed", "true");
      listen.querySelector("span").textContent = "Stop listening";
      tunerStatus("Listening… play one string and let it ring.");
    } catch (error) {
      tunerStatus(MICROPHONE[error?.name] ?? `The tuner could not start: ${error.message}`, true);
    } finally {
      listen.disabled = false;
    }
  });
  // A reference: the picked string (or the last one heard, or the lowest) plucked by scorify's synth.
  $("tuner-reference").addEventListener("click", async () => {
    const target = targets.find(t => t.stringId === (locked ?? heardString)) ?? targets[0];
    if (!target) return;
    audio ??= await import("./scorify/audio.mjs");
    context ??= new AudioContext();
    await context.resume();
    const preset = targets.length > 4 ? audio.classicalGuitarAudioPreset() : audio.ukuleleAudioPreset();
    const rendered = audio.renderPerformance({ strings: ["s"], durationSeconds: 2.5, preset, events: [{
      ...preset.tone, id: "reference", stringId: "s", frequency: target.frequency, onsetSeconds: 0.02, endSeconds: 2.5, excitationSeed: target.midi * 7919,
    }] }, { sampleRate: context.sampleRate, tailSeconds: 0.3 });
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: rendered.channels[0].length, sampleRate: rendered.sampleRate });
    buffer.copyToChannel(rendered.channels[0], 0);
    buffer.copyToChannel(rendered.channels[1], 1);
    const node = new AudioBufferSourceNode(context, { buffer });
    node.connect(context.destination);
    node.start();
    if (!tunerInput) tunerStatus(`String ${target.number}: ${target.pitch}, ${target.frequency.toFixed(1)} Hz.`);
  });

  function setTempo(bpm) {
    const slider = $("tempo"), at = value => (value - slider.min) / (slider.max - slider.min) * 100;
    if (bpm > Number(slider.max)) slider.max = String(Math.ceil(bpm / 10) * 10);
    effectsNode?.set({ delaySeconds: audio.delayForTempo(bpm * piece.beat) });
    slider.value = String(bpm);
    $("tempo-value").textContent = String(bpm);
    slider.style.setProperty("--slider-value", `${at(bpm)}%`);
    // The piece's own tempo stays marked under the track; a click on the mark goes back to it.
    const original = $("tempo-original"), home = piece.bpm;
    original.hidden = home < Number(slider.min) || home > Number(slider.max);
    $("tempo-track").style.setProperty("--tempo-original", String(at(home) / 100));
    original.toggleAttribute("data-current", Number(slider.value) === home);
    original.setAttribute("aria-label", `Back to the original tempo, ${home} BPM`);
    original.title = `Original tempo: ${home} BPM`;
  }
  $("tempo-original").addEventListener("click", () => {
    if (Number($("tempo").value) === piece.bpm) return;
    setTempo(piece.bpm);
    void changeTempo();
  });
  // The highest fret is the instrument's: a hard limit, its usual one marked under the track, remembered per instrument
  // in this browser. The difficulty adds its own soft preference for low positions (scorify's highFretCosts).
  const NECKS_KEY = "scorify-demo-necks-1", necks = (() => { try { return JSON.parse(localStorage.getItem(NECKS_KEY) ?? "{}"); } catch { return {}; } })();
  const fretsFor = id => (Number.isInteger(necks[id]) && necks[id] >= 5 ? necks[id] : highestFret(id));
  function keepFrets(frets) {
    if (frets === highestFret(picker.value)) delete necks[picker.value]; else necks[picker.value] = frets;
    try { localStorage.setItem(NECKS_KEY, JSON.stringify(necks)); } catch { /* not remembered */ }
  }
  function setFrets(frets) {
    const slider = $("frets"), at = value => (value - slider.min) / (slider.max - slider.min) * 100, usual = highestFret(picker.value);
    slider.value = String(frets);
    $("frets-value").textContent = String(frets);
    slider.style.setProperty("--slider-value", `${at(frets)}%`);
    const mark = $("frets-usual");
    $("frets-track").style.setProperty("--tempo-original", String(at(usual) / 100));
    mark.toggleAttribute("data-current", frets === usual);
    mark.setAttribute("aria-label", `Back to the instrument's usual highest fret, ${usual}`);
    mark.title = `The instrument's usual highest fret: ${usual}`;
  }
  $("frets-usual").addEventListener("click", () => {
    if (Number($("frets").value) === highestFret(picker.value)) return;
    setFrets(highestFret(picker.value));
    keepFrets(highestFret(picker.value));
    void rearrange();
  });
  function summary() {
    if (!plan) return;
    const reduced = plan.humanization.timingScale < 1;
    $("fact-timing").textContent = reduced ? `variation reduced to ${Math.round(plan.humanization.timingScale * 100)}%` : "validated";
    setStatus("");
    $("story").textContent = `${plan.events.length} notes on the strings; ${reduced ? "timing variation reduced to fit the fingering" : "performed timing validated against the fingering"}.${attempt?.story ? ` ${attempt.story}` : ""}`;
  }

  /** Strums, humanization and timing are checked against the selected fingering before anything is synthesized. */
  async function compile(expected = revision) {
    stopAudio(); plan = undefined; buttons();
    if (result?.status !== "success") return false;
    audio ??= await import("./scorify/audio.mjs");
    if (expected !== revision) return false;
    // The reference take: the facts and the status describe it; every playback performs a new one (performTake).
    const performed = audio.createPerformance(result, instrument, { ...performanceOptions(), seed: `scorify-demo-${piece.id}` });
    if (performed.status !== "success") {
      showProblem("This arrangement could not be performed", performed.diagnostics);
      setStatus("Arranged, but the performance failed its checks.");
      return false;
    }
    plan = performed.performance;
    const singer = $("guide-voice");
    singer.disabled = !sungLine().length;
    singer.parentElement.title = singer.disabled ? "This piece has no sung part" : "Sings the voice part with a soft synthesized voice";
    playground.dataset.status = "success";
    summary(); buttons();
    return true;
  }

  const STUDIES_NOTE = $("window-note").textContent;
  function describe() {
    const entry = instruments.find(i => i.id === picker.value);
    if (entry.id !== tunerFor) void showTunerStrings();
    $("instrument-label").textContent = entry.name;
    $("song-title").textContent = piece.title;
    $("song-description").textContent = piece.description;
    $("mode-badge").textContent = "Preparing…";
    const kind = piece.exercise ? "Scale" : piece.origin?.type === "scale" ? "Scale chords" : piece.origin?.type === "progression" ? "Progression" : "Song";
    $("rhythm-badge").textContent = piece.exercise
      ? `Scale · ${piece.time[0]}/${piece.time[1]} · ${scaleRhythms(piece.time).find(r => r.perBeat === library.scale.perBeat)?.name ?? ""}`
      : `${kind} · ${piece.time[0]}/${piece.time[1]} · ${piece.versions.length} version${piece.versions.length === 1 ? "" : "s"}`;
    $("tab-title").textContent = `${piece.title} · ${entry.name}`;
    $("tempo-unit").textContent = piece.beat === 1 ? "♩ BPM" : piece.beat === 1.5 ? "♩. BPM" : `× ${piece.beat} ♩ BPM`;
    for (const button of document.querySelectorAll("[data-song]")) button.setAttribute("aria-pressed", String(button.dataset.song === piece.id));
    $("window-note").textContent = piece.exercise ? "Scale exercise made by scorify: spelled degrees, at the lowest octave the neck holds"
      : kind === "Scale chords" ? "A scale's chords made by scorify: the triad on every degree, up and back down"
      : kind === "Progression" ? `One of 25 practice progressions, ${piece.origin.pattern ? "in a strumming pattern" : "with versions written for the playground"}; ${piece.credit}`
      : piece.kind === "chart" ? "Chord chart under an imported voice part" : piece.kind === "score" ? "Imported score" : STUDIES_NOTE;
  }

  // ---- arrangement cache ------------------------------------------------------------------------------------------------
  // A request's log of attempts (with its result) comes from this visit, this browser (IndexedDB) or the precomputed files
  // of the docs (assets/cache/) and of the local library. arrangeFor replays an attempt only when its inputs fingerprint
  // alike, cache version included, and validates a replayed result first; anything else is searched in the worker.
  const memory = new Map(), CACHE_LIMIT = 80;
  const database = (() => {
    let opened;
    return () => (opened ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("scorify-demo", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("results", { keyPath: "key" }); request.result.createObjectStore("saved", { keyPath: "id" }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(() => null));
  })();
  /** One IndexedDB operation; storage can be unavailable (private windows, blocked site data), which only costs a search. */
  async function store(name, mode, operation) {
    try {
      const db = await database();
      if (!db) return undefined;
      return await new Promise((resolve, reject) => {
        const request = operation(db.transaction(name, mode).objectStore(name));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch { return undefined; }
  }
  async function keep(key, log) {
    memory.set(key, log);
    await store("results", "readwrite", s => s.put({ key, log, build, storedAt: Date.now() }));
    const keys = (await store("results", "readonly", s => s.getAllKeys())) ?? [];
    if (keys.length > CACHE_LIMIT) {
      // Entries of other cache versions go first, then the oldest.
      const entries = (await store("results", "readonly", s => s.getAll())) ?? [];
      const order = e => (e.build === build ? 1 : 0) * 1e15 + e.storedAt;
      for (const old of entries.sort((a, b) => order(a) - order(b)).slice(0, entries.length - CACHE_LIMIT)) await store("results", "readwrite", s => s.delete(old.key));
    }
  }
  const indexes = new Map();
  const indexAt = base => (indexes.has(base) ? indexes.get(base)
    : indexes.set(base, fetch(`${base}index.json`, { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null)).get(base));
  const shipped = new Map();
  const precomputed = (base, key) => {
    if (!shipped.has(`${base}${key}`)) shipped.set(`${base}${key}`, fetchPrecomputed(base, key));
    return shipped.get(`${base}${key}`);
  };
  async function fetchPrecomputed(base, key) {
    const entry = base && (await indexAt(base))?.entries?.[key];
    if (!entry) return null;
    try {
      const response = await fetch(`${base}${entry.file}`);
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Served as is (application/gzip); a server that decompressed it already sends plain JSON.
      const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text() : new TextDecoder().decode(bytes);
      return JSON.parse(text).log;
    } catch { return null; }
  }
  /**
   * Every cached log of a request: this visit, this browser (entries of this build only) and the precomputed files.
   * arrangeFor replays an attempt from whichever holds its fingerprint, so an older entry never hides a fresh one.
   */
  async function cachedLog(target, key) {
    const layers = [];
    if (memory.has(key)) layers.push({ log: memory.get(key), from: "this visit" });
    const saved = await store("results", "readonly", s => s.get(key));
    if (saved?.log && saved.build === build) layers.push({ log: saved.log, from: "this browser" });
    const files = await precomputed(target.cacheBase, key);
    if (files) layers.push({ log: files, from: "the precomputed cache" });
    return { log: layers.flatMap(layer => layer.log), layers };
  }
  /** Where a run's successful attempt was replayed from, or null when it was searched. */
  const replayedFrom = (cached, log) => {
    const hit = log.find(e => e.status === "success" && e.replayed);
    return hit ? cached.layers.find(layer => layer.log.some(e => e.fingerprint === hit.fingerprint))?.from ?? null : null;
  };

  // ---- custom mode and capo -------------------------------------------------------------------------------------------
  // Custom settings stay in force (across songs, instruments and difficulties) until Reset; a suggested capo is a toggle.
  let custom = null, capoOn = false, suggestion = null, request;
  const background = createWorkerClient(new Worker(new URL("./scorify/worker-entry.mjs", import.meta.url), { type: "module" }));
  /**
   * The request the controls describe: the main controls, the capo toggle (or the custom capo) and custom settings. The
   * highest fret is part of it only when it is not the instrument's usual one, so the usual neck keeps its cache keys.
   */
  function requestFor(target = piece) {
    const instrumentId = picker.value, level = $("level").value, arrangement = custom?.arrangement ?? null, frets = Number($("frets").value);
    const neck = frets === highestFret(instrumentId) ? {} : { frets };
    suggestion = custom?.capo === undefined ? suggestCapo(target, { instrumentId, level, transpose: Number($("key").value) || 0, ...neck, custom: arrangement ?? undefined }) : null;
    const capo = custom?.capo ?? (capoOn && suggestion ? suggestion.capo : 0);
    const transpose = target.origin?.type === "scale" ? 0 : Number($("key").value) || 0;
    return { instrumentId, level, bpm: Number($("tempo").value), texture: target.texture, capo, transpose, ...neck, ...inversionsFor(target, transpose), custom: arrangement };
  }
  function showCapo() {
    const control = $("capo").closest(".sc-control");
    control.hidden = !suggestion;
    if (!suggestion) return;
    $("capo").checked = capoOn;
    $("capo-label").textContent = `Capo on fret ${suggestion.capo} · ${suggestion.shapes.join(" ")} shapes`;
    $("capo-label").title = `Sounds ${suggestion.chords.join(" ")}: the same key, fingered ${suggestion.hard[0] - suggestion.hard[1]} hard chord shape${suggestion.hard[0] - suggestion.hard[1] === 1 ? "" : "s"} fewer.`;
  }
  /** While one arrangement shows, the other side of the capo toggle is searched in a second worker, so the toggle is instant. */
  async function prepareOtherSide(target, current, id) {
    if (!suggestion || custom?.capo !== undefined) return;
    const other = { ...current, capo: current.capo ? 0 : suggestion.capo }, key = cacheKey(target, other);
    const { log: replay } = await cachedLog(target, key);
    if (id !== revision) return;
    const outcome = await arrangeFor(target, other, { arrange: (source, options) => background.arrange(source, options), replay, isCurrent: () => id === revision });
    if (["stale", "cancelled"].includes(outcome.status) || id !== revision && !searched(outcome.log)) return;
    if (searched(outcome.log)) await keep(key, cacheable(outcome.log));
    else memory.set(key, cacheable(outcome.log));
  }

  // The hardest version's notes per piece, instrument, capo and custom settings (tempo and difficulty do not change them).
  const fullCounts = new Map();
  function fullNotes(current) {
    const key = cacheKey(piece, { ...current, level: "", bpm: 0 });
    if (!fullCounts.has(key)) fullCounts.set(key, hardestNotes(piece, current));
    return fullCounts.get(key);
  }
  /**
   * Shows a successful run (searched, replayed or retimed): the tab, charts, facts and status line, then compiles and
   * validates the performance. Returns whether it performs.
   */
  async function present(outcome, current, id, from) {
    const { prepared, version, simplify } = outcome, { level, instrumentId, bpm } = current;
    const name = instruments.find(i => i.id === instrumentId).short;
    // An attempt that ran out with the low-position preference and then played without it is not a version that failed.
    const tried = outcome.log.filter(e => e.status !== "success" && !(e.version === version.id && e.simplify === simplify)).map(e => ({ ...e, version: versionById(piece, e.version) }));
    arranged = { ...outcome, request: current };
    result = outcome.result; instrument = prepared.options.instrument;
    $("mode-badge").textContent = `${custom ? "Custom · " : ""}${prepared.options.mode === "adaptive" ? "Adaptive accompaniment" : "Exact mode"}`;
    const kept = result.score.notes.length;
    const written = piece.exercise ? `${version.label}, every note as written` : simplify
      ? `No version for ${LEVELS[level].toLowerCase()} plays as written on the ${name}; scorify simplified the ${version.difficulty} version (“${version.label}”) and kept ${kept} of its ${prepared.total} notes`
      : `“${version.label}”, the version written for ${version.difficulty}${version.estimated ? " (estimated)" : ""}`;
    const harder = tried.filter(t => !t.simplify).map(t => `${t.version.difficulty} version: ${STATUS[t.status] ?? t.status}`);
    attempt = { ...prepared, version, simplify, request: current, log: cacheable(outcome.log), story: [written, ...prepared.notes, ...(harder.length ? [`Did not play: ${harder.join("; ")}`] : []), ...(from ? [`Replayed from ${from}, without a search`] : []),
      ...(result.retimed ? [`Fingered at the piece's tempo, ${result.retimed.fromBpm} BPM; ${bpm} BPM changes playback only`] : [])]
      .map(sentence => sentence[0].toUpperCase() + sentence.slice(1)).join(". ") + "." };
    playground.setAttribute("aria-busy", "false");
    $("cancel").hidden = true;
    // Every fret on the page comes from result.annotations; nothing is re-derived from pitch.
    const data = tabFor(piece, result, instrument, { spec: prepared.spec, vocal: prepared.vocal, chords: prepared.chords ?? [] });
    shownChords = data.scores[0].tracks.find(t => t.kind === "chords")?.items ?? [];
    tabState("default", { data, position: 0, loop: null });
    // Chord names the tab kept from the last arrangement get this one's buttons.
    for (const element of document.querySelectorAll("#song-tab .fretboard-chord[data-inversions]")) { element.removeAttribute("data-inversions"); element.querySelector(".sc-inversion")?.remove(); }
    decorateChords();
    tabBeats = data.scores[0].measures * piece.time[0];
    // Chord changes in tab beats, for the next-chord preview; the preview blinks once per beat.
    chordTimeline = (data.scores[0].tracks.find(t => t.kind === "chords")?.items ?? [])
      .map(i => ({ at: (i.measure - 1) * piece.time[0] + i.beat - 1, name: i.name ?? i.text })).sort((a, b) => a.at - b.at);
    charts.style.setProperty("--sc-beat", `${60 / data.scores[0].bpm}s`);
    // A score without chord symbols has no voicings to chart: the neck takes the whole row.
    $("board").dataset.charts = Object.keys(data.chords).length ? "some" : "none";
    $("tab-title").textContent = `${piece.title} · ${instruments.find(i => i.id === instrumentId).name}${current.custom?.tuning?.length ? ` · ${current.custom.tuning.join(" ")}` : ""}${current.capo ? ` · capo ${current.capo}` : ""}`;
    $("fact-tuning").textContent = instrument.strings.map(s => s.openPitch).join(" · ") + (current.capo ? ` · capo ${current.capo}` : "");
    $("fact-level").textContent = simplify ? `${level} · simplified` : version.difficulty === level ? level : `${level} · ${version.difficulty} version`;
    // Notes compared with the hardest version as written on this instrument: each difficulty plays its own version.
    const hardest = hardestVersion(piece), full = piece.versions.length > 1 ? fullNotes(current) : null;
    $("fact-notes-label").textContent = full ? `Notes vs. the ${hardest.difficulty} version` : "Notes kept";
    $("fact-notes").textContent = `${kept} / ${full ?? prepared.total}${full ? ` · ${Math.round((kept / full) * 100)}%` : ""}${prepared.options.mode === "adaptive" ? " · adaptive" : ""}`;
    $("fact-search").textContent = `${result.optimality} · ${result.stats.expandedStates.toLocaleString()} states${from ? " · cached" : ""}`;
    $("facts").hidden = $("details").hidden = false;
    $("result-json").textContent = JSON.stringify({
      status: result.status, optimality: result.optimality, mode: prepared.options.mode, version: { difficulty: version.difficulty, label: version.label },
      request: current, cache: from ?? "searched", ...(result.retimed ? { searchedAtBpm: result.retimed.fromBpm } : {}), notes: prepared.notes, tried: tried.map(t => ({ version: t.version.difficulty, simplify: t.simplify, status: t.status, detail: t.detail })),
      profile: result.profile, difficulty: result.difficulty, edits: result.edits.slice(0, 40), editCount: result.edits.length,
      firstAnnotation: result.annotations.find(a => a.attackIds.length), stats: result.stats,
    }, null, 2);
    const performs = await compile(id);
    if (performs && id === revision) void prepareOtherSide(piece, current, id);
    return performs;
  }

  /**
   * A new tempo never needs a search: arrangements are fingered at the piece's own tempo and the tempo is playback
   * only (retime scales the arrangement on show). Without one on show, the arrangement is found as usual.
   */
  async function changeTempo() {
    const shown = arranged, current = requestFor(), moved = shown && retime(piece, shown, current);
    if (!moved) return void rearrange();
    // A new tempo keeps the place: playback goes on from the same beat without a count-in, a pause stays where it
    // was, and a loop of bars is kept. Tab positions are beats, so they hold at any tempo.
    const id = ++revision, was = transport, { position: shownAt, loop } = tab.api.getState().config;
    const position = was === "playing" && voice ? beatAtSeconds(shownSeconds()) : shownAt ?? 0;
    request = current;
    stopAudio({ rewind: false }); $("problem").hidden = true;
    const performs = await present(moved, current, id, null);
    if (id !== revision || !performs) return;
    tabState(was === "paused" ? "paused" : "default", { position, loop });
    progress(secondsAtBeat(position));
    if (was === "playing") await start(position, { countIn: false });
    else if (was === "paused") { transport = "paused"; playground.dataset.playback = "paused"; buttons(); }
  }

  /**
   * The version written for the chosen difficulty (or the nearest easier one) is fingered as written. If it does not
   * play on this instrument, the next easier version is tried; if none does, scorify simplifies the easiest one.
   * Custom mode can fix the version and the mode. A cached log replays without searching.
   */
  async function recompute() {
    const id = ++revision, level = $("level").value, instrumentId = picker.value;
    const name = instruments.find(i => i.id === instrumentId).short;
    stopAudio(); result = plan = arranged = undefined; buttons();
    describe();
    $("problem").hidden = true;
    playground.dataset.status = "searching";
    playground.dataset.song = piece.id;
    playground.dataset.instrument = instrumentId;
    playground.setAttribute("aria-busy", "true");
    $("cancel").hidden = false;
    let label = "";
    try {
      const current = request = requestFor(), key = cacheKey(piece, current);
      showCapo();
      $("custom-state").hidden = !custom;
      const cached = await cachedLog(piece, key);
      if (id !== revision) return;
      const outcome = await arrangeFor(piece, current, {
        arrange: (source, options) => client.arrange(source, options), replay: cached.log, isCurrent: () => id === revision,
        onAttempt: async ({ version, simplify }) => {
          label = simplify
            ? `Simplifying the ${version.difficulty} version for ${LEVELS[level].toLowerCase()} on ${name}…`
            : version.pattern && piece.kind === "score" ? `Fingering the piece's chords on ${name}…` : `Fingering the ${version.difficulty} version on ${name}…`;
          setStatus(label, true);
          // Let the status paint: chord shapes are probed on this thread.
          await new Promise(resolve => setTimeout(resolve));
        },
        onRetry: k => setStatus(`${label} The search ran out of budget; trying again with a ${k ? "much " : ""}wider one…`, true),
      });
      if (id !== revision || outcome.status === "stale") return;
      if (outcome.status === "cancelled") { setStatus("Search cancelled."); return; }
      if (searched(outcome.log)) void keep(key, cacheable(outcome.log));
      else memory.set(key, cacheable(outcome.log));
      const tried = outcome.log.filter(e => e.status !== "success").map(e => ({ ...e, version: versionById(piece, e.version) }));
      if (outcome.status === "success") {
        await present(outcome, current, id, replayedFrom(cached, outcome.log));
        return;
      }
      attempt = undefined;
      playground.dataset.status = tried.at(-1)?.status ?? "infeasible";
      playground.setAttribute("aria-busy", "false");
      $("cancel").hidden = true;
      $("facts").hidden = $("details").hidden = true;
      showProblem(`Nothing plays for ${LEVELS[level].toLowerCase()} on the ${name}`, [
        ...tried.map(t => `${t.simplify ? `Simplified ${t.version.difficulty} version` : t.version.pattern && piece.kind === "score" ? "Strummed chords" : `${LEVELS[t.version.difficulty]} version`}: ${STATUS[t.status] ?? t.status}${t.detail ? `: ${t.detail}` : ""}.`),
        custom ? "Custom settings are in force: relax them in Custom mode, or press Reset."
          : piece.exercise ? `${LEVELS[level]} plays nothing shorter than ${shortest(level)}. Try fewer notes per beat, a higher difficulty or another instrument.`
          : `Try a higher difficulty${piece.textures?.length ? ", fewer voices" : ""} or another instrument.`,
      ]);
      setStatus(`No arrangement · ${tried.map(t => `${t.version.difficulty}${t.simplify ? " simplified" : ""}: ${t.status}`).join(" · ")}`);
      shownChords = [];
      tabState("default", { data: { version: 1, title: piece.title, scores: [{ id: "none", measures: 1, tracks: [] }] }, position: 0 });
      // Inverted chords may be why: they can be undone here, where the tab has no chord names.
      if (current.inversions) {
        const undo = Object.assign(document.createElement("button"), { type: "button", className: "btn", id: "undo-inversions", textContent: "Play the chords as written" });
        Object.assign(undo.dataset, { variant: "outline", size: "sm" });
        undo.addEventListener("click", () => { inversions = {}; void recompute(); });
        $("problem-text").append(Object.assign(document.createElement("p"), { textContent: `Inverted as asked: ${Object.keys(current.inversions).length} chord${Object.keys(current.inversions).length === 1 ? "" : "s"}.` }), undo);
      }
    } catch (error) {
      if (id === revision) {
        if (custom) {
          playground.dataset.status = "invalid-input";
          playground.setAttribute("aria-busy", "false");
          $("cancel").hidden = true;
          setStatus("The custom settings could not be used.");
          showProblem("Custom settings rejected", [error.message, "Change the setting it names, or press Reset."]);
        } else fatal(error.message);
      }
    }
  }

  $("cancel").addEventListener("click", () => {
    revision++;
    client.cancel();
    playground.dataset.status = "cancelled";
    playground.setAttribute("aria-busy", "false");
    $("cancel").hidden = true;
    setStatus("Search cancelled. Change a setting or pick a song to search again.");
  });

  /** The voices picker appears only for an imported score with inner voices. */
  function showTextures() {
    const voices = $("voices");
    voices.closest(".sc-control").hidden = !piece.textures?.length;
    voices.replaceChildren(...(piece.textures ?? []).map(t => new Option(`${t.label} · ${t.notes} notes`, t.key)));
    if (piece.textures?.length) voices.value = piece.texture;
  }
  /** The key selector: the piece's own key and the keys a semitone to a tritone away, every one precomputed. */
  function showKeys(transpose = 0) {
    const sign = s => `${s > 0 ? "+" : "−"}${Math.abs(s)}`;
    $("key").replaceChildren(...KEY_SHIFTS.map(s => new Option(
      `${keyName(piece, s) ?? (s ? `${sign(s)} semitone${Math.abs(s) === 1 ? "" : "s"}` : "As written")}${s ? (keyName(piece, s) ? ` · ${sign(s)}` : "") : keyName(piece) ? " · original" : ""}`, String(s))));
    $("key").value = String(transpose);
  }
  /** A song card selects the piece and its own instrument (with its highest fret) and key; the difficulty stays as chosen. */
  function choose(next) {
    piece = lastSong = next;
    selectLibrary("songs");
    picker.value = piece.instrument;
    setFrets(fretsFor(picker.value));
    capoOn = false;
    showKeys();
    showTextures();
    showVersions();
    $("tempo").max = String(Math.max(140, Math.ceil(tempoFor(piece, "maestro") / 10) * 10));
    setTempo(tempoFor(piece, $("level").value));
    void recompute();
  }
  document.querySelector(".sc-songs").addEventListener("click", event => {
    const button = event.target.closest("[data-song]");
    if (button && pieces.has(button.dataset.song)) choose(pieces.get(button.dataset.song));
  });

  // ---- the library: songs, scales and chord progressions ----------------------------------------------------------------
  // Three vertical tabs (defuss-shadcn's tabs; they do not announce a change, so the selection is observed). Next to
  // Key, Time and Play set a practice piece's time signature and how it is played. A scale in single notes is made for
  // the instrument on show (its octave, capo, highest fret and tuning) and made again when they change; a seven-note
  // scale can also be played as its chords. A scale's tonic is the Key select. A progression is a chord song in C major
  // or A minor that the Key select moves like a song. The choices are remembered in this browser; the page opens on Songs.
  const LIBRARY_KEY = "scorify-demo-library-2", METERS = ["4/4", "3/4", "6/8", "12/8"];
  /** How a scale is played: its notes in a direction, or (seven-note scales) its chords in a progression style. */
  const SCALE_PLAYS = [
    { id: "up-down", name: "Scale up and down" }, { id: "up", name: "Scale up" }, { id: "down", name: "Scale down" }, { id: "down-up", name: "Scale down and up" },
    ...PROGRESSION_STYLES.map(s => ({ id: s.id, name: s.id === "strum" ? "Chords strummed" : `Chords, ${s.name.toLowerCase()}`, chords: true })),
  ];
  const library = {
    tab: "songs",
    scale: { scale: "major", tonic: "C", octaves: 1, perBeat: 2, time: [4, 4], play: "up-down" },
    progression: { id: PROGRESSIONS[0].id, time: [4, 4], style: "strum", pattern: "" },
  };
  try {
    const stored = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "{}"), meter = t => Array.isArray(t) && METERS.includes(t.join("/"));
    const s = stored.scale ?? {}, p = stored.progression ?? {};
    if (SCALES.some(x => x.id === s.scale) && Object.values(TONICS).flat().includes(s.tonic) && [1, 2, 3].includes(s.octaves) && meter(s.time)
      && scaleRhythms(s.time).some(r => r.perBeat === s.perBeat) && SCALE_PLAYS.some(x => x.id === s.play))
      library.scale = { scale: s.scale, tonic: s.tonic, octaves: s.octaves, perBeat: s.perBeat, time: s.time, play: s.play };
    // A strumming pattern belongs to its meter; "" plays the versions by difficulty.
    const pattern = STRUM_PATTERNS.find(x => x.id === p.pattern && meter(p.time) && x.time.join("/") === p.time.join("/"))?.id ?? "";
    if (PROGRESSIONS.some(x => x.id === p.id) && meter(p.time) && PROGRESSION_STYLES.some(x => x.id === p.style)) library.progression = { id: p.id, time: p.time, style: p.style, pattern };
  } catch { /* the defaults */ }
  const rememberLibrary = () => { try { localStorage.setItem(LIBRARY_KEY, JSON.stringify({ scale: library.scale, progression: library.progression })); } catch { /* not remembered */ } };
  let lastSong;
  const withOrigin = (target, origin) => Object.assign(target, { origin });
  const shortest = level => { const [n, d] = compilePlayer({ level }).minDuration, quarters = n / d; return quarters >= 1 ? `a quarter note` : quarters >= 0.5 ? "an eighth note" : quarters >= 0.25 ? "a sixteenth note" : "a 32nd note"; };
  /** Moves the arrangement on show after a change of instrument, highest fret or custom settings: a scale is made again. */
  function rearrange() { return library.tab === "scales" ? showScale() : recompute(); }
  const tabs = document.querySelector(".sc-library [role=tablist]");
  /** Selects a tab without the observer acting on it (the caller shows the piece). */
  function selectLibrary(name) {
    library.tab = name;
    showPracticeControls();
    const trigger = tabs.querySelector(`[data-library="${name}"]`);
    if (trigger.getAttribute("aria-selected") !== "true") trigger.click();
  }
  new MutationObserver(() => {
    const name = tabs.querySelector('[aria-selected="true"]')?.dataset.library;
    if (!name || name === library.tab) return;
    library.tab = name;
    showPracticeControls();
    if (name === "songs") choose(lastSong ?? pieces.get(songs[0].id));
    else if (name === "scales") showScale({ fresh: true });
    else showProgression({ fresh: true });
  }).observe(tabs, { attributes: true, subtree: true, attributeFilter: ["aria-selected"] });

  // Time and Play, next to Key: shown for scales and progressions, with the choices of the tab on show; a strummed
  // progression also has Pattern, its versions by difficulty or a strumming pattern for the meter.
  $("meter").replaceChildren(...METERS.map(m => new Option(m, m)));
  const PATTERN_TYPICAL = { ukulele: "ukulele", guitar: "guitar", mandolin: "mandolin" };
  function showPatterns() {
    const meter = library.progression.time.join("/"), strings = instrumentFor(picker.value).strings.length;
    const styles = [...new Set(STRUM_PATTERNS.filter(p => p.time.join("/") === meter).map(p => p.style))];
    $("pattern").replaceChildren(new Option("By difficulty", ""), ...styles.map(style => {
      const group = Object.assign(document.createElement("optgroup"), { label: style });
      group.append(...STRUM_PATTERNS.filter(p => p.style === style && p.time.join("/") === meter).map(p => {
        const option = new Option(`${p.name} · ${p.strokes}`, p.id);
        option.title = `Usually on ${p.typical.map(t => PATTERN_TYPICAL[t]).join(" and ")}; written for ${p.difficulty} and up`;
        // A picked bass under the strum needs a guitar's strings; on four the bass string is strummed while it rings.
        if (p.strings && strings < p.strings) Object.assign(option, { disabled: true, title: `Needs ${p.strings} strings: a bass under the strum` });
        return option;
      }));
      return group;
    }));
    $("pattern").value = library.progression.pattern;
  }
  function showPracticeControls() {
    const practising = library.tab !== "songs";
    $("meter").closest(".sc-control").hidden = $("style").closest(".sc-control").hidden = !practising;
    $("pattern").closest(".sc-control").hidden = library.tab !== "progressions" || library.progression.style !== "strum";
    if (!practising) return;
    if (library.tab === "progressions") showPatterns();
    const scales = library.tab === "scales", chords = !!scaleTriads(library.scale.tonic, library.scale.scale);
    $("meter").value = (scales ? library.scale.time : library.progression.time).join("/");
    $("style").replaceChildren(...(scales ? SCALE_PLAYS : PROGRESSION_STYLES).map(s => {
      const option = new Option(s.name, s.id);
      // A scale's chords need a chord on every degree: seven-note scales only.
      if (s.chords && !chords) Object.assign(option, { disabled: true, title: "Only seven-note scales have a chord on every degree" });
      return option;
    }));
    $("style").value = scales ? library.scale.play : library.progression.style;
  }
  $("meter").addEventListener("change", () => {
    const time = $("meter").value.split("/").map(Number);
    if (library.tab === "scales") {
      // Keep the note value where the new meter has it (eighths stay eighths), else the meter's first.
      const was = scaleRhythms(library.scale.time).find(r => r.perBeat === library.scale.perBeat)?.name, rhythms = scaleRhythms(time);
      library.scale = { ...library.scale, time, perBeat: (rhythms.find(r => r.name === was) ?? rhythms[0]).perBeat };
      rememberLibrary();
      return void showScale();
    }
    library.progression.time = time;
    // A pattern is written in one meter; another meter plays the versions by difficulty.
    if (STRUM_PATTERNS.find(p => p.id === library.progression.pattern)?.time.join("/") !== time.join("/")) library.progression.pattern = "";
    rememberLibrary();
    void showProgression();
  });
  $("style").addEventListener("change", () => {
    if (library.tab === "scales") { library.scale.play = $("style").value; rememberLibrary(); return void showScale({ fresh: true }); }
    library.progression.style = $("style").value;
    rememberLibrary();
    void showProgression();
  });
  $("pattern").addEventListener("change", () => {
    library.progression.pattern = $("pattern").value;
    rememberLibrary();
    void showProgression();
  });

  // Scales: the scale, octaves and notes per beat (single notes only); the tonic is the Key select, spelled as usually written.
  $("scale").replaceChildren(...SCALES.map(s => new Option(s.name, s.id)));
  const scaleOf = () => SCALES.find(s => s.id === library.scale.scale);
  const playsChords = () => !!SCALE_PLAYS.find(p => p.id === library.scale.play)?.chords;
  function showScaleForm() {
    const { scale, octaves, perBeat, time } = library.scale;
    $("scale").value = scale; $("scale-octaves").value = String(octaves);
    $("scale-rhythm").replaceChildren(...scaleRhythms(time).map(r => new Option(`${r.name[0].toUpperCase()}${r.name.slice(1)}`, String(r.perBeat))));
    $("scale-rhythm").value = String(perBeat);
    // Chords take their rhythm from the difficulty's version and their range from the chord shapes.
    $("scale-octaves").disabled = $("scale-rhythm").disabled = playsChords();
  }
  /** The Key select for a scale: its twelve tonics, spelled for its quality (C♯ minor, D♭ major). */
  function showScaleKeys() {
    const scale = scaleOf(), tonics = TONICS[scale.quality];
    if (!tonics.includes(library.scale.tonic)) {
      // The same pitch class, spelled for the new quality.
      const other = TONICS[scale.quality === "major" ? "minor" : "major"].indexOf(library.scale.tonic);
      library.scale.tonic = tonics[Math.max(0, other)];
    }
    $("key").replaceChildren(...tonics.map(t => new Option(`${t} ${scale.mode}`, t)));
    $("key").value = library.scale.tonic;
  }
  /** Shows the scale the Scales tab describes on the instrument on show, or says why it does not fit the neck. */
  function showScale({ fresh = false } = {}) {
    // A scale without a chord on every degree is played in single notes.
    if (playsChords() && !scaleTriads(library.scale.tonic, library.scale.scale)) library.scale.play = "up-down";
    showScaleForm();
    showScaleKeys();
    showPracticeControls();
    const { scale, tonic, time, play } = library.scale, origin = { type: "scale", exercise: { ...library.scale } };
    if (playsChords()) piece = withOrigin(scaleChordsSong({ scale, tonic, time }, { instrument: picker.value, style: play }), origin);
    else {
      const instrument = instrumentFor(customInstrumentId(picker.value, { capo: custom?.capo ?? 0, frets: Number($("frets").value), tuning: custom?.arrangement?.tuning })),
        exercise = { ...library.scale, direction: play };
      if (!scaleOnNeck(exercise, instrument)) return unfit(instrument);
      piece = withOrigin(scalePiece(exercise, instrument, { instrumentId: picker.value }), origin);
    }
    capoOn = false;
    showTextures();
    showVersions();
    $("tempo").max = String(Math.max(140, Math.ceil(tempoFor(piece, "maestro") / 10) * 10));
    if (fresh) setTempo(tempoFor(piece, $("level").value));
    return recompute();
  }
  function unfit(instrument) {
    revision++;
    stopAudio(); result = plan = arranged = attempt = undefined; buttons();
    const { octaves, tonic } = library.scale, title = `${tonic} ${scaleOf().name.toLowerCase()} scale`, name = instruments.find(i => i.id === picker.value).short;
    $("song-title").textContent = title;
    $("song-description").textContent = "";
    playground.dataset.status = "infeasible";
    playground.setAttribute("aria-busy", "false");
    $("cancel").hidden = true;
    $("facts").hidden = $("details").hidden = true;
    showProblem(`${octaves === 1 ? "One octave" : `${octaves} octaves`} of the ${title} do not fit the ${name}`, [
      `Its notes must all lie between the lowest open string and fret ${instrument.strings[0].fretCount} (the highest fret); scorify moves none of them.`,
      "Choose fewer octaves, another key, a higher highest fret or another instrument.",
    ]);
    setStatus("Does not fit the neck");
    tabState("default", { data: { version: 1, title, scores: [{ id: "none", measures: 1, tracks: [] }] }, position: 0 });
  }
  $("scale").addEventListener("change", () => { library.scale.scale = $("scale").value; rememberLibrary(); void showScale(); });
  $("scale-octaves").addEventListener("change", () => { library.scale.octaves = Number($("scale-octaves").value); rememberLibrary(); void showScale(); });
  $("scale-rhythm").addEventListener("change", () => { library.scale.perBeat = Number($("scale-rhythm").value); rememberLibrary(); void showScale(); });

  // Chord progressions: the Billboard ranking as cards, with their chords in the key on show.
  const progressionFor = instrumentId => {
    const chosen = PROGRESSIONS.find(p => p.id === library.progression.id) ?? PROGRESSIONS[0], { time, style } = library.progression;
    const pattern = style === "strum" && library.progression.pattern ? library.progression.pattern : undefined;
    return withOrigin(progressionSong(chosen, time, { instrument: instrumentId, style, ...(pattern ? { pattern } : {}) }), { type: "progression", id: chosen.id, time: [...time], style, ...(pattern ? { pattern } : {}) });
  };
  function showProgressions() {
    const transpose = Number($("key").value) || 0, top = Math.max(...PROGRESSIONS.map(p => p.songs));
    $("progression-list").replaceChildren(...PROGRESSIONS.map(p => {
      // Each entry's chord in the key on show: the first bar it lasts.
      const song = transposeSong(progressionSong(p, [4, 4]), transpose);
      const chords = p.numerals.map((_, k) => song.progression[p.numerals.slice(0, k).reduce((at, _n, j) => at + (p.bars?.[j] ?? 1), 0)]);
      const card = Object.assign(document.createElement("button"), { type: "button", className: "sc-progression" });
      card.dataset.progression = p.id;
      card.setAttribute("aria-pressed", String(p.id === library.progression.id));
      const part = (className, text) => Object.assign(document.createElement("span"), { className, textContent: text });
      // The McGill Billboard count where the corpus has the progression; other sources are linked below the list.
      const count = p.songs ? part("sc-progression-count", `${p.songs} of ${BILLBOARD_SONGS} songs`) : null;
      if (count) {
        const bar = part("sc-progression-bar", "");
        bar.style.setProperty("--share", String(p.songs / top));
        count.prepend(bar);
      }
      card.append(part("sc-progression-name", p.name), part("sc-progression-chords", chords.join(" ")), ...(count ? [count] : []), part("sc-progression-note", p.note));
      return card;
    }));
    const chosen = PROGRESSIONS.find(p => p.id === library.progression.id) ?? PROGRESSIONS[0], related = PROGRESSIONS.find(p => p.id === chosen.related);
    const link = ({ name, url }) => Object.assign(document.createElement("a"), { href: url, target: "_blank", rel: "noopener", textContent: name });
    $("progression-sources").replaceChildren(...[
      ...(chosen.sources?.length ? [`${chosen.name}: `, ...chosen.sources.flatMap((s, k) => [...(k ? ["; "] : []), link(s)]), "."] : []),
      ...(related ? [`${chosen.sources?.length ? " " : `${chosen.name}: `}Related: ${related.name}.`] : []),
    ]);
    $("progression-sources").hidden = !chosen.sources?.length && !related;
  }
  function showProgression({ fresh = false } = {}) {
    const keep = fresh ? 0 : Number($("key").value) || 0, meterChanged = piece?.origin?.type !== "progression" || piece.time.join("/") !== library.progression.time.join("/"), before = piece;
    piece = progressionFor(picker.value);
    capoOn = false;
    showKeys(keep);
    showPracticeControls();
    showProgressions();
    showTextures();
    showVersions();
    $("tempo").max = String(Math.max(140, Math.ceil(tempoFor(piece, "maestro") / 10) * 10));
    // A strumming pattern has its own tempo.
    if (fresh || meterChanged || before?.bpm !== piece.bpm) setTempo(tempoFor(piece, $("level").value));
    return recompute();
  }
  $("progression-list").addEventListener("click", event => {
    const card = event.target.closest("[data-progression]");
    if (!card || card.dataset.progression === library.progression.id) return;
    library.progression.id = card.dataset.progression;
    rememberLibrary();
    void showProgression();
  });

  // ---- inversions -------------------------------------------------------------------------------------------------------
  // Every chord name of a chord song in the tab (songs, charts, progressions, a scale's chords, an imported score's
  // chords) gets two xs buttons: the next inversion of that chord, and back to the chord as written. An inversion asks
  // scorify for a voicing with that chord tone in the bass and is searched again under the difficulty's limits; when
  // nothing plays, the page says so and the inversions can be undone there. Inversions belong to the piece and key on
  // show; another piece or key starts without them.
  let inversions = {}, inversionScope = "";
  /** The inversions in force for a request: none after the piece or the key changed. */
  function inversionsFor(target, transpose) {
    const scope = `${target.id}|${transpose}`;
    if (scope !== inversionScope) { inversions = {}; inversionScope = scope; }
    return Object.keys(inversions).length ? { inversions: { ...inversions } } : {};
  }
  let shownChords = [];
  const invertButton = (icon, label, className, action) => {
    const button = Object.assign(document.createElement("button"), { type: "button", className: `btn ${className}`, title: label });
    Object.assign(button.dataset, { variant: "ghost", size: "icon-xs" });
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg class="sc-icon" aria-hidden="true"><use href="#${icon}"/></svg>`;
    // The tab seeks and loops on pointer gestures; these buttons only invert.
    for (const type of ["pointerdown", "mousedown", "dblclick"]) button.addEventListener(type, event => event.stopPropagation());
    button.addEventListener("click", event => { event.stopPropagation(); action(); });
    return button;
  };
  function decorateChords() {
    for (const element of document.querySelectorAll("#song-tab .fretboard-chord:not([data-inversions])")) {
      const slot = shownChords[Number(element.dataset.item?.replace("chords-", ""))]?.slot;
      element.dataset.inversions = slot ? "" : "none";
      if (!slot) continue;
      const now = INVERSION_NAMES[slot.inversion] ?? "another tone in the bass", next = slot.inversion < 0 ? 0 : (slot.inversion + 1) % slot.tones;
      const box = Object.assign(document.createElement("span"), { className: "sc-inversion" });
      const reset = invertButton("i-undo", `${slot.symbol} in bar ${slot.key.split(".")[0]} as written`, "sc-invert-reset", () => { delete inversions[slot.key]; void recompute(); });
      reset.disabled = !slot.asked;
      box.append(invertButton("i-cycle", `${slot.symbol} in bar ${slot.key.split(".")[0]}: ${now}; next ${INVERSION_NAMES[next]}`, "sc-invert", () => { inversions[slot.key] = next; void recompute(); }), reset);
      element.append(box);
    }
  }
  new MutationObserver(decorateChords).observe($("song-tab"), { childList: true, subtree: true });

  // ---- custom mode ----------------------------------------------------------------------------------------------------
  // Every option the playground otherwise chooses: version, mode, key, capo, tuning, the player's limits, what adaptive
  // mode may change, the search budget and the playback feel. Empty fields keep the difficulty's defaults, shown greyed.
  const form = $("custom-form");
  const LIMITS = [["c-span", "maxFretSpan"], ["c-shift", "maxShiftFretsPerSecond"], ["c-attacks", "maxAttacksPerSecond"], ["c-polyphony", "maxPolyphony"], ["c-maxfret", "maxFret"]];
  const PERMISSIONS = [["c-ornaments", "allowOrnamentOmission"], ["c-accompaniment", "allowAccompanimentOmission"], ["c-octaves", "allowOctaveShift"],
    ["c-rhythm", "allowRhythmSimplification"], ["c-holds", "allowHoldShortening"], ["c-melody", "preserveMelody"]];
  const DEFAULT_PERMISSIONS = { allowOrnamentOmission: true, allowAccompanimentOmission: true, allowOctaveShift: true, allowRhythmSimplification: false, allowHoldShortening: false, preserveMelody: true };
  const SEARCHES = [["c-beam", "beamWidth"], ["c-candidates", "maxCandidatesPerFrame"], ["c-budget", "maxExpandedStates"]];
  function showVersions() {
    $("c-version").replaceChildren(new Option("By difficulty", ""), ...piece.versions.map(v => new Option(`${LEVELS[v.difficulty] ?? v.difficulty} · ${v.label}`, v.id)));
    $("c-version").value = custom?.arrangement?.version ?? "";
    showDefaults();
  }
  /** Placeholders: what the chosen difficulty uses when a field is left empty. */
  function showDefaults() {
    const profile = compilePlayer({ level: $("level").value });
    for (const [id, key] of LIMITS) $(id).placeholder = String(profile[key]);
    $("c-tuning").placeholder = instruments.find(i => i.id === picker.value).create().strings.map(s => s.openPitch).join(" ");
    $("c-complexity").placeholder = profile.complexity.toFixed(2);
    $("c-flexibility").placeholder = profile.flexibility.toFixed(2);
  }
  const number = id => ($(id).value.trim() === "" ? undefined : Number($(id).value));
  const choice = id => $(id).value || undefined;
  const defined = object => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
  /** The form as settings: the arrangement's (part of the cache key), the capo, and playback's (not). */
  function readCustom() {
    const tuning = $("c-tuning").value.trim().split(/[\s,]+/).filter(Boolean);
    const overrides = defined({ ...Object.fromEntries(LIMITS.map(([id, key]) => [key, number(id)])),
      allowBarre: { allow: true, forbid: false }[$("c-barre").value], rightHand: choice("c-hand") });
    const adaptation = Object.fromEntries(PERMISSIONS.map(([id, key]) => [key, $(id).checked]));
    const search = defined({ strategy: choice("c-strategy"), ...Object.fromEntries(SEARCHES.map(([id, key]) => [key, number(id)])) });
    const arrangement = defined({
      version: choice("c-version"), mode: choice("c-mode"), transpose: number("c-transpose") || undefined, tuning: tuning.length ? tuning : undefined,
      complexity: number("c-complexity"), flexibility: number("c-flexibility"),
      overrides: Object.keys(overrides).length ? overrides : undefined,
      adaptation: PERMISSIONS.some(([, key]) => adaptation[key] !== DEFAULT_PERMISSIONS[key]) ? adaptation : undefined,
      search: Object.keys(search).length ? search : undefined,
    });
    const performance = defined({ humanize: number("c-humanize"), seed: $("c-seed").value.trim() || undefined });
    return { arrangement: Object.keys(arrangement).length ? arrangement : null, capo: number("c-capo"), performance };
  }
  function writeCustom(settings) {
    form.reset();
    const a = settings?.arrangement ?? {};
    showVersions();
    $("c-version").value = a.version ?? ""; $("c-mode").value = a.mode ?? ""; $("c-transpose").value = a.transpose ?? "";
    $("c-capo").value = settings?.capo ?? ""; $("c-tuning").value = a.tuning?.join(" ") ?? "";
    $("c-complexity").value = a.complexity ?? ""; $("c-flexibility").value = a.flexibility ?? "";
    for (const [id, key] of LIMITS) $(id).value = a.overrides?.[key] ?? "";
    $("c-barre").value = a.overrides?.allowBarre === undefined ? "" : a.overrides.allowBarre ? "allow" : "forbid";
    $("c-hand").value = a.overrides?.rightHand ?? "";
    for (const [id, key] of PERMISSIONS) $(id).checked = (a.adaptation ?? DEFAULT_PERMISSIONS)[key];
    $("c-strategy").value = a.search?.strategy ?? "";
    for (const [id, key] of SEARCHES) $(id).value = a.search?.[key] ?? "";
    $("c-humanize").value = settings?.performance?.humanize ?? ""; $("c-seed").value = settings?.performance?.seed ?? "";
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const settings = readCustom();
    custom = settings.arrangement || settings.capo !== undefined || Object.keys(settings.performance).length ? settings : null;
    void rearrange();
  });
  $("c-reset").addEventListener("click", () => { custom = null; writeCustom(null); void rearrange(); });

  // An arrangement file holds the request, the piece it was made for (a built-in song by id, an imported score or a
  // chart with its score) and the log with its result, so opening it replays without a search on the same build.
  const arrangementFile = () => ({
    schema: ARRANGEMENT_SCHEMA, title: piece.title, instrument: instruments.find(i => i.id === picker.value).name, savedAt: new Date().toISOString(),
    piece: piece.origin ?? { type: "song", id: piece.id }, request: attempt.request, custom, log: attempt.log,
  });
  function download(data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    const slug = `${data.title}-${data.instrument}-${data.request.level}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const link = Object.assign(document.createElement("a"), { href: url, download: `${slug}.arrangement.json` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("c-export").addEventListener("click", () => { if (attempt) download(arrangementFile()); });
  $("c-save").addEventListener("click", async () => {
    if (!attempt) return;
    const data = arrangementFile();
    const saved = await store("saved", "readwrite", s => s.put({ id: `${Date.now()}`, ...data }));
    setStatus(saved === undefined ? "This browser does not allow saving here; use Export instead." : `Saved “${data.title}” on the ${data.instrument} in this browser.`);
    await showSaved();
  });
  /** Open an exported or saved arrangement: rebuild its piece if needed, restore the settings and replay its log. */
  async function openArrangement(data) {
    if (data?.schema !== ARRANGEMENT_SCHEMA || !data.request || !Array.isArray(data.log)) throw new Error("Not a scorify arrangement file");
    const origin = data.piece ?? {};
    let target = origin.type === "song" ? pieces.get(origin.id) : null;
    if (origin.type === "score") target = addScore(origin.data, { id: origin.id, instrument: origin.instrument, select: false });
    if (origin.type === "chart") target = addChart(origin.chart, origin.data, { id: origin.id, instrument: origin.instrument });
    if (origin.type === "scale") {
      Object.assign(library.scale, { play: "up-down" }, origin.exercise);
      const { capo = 0, frets, custom: settings } = data.request, { scale, tonic, time, play } = library.scale, kept = { type: "scale", exercise: { ...library.scale } };
      target = playsChords()
        ? withOrigin(scaleChordsSong({ scale, tonic, time }, { instrument: data.request.instrumentId, style: play }), kept)
        : withOrigin(scalePiece({ ...library.scale, direction: play }, instrumentFor(customInstrumentId(data.request.instrumentId, { capo, frets, tuning: settings?.tuning })), { instrumentId: data.request.instrumentId }), kept);
    }
    if (origin.type === "progression") {
      Object.assign(library.progression, { id: origin.id, time: origin.time, style: origin.style ?? "strum", pattern: origin.pattern ?? "" });
      target = progressionFor(data.request.instrumentId);
    }
    if (!target) throw new Error(`This page has no song “${origin.id ?? "?"}” to open it with`);
    selectLibrary(origin.type === "scale" ? "scales" : origin.type === "progression" ? "progressions" : "songs");
    piece = target;
    picker.value = data.request.instrumentId;
    setFrets(data.request.frets ?? highestFret(picker.value));
    $("level").value = data.request.level;
    if (origin.type === "scale") { showScaleForm(); showScaleKeys(); } else showKeys(data.request.transpose ?? 0);
    if (origin.type === "progression") showProgressions();
    showPracticeControls();
    inversions = { ...(data.request.inversions ?? {}) };
    inversionScope = `${piece.id}|${data.request.transpose ?? 0}`;
    if (data.request.texture) piece.texture = data.request.texture;
    custom = data.custom ?? (data.request.custom ? { arrangement: data.request.custom, performance: {} } : null);
    // A capo from the suggestion toggle comes back as the toggle; the suggestion is the same for the same request.
    capoOn = !!data.request.capo && custom?.capo === undefined;
    writeCustom(custom);
    showTextures();
    setTempo(data.request.bpm);
    memory.set(cacheKey(piece, { ...data.request, texture: piece.texture }), data.log);
    $("custom-panel").open = !!custom;
    await recompute();
  }
  async function showSaved() {
    const saved = ((await store("saved", "readonly", s => s.getAll())) ?? []).sort((a, b) => b.id.localeCompare(a.id));
    $("saved-empty").hidden = saved.length > 0;
    $("saved-list").replaceChildren(...saved.map(item => {
      const row = Object.assign(document.createElement("li"), { className: "sc-saved-item" });
      const text = Object.assign(document.createElement("span"), { className: "sc-saved-text" });
      text.append(Object.assign(document.createElement("strong"), { textContent: item.title }),
        ` · ${item.instrument} · ${LEVELS[item.request.level] ?? item.request.level} · ${item.request.bpm} BPM${item.request.capo ? ` · capo ${item.request.capo}` : ""}${item.request.frets ? ` · frets up to ${item.request.frets}` : ""}${item.request.custom ? " · custom" : ""} · ${new Date(item.savedAt).toLocaleString()}`);
      const button = (label, action, variant = "outline") => {
        const b = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: label });
        b.dataset.size = "sm"; b.dataset.variant = variant;
        b.addEventListener("click", action);
        return b;
      };
      row.append(text,
        button("Open", () => openArrangement(item).catch(error => showProblem("Could not open the arrangement", [error.message]))),
        button("Export", () => download(item)),
        button("Delete", async () => { await store("saved", "readwrite", s => s.delete(item.id)); await showSaved(); }, "ghost"));
      return row;
    }));
  }
  $("c-import").addEventListener("click", () => $("c-file").click());
  $("c-file").addEventListener("change", async () => {
    const file = $("c-file").files?.[0];
    $("c-file").value = "";
    if (!file) return;
    try { await openArrangement(JSON.parse(await file.text())); }
    catch (error) { showProblem(`${file.name} could not be opened`, [error.message]); }
  });

  // Opened scores stay in this browser (localStorage), so they come back after a reload; nothing is uploaded.
  const STORE = "scorify-demo-opened-scores";
  const stored = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? "[]"); } catch { return []; } };
  function remember(data) {
    try {
      const title = data.schema === SET_SCHEMA ? data.title : data.notation?.title;
      localStorage.setItem(STORE, JSON.stringify([...stored().filter(d => (d.schema === SET_SCHEMA ? d.title : d.notation?.title) !== title), data].slice(-12)));
    } catch { /* storage full or blocked: the score stays for this visit */ }
  }
  /** The card of a piece: the existing one with its id (a song it replaces), or a new one before "Open a score file". */
  function cardFor(id) {
    let card = document.querySelector(`[data-song="${CSS.escape(id)}"]`);
    if (!card) {
      card = document.createElement("button");
      card.type = "button"; card.className = "sc-song"; card.dataset.song = id; card.setAttribute("aria-pressed", "false");
      const art = Object.assign(document.createElement("span"), { className: "sc-song-art", textContent: "📜" });
      art.dataset.art = "score"; art.setAttribute("aria-hidden", "true");
      const copy = Object.assign(document.createElement("span"), { className: "sc-song-copy" });
      copy.append(
        Object.assign(document.createElement("span"), { className: "sc-song-kind" }),
        Object.assign(document.createElement("strong"), { className: "sc-song-title" }),
        Object.assign(document.createElement("span"), { className: "sc-song-credit" }),
        Object.assign(document.createElement("span"), { className: "sc-song-meta" }),
      );
      card.append(art, copy);
      $("open-score").before(card);
    }
    return card;
  }
  /** A score or a score set gets its own card; the skill's files carry their provenance in notation.source. */
  function addScore(data, { id, instrument, select = true, cacheBase } = {}) {
    const input = data?.schema === SET_SCHEMA
      ? { ...data, variants: data.variants.map(v => ({ ...v, score: normalizeScore(v.score) })) }
      : normalizeScore(data);
    const imported = Object.assign(pieceFromScore(input, { id, instrument }), { cacheBase, origin: { type: "score", data, id, instrument } });
    pieces.set(imported.id, imported);
    const card = cardFor(imported.id), versions = imported.versions.length;
    const vocal = imported.score.notes.filter(n => imported.score.notation?.vocal?.includes(n.partId)).length;
    card.querySelector(".sc-song-kind").textContent = `Song · ${imported.rhythm}`;
    card.querySelector(".sc-song-title").textContent = imported.title;
    card.querySelector(".sc-song-credit").textContent = imported.credit;
    card.querySelector(".sc-song-meta").textContent = vocal ? `${vocal} vocal notes · accompaniment included`
      : versions > 1 ? `${versions} versions · ${imported.versions[0].difficulty} to ${imported.level}` : `${imported.score.notes.length} notes · about ${imported.level}`;
    card.dataset.loaded = "";
    if (select) choose(imported);
    return imported;
  }
  /** A chord chart written for a score with a sung part: its strummed versions play under the score's voice and words. */
  function addChart(chart, data, { id, instrument, cacheBase } = {}) {
    const song = Object.assign(songFromChart(chart, normalizeScore(data), { id, instrument }), { cacheBase, origin: { type: "chart", chart, data, id, instrument } });
    pieces.set(song.id, song);
    const card = cardFor(song.id);
    card.querySelector(".sc-song-kind").textContent = `Song · ${song.time[0]}/${song.time[1]}`;
    card.querySelector(".sc-song-title").textContent = song.title;
    card.querySelector(".sc-song-credit").textContent = song.credit;
    card.querySelector(".sc-song-meta").textContent = `${song.vocal.length} vocal notes · ${song.versions.length} versions · ${song.key} ${song.mode} · ${song.bpm} BPM`;
    card.dataset.loaded = "";
    return song;
  }
  $("open-score").addEventListener("click", () => $("score-file").click());
  $("score-file").addEventListener("change", async () => {
    const files = [...($("score-file").files ?? [])];
    $("score-file").value = "";
    for (const [k, file] of files.entries()) {
      try {
        const data = JSON.parse(await file.text());
        if (data?.schema === ARRANGEMENT_SCHEMA) { await openArrangement(data); continue; }
        addScore(data, { select: k === files.length - 1 });
        remember(data);
      } catch (error) { showProblem(`${file.name} is not a scorify score`, [error.message, "Convert scores with the score-import skill (skills/score-import/ in the repository)."]); }
    }
  });
  // The page's imported songs: a score, or a score with the chord chart written for it.
  for (const card of document.querySelectorAll("[data-score-url]")) {
    try {
      const [score, chart] = await Promise.all([card.dataset.scoreUrl, card.dataset.chartUrl].map(async url => url && (await fetch(url)).json()));
      const options = { id: card.dataset.song, instrument: card.dataset.instrument, cacheBase: "assets/cache/" };
      if (chart) addChart(chart, score, options);
      else addScore(score, { ...options, select: false });
    } catch (error) { card.disabled = true; card.title = `Could not load: ${error.message}`; }
  }
  for (const data of stored()) {
    try { addScore(data, { select: false }); } catch { /* a stored score that no longer validates is skipped */ }
  }
  const localScores = document.querySelector('meta[name="scorify-local-scores"]');
  if (localScores) {
    const response = await fetch(localScores.content, { cache: "no-store" }), cacheBase = localScores.content.replace(/index\.json$/, "cache/");
    if (!response.ok) throw new Error("Could not load the local practice library.");
    for (const entry of await response.json()) {
      const [score, chart] = await Promise.all([entry.url, entry.chartUrl].map(url => url && fetch(url, { cache: "no-store" })));
      if (!score.ok || (chart && !chart.ok)) throw new Error(`Could not load the local score ${entry.id}.`);
      if (chart) addChart(await chart.json(), await score.json(), { id: entry.id, instrument: entry.instrument, cacheBase });
      else addScore(await score.json(), { id: entry.id, instrument: entry.instrument, select: false, cacheBase });
    }
  }

  picker.addEventListener("change", () => { showDefaults(); setFrets(fretsFor(picker.value)); showPracticeControls(); void rearrange(); });
  $("frets").addEventListener("input", () => setFrets(Number($("frets").value)));
  $("frets").addEventListener("change", () => { keepFrets(Number($("frets").value)); void rearrange(); });
  $("capo").addEventListener("change", () => { capoOn = $("capo").checked; void recompute(); });
  $("voices").addEventListener("change", () => { piece.texture = $("voices").value; void recompute(); });
  $("key").addEventListener("change", () => {
    if (library.tab === "scales") { library.scale.tonic = $("key").value; rememberLibrary(); showScale(); return; }
    if (library.tab === "progressions") showProgressions();
    void recompute();
  });
  $("tempo").addEventListener("input", () => setTempo(Number($("tempo").value)));
  $("tempo").addEventListener("change", () => void changeTempo());
  // Each difficulty starts at its own tempo (maestro 20% faster than the piece).
  $("level").addEventListener("change", () => {
    showDefaults();
    if (library.tab === "scales") return void showScale({ fresh: true });
    setTempo(tempoFor(piece, $("level").value));
    void recompute();
  });
  $("download").addEventListener("click", async () => {
    if (!plan) return;
    try {
      // What playback sounds like, without the count-in: the strings and the guide voice through the effects, the
      // metronome dry on top.
      const sampleRate = 44100, strings = audio.renderPerformance(performTake(), { sampleRate, tailSeconds: 0.5 });
      const add = (into, from) => { for (const [k, channel] of into.channels.entries()) channel.forEach((_, i) => { channel[i] += from.channels[k][i] ?? 0; }); return into; };
      const line = practice.voice ? sungLine() : [];
      if (line.length) add(strings, audio.renderGuideVoice(line, { sampleRate, durationSeconds: strings.durationSeconds }));
      const performed = audio.applyEffects(strings, effectSettings());
      if (practice.metronome) add(performed, audio.renderClicks(clicksIn(0, performed.durationSeconds), { sampleRate, durationSeconds: performed.durationSeconds }));
      const wav = audio.encodeWav(performed);
      const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: `scorify-${piece.id}-${picker.value}-${$("level").value}-${$("tempo").value}bpm.wav` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { showProblem("WAV export failed", [error.message]); }
  });
  // ---- print ----------------------------------------------------------------------------------------------------------
  // The Print button shows a page: the title, the live tab laid out at page width, and every chord chart below it,
  // static. The tab moves into #print-sheet while printing and back afterwards; the page prints light.
  let printing = null;
  async function printScore() {
    if (!plan || !attempt || printing) return;
    stopAudio();
    const root = document.documentElement, sheet = $("print-sheet"), make = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text ?? "" });
    printing = { dark: root.classList.contains("dark"), scheme: root.style.colorScheme, parent: tab.parentNode, next: tab.nextSibling };
    root.classList.remove("dark");
    root.style.colorScheme = "light";
    const { request: asked, version, spec } = attempt, entry = instruments.find(i => i.id === asked.instrumentId);
    const head = make("header", "sc-print-head");
    head.append(make("h1", "", piece.title), make("p", "", [
      piece.credit,
      `${entry.name}${asked.custom?.tuning?.length ? ` (${asked.custom.tuning.join(" ")})` : ""}${asked.capo ? ` · capo on fret ${asked.capo}` : ""}`,
      `${LEVELS[asked.level]}${version.difficulty !== asked.level ? ` (${version.difficulty} version)` : ""}`,
      `${asked.bpm} BPM · ${piece.time.join("/")}${spec?.key ? ` · ${spec.key} ${spec.mode ?? ""}`.trimEnd() : ""}`,
    ].filter(Boolean).join(" · ")));
    const charts = [...document.querySelectorAll(".sc-charts .chord-chart")].map(chart => {
      const copy = chart.cloneNode(true);
      for (const name of ["data-active", "data-next", "data-soon", "data-state-name"]) copy.removeAttribute(name);
      return copy;
    });
    const grid = make("div", "sc-print-charts");
    grid.append(...charts);
    const close = make("button", "btn sc-print-close", "Close print view");
    close.type = "button";
    close.dataset.variant = "outline";
    close.addEventListener("click", endPrint);
    sheet.replaceChildren(close, head, tab, ...(charts.length ? [make("h2", "sc-print-charts-title", "Chords"), grid] : []),
      make("p", "sc-print-foot", "Arranged and fingered with scorify"));
    root.dataset.printing = "";
    // Let the tab lay its measures out for the page before the browser takes the picture.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await tab.api.settled?.();
    if (printing) window.print();
  }
  function endPrint() {
    if (!printing) return;
    const { dark, scheme, parent, next } = printing;
    printing = null;
    parent.insertBefore(tab, next);
    $("print-sheet").replaceChildren();
    delete document.documentElement.dataset.printing;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = scheme;
  }
  $("print").addEventListener("click", () => void printScore());
  window.addEventListener("afterprint", endPrint);
  document.addEventListener("keydown", event => { if (event.key === "Escape") endPrint(); });

  worker.addEventListener("error", () => { revision++; stopAudio(); plan = undefined; buttons(); fatal("The arrangement worker failed to load."); });
  window.addEventListener("pagehide", () => { revision++; silence(); stopTuner(); client.dispose(); worker.terminate(); void context?.close(); });
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });

  void showSaved();
  choose(pieces.get(songs[0].id));
} catch (error) {
  fatal(error.message);
}
