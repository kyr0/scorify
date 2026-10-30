# How each format is converted

Every reader produces the same intermediate document (parts → measures → events), and one builder turns it into a Score. Choices the converter makes are printed as `ASSUMED`, problems as `WARNING`, and anything it cannot represent is counted under `DROPPED`. All three are also stored in `notation`.

## Common to all formats

- **Time** stays exact (Python `Fraction`). Tuplets, dotted and broken rhythms are rational, never rounded.
- **Repeats** (`--repeats unfold`, the default) are unfolded into playing order through `|: :|` and 1st/2nd endings. Repeated notes get new ids (`…-x2`) and keep the written note's id in `sourceIds`. `--repeats written` keeps one pass. D.C., D.S., segno and coda jumps are **not** followed: check the page and say so when a piece relies on them.
- **Pickups.** A short first bar becomes its own short meter (`1/8` before `6/8`) so the bar lines that follow stay where they are written.
- **Ties** become `tieGroupId` groups. A tie without a partner is kept as a separate note, with a warning.
- **Roles.** Melody is the first voice of a part named like a melody instrument (voice, soprano, violin, flute, lead…), else of the first part. Bass is the last voice of a part with an F clef or a bass-like name (bass, cello, tuba, bassoon…). Everything else is harmony. Override with `--melody PART[:VOICE]`, `--bass PART[:VOICE]` and `--role PART[:VOICE]=ROLE` (`melody`, `bass`, `harmony`, `ornament`, `unknown`).
- **Tempo** comes from the file. Without one, `--tempo` (default 120 quarters per minute) is used and stated.
- **Chord symbols** become `harmony` spans with `provenance: "provided"`. Chords are never inferred from the notes.
- **Lyrics** are kept, every verse: `notation.lyrics` (verse 1) and `notation.verses` map note ids to syllables. Parts with words, or named like a voice, are listed in `notation.vocal`. Unfolded repeats carry the words on their first pass only.
- **Rests** that overlap a note of their own voice (common in sloppy exports) are dropped and counted.

## MusicXML (`.musicxml`, `.xml`, `.mxl`)

Partwise and timewise, versions 2–4; `.mxl` archives are opened through `META-INF/container.xml`.

| source | result |
|---|---|
| `<divisions>`, `<duration>`, `<backup>`, `<forward>`, `<chord/>` | exact onsets per voice |
| `<voice>` | voice ids per part, as written |
| `<transpose>` | applied: pitches are sounding pitches; the interval is kept as `writtenToSounding`. An octave clef without `<transpose>` is kept as encoded, with a warning |
| `<sound tempo>`, `<metronome>` | tempo map (converted to quarters per minute) |
| `<key>`, `<time>` | key and meter maps (mode from `<mode>`). In a score of tablature only, which shows no key signature, a signature without sharps or flats is not kept: the key is unknown (warning) |
| `<harmony>` | chord symbol with kind and bass, e.g. `D7/F#` |
| `<tie>`, `<barline>` repeats and endings | ties, unfolding |
| `<lyric number="…">` | the syllable of that verse; `syllabic` begin/middle adds a trailing `-` |
| grace and cue notes, unpitched notes, ornaments, microtones | dropped and counted (microtones rounded to the nearest semitone) |
| a tablature staff (`<clef><sign>TAB`) beside a notation staff of the same part | dropped and counted when it repeats the notation staff note for note (staff and tab shown together); kept with a warning when it differs. A part shown only as tablature is read like any other |

## ABC (2.1, the subset tune collections use)

Header fields `X T C M L Q K V w`, inline fields, key signatures with modes (`Dmix`, `Ador`…), bar-scoped accidentals, octave marks, note lengths, broken rhythm (`>`/`<`), tuplets (`(3`, `(p:q:r`), ties, chords (`[CEG]`), chord symbols (`"Am"`), rests (`z`, `x`, `Z`), repeats and endings, multiple voices (`V:`).

