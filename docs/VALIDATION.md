# Validation record

Date: 2026-10-31. Version: `0.4.0` on npm.

## Public-domain songs with their words, 2026-10-31

- **Sources and licenses.** Eight songs whose tunes and words are in the public domain, from sources that say so: the Open Hymnal (Amazing Grace, Silent Night; "copyright: public domain" in each file), *Songs from the Public Domain* (Auld Lang Syne, Red River Valley, Shenandoah, Loch Lomond; the collection's LICENSE.md dedicates it to the public domain) and two Wikipedia articles (Scarborough Fair's "version commonly used today", Happy Birthday to You; CC BY-SA 4.0, attributed in `scores/README.md` and each score's `notation.source`). Not used: a CC0 MuseScore Drunken Sailor (verse fragments, no main verse), *Songs from the Public Domain*'s Scotland the Brave (words by Cliff Hanley, 1950) and O Sole Mio (an English translation of unknown date).
- **Conversion.** The ABC files were converted with the score-import skill; the LilyPond files were first transcribed by `scripts/lilypond-abc.py`, which places each verse's syllables as LilyPond's `\lyricsto` does: ties, slurs and manual beams continue a melisma unless the verse sets `ignoreMelismata`, `_` skips a note, pitched rests move the relative octave. Every verse's syllable count equals its notes with words (Auld Lang Syne verse 1: 28 of 28 notes with `ignoreMelismata`; verse 2: 48 with the slurs and beams of the chorus), and the words were read back in full against the sources. Loch Lomond's five dashed ties that a verse sings across are struck as two notes. Two fixes to the skill came out of it: an ABC key or meter given after the header's `V:` lines now reaches every voice (the Open Hymnal's files lost their key), with a test that fails without the fix; `convert` keeps a sidecar's `license`.
- **Charts.** `scores/charts.mjs` writes the eight charts from one plan (baby and beginner strum the simpler chords, amateur and semi-pro strum `PROGRESSION_VERSIONS`, pro a picked bass and strums, expert and maestro an arpeggio, maestro's runs only where the voice holds to the bar line). Chords come from each edition's four-part setting, read beat by beat and then chosen by hand, from the article's chord line (Scarborough Fair) or the usual ones (Happy Birthday). `tests/docs-import.test.mjs` checks for every card that the score's checksum is that of `scores/<id>/<id>.abc`, that every verse has words and every syllable is shown, that baby to semi-pro only strum (`countStrokes`, no picked hit), and that pro mixes a picked bass with strums.
- **Pickups.** `songFromChart` refused a score with a pickup; it now accepts one first meter shorter than the next. A test plays a chart over such a score: chords start after the pickup, `vocalTranspose` counts bars after it, a later meter change is still refused.
- **Survey.** `precompute:docs` searched all 9,461 configurations: every one plays, 9,395 as written for the difficulty; 66 play an easier version (pro → semi-pro 27, semi-pro → amateur 17, amateur → beginner 11, pro → amateur 9, beginner → baby 2), 53 of them on high-G ukulele, where the search budget runs out (checked for the own-key cases: both search tiers exhausted, not proved infeasible). The public cache holds 14,963 arrangements (160 MB, was 62 MB).
- **Browser.** `check:docs` clicks the eight cards at amateur: each plays its own strummed version, shows one row of words per verse beginning with that verse's first syllable, and draws its chords.

## 25 chord progressions and per-build docs, 2026-10-31

- **Catalog.** `tests/practice.test.ts` checks:
  - all 25 example chord lines as listed, from C F G C to C7 F7 C7 G7 F7 C7 G7;
  - every numeral form: `ii7` Dm7, `Imaj7` Cmaj7, `I7` C7, borrowed `iv` Fm, `V/vi` E and `V7/ii` A7 in C; `iiø7` Bm7b5, `ii°` Bdim, `bIII` C, Dorian `IV` D and `v` Em in A;
  - the spelling of Bm7b5 (B D F A);
  - the durations (the blues 4–2–2–1–1–1–1, the jazz ii–V–I 1–1–2);
  - endings (Imaj⁷ held, IV–V–iii–vi ends on Am);
  - the link between I–V–vi–IV and i–♭VI–♭III–♭VII;
  - that source links are https URLs without tracking parameters.

  All 13 source links resolved (HTTP 200) on 2026-10-31.
- **Counts.** `scripts/billboard-progressions.py` counts all 25 in the McGill corpus with one method. It reproduces every earlier count: I–IV–V–I 42, I–vi–IV–V 28, the blues 23, I–♭VII–IV–I 22, I–vi–ii–V 17, I–♭III–IV–I 12, I–V–vi–IV 7, i–♭VI–♭VII–i 5, i–♭VII–♭VI–V 4. Counts for the new progressions:
  - ii–V–I 39, i–IV–i 16, IV–iv–I 9;
  - IV–V–iii–vi 3, i–♭VII–♭VI–♭VII 4;
  - I–IV–vi–IV, i–iv–♭VI–♭VII and Imaj⁷–V⁷/ii–ii⁷–V⁷ 2 each; i–v–IV and vi–IV–V–I–IV–V 1 each;
  - 0 for i–♭VI–♭III–♭VII, I–IV–vi–V, the Creep progression, the minor jazz ii–V–i, the minor circle of fifths and the Pachelbel-style sequence.
- **Survey.** All 25 progressions with their strum versions: 2,450 arrangements, every one plays, and 2,359 play the version written for the level. The slowest took 29 s. The runs are all 8 instruments at all 7 levels in 4/4, and guitar and high-G ukulele in 3/4, 6/8 and 12/8. Of the other 91:
  - 56 are baby on the four seventh-chord progressions (the blues and the three jazz ones). Baby cannot voice four-note chords, so these play simplified, reported.
  - 35 ran out of budget from pro to maestro and play the next easier version: minor and Dorian progressions on high-G ukulele, IV–V–iii–vi and vi–IV–V–I–IV–V there, and the 4/4 blues on guitar and drop-D guitar.
- **Page.** `check:docs` covers:
  - 25 cards;
  - Em7 A7 Dmaj7 and its count in D, and D F♯ G Gm with no count;
  - the minor jazz ii–V–i playing C♯m7b5, F♯7 and Bm, with Hutchinson linked;
  - I–V–vi–IV's related link;
  - the blues titled by its numerals.

  At phone width the cards sit two to a row (they were one, the base rule winning over the phone rule). A score without chord symbols hides the voicing card and the neck takes the whole row; Greensleeves checks it.
- **Per-build modules.** Right after the 0.4.0 deploy, the live playground failed with "The requested module './scorify/songs.mjs' does not provide an export named 'PROGRESSION_STYLES'". The deployed files were correct. GitHub Pages serves each file with `cache-control: max-age=600` under a stable URL, so a browser combined the new `songs.mjs` with the previous deploy's `scorify/songs.mjs`.
  - `build:docs` now copies the page's modules and the library into `docs/assets/v/<content hash>/` and points `index.html` at it, keeping the last three builds.
  - `check:docs` fails when that directory does not hold the current sources.
  - The stylesheet link carries its content hash.
- `bun run check` passes **246 tests in 18 files**. `check:docs` and `check:cache` (0 of 5,502 stale) pass.

## Strum, arpeggios and inversions, 2026-10-31

- **Strum strums.** Every hit of every `PROGRESSION_VERSIONS` version is a strum, with no bass, fill or arpeggio (`tests/practice.test.ts`). Before, Strum picked from pro on: in 4/4 maestro played an alternating bass with fills, 3/4 picked arpeggios from pro and at amateur, 6/8 from pro, and 12/8 from expert, so scale chords and progressions played arpeggios under "Strum". `check:docs` asserts that the story of a strummed scale's chords and of a strummed progression names no arpeggio or bass.
- **Not every place.** No strum version or strumming pattern strikes more than three quarters of the places on its grid (eighths, or the sixteenths or triplet eighths it uses; rounded up); a test counts them. A first rewrite had filled every sixteenth at maestro (and every eighth at pro in 3/4 and 12/8); those versions now syncopate.
- **Strum survey.** All 13 progressions and F major's chords in 4/4, 3/4, 6/8 and 12/8, on all 8 instruments at all 7 levels: 3,136 arrangements, all play; 3,092 on the version written for the level (mean 262 ms, slowest 16.9 s). Of the other 44, 32 are baby on the 12-bar blues, whose dominant sevenths baby cannot voice, played simplified; 12 ran out of budget from pro to maestro and play the next easier version: the minor progressions and F major's chords on high-G ukulele (4/4, 6/8, 12/8) and the 4/4 blues on guitar and drop-D guitar.
- **Strumming patterns.** Tests:
  - All 16 patterns have distinct ids, and every hit is a strum.
  - Each written line (D, U, B on their slots) matches the pattern's hits.
  - A reggae skank's strums are eighths on 2 and 4 at 76 BPM.
  - The island strum plays as written at maestro on high-G ukulele, and simplified (reported) at baby.
  - A pattern in another meter or with an arpeggio throws.

  Each difficulty is the easiest level that plays the pattern as written over I–IV–V–I and I–V–vi–IV, on the instruments it is typical for:

  | Difficulty | Patterns |
  |---|---|
  | Beginner | reggae skank |
  | Amateur | everything else: island strum, ska upstrokes, rock downstrokes, pop strum, funk sixteenths, folk strum, boom-chick, boom-chicka, bluegrass chop (on mandolin), swing strum, blues shuffle, waltz strum, waltz with a push, boom-chick-chick, 6/8 ballad |

  The first measurement used I–IV–V–I alone and rated the pop strum, blues shuffle, both waltz strums and the 6/8 ballad beginner. On guitar they fail at beginner over I–V–vi–IV, so they are now amateur.
- **Pattern survey.** Every pattern, on every instrument it fits (the three bass patterns on the four guitars), over I–IV–V–I and I–V–vi–IV, at all 7 levels, run with the first ratings: 1,624 runs.
  - 1,248 played as written. 334 were simplified, 319 of them below the pattern's difficulty (232 at baby, 87 at beginner).
  - At or above the pattern's difficulty, 15 runs were simplified: ten beginner runs on baritone ukulele, which is not among the instruments the patterns are typical for, and boom-chicka on drop-D guitar over I–V–vi–IV.
  - 42 found nothing, all at beginner on guitars: eighth-note patterns that beginner cannot play as written, whose simplification ran out of search budget. The page reports this, and By difficulty plays.

  - The bass patterns play on all four guitars.
  - On high-G ukulele and mandolin they play at no level, and on low-G and baritone ukulele only at maestro, so they need six strings.
  - `check:docs` covers the Pattern select:
    - It shows for Strum and hides for an arpeggio.
    - Its groups are listed by style.
    - Boom-chick is disabled on the ukulele.
    - The island strum plays as the one version, and "By difficulty" brings back seven.
- **Arpeggios.** The arpeggio survey ran with the barre fix and the 512 beam. It took I–V–vi–IV in 4/4, 3/4, 6/8 and 12/8, plus F major's chords in 4/4, in all three directions on high-G ukulele, baritone ukulele, guitar and mandolin, at all 7 levels: 420 runs, 408 of them on the version written for the level. Runs took 767 ms on average; the slowest took 4.2 s. The widest hand span was 2 frets at baby and beginner, 3 at amateur and semi-pro, and 6 from pro to maestro. The 12 others were baby in 6/8 on every instrument and direction. Letting go a quarter before the chord change left the second tone a dotted eighth, below baby's quarter. The release now keeps the level's shortest note, and all 12 play as written (and in a test on guitar). Before the barre fix, guitar arpeggios of I–IV–V–I, the 12-bar blues and C major's chords fell back to amateur from semi-pro up (infeasible or out of budget).
- **Held barres.** `tests/arrange.test.ts`: an F barre whose bass is picked first and held is fingered with the barre laid flat around it and accepted by the validator. A finger held at one fret is never moved to another while its note sounds.
- **Beam width for arpeggios.** Total cost, widest span and time, at the songs' first tier (32 states, 512 candidates) against 512/8,192:

  | Maestro arpeggio | 32 | 512 |
  |---|---|---|
  | High-G ukulele, I–IV–V–I 4/4 up, F in root position | 11.47, span 8, 0.3 s | 8.95, span 1, 3.7 s |
  | High-G ukulele, I–IV–V–I 4/4 up | 7.91, span 1, 0.3 s | 7.85, span 1, 3.5 s |
  | Guitar, 12-bar blues 12/8 up and down | 53.16, span 5, 0.5 s | 48.27, span 2, 4.0 s |
  | Guitar, F major's chords 4/4 up | 29.63, span 2, 0.5 s | 29.60, span 2, 4.5 s |
  | High-G ukulele, F major's chords 6/8 down | 16.06, span 6, 0.4 s | 14.72, span 3, 4.6 s |

  - At 128/2,048, the F case still spanned 8 frets (11.46).
  - At 2,048/16,384, four of the five ran out of their 4,000,000 expansions.
  - At amateur, both widths gave equal costs.
  - The amateur guitar blues ran out at 32 and at 512 and plays on the 2,048 retry.

  Songs keep their first tier, so no cached arrangement changes (a test asserts it).
- **Inversions.** `tests/practice.test.ts`:
  - Guitar C in first inversion has E lowest.
  - An alternating bass starts on E in bar 1 only.
  - The note names the inversion, and the cache key changes only when there are inversions.
  - The inverted song plays, and the validator accepts it.
  - Moved up a tone, a key for C is reported ("no chord to invert at 1.1:C"), not dropped.
  - `check:docs`:
    - The high-G ukulele's F (written 2010, second inversion) goes to root position, then to F/A, and back.
    - A 12/8 blues arpeggio's D7 becomes D7/F♯.
    - Rainbow's C becomes C/E, and back.
- **Exact triplets.** Chord-song times on thirds of a quarter are 24ths: expert's triplet arpeggio picks at exactly 1/3 and 2/3 of a quarter (a 32nd grid had made two notes meet, "Gate must be positive").
- **Cache.** The fingering change needs a new cache version (`8ac1bc6e57f9755c`), so all 5,502 public arrangements were searched again, and every one plays. `check:cache` reports 0 stale after the later practice changes. The private library cache is stale until `precompute:docs --private` runs.
- `bun run check` passes **246 tests in 18 files**; `check:docs`, `check:browser` and `check:cache` (0 of 5,502 stale) pass.

## Scales and chord progressions, 2026-10-31

- **Spelling.** `tests/practice.test.ts`: F♯ major keeps E♯, A blues has E♭, the melodic minor falls as the natural minor, and the chromatic scale rises in sharps and falls in flats. Every scale rises by steps of one to three semitones over exactly one octave. Each set of twelve tonics covers the twelve pitch classes.
- **On the neck.** C major starts on C4 on high-G ukulele and on C3 on guitar. Two octaves of F major do not fit an 18-fret high-G ukulele, which ends on D♯6; with 20 frets they fit. `scaleScore` throws and the page reports instead of moving notes. Notes per beat are exact rationals: eighths in 4/4, triplets in 3/4, eighths in 6/8 at 60 dotted quarters a minute, and the last note sounds to the bar line.
- **As written or reported.** Two octaves of G major on guitar play at beginner in exact mode with every pitch as generated, and the validator accepts them. At baby, the eighths are reported, with no simplified attempt, and quarters play.
- **Billboard counts.** `scripts/billboard-progressions.py` reads the McGill Billboard corpus (the `billboard-2.0-salami_chords.tar.gz` linked from the project page, md5 matching mirdata's): 739 distinct songs, 23 with a 12-bar blues chorus. The progressions that start a phrase, beginning on the tonic: I–IV–V–I 42, I–vi–IV–V 28, I–IV–I–V 28, I–V–IV–I 23, I–♭VII–IV–I 22, I–V–I–IV 18, I–vi–ii–V 17, I–V–IV–V 12, I–♭III–IV–I 12, I–V–vi–IV 7, i–♭VI–♭VII–i 5, i–♭VII–♭VI–V 4. The corpus has 692 songs in 4/4, 24 in 12/8, 14 in 3/4 and 7 in 6/8, which is why those are the four time signatures.
- **Versions.** All 13 progressions in the four time signatures, on all 8 instruments at all 7 levels, give 2,912 arrangements, and every one plays. In 2,863 of them, the version written for the level plays. Of the other 49, 45 are maestro versions with an alternating bass, which fall back to expert on the four-course instruments (high-G ukulele, mandolin; Wicked Game does the same) or run out of budget on drop-D guitar. The other 4 are expert versions that run out of budget (minor progressions on high-G ukulele, the blues on guitar) and play pro. Before the patterns were adjusted, 138 did not play their own version: bass versions on four strings and the 3/4 versions above the attack rate. The slowest arrangement took 21.5 s in Node.
- **Page.** `check:docs` covers both tabs. On the Scales tab: the C major scale with 15 tab notes, the F♯ tonic kept across a minor scale, two octaves of F major reported and fitting at fret 20, 6/8 keeping eighths, baby's shortest note, and remembered choices. On the Chord progressions tab: 13 cards, the key moving cards and arrangement, the blues in 12/8 at maestro tempo, and back to Rainbow on Songs. The capo/import check now waits for the imported file's own arrangement; before, it could read the state from before the import.
- `bun run check` passes **235 tests in 18 files**; `check:docs`, `check:browser` and `check:cache` (0 of 5,502 stale: the practice code changes no cached arrangement) pass.

## Highest fret and low positions, 2026-10-31

- **Policy.** Each level below maestro has soft costs for the highest fretted note of a moment, counted from the capo, per quarter note: baby to semi-pro 1 per fret above 8 and 4 more per fret above 10, pro and expert 4 per fret above 10. The instrument's highest fret is the hard limit: ukuleles 18, guitars 19, mandolin 20, or a request's `frets`.
- **Fixtures.** `tests/arrange.test.ts`: on guitar the run E5 D5 C5 B4 A4 G4 E5 G5 takes B4 and A4 at or below fret 8 at semi-pro, at or below 10 at pro and above 10 at maestro. Adaptive mode, with octave shifts allowed, keeps all eight notes at their pitch at every level. `tests/songs.test.ts`: each instrument's highest fret, `~frets7` ids, and an unchanged cache key at the usual fret. A 5-fret neck keeps every note at or below fret 5 and validates, and a capo above the highest fret is reported. A search that runs out of budget with the preference is searched again without it; the log marks it `anyPosition`, and it replays without a search.
- **Public cache.** The cache version is `bd416701157b37ac`, and all 5,502 configurations were searched again. Request by request against the previous cache, the share of playing time with the hand above fret 8, and above fret 10, fell from 8.7% to 5.9% and 6.0% to 3.6% at amateur, 9.2% to 6.0% and 6.4% to 3.8% at semi-pro, 10.0% to 8.1% and 6.9% to 4.0% at pro, and 7.4% to 6.1% and 4.9% to 2.8% at expert. Baby, beginner and maestro are unchanged; maestro's 5.3% → 5.2% comes from the ukuleles' 18th fret. Most notes still above fret 10 lie nowhere lower: of those notes, 116 of 2,758 at amateur and 579 of 3,267 at semi-pro have a location at or below fret 10 on another string. Musical loss ranks first, so the preference does not move a note.
- **A preference never costs a note.** In the first full run, Greensleeves with all four voices on drop-D guitar at expert, in two keys, ran out of budget with the preference. It fell back to its strummed chords, 210 and 230 notes instead of 235. With the fallback search, seven configurations, all Greensleeves, play from a search without the preference, and no result has fewer notes than before: 0 of 5,502. `check:cache` reports 0 of 5,502 stale.
- **Page.** `check:docs`: the slider stands at 18 on high-G ukulele with the usual mark current. At 5, Rainbow plays with nothing above fret 5, About this arrangement says "Frets up to 5 only (the instrument's usual highest fret is 18)", and the value stays with the ukulele across songs. The mark brings back the cached arrangement.
- `bun run check` passes **227 tests in 17 files**, with the package and packed checks.

## Cache version, engine paths, timing limits and practice sounds, 2026-10-30

- **Cache version.** The cache is keyed by `src/VERSION` instead of a hash of the build. Rebuilding the library with the version unchanged replays every cached configuration: `check:cache` reports 0 of 5,502 stale, and `--private --check` 0 of 6,788.
- **Engine paths.** Paths share their past (persistent lists) instead of copying it at every step. Wicked Game's longest configuration takes 6 s instead of 50 s, another 23 s instead of 202 s. A full public run takes 13.5 minutes and 11,652 CPU-seconds, against 26.6 minutes and 24,868 CPU-seconds before. Compared with the previous cache request by request, 5,404 of 5,502 public results are identical; the other 98 are imported scores' amateur chord versions, changed on purpose (below).
- **Timing is not fingering.** `createPerformance(…, { timeLimits: false })` lifts the attack rate, shift and finger speed and finger setup, and records `timeLimits: "lifted"` in the plan, which `validatePerformance` honours and checks. A beginner's eight open notes at 8× tempo fail by default and play with the limits lifted; a tampered plan fails validation. Rainbow on high-G ukulele plays at amateur ×1 and maestro ×2 through the docs modules. The page's message "This fingering cannot perform that timing" no longer occurs.
- **Chord shapes for picked versions.** Since the picked-notes limit, the shape probe applied it too, and Wicked Game's and Rising Sun's baby versions found no Bm or Am shape. The probe now lifts both right-hand limits. A test that fails without the fix finds Bm and Am on guitar and Am on high-G ukulele at baby with a pick. After a follow-up run all 618 affected public configurations succeed, and every baby version plays as written.
- **Amateur chord release.** An imported score's amateur chord version lets go a sixteenth before each strum. Bamboléo amateur now arranges in three keys tried by hand. The private library has 144 failures of 6,788, all Bamboléo (26 infeasible, 118 search-exhausted), down from 312.
- **Practice sounds.** `scorify/audio-guide` has 11 tests: the voice's pitch, its lowpass (4th harmonic below 0.35×, fundamental above 0.85× of an unfiltered render), its level under the strings, and span parity to 1e-4; the metronome's patterns for 2/4, 3/4, 4/4, 3/8, 6/8 and 12/8, the count-in times, the kick's sweep, the clap's three bursts, and exact span parity. `check:docs` checks a count-in of about 3 s at 80 BPM with the playhead held at the start, the song loop wrapping without a second count-in, the remembered switches, and the Voice switch offered only for a sung part.
- **Figures.** Public pieces: 5,502 configurations in twelve keys, 62 MB gzipped. In each piece's own key without capo every version plays as written except the two documented in `DEMO.md`; in other keys and with capo 116 of 5,166 play an easier version, and none fails. Local library: 6,788 configurations, 311 MB; a full run takes 88 minutes (84,740 CPU-seconds), and Bamboléo's follow-up run took 94 minutes.
- **Metadata edits without a search.** Removing edition authors' names (and Wicked Game's cover credit) from the local charts and scores changed the cache keys of 6,116 configurations, and of every score piece's attempt fingerprints too, since a score's notation is part of its source. A one-off re-key replayed each cached log attempt by attempt for the edited piece, required the same sequence of attempts and the same replayed outcome with validation, and renamed the entries: 7 minutes instead of a full run. Seven configurations searched again for real (Rainbow, Wicked Game, Katyusha, Zvezda, Bamboléo; successes and an infeasible one) gave identical logs, fingerprints, notes and annotations. Kino's words changed only the cache keys: all 1,230 cached logs replayed with unchanged attempt fingerprints before the re-key.
- **Tempo in place.** `check:docs` changes the tempo while Rainbow plays: playback goes on without a count-in from where it was, and a pause stays at its position through another change.
- **Package contents.** `check:packed` allows only `dist/`, `package.json`, `README.md`, `LICENSE` and `THIRD-PARTY-LICENSES.txt`; adding `docs/DEMO.md` to `files` makes it fail.
- `bun run check` passes **224 tests in 17 files**. `check:docs`, `check:browser`, `check-private-docs.mjs` and the skill's 22 tests (1 skipped, live) pass.

## Picked notes, chords, playback tempo and keys, 2026-10-30

- **Picked notes per bar.** Fixtures (`tests/adversarial.test.ts`): four notes picked one at a time pass a limit of 2; a bar of a two-note chord and one more note needs 3. Exact mode is infeasible at 2, and adaptive mode leaves out the doubled harmony note and keeps every moment. Strums count nothing. The validator reports `Picked notes per bar limit`.
- **Keeping the tune's moments.** A fixture where the cheaper omission would empty a weak beat now leaves out the doubled note instead. With the penalty set to zero the same fixture empties the beat, so the test discriminates.
- **Canon in D on standard guitar, before the rule.** The simplified ensemble kept 3 of 4 moments in bars 9–24 and 1–2 of 6–8 in bars 25–40 at amateur. The cause was not beam width: 8, 32 and 128 states gave the same result. Every combination that keeps all notes used up the per-frame candidate cap before a thinner one was tried.
- **Canon in D on standard guitar, after the rule.** Amateur (242 notes), semi-pro (295) and pro (the solo, 556 of 750 notes) keep every moment of every bar. Expert and maestro play the concert solo with all 1,533 notes. Baby and beginner strum the inferred chords, D A Bm F#m | G D G A.
- **Melody chords.** Only the top note of a chord in the melody voice is melody. Before that, the solo's melody dyads made doubles mandatory, and pro could not play the solo.
- **Tempo is playback only.** A request at 110 BPM replays the 80 BPM log of Rainbow's pro version without a search, with the same frets, a scaled tempo map and its higher attack rate reported. `retime` moves the arrangement on show to 60 or 140 BPM and back to the identical result. The 7-string guitar falls back from expert to pro whatever tempo is asked.
- **Keys.** Twelve keys, every instrument and difficulty, precomputed: see the cache figures above.

## Canon in D in the local library, 2026-10-30

Three guitar arrangements of Pachelbel's Canon (ensemble 468 notes, solo 750, concert solo 1,533) were downloaded as MusicXML, converted with the score-import skill and bundled as a score set with difficulties semi-pro, pro and expert. The skill's 21 tests pass, including new ones: a tablature staff repeating its notation staff is dropped and counted, a differing one is kept with a warning, and a tab-only score's unset key signature leaves the key unknown. The page and `precompute-docs.mjs --private` load the set alike: 56 new configurations, 0 of 180 stale. On standard guitar (the card's default) every difficulty succeeds: pro plays the solo, expert and maestro the concert solo with every note kept (adaptive: octave shifts of the drop-D bass notes), baby to semi-pro a simplification of the ensemble. On drop D the solos' same-onset unisons (one note shared by two voices) make exact mode fail; amateur and semi-pro are `search-exhausted`, the other levels play the simplified ensemble. Bisection on the solo with the unisons merged (not shipped) reached bar 54 of 61 before a stretch exceeded pro's limits. `check-private-docs.mjs` checks every difficulty of the set in Chromium: the version expected for it plays (only the easiest version may be simplified) and replays from the cache.

