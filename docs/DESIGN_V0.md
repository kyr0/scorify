# Scorify implementation specification

Version: design draft 0.1, 2026-10-28. Owner/project: `kyr0/scorify`.

This is the intended first-release contract and long-term architecture. Unless explicitly marked as implemented in [VALIDATION.md](VALIDATION.md), APIs in this document are proposed. The [research baseline](RESEARCH.md) records evidence and unresolved questions.

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

Use versioned, JSON-serializable ordinary data. A future TypeScript shape is:

```ts
type Q = readonly [numerator: number, denominator: number];
type Pitch = { step: 'C'|'D'|'E'|'F'|'G'|'A'|'B'; alter: number; octave: number };

interface NoteEvent {
  id: string;
  onset: Q;
  duration: Q;
  pitch: Pitch;                    // sounding spelled pitch
  partId: string;
  voiceId: string;
  role?: 'melody'|'bass'|'harmony'|'ornament'|'unknown';
  importance?: number;             // optional caller-supplied weight
  locked?: { pitch?: boolean; onset?: boolean; duration?: boolean; keep?: boolean };
  tieGroupId?: string;
  gateDuration?: Q;                // explicit articulated hold, if known
  techniques?: Technique[];
  sourceIds?: string[];
}

interface Score {
  schemaVersion: 1;
  temperament: '12-TET';
  concertAHz: number;
  notes: NoteEvent[];
  rests: RestEvent[];
  parts: Part[];                   // includes written-to-sounding pitch relation
  tempoMap: { at: Q; quarterBpm: number }[];
  meterMap: { at: Q; numerator: number; denominator: number; grouping?: number[] }[];
  keyMap: { at: Q; tonic: string; mode: string }[];
  harmony: HarmonySpan[];
  notation?: NotationMetadata;
}
```

All times are quarter-note units, not milliseconds and not meter-dependent "beats". Normalize fractions, require safe integer components and a positive denominator, and check arithmetic overflow (internal BigInt is acceptable). Note durations are positive; grace notes need explicit future semantics, not zero-duration ordinary notes. Origin is zero; pickup information belongs in notation metadata. Stable IDs are unique and preserved through edits.

Validate map ordering, duplicate map positions, positive finite tempos, valid referenced voices/parts, and pitch/spelling consistency. Key may be absent/unknown; never infer C major as fact. Empty harmony is valid. Store concert pitch separately from tuning/key.

Tie fragments can be merged to a sounding event for search, while preserving notated fragments for export. Unisons in different voices retain separate identities. Merging them onto one physical note requires a specific permitted edit and an auditable source mapping.

**Notation, hold, and performance:** notated duration, intended sounding duration, and required finger contact are not always identical. Strict sustain follows the specified hold. An articulated gate or permitted release gap may free a finger earlier, but must be explicit in input/policy and reported. Do not assume a full inter-onset interval is available to every finger. Do not silently shorten a held note to make a transition succeed.

Search times include the union of starts, releases, tempo changes relevant to movement, and any candidate edit endpoints. Derived slices have active notes and attacks/releases. They are not the storage format.

## 4. Instrument adapters and presets

```ts
interface InstrumentAdapter<State, Realization> {
  kind: string;
  enumerate(frame: Frame, context: SearchContext): Iterable<Realization>;
  validateState(state: State, context: SearchContext): Violation[];
  transition(from: State, to: State, context: TransitionContext): TransitionEvaluation;
  describe(realization: Realization): PerformanceAnnotation;
}
```

The adapter owns mechanics; the shared engine owns timing, edits, candidate search, scoring, provenance, and results. Adapter identity/version is part of every reproducibility/cache key.

Fretted configuration includes stable string IDs and conventional tab numbers, physical order, original open sounding pitch, per-string final fret and capo fret, scale length, optional explicit fret coordinates/string geometry, handedness, and allowed techniques. Courses/doubled strings are a later explicit capability, not automatically independent strings.

Canonical fret numbers are absolute from the original nut. Capo-relative tab fret = absolute fret minus that string's capo fret. The sounding pitch remains original open pitch plus absolute fret. A note at the capo is effectively open. Never add the capo twice.

Preset tunings in physical bass-edge to treble-edge order:

| Preset | Sounding tuning | Tab numbers in that order |
|---|---|---|
| Concert ukulele, high G | G4 C4 E4 A4 | 4 3 2 1 |
| Concert ukulele, low G | G3 C4 E4 A4 | 4 3 2 1 |
| Classical guitar | E2 A2 D3 G3 B3 E4 | 6 5 4 3 2 1 |

