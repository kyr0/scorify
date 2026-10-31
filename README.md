# scorify

Instrument-aware music arrangement, transposition, and fingering constraints for vanilla JavaScript. TypeScript source, browser-native ESM, no external runtime dependencies.

## Install

```sh
npm install scorify        # or: bun add scorify · pnpm add scorify · yarn add scorify
```

Plain ESM with TypeScript declarations and no runtime dependencies. Without a bundler, an import map can load it from a CDN:

```html
<script type="importmap">
{ "imports": {
  "scorify": "https://cdn.jsdelivr.net/npm/scorify@0.4.0/dist/index.mjs",
  "scorify/worker": "https://cdn.jsdelivr.net/npm/scorify@0.4.0/dist/worker.mjs",
  "scorify/audio": "https://cdn.jsdelivr.net/npm/scorify@0.4.0/dist/audio.mjs"
} }
</script>
```

A Worker or an AudioWorklet must come from your page's own origin: copy the package's whole `dist/` folder next to your page for those (the entries share chunks) and pass `workletUrl` to the audio player. The `score-import` agent skill installs separately ([below](#importing-scores)).

## What works

- Exact rational musical time, voices, rests, ties, gates, tempo/meter/key maps, and stable source identities.
- Spelled note/key/chord transposition and tempo-map scaling, with unconstrained, exact, and adaptive modes.
- Spelled scales (`scorify/theory`: major, the three minors, pentatonics, blues, the modes, chromatic) and practice pieces (`scorify/songs`): scale exercises placed on the neck, and the most common Billboard chord progressions in four time signatures.
- Configurable fretted strings, tunings, capos and geometry; concert ukulele high G/low G and classical guitar presets.
- Four-finger assignments, open strings, barres, sustained-note contact, released-finger travel, static reach, and picking/strumming checks.
- Joint musical-edit and fingering search: exhaustive reference, exact dynamic programming, or bounded beam search.
- Baby → beginner → amateur → semi-pro → pro → expert → maestro profiles; independent complexity, flexibility and capability overrides. Lower levels prefer low positions (`highFretCosts`: up to semi-pro frets 0–8, below maestro rarely above 10), a soft cost that never drops a note.
- Optional octave revoicing, marked-ornament/accompaniment omission, rhythm simplification and explicit earlier releases, with an edit log.
- Window-based harmony candidates, including arpeggios, and known-tempo/meter performance quantization with timing alternatives.
- Async cancellation/progress, a dedicated-worker entry, latest-request handling and source-preserving recomputation sessions.
- A separate public replay validator, tests, package checks, benchmarks and a runnable vanilla-browser example.
- Optional ukulele/guitar waveguide synthesis, physical-order strums, seeded humanization, actual-time fingering replay, AudioWorklet playback and offline WAV export.

## Arrange a score

Import from `scorify` (or from a built `./dist/index.mjs`):

```js
import {
  createScore,
  parsePitch,
  q,
  arrange,
  concertUkulele,
} from "scorify";

const source = createScore(
  [
    {
      id: "melody",
      pitch: parsePitch("C4"),
      onset: q(0),
      duration: q(1),
      partId: "song",
      voiceId: "melody",
      role: "melody",
    },
    {
      id: "decoration",
      pitch: parsePitch("E4"),
      onset: q(0),
      duration: q(1),
      partId: "song",
      voiceId: "harmony",
      role: "ornament",
    },
  ],
  {
    tempoMap: [{ at: q(0), quarterBpm: 100 }],
    keyMap: [{ at: q(0), tonic: "C", mode: "major" }],
  },
);

const instrument = concertUkulele({ tuning: "lowG" });
const result = arrange(source, {
  instrument,
  mode: "adaptive",
  transform: { interval: "2M", tempoScale: 0.75 },
  player: { level: "beginner", overrides: { allowBarre: false } },
  adaptation: {
    preserveMelody: true,
    allowOctaveShift: true,
    allowAccompanimentOmission: true,
  },
});

if (result.status === "success") {
  console.log(result.score, result.annotations, result.edits);
  console.log(result.sourceHarmony, result.realizedHarmony);
} else {
  console.log(result.status, result.diagnostics);
}
```

All pitches are **sounding** pitches. A guitar's written octave belongs in `Part.writtenToSounding`; it must not shift fret calculations. Time is a normalized `[numerator, denominator]` measured in quarter notes. `q(1, 3)` is one third of a quarter, independent of meter. `createScore` explicitly defaults to 120 quarter BPM, 4/4 and A=440; it never infers a key.

A note's `duration` is its notation. Optional `gateDuration` declares an earlier sounding release. Without a gate, the full duration must be sustained. Contiguous `tieGroupId` fragments become one physical sounding note while retaining every notated event.

## Modes and results

| Mode              | Behavior                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `unconstrained`   | Transform the symbolic score without requiring an instrument or assigning fingers.          |
| `exact` (default) | Preserve transformed pitches, multiplicity, timing and holds; search physical realizations. |
| `adaptive`        | Jointly select permitted score edits and physical realizations.                             |

`success` includes output score, fingerings, separate source/realized harmony, edits, source mapping, difficulty components, model versions, effective profile, and search statistics. Ranking first minimizes musical loss, then the total ergonomic/transition/style cost. Even maestro cannot bypass a hard physical limit.

`infeasible` means an exhaustive search proved no path **within this finite model**. `search-exhausted` means candidate pruning or a resource limit prevented finding a complete path. Other statuses are `invalid-input`, `unsupported`, and `cancelled`. `optimality` is `proven-in-model` only when nothing was truncated; otherwise it is `best-found`. No partial prefix is emitted as a successful arrangement.

`arrange` defaults to beam width 64, 128 realization candidates per parent/frame, 500,000 expansion operations, 10,000 input notes, 20,000 total score events/map entries, and 10,000 frames. `search.strategy: 'exact'` performs dominance-pruned dynamic programming without beam/candidate pruning by default, but still observes the expansion budget. `'exhaustive'` disables dominance merging for tiny reference cases. Larger exact searches can grow exponentially.

## Instruments and player profiles

```js
import {
  concertUkulele,
  classicalGuitar,
  createFrettedInstrument,
} from "./dist/presets.mjs";

const highG = concertUkulele(); // G4 C4 E4 A4
const lowG = concertUkulele({ tuning: "lowG" }); // G3 C4 E4 A4
const guitar = classicalGuitar({ capoFret: 2 }); // E2 A2 D3 G3 B3 E4 before capo
const custom = createFrettedInstrument("custom", "My tuning", [
  "D4",
  "G4",
  "B4",
  "E5",
]);
const measured = { ...guitar, scaleLengthMm: 650, stringSpacingMm: 11 };
```

Strings stay in physical bass-edge → treble-edge order; reentrant tuning is never pitch-sorted. The editable default fret count is 19 (18 for `concertUkulele`). Per-string configuration accepts `openPitch`, `capoFret`, `fretCount`, stable `id`, and tab `number`. Frets are absolute from the original nut; displayed relative fret = absolute fret − that string's capo. Geometry values must describe your instrument or an explicitly chosen nominal model.

`player.complexity` in `[0,1]` limits the fraction of marked ornament sounding events retained in adaptive mode. It never generates ornaments or decides that an unmarked non-chord tone is disposable. `player.flexibility` in `[0,1]` controls fret span, movement speed and setup-time defaults. Overrides include:

- `maxFretSpan`, `maxReachMm`, `fingerPairMaxMm`, `maxFret`.
- `maxShiftFretsPerSecond`, `maxFingerSpeedMmPerSecond`, `fingerSetupSeconds`.
- `maxPolyphony`, `maxVoices`, `maxAttacksPerSecond`, `minDuration`, `rhythmGrid`.
- `allowBarre`, `maxBarreStrings`, `rightHand: 'pick' | 'strum'`, `allowMutedStrum`, and `familiarShapes`.

Millimetre limits require both scale length and string spacing. The geometric model approximates frets and contact points; it does not model wrists, tissue, or individual anatomy. A familiar shape is its physical string-order fret signature, e.g. `0-0-0-3`; `x` marks an unused string.

Tempo changes are explicit. `autoTempo: true` lowers the highest tempo segment to the selected level's suggested ceiling while preserving tempo-map ratios. It never speeds up a score, and cannot be combined with an explicit tempo transformation.

## Adaptation permissions

Marked-ornament omission is allowed by default in adaptive mode; all other musical changes require explicit permission. Melody is retained by default. Use note locks (`keep`, `pitch`, `onset`, `duration`) and `protectedNoteIds` for essential material. Locks constrain adaptation after the requested global transformation.

| Permission                                      | Candidate edits                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `allowOrnamentOmission`                         | Omit notes explicitly marked `ornament`.                                                           |
| `allowAccompanimentOmission`                    | Omit notes explicitly marked `harmony` or `bass`.                                                  |
| `allowMelodyOmission` + `preserveMelody: false` | Permit a melody skeleton; locked/protected anchors remain.                                         |
| `allowOctaveShift`                              | Revoice retained notes by `octaveShifts` (default −1/+1).                                          |
| `allowRhythmSimplification`                     | Delay onsets to `rhythmGrid` within `maxOnsetDelay`, and lengthen untied note values to that grid. |
| `allowHoldShortening`                           | Select explicit earlier gates using `gateRatios` (default 0.5/0.75).                               |

These are finite, reported edits. Rhythm and gate edits currently apply to untied notes only. Rhythm edits cannot overlap an explicit rest in the same voice. `maxOmissions` caps omitted sounding events. `allowAddedOrnaments` must remain false; generation of new ornaments is outside v0.2. Unknown roles are never silently reclassified as accompaniment.

## Harmony and performance timing

```js
import { analyzeHarmony, quantizePerformance, q } from "./dist/index.mjs";

const harmony = analyzeHarmony(source); // meter-sized windows by default
const quantized = quantizePerformance(
  [
    {
      id: "n1",
      pitch: "C4",
      onsetSeconds: 0.01,
      durationSeconds: 0.49,
      partId: "song",
      voiceId: "melody",
    },
  ],
  {
    tempoMap: [{ at: q(0), quarterBpm: 120 }],
    meterMap: [{ at: q(0), numerator: 4, denominator: 4 }],
    subdivisions: [1, 2, 3, 4, 6, 8], // subdivisions per quarter
    toleranceSeconds: 0.05,
  },
);
```

Harmony windows collect sounding notes and arpeggios, use the actual bass, and preserve alternative labels. Provided harmony remains authoritative in the source layer. `respectProvided: false` analyzes the actual rendition. Candidate scores are heuristic ranks, not probabilities; sparse evidence remains unknown.

Quantization integrates the supplied tempo map, considers positive-duration rational on/off pairs, and jointly preserves exact simultaneous attacks and voice-overlap relations. It returns the original performance, edits, selected score and local timing alternatives. Alternatives are not all mutually compatible full-score paths. Default caps: 64 candidates/note, 256 frontier states, 200,000 expansions. A pruned success is `best-found`; impossible local tolerances return `infeasible`. Meter, tempo, rubato and swing are not inferred.

## Async, workers, and recomputation

```js
import { createWorkerClient } from "./dist/worker.mjs";
import { concertUkulele } from "./dist/presets.mjs";

const worker = new Worker(new URL("./dist/worker-entry.mjs", import.meta.url), {
  type: "module",
});
const client = createWorkerClient(worker);
const options = {
  instrument: concertUkulele(),
  mode: "adaptive",
  player: { level: "beginner" },
};
const result = await client.arrange(source, options, (progress) =>
  console.log(progress),
);
// client.cancel();
client.dispose();
worker.terminate();
```

A newer worker request cancels the previous request and ignores stale responses. The endpoint reads cancel messages and posts progress once per ~12 ms time slice. Worker options must be serializable; use `client.cancel()` instead of sending an AbortSignal. Custom scoring hooks run in direct/async calls, not through the provided worker protocol.

For cooperative scheduling, use `arrangeAsync(source, { ...options, signal }, { onProgress, yieldEvery, schedule })`. Scheduling happens at bounded search checkpoints, not during every primitive operation; use a dedicated worker for UI isolation.

`createArrangementSession(source)` keeps a copied original and an LRU result cache (default eight entries). `session.recompute(options)` cancels a previous request and always starts from that original. Instrument, tuning, geometry, tempo, policy, search settings and scoring-hook ID participate in the cache key. Cached results are returned as independent data. This is whole-score recomputation, not an incremental phrase-edit engine.

A direct `scoring: { id, cost(frame, realization) }` hook must be pure, deterministic, finite and nonnegative. Its versioned ID is the caller's responsibility. It cannot override hard validity or the musical-fidelity priority.

## Plucked strings, strums and humanization

```js
import {
  createPerformance,
  createAudioPlayer,
  renderPerformance,
  encodeWav,
} from "./dist/audio.mjs";

// Use a successful fretted result and the instrument that produced it.
const performed = createPerformance(result, instrument, {
  seed: "take-42",
  humanize: 0.6,
  strum: { direction: "down", spreadSeconds: 0.035 }, // false for picking
});
if (performed.status !== "success")
  throw new Error(performed.diagnostics.join("; "));
const plan = performed.performance;
const context = new AudioContext();
const player = await createAudioPlayer(context);
playButton.onclick = async () => {
  const playback = await player.play(plan); // Call from a user gesture.
  console.log(await playback.finished);
};
stopButton.onclick = () => player.stop();
const wavBytes = encodeWav(renderPerformance(plan));
// Cleanup: player.dispose(); await context.close();
```

`scorify/tuner` listens too: `createPitchInput` feeds the microphone to a YIN pitch-detector AudioWorklet in real time, and `tuningTargets`/`nearestTarget` name the string being tuned and how many cents it is off ([AUDIO.md](docs/AUDIO.md#pitch-detection-and-tuning)).

Every string keeps its ringing state and receives fresh seeded excitation on each pluck. Strums are centered on their beat (the first strings slightly early, the last slightly late) and sweep faster at faster tempos. Humanization plays dynamics before it adds noise: bar accents, melody and bass over inner notes, the first string of a strum struck hardest, harder plucks louder and brighter, and a slow per-string tuning drift that stays within one cent; then it varies shared stroke timing, smaller string offsets, velocity, brightness, pluck position and decay without accumulating drift. A new seed gives a new take. Up/down strokes follow physical string order, including high-G ukulele. `humanize:0` disables expressive variation while retaining distinct repeatable excitations.

Performed timings are checked against the selected fingering. Note durations and pitch stay intact; timing jitter may be reduced with a diagnostic. If the strum itself is unplayable, the compiler reports it. It does not silently shorten notes or relax player limits. Preset timbres and ergonomic levels are synthetic, uncalibrated models.

Post effects run after the strings in the library itself: `renderPerformance(plan, { effects: { reverb: true, delay: true, delaySeconds: delayForTempo(96) } })`, `player.play(plan, { effects })` and `player.setEffects(…)`, or `createEffectsNode(context)` to route any Web Audio source through the same soft saturation, tape delay and reverb. Offline and worklet output are sample-identical.

[Audio API and design](docs/AUDIO.md) covers partial/muted strokes, pattern expansion, per-string tone, strict timing, cancellation, limits and deployment. The `performance` and `audio-dsp` subpaths work without browser APIs; audio stays outside the core import graph. `examples/audio/` includes four generated WAV studies and their reproducible source.

## Songs with a version per difficulty

`scorify/songs` is the arrangement layer the docs playground runs on. A chord-chart song (`ChordSong`) has a bar of chords for every bar and one version per difficulty: strum and pick patterns (`down`, `up`, `pick`), an alternating bass, phrase fills, releases before chord changes, held bars. `arrangeFor(piece, { instrumentId, level, bpm, transpose, capo, frets, custom }, { arrange })` plays the version written for the difficulty as written (exact mode), falls back to easier versions, and simplifies the easiest one only when none plays; its log says why each attempt failed (`voicing`, `limits`, `infeasible`, `search-exhausted`). It always searches at the piece's own tempo: `bpm` only scales the result for playback. `transpose` moves the piece by semitones (`KEY_SHIFTS`, `keyName`). An imported score also strums its chords, inferred from its notes: first at baby and beginner, last above. Chord shapes come from `voiceChord`: shapes on contiguous strings ranked like a chord book, each judged by arranging it. `songFromChart` plays a chord chart (`scorify-chart-1`) under an imported score's sung part, after its pickup if it has one; `pieceFromScore` turns imported scores and score sets (`scorify-set-1`) into pieces with an estimated difficulty and voice choices.

```js
import { arrange } from "scorify";
import { arrangeFor, down, up, suggestCapo, retime, tempoFor, cacheable } from "scorify/songs";

const song = {
  id: "loop", title: "Loop", instrument: "guitar", key: "B", mode: "minor", time: [4, 4], beat: 1, bpm: 90,
  progression: ["Bm", "A", "E", "Bm"],
  versions: [
    { id: "baby", difficulty: "baby", label: "A strum a bar", pattern: [down(0)], countStrokes: true },
    { id: "amateur", difficulty: "amateur", label: "D D U", pattern: [down(0), down(1), up(1.5)], countStrokes: true },
  ],
};
const request = { instrumentId: "guitar", level: "amateur", bpm: tempoFor(song, "amateur"), capo: 0, custom: null };
const run = await arrangeFor(song, request, { arrange: (source, options) => arrange(source, options) });
suggestCapo(song, request); // { capo: 2, shapes: ["Am", "G", "D"], chords: ["Bm", "A", "E"], hard: [1, 0] }
const slower = retime(song, { ...run, request }, { ...request, bpm: 70 }); // the same fingering, played at 70 BPM
const again = await arrangeFor(song, request, { arrange, replay: cacheable(run.log) }); // replayed, not searched
```

### Practice: scales and chord progressions

`scorify/theory` spells scales: `SCALES` (major, natural, harmonic and melodic minor, major and minor pentatonic, blues, Dorian, Phrygian, Lydian, Mixolydian, Locrian, chromatic), `TONICS` (twelve tonics as usually written, per major or minor quality) and `scalePitches(tonic, scale, { octaves, direction })` (`up-down`, `up`, `down` from the top, `down-up`), which keeps every degree on its own letter (F♯ major has E♯; the melodic minor falls as the natural minor; the chromatic scale rises in sharps and falls in flats).

`scorify/songs` turns them into practice pieces. `scalePiece(exercise, instrument, { instrumentId })` writes a scale over whole octaves in the exercise's `direction` (up and down by default), `perBeat` even notes a beat (`scaleRhythms(time)`: 1–4 in simple meters, 1, 3 or 6 in 6/8 and 12/8), the last note held to the bar line, at the lowest octave whose notes all lie on the instrument up to its highest fret (`scaleOnNeck` says whether one does). It is fingered at `SCALE_BPM` (60) as written, never simplified or moved; a difficulty that cannot play it is reported. `PROGRESSIONS` are 25 chord progressions chosen for recognizability, harmonic variety and practice value, from I–IV–V–I and the pop loops through minor, Dorian, borrowed and secondary-dominant progressions to jazz ii–V–I and the 12-bar blues. Each has its numerals (sevenths, `ø7`, `°` and `V/ii` included), explicit `bars` per chord where it is not one each, an `ending`, a note, links to its `sources`, and `songs`: how many of the McGill Billboard corpus's 739 Hot 100 songs (1958–1991, CC0) start a phrase with it, counted by scorify (for the 12-bar blues, songs with a 12-bar blues chorus; 0 where the corpus lacks it). `progressionSong(progression, time, { style })` makes one a chord song in C major or A minor, with a version per difficulty for 4/4, 3/4, 6/8 or 12/8, which `transpose` moves like any song; `chordOfNumeral` reads a roman numeral in a key (`ii7` Dm7, `iiø7` in A Bm7b5, `V/vi` E, `V7/ii` A7 in C). The `style` (`PROGRESSION_STYLES`) is `strum` (`PROGRESSION_VERSIONS`: every hit a strum, from one down strum a bar to syncopated sixteenths, never more than three quarters of the places on the bar's grid) or an arpeggio, `arpeggio-up`, `arpeggio-down` or `arpeggio-up-down` (`arpeggioVersions`): single picked tones walking the strings of each chord's voicing, from two notes a bar at baby to sixteenths or triplets at maestro (`ARPEGGIO_TIMES`). A strummed progression can instead play one of `STRUM_PATTERNS` (`progressionSong(progression, time, { pattern: "island" })`, `strumPattern(id)`): sixteen common patterns by style (island strum, reggae skank, ska upstrokes, rock downstrokes, pop and folk strums, funk sixteenths, boom-chick and boom-chicka, bluegrass chop, swing and blues shuffle, three waltz patterns, a 6/8 ballad), each written as players write it (`D · D U · U D U`; `writtenStrokes` turns such a line into hits), with its meter, tempo, the instruments it is typical on, and the easiest difficulty that plays it as written there (measured; an easier one plays it simplified and says so). Patterns with a picked bass need six strings (`strings`). A hit's `length` makes a short strum (a skank or a chop). Chucks and other muted, percussive strokes are not written: they have no pitch.

`scaleChordsSong({ scale, tonic, time }, { style })` plays a seven-note scale as its chords (`scaleTriads`: the triad on every degree, up to the octave and back) in the same styles.

A request's `inversions` puts another chord tone in the bass of single chords: keys from `segmentKey(bar, place, symbol)` (from 0; `"2.1:F"` is the first chord of bar 2), naming the chord as played (after `transpose`), values the chord tone (0 root position, 1 first inversion, … up to the seventh or sixth; `INVERSION_NAMES`); a key that names no chord of the version is reported in the notes. Each one is voiced again with that tone lowest (`voiceChord(symbol, instrumentId, { level, rightHand, inversion })`), its bass line follows, and the whole song is searched again under the difficulty's limits: an inversion that does not play is reported, never dropped. The prepared attempt lists every chord as played (`chords`: bar, symbol, chord tone in the bass, whether it was asked), the arrangement notes name the inverted ones, and the cache key includes them. `chordInversion(symbol, pitches)` names a voicing's inversion by its lowest sounding pitch, so the ukulele's open F (2010, C4 lowest) is in second inversion. Arpeggio versions start their search with a beam of 512 (`ARPEGGIO_SEARCH`): adding one picked note at a time, a narrow beam keeps stretches it would not choose for the whole chord.

```js
import { SCALES, scalePitches } from "scorify/theory";
import { scalePiece, scaleChordsSong, progressionSong, segmentKey, PROGRESSIONS, STRUM_PATTERNS, instrumentFor, arrangeFor } from "scorify/songs";

scalePitches("F#3", "major"); // F#3 G#3 A#3 B3 C#4 D#4 E#4 F#4 E#4 … F#3
const scale = scalePiece({ scale: "blues", tonic: "A", octaves: 2, perBeat: 2, time: [4, 4] }, instrumentFor("guitar"), { instrumentId: "guitar" });
const blues = progressionSong(PROGRESSIONS.find((p) => p.id === "12-bar-blues"), [12, 8], { style: "arpeggio-up" });
// Up a whole tone to D, the first chord with its third in the bass: D7/F#. Keys name the chords as played.
const run = await arrangeFor(blues, { instrumentId: "guitar", level: "semi-pro", bpm: 60, transpose: 2, inversions: { [segmentKey(0, 0, "D7")]: 1 }, custom: null }, { arrange });
const chords = scaleChordsSong({ scale: "major", tonic: "F", time: [3, 4] }, { style: "strum" }); // F Gm Am Bb C Dm Edim F …
const island = progressionSong(PROGRESSIONS.find((p) => p.id === "I-V-vi-IV"), [4, 4], { instrument: "uke-high-g", pattern: "island" }); // D · D U · U D U, 100 BPM
```

`arrange` may be a worker client. A `replay` log is used only for attempts whose source, options and `build` fingerprint alike, and only after `validateFrettedArrangement` accepts the replayed fingering. `retime` plays the result at another tempo without a search (tempo is playback only; the time-based limits were judged at the piece's tempo); the result says at which tempo it was searched. `suggestCapo` is a chord-shape heuristic (open, other, barre), not a measured ease. `LEVEL_TEMPO` (maestro 1.2×) is an editable policy. `INSTRUMENTS` and `instrumentFor` cover eight fretted instruments (highest fret: ukuleles 18, guitars 19, mandolin 20, from `highestFret`), with capo, highest-fret and tuning ids from `customInstrumentId`. A request's `frets` sets another highest fret, a hard limit of the instrument.

## Validate and extend

`validateFrettedArrangement(outputScore, instrument, annotations, playerOptions)` independently rebuilds active events from the output, checks complete attack/release coverage, pitch/string/finger contact, sustained assignments, capability limits and transitions. Every successful built-in fretted arrangement is replayed before return.

`InstrumentAdapter<State, Realization, Annotation>` owns enumeration, static validation, transitions, state equivalence, costs and description. `arrangeWithAdapter` and `arrangeSteps` accept custom adapters. State keys must include every future-relevant variable. A keyboard adapter is an extension point, not bundled keyboard fingering support.

## Development and browser example

```sh
bun install --frozen-lockfile
bun run check
bun run benchmark
bun run benchmark:audio
bun run examples:audio
bunx playwright install chromium
bun run check:browser
python3 -m http.server 8000
# http://localhost:8000/examples/browser/
bun run build:docs && bun run dev:docs
# http://localhost:4173 — the docs site and playground
bun run check:docs
bun run precompute:docs   # after changing the library or the songs; bun run check:cache verifies
```

The [docs site](docs/index.html) re-arranges three accompaniment songs, each written in seven versions from baby to maestro, an imported public-domain score, and eight public-domain songs with every verse of their words (Amazing Grace, Scarborough Fair, Shenandoah, Red River Valley, Loch Lomond, Auld Lang Syne, Silent Night, Happy Birthday to You; strummed up to semi-pro, picked above) for eight fretted instruments and every difficulty. It opens your own `.scorify.json` files and score sets, shows vocal pitches and lyrics under the tab, plays, pauses, resumes and loops the rendered accompaniment, explains the API and shows how to install. The usual configurations are precomputed and appear at once (replayed only after validation); a suggested capo can be toggled; Custom mode sets every arrangement option, re-computes, and exports, saves or imports the result. The local server automatically loads an optional private practice library from `work/private-scores/index.json`; its scores stay outside the static docs. A library entry can pair an imported score with a chord chart (`*.chart.json`), which plays strummed versions for every difficulty under the score's voice and words instead of adapting its piano part. [Building, checking and extending it](docs/DEMO.md) has the details.

### Importing scores

[`skills/score-import/`](skills/score-import/SKILL.md) holds `score-import`, a standalone agent skill and CLI (Python 3.9+, standard library) that finds scores on the web with CloakBrowser and converts MusicXML, MXL, ABC and MIDI into scorify Score JSON with lyrics and sung parts, recording where each file came from. `score.py bundle` packs several versions of one piece, each with its difficulty, into a score set. It honors robots.txt and stops at logins, paywalls and human checks. Its tests: `python3 -m unittest discover -s skills/score-import/tests`.

It is not part of the npm package; install it into your coding agent:

- **Claude Code**: this repository is a plugin marketplace. In Claude Code (2.1.275 or later), run `/plugin install score-import --marketplace kyr0/scorify`, or `claude plugin install score-import --marketplace kyr0/scorify` in a shell. That clones the whole repository (116 MB on disk, mostly the docs cache); from a shell, two steps work with any version and fetch only the skill (1.7 MB): `claude plugin marketplace add kyr0/scorify --sparse .claude-plugin skills`, then `claude plugin install score-import@scorify`. Ask for a score, or run `/score-import:score-import`. `claude plugin marketplace update scorify` fetches a newer version.
- **Codex**: `$skill-installer install https://github.com/kyr0/scorify/tree/main/skills/score-import` installs it into `~/.codex/skills/score-import`. Ask for a score, or run `$score-import`.
- **Other agents or one project**: copy or link the `skills/score-import/` folder into the agent's skills folder, such as `~/.agents/skills/score-import` or a project's `.claude/skills/score-import`.

Web pages need CloakBrowser once: `bunx cloakbrowser install`.

Use Bun 1.3.9 and Node 24. `pkgroll` builds ES2022 `.mjs`, declarations, source maps and third-party notices. `check` includes source typechecking, semantic tests, module-graph checks, and a real npm-tarball/declaration-consumer check. The browser check exercises native modules, the module worker, a live level change, actual audio playback and sample-exact worklet/offline parity at 44.1 and 48 kHz.

Root exports cover the score/arrangement API; audio uses optional subpaths. Smaller subpaths are `model`, `theory`, `fretted`, `presets`, `profiles`, `transforms`, `analysis`, `quantize`, `fingering`, `arrange`, `validate`, `adapters`, `songs`, and `worker`. Optional subpaths are `performance`, `audio-dsp`, `audio-effects`, `audio-guide`, `audio`, `pitch-detect`, and `tuner`. `worker-entry.mjs`, `audio-worklet.mjs` and `pitch-worklet.mjs` are side-effect entries for their respective worker contexts.

Native browser imports can use an exact-version CDN URL such as `https://cdn.jsdelivr.net/npm/scorify@0.4.0/dist/index.mjs`; the relative chunks are fetched from there. Browser Worker URLs should be served from your app's origin. For CDN-only use, `arrangeAsync` works directly; bundle/self-host a worker bootstrap if your origin policy requires it.

## Scope and evidence

[Implementation contract](docs/IMPLEMENTATION_SPEC.md) · [Research](docs/RESEARCH.md) · [Validation](docs/VALIDATION.md) · [Benchmarks](docs/BENCHMARK.json) · [GitHub setup](REPOSITORY_SETUP.md)

First-release limitations: ordinary 12-TET fretted notes; four ordered fretting fingers with a conservative fixed-contact barre model; simplified right-hand mechanics; explicitly supplied note roles; heuristic harmony and bounded known-map quantization. Advanced bends, harmonics, slides, finger substitution during a sustain, generated ornaments, audio/MIDI/MusicXML import, keyboard mechanics and learned difficulty models remain future work. Musician calibration and additional browser engines remain external validation work.

MIT. Bundled dependencies retain their notices in `THIRD-PARTY-LICENSES.txt`.