## Cache freshness and replay speed, 2026-10-30

Long songs were searched again after every library rebuild, although the precomputed cache was fresh: the page took a request's log from the first layer that had one, and a result this browser had saved in IndexedDB under an earlier build hid the precomputed one (its attempts no longer fingerprinted alike, so they were searched). The page now replays from memory, IndexedDB and the precomputed files together, keeps the build with each IndexedDB entry, and ignores and prunes entries of other builds. `check:docs` reproduces the case: an IndexedDB entry for Wicked Game's amateur key with the current build and a wrong fingerprint must still give way to the precomputed replay. Greensleeves' other voices (outer voices, melody only, all voices) are now precomputed too: 392 public configurations (2.9 MB gzipped) and 124 for the local library, 0 stale in `check:cache` for both.

Replay time was dominated by `validateFrettedArrangement`, which filtered every note and every earlier attack at every frame. It now sweeps them forward when frames are strictly ordered, giving the same notes in the same order. On all 444 cached arrangements (public and local) the old and new validators return identical diagnostics, also for 1,332 perturbed copies (swapped first frames, a 3-attack density limit, polyphony 1; 1,204 of them invalid). The largest arrangement (2,510 notes) validates in 27 ms instead of 318 ms; all 444 take 1.8 s instead of 13.9 s. A new fixture (sustained note across later attacks, out-of-order note list, an attack exactly one second earlier, unordered frames) fails for each of three mutations of the sweep. Every cache was searched again for the new build: Greensleeves' outcomes per voice choice are 40 successes of 56 for outer voices and melody (infeasible at baby, search-exhausted at beginner) and 16 for all voices (guitars from semi-pro); everything else succeeds. In the browser on the local server, changing song or difficulty now replays in 150–300 ms for the long local songs (before: 0.5–0.85 s) and 23–43 ms for the public pieces, failures included. `bun run check` passes **205 tests in 16 files**; `check:docs` and `check-private-docs.mjs` pass.

