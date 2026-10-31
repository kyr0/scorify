# Scorify implementation specification

Version: implemented v0.4.0 contract, 2026-10-31. Owner/project: `kyr0/scorify`.

The first-release software layers are implemented. This document retains the broader design and records the concrete v0.1 and v0.2 decisions below. The original research-stage specification is preserved as [DESIGN_V0.md](DESIGN_V0.md). [README.md](../README.md) and generated TypeScript declarations describe the usable API; [VALIDATION.md](VALIDATION.md) records measured evidence. Human calibration and additional browser-engine review have not been completed.

### Concrete v0.2 decisions

The complete optional performance and synthesis contract is in [AUDIO.md](AUDIO.md). The score/adapter architecture is preserved, with fretted audio first and future instrument renderers kept separate from music theory and arrangement.

- Compile fretted annotations to explicit performed onsets/releases, physical-order strums and seeded variations. Preserve pitch, concert tuning, source identities, ties and sounding durations. Each event's frequency is the written pitch exactly; humanized string drift is a separate per-event detune bounded below one cent (an audible-tuning nuance, not a pitch change). Strums are centered on their beat by default (`anchor` 0.5) with a tempo-scaled sweep, because a strumming hand passes the beat mid-sweep; the lead-in must cover the early strings. Played dynamics (bar accents, melody and bass accents, a strum's taper, brighter harder plucks) are structured, then lightly randomized; they are editable defaults, not calibrated player models.
- Revalidate actual times with the fretted mechanics. Reduce only jitter in explicit steps, with diagnostics; never silently change strum width, gates, finger assignments, notes or hard limits. Failure is local to the selected fingering, not global infeasibility.
- Detect live pitch with YIN, not FFT peak picking or plain autocorrelation: its cumulative mean normalized difference and absolute threshold resist the octave errors plucked strings with strong second harmonics cause, and its cost is bounded by the instrument's range (window and lag both follow `minFrequency`). The detector is a host-neutral, dependency-free module shared by the AudioWorklet, workers and tests, so offline and worklet readings are identical; the browser input, the instrument's tuning targets and the UI stay outside the worklet graph. Monophonic only; accuracy is measured on synthetic and synthesized signals, not recorded instruments.
- Synthesize persistent strings using fresh noise excitation, loop damping, phase-compensated fractional delays, editable body modes and stereo rendering. Timbres are uncalibrated synthetic presets, not measured instruments.
- Schedule prepared jobs in a dedicated AudioWorklet by sample frames. Support cancellation, replacement, deterministic offline rendering and WAV export. No main-thread audio callback, external sample dependency, framework or network service is required.
- Keep audio out of the core graph and the score/solver out of the DSP/worklet graph. Add optional `performance`, `audio-dsp`, `audio`, and `audio-worklet` entries.
- Ship source, built modules, tests, browser controls and original straight/humanized WAV studies. Streaming updates, seek/pause, physical string coupling, advanced technique synthesis and musician/listening validation remain later work.

### Concrete v0.1 decisions

