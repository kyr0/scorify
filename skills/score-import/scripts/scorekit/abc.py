"""ABC notation 2.1 (the common subset used by tune collections) -> Document.

Supported: header fields X T C M L Q K V, inline fields, key signatures with modes, bar-scoped accidentals, octave marks,
lengths, broken rhythm, tuplets, ties, chords, chord symbols, rests (z x Z), repeats and 1st/2nd endings, multiple voices.
Lyrics (w:) are aligned to the notes of the line above them, every verse kept; words after the tune (W:) are kept as
text. Dropped and counted: grace notes, decorations. Not followed: D.C./D.S./coda jumps, transpose=.
"""
from __future__ import annotations

import re
from fractions import Fraction
from typing import Dict, List, Optional, Tuple

from .model import Document, Event, Measure, Part
from .pitch import fifths_of, midi, signature_alters, tonic_name

MODES = {"": "major", "maj": "major", "ion": "major", "m": "minor", "min": "minor", "aeo": "minor", "mix": "mixolydian",
         "dor": "dorian", "phr": "phrygian", "lyd": "lydian", "loc": "locrian"}
CHORD_SYMBOL = re.compile(r"^[A-G][#b]?(?:m|min|maj|dim|aug|sus|add|M|\+|°|ø|\d|\(|\)|b|#|/)*(?:/[A-G][#b]?)?$")

TOKEN = re.compile(r"""
  (?P<field>\[[A-Za-z]:[^\]]*\])
| (?P<quote>"[^"]*")
| (?P<deco>![^!\n]*!|\+[^+\n]*\+)
| (?P<grace>\{[^}]*\})
| (?P<tuplet>\((?P<tp>\d)(?::(?P<tq>\d*))?(?::(?P<tr>\d*))?)
| (?P<bar>:*(?:\[\||\|\]|\|\||\||::)(?::*)(?P<ending>\d+(?:[,-]\d+)*)?)
| (?P<startending>\[(?P<ending2>\d+(?:[,-]\d+)*))
| (?P<chord>\[(?P<inner>[^\]\[]*)\](?P<clen>\d*/*\d*))
| (?P<note>(?P<acc>\^\^|\^|__|_|=)?(?P<letter>[A-Ga-g])(?P<oct>[,']*)(?P<len>\d*/*\d*))
| (?P<rest>(?P<rk>[zx])(?P<rlen>\d*/*\d*))
| (?P<mrest>Z(?P<bars>\d*))
| (?P<tie>-)
| (?P<broken>>+|<+)
| (?P<skip>[\s()`$yHLMOPSTuv.~\\]+)
""", re.VERBOSE)
NOTE = re.compile(r"(?P<acc>\^\^|\^|__|_|=)?(?P<letter>[A-Ga-g])(?P<oct>[,']*)(?P<len>\d*/*\d*)")


def length(text: str) -> Fraction:
    """ABC length suffix: '' 1, '2' 2, '/' 1/2, '//' 1/4, '3/2' 3/2, '3/' 3/2."""
    m = re.fullmatch(r"(\d*)(/*)(\d*)", text or "")
    if not m:
        raise ValueError(f"bad length {text!r}")
    num = int(m.group(1)) if m.group(1) else 1
    if not m.group(2):
        return Fraction(num)
    den = int(m.group(3)) if m.group(3) else 2 ** len(m.group(2))
    return Fraction(num, den)


def split_tunes(text: str) -> List[Tuple[str, str, List[str]]]:
    """(X number, title, lines) for every tune in a file."""
    tunes, current = [], None
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.startswith("X:"):
            current = [line[2:].strip(), "", []]
            tunes.append(current)
        if current is not None:
            if line.startswith("T:") and not current[1]:
                current[1] = line[2:].strip()
            current[2].append(line)
    if not tunes and "K:" in text:
        tunes.append(["1", "", text.split("\n")])
    return [tuple(t) for t in tunes]