## Songs module, post effects and print view, 2026-10-30

`bun run check` passes **204 tests in 16 files**, the type/build checks and packed-package checks. The arrangement layer the playground used (`docs/assets/songs.mjs`) is now the library subpath `scorify/songs`, a typed port with the same rules; the demo keeps its song content and the Fretboard tab. The demo's 9 tests pass unchanged through it, and 7 new library tests (`tests/songs.test.ts`) cover chord-book voicings, per-difficulty versions in exact mode, a proved-infeasible maestro version falling back with its reason, pre-search limits and stroke counting, replay only for equal inputs and build, the capo suggestion with shapes behind the capo, retime at a slower tempo, strokes and imported-score voices. The package check keeps `songs` (37 kB gzipped) and `audio-effects` (2.3 kB) out of the root graph, and the effects graph free of score and solver modules. Every cached arrangement was searched again for the new build: 0 stale of 280 public and 124 private configurations. Their fallbacks are exactly the documented ones (DEMO.md's table; the local library's alternating-bass and maestro fallbacks); the local library also falls back on 7- and 8-string guitar and mandolin at some difficulties, which its notes do not cover.

Post effects (`scorify/audio-effects`) are tested for: no change with every effect off; identical samples in any block size and through `applyEffects` and `renderPerformance(…, { effects })`; unity gain for quiet signals and a 0.35–0.42 ceiling for a 0.9 peak under saturation; the first echo within 6 ms of the delay time, each repeat weaker, and repeats ringing on after the delay is switched off; a decaying stereo room (energy at 1.8–2.4 s under 1% of 0.05–0.4 s); no step larger than the signal's own when effects switch on mid-signal; the player worklet with effects equal to `renderPerformance` with them over 257-frame quanta; the effects processor equal to the chain over its input with a live switch, and still producing a tail without input. On a 16-note guitar render, the reverb adds about −11 dB and the delay −10 dB relative to the dry signal. In Chromium, the playground plays through the library's effects worklet without page errors, remembers the switches, and writes the WAV through the same chain.