- `Score` uses the specified sounding-pitch object and rational quarter time. `Part.voices` declares valid voice IDs. Optional written-to-sounding metadata is retained. Helpers construct, validate, normalize, transpose and retime scores.
- `arrange` is the synchronous fretted facade. `arrangeSteps` is the generic generator; `arrangeWithAdapter` supplies custom instrument mechanics. The actual adapter contract also includes `initialState`, `stateKey` and `ergonomicCost`. State keys are sufficient-state contracts, not just pitch-set hashes.
- Exact search performs dynamic programming over finite candidates; the exhaustive reference omits dominance merging. Beam search limits the frontier and total enumerated realizations per parent/frame across all permitted edits. Expansion budget counts branch/enumeration operations, not only accepted states. Discard counts record observed pruning, not the unknown size of unexplored subtrees. Beam pruning is path-dependent: the cheapest partial fingerings can all dead-end at a later chord change while a costlier one gets through. Measured on the docs playground's House of the Rising Sun (semi-pro version, low-G ukulele): beams of 32 and 128 exhaust, a beam of 2,048 with 16,384 candidates per frame succeeds after about 470,000 expansions, and the exhaustive reference ran out of a 4 GB heap. Callers that need a result should escalate beam width on `search-exhausted` rather than switch to exhaustive search; a widened beam that discards nothing reports `infeasible`, which is a proof within the model.
- Ranking is lexicographic: minimize musical loss first, then the summed cost. Thus a playable faithful maestro rendition is not replaced by an omission merely because a long sustain adds ergonomic cost. Cost components and the scoring-hook ID are returned.
- Tied fragments merge for search and remain separate in output. They may be omitted or octave-shifted as a group when permitted; rhythmic and gate edits currently apply only to untied notes.
- Ordinary fingers are 1–4, open/capo notes use 0. A finger may cover multiple strings at one fret. While any assigned note continues, the finger keeps its fret; at that fret its contact may widen to more strings (a barre laid flat around a held note, at a small cost per string), never move to another fret (decision 2026-10-31: a guitar arpeggio of an F barre picks the bass first, and the barre must form around it; the solver had reported such arpeggios infeasible above amateur). Higher-fret contacts may occur above a barre; lower/open notes and conflicting capos may not. Free-finger memories retain the last contact and release time. Movements consume only actual available release time. Pre-positioning is implicit in this reachability bound; arbitrary idle-hand preparation poses are not separately enumerated.
- Static distance uses ideal 12-TET fret coordinates and constant configured string spacing. Movement uses fret displacement and a documented string-distance surrogate, plus optional millimetre speed. Per-pair reach caps are supported. No anatomical playability guarantee is made.
- Picking permits the listed attacks; strumming checks the physical interval between attacked strings. Unintended intermediate strings require explicit `allowMutedStrum`; reattacking a held source note is rejected. Muting is a declared right-hand capability, not a detailed simulation of palm/contact mechanics.
- Complexity counts explicitly marked ornament sounding events. Unknown roles remain protected from heuristic omission. Explicit `allowMelodyOmission` plus `preserveMelody: false` permits a skeleton while retaining locks/protected IDs.
- Rhythmic simplification supplies finite delayed-onset and lengthened-note candidates on a requested grid. It does not move onsets earlier or redesign arbitrary tuplets. Hold shortening separately inserts explicit gates. Notated rhythmic capability checks do not mistake a short articulation gate for a short note value.
- `autoTempo: true` optionally applies the level's suggested ceiling to the highest tempo segment and scales all segments together. It is incompatible with explicit tempo options.
- Harmony analysis uses meter-sized or caller-sized windows, supplied-span boundaries, bass-aware pitch-set candidates, and small attack/context ranking terms. It is not key-estimation or a learned harmonic parser. Supplied intent and realized evidence remain separate.
- Quantization accepts known tempo/meter, quarter subdivisions and tolerance. It jointly picks on/off pairs subject to exact simultaneity and per-voice ordering/overlap. Returned local alternatives need not be jointly compatible. Unknown tempo, rubato, swing and inferred voices remain outside this release.
- Every built-in successful path is independently replayed with `validateFrettedArrangement`, deriving active events from the output. With strictly ordered frames it sweeps active notes and the one-second attack window forward instead of filtering every note at every frame; it falls back to that filter (and reports the order) otherwise. Source edits are charged once and retain IDs/provenance.
- Async calls support cooperative checkpoints. The dedicated worker protocol adds progress, cancellation and stale-result rejection. The worker endpoint yields to its event loop per ~12 ms time slice (posting one progress message per slice), not per fixed step count: browsers clamp nested `setTimeout(0)` to at least 4 ms, which made the docs playground's long searches 5–10× slower than a direct `arrange()`. Sessions preserve the original and cache whole results. The fretted adapter caches pitch positions; phrase-local recomputation and reusable cross-request structural caches remain future performance extensions.
- The ZIP is a complete local package, including generated output and a runnable example. Publication is a separate owner action; the owner published `scorify@0.3.0` on npm on 2026-10-30.
- The docs' optional local practice library lives outside `docs/` in ignored `work/private-scores/`. The loopback server exposes only listed score JSON files and injects its reference at request time; static builds contain no private scores. Imported vocals retain their own source pitches, onsets, durations, rests and lyrics while accompaniment is arranged separately. An entry may name a chord chart (`scorify-chart-1`) written for the score's bars: the page then plays the chart's per-difficulty strummed versions in exact mode under the vocal and never arranges the score's other parts. A chart's `vocalTranspose` is an explicit, reported editorial correction for a passage the edition notated in another key than its accompaniment; the imported file stays unchanged. A chart's `sungLine` names, per span of bars, the one sung part that carries the tune (a choir passes it between parts), reported with every arrangement; without it every sung part is shown. `lyricLanguages` labels the verses when the score does not. A timed pitch lane includes octaves, independent of the words. For adaptive accompaniment over 300 notes, the UI first tries an 8-state/128-candidate beam under a 10-million expansion cap, then the existing wider tiers on exhaustion; successes remain approximate, with omissions and octave shifts reported.
- `scorify/songs` is the arrangement layer above `arrange`: chord-chart songs with one hand-written version per difficulty (patterns, alternating bass, fills, releases, held bars), a chord finder that proposes chord-book shapes on contiguous strings and lets `arrange` judge each, chord charts for imported scores with a sung part, imported scores and score sets with an estimated difficulty, and the request flow (the version written for the difficulty in exact mode, then easier versions, then the easiest one adaptive), with each attempt's reason logged. Pre-search limits (`limitsExceeded`) and `countStrokes` (strokes, not strings, against the attack rate, as an explicit reported override) are part of it. `LEVEL_TEMPO` (maestro 1.2×) and the chord-shape ranking are editable policies, not calibrated claims.
- Tempo is playback only (decision 2026-10-30, at the owner's request). Every attempt is searched and validated at the piece's own tempo; a request's tempo, maestro's 20% included, scales the result's tempo map (`retime`) without a search or a second validation, and the result says from which tempo (`retimed`). Cache keys therefore omit the tempo. The time-based limits (attacks per second, shift speed) are judged at the piece's tempo only; at a faster playback tempo they are not re-checked, which the About text states. This replaces the earlier rule that kept a fingering at another tempo only when the validator accepted it there.
- The key selector moves a piece by −6 to +5 semitones (`transpose` on the request, part of the cache key; custom settings' own transposition wins). A chord song's symbols and sung pitches move and its voicings are found again; an imported score moves by the interval and then by whole octaves into the instrument's range. Every key is precomputed for every instrument and difficulty.
- Imported scores have strummed chords (`ScorePiece.chords`): a plain major or minor triad per beat inferred from the hardest version's played notes (the triad covering most sounding time, the lowest note counted twice, a previous chord kept when it scores nearly as well), merged into halves or bars where beats agree, and a simpler chart with one chord per half bar (4/4) or bar. Baby and beginner strum the simpler chart first (down strums on the strong beats; on every beat), amateur and above strum the full chart only after every version and the simplification failed. This is a heuristic reading of the notes, reported as one, not a harmonic analysis. It depends on the core only (no audio) and is a subpath, not part of the root graph. The docs playground supplies only its song content and Fretboard rendering.
- Post effects (`scorify/audio-effects`: soft saturation with antiderivative antialiasing, a tape delay, a Freeverb-style reverb) are host-neutral DSP after the strings. One sample-by-sample chain with deterministic state serves `renderPerformance(…, { effects })`, `applyEffects`, the player worklet (a fresh chain per playback, so worklet and offline samples are identical) and a separate effects processor for any Web Audio input (`createEffectsNode`). Effects never touch the performance plan, its validation or the fingering. Their parameters are fixed musical choices, not measured rooms or tape machines.
- Practice sounds (`scorify/audio-guide`: a lowpassed guide voice for a sung line, a compressed kick-and-clap metronome with a meter's click pattern and a count-in) are host-neutral DSP beside the strings, rendered offline per span. A click is a pure function of the time since it started and the voice's oscillators of the time, so a host can render a long piece in segments, loop passes included, and switch either sound by a gain without rendering again. They are not part of a performance plan and never affect validation or fingering.
- `createPerformance(…, { timeLimits: false })` (decision 2026-10-30) separates a fingering from its playback speed: a fingering searched and validated with the player's time-based limits at one tempo plays at any other, without checking attacks per second, shift and finger speed or finger setup time again. Every other mechanical and provenance check stays; the plan records `timeLimits: "lifted"`, keeps the real profile, and says so in its diagnostics. The docs playground performs every take this way, since its tempo is playback only.
- Arrangement runs are cached whole, not search state. A run is the log of its attempts (version, simplification, status, result); each attempt carries a fingerprint of its prepared source, its options and the cache version (`src/VERSION`). Decision 2026-10-30: a version set by hand, not a hash of the built library, so a library change that does not change arrangements (audio, the page) keeps the cache; changing VERSION searches every configuration again. A change to the search or the fingering model that leaves VERSION alone keeps replaying the earlier results, each validated against the current rules first, so a replay may be less good than a new search but never violates a limit. Logs are precomputed for the usual configurations (`scripts/precompute-docs.mjs`), kept per browser in IndexedDB, and replayed only for equal fingerprints and after independent validation of the replayed fingering; a mismatch or failed validation searches again. Fingerprints are cache keys, not integrity protection. Exported arrangements (`scorify-arrangement-1`) carry the request, custom settings, the piece and the log, and are revalidated when opened.
- A capo changes which strings ring open and therefore the shapes, voicings and assignments; toggling one requests another arrangement rather than renumbering frets. `suggestCapo` (scorify/songs) is a chord-shape heuristic (open, other, barre); the playground offers it as an opt-in toggle whose other side is precomputed or searched in the background. With a capo, chord names show the fingered shapes while sounding pitch and spelling stay unchanged; the instrument keeps absolute and capo-relative frets. Custom mode exposes the player overrides, adaptation permissions, search settings, transposition (chord symbols and sung pitches; voicings are found again), capo and tuning as explicit hard constraints; nothing is relaxed to make a song play.
- The docs page runs from one content-addressed build directory (`docs/assets/v/<hash>/`, decision 2026-10-31): its own modules and the library, so every relative import, the worker and the worklets come from one build. GitHub Pages serves each file for ten minutes under a stable URL and ignores query strings, so unversioned modules mixed two deploys in browsers right after a deploy. The last three builds stay for pages cached before a deploy. `docs/assets/scorify/` remains the stable library path for Node tools.

## 1. Product contract and boundaries

Scorify transforms symbolic music into a rendition suited to an instrument and a musician. It combines spelled pitch transposition, tempo changes, permitted musical adaptation, and fingering search. It returns machine-readable scores and annotations, independent of display/playback frameworks.

The first release supports single-player ukulele and guitar, including configurable string tunings and instrument presets. Preserve the architecture for keyboard, bowed, wind, and ensemble adapters; do not force their mechanics into a fretted-string abstraction.

### First-release scope

- 12-TET sounding pitches, with spelling retained; initial MIDI-range pitch validation (0–127).
- Rational symbolic time, multiple voices, tempo/meter/key maps, explicit rests and ties.
- Unconstrained pitch/tempo transformation and constrained exact/adaptive modes.
- Concert ukulele high G and low G; classical guitar; arbitrary fretted tuning/configuration.
- Ordinary fretted/open notes; explicit muting and a specified barre model.
- Configurable complexity/flexibility controls backed by detailed capability limits.
- Levels `baby`, `beginner`, `amateur`, `semi-pro`, `pro`, `expert`, `maestro`.
- Candidate chord labels and basic contextual harmony spans; supplied harmony remains authoritative unless edits permit changing it.
- Optional bounded quantization with supplied meter/tempo and allowed subdivisions.
- Source-to-output edit report, constraints report, search statistics, deterministic results.
- Browser ESM, Node ESM, declarations; no rendering, audio engine, network dependency, or framework in the core.

### Later capabilities with reserved extension points

Full MusicXML/MIDI/Guitar Pro import/export; audio transcription; unknown-meter/tempo inference; rubato/swing inference; advanced string techniques; keyboard/pedal mechanics; learned costs; style-specific generated ornaments; ensemble orchestration; microtonal/fretless models.

Unsupported techniques must produce diagnostics. They cannot disappear silently during an alleged exact or maestro conversion. File import adapters must report information they cannot preserve.

## 2. Independent configuration axes

1. **Instrument:** what pitches/actions the instrument can produce and its geometry.
2. **Player:** reach, dexterity, rhythm/voice capacity, familiar techniques and shapes.
3. **Adaptation policy:** which source changes are permitted and how they are valued.
4. **Transformation:** intended pitch interval and tempo map operation.
5. **Search policy:** resource budgets, deterministic tie-breaking, exact vs approximate search.

Explicit player overrides take precedence over a level preset. Explicit adaptation prohibitions take precedence over any level. An expert with limited reach is a valid profile. A high level never overrides an instrument's physical limitations.

## 3. Canonical score model

Use versioned, JSON-serializable ordinary data. The canonical shape is (additional concrete helper types are in `src/model.ts`):

```ts
type Q = readonly [numerator: number, denominator: number];
type Pitch = {
  step: "C" | "D" | "E" | "F" | "G" | "A" | "B";
  alter: number;
  octave: number;
};

interface NoteEvent {
  id: string;
  onset: Q;
  duration: Q;
  pitch: Pitch; // sounding spelled pitch
  partId: string;
  voiceId: string;
  role?: "melody" | "bass" | "harmony" | "ornament" | "unknown";
  importance?: number; // optional caller-supplied weight
  locked?: {
    pitch?: boolean;
    onset?: boolean;
    duration?: boolean;
    keep?: boolean;
  };
  tieGroupId?: string;
  gateDuration?: Q; // explicit articulated hold, if known
  techniques?: Technique[];
  sourceIds?: string[];
}

interface Score {
  schemaVersion: 1;
  temperament: "12-TET";
  concertAHz: number;
  notes: NoteEvent[];
  rests: RestEvent[];
  parts: Part[]; // includes written-to-sounding pitch relation
  tempoMap: { at: Q; quarterBpm: number }[];
  meterMap: {
    at: Q;
    numerator: number;
    denominator: number;
    grouping?: number[];
  }[];
  keyMap: { at: Q; tonic: string; mode: string }[];
  harmony: HarmonySpan[];
  notation?: NotationMetadata;
}
```

All times are quarter-note units, not milliseconds and not meter-dependent "beats". Normalize fractions, require safe integer components and a positive denominator, and check arithmetic overflow (internal BigInt is acceptable). Note durations are positive; grace notes need explicit future semantics, not zero-duration ordinary notes. Origin is zero; pickup information belongs in notation metadata. Stable IDs are unique and preserved through edits.

Validate map ordering, duplicate map positions, positive finite tempos, valid referenced voices/parts, and pitch/spelling consistency. Key may be absent/unknown; never infer C major as fact. Empty harmony is valid. Store concert pitch separately from tuning/key.

Tie fragments can be merged to a sounding event for search, while preserving notated fragments for export. Unisons in different voices retain separate identities. Merging them onto one physical note requires a specific permitted edit and an auditable source mapping. Evidence (2026-10-30): imported guitar solos write a note shared by two voices of one staff (a bass note that starts an arpeggio) as two same-pitch notes; exact mode cannot place both, so such scores need adaptive mode, which may drop or shift notes. That edit, merging same-onset unisons of one part with both identities kept as `sourceIds`, is the planned remedy; it is not implemented.

**Notation, hold, and performance:** notated duration, intended sounding duration, and required finger contact are not always identical. Strict sustain follows the specified hold. An articulated gate or permitted release gap may free a finger earlier, but must be explicit in input/policy and reported. Do not assume a full inter-onset interval is available to every finger. Do not silently shorten a held note to make a transition succeed.

Search times include the union of starts, releases, tempo changes relevant to movement, and any candidate edit endpoints. Derived slices have active notes and attacks/releases. They are not the storage format.

## 4. Instrument adapters and presets

```ts
interface InstrumentAdapter<State, Realization, Annotation> {
  kind: string;
  version: string;
  initialState(): State;
  enumerate(
    frame: AdapterFrame,
    previous: Realization | undefined,
    context: MechanicsContext,
  ): Iterable<Realization>;
  validateState(
    realization: Realization,
    frame: AdapterFrame,
    context: MechanicsContext,
  ): readonly string[];
  transition(
    state: State,
    from: Realization | undefined,
    to: Realization,
    frame: AdapterFrame,
    context: MechanicsContext,
  ): TransitionEvaluation<State>;
  describe(
    realization: Realization,
    frame: AdapterFrame,
    context: MechanicsContext,
  ): Annotation;
  stateKey(state: State, realization: Realization): string;
  ergonomicCost(realization: Realization, context: MechanicsContext): number;
}
```

The adapter owns mechanics; the shared engine owns timing, edits, candidate search, scoring, provenance, and results. Adapter identity/version is part of every reproducibility/cache key.

Fretted configuration includes stable string IDs and conventional tab numbers, physical order, original open sounding pitch, per-string final fret and capo fret, scale length, optional explicit fret coordinates/string geometry, handedness, and allowed techniques. Courses/doubled strings are a later explicit capability, not automatically independent strings.

Canonical fret numbers are absolute from the original nut. Capo-relative tab fret = absolute fret minus that string's capo fret. The sounding pitch remains original open pitch plus absolute fret. A note at the capo is effectively open. Never add the capo twice.

Preset tunings in physical bass-edge to treble-edge order:

| Preset                  | Sounding tuning   | Tab numbers in that order |
| ----------------------- | ----------------- | ------------------------- |
| Concert ukulele, high G | G4 C4 E4 A4       | 4 3 2 1                   |
| Concert ukulele, low G  | G3 C4 E4 A4       | 4 3 2 1                   |
| Classical guitar        | E2 A2 D3 G3 B3 E4 | 6 5 4 3 2 1               |

The foundation uses 19 as an editable nominal fret count (18 for the concert ukulele preset, decision 2026-10-31). Actual range/geometry must be configured for the instrument. Missing geometry cannot establish a millimetre-based reach guarantee: reject a requested hard geometric limit or use an explicitly selected nominal model and mark that assumption.

Ordinary 12-TET geometry uses `x(f) = L(1 - 2^(-f/12))`. Reach can also depend on string separation, finger pair, and wrist position. This is a configurable approximation, not a physiological proof.

## 5. Player profiles and levels

The public `complexity` value is a normalized allowed ornament-retention budget. It does not authorize inventing ornaments. A separate option will govern additions in a later release. A zero budget does not erase essential melody merely because it is non-chordal.

The public `flexibility` value compiles to instrument-aware reach and transition preferences. Detailed overrides remain available: finger-pair spans, hand shift speed, reposition setup time, barre policy, maximum independent voices, simultaneous notes, attacks per second, picked notes per bar, rhythmic vocabulary, familiar shapes, and picking/strumming technique.

Picked notes per bar (`maxPickedPerBar`, decision 2026-10-30): when the right hand picks, a bar may start at most 2 (baby), 3 (beginner), 4 (amateur), 6 (semi-pro) or 8 (pro) notes unless each sounds alone; expert and maestro have no such limit. One note at a time is always allowed, so the limit thins notes picked together, never the tune's moments; strummed chords do not count. The search, the validator and the pre-search check (`limitsExceeded`) apply the same rule. A simplification keeps the song's identity: leaving a moment of the source without any of its non-ornament notes costs 24 in musical loss (more than leaving out two salient notes), notes picked together that would leave the bar's later moments too few picks are thinned first when one of them may be left out, and the beam ranks paths with the loss the bar must still incur. In a chord of the melody voice only the top note is the melody (the notes under it count as harmony and may be thinned). Evidence: on standard guitar Canon in D's simplified ensemble kept 3 of 4 moments in bars 9–24 and 1–2 of 6–8 in bars 25–40 at amateur before this rule and keeps every moment after it.

High on the neck (`highFretCosts`, decision 2026-10-31): each level has soft costs for the highest fretted note of a moment, counted from the capo as the tab reads it (a capo is a movable nut), per fret above a threshold and per quarter note held. Baby to semi-pro pay 1 per fret above 8 and another 4 per fret above 10; pro and expert pay 4 per fret above 10; maestro pays nothing. The cost is ergonomic, so it ranks after musical loss: it chooses positions and never decides which notes are kept, and a note that lies only above fret 10 is still played there. It is a preference, not a limit: the hard limits are the instrument's highest fret (`fretCount`) and the player's `maxFret` (36 by default). The songs layer gives each catalog instrument its usual highest fret (concert and baritone ukulele 18, guitars 19, mandolin 20; `highestFret`), and a request's `frets` sets another one (`customInstrumentId(base, { frets })`, `~frets12`); a request with the usual highest fret has the same cache key as one without. A beam ranked by the preference can prune the only way through a passage high on the neck, so an attempt whose search runs out of budget with it is searched once more without it (`withoutPositionCost`; the log entry is marked `anyPosition` and the arrangement notes say so): a preference never costs a playable note. Evidence: Greensleeves with all four voices on drop-D guitar at expert in two keys ran out of budget with the preference and fell back to its strummed chords (210 and 230 notes instead of 235); without it, as before, it plays as written. Evidence: on guitar the run E5 D5 C5 B4 A4 G4 E5 G5 (E5 and G5 lie only at fret 12 and above) takes B4 and A4 at frets 7 and 5 at semi-pro, at most 10 at pro and 12 and 10 at maestro; adaptive mode with octave shifts allowed keeps every note at its pitch at every level.

Level policies are versioned and uncalibrated until reviewed by musicians:

| Level    | Intended policy                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| baby     | Slow melody skeleton; simplest pulse; easy single notes, dyads or triads when helpful; minimum movement and ornament retention |
| beginner | Essential melody; simple rhythm; limited accompaniment; easy open shapes; conservative changes                                 |
| amateur  | More original rhythm and harmony; modest ornaments and shifts; configurable limited barres                                     |
| semi-pro | Broader voicings and independence; more source detail; less conservative movement                                              |
| pro      | High detail and technique allowance within the supported model                                                                 |
| expert   | Near-source rhythm/voices/ornaments where feasible; demanding transitions allowed by the profile                               |
| maestro  | Highest fidelity objective within explicit instrument and player constraints; no automatic embellishment beyond source         |

These names are policies, not educational certifications. Do not assign scientifically precise human capability thresholds without evidence. Raising a level expands allowed capabilities; it does not require a mechanically harder fingering. A simpler fingering for the same music remains desirable.

Melody detection from arbitrary polyphony is uncertain. V0.1 prioritizes caller-supplied roles and protected note IDs. The engine may propose roles, but must not treat them as ground truth. Characteristic rhythm and non-chord tones may be essential to recognizability.

### Practice pieces (decision 2026-10-31)

Scales are spelled, not computed from pitch classes: each scale is a list of intervals above the tonic (`scorify/theory`, `SCALES`), so every degree keeps its letter, and a scale whose descent differs says so (the classical melodic minor falls as the natural minor; the chromatic scale rises in sharps and falls in flats). Tonics are offered as usually written per quality (`TONICS`: D♭ major, C♯ minor; F♯ for the tritone).

A scale exercise is made for one instrument: over whole octaves, up and down, up, down from the top, or down and back up, from the lowest tonic whose notes all lie between the lowest open string (capo counted) and the highest fret. Nothing is moved by octaves or left out to make it fit; when no octave holds it, `scaleOnNeck` returns null and `scaleScore` throws. A scale piece is marked `exercise`: it is fingered in exact mode at `SCALE_BPM` (60 counted beats a minute; another tempo is playback only, as for songs), and when the difficulty cannot play it, the attempt is reported and never simplified (custom adaptive mode stays available). Notes per beat are even subdivisions of the counted beat: 1–4 in simple meters, 1, 3 or 6 in compound ones, whose beat is a dotted quarter. The last note sounds at least a beat and to the next bar line.

Chord progressions (decision 2026-10-31, replacing the thirteen most common ones of the corpus) are twenty-five chosen for recognizability, harmonic variety and practice value, in that order: the fundamental and pop loops (I–V–vi–IV with its minor-centred rotation i–♭VI–♭III–♭VII, linked as related), rock and minor progressions, Dorian vamps, a borrowed iv, secondary dominants (V/vi, V⁷/ii), jazz ii–V–I in major and minor, longer sequences (circle of fifths, Pachelbel-style) and the 12-bar blues. Numerals are relative to the tonic, with accidentals measured against the parallel major (♭III is C in A minor); sevenths, half-diminished (ø7) and diminished (°) chords and secondary dominants are spelled by `chordOfNumeral`. One bar per entry is a practice arrangement, not part of the harmony: durations are explicit where they differ (the blues 4–2–2–1–1–1–1 bars, three-chord progressions 1–1–2), and so is an ending other than the tonic (IV–V–iii–vi resolves to vi; the jazz progressions end on Imaj⁷, the blues on I⁷). Counts stay source-specific. `songs` comes from the McGill Billboard corpus (J. A. Burgoyne, J. Wild and I. Fujinaga, "An Expert Ground Truth Set for Audio Chord Recognition and Music Analysis", ISMIR 2011; annotations under CC0, chord annotations of 890 Billboard Hot 100 slots, 739 distinct songs, 1958–1991). It is counted by `scripts/billboard-progressions.py`:
  - chords are read relative to the annotated tonic, and repeated chords are merged;
  - for each progression, the songs with a phrase (an annotation line) that starts with its chords count, sevenths as triads;
  - for the 12-bar blues, the songs with twelve bars on I I I I IV IV I I V (IV or V) I (I or V) count.

The counts rank this corpus and are not a census of later charts. It ends before I–V–vi–IV (7 songs) and many minor pop loops (0–2) became common. Hooktheory and Hutchinson's *Music Theory for the 21st-Century Classroom* are linked as sources, and their popularity is not mixed into the counts. A progression is a chord song in C major or A minor: each chord its bars, a loop shorter than eight bars twice, then its ending held. It is played in a style. Strum (`PROGRESSION_VERSIONS`, seven versions per meter: 4/4, 3/4, 6/8, 12/8) strums every hit at every difficulty, from a down strum a bar to syncopated sixteenths; until 2026-10-31 its harder versions picked arpeggios over an alternating bass, which a player who chose strumming did not ask for, and then briefly filled every sixteenth. No strum version or pattern strikes more than three quarters of the places on its grid (eighths, or the sixteenths or triplet eighths it uses; rounded up): a harder strum rests, pushes and syncopates instead of filling the bar, as players' hands keep moving but miss the strings.

Strumming patterns (`STRUM_PATTERNS`, decision 2026-10-31) are a catalog of common one-bar patterns, each written as players write it, a slot per eighth or sixteenth (`D · D U · U D U`, B for a picked bass note), checked by a test against its hits. A pattern is played as the one version of a strummed progression, at its own tempo. Its difficulty is measured, not assigned: the easiest level that plays it as written over I–IV–V–I on the instruments it is typical for; easier levels play it simplified, reported as any song's easiest version. Patterns with a picked bass (boom-chick, boom-chicka, boom-chick-chick) need six strings: on four-string instruments the strum strikes the bass string while the bass still rings, and no level below maestro plays them. A short strum (a reggae skank, a bluegrass chop) is a hit with a `length`. Chucks and other muted, percussive strokes have no pitch and are not written; patterns that depend on them are left out rather than written without them. The arpeggio styles (up, down, up and down; `arpeggioVersions`) pick single tones walking the strings of each chord's voicing in physical string order, bass edge first, starting again at every chord; the notes a bar follow each level's picked-notes limit (2, 3, 4, 6, 8, then triplets or sixteenths; `ARPEGGIO_TIMES`), tones ring until struck again, and easier levels let go earlier before a chord change. Versions fall back like any song's. Triplets are exact: a chord song's times lie on a 24th-of-a-quarter grid when they are thirds, else on 32nds as before.

A seven-note scale can be played as its chords (`scaleChordsSong`): the triad on every degree from its own scale (the melodic minor rising), spelled plainly (B♭, Edim), up to the octave and back, then the tonic held, in the progression styles. Pentatonic, blues and chromatic scales have no chord on every degree and offer none.

Inversions (decision 2026-10-31) are asked per chord segment, keyed by bar, place in the bar and symbol as played (after transposition: `"2.1:F"`), as the chord tone to put lowest. The chord is voiced again among shapes whose lowest sounding pitch is that tone; an alternating bass takes that tone as its root. The inversion is a request, not a preference: when the difficulty cannot voice it, the attempt reports the missing voicing and the playground offers to undo it; a key that names no chord of the version is reported in the notes. Inversion names come from the lowest sounding pitch, so re-entrant tunings show their usual shapes truthfully (the high-G ukulele's open F, 2010, is in second inversion). Inversions are part of the cache key only when there are any.

Arpeggio versions start their beam search at width 512 with 8,192 candidates a frame (`ARPEGGIO_SEARCH`; songs keep 32/512) and retry only wider. An arpeggio adds one picked note a frame, so a narrow beam keeps what is cheap for the first notes of a chord (open strings) and is left with stretches it would not choose for the whole chord: at 32, root-position F on the ukulele at maestro (voiced 2553) became 0-1-9-5, an eight-fret span that maestro's limit of nine allows; at 512 it is played in fifth position at lower cost. The result is still a best-found beam result, not a proven optimum. Progressions and scale exercises are searched in the browser and not precomputed.

## 6. Transposition and tempo semantics

`transposeScore(score, { interval })` applies a spelled interval to sounding notes, key-map tonics, and harmonic roots/basses while preserving durations and IDs. It also updates or invalidates dependent annotations explicitly. Transposing C major to D major preserves relative modulations; it does not force every section into D major. A future target-key convenience must specify a source key anchor, direction, and octave policy.

`retimeScore(score, { scale })` multiplies quarter-note BPM at every tempo segment by a positive factor. `0.75` means slower, while musical time stays identical. An absolute-tempo override is a separate operation. No audio time stretching is involved.

For movement timing, integrate seconds across the tempo map: constant-segment seconds = quarter-note distance × 60 / quarterBpm. Do not use a single global BPM when the score contains tempo changes. Meter affects accent/grouping interpretation, not the duration unit.

## 7. Arrangement modes and hard constraints

- **Unconstrained:** pitch and tempo transformations without instrument search; still validate music data.
- **Exact:** preserve requested transformed notes, timing, multiplicity, and supported technique semantics; assign an allowed physical realization.
- **Adaptive:** choose only explicitly permitted edits. Options include removing marked ornaments, removing lower-priority accompaniment, allowed octave displacement, revoicing accompaniment, rhythm simplification, and declared hold changes.

Default hard locks: retained required melody notes, requested key/tempo unless auto-selection is enabled, range/fret limits, no conflicting ordinary pitches on one string, valid finger assignment, supported sustained-note contact, and user capability caps. Open strings do not consume fretting fingers. A barre can cover multiple strings but must obey its contact geometry and interactions with higher fretted notes. At most four ordinary fretting fingers does not mean at most four sounding guitar notes.

For each proposed realization compute all sounding strings, including unintended open/intermediate strings under a strum. A pitch-set match alone does not establish a playable chord. V0.1's right-hand model covers stated picking/strumming assumptions and attack density; advanced picking mechanics remain an explicit limitation.

Pitch changes by per-note octave displacement affect contour/register and must carry a fidelity cost and report entry. A bass inversion change is musically meaningful. Never independently wrap every unplayable pitch into range without evaluating the passage.

## 8. Search and cost model

1. Validate/normalize the immutable source and compile the requested policy.
2. Apply intended global pitch and tempo transformations.
3. Produce analysis annotations and finite candidate musical edits.
4. Enumerate realizations and prune hard physical/player violations.
5. Search across sufficient states; track ongoing notes and future-relevant commitments.
6. Validate the complete selected path independently and construct result/provenance.

State must include active source/output notes and remaining holds; string/fret and finger/barre assignments; free-finger/hand preparation state as represented by the model; last release times; candidate-edit commitments; and remaining global budgets. Two states with the same pitches are not necessarily equivalent. Dominance pruning is safe only when every future-relevant component agrees.

Use an exhaustive oracle on tiny passages and layered DP for bounded finite graphs. Default larger runs may use beam search with per-frame candidate and total expansion budgets. Persist original ordering and use deterministic tie-breakers (cost, edit count, stable IDs). Timing-based cancellation may truncate at different points; distinguish deterministic fixed-budget mode from wall-clock mode.

Paths share their past (decision 2026-10-30): a path keeps its chosen variants, frames and annotations as persistent lists shared with its parent, plus the chosen notes that have not ended (bounded by polyphony), instead of copying everything chosen so far. Memory per path no longer grows with the length of the piece, and the sounding notes are no longer filtered from the whole path at every candidate. Results are identical: of the 5,502 public precomputed configurations, searched before and after, 5,404 give the same notes and fingerings, and the other 98 are exactly those that play an imported score's amateur chord version, whose release changed at the same time. Evidence: Wicked Game (1,997 notes, drop-D guitar, semi-pro two semitones up) took 50 s for the first tier and 202 s for the second, and a 128-wide retry exhausted a worker's 4 GB heap during precomputation; after the change the tiers take 6 s and 23 s. The picked-notes counters enter the dominance key only when a picking limit applies.

Feasibility is filtered before soft optimization. Ranking first minimizes musical loss, then the summed remaining costs. The reported total is:

`cost = musicalLoss + ergonomicCost + transitionCost + styleCost`

Report these components individually. Normalize units: do not add raw millimetres to unscaled semitone counts. Charge an edit once, not once for every slice during its sustain. Include source salience, melody contour, timing, harmony, voice retention and phrase continuity where defined. Do not let soft weight adjustments bypass hard limits.

The first implementation need not learn costs. Expose a versioned pure scoring hook for future learned/personalized weights. Hooks cannot override validity checks and their identity must participate in cache reproducibility.

`maestro` requests greater fidelity; it does not make the search exhaustive. "Optimal" means proven within a stated finite model/candidate set. Heuristic ranking quality and actual human comfort require separate evaluation.

## 9. Quantization and harmony contracts

`quantizePerformance` is a separate optional stage accepting performed timings, a known tempo/meter map, allowed subdivisions, tolerance, and voice hints. Return selected rational times, alternatives/uncertainty, and edit provenance. Coordinate note onsets/offsets and repeated notes, avoid zero/negative durations, and preserve intentional voice overlap. Keep the original performance timings. Known swing should remain a playback/notation relation; do not silently flatten it.

`analyzeHarmony` emits spans with onset/end, candidate symbols, selected symbol if supported, evidence note IDs, provenance (`provided` or `inferred`), and scoring-method/version. Use the actual sounding bass. Infer harmonic windows rather than labeling every note attack independently. Unsupported/insufficient evidence can return unknown. Expose source intent and realized harmony as separate layers for renderers.

Complexity reduction must not depend solely on chord membership. A suspension, passing tone, or chromatic melody note can be essential. Supplied roles/locks take precedence over heuristic classification.

## 10. API and result contract

Implemented public usage:

```js
const result = arrange(source, {
  instrument: concertUkulele({ tuning: "lowG" }),
  transform: { interval: "2M", tempoScale: 0.75 },
  mode: "adaptive",
  player: { level: "beginner", overrides: { allowBarre: false } },
  adaptation: {
    preserveMelody: true,
    allowOctaveShift: true,
    allowAccompanimentOmission: true,
    allowAddedOrnaments: false,
  },
  search: {
    strategy: "beam",
    maxCandidatesPerFrame: 128,
    maxExpandedStates: 100000,
  },
});
```

Numbers above illustrate budgets; they are not benchmarked defaults. Separate `arrangeAsync`/worker support should handle cancellation and progress for interactive clients without importing browser globals into the core. Synchronous `arrange` has explicit finite work bounds.

Result discriminants:

| Status             | Meaning                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `success`          | A complete arrangement passed the model's validity check; includes whether search was exhaustive or truncated |
| `infeasible`       | Exhaustive search proved no solution within the explicitly stated model/candidate policy                      |
| `search-exhausted` | No complete valid result found within approximate/pruned/budgeted search; infeasibility is not proven         |
| `unsupported`      | Input requires an unimplemented technique/semantic capability                                                 |
| `invalid-input`    | Schema or semantic validation failed                                                                          |
| `cancelled`        | Requested cancellation; any partial/best candidate is clearly separated from a completed result               |

Success includes output score, fingering/performance annotations, source and realized harmony, edit log, difficulty components, policy/model versions, applied assumptions, and search stats. Report `optimality: proven-in-model | best-found`, expansion counts and discarded candidates. A partial prefix never masquerades as a complete arrangement.

Each edit records source IDs, output IDs, old/new values, reason, and the policy permission that allowed it. Preserve original source data. Recompute every requested level from that source, never from the preceding simplification.

## 11. Dynamic recomputation and module boundaries

Long-term cache architecture: cache parsing/normalization, structural analysis, and pitch-position candidates separately. V0.1 implements source preservation, whole-result caching and per-adapter pitch-position caching. Invalidate by source revision, transposition, tuning/capo/geometry, player/policy version, and analysis options. Tempo changes invalidate transition timing and difficulty even if pitch candidates are reusable.

Phrase-local search must account for entry/exit states and notes crossing the boundary. Commit results using request IDs so a stale worker result cannot replace a newer level. Whole-piece refinement remains available; do not promise constant-time updates for arbitrary polyphony.

Public modules: root facade, `model`, `theory`, `fretted`, `presets`, `arrange`, `analysis`, `quantize`, and optional adapters. Additional `profiles`, `transforms`, `fingering`, `validate`, and worker entries are documented in the README. Keep rendering and large file parsers out of the default import. Do not distribute an empty API with methods that only throw "not implemented".

## 12. Packaging and release

- Bun lockfile and pinned build/test dependencies; TypeScript source; Node-executed pkgroll and tests.
- ESM `.mjs` and `.d.mts`; explicit `exports` with `types` first and browser-resolvable default/import entries.
- Selected Tonal modules bundled as build dependencies, with generated third-party notices.
- Browser target explicitly set to ES2022, not inherited from the developer's Node version.
- No Node-only runtime imports/globals, unresolved bare imports, CDN transformation, or mandatory import map.
- Relative code-split chunks are allowed and must be included in the npm tarball.
- Measure gzip transfer for each entry point's transitive graph; no unmeasured "tiny" claims.
- Host-neutral worker-ready data; no DOM in the engine.
- Version-pinned URL shape after npm publication: `https://unpkg.com/scorify@VERSION/dist/index.mjs`.
- Build, declaration check, semantic tests, package graph scan, static-server browser import, and tarball inspection before publishing.

The owner published `scorify@0.3.0` (2026-10-30) and `scorify@0.4.0` (2026-10-31) on npm. Pushing to GitHub does not publish a release; publishing stays the owner's action. CJS can be added if a real consumer requires it.

## 13. Implementation sequence and acceptance gates

| Milestone               | Deliverable                                                            | Exit gate                                                                          |
| ----------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| M0 research foundation  | Evidence, this spec, source primitives, pkgroll/browser proof          | E1/E2 validated; limits explicitly documented                                      |
| M1 canonical model      | Exact time, validation, events/maps, transforms, provenance            | Round-trip/inverse/tempo-map and sustain fixtures pass                             |
| M2 exact fretted solver | Positions, fingers/barres, held-note state, DP oracle and beam         | Zero known physical violations; exact tiny-case agreement; honest failure statuses |
| M3 adaptive policies    | Required melody locks, constrained edit candidates, all level profiles | Edits permitted/auditable; no source mutation; musician-reviewed fixture set       |
| M4 analysis and timing  | Harmony spans and known-map quantization                               | Ambiguity, arpeggios, tuplets, overlap and tempo-change tests                      |
| M5 v0.1 release         | Combined API, worker path, docs, benchmark and browser matrix          | Packed-package tests, public API review, licensing, repeatable build               |

M1–M5 software deliverables now have implementations and automated checks. The musician-reviewed fixture/calibration gate and cross-browser matrix remain incomplete external evaluation, not asserted by the unit tests. See VALIDATION.md for the exact completed checks.

## 14. Adversarial acceptance fixtures

High-G string 4 above strings 3/2; same pitch on multiple strings; unavailable bass on high-G uke; six simultaneous guitar notes with open strings/barre; notes individually reachable but jointly impossible; a held note blocking the next attack; a rest permitting a shift; tempo changes inside a transition; same fret span at different fretboard positions; per-string capo; written-vs-sounding guitar octave; alternate tuning; same pitch in overlapping voices; ambiguous C6/Am7-class harmony; arpeggiated harmony; protected chromatic melody; triplets across bar boundaries; repeated notes with quantization collisions; cancellation/search budget exhaustion; unsupported bends/harmonics; and no solution even at maestro.

Numeric difficulty thresholds, runtime targets, and musical quality are provisional until measured. Preserve that uncertainty in both documentation and returned metadata.