class Voice:
    def __init__(self, vid: str, name: str = ""):
        self.id, self.name, self.clef, self.octave = vid, name or vid, "", 0
        self.measures: List[Measure] = []
        self.start_new_measure()
        self.ending: Optional[List[int]] = None
        self.tie_pending: set = set()
        self.last_group: List[Event] = []
        self.group_start = Fraction(0)
        self.broken: Fraction = Fraction(1)
        self.tuplet_left, self.tuplet_factor = 0, Fraction(1)
        self.bar_accidentals: Dict[Tuple[str, int], int] = {}

    def start_new_measure(self, **flags) -> None:
        self.measure = Measure(number=str(len(self.measures) + 1), length=Fraction(0), **flags)
        self.offset = Fraction(0)


class Tune:
    def __init__(self, doc: Document):
        self.doc = doc
        self.line_groups: List[List[Event]] = []
        self.line_verse = 0
        self.meter: Optional[Tuple[int, int]] = None
        self.unit: Optional[Fraction] = None
        self.alters = signature_alters(0)
        self.key: Optional[Tuple[str, str]] = None
        self.voices: Dict[str, Voice] = {}
        self.voice: Optional[Voice] = None
        self.compound = False
        self.pending_tempo: Optional[float] = None

    # ---- fields -------------------------------------------------------------------------------------------------------
    def set_meter(self, value: str) -> None:
        value = value.strip()
        if value in ("C", "C|"):
            value = "4/4" if value == "C" else "2/2"
        m = re.match(r"(\d+(?:\+\d+)*)\s*/\s*(\d+)", value)
        if not m:
            self.meter = None  # "none" or free meter
            return
        num, den = sum(int(x) for x in m.group(1).split("+")), int(m.group(2))
        if den & (den - 1):
            self.doc.warnings.append(f"meter {value} has a denominator that is not a power of two; 4/4 used")
            num, den = 4, 4
        self.meter = (num, den)
        self.compound = num % 3 == 0 and num > 3
        for voice in self.unstarted():
            voice.measure.meter = self.meter

    def unstarted(self) -> List[Voice]:
        """The voices a key or meter field applies to: the current one, and in the header every voice defined there."""
        return [v for v in self.voices.values() if v is self.voice or (self.voice is None and v.offset == 0 and not v.measure.events)]

    def default_unit(self) -> Fraction:
        if self.unit is not None:
            return self.unit
        return Fraction(1, 16) if self.meter and Fraction(*self.meter) < Fraction(3, 4) else Fraction(1, 8)

    def set_tempo(self, value: str) -> None:
        m = re.search(r"((?:\d+/\d+\s*)+)=\s*(\d+(?:\.\d+)?)", value)
        if m:
            beat = sum(Fraction(f) for f in m.group(1).split())
            bpm = float(m.group(2)) * float(beat * 4)
        else:
            m = re.search(r"(\d+(?:\.\d+)?)", value)
            if not m:
                return
            bpm = float(m.group(1)) * float(self.default_unit() * 4)
        if self.voice is None:
            self.pending_tempo = bpm
        else:
            self.voice.measure.tempos.append((self.voice.offset, bpm))

    def set_key(self, value: str) -> None:
        value = value.strip()
        options = dict(re.findall(r"(\w+)=(\S+)", value))
        head = re.sub(r"\w+=\S+", "", value).strip()
        if "octave" in options:
            self.target_voice().octave = int(options["octave"])
        if options.get("clef", "").startswith("bass"):
            self.target_voice().clef = "F"
        if "transpose" in options:
            self.doc.warnings.append(f"transpose={options['transpose']} is a playback instruction and was not applied")
        m = re.match(r"([A-G][#b]?)\s*([A-Za-z]*)", head)
        if not m or head.lower().startswith(("none", "hp")):
            if head and not head.lower().startswith("none") and not re.match(r"(clef|bass|treble|alto|tenor)", head.lower()):
                self.doc.warnings.append(f"key {head!r} not understood; no key signature applied")
            self.alters, self.key = signature_alters(0), None
            return
        tonic, mode_text = tonic_name(m.group(1)), m.group(2).lower()
        mode = MODES.get(mode_text[:3] if mode_text not in ("m",) else "m")
        if mode is None:
            mode = "major"
            self.doc.warnings.append(f"key mode {mode_text!r} not understood; major used")
        fifths = fifths_of(tonic, mode)
        if fifths is None:
            self.doc.warnings.append(f"key {tonic} {mode} has no standard signature; no accidentals applied")
            fifths = 0
        self.alters = signature_alters(fifths)
        self.key = (tonic, mode)
        for voice in self.unstarted():
            voice.measure.key = self.key

    def target_voice(self) -> Voice:
        if self.voice is None:
            self.set_voice(next(iter(self.voices), "1"), define_only=True)
            return self.voices[next(iter(self.voices))]
        return self.voice

    def set_voice(self, value: str, define_only: bool = False) -> None:
        vid = (value.split() or ["1"])[0]
        name = re.search(r'(?:name|nm)="([^"]*)"', value)
        voice = self.voices.get(vid)
        if voice is None:
            voice = self.voices[vid] = Voice(vid, name.group(1) if name else "")
            voice.measure.meter, voice.measure.key = self.meter, self.key
        elif name:
            voice.name = name.group(1)
        if "clef=bass" in value or re.search(r"\bbass\b", value):
            voice.clef = "F"
        m = re.search(r"octave=(-?\d+)", value)
        if m:
            voice.octave = int(m.group(1))
        if not define_only:
            self.voice = voice

    def field(self, letter: str, value: str, in_header: bool) -> None:
        if letter == "T" and not self.doc.title:
            self.doc.title = value.strip()
        elif letter == "C" and not self.doc.composer:
            self.doc.composer = value.strip()
        elif letter == "M":
            self.set_meter(value)
        elif letter == "L":
            self.unit = Fraction(value.strip())
        elif letter == "Q":
            self.set_tempo(value)
        elif letter == "K":
            self.set_key(value)
        elif letter == "V":
            self.set_voice(value, define_only=in_header)
        elif letter == "w":
            self.lyrics(value)
        elif letter == "W":
            if value.strip():
                self.doc.words.append(value.strip())

    # ---- music --------------------------------------------------------------------------------------------------------
    def pitch(self, acc: str, letter: str, marks: str):
        v = self.voice
        step = letter.upper()
        octave = (4 if letter.isupper() else 5) + marks.count("'") - marks.count(",") + v.octave
        if acc:
            alter = {"^^": 2, "^": 1, "__": -2, "_": -1, "=": 0}[acc]
            v.bar_accidentals[(step, octave)] = alter
        else:
            alter = v.bar_accidentals.get((step, octave), self.alters[step])
        return step, alter, octave

    def factor(self) -> Fraction:
        """The duration multiplier the next note or rest gets from a tuplet and a broken rhythm."""
        v = self.voice
        f = v.broken
        v.broken = Fraction(1)
        if v.tuplet_left > 0:
            f *= v.tuplet_factor
            v.tuplet_left -= 1
        return f

    def lyrics(self, text: str) -> None:
        """Align a w: line with the notes of the music line above it: one syllable per note (or chord), "-" splits a
        word ("Or-leans"), "*" and "_" skip a note, "~" joins words, "|" is a bar line. Each further w: line under the
        same music line is the next verse."""
        groups, verse = self.line_groups, self.line_verse
        self.line_verse += 1
        if not groups:
            self.doc.warnings.append(f"lyrics without notes above them: {text.strip()[:40]!r}")
            return
        items: List[Optional[str]] = []
        word = ""
        for ch in text.replace("\\-", "\x00"):
            if ch in " \t|":
                if word:
                    items.append(word)
                word = ""
            elif ch == "-":
                if word:
                    items.append(word + "-")
                word = ""
            elif ch in "*_":
                if word:
                    items.append(word)
                word = ""
                items.append(None)
            elif ch == "~":
                word += " "
            else:
                word += "-" if ch == "\x00" else ch
        if word:
            items.append(word)
        for group, syllable in zip(groups, items):
            if syllable:
                lyrics = group[0].lyrics
                lyrics.extend([None] * (verse + 1 - len(lyrics)))
                lyrics[verse] = syllable

    def place(self, events: List[Event], duration: Fraction) -> None:
        v = self.voice
        if events and events[0].kind == "note":
            self.line_groups.append(events)
        v.group_start = v.offset
        v.last_group = events
        for e in events:
            e.offset = v.offset
            v.measure.events.append(e)
        v.offset += duration

    def note_events(self, specs, outer: Fraction) -> Tuple[List[Event], Fraction]:
        v = self.voice
        f = self.factor()
        events, first = [], None
        for acc, letter, marks, ln in specs:
            duration = self.default_unit() * 4 * length(ln) * outer * f
            first = first if first is not None else duration
            p = self.pitch(acc, letter, marks)
            tie = midi(p) in v.tie_pending
            events.append(Event("note", Fraction(0), duration, "1", pitch=p, tie_stop=tie))
        v.tie_pending = set()
        return events, first or Fraction(0)

    def close_measure(self, bar: str, ending: Optional[str]) -> None:
        v = self.voice
        ends_repeat = bar.startswith(":") or bar == "::"
        starts_repeat = bar.endswith(":") or bar == "::"
        if v.offset > 0 or v.measure.events:
            v.measure.length = v.offset
            if ends_repeat:
                v.measure.end_repeat = 2 if bar == "::" else 1 + max(1, len(bar) - len(bar.lstrip(":")))
            v.measure.endings = v.ending
            v.measures.append(v.measure)
            v.start_new_measure()
            v.measure.meter, v.measure.key = None, None
        elif ends_repeat and v.measures:
            v.measures[-1].end_repeat = 2
        if ends_repeat or bar.strip(":") in ("||", "|]", "[|"):
            v.ending = None
        if starts_repeat:
            v.measure.start_repeat = True
        if ending:
            v.ending = numbers(ending)
        v.bar_accidentals = {}

    def body(self, text: str) -> None:
        pos = 0
        while pos < len(text):
            m = TOKEN.match(text, pos)
            if not m or m.end() == pos:
                self.doc.warnings.append(f"skipped unreadable ABC near {text[pos:pos + 12]!r}")
                self.doc.drop("unreadable characters")
                pos += 1
                continue
            pos = m.end()
            kind = next(k for k in ("field", "quote", "deco", "grace", "tuplet", "bar", "startending", "chord", "note", "rest", "mrest", "tie", "broken", "skip") if m.group(k) is not None)
            if self.voice is None:
                # the first voice the header defined, else a single voice "1"
                self.set_voice(next(iter(self.voices), "1"))
            v = self.voice
            if kind == "field":
                letter, value = m.group("field")[1], m.group("field")[3:-1]
                if letter == "V":
                    self.set_voice(value)
                else:
                    self.field(letter, value, in_header=False)
            elif kind == "quote":
                text_ = m.group("quote")[1:-1].strip()
                if text_ and text_[0] not in "^_<>@" and CHORD_SYMBOL.match(text_.replace("(", "").replace(")", "")):
                    v.measure.harmony.append((v.offset, text_.replace("(", "").replace(")", "")))
            elif kind == "deco":
                self.doc.drop("decorations")
            elif kind == "grace":
                self.doc.drop("grace notes", len(re.findall(r"[A-Ga-g]", m.group("grace"))))
            elif kind == "tuplet":
                p = int(m.group("tp"))
                default_q = {2: 3, 3: 2, 4: 3, 6: 2, 8: 3}.get(p, 3 if self.compound else 2)
                q_ = int(m.group("tq")) if m.group("tq") else default_q
                r = int(m.group("tr")) if m.group("tr") else p
                v.tuplet_left, v.tuplet_factor = r, Fraction(q_, p)
            elif kind == "bar":
                bar = m.group("bar")
                ending = m.group("ending")
                self.close_measure(bar[: len(bar) - len(ending)] if ending else bar, ending)
            elif kind == "startending":
                v.ending = numbers(m.group("ending2"))
            elif kind == "chord":
                specs = [(n.group("acc"), n.group("letter"), n.group("oct"), n.group("len")) for n in NOTE.finditer(m.group("inner"))]
                if specs:
                    events, duration = self.note_events(specs, length(m.group("clen")))
                    self.place(events, duration)
            elif kind == "note":
                events, duration = self.note_events([(m.group("acc"), m.group("letter"), m.group("oct"), m.group("len"))], Fraction(1))
                self.place(events, duration)
            elif kind == "rest":
                duration = self.default_unit() * 4 * length(m.group("rlen")) * self.factor()
                self.place([Event("rest", Fraction(0), duration, "1")], duration)
                v.tie_pending = set()
            elif kind == "mrest":
                bars = int(m.group("bars") or 1)
                meter = self.meter or (4, 4)
                for i in range(bars):
                    full = Fraction(meter[0] * 4, meter[1])
                    self.place([Event("rest", Fraction(0), full, "1")], full)
                    if i < bars - 1:
                        self.close_measure("|", None)
            elif kind == "tie":
                for e in v.last_group:
                    if e.kind == "note":
                        e.tie_start = True
                v.tie_pending = {midi(e.pitch) for e in v.last_group if e.kind == "note"}
            elif kind == "broken":
                sign, n = m.group("broken")[0], len(m.group("broken"))
                longer, shorter = 2 - Fraction(1, 2 ** n), Fraction(1, 2 ** n)
                first, second = (longer, shorter) if sign == ">" else (shorter, longer)
                if v.last_group:
                    old = v.last_group[0].duration
                    for e in v.last_group:
                        e.duration *= first
                    v.offset = v.group_start + old * first
                v.broken = second

    def finish(self) -> List[Part]:
        parts = []
        for index, voice in enumerate(self.voices.values()):
            if voice.offset > 0 or voice.measure.events:
                voice.measure.length = voice.offset
                voice.measure.endings = voice.ending
                voice.measures.append(voice.measure)
            if not voice.measures:
                continue
            if self.pending_tempo and index == 0:
                voice.measures[0].tempos.insert(0, (Fraction(0), self.pending_tempo))
            part_id = f"P{index + 1}" if len(self.voices) > 1 else "P1"
            parts.append(Part(part_id, voice.name if len(self.voices) > 1 else (self.doc.title or "Tune"), voice.measures, clef_sign=voice.clef))
        return parts