The print view (checked in Chromium, and as an A4 PDF from headless Chromium) shows the title, a line with credit, instrument, difficulty, tempo, meter and key, the tab at page width with lines kept whole, and every chord chart with grid and dots, static; the page prints light and returns to its theme and layout afterwards. The browser's own print dialog was not driven.

## Cached arrangements, capo suggestions and custom mode, 2026-10-30

`bun run check` passes **187 tests in 14 files**, the type/build checks and packed-package checks. `bun run check:docs` and `node scripts/check-private-docs.mjs` pass in Chromium headless shell 1243.

The playground replays precomputed arrangements: 280 public configurations (every piece × eight instruments × seven difficulties at the piece's tempo, plus Wicked Game's suggested capo 2 at each; 3.1 MB gzipped) and 124 for the local library (5.3 MB, outside `docs/`). A cached attempt is replayed only when the fingerprint of its prepared source, options and scorify build matches what the page would search, and only after `validateFrettedArrangement` accepts the replayed fingering; otherwise it is searched. `precompute-docs.mjs --check` replays every configuration with a search that throws: 0 stale of 280 and 0 of 124, also after a rebuild of the unchanged library. The cached outcomes equal what the page searches, failures included (Greensleeves at baby and beginner remains `infeasible` and `search-exhausted` before its simplified fallback). Measured in headless Chromium: the first song draws 131 ms after load, another cached song about 75 ms, the capo toggle about 1 ms (its other side is prepared in a second worker); the private check now takes 14 s instead of several minutes of searching.

