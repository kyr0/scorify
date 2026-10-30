# Where to find scores

| site | what | formats |
|---|---|---|
| [abcnotation.com](https://abcnotation.com/) | a search engine over many folk tune collections | ABC |
| [The Session](https://thesession.org/) | Irish and other traditional dance tunes with settings | ABC |
| [Choral Public Domain Library (CPDL)](https://www.cpdl.org/) | choral works | MusicXML, MIDI, PDF; varies by edition |
| [IMSLP](https://imslp.org/) | public-domain scores, mostly scans | mostly PDF via conversion fallback; some MusicXML and MIDI |
| [music21 corpus](https://github.com/cuthbertLab/music21/tree/master/music21/corpus) | Bach chorales, folk songs (Essen), more | MusicXML, ABC, Humdrum (not converted) |

## Finding a specific song and vocal line

The table is a starting point for historical and traditional repertoire, not an exhaustive catalog. For a contemporary song, search its title and artist together with the requested arrangement (`vocal melody`, `piano vocal`, `lead sheet`, `MusicXML`, `MIDI`, `ABC`). Search the web and the source sites; follow promising results to their actual score pages. Publisher catalogs, artist/arranger pages and notation-sharing sites can help identify the edition and available exports. Check actual access and reuse terms rather than treating every public download or every copyrighted title alike.

Confirm whether the result contains singing pitches and rhythms, lyrics, accompaniment, and the complete requested section. “Guitar/vocal” in a catalog may mean only chords and lyrics. A piano melody doubling a vocal line may be usable when verified against the score, but do not automatically relabel the entire piano part as voice. Record the performer/version when arrangements differ.

When a source fails, change the search or source: a PDF-only storefront does not establish that no MusicXML/MIDI edition exists. A missing lyric export does not establish that the vocal melody is missing. After relevant alternatives are exhausted, report the particular remaining blocker rather than returning purchase links as though the score had been imported.

## Practical notes

- Use the site's own search (`visit "https://…search?q=…"`) when useful and read `page.txt`; use web search to find other sources and exact formats. Where a search result links to an info page listing the instrument, source edition and files, download the MusicXML or `.mid` from there and convert it, giving `--pickup` when the piece starts with one.
- Prefer files that encode notation (MusicXML, ABC) over performances. A MIDI file from a notation program is fine; a recorded MIDI needs `--grid` and is approximate.
- Record what you used: the sidecar `FILE.source.json` from `download` and the `notation.source` block of the output carry the URL, retrieval time and SHA-256.
