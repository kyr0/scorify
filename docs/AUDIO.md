# Scorify v0.2: performance and plucked-string audio

The optional modules turn a **successful fretted arrangement** into validated performed timings and plucked-string audio. The symbolic score remains unchanged. Ukulele and guitar use the same configurable string engine with different editable timbre presets. This is synthetic instrument sound, not a sampled or measured acoustic reproduction.

## Quick start

```js
import { arrange, concertUkulele } from "./dist/index.mjs";
import {
  createPerformance,
  createAudioPlayer,
  renderPerformance,
  encodeWav,
} from "./dist/audio.mjs";

const instrument = concertUkulele({ tuning: "highG" });
const result = arrange(source, { instrument, player: { level: "expert" } });
if (result.status !== "success") throw new Error(result.status);

const performed = createPerformance(result, instrument, {
  seed: "take-42",
  humanize: 0.6,
  strum: { direction: "down", spreadSeconds: 0.035 },
});
if (performed.status !== "success") {
  throw new Error(performed.diagnostics.join("; "));
}
const plan = performed.performance;

// Your app owns this context. Resume from a click/touch handler.
const context = new AudioContext();
const player = await createAudioPlayer(context);
playButton.onclick = async () => {
  const playback = await player.play(plan);
  console.log(await playback.finished); // ended, stopped, disposed, or error
};
stopButton.onclick = () => player.stop();
// On application cleanup: player.dispose(); await context.close();

// Synchronous, host-neutral rendering; use a Worker for long exports.
const audio = renderPerformance(plan, { sampleRate: 48000 });
const wav = encodeWav(audio); // Uint8Array, stereo PCM16 RIFF/WAVE
```

For melodies or independently picked notes use `strum: false`. The default is a downstroke over each simultaneous attack group, centered on its beat, sweeping at a speed set by the local tempo (below). A valid picked arrangement may not admit that strum: the performance compiler reports the conflict rather than deleting notes or changing the selected fingering.

## Module boundaries and deployment

| Import                  | Responsibility                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `scorify`               | Existing score, theory, arrangement, and fingering APIs; no audio modules                 |
| `scorify/performance`   | Plans, strum patterns, humanization and actual-time replay; no browser APIs or DSP        |
| `scorify/audio-dsp`     | Waveguides, presets, stereo block/offline rendering, WAV; no score solver or browser APIs |
| `scorify/audio-effects` | Post effects (soft saturation, tape delay, reverb); host-neutral DSP, also in `audio-dsp`  |
| `scorify/audio-guide`   | Practice sounds: a guide voice for a sung line, a kick-and-clap metronome; also in `audio` |
| `scorify/audio`         | Browser player plus performance/DSP exports                                               |
| `scorify/audio-worklet` | Processor registration entry; use with `audioWorklet.addModule()`                         |
| `scorify/pitch-detect`  | YIN pitch detection and a streaming tracker; no dependencies, no browser APIs             |
| `scorify/pitch-worklet` | Pitch-detector processor registration entry; loads only `pitch-detect`                    |
| `scorify/tuner`         | Tuning targets from a fretted instrument, and live microphone pitch input (browser)        |

Local distribution imports use `./dist/<entry>.mjs`. Native ESM uses relative chunks with no external runtime dependencies. After publication, pinned UNPKG URLs can serve the same graph. Keep **all** distribution files together; the audio entry resolves its worklet relative to `import.meta.url` unless you supply `workletUrl`. Bundlers that relocate modules should copy the emitted worklet and its dependencies to a public directory and pass their URL explicitly. Worklet fetching requires HTTPS or localhost, correct JavaScript MIME types, and the host's CORS/CSP permissions. Self-hosting the complete `dist/` directory is the tested setup. Live UNPKG delivery and every site's CSP have not been tested.

```js
const player = await createAudioPlayer(context, {
  workletUrl: new URL("/vendor/scorify/audio-worklet.mjs", location.href),
  destination: context.destination, // or your own AudioNode
});
```

There is no fallback to main-thread ScriptProcessor audio. Unsupported AudioWorklet environments fail explicitly. Node can import all entries safely; only calling `createAudioPlayer` needs browser globals. `audio-dsp` and `performance` are host-neutral. The worklet and arrangement-worker entries are marked as side effects for bundlers.