Regression fixtures: the cache key ignores a piece's origin and cache location but separates capo, tempo and custom settings; a log replays without a search for equal inputs, does not apply to another tempo, and a tampered cached fret (one string one fret higher) is rejected by validation and searched again with the same result. The private cache route serves only `cache/index.json` and hex-named `*.json.gz` files inside the cache directory (symlink escapes, encoded traversal and other names give 404).

Capo suggestions are a heuristic over the chord finder's first shape for each chord (open chord 1, other shape 3, barre 4, weighted by duration); a capo is suggested only when it leaves fewer non-open shapes and costs no more. Wicked Game in B minor gets capo 2 (Am, G, D shapes) on all eight instruments; the public Rainbow and Rising Sun get none; Rainbow transposed to E♭ on high-G ukulele gets capo 3 (C, Em, Am, F, G); the local Rainbow gets capo 5 on guitar, drop-D guitar and baritone ukulele for its colour-chord versions. With a capo, the test arrangement of Wicked Game still sounds B minor in bar 1 while every assignment's absolute fret is its capo-relative fret plus 2 and the first chord is fingered `x-0-2-2-1-x`. The suggestion is not a measured ease gain; its arrangement must play like any other, and the toggle is off by default.

The playground opens at amateur, and maestro starts every piece 20% above its tempo (Rainbow 96, Wicked Game 130, Rising Sun 115 BPM, Greensleeves 48). The 40 public and 19 private maestro configurations were precomputed again; the rest stayed fresh. Public maestro outcomes are unchanged: every version plays as written except Wicked Game on high-G ukulele (expert, maestro infeasible). Locally, each song still plays every difficulty's own version on its own instrument (Rainbow on high-G ukulele at 96, Wicked Game on guitar at 114); at maestro, Rainbow on 8-string guitar and Wicked Game on mandolin now play the pro version (Wicked Game on high-G ukulele already did).

