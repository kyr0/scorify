# scorify Score JSON (schema version 1)

The contract `convert` writes and `check` validates. It mirrors scorify's `validateScore`; a file that passes `check` is accepted by scorify's `normalizeScore`.

## Time and pitch

- **Time** is exact: a rational number of quarter notes written `[numerator, denominator]` with a positive denominator, e.g. `[3, 2]` = a dotted quarter after the start. Onsets are ≥ 0; durations are > 0. Never floats.
- **Pitch** is the *sounding* pitch, spelled: `{"step": "F", "alter": 1, "octave": 4}` is F♯4 (alter −4…4; octave numbers change at C, so B3 → C4). Transposing instruments are converted to sounding pitch; the written-to-sounding interval stays on the part.

## Top level

| key | value |
|---|---|
| `schemaVersion` | `1` |
| `temperament` | `"12-TET"` |
| `concertAHz` | `440` (any positive number) |
| `notes` | note events, below |
| `rests` | `{id, onset, duration, partId, voiceId}`; a rest may not overlap a note of the same voice |
| `parts` | `{id, name?, voices: [voice ids], writtenToSounding?}`; `writtenToSounding` is an interval such as `"-8P"` (guitar sounds an octave below the written note) or `"-2M"` (B♭ clarinet) |
| `tempoMap` | `{at, quarterBpm}`, ordered, the first at `[0, 1]`; tempos are always quarter notes per minute |
| `meterMap` | `{at, numerator, denominator, grouping?}`, ordered, the first at `[0, 1]`; denominator a power of two. A pickup bar is written as its own short meter (e.g. `1/8` then `6/8` at `[1, 2]`) |
| `keyMap` | `{at, tonic, mode}`; tonic like `C`, `F#`, `Bb`; mode such as `major`, `minor`, `dorian` |
| `harmony` | chord-symbol spans, below |
| `notation` | free-form metadata; the skill writes provenance here |

## Notes

```json
{"id": "P1-m3-v1-2", "onset": [7, 2], "duration": [1, 2], "pitch": {"step": "A", "alter": 0, "octave": 4},
 "partId": "P1", "voiceId": "1", "role": "melody", "tieGroupId": "tie-4", "sourceIds": ["P1-m3-v1-2"]}
```

- `id` unique across notes and rests. The skill uses `{part}-m{measure}-v{voice}-{n}`; a note repeated by unfolding gets `-x{pass}` and keeps the written note in `sourceIds`.
- `partId` / `voiceId` must name a declared part and one of its voices. Several notes in one voice may sound together (chords).
- `role`: `melody`, `bass`, `harmony`, `ornament` or `unknown`. Arrangers protect melody first; adaptive modes may drop harmony and bass only when allowed.
- `tieGroupId`: tied fragments share it. Fragments are contiguous, in the same part and voice, on the same pitch, and only the last may have a `gateDuration`.
- Optional, never invented by the skill: `gateDuration` (articulated hold ≤ duration), `importance` (0–1), `locked` (`{pitch, onset, duration, keep}` booleans), `techniques` (strings).

## Harmony (chord symbols)

```json
{"id": "harmony-1", "onset": [0, 1], "end": [3, 1], "selected": "G", "candidates": [{"symbol": "G", "score": 1}],
 "evidenceNoteIds": ["P1-m1-v1-1"], "provenance": "provided", "method": "musicxml chord symbol"}
```

A span lasts until the next chord symbol (or the end). `provenance: "provided"` means the symbol is printed in the source; the skill never infers chords. `evidenceNoteIds` lists the notes sounding in the span and must reference existing notes. Symbols look like `C`, `Am`, `F#m7b5`, `D7/F#`, `Bbmaj7`, `Gsus4`.

## Provenance (`notation`)

```json
{"title": "…", "composer": "…",
 "converter": {"name": "score-import skill", "version": "0.1.0", "input": "midi"},
 "assumptions": ["first bar is a 1/2-quarter pickup, written as its own short meter"],
 "warnings": [], "dropped": {"grace notes": 2},
 "source": {"url": "<page>", "site": "<host>", "file": "<file url>", "retrievedAt": "<ISO time>",
            "sha256": "…", "format": "midi", "license": "public domain"}}
```

Keep this block when editing a converted file. Anything a reader needs to judge the fidelity of the conversion is here. `license` is copied from the download sidecar when it has one: the source's reuse terms as its page states them, not a legal finding.

### Words and sung parts

| key | value |
|---|---|
| `notation.lyrics` | `{noteId: syllable}` for verse 1. A syllable ending in `-` goes on into the next note (`"Twin-"`, `"kle"`); notes sung on the previous syllable have no entry |
| `notation.verses` | the same maps for verse 2, 3, … |
| `notation.vocal` | ids of the parts that are sung: parts with words, or named like a voice |
| `notation.words` | lines of text printed after the tune (ABC `W:`), not tied to notes |

scorify itself ignores these keys. The playground shows sung parts as lanes of words under the tab and arranges the other parts.

## Score sets (`*.scorify-set.json`)

Several versions of one piece in one file, easiest first:

```json
{"schema": "scorify-set-1", "title": "…", "composer": "…",
 "variants": [
  {"id": "lead-sheet", "label": "Lead sheet", "difficulty": "beginner",
   "difficultyBasis": "estimated: 4 attacks in a second, 1 notes at once", "score": {"schemaVersion": 1, "…": "…"}},
  {"id": "full", "label": "Full arrangement", "difficulty": "expert", "difficultyBasis": "given", "score": {"…": "…"}}]}
```

- `difficulty` is one of scorify's built-in levels: `baby`, `beginner`, `amateur`, `semi-pro`, `pro`, `expert`, `maestro`. Levels are editable policies, not measured abilities; an estimate counts only attacks per second and notes at once, never fret span, shifts or barres.
- Every `score` is a complete Score as above and validates on its own; `check` validates the set and each version.
- A player of difficulty *d* uses the hardest version with difficulty ≤ *d* that plays on their instrument; scorify's adaptive mode simplifies only when none does.
