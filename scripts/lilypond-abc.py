#!/usr/bin/env python3
"""Transcribe a part of a LilyPond song file into ABC, with every verse of its words, for the score-import skill.

Written for the files of "Songs from the Public Domain" (github.com/bbloomf/lilypond-songs): a `global` block with the
key and meter, `\\relative` music variables (`sopMusic`, `altoMusic`, ...) and `\\lyricmode` verse variables
(`sopWords`, `sopWordsII`, ...). It reads the subset of LilyPond those files use and stops on anything else, so a
transcription is complete or not made at all:

  python3 scripts/lilypond-abc.py SONG.ly [--music sopMusic] [--words sopWords,sopWordsII] [-o SONG.abc]

Words are placed as LilyPond's \\lyricsto places them: one syllable per note, except that a tied note, the notes after
the first under a slur and, with automatic beaming off, under a manual beam continue a melisma, unless the verse sets
ignoreMelismata; "_" skips a note, "--" joins syllables, "__" (an extender) places nothing. In the ABC every note gets
an item of every verse, "*" where it gets none, so the alignment does not depend on the ABC reader's tie rules. Grace
notes (\\acciaccatura, \\appoggiatura, \\grace) are dropped and counted; pitches keep their spelling.
"""
import argparse
import re
import sys
from fractions import Fraction
from pathlib import Path

STEPS = "cdefgab"
SEMITONES = [0, 2, 4, 5, 7, 9, 11]
# Commands without arguments that change nothing this transcription keeps (layout, dynamics, articulations, spanners).
IGNORED = {
    "slurDashed", "slurSolid", "slurDotted", "tieDashed", "tieSolid", "tieDotted", "dynamicUp", "dynamicDown", "autoBeamOff",
    "autoBeamOn", "break", "noBreak", "pageBreak", "fermata", "p", "pp", "ppp", "mp", "mf", "f", "ff", "fff", "sf", "sfz",
    "fp", "cresc", "decresc", "dim", "accent", "staccato", "tenuto", "marcato", "portato", "!", "<", ">", "voiceOne",
    "voiceTwo", "oneVoice", "stemUp", "stemDown", "stemNeutral", "slurUp", "slurDown", "tieUp", "tieDown", "breathe",
    "dropLyricsIV", "dropLyricsV", "dropLyricsVI", "dropLyricsVII", "dropLyricsVIII", "dropLyricsIX", "dropLyricsX",
    "dropLyricsXI", "dropLyricsXII", "dropLyricsXIII", "dropLyricsXIV", "dropLyricsXV", "raiseLyrics", "dropLyrics",
    "startTextSpan", "stopTextSpan", "arpeggio", "trill", "turn", "prall", "mordent", "segno", "coda", "laissezVibrer",
    "shiftOn", "shiftOff", "teeny", "tiny", "small", "normalsize", "germanChords", "italianChords", "phrasingSlurDashed",
    "phrasingSlurSolid", "hideNotes", "unHideNotes", "cadenzaOn", "cadenzaOff", "textLengthOn", "textLengthOff",
    "espressivo", "upbow", "downbow", "open", "stopped", "flageolet", "thumb", "snappizzicato", "oneVoice",
}


def strip_comments(text: str) -> str:
    text = re.sub(r"%\{.*?%\}", " ", text, flags=re.S)
    out = []
    for line in text.splitlines():
        quoted, cut = False, len(line)
        for i, ch in enumerate(line):
            if ch == '"' and (i == 0 or line[i - 1] != "\\"):
                quoted = not quoted
            elif ch == "%" and not quoted:
                cut = i
                break
        out.append(line[:cut])
    return "\n".join(out)


def block(text: str, start: int) -> tuple:
    """The text inside the braces opening at or after `start`, and the index after the closing brace."""
    i = text.index("{", start)
    depth = 0
    for j in range(i, len(text)):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1:j], j + 1
    raise SystemExit("unbalanced braces")