- One file may hold many tunes: `tunes FILE` lists them, `--tune N` picks `X:N` (default: the first).
- `w:` lines sing on the notes of the music line above them: one syllable per note or chord, `-` splits a word, `*` and `_` skip a note, `~` joins words, `\-` is a literal hyphen; each further `w:` line under the same music line is the next verse. `W:` lines (words printed after the tune) are kept as text in `notation.words`.
- Dropped and counted: grace notes, decorations (`!trill!`, `~`). `transpose=` is a playback instruction and is not applied (warning).
- Quoted text that is not a chord symbol (annotations such as `"^slow"`) is ignored.

## Standard MIDI (`.mid`, `.midi`)

Formats 0 and 1 with ticks per quarter (SMPTE time is rejected). Format 0 is split by channel.

- Notes from notation programs are already exact in ticks. A recorded performance needs `--grid 1/4` (or `1/8`, `1/3`…): onsets and ends snap to it and the largest shift is reported.
- **Spelling** follows the key-signature meta event (sharps in sharp keys, flats in flat keys); MIDI has no enharmonic information.
- **Bars** come from time-signature events only. MIDI has no pickup bar: when the music starts with an anacrusis, pass `--pickup` (its length in quarters, e.g. `1/2` for an eighth), or every bar line is shifted by it.
- **Voices.** A track where notes overlap (two voices on one staff, a piano reduction, a chorale on two staves) is split into lines: the top line is voice 1, the bottom line voice 2, inner notes voice 3. A note under a still-sounding top note is not top, and one above a still-sounding bottom note is not bottom. When both lines are free and a single note sounds (a unison, or one line resting), it joins the track's salient line: the bottom for the lowest track, the top otherwise. `--no-split` keeps each track as one voice.
- **Roles** follow register, not track names: the top line of the highest-sounding track is the melody, the bottom line of the lowest-sounding track the bass. With one track: its top line melody, its bottom line bass.
- Channel 10 (drums) is dropped. Notes never released are counted. Track names become part names.
- Chord symbols and lyrics can be recovered from a corresponding score using available MCP/OCR or visual tools; see the fallback below. The bundled MIDI reader itself does not import lyric meta events. Verify alignment to the same edition rather than guessing words or chords from MIDI notes.
- No articulation: notation programs export every note at its full written value, so consecutive notes are fully legato. Arrangers that model the fretting hand may need an explicit, reported early release to move between chords.

## Conversion fallback

`score.py convert` directly reads MusicXML/MXL, ABC and MIDI. Its `(unsupported)` link label means an additional conversion step is needed, not that the agent must abandon the task. Apply these routes to user-provided material or sources that permit the requested reproduction/conversion.

- **Notation-editor files** such as Guitar Pro, LilyPond, MEI or Humdrum: inspect available local applications/exporters and their supported formats. Export MusicXML when possible, otherwise MIDI with its losses recorded. Run only verified application commands; do not invent an export command or claim an external converter is bundled here. Preserve the original and the intermediate export with their provenance.
- **PDFs and images:** first look for a machine-readable export of the same edition. If none is available, use available MCP/OCR or host PDF/image tools to render and inspect the pages. OCR can recover words; music notation needs optical music recognition (OMR) or visual transcription. For a manageable score, transcribe the visible notation into MusicXML or ABC, reviewing pitches, clefs, accidentals, rhythms, ties, pickup bars, repeats, vocal staves and lyric alignment against the source. For larger scores, use an available OMR tool, then review its output against the page images. The bundled CLI contains no PDF parser or OMR engine; this is an agent-assisted workflow, not an automatic CLI capability.
- **Uncertain notation:** record the page and measure, retain uncertainty, and resolve it from the source or ask a targeted question. Never fill unreadable notes or missing verses from memory. Do not call an unchecked OMR result faithful merely because the JSON validates.

Run the resulting MusicXML/ABC/MIDI through `convert` and `check`, then inspect the requested parts and representative measures against the original. Preserve source identities and disclose any corrected recognition errors, losses and remaining uncertainty. Ask the user for an export only when accessible sources and available conversion tools cannot finish the task.