## Timing and constraints

`createPerformance(result, instrument, options)` returns `{status:'success', performance}` or `{status:'invalid-input'|'unplayable', diagnostics}`. It requires fretted annotations and independently validates them first. An unconstrained score must receive a fretted arrangement before this compiler can assign physical strings. The DSP also accepts explicitly constructed `SynthesisInput` without a score; that low-level path checks audio validity, not human fingering.

Onsets and releases are converted from rational quarters by integrating the score's tempo map. `leadInSeconds` defaults to 0.06. Performed attacks receive a strum offset and bounded humanization. **Every sounding duration is preserved in seconds**: its release receives the same offset as its attack. Ties remain one excitation with all source IDs. Playback retains the score’s notated end and trailing rests even when a gate releases its last sound earlier. Onset locks disable timing variation and reject a conflicting strum offset. A centered strum sounds its first strings before the notated onset, so the lead-in must cover them (otherwise `invalid-input`). Pitch is derived from the score's concert A and sounding MIDI pitch, and each event's `frequency` is exactly that; humanized string drift is a separate `detuneCents` per event, always within one cent (see below). Strings are never reordered by pitch.

`validatePerformance(plan)` independently reconstructs state at every actual attack/release boundary, replaying the selected finger contacts, held-barre footprints, same-string occupancy, reach, free-finger travel, setup time, voices, polyphony and attack density. It checks note identity, pitch, drift bounds, timing, contact and seed provenance. Strums separately check physical sweep order and crossed strings. A silent intermediate string requires the profile's explicit `allowMutedStrum` capability; crossing an unrequested held string is rejected. The crossing check conservatively includes the declared jitter uncertainty. It does not model an extra percussion sound for every silently avoided/muted string.

By default `timingPolicy:'constrain'` tries timing-jitter scales `1, 1/2, 1/4, 1/8, 1/16, 0` and returns the first valid plan. Reduced timing appears in diagnostics and `humanization.timingScale`. Velocity/timbre variation stays at the requested strength. `timingPolicy:'strict'` tests the requested timings once. Neither policy scales the chosen strum spread, shortens notes, moves fingers to new assignments, omits notes, or relaxes player limits. A failure says the **selected** fingering/timings failed; it is not proof that no alternative exists. To change durations, make an explicit gate edit in arrangement before compiling again.

`timeLimits: false` plays a fingering that was searched and validated at another tempo, as a playback speed. Creation and `validatePerformance` then lift only the player's time-based limits (string attacks per second, shift speed, finger speed and finger setup time); strings, frets, fingers, span, reach, barres, notes at once, voices, same-string occupancy, strum order and crossed strings, pitch, provenance and every sounding duration are still checked. The plan records `timeLimits: "lifted"` and a diagnostic; its `profile` keeps the player's real limits, and a plan without the record is validated with them. Use it only when the time limits were checked at the arrangement's own tempo.

The `constraints` marker is descriptive, not a certificate: validate externally received/edited plans again. `createAudioPlayer.play` always does so. Low-level `renderPerformance` and `PluckedStringSynth` intentionally accept raw audio inputs and do not replay musical mechanics.

## Strums and patterns

```js
import { expandStrumPattern } from "./dist/performance.mjs";
import { q } from "./dist/index.mjs";

const strokes = expandStrumPattern(
  {
    id: "down-up",
    length: q(4),
    strokes: [
      { offset: q(0), direction: "down", spreadSeconds: 0.045 },
      { offset: q(2), direction: "up", spreadSeconds: 0.025, velocity: 0.75 },
    ],
  },
  4,
); // Exact quarter offsets for four repetitions.
// createPerformance(result, instrument, { strokes, seed: 'take-42' });
```

Every stroke time must refer to an actual score attack; pattern expansion does not invent repeated notes. Supply separate score events for repeated chords, with explicit release gaps where needed. Explicit strokes without a global `strum` setting leave other attacks as individual plucks. `strum:false` is also compatible with explicitly listed strokes.

