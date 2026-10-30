# Scorify research baseline

Research date: 2026-10-28. Target repository: `kyr0/scorify`.

This document distinguishes published evidence, implementation decisions, hypotheses, and experiments. It accompanies the [implementation specification](IMPLEMENTATION_SPEC.md). The baseline informed the v0.1 implementation. The current tree now includes the arranger; see VALIDATION.md for measured outcomes and remaining external evaluation.

## Findings that determine the architecture

### 1. Arrangement and fingering should be searched together

Hori, Kameoka, and Sagayama (2013) formulate guitar arrangement and fingering as decoding over hand forms; they describe beginner-oriented parameter settings [S1]. This is direct precedent for Scorify's central idea. Radisavljevic and Driessen (2004) use a path formulation and learn costs from example tablatures, emphasizing the difficulty of choosing weights by hand [S2].

**Decision:** generate permitted musical alternatives and physical realizations in one bounded search. Do not irrevocably simplify the score first and hope that a fingering exists afterward. Preserve an exact, exhaustive small-case solver as an oracle; production search may prune.

**Limit:** these papers do not validate our seven level names, all ukulele geometries, or a general claim of human playability. Their methods guide a new implementation; their code and datasets are not incorporated.

### 2. Difficulty is multidimensional and player-specific

Vélez Vásquez et al. (ISMIR 2023) developed a teacher-informed rhythm-guitar rubric. Its criteria include chord familiarity, positioning, fingering demands, repetition, right-hand complexity, progression speed, and beat difficulty [S3]. Its evaluation covers a limited rhythm-guitar corpus; it is not a universal ergonomic standard.

**Decision:** retain the requested `complexity` and `flexibility` controls, but compile them to an explicit player profile. Complexity is an ornament budget; polyphony and rhythmic demands remain separate. Flexibility expands to static reach, movement speed, finger substitution, and technique allowances. Expose these components in diagnostics.

**Hypothesis requiring musician evaluation:** reductions that preserve melody anchors, characteristic rhythm, and harmonic function are more recognizable than reductions based only on note counts. Never equate an inferred non-chord tone with a disposable ornament.

### 3. Notes need lifetimes, voices, and exact musical time

MusicXML represents musical durations using divisions and represents tuplets explicitly [S4, S5]. Its duration model also distinguishes performance timing from notation [S6]. These are useful interoperability constraints, not a requirement to use MusicXML internally.

**Decision:** JSON-serializable rational quarter-note time; separate tempo, meter, and key maps; individual onset and duration per event; voice and source identity. Derive search boundaries from both starts and ends. Treat events as half-open intervals so releases happen before new attacks at the same time.

The optimizer must retain occupied strings, held fingers/barres, and intended durations in its state. A note does not stop occupying a string just because its onset is in the preceding frame. Open strings can ring while the fretting hand moves, but cannot simultaneously produce another independently sustained pitch on that same string.

### 4. Quantization and simplification are different operations

Nakamura et al. study rhythm transcription from performed timings, including separate onset and note-value estimation; their multiple-voice model addresses shortcomings of flattening polyphony into chord sequences [S7, S8].

**Decision:** exact symbolic scores bypass quantization. V0.1 accepts known meter and tempo for optional performed-event quantization, with bounded straight/tuplet candidates and explicit ambiguity. Fully inferred meter, tempo, voice structure, rubato, and swing are later research. A requested easier rhythm is an arrangement edit, not a correction to the source.

**Important limit:** nearest-grid rounding is a useful baseline, not a sufficient definition of correct notation. It can destroy tuplets, create zero-length notes, or alter voice overlap.

### 5. Harmony is a time-aligned interpretation

Tonal's detector returns candidate names, with inversion interpretation affected by the first note; its examples include ambiguous chord names [S9]. Source inspection of `packages/chord-detect/index.ts` confirms pitch-class matching and first-note bass treatment. MusicXML stores harmony independently from notes [S10].

**Decision:** use Tonal for candidate generation. Sort actual simultaneous pitches by sounding height before calling its detector. For temporal analysis, build candidates over harmonic windows and score them using supplied harmony, bass, metric position, and context. An arpeggio can imply a chord without ever sounding the whole pitch set at once. Preserve candidate alternatives and label a score as a heuristic, not a calibrated probability.

Keep source harmony and realized harmony separate. A source Cmaj7 annotation can remain valid harmonic intent after a reduction removes the seventh, while the audible realization is a C triad. Renderers must be able to choose which annotation to show. A melody alone may leave harmony unresolved.