(Superseded 2026-10-30: the tempo is now playback only, see below.) A tempo change kept the fingering on show when `validateFrettedArrangement` accepted it at the new tempo, the performance validates, and no harder version failed for a reason a slower tempo could remove. Measured on three songs × three instruments × four difficulties from 30 BPM slower to 25 faster: 411 retimed takes (three seeds each) passed the performance check, 7 tempos were declined, and each declined tempo, searched, played an easier version. Fixtures: a slower tempo keeps notes and assignments, scales the tempo map and attack density and names the searched tempo, also over a chain of changes; the retimed log replays at its tempo; Rainbow's pro fingering on low-G ukulele is declined at 110 BPM, where a search plays an easier version; a request differing in more than the tempo is declined; on a 7-string guitar, expert's fallback to pro is kept at a faster tempo and searched again at a slower one.

Custom mode passes its limits to scorify as player overrides and adaptation permissions and never relaxes them: Rainbow transposed to E♭ with a fret span of 1 reports pro to beginner as infeasible and plays the baby version, saying so. Exported arrangement files (`scorify-arrangement-1`) reopen through the cache path, so their result is validated again.

## Chord charts for the local scores, 2026-10-30

The two local practice songs no longer adapt their editions' piano parts. Each plays a chord chart written for the edition's bars (`*.chart.json`, `scorify-chart-1`) under the imported voice and words: seven strummed versions, fingered in exact mode. `node scripts/check-private-docs.mjs` (Chromium headless shell 1243) checks, on each song's own instrument, that every difficulty plays the version written for it with every note kept (Rainbow on high-G ukulele: 348 to 1,076 notes; Wicked Game on guitar: 486 to 1,868), that the accompaniment is strummed, that every charted bar is played, that every displayed vocal pitch, onset, duration and lyric matches the import (after the documented Wicked Game verse correction), and playback, pause and stop. A Node replica of the page's search with the performance check found every version playing at its own difficulty on high-G, low-G and baritone ukulele and guitar, except Wicked Game's alternating-bass versions on high-G ukulele (expert and maestro: infeasible within the model) and baritone ukulele (expert), which fall back to pro.

Strum-only chart versions count a strum as one stroke through an explicit `maxAttacksPerSecond` override (difficulty rate × strings), reported with every arrangement; scorify's per-string attack model is unchanged. The chord finder now ranks shapes within the fourth fret before shapes with more strings, and passes the chosen shapes to scorify as familiar shapes (except for versions with an alternating bass). Against a baseline of all public songs, levels and eight instruments, every public outcome is unchanged; public voicings changed only to chord-book shapes (guitar A `x02220`, Rising Sun's D `xx0232`, two 8-string shapes), and Wicked Game's maestro ending now gets its strum. New fixtures cover multi-chord bars, held and silent bars, simple charts, chart validation, stroke counting, the vocal correction and chart serving.

The Wicked Game edition's voice part carries three sharps over a piano part without: bars 1–16 match Chris Isaak's B minor melody, a minor third below the D minor piano, while bars 18 onward are in D minor with explicit naturals. The chart's `vocalTranspose` shows bars 1–16 a minor third higher and says so; the imported file and MXL are unchanged.

## Local score integration, 2026-10-29

`bun run check` passes **182 tests in 14 files**, the type/build checks and packed-package checks. `bun run check:docs` passes the public playground regression in Chromium. `node scripts/check-private-docs.mjs` verifies the locally installed voice-and-piano editions of Somewhere Over the Rainbow (40 bars) and Wicked Game (56 bars).

The independent source audit matches all 129/168 vocal notes, their exact pitches/onsets/durations and 10/34 vocal rests. Rainbow retains 127 English and 127 French lyric syllables; Wicked Game retains 131 English syllables. Its octave-clef warning was checked against the official MIDI: all 136 untied vocal attack pitches agree. No vocal transposition or omitted vocal notes were introduced.

At the original tempos and maestro on standard guitar, the bounded adaptive search retains 483/489 and 672/673 accompaniment notes respectively, using 3,092,099 and 1,841,756 expansions. These are approximate results with reported octave shifts/omissions, not exact renditions of the piano parts. Browser checks compare every vocal pitch, onset, duration and lyric lane to the imports, validate the performed accompaniment, exercise play/pause/stop and the advancing clock, check persistence on reload, and inspect mobile/dark layout without page overflow or console errors. Reports and screenshots stay in ignored `work/private-scores/`.

The new regression fixtures cover manifest allowlisting, symlink/traversal exclusion, absence of private-library references from static docs, separate vocal-pitch timing, pickup placement, melismas ending at rests and notated trailing rests. The UI shows pitch names and octaves; it does not render a vocal notation staff or synthesize a singer.

## Implemented and checked

The canonical score/time model, transformations, exact/adaptive fretted solver, all seven player levels, explicit musical-edit candidates, harmonic windows, known-map quantizer, source provenance, independent output replay, async/worker scheduling and source-preserving recomputation session are implemented. V0.2 adds performed-time validation, seeded humanization, strum compilation, persistent plucked-string synthesis, AudioWorklet playback and WAV export. The original research-stage specification is preserved in [DESIGN_V0.md](DESIGN_V0.md).