Down follows configured physical string order; up reverses it. `spreadSeconds` (0–1) is the first-to-last sweep duration. Without it, the sweep follows the local tempo: across all strings it takes a twentieth of a quarter note, between 12 and 60 ms (50 ms at 60 BPM, 25 ms at 120, 17 ms at 180), an up-stroke a fifth less, and a stroke over fewer strings proportionally less (`strumSweepSeconds`). `anchor` (0–1, default 0.5) is the fraction of the sweep's time that falls on the notated onset: at 0.5 the first strings sound before the beat, the middle on it and the last after it, as a strumming hand passes the beat; 0 starts the sweep on the beat. `curve` (0.2–5, default 1) shapes offsets by physical index distance. A `stringIds` mask selects strings from the attacked group; other score attacks remain separate plucks, **not omissions**. Stroke `velocity` multiplies note velocity (default 1 down, 0.85 up: up-strokes are lighter); `taper` (0–0.9, default 0.4 down, 0.3 up) is how much velocity the sweep loses from its first to its last string at full dynamics (below); `muted:true` uses rapid string damping. A one-string stroke has zero spread. Two alternating full-duration strokes may conflict if the second reaches a still-held string early; add deliberate gaps or use a different fingering.

## Seeded humanization

```js
const humanize = {
  amount: 0.6, // 0–1, default 0.5
  timingMs: 8, // Common shift per onset/stroke, maximum 50
  stringTimingMs: 2, // Smaller independent shifts, maximum 20
  velocity: 0.08, // Relative amplitude variation
  brightness: 0.06, // Absolute normalized brightness variation
  pluckPosition: 0.02,
  decay: 0.05, // Relative nominal decay variation
  dynamics: 1, // 0–1, depth of the played dynamics below
  driftCents: 0.5, // 0–0.99, bound of the slow per-string pitch drift
};
```

Humanization is played dynamics first and noise second. At depth `amount × dynamics`:

- **Bar accents.** `metricWeight` rates each onset: 1 on the downbeat, 0.6 on the middle of an even bar of four or more beats, 0.3 on other beats, −0.3 halfway between beats (a third of a compound beat), −0.6 elsewhere. A first bar shorter than the next is a pickup. Velocity changes by up to 15% of that weight.
- **Roles.** The melody is played 15% harder, the bass (thumb) 8%, an inner picked harmony note 6% softer.
- **Strums.** The first string struck is the hardest; velocity falls by up to `taper` across the sweep. A melody note in the strum is the dominant one and keeps its accent.
- **Touch.** A harder pluck is louder (velocity scales the excitation) and brighter: brightness rises with 0.8 × the velocity above the stroke's nominal velocity.
- **Drift.** Each string's tuning drifts slowly over the performance (two incommensurate cycles of 23 and 7.3 seconds, seeded per string), within ±`amount × driftCents` cents, never a full cent. Validation rejects a drift beyond that bound; the DSP rejects one of a cent or more.

Random streams derive from the seed, stable event/stroke ID and variation channel. They do not consume one global RNG in event-list order. Offsets are absolute relative to the tempo map, so random timing does not accumulate drift. String jitter is additionally capped at 20% of the smallest nominal inter-string gap. A stroke gets a common velocity component plus a smaller per-string component. Tone values are clamped to legal ranges.

`humanize:0` removes timing, dynamics, touch, timbre and drift variation (a strum keeps its sweep and anchor). It **still uses a fresh deterministic excitation for each distinct event ID**, avoiding identical repeated noise bursts. Same input/seed reproduces PCM on a tested runtime; bit-exact reproducibility across different JavaScript engines is not promised. Different event IDs or seeds intentionally change the excitation. Randomness is musical variation, not cryptography or a calibrated model of human performance. For a new take on every playback, pass a new seed each time; the docs playground does, for every play and every pass of a loop. The dynamics and drift constants are editable defaults, not measurements of players.

## Tone and synthesis

Tone precedence is preset → global `tone` → `stringTone[stringId]` → `noteTone[soundingEventId]`, followed by stroke controls/humanization. Use the first event ID of a tied group. Preset inference uses string count (>4 guitar, otherwise ukulele); specify `preset` explicitly for other instruments. Presets are returned as fresh editable objects. At the DSP stage each event already has its resolved tone: changing the render preset changes body modes/mix, not those compiled event values. Recompile the performance to apply different preset tone defaults.