def variables(text: str) -> dict:
    found = {}
    for m in re.finditer(r"^([A-Za-z]+)\s*=\s*", text, re.M):
        rest = text[m.end():]
        head = re.match(r"(\\relative\s+([a-g](?:is|es|s)*[',]*)\s*|\\lyricmode\s*|)\{", rest)
        if not head:
            continue
        body, _ = block(text, m.end())
        found[m.group(1)] = {"relative": head.group(2), "lyrics": head.group(1).startswith("\\lyricmode"), "body": body}
    return found


def tokens(body: str) -> list:
    return re.findall(r'"(?:[^"\\]|\\.)*"|#"(?:[^"\\]|\\.)*"|\\[A-Za-z]+|\\.|#\'?\(|#\S+|<<|>>|[{}<>()\[\]~|]|[^\s{}<>()\[\]~|"]+', body)


def music_tokens(body: str) -> list:
    """Tokens of music, without the directions and articulations written against notes ('^"rit."', "^\\p", "->", "-.")."""
    body = re.sub(r'[\^_-]"(?:[^"\\]|\\.)*"', " ", body)
    body = re.sub(r"[\^_-]\\[A-Za-z]+", " ", body)
    body = re.sub(r"(?<=[\w',.!?])-[>^._!+\-]|(?<=[\w',.!?])[\^_-]\d", " ", body)
    return tokens(body)


def skip_scheme(toks: list, i: int) -> int:
    """The index after one Scheme value starting at toks[i] ("#'((a . b))", "#'none", "##t", '#"1. "')."""
    if toks[i] in ("#(", "#'("):
        depth, i = 1, i + 1
        while depth and i < len(toks):
            depth += (toks[i] == "(") - (toks[i] == ")")
            i += 1
        return i
    return i + 1


def skip_setting(toks: list, i: int) -> int:
    """The index after `\\set path = value`, `\\override path = value`, `\\unset path` or `\\revert path #'prop`."""
    command = toks[i]
    if command == "\\unset":
        return i + 2
    if command == "\\revert":
        return i + 3
    j = i + 1
    while toks[j] != "=":
        j += 1
        if j - i > 4:
            raise SystemExit(f"cannot read {' '.join(toks[i:i + 5])}")
    return skip_scheme(toks, j + 1) if toks[j + 1].startswith("#") else j + 2


NOTE = re.compile(r"^([a-g])((?:isis|eses|ses|is|es|s)?)([',]*)([!?]?)((?:64|32|16|8|4|2|1)\.*)?(?:\*(\d+)(?:/(\d+))?)?(.*)$")
REST = re.compile(r"^([rsR])((?:64|32|16|8|4|2|1)\.*)?(?:\*(\d+)(?:/(\d+))?)?(.*)$")
DURATION = re.compile(r"^((?:64|32|16|8|4|2|1)\.*)(.*)$")


def length(duration: str) -> Fraction:
    base, dots = re.match(r"(\d+)(\.*)", duration).groups()
    value = Fraction(4, int(base))
    add = value
    for _ in dots:
        add /= 2
        value += add
    return value


def alteration(text: str) -> int:
    if text in ("is", "isis"):
        return len(text) // 2
    if text in ("es", "s"):
        return -1
    if text in ("eses", "ses"):
        return -2
    return 0