### 6. Physical order, register, and written pitch are independent

Kala documents reentrant standard ukulele tuning and its low-G alternative [S11]. MusicXML's tablature model carries string/fret and tuning data, with string numbering separate from staff-tuning line numbering [S12]. Its transposition element explicitly relates written pitch to sounding pitch [S13].

**Decision:** canonical pitches are sounding pitches. Preserve spelling and written-pitch metadata for export. Guitar's customary octave-transposing notation must not shift the internal fret calculation an octave. Store physical string order and stable string IDs; never sort a high-G ukulele's strings by pitch. Translate importer numbering conventions explicitly.

Concert size and low-G tuning are composable properties. Presets supply editable defaults, not a claim about every manufactured instrument. Store scale length and string geometry separately from tuning. Physical fret position in ideal 12-TET is `L * (1 - 2 ** (-f / 12))`; equal fret-number spans do not imply equal reaches.

### 7. Browser delivery requires testing the emitted module graph

Pkgroll derives entry points from package metadata, supports declarations and minification, and bundles imported packages in `devDependencies` while externalizing other dependency categories [S14]. Browser imports need URL-resolvable specifiers unless an import map supplies a mapping [S15]. UNPKG serves versioned package files and also documents a transforming browser-module service [S16, S17].

**Decision:** ESM-only first release with explicit root and subpath exports. Bundle the few Tonal modules used into the published output; allow relative shared chunks, but require no bare runtime imports, Node built-ins, import maps, or CDN transforms. Test a plain HTML module import from a static HTTP server. Publish every referenced chunk and license notice. Exact-version UNPKG URLs are the documented deployment form.

Do not mistake `sideEffects: false` for browser-side tree shaking. A direct browser import downloads and evaluates the reachable module graph. Separate subpaths are important for transfer size. A CDN URL is not live until the npm package/version has actually been published.

### 8. Existing kyr0 conventions

The live `kyr0/defuss` root and `packages/create` / `packages/dataview` manifests were inspected via the GitHub connector [S18–S20]. They use Bun, TypeScript, pkgroll, explicit exports, MIT licensing, and (for dataview) Vitest. Some existing packages emit CommonJS too.

**Decision:** follow Bun for package management and committed `bun.lock`; use Node to execute the build and tests. Prefer ESM-only for this browser-first package, with `.d.mts` declarations. The research fixture pins versions rather than leaving floating ranges. It is private/unpublished until the implementation and release gates are met. The GitHub repository name is independent of npm publication availability.

## Solver alternatives

| Approach                    | Strength                                                                | Limitation                                            | Decision                                             |
| --------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| Greedy easiest fingering    | Tiny, understandable                                                    | Can strand later notes or break held notes            | Baseline only                                        |
| Layered dynamic programming | Exact on a fully enumerated sufficient-state graph                      | Polyphonic finger assignments grow rapidly            | Oracle and small passages                            |
| Beam search                 | Bounded candidates; practical cancellation and progressive refinement   | Pruning can discard a solution or optimum             | Implemented default                                  |
| A\*                         | Can certify optimality with admissible bounds and exhaustive candidates | Lower bounds and state count need work                | Evaluate after baseline                              |
| Generic SAT/CP/ILP          | Expressive constraints                                                  | Extra browser weight and integration complexity       | Research comparator, no runtime dependency initially |
| Learned transition costs    | Can personalize ranking                                                 | Needs representative examples and held-out evaluation | Future plug-in over fixed validity rules             |
| Generative model            | Potentially richer musical adaptation                                   | Size, nondeterminism, validation, and intent control  | Optional future candidate provider                   |

These are engineering assessments, not measured comparisons. Search optimality is always relative to the represented techniques, candidate set, and cost model.

## Data and evaluation

GuitarSet 1.1.0 provides string-specific performance annotations, chords, beats, and known annotation errata [S21]. It is useful for evaluating string/pitch handling and performance timing. It is not a complete source of left-hand finger labels, a level calibration set, or ukulele ground truth. Keep any downloaded corpus outside the npm distribution and inspect its own license and corrections before redistribution; the code repository's license is not a substitute for the data record.

Begin with original synthetic fixtures committed to this repository. Add short musician-reviewed excerpts with documented redistribution rights. Evaluate separate dimensions:

- **Validity:** sounding pitch, no conflicting string occupancy, sustained-note consistency, finger/barre compatibility, geometry and tempo-dependent limits.
- **Preservation:** required melody events, pitch/register edits, onset/duration edits, voice retention, harmonic changes, and an explicit source-to-output map.
- **Difficulty:** maximum reach, transition features, attack density, polyphony, allowed techniques; also player ratings.
- **Search:** exhaustive agreement on tiny cases, determinism, cost and feasibility gaps versus greedy, state counts, truncation, cancellation.
- **Delivery:** compressed bytes of each entry point and transitive chunks, actual browser imports, packed-file contents, worker responsiveness.

Do not evaluate against one "correct" fingering exclusively. Multiple fingerings can be musically and physically valid. Do not calibrate and evaluate level weights on the same examples.

## Research experiments and release gates

| ID  | Experiment                                    | Acceptance evidence                                                                                  |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| E1  | Bundle selected Tonal modules with pkgroll    | No unresolved bare imports or Node globals; declarations and notices included; browser probe passes  |
| E2  | High-G, low-G, guitar, alternate tuning, capo | Enumerated locations reproduce sounding pitches; physical numbering remains unchanged                |
| E3  | Sustained-note counterexample to greedy       | Correct solver rejects a locally attractive path that requires an occupied string                    |
| E4  | Exhaustive vs DP vs beam                      | Exact agreement when pruning is disabled; honest search-exhausted result under budget limits         |
| E5  | Joint reduction and fingering                 | Preserved required melody; every edit recorded; no hard constraint relaxed silently                  |
| E6  | Time and geometry                             | Equivalent musical timing under tempo changes; geometry-aware spans; held-finger release times used  |
| E7  | Harmonic ambiguity and arpeggios              | Multiple candidates retained; no forced chord on insufficient evidence                               |
| E8  | Quantization                                  | Tuplets/voice overlap preserved when permitted; uncertainty reported; exact symbolic input unchanged |
| E9  | Musician review                               | Recognizability and difficulty assessed separately for guitar and ukulele                            |

E1–E8 now have synthetic automated coverage; outcomes and limits are recorded in [VALIDATION.md](VALIDATION.md). E9 (musician review) remains outstanding. The synthetic fixtures are implementation evidence, not corpus-scale or human-validated musical-quality results.

## Open questions

1. What hard defaults, if any, should accompany each level before musician calibration? Prefer conservative editable presets, with a versioned policy identifier.
2. Which melody notes are indispensable? Initially accept source roles/importance and explicit locks; inferred roles remain advisory.
3. How should timbre, campanella ukulele voicing, and repeated motifs influence ranking? Add named style weights without changing validity.
4. How far can phrase-local recomputation preserve a globally good path? Cache analysis, but account for boundary state and held notes; offer whole-piece refinement.
5. How should note-value ambiguity be exposed without overwhelming a renderer? Candidate timing plus a selected interpretation and provenance is proposed.
6. Does bundling a pitch-only Tonal submodule materially outperform `@tonaljs/note` for this API? Measure before widening dependencies or replacing proven theory code.

## Sources

Each source below was consulted on 2026-10-28. Brief summaries above are separated from Scorify's proposed design. No paper is claimed to prove the complete design.