| Tone field      | Bounds / meaning                                                |
| --------------- | --------------------------------------------------------------- |
| `velocity`      | 0–1, excitation amplitude (linear)                              |
| `brightness`    | 0–1, excitation and loop damping                                |
| `pluckPosition` | 0.02–0.98, comb-shaped excitation position                      |
| `decaySeconds`  | 0.02–30, nominal loop-loss time; damping can shorten actual T60 |
| `muted`         | Fast dead-pluck damping; not a calibrated palm-mute model       |

Each physical string owns a persistent circular delay line with FIR damping and a first-order allpass fractional delay. The coefficient compensates the damping filter's phase **at the fundamental**, avoiding integer-delay tuning error. A new pluck adds a fresh, band-shaped noise burst to the ringing state; it does not zero the string. Repeated/retuned notes keep residual energy; instantaneous retuning is an approximation, not a slide model. Releases damp the existing voice, with a short audible tail rather than an abrupt rectangle gate.

Parallel body resonators, a DC blocker, physical-string stereo pan, output gain, optional saturation and a final sample clamp complete the chain. This implementation uses a waveguide, rather than assuming sawtooth-plus-saturation alone provides an acoustic plucked-string sound. Preset body modes are manually chosen and are not measured impulse responses. String coupling, tension nonlinearity, pick/fingernail contact mechanics, advanced techniques and detailed acoustic radiation remain future work.

`SynthOptions` include `preset`, `gain` (default 0.65), `stereoWidth` (0.35), `saturation` (0), `releaseSeconds` (0.025), `bodyMix`, and `maxEvents` (10000). Default body mix comes from the supplied/input preset. Rendered stats include frames, excitations, pre-limiter peak and clipped sample count; inspect them when designing louder presets. The tested normal fixtures do not clip. An internal junction guard bounds extreme string energy.

Supported sample rates are integer 8000–192000 Hz and excitation frequencies 20 Hz through sampleRate/5. These DSP bounds are narrower than the score model's full MIDI range. A single string cannot hold independent overlapping events. Onsets/releases round to sample frames; a hold must occupy at least one sample. Output is stereo Float32; WAV export is PCM16. `renderPerformance` defaults to 48 kHz, 0.35 seconds tail and a 300-second total render budget. Long renders allocate the entire output; stream with `PluckedStringSynth.process(left,right,offset,count)` in blocks, or perform exports in a Worker. `maxSeconds` is an explicit caller-controlled budget, not a streaming implementation.

## Post effects

`scorify/audio-effects` (also exported from `audio-dsp` and `audio`) adds three effects after the strings, in this order:

- **Soft saturation**: `tanh(2.5·x)/2.5` with first-order antiderivative antialiasing. Quiet notes pass at unity gain; a full-scale peak comes out at about 0.4.
- **Tape delay**: an echo every `delaySeconds` (default 0.45 s; `delayForTempo(quarterBpm)` gives a dotted eighth, at most 1.5 s), feedback 0.38 through a 2.8 kHz lowpass, a 160 Hz highpass and a soft clip, returned at 0.42, with a 0.55 Hz, ±1.5 ms wobble (the two sides in quadrature). A change of echo time glides over about 50 ms.
- **Reverb**: Freeverb's eight lowpass-feedback combs and four allpasses per side (Jezar's public-domain tunings, scaled to the sample rate, the right side spread by 23 samples), a 12 ms pre-delay, comb feedback 0.88, damping 0.25, returned at 0.4: roughly −11 dB under a dry guitar render, about two seconds long.

Each effect is switched by a boolean in `EffectSettings`; switching ramps over 20 ms, and a delay or reverb that is switched off lets its tail ring out, then idles. `EffectChain` processes stereo Float32 blocks in place, sample by sample with its own deterministic state, so any block size gives the same samples. `applyEffects(rendered, settings)` returns a new render with the tail appended (`effectsTailSeconds`: 2.5 s of reverb, eight echoes of delay) and returns the input itself when every effect is off. `renderPerformance(input, { effects })` renders the strings and runs the chain over them, tail included.

