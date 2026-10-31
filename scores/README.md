# Sources of the playground's public songs

The eight songs below are played on the docs page from `docs/assets/scores/<id>.scorify.json` (the sung tune and every verse of its words, converted with the score-import skill) and `docs/assets/scores/<id>.chart.json` (the chords and the seven versions, written by `charts.mjs`). Each folder here keeps the file as it was downloaded, its `.source.json` sidecar (URL, page, retrieval time, SHA-256, license as the source states it) and the ABC file the skill converted; the converted score's `notation.source` names the same page, file and license, and its `sha256` is the ABC's.

Songs and words are in the public domain. Two transcriptions come from Wikipedia articles and are licensed CC BY-SA 4.0 (Wikipedia contributors): `scarborough-fair` and `happy-birthday`, here and in `docs/assets/scores/`, share that license.

| Song | Source | License of the source | Converted from |
| --- | --- | --- | --- |
| Amazing Grace | [Open Hymnal](http://openhymnal.org/Pdf/Amazing_Grace-New_Britain.pdf), `Amazing_Grace-New_Britain.abc`: John Newton's words (1779), the tune New Britain (1831), E. O. Excell's setting (1900) | public domain | the four-part ABC, verse numbers removed from the syllables; five verses (the two printed after the tune are kept as text) |
| Silent Night | [Open Hymnal](http://openhymnal.org/Pdf/Silent_Night-Stille_Nacht.pdf), `Silent_Night-Stille_Nacht.abc`: Gruber and Mohr (1818), John Freeman Young's English (1863), the setting of *Concordia Kinderchöre* (1908) | public domain | the four-part ABC, verse numbers removed; four verses |
| Auld Lang Syne | [Songs from the Public Domain](https://github.com/bbloomf/lilypond-songs/blob/master/ly/Auld%20Lang%20Syne.ly), `Auld Lang Syne.ly` | public domain (the collection's LICENSE.md) | the soprano line and its four verses with the chorus, by `scripts/lilypond-abc.py` |
| Red River Valley | [Songs from the Public Domain](https://github.com/bbloomf/lilypond-songs/blob/master/ly/Red%20River%20Valley.ly), `Red River Valley.ly` | public domain | the same; the edition prints the first eight bars once with a repeat sign, and the words of each verse's second half are its second and fourth rows |
| Shenandoah | [Songs from the Public Domain](https://github.com/bbloomf/lilypond-songs/blob/master/ly/Shenendoah.ly), `Shenendoah.ly` | public domain | the same; four verses |
| Loch Lomond | [Songs from the Public Domain](https://github.com/bbloomf/lilypond-songs/blob/master/ly/Loch%20Lomond.ly), `Loch Lomond.ly` | public domain | the same; three verses and the chorus. Five dashed ties that a verse sings across are struck as two notes |
| Scarborough Fair | [Wikipedia, "Scarborough Fair (ballad)"](https://en.wikipedia.org/w/index.php?title=Scarborough_Fair_%28ballad%29&oldid=1379343994), the article's third score, "version commonly used today" | CC BY-SA 4.0 | `scarborough-fair.ly`, the score as it is in the article; one verse |
| Happy Birthday to You | [Wikipedia, "Happy Birthday to You"](https://en.wikipedia.org/w/index.php?title=Happy_Birthday_to_You&oldid=1382384043), the article's score | CC BY-SA 4.0 | `happy-birthday.ly`, the score with its music and words named as variables; the fermata and the slower tempo on the name are not kept |

The chords are the editions' own where they have them: read from the four-part settings (Open Hymnal, Songs from the Public Domain) with `charts.mjs`'s choices described in each chart's `chartSource`, from the article's chord line (Scarborough Fair), or the usual ones (Happy Birthday). Tempos are the sources' own, except Auld Lang Syne: the collection gives every song 90, and its tune is written in eighth notes, so 50 plays it at the pace of the usual 4/4 version.

## Rebuilding

```sh
# a LilyPond song (sopMusic and sopWords… variables) → ABC, then the skill's conversion
python3 scripts/lilypond-abc.py "scores/loch-lomond/Loch Lomond.ly" -o scores/loch-lomond/loch-lomond.abc
python3 skills/score-import/scripts/score.py convert scores/loch-lomond/loch-lomond.abc \
  -o docs/assets/scores/loch-lomond.scorify.json --title "Loch Lomond" --composer "Traditional Scottish"
# the charts, after bun run build
node scores/charts.mjs
# then the cache: bun run precompute:docs
```

`scripts/lilypond-abc.py` reads the subset of LilyPond these files use (relative pitches, durations, ties, slurs, manual beams, `\partial`, `\times`, pitched rests, grace notes, which it drops and counts) and places each verse's syllables as LilyPond's `\lyricsto` does, so the ABC gives every note an explicit syllable or `*`. It stops on anything else. For the Wikipedia scores pass `--music` and `--words` with the variable names and `--tempo` with the score's MIDI tempo in quarters a minute.