- **S1:** Hori, Kameoka, Sagayama (2013), _Input-Output HMM Applied to Automatic Arrangement for Guitars_. [Publisher abstract](https://www.jstage.jst.go.jp/article/ipsjjip/21/2/21_264/_article/-char/en), DOI 10.2197/ipsjjip.21.264. Abstract consulted; full algorithm replication is not claimed.
- **S2:** Radisavljevic, Driessen (2004), _Path Difference Learning for Guitar Fingering Problem_. [Author-hosted paper](https://www.mistic.ece.uvic.ca/publications/2004_icmc_pdl.pdf).
- **S3:** Vélez Vásquez et al. (2023), _Quantifying the Ease of Playing Song Chords on the Guitar_. [ISMIR paper](https://archives.ismir.net/ismir2023/paper/000086.pdf).
- **S4:** W3C MusicXML 4.0, [divisions](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/divisions/).
- **S5:** W3C MusicXML 4.0, [time-modification](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/time-modification/).
- **S6:** W3C MusicXML 4.0, [duration](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/duration/).
- **S7:** Nakamura, Yoshii, Sagayama (2016), _Rhythm Transcription of Polyphonic MIDI Performances Based on a Merged-Output HMM for Multiple Voices_. [Author-hosted paper](https://eita-nakamura.github.io/articles/Nakamura_etal_RhythmTranscriptionOfPolyphonicMIDIPerformances_SMC2016.pdf).
- **S8:** Nakamura et al. (2018), _Towards Complete Polyphonic Music Transcription: Integrating Multi-Pitch Detection and Rhythm Quantization_. [Author-hosted paper](https://eita-nakamura.github.io/articles/AudioAndMIDITranscription_ICASSP2018.pdf).
- **S9:** Tonal, [chord documentation](https://tonaljs.github.io/tonal/docs/groups/chords), [chord-detect package](https://www.npmjs.com/package/@tonaljs/chord-detect), and [detector source](https://github.com/tonaljs/tonal/blob/main/packages/chord-detect/index.ts).
- **S10:** W3C MusicXML 4.0, [harmony](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/harmony/).
- **S11:** Kala, [Ukulele Tuning, Decoded](https://kalabrand.com/blogs/home/ukulele-tuning-decoded).
- **S12:** W3C MusicXML 4.0, [Tablature tutorial](https://www.w3.org/2021/06/musicxml40/tutorial/tablature/).
- **S13:** W3C MusicXML 4.0, [transpose](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/).
- **S14:** pkgroll, [official README](https://github.com/privatenumber/pkgroll). Installed probe version: 2.29.0; current README may describe additional versions' behavior.
- **S15:** MDN, [JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules).
- **S16:** UNPKG, [official site](https://unpkg.com/).
- **S17:** UNPKG, [browser modules](https://unpkg.com/guides/browser-modules).
- **S18:** kyr0/defuss, [root manifest](https://github.com/kyr0/defuss/blob/main/package.json), inspected blob `74c595d0f0ecacba9b61fef274bbfff983f77da4`.
- **S19:** kyr0/defuss, [create manifest](https://github.com/kyr0/defuss/blob/main/packages/create/package.json), inspected blob `f3977e65d0f3bd32445b36179ab17cd1a56680ee`.
- **S20:** kyr0/defuss, [dataview manifest](https://github.com/kyr0/defuss/blob/main/packages/dataview/package.json).
- **S21:** GuitarSet [version 1.1.0 dataset record and errata](https://zenodo.org/records/3371780).

## v0.2 audio decisions and primary sources

Research follow-up: 2026-10-28. Implementation and limits: [AUDIO.md](AUDIO.md). This update preserves the original score/arrangement research above.

A saw oscillator plus saturation can supply an intentionally synthetic tone, but it does not by itself provide the decaying, frequency-dependent string behavior sought here. Scorify uses an externally excited persistent waveguide. [Julius O. Smith, Extended Karplus–Strong](https://www.dsprelated.com/freebooks/pasp/extended_karplus_strong_algorithm.html) and [Externally Excited String](https://www.dsprelated.com/freebooks/pasp/Externally_Excited_String.html) motivate a feedback-delay string with fresh excitation. Our implementation choices include one voice per physical string, excitation shaped by pluck position/brightness, and retention of residual energy across plucks; no acoustic-identity claim follows from that model.

[Smith, First-Order Allpass Interpolation](https://www.dsprelated.com/freebooks/pasp/First_Order_Allpass_Interpolation.html) describes the recursive interpolator and avoiding near-zero fractional delays. Scorify chooses a fractional delay between 0.5 and 1.5 samples and solves the loop phase at the requested fundamental, including the FIR damping phase. The analytical test is supplemented by pitch estimates from rendered PCM.

Body modes use constant-peak bandpass biquads from the [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/), a Working Group Note adapted from Robert Bristow-Johnson's formulae. Mode values are hand-chosen presets; they are not fitted instrument impulse responses.

The [Web Audio API 1.1 working draft](https://www.w3.org/TR/webaudio-1.1/#AudioWorkletProcessor) describes AudioWorklet processing and the rendering timeline. Scorify schedules by sample frames, accepts the actual output block size, and verifies behavior in Chromium. Its prepared-job protocol, generation cancellation and seeded humanization are project design decisions, not claims that the specification mandates these algorithms.

Humanization uses correlated per-stroke offsets plus smaller independent string offsets and tone variation. It has no cumulative timing drift and is validated after applying offsets. These distributions are editable heuristics. We have not fitted timing/velocity distributions to player recordings, conducted a controlled listening study, or validated realism across guitar/ukulele performers. Deterministic and mechanical tests establish implementation properties rather than musical realism.