The player takes `play(plan, { effects })` and `player.setEffects(settings)`; each playback starts a fresh chain, so its samples equal `renderPerformance` with the same effects (tested bit for bit over odd quantum sizes). `createEffectsNode(context, { workletUrl, effects, destination })` runs the same chain in its own AudioWorklet processor (`scorify-effects-v1`, registered by `audio-worklet.mjs`) on whatever is connected to `node`, on an AudioContext or an OfflineAudioContext; `set(settings)` switches effects live. The processor keeps running without input, so tails ring out. These are musical effects with fixed parameters, not measured rooms or tape machines; their cost was not benchmarked on low-end devices.

## Practice sounds

`scorify/audio-guide` (also exported from `audio`) renders two sounds to play along with, offline and host-neutral like the strings. A performance plan does not include them, and they never touch its validation or the fingering.

- **Guide voice.** `renderGuideVoice(notes, span)` sings a line of `{ onsetSeconds, endSeconds, frequency, velocity? }` notes (overlaps allowed): a fundamental with overtones at 0.32, 0.14 and 0.06, a sin² attack of 40 ms and a 90 ms linear release, a ±16-cent, 5.2 Hz vibrato that sets in after 0.25 s over 0.3 s, then a two-pole lowpass at 1.8 kHz (Q 0.6) so it does not bite: the fourth overtone of an A5 comes out more than 9 dB softer than unfiltered, the fundamental within 1.4 dB. Level 0.07 per note: a sustained note's RMS stays under four times that of one plucked string. It is a guide tone, not a singer: no words, vowels or breath.
- **Metronome.** `renderClicks(clicks, span)` plays `{ atSeconds, kind: "kick" | "clap", accent? }`, after defuss-shadcn's envelope compressor demo: a sine kick sweeping exponentially from 120 to 45 Hz in 0.15 s and decaying to −60 dB in 0.4 s; a clap of seeded white noise through a 1.8 kHz bandpass in three 12 ms bursts 11 ms apart and a 0.18 s tail. Each click runs through a feed-forward compressor (−24 dB threshold, 4:1, 6 dB soft knee, 5 ms attack, 150 ms release, 6 dB makeup); accented clicks are at 0.16, the others at 0.7 of that. `clickPattern(numerator, denominator)` gives a bar's clicks: a kick on the first beat (accented); with an even number of pulses a kick on every other pulse and claps between (4/4: kick, clap, kick, clap), otherwise claps after the first (3/4: kick, clap, clap); 6/8, 9/8 and 12/8 click on their dotted pulses. `countIn(numerator, denominator, beatSeconds, endSeconds)` gives one bar of clicks ending at a time.

A span (`startSeconds`, `durationSeconds`, `sampleRate`, `gain`) renders any part of the timeline. Each click is a pure function of the time since it started (its noise is seeded by that time), so a span of clicks equals the same span of a longer render sample for sample; the voice's oscillators are pure functions of time too, and its filter settles within 20 ms of a span's start (tested to within 1e-4). Invalid notes, clicks, meters or spans throw `RangeError`.

## Playback lifecycle

`createAudioPlayer` loads one processor module per AudioContext/URL pair. `play(plan, options)` snapshots and validates its input, cancels the previous request, resumes the caller's context, asks the processor to prepare input, then sends an absolute start deadline. Defaults are a 50 ms scheduling lead and 350 ms output tail. A missed explicit `when` deadline fails; it is never silently shifted. The promise resolves with a handle after the processor acknowledges the start. Events then run against sample frames, not `setTimeout`.

`handle.finished` reports completion. `handle.stop()` affects only that current handle; `player.stop()` cancels pending preparation and fades active output over 10 ms. Superseded `play` promises reject with `AbortError`; stale responses are ignored. `dispose()` disconnects and closes the player's port, but leaves the user's AudioContext open. Context closure and processor failures settle outstanding requests. A fatal processor failure rejects later play calls immediately; create a new player to recover. Cleanup is idempotent. The engine accepts actual render block sizes instead of assuming every callback is 128 frames.

