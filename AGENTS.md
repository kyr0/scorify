# Scorify development

Read `docs/IMPLEMENTATION_SPEC.md`, `docs/RESEARCH.md`, and `docs/VALIDATION.md` before extending the library. Preserve the long-term instrument-adapter design while implementing ukulele/guitar first. Update the specification when implementation evidence changes a decision.

- Use Bun with the committed lockfile for dependency management; execute builds/tests with Node as configured in package scripts.
- Keep the core host-neutral, pure where practical, and usable by native browser ESM. Build with pkgroll and retain explicit subpath exports.
- Preserve sounding pitch, note spelling, source identities, exact musical time, physical string order, and capo semantics.
- Distinguish note locations from fingerings; a pitch-set match is not a playability proof.
- Do not claim arrangement, quantization, or difficulty features until implemented and validated. Never silently relax hard constraints.
- Distinguish search budget exhaustion from proven infeasibility. Keep approximate and exact guarantees explicit.
- Levels are versioned editable policies, not scientifically calibrated ability labels.
- Add meaningful tests for music semantics and search counterexamples. Run `bun run check` before delivery; test the browser module graph when packaging changes.
- Keep `private: true` until the owner explicitly requests publication. Repository setup does not authorize an npm release.

- Fidelity is the primary search objective; do not let ergonomic duration costs erase playable source notes.
- Keep exhaustive and independent-replay fixtures, and ensure worker cancellation/stale-result semantics remain tested.
- Native Worker scripts must be hosted according to the app origin policy; do not promise arbitrary cross-origin Worker URLs.

- Keep optional audio out of the root module graph, and score/solver code out of the DSP/worklet graph.
- Validate performed onsets/releases after strum/humanization, preserve sounding durations and notated trailing rests, and report reduced timing variation. Never silently change the chosen fingering to make playback pass.
- Preserve seeded event/stroke identity, fresh excitation and persistent ringing state. Test worklet/offline sample parity and cancellation when changing audio scheduling.