The foundation uses 19 as an editable nominal fret count. Actual range/geometry must be configured for the instrument. Missing geometry cannot establish a millimetre-based reach guarantee: reject a requested hard geometric limit or use an explicitly selected nominal model and mark that assumption.

Ordinary 12-TET geometry uses `x(f) = L(1 - 2^(-f/12))`. Reach can also depend on string separation, finger pair, and wrist position. This is a configurable approximation, not a physiological proof.

## 5. Player profiles and levels

The public `complexity` value is a normalized allowed ornament-retention budget. It does not authorize inventing ornaments. A separate option will govern additions in a later release. A zero budget does not erase essential melody merely because it is non-chordal.

The public `flexibility` value compiles to instrument-aware reach and transition preferences. Detailed overrides remain available: finger-pair spans, hand shift speed, reposition setup time, barre policy, maximum independent voices, simultaneous notes, attacks per second, rhythmic vocabulary, familiar shapes, and picking/strumming technique.

Level policies are versioned and uncalibrated until reviewed by musicians:

| Level | Intended policy |
|---|---|
| baby | Slow melody skeleton; simplest pulse; easy single notes, dyads or triads when helpful; minimum movement and ornament retention |
| beginner | Essential melody; simple rhythm; limited accompaniment; easy open shapes; conservative changes |
| amateur | More original rhythm and harmony; modest ornaments and shifts; configurable limited barres |
| semi-pro | Broader voicings and independence; more source detail; less conservative movement |
| pro | High detail and technique allowance within the supported model |
| expert | Near-source rhythm/voices/ornaments where feasible; demanding transitions allowed by the profile |
| maestro | Highest fidelity objective within explicit instrument and player constraints; no automatic embellishment beyond source |

These names are policies, not educational certifications. Do not assign scientifically precise human capability thresholds without evidence. Raising a level expands allowed capabilities; it does not require a mechanically harder fingering. A simpler fingering for the same music remains desirable.

Melody detection from arbitrary polyphony is uncertain. V0.1 prioritizes caller-supplied roles and protected note IDs. The engine may propose roles, but must not treat them as ground truth. Characteristic rhythm and non-chord tones may be essential to recognizability.

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

Feasibility is filtered before soft optimization. Proposed ranking is lexicographic for inviolable priorities, followed by normalized weighted losses:

`cost = musicalLoss + ergonomicCost + transitionCost + styleCost`

Report these components individually. Normalize units: do not add raw millimetres to unscaled semitone counts. Charge an edit once, not once for every slice during its sustain. Include source salience, melody contour, timing, harmony, voice retention and phrase continuity where defined. Do not let soft weight adjustments bypass hard limits.

The first implementation need not learn costs. Expose a versioned pure scoring hook for future learned/personalized weights. Hooks cannot override validity checks and their identity must participate in cache reproducibility.

`maestro` requests greater fidelity; it does not make the search exhaustive. "Optimal" means proven within a stated finite model/candidate set. Heuristic ranking quality and actual human comfort require separate evaluation.

## 9. Quantization and harmony contracts

`quantizePerformance` is a separate optional stage accepting performed timings, a known tempo/meter map, allowed subdivisions, tolerance, and voice hints. Return selected rational times, alternatives/uncertainty, and edit provenance. Coordinate note onsets/offsets and repeated notes, avoid zero/negative durations, and preserve intentional voice overlap. Keep the original performance timings. Known swing should remain a playback/notation relation; do not silently flatten it.

`analyzeHarmony` emits spans with onset/end, candidate symbols, selected symbol if supported, evidence note IDs, provenance (`provided` or `inferred`), and scoring-method/version. Use the actual sounding bass. Infer harmonic windows rather than labeling every note attack independently. Unsupported/insufficient evidence can return unknown. Expose source intent and realized harmony as separate layers for renderers.

Complexity reduction must not depend solely on chord membership. A suspension, passing tone, or chromatic melody note can be essential. Supplied roles/locks take precedence over heuristic classification.

## 10. API and result contract

Proposed API, not currently implemented:

```js
const result = arrange(source, {
  instrument: concertUkulele({ tuning: 'lowG' }),
  transform: { interval: '2M', tempoScale: 0.75 },
  mode: 'adaptive',
  player: { level: 'beginner', overrides: { allowBarre: false } },
  adaptation: {
    preserveMelody: true,
    allowOctaveShift: true,
    allowAccompanimentOmission: true,
    allowAddedOrnaments: false
  },
  search: { strategy: 'beam', maxCandidatesPerFrame: 128, maxExpandedStates: 100000 }
});
```