| Check                          | Result                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript source check | Passed                                                                                                                    |
| Vitest semantic suite          | **148 tests passed**, 10 files                                                                                            |
| pkgroll production build       | ESM, declarations, source maps and third-party notices emitted                                                            |
| Module graph and Node imports  | Every entry resolves; no bare external imports or detected Node-only runtime globals                                      |
| Bun frozen-lockfile install    | Passed                                                                                                                    |
| Actual npm tarball             | 90 files; declarations, runtime entries, chunks and license notices present                                               |
| Public declaration consumer    | Compiles against packed files, including browser Worker/AudioContext compatibility and expected invalid-input type errors |
| Packed runtime behavior        | Exact arrangement, performance compilation, synthesis and WAV succeeded; packed bytes match the local build               |
| Native browser and worker      | Chromium 153.0.8010.0, passed                                                                                             |
| Dynamic level change           | Same 24-note source: expert retains 23 notes; baby retains 16                                                             |
| Local benchmark fixtures       | All successful outputs independently replayed                                                                             |

The packaged byte inspection and declaration/runtime consumer check are automated by `scripts/check-packed.mjs`; its temporary tarball is deleted after checking. No npm publication is performed. The committed CI workflow runs the checks and installs Chromium; it has not been executed on GitHub in this session.

Tested runtime/tool versions: Node 24.22.1, Bun 1.3.9, pkgroll 2.29.0, TypeScript 5.9.3, Vitest 4.0.17 and Playwright 1.62.1. The manifest retains the inspected project convention of Volta Node 24.13.1; that exact patch version was not tested here.

## Semantic and adversarial coverage

- Rational normalization/overflow, tuplets, JSON preservation, pitch spelling and modulation-aware note/key/chord transposition.
- Tempo-map integration/inversion and tempo changes inside finger movement intervals.
- High-G physical order, low-G register, alternate tuning, absolute/relative/per-string capo behavior.
- Six open guitar strings, six-string barre, open-string/barre conflicts, duplicate string occupancy and independent overlapping unisons.
- Held notes that rule out locally attractive positions; contiguous tied fragments without reattacks; fixed barre footprints after partial releases.
- Immediate hand changes that fail; rests or explicit gates that supply release time; geometry-dependent reach and finger-pair limits.
- Strumming across unintended strings and explicit muting capability; no silent unsupported bends or harmonics.
- All level policies, explicit overrides, required chromatic melody, source locks, omission/octave/gate/rhythm provenance, permitted melody skeletons, and explicit rest conflicts.
- Faithful maestro retention even when a long note accumulates ergonomic cost; hard limits cannot be bypassed by scoring hooks.
- Exact DP/exhaustive-reference agreement across small finite cases; unpruned beam agreement; deterministic fixed budgets and honest truncation/cancellation statuses.
- Independent replay detects tampered frets, note identities, attack metadata and missing release boundaries.
- Arpeggiated/ambiguous harmony, actual sounding bass, sparse evidence and supplied intent separated from realized harmony.
- Known-map triplets across bars, tempo changes, simultaneous attacks, repeated-note collisions, intentional voice overlap, positive durations and bounded candidate construction.
- Original-source recomputation, isolated cached results, worker cancellation, superseded requests and stale-response rejection.
- A synthetic non-string adapter exercises the generic contract; this does not claim a shipped keyboard fingering model.

These are original synthetic fixtures. They do not constitute musician calibration, GuitarSet evaluation, physiological validation or a listening study.

## Native-browser evidence

The smoke test serves plain HTML and the emitted module graph over HTTP, without an application bundler or import map. It validates spelling (`C#4 + 3M = E#4`), high-G positions, chord candidates, an exact arrangement in a dedicated module worker, a live expert → baby recomputation, actual AudioContext playback, cancellation/disposal, and AudioWorklet rendering in OfflineAudioContext. The page made 34 observed local requests; no page/request errors or external runtime requests were observed. The demo now includes playback, strum/humanization controls, four original WAV studies and a tested WAV download.

The headless Chromium executable came from the npm-distributed `@sparticuz/chromium` development tool, with GPU rendering disabled in this environment. That executable is not included in the library or ZIP. On a normal machine run `bunx playwright install chromium` followed by `bun run check:browser`. Existing binaries can be supplied using `SCORIFY_CHROMIUM_PATH` and JSON `SCORIFY_CHROMIUM_ARGS`.

Firefox/WebKit, real devices, production CSP configurations and live UNPKG delivery were not tested. Browser Worker scripts should follow the host application's same-origin/module-worker policy; the package does not promise arbitrary cross-origin Worker constructors.

## Audio-specific evidence

- **52 added tests** cover physical down/up order on high-G ukulele, partial/muted strokes, seeded repeatability and stable identity, bounded non-accumulating jitter, ties/locks, tempo maps/concert tuning, per-string tone, safe timing reduction and strict-mode failure.
- Actual-time replay rejects same-string overlaps and insufficient released-finger travel after jitter consumes a nominally adequate gap. It preserves notated duration/trailing rests separately from sounding gates. Malformed/tampered timing, seed, pitch, stroke and contact provenance is rejected.
- Analytical loop-phase tests include damping and fractional-delay phase. Autocorrelation estimates over 24 rate/pitch combinations (44.1/48/96 kHz; about 82–1319 Hz) found **0.277 cents maximum absolute error** on the original sustained-tone fixtures. Unit tests require less than 5 cents over their tested subset. These are not measurements of every register, preset, attack transient or extreme setting.
- Variable block sizes yield identical PCM. Repeated plucks preserve ringing state; fresh seeds alter excitation. Release/muted decay, timbre controls, physical stereo order, finite output and WAV structure are tested.
- Real Chromium worklet output matches the pure renderer **sample for sample** at 44.1 and 48 kHz, including a start at frame 777 inside a render block. Both maximum absolute errors were zero. Real-time analyser output was nonzero; stopping, superseding requests, disposal and the downloadable WAV passed.
- Unit protocols additionally cover stale starts, invalid loads, missed deadlines, fade completion, cancelled resume/preparation, module-load retry, context closure and fatal processor errors. Inputs are snapshotted before async playback setup.
- Four original WAV studies are included in `examples/audio/`; all preserve the source notes, use full requested timing variation when enabled, and have zero clipped samples at default gain. Their metadata is in `examples/audio/RENDERED.json`.