def numbers(text: str) -> List[int]:
    out: List[int] = []
    for chunk in text.split(","):
        if "-" in chunk:
            a, b = chunk.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        elif chunk:
            out.append(int(chunk))
    return out


def read_abc(text: str, tune: Optional[str] = None) -> Document:
    """The tune with X number `tune` (default: the first one) as a Document."""
    tunes = split_tunes(text)
    if not tunes:
        raise ValueError("no ABC tune (a K: field) found")
    chosen = next((t for t in tunes if tune is None or t[0] == tune), None)
    if chosen is None:
        raise ValueError(f"no tune X:{tune}; the file has {', '.join(t[0] for t in tunes)}")
    doc = Document(parts=[], format="abc")
    t = Tune(doc)
    if len(tunes) > 1:
        doc.assumptions.append(f"file has {len(tunes)} tunes; converted X:{chosen[0]}")
    in_header = True
    lines = chosen[2]
    joined: List[str] = []
    for line in lines:
        if joined and joined[-1].endswith("\\"):
            joined[-1] = joined[-1][:-1] + " " + line
        else:
            joined.append(line)
    for raw in joined:
        line = re.sub(r"(?<!\\)%.*$", "", raw).rstrip()
        if not line.strip() or raw.startswith("%%"):
            continue
        fm = re.match(r"^([A-Za-z]):(.*)$", line)
        # In the body, A-G at the start of a line are notes ("C:|"), never fields.
        if fm and (in_header or fm.group(1) in "TMLQKVPwWNRSOHZ"):
            letter, value = fm.group(1), fm.group(2)
            t.field(letter, value, in_header)
            if letter == "K" and in_header:
                in_header = False
            continue
        if in_header:
            continue
        # One music line at a time: a w: line below it sings on its notes.
        t.line_groups, t.line_verse = [], 0
        t.body(line + " ")
    if not t.voices:
        raise ValueError("the tune has no notes")
    doc.parts = t.finish()
    if t.meter is None and not any(m.meter for p in doc.parts for m in p.measures):
        doc.assumptions.append("free meter (M:none or missing); bars drawn as 4/4")
    return doc