Numbers above illustrate budgets; they are not benchmarked defaults. Separate `arrangeAsync`/worker support should handle cancellation and progress for interactive clients without importing browser globals into the core. Synchronous `arrange` has explicit finite work bounds.

Result discriminants:

| Status | Meaning |
|---|---|
| `success` | A complete arrangement passed the model's validity check; includes whether search was exhaustive or truncated |
| `infeasible` | Exhaustive search proved no solution within the explicitly stated model/candidate policy |
| `search-exhausted` | No complete valid result found within approximate/pruned/budgeted search; infeasibility is not proven |
| `unsupported` | Input requires an unimplemented technique/semantic capability |
| `invalid-input` | Schema or semantic validation failed |
| `cancelled` | Requested cancellation; any partial/best candidate is clearly separated from a completed result |

Success includes output score, fingering/performance annotations, source and realized harmony, edit log, difficulty components, policy/model versions, applied assumptions, and search stats. Report `optimality: proven-in-model | best-found`, expansion counts and discarded candidates. A partial prefix never masquerades as a complete arrangement.

Each edit records source IDs, output IDs, old/new values, reason, and the policy permission that allowed it. Preserve original source data. Recompute every requested level from that source, never from the preceding simplification.

## 11. Dynamic recomputation and module boundaries

Cache parsing/normalization, structural analysis, and pitch-position candidates separately. Invalidate by source revision, transposition, tuning/capo/geometry, player/policy version, and analysis options. Tempo changes invalidate transition timing and difficulty even if pitch candidates are reusable.

Phrase-local search must account for entry/exit states and notes crossing the boundary. Commit results using request IDs so a stale worker result cannot replace a newer level. Whole-piece refinement remains available; do not promise constant-time updates for arbitrary polyphony.

Proposed public modules: root facade, `model`, `theory`, `fretted`, `presets`, `arrange`, `analysis`, `quantize`, and optional adapters. V0.0's smaller exports are documented in the README. Keep rendering and large file parsers out of the default import. Do not distribute an empty API with methods that only throw "not implemented".

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

The package remains `private: true` during research. A GitHub repository does not publish an npm package. Verify name availability/ownership again at release; a registry 404 during research is not a reservation. CJS can be added if a real consumer requires it.

## 13. Implementation sequence and acceptance gates

| Milestone | Deliverable | Exit gate |
|---|---|---|
| M0 research foundation | Evidence, this spec, source primitives, pkgroll/browser proof | E1/E2 validated; limits explicitly documented |
| M1 canonical model | Exact time, validation, events/maps, transforms, provenance | Round-trip/inverse/tempo-map and sustain fixtures pass |
| M2 exact fretted solver | Positions, fingers/barres, held-note state, DP oracle and beam | Zero known physical violations; exact tiny-case agreement; honest failure statuses |
| M3 adaptive policies | Required melody locks, constrained edit candidates, all level profiles | Edits permitted/auditable; no source mutation; musician-reviewed fixture set |
| M4 analysis and timing | Harmony spans and known-map quantization | Ambiguity, arpeggios, tuplets, overlap and tempo-change tests |
| M5 v0.1 release | Combined API, worker path, docs, benchmark and browser matrix | Packed-package tests, public API review, licensing, repeatable build |

M0 does not claim completion of M1–M5. Each subsequent change updates the research log/spec when evidence changes a design choice.

## 14. Adversarial acceptance fixtures

High-G string 4 above strings 3/2; same pitch on multiple strings; unavailable bass on high-G uke; six simultaneous guitar notes with open strings/barre; notes individually reachable but jointly impossible; a held note blocking the next attack; a rest permitting a shift; tempo changes inside a transition; same fret span at different fretboard positions; per-string capo; written-vs-sounding guitar octave; alternate tuning; same pitch in overlapping voices; ambiguous C6/Am7-class harmony; arpeggiated harmony; protected chromatic melody; triplets across bar boundaries; repeated notes with quantization collisions; cancellation/search budget exhaustion; unsupported bends/harmonics; and no solution even at maestro.

Numeric difficulty thresholds, runtime targets, and musical quality are provisional until measured. Preserve that uncertainty in both documentation and returned metadata.