- **Pitch detection.** Pure tones from 41 to 1397 Hz are found within 1 cent; harmonic-rich tones (sawtooth-like, square-like, and a fundamental at a third of the octave's level) at 82–392 Hz within 2 cents, with no octave errors; every open string of guitar and high- and low-G ukulele plucked by scorify's own synth, in tune and 20 cents sharp or 35 cents flat, to the nearest cent. Silence, quiet hiss and white noise give no confident pitch. The worklet posts the same readings as the offline tracker for the same samples. In Chromium, sawtooth tones through `createPitchInput` and the real worklet on an OfflineAudioContext read E2 0, A2 +29.9, G3 −12.1 and E4 −0.3 cents against 0, +30, −12 and 0. The docs check drives the tuner through a synthetic microphone stream. The tracker costs about 26 ms of CPU per second of 48 kHz audio over the default 40–1500 Hz range, 14 ms over a guitar's range and 4 ms over a high-G ukulele's (Node, one host). Recorded instruments, room noise, real microphones and other engines are not measured.

The current DSP input graph is **4,354 gzip bytes**; the worklet graph is **5,591 gzip bytes**. The graph check verifies that root imports do not load audio and that the DSP/worklet does not load score/fingering/search modules. Root graph growth from v0.1 is 45 gzip bytes for the public realization helper, not inclusion of the audio engine.

Ten seconds of synthetic audio in 128-frame blocks took a median **39.78 ms for four strings** and **45.40 ms for six strings** on this Node host (one warmup, three measured runs). Preparation took about 0.60/0.99 ms for 80/120 attacks. These offline CPU numbers do not establish low-latency performance on phones, under competing worklet loads, or on other engines. Full tuning and CPU records: [AUDIO_BENCHMARK.json](AUDIO_BENCHMARK.json). Browser and package evidence: [BROWSER_CHECK.json](BROWSER_CHECK.json), [PACKAGE_CHECK.json](PACKAGE_CHECK.json).

No controlled listening study or physical instrument fitting was performed. Synthetic body modes, decay/brightness controls and random distributions remain hand-chosen approximations. No Firefox/WebKit/device compatibility claim or recorded-guitar realism claim is made. See [AUDIO.md](AUDIO.md) for bounds and unsupported playback/technique features.

## Measured browser transfer size

Each value sums separately gzip-compressed files in an entry's transitive module graph, counting shared files once. It excludes source maps, headers and cache effects. Native browser imports do not perform bundler tree shaking. Reproduce with `bun run check:package`; full records are in [BUNDLE_SIZE.json](BUNDLE_SIZE.json).

| Entry             | Gzip bytes | Modules |
| ----------------- | ---------: | ------: |
| `.`               |     29,511 |      16 |
| `./theory`        |      5,056 |       2 |
| `./fretted`       |      2,850 |       2 |
| `./presets`       |      3,417 |       3 |
| `./model`         |      6,250 |       3 |
| `./transforms`    |      7,382 |       4 |
| `./profiles`      |      2,837 |       2 |
| `./analysis`      |     10,526 |       5 |
| `./quantize`      |      8,142 |       4 |
| `./adapters`      |        107 |       1 |
| `./fingering`     |     10,225 |       5 |
| `./arrange`       |     24,437 |      11 |
| `./worker`        |     25,989 |      12 |
| `./worker-entry`  |     26,244 |      13 |
| `./validate`      |     13,030 |       7 |
| `./performance`   |     18,997 |       9 |
| `./audio`         |     24,414 |      11 |
| `./audio-dsp`     |      4,354 |       2 |
| `./audio-worklet` |      5,591 |       3 |

## Measured search time

Original synthetic study; one warmup and median of three runs on this execution host, Node v24.22.1. Times include arrangement processing and its internal validation. They are not a real-time or worst-case guarantee. Exact/polyphonic search can be exponential and bounded search may miss solutions.

| Fixture                        | Input → output notes | Median ms | Expansion operations | Optimality      |
| ------------------------------ | -------------------: | --------: | -------------------: | --------------- |
| ukulele 8-note exact           |                8 → 8 |    531.12 |               89,133 | proven-in-model |
| ukulele 64-note beam           |              64 → 64 |    200.54 |               30,604 | best-found      |
| guitar 64-note beam            |              64 → 64 |    530.31 |               77,929 | best-found      |
| baby reduction 128 input notes |             128 → 64 |    293.34 |               36,580 | best-found      |

Reproduce with `bun run benchmark`; raw data is [BENCHMARK.json](BENCHMARK.json). Quantization's expansion budget also covers timing-grid/pair construction and compatibility checks, preventing an overly broad tolerance from generating an unbounded candidate product.

## Remaining limits and external gates

- The four-finger contact model, ordinal finger ordering, fixed held-barre footprints, constant string spacing, movement-speed surrogate and simplified muting/picking assumptions are explicit approximations. No model-valid result certifies human comfort.
- Level names and numerical thresholds remain **uncalibrated**. Musician-reviewed fixtures and recognizability/difficulty ratings (research experiment E9) are still needed.
- Harmony is a bass-aware window heuristic. Timing quantization needs supplied tempo, meter and voice hints; it does not infer rubato, swing or meter.
- Rhythmic adaptation delays onsets and lengthens untied note values on a grid; hold changes are separate explicit gates. It does not perform general rhythmic recomposition.
- Advanced techniques, audio transcription, MIDI/MusicXML import/export, generated ornaments, keyboard mechanics and learned scoring remain later scope. V0.2 adds synthesized audio/WAV export, not audio-to-score transcription.
- Whole-result and per-adapter pitch-position caches are implemented. Phrase-local incremental recomputation and reusable structural analysis across worker requests are future optimizations.
- `proven-in-model` describes the finite search objective and mechanics. It does not establish the best possible human fingering outside that model. Scoring hooks must be pure and versioned by the caller.

The owner published `scorify@0.4.0` on npm on 2026-10-31 (the `latest` tag); jsDelivr serves it, and its `index`, `songs`, `theory` and `fingering` modules are byte-identical to this tree's build. The owner published `scorify@0.3.0` on npm and the repository at https://github.com/kyr0/scorify on 2026-10-30. jsDelivr and unpkg serve the package; the import map of the docs' install section, pointing at jsDelivr, arranges a chord and renders it to WAV in Chromium from another origin. The skill lives in `skills/score-import/`; `claude plugin validate .` passes for the repository's marketplace, and the plugin installs with its one skill, `score-import`. From GitHub, `claude plugin install score-import --marketplace kyr0/scorify` (Claude Code 2.1.314, an empty config) installs in 5 s and keeps a 116 MB clone of the repository; adding the marketplace with `--sparse .claude-plugin skills` keeps 1.7 MB. Codex's `install-skill-from-github.py --url …/tree/main/skills/score-import` installs it as `score-import`.