class Music:
    """The notes and rests of one `\\relative` variable, with tie, slur and beam marks and the meter it sets."""

    def __init__(self, relative: str, body: str):
        m = NOTE.match(relative)
        self.ref = (STEPS.index(m.group(1)), 3 + m.group(3).count("'") - m.group(3).count(","))  # c = C3, c' = C4
        self.events, self.at, self.duration, self.scale = [], Fraction(0), Fraction(1), Fraction(1)
        self.partial = None
        self.previous = None
        self.dropped = 0
        self.walk(music_tokens(body))

    def pitch(self, step: int, marks: str) -> tuple:
        last_step, last_octave = self.ref
        absolute = last_octave * 7 + last_step
        candidates = [o * 7 + step for o in range(0, 10)]
        best = min(candidates, key=lambda c: abs(c - absolute))
        best += 7 * (marks.count("'") - marks.count(","))
        self.ref = (best % 7, best // 7)
        return best % 7, best // 7

    def add(self, kind: str, duration: Fraction, **info) -> None:
        self.events.append({"kind": kind, "at": self.at, "length": duration, **info})
        self.at += duration

    def walk(self, toks: list) -> None:
        i = 0
        while i < len(toks):
            tok = toks[i]
            if tok in ("{", "}", "|"):
                i += 1
            elif tok == "~":
                self.last_note()["tie"] = True
                i += 1
            elif tok == "(":
                self.last_note()["slurStart"] = True
                i += 1
            elif tok == ")":
                self.last_note()["slurEnd"] = True
                i += 1
            elif tok == "[":
                self.last_note()["beamStart"] = True
                i += 1
            elif tok == "]":
                self.last_note()["beamEnd"] = True
                i += 1
            elif tok in ("\\(", "\\)", "\\!", "\\<", "\\>"):
                i += 1
            elif tok in ("<<", ">>", "<", ">"):
                raise SystemExit(f"chords and simultaneous music are not supported: {tok}")
            elif tok == "\\partial":
                self.partial = length(toks[i + 1])
                i += 2
            elif tok == "\\time":
                n, d = toks[i + 1].split("/")
                self.events.append({"kind": "time", "at": self.at, "meter": (int(n), int(d))})
                i += 2
            elif tok == "\\key":
                self.events.append({"kind": "key", "at": self.at, "tonic": toks[i + 1], "mode": toks[i + 2].lstrip("\\")})
                i += 3
            elif tok == "\\bar":
                i += 2
            elif tok == "\\rest":
                note = self.last_note()
                note["kind"] = "rest"
                i += 1
            elif tok in ("\\times", "\\tuplet"):
                n, d = (int(x) for x in toks[i + 1].split("/"))
                factor = Fraction(n, d) if tok == "\\times" else Fraction(d, n)
                inner, j = self.group(toks, i + 2)
                saved = self.scale
                self.scale *= factor
                self.walk(inner)
                self.scale = saved
                i = j
            elif tok in ("\\acciaccatura", "\\appoggiatura", "\\grace", "\\slashedGrace"):
                if toks[i + 1] == "{":
                    _, j = self.group(toks, i + 1)
                else:
                    j = i + 2
                self.dropped += 1
                saved = (self.ref, self.duration)
                # A grace note still moves the relative octave reference.
                for t in toks[i + 1:j]:
                    m = NOTE.match(t)
                    if m:
                        self.pitch(STEPS.index(m.group(1)), m.group(3))
                self.duration = saved[1]
                i = j
            elif tok in ("\\set", "\\override", "\\unset", "\\revert", "\\once"):
                i = skip_setting(toks, i + 1 if tok == "\\once" else i)
            elif tok == "\\tempo":
                j = i + 1
                if toks[j].startswith('"'):
                    j += 1
                if j < len(toks) and re.match(r"^\d+\.*$", toks[j]):
                    j += 3  # 4 = 90
                i = j
            elif tok == "\\markup":
                i += 2 if toks[i + 1] != "{" else self.group(toks, i + 1)[1] - i
            elif tok.startswith("\\") and tok[1:] in IGNORED or tok == "\\global":  # \global: read once before the music
                i += 1
            elif tok.startswith("^") or tok.startswith("_") or (tok.startswith("-") and len(tok) > 1):
                # A direction or articulation on the note before: "^\p", "->", "-.", '^"rit."'.
                if tok in ("^", "_", "-") and i + 1 < len(toks):
                    i += 1
                i += 1
            elif tok.startswith('"') or tok.startswith("#"):
                i += 1
            else:
                self.atom(tok)
                i += 1

    def group(self, toks: list, i: int) -> tuple:
        if toks[i] != "{":
            raise SystemExit(f"expected {{ at {toks[i]}")
        depth, j = 0, i
        while True:
            depth += toks[j] == "{"
            depth -= toks[j] == "}"
            j += 1
            if depth == 0:
                return toks[i + 1:j - 1], j

    def last_note(self) -> dict:
        for e in reversed(self.events):
            if e["kind"] in ("note", "rest"):
                return e
        raise SystemExit("a mark before any note")

    def atom(self, tok: str) -> None:
        m = NOTE.match(tok)
        if m:
            step, acc, marks, _, dur, num, den, rest = m.groups()
            if dur:
                self.duration = length(dur)
            factor = Fraction(int(num), int(den or 1)) if num else Fraction(1)
            step_index, octave = self.pitch(STEPS.index(step), marks)
            if "\\rest" in rest:
                # A rest written at a pitch; the pitch still moves the relative octave reference.
                self.add("rest", self.duration * factor * self.scale)
                return
            self.previous = {"step": step_index, "octave": octave, "alter": alteration(acc)}
            self.add("note", self.duration * factor * self.scale, **self.previous)
            self.trailing(rest)
            return
        m = DURATION.match(tok)
        if m and self.previous:
            dur, rest = m.groups()
            self.duration = length(dur)
            self.add("note", self.duration * self.scale, **self.previous)
            self.trailing(rest)
            return
        m = REST.match(tok)
        if m:
            kind, dur, num, den, rest = m.groups()
            if dur:
                self.duration = length(dur)
            factor = Fraction(int(num), int(den or 1)) if num else Fraction(1)
            self.add("rest", self.duration * factor * self.scale)
            self.trailing(rest)
            return
        raise SystemExit(f"unsupported LilyPond token {tok!r}")

    def trailing(self, rest: str) -> None:
        """Marks written against the note: "~", "(", ")", "[", "]", articulations "->" "-." and fingerings."""
        for ch in rest:
            if ch == "~":
                self.last_note()["tie"] = True
            elif ch == "(":
                self.last_note()["slurStart"] = True
            elif ch == ")":
                self.last_note()["slurEnd"] = True
            elif ch == "[":
                self.last_note()["beamStart"] = True
            elif ch == "]":
                self.last_note()["beamEnd"] = True


def lyric_items(body: str) -> list:
    """Syllables and commands of a verse in order: ("syllable", text, hyphen), ("skip",), ("ignore", bool)."""
    toks = re.findall(r'"(?:[^"\\]|\\.)*"|#"(?:[^"\\]|\\.)*"|\\[A-Za-z]+|#\'?\(|[{}()]|[^\s{}()"]+', body)
    items, i = [], 0
    while i < len(toks):
        tok = toks[i]
        if tok == "\\set":
            name = toks[i + 1]
            if name.startswith("ignoreMelismata"):
                value = toks[i + 3] if toks[i + 2] == "=" else toks[i + 2].split("=")[-1]
                items.append(("ignore", value == "##t"))
            elif name.startswith("associatedVoice"):
                value = toks[i + 3].strip('"') if toks[i + 2] == "=" else ""
                if value != "sopranos":
                    raise SystemExit(f"words move to another voice ({value}); not supported")
            i = skip_setting(toks, i)
        elif tok == "\\unset":
            if toks[i + 1].startswith("ignoreMelismata"):
                items.append(("ignore", False))
            i += 2
        elif tok in ("\\override", "\\once", "\\revert"):
            i = skip_setting(toks, i + 1 if tok == "\\once" else i)
        elif tok == "\\skip":
            items.append(("skip",))
            i += 2
        elif tok == "\\markup":
            raise SystemExit("\\markup in words is not supported")
        elif tok.startswith("\\") and tok[1:] in IGNORED:
            i += 1
        elif tok.startswith("\\"):
            raise SystemExit(f"unsupported command in words: {tok}")
        elif tok == "--":
            for k in range(len(items) - 1, -1, -1):
                if items[k][0] == "syllable":
                    items[k] = ("syllable", items[k][1], True)
                    break
            i += 1
        elif tok == "__":
            i += 1
        elif tok == "_":
            items.append(("skip",))
            i += 1
        elif tok in ("{", "}", "|"):
            i += 1
        elif tok == "~":
            # An elision between two words written with spaces ("a ~ b"): one note sings both.
            prev = items.pop()
            nxt = toks[i + 1].strip('"')
            items.append(("syllable", prev[1] + "\u203f" + nxt, False))
            i += 2
        else:
            text = tok[1:-1] if tok.startswith('"') else tok
            text = re.sub(r"(?<!\\)_", " ", text).replace("~", "\u203f").replace("\\_", "_")
            items.append(("syllable", text, False))
            i += 1
    return items


def align(notes: list, items: list) -> list:
    """The syllable (or None) of each note, as \\lyricsto places a verse's items."""
    out = [None] * len(notes)
    ignore = False
    k = 0
    for n, note in enumerate(notes):
        busy = note["continues"]
        while k < len(items) and items[k][0] == "ignore":
            ignore = items[k][1]
            k += 1
        if busy and not ignore:
            continue
        if k >= len(items):
            continue
        item = items[k]
        k += 1
        if item[0] == "syllable":
            out[n] = (item[1], item[2])
    while k < len(items) and items[k][0] == "ignore":
        k += 1
    left = [x for x in items[k:] if x[0] == "syllable"]
    if left:
        raise SystemExit(f"{len(left)} syllables left over after the last note: {' '.join(x[1] for x in left[:8])}")
    return out


def melismata(events: list) -> list:
    """The notes, each marked `continues` when a tie, a slur or a manual beam carries the syllable before it on."""
    notes, tie, slur, beam = [], False, False, False
    for e in events:
        if e["kind"] != "note":
            if e["kind"] == "rest":
                tie = False
            continue
        e["continues"] = tie or slur or beam
        tie = bool(e.get("tie"))
        if e.get("slurStart"):
            slur = True
        if e.get("slurEnd"):
            slur = False
        if e.get("beamStart"):
            beam = True
        if e.get("beamEnd"):
            beam = False
        notes.append(e)
    return notes


ABC_KEY = {"major": "", "minor": "m", "dorian": "dor", "mixolydian": "mix", "lydian": "lyd", "phrygian": "phr", "aeolian": "aeo"}


def abc_pitch(note: dict) -> str:
    acc = {-2: "__", -1: "_", 0: "=", 1: "^", 2: "^^"}[note["alter"]]
    letter = STEPS[note["step"]]
    octave = note["octave"]
    if octave >= 5:
        return acc + letter + "'" * (octave - 5)
    return acc + letter.upper() + "," * (4 - octave)


def abc_length(value: Fraction, unit: Fraction) -> str:
    ratio = value / unit
    if ratio == 1:
        return ""
    if ratio.denominator == 1:
        return str(ratio.numerator)
    return f"{ratio.numerator}/{ratio.denominator}" if ratio.numerator != 1 else f"/{ratio.denominator}"


def header_text(text: str, field: str) -> str:
    m = re.search(rf"\b{field}\s*=\s*(.*)", text)
    if not m:
        return ""
    strings = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
    return strings[-1] if strings else ""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("file")
    ap.add_argument("--music", default="sopMusic")
    ap.add_argument("--words", help="verse variables in order (default: sopWords, sopWordsII, ... that have words)")
    ap.add_argument("--tempo", type=int, help="quarter notes a minute (default: the file's \\midi tempo)")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    raw = Path(args.file).read_text(encoding="utf-8-sig")
    text = strip_comments(raw)
    found = variables(text)
    global_body = found.get("global", {}).get("body", "")
    music = Music(found[args.music]["relative"], global_body + "\n" + found[args.music]["body"])
    meters = [e for e in music.events if e["kind"] == "time"]
    keys = [e for e in music.events if e["kind"] == "key"]
    if len({e["meter"] for e in meters}) > 1 or len({(e["tonic"], e["mode"]) for e in keys}) > 1:
        raise SystemExit("meter or key changes are not supported")
    meter = meters[0]["meter"]
    bar = Fraction(meter[0] * 4, meter[1])
    timed = [e for e in music.events if e["kind"] in ("note", "rest")]
    notes = melismata(timed)
    names = [n for n in args.words.split(",") if n] if args.words is not None else sorted(
        (n for n in found if re.fullmatch(r"sopWords(I|II|III|IV|V|VI|VII|VIII)?", n)),
        key=lambda n: ["sopWords", "sopWordsI", "sopWordsII", "sopWordsIII", "sopWordsIV", "sopWordsV", "sopWordsVI", "sopWordsVII", "sopWordsVIII"].index(n))
    verses = []
    for name in names:
        items = lyric_items(found[name]["body"])
        if any(x[0] == "syllable" for x in items):
            verses.append((name, align(notes, items)))
    # A tie (often dashed) that a verse sings across: its notes are struck separately, since one note has one syllable.
    split = 0
    for k, note in enumerate(notes[:-1]):
        if note.get("tie") and any(syllables[k + 1] for _, syllables in verses):
            note["tie"] = False
            split += 1
    # Bars: the pickup, then whole bars; a note may not cross a bar line.
    pickup = music.partial or Fraction(0)
    end = timed[-1]["at"] + timed[-1]["length"]
    lines, current, line_notes, bar_count = [], [], [], 0
    unit = Fraction(1, 4)
    bar_end = pickup if pickup else bar
    music_line, words = [], [[] for _ in verses]
    note_index = {id(n): k for k, n in enumerate(notes)}
    out_lines = []

    def flush():
        if not music_line:
            return
        out_lines.append(" ".join(music_line))
        for v, (name, _) in enumerate(verses):
            out_lines.append("w: " + (" ".join(words[v]) or "*"))
        music_line.clear()
        for w in words:
            w.clear()

    tokens_in_bar = []
    for e in timed:
        if e["at"] + e["length"] > bar_end:
            raise SystemExit(f"a note crosses the bar line at {bar_end} quarters")
        if e["kind"] == "rest":
            tokens_in_bar.append("z" + abc_length(e["length"], unit))
        else:
            tokens_in_bar.append(abc_pitch(e) + abc_length(e["length"], unit) + ("-" if e.get("tie") else ""))
            k = note_index[id(e)]
            for v, (_, syllables) in enumerate(verses):
                s = syllables[k]
                if s is None:
                    words[v].append("*")
                else:
                    syllable = s[0].replace("-", "\\-").replace(" ", "~").replace("*", "").replace("|", "")
                    words[v].append(syllable + ("-" if s[1] else ""))
        if e["at"] + e["length"] == bar_end:
            music_line.append(" ".join(tokens_in_bar) + (" |]" if bar_end >= end else " |"))
            tokens_in_bar = []
            bar_count += 1
            bar_end += bar
            if bar_count % 4 == (1 if pickup else 0) and bar_end - bar < end:
                flush()
    if tokens_in_bar:
        music_line.append(" ".join(tokens_in_bar) + " |]")
    flush()
    tonic = keys[0]["tonic"] if keys else "c"
    m = NOTE.match(tonic)
    key = m.group(1).upper() + {1: "#", -1: "b", 0: ""}[alteration(m.group(2))] + ABC_KEY[keys[0]["mode"] if keys else "major"]
    midi_tempo = re.search(r"\\midi\s*\{[^}]*?\\tempo\s+(\d+)\s*=\s*(\d+)", text, re.S)
    tempo = args.tempo or (int(midi_tempo.group(2)) * Fraction(4, int(midi_tempo.group(1))) if midi_tempo else None)
    title = header_text(text, "title")
    poet, composer = header_text(text, "poet"), header_text(text, "composer")
    header = ["X: 1", f"T: {title}"]
    if composer:
        header.append(f"C: {composer}")
    if poet:
        header.append(f"C: Words: {poet}")
    header += [f"M: {meter[0]}/{meter[1]}", "L: 1/16"]
    if tempo:
        header.append(f"Q: 1/4={int(tempo)}")
    header.append(f"K: {key}")
    abc = "\n".join(header + out_lines) + "\n"
    out = Path(args.output) if args.output else Path(args.file).with_suffix(".abc")
    out.write_text(abc, encoding="utf-8")
    sung = sum(1 for n in notes if any(v[1][note_index[id(n)]] for v in verses))
    print(f"WROTE {out}: {len(notes)} notes, {bar_count} bars{' after a ' + str(pickup) + '-quarter pickup' if pickup else ''}, {len(verses)} verses ({', '.join(n for n, _ in verses)}), {sung} notes with words")
    for name, syllables in verses:
        print(f"VERSE {name}: {sum(1 for s in syllables if s)} syllables")
    if music.dropped:
        print(f"DROPPED {music.dropped} grace notes")
    if split:
        print(f"SPLIT {split} tied notes a verse sings a syllable on are struck separately")
    return 0


if __name__ == "__main__":
    sys.exit(main())