Preparation allocates and generates excitation buffers outside the sample loop, but runs on the audio rendering thread inside the processor. Very large loads can still cause underruns: use modest plans and benchmark target devices. Seamless live editing, streaming note ingestion, seek/pause, tempo changes mid-playback and crossfaded loop playback are not supplied in v0.2; recompute and replay a new plan.

## Pitch detection and tuning

```js
import { createPitchInput, tuningTargets, nearestTarget } from "scorify/tuner";
import { classicalGuitar } from "scorify";

const targets = tuningTargets(classicalGuitar()); // E2 A2 D3 G3 B3 E4, physical order, capo applied
const context = new AudioContext();
button.onclick = async () => {               // the browser asks for the microphone from a user gesture
  await context.resume();
  const input = await createPitchInput(context, {
    minFrequency: 55, maxFrequency: 500,       // the instrument's range: cheaper and fewer octave errors
    onPitch: ({ frequency }) => {
      if (!frequency) return;                  // silence or no clear pitch
      const { target, cents, inTune } = nearestTarget(frequency, targets);
      console.log(target.pitch, cents.toFixed(1), inTune);
    },
  });
  // later: input.stop() releases the microphone; input.configure({...}) changes the range while listening
};
```

`detectPitch(samples, sampleRate, options)` implements YIN (de Cheveigné and Kawahara, 2002): the difference function over a fixed integration window, its cumulative mean normalized form, the first dip under an absolute threshold (default 0.15) followed to its local minimum, else the deepest dip if it is below twice the threshold, and parabolic interpolation of the period. It removes the DC offset, gates silence below an RMS of 0.003, and returns `{frequency, clarity, rms}` or `null`. A window must hold two periods of `minFrequency` (`minimumWindow`); the default range is 40–1500 Hz, wide enough for an 8-string guitar's F#1 tuned a quarter-tone flat. Detection is monophonic: play one string at a time.

`createPitchTracker({sampleRate, ...})` runs it on a stream: a sliding window (default `minimumWindow`), one detection per hop (default a thirtieth of a second, at most the window), readings under `minClarity` (0.8) reported without a frequency, and the median of the last `smoothing` (5) readings of the same note, restarted by silence or a jump of more than a semitone. Every buffer is allocated once. Readings carry the input frame and time at the end of their window, so they are identical for any block size.

`scorify/pitch-worklet` registers `scorify-pitch-detector-v1`. It mixes its input to mono, runs the tracker on the audio thread and posts `{type: "pitch", ...reading, contextTime}` per hop; `configure`, `reset` and `stop` messages change it. It outputs silence and imports only `pitch-detect`. `createPitchInput(context, options)` loads that module once per context and URL (or `workletUrl`), validates the options before asking for the microphone, opens it with echo cancellation, noise suppression and automatic gain control off (or uses a given `stream` or `source` node), and keeps the processor rendered through a muted path to the destination. `stop()` is idempotent, ends the processor and stops only tracks it opened; a failure while wiring releases the microphone. It needs a secure context (HTTPS or localhost).

`tuningTargets(instrument, {concertAHz})` lists the open strings as they should sound, with any capo; `nearestTarget(frequency, targets, {toleranceCents})` returns the closest one in cents and whether it is within the tolerance (default 5); `chromaticNote` names the nearest equal-tempered note. Measured accuracy and cost are in [VALIDATION.md](VALIDATION.md). Detection has not been measured with recorded instruments, room noise or real microphones; tune by ear when they disagree.

## Reproducible examples and validation

`bun run examples:audio` generates four short original WAV studies: straight/humanized ukulele and guitar. Their source is `examples/audio/studies.mjs`. Straight examples retain the intended strum spread; they disable expressive variation. These WAVs are illustrative synthetic renders, not a listening-study result.

`bun run check`, `bun run check:browser` and `bun run benchmark:audio` cover musical timing, seed stability, malformed plans, pitch estimation, sustained string state, block invariance, WAV structure, cancellation, real AudioContext playback and real OfflineAudioContext/worklet parity. Measured results and remaining device/listening work are in [VALIDATION.md](VALIDATION.md).
