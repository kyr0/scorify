"""MusicXML 2-4 (partwise or timewise, plain .musicxml/.xml or compressed .mxl) -> Document.

Pitches become sounding pitches: a part's <transpose> is applied and kept as Part.writtenToSounding. Grace and cue
notes, unpitched percussion and ornament marks are dropped and counted. Lyrics are kept, every verse. A tablature staff
that repeats a notation staff of the same part note for note (staff and tab shown together) is dropped and counted; one
that differs is kept, with a warning.
"""
from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from fractions import Fraction
from typing import Dict, List, Optional, Tuple

from .model import Document, Event, Measure, Part
from .pitch import key_from_fifths, transpose

KINDS = {
    "major": "", "minor": "m", "augmented": "aug", "diminished": "dim", "dominant": "7", "major-seventh": "maj7",
    "minor-seventh": "m7", "diminished-seventh": "dim7", "augmented-seventh": "aug7", "half-diminished": "m7b5",
    "major-minor": "m(maj7)", "major-sixth": "6", "minor-sixth": "m6", "dominant-ninth": "9", "major-ninth": "maj9",
    "minor-ninth": "m9", "dominant-11th": "11", "major-11th": "maj11", "minor-11th": "m11", "dominant-13th": "13",
    "major-13th": "maj13", "minor-13th": "m13", "suspended-second": "sus2", "suspended-fourth": "sus4", "power": "5",
}
UNITS = {"whole": 4, "half": 2, "quarter": 1, "eighth": Fraction(1, 2), "16th": Fraction(1, 4), "32nd": Fraction(1, 8)}


def _lyric(note: ET.Element, doc: Document) -> List[Optional[str]]:
    """A note's syllable in each verse (lyric number 1, 2, …), with a trailing "-" when the word goes on into the next
    note."""
    verses: List[Optional[str]] = []
    for lyric in note.findall("lyric"):
        number = lyric.get("number", "1")
        verse = int(number) - 1 if number.isdigit() and int(number) > 0 else len(verses)
        text = "".join(t.text or "" for t in lyric.findall("text")).strip()
        verses.extend([None] * (verse + 1 - len(verses)))
        verses[verse] = (text + "-" if _text(lyric, "syllabic") in ("begin", "middle") else text) or None
    return verses


def _strip(root: ET.Element) -> ET.Element:
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def load_xml(data: bytes) -> ET.Element:
    """The score element of a .musicxml/.xml file or of the root file an .mxl container names."""
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = z.namelist()
            path = None
            if "META-INF/container.xml" in names:
                container = _strip(ET.fromstring(z.read("META-INF/container.xml")))
                rootfile = container.find(".//rootfile")
                path = rootfile.get("full-path") if rootfile is not None else None
            path = path or next((n for n in names if n.lower().endswith((".musicxml", ".xml")) and not n.startswith("META-INF")), None)
            if not path:
                raise ValueError("the .mxl archive has no MusicXML file")
            data = z.read(path)
    # DOCTYPE declarations are skipped by ElementTree; external entities are never fetched.
    return _strip(ET.fromstring(data))


def _timewise_to_partwise(root: ET.Element) -> ET.Element:
    out = ET.Element("score-partwise")
    for child in root:
        if child.tag != "measure":
            out.append(child)
    parts: Dict[str, ET.Element] = {}
    for measure in root.findall("measure"):
        for part in measure.findall("part"):
            target = parts.setdefault(part.get("id"), ET.SubElement(out, "part", id=part.get("id")))
            m = ET.SubElement(target, "measure", dict(measure.attrib))
            m.extend(list(part))
    return out


def _text(el: Optional[ET.Element], path: str, default: str = "") -> str:
    found = el.find(path) if el is not None else None
    return (found.text or "").strip() if found is not None and found.text else default


def read_musicxml(data: bytes) -> Document:
    root = load_xml(data)
    if root.tag == "score-timewise":
        root = _timewise_to_partwise(root)
    if root.tag != "score-partwise":
        raise ValueError(f"not a MusicXML score (root element <{root.tag}>)")
    doc = Document(parts=[], format="musicxml")
    doc.title = _text(root, "work/work-title") or _text(root, "movement-title")
    composer = root.find("identification/creator[@type='composer']")
    doc.composer = (composer.text or "").strip() if composer is not None and composer.text else ""
    names = {sp.get("id"): _text(sp, "part-name") for sp in root.findall("part-list/score-part")}
    for part_el in root.findall("part"):
        pid = part_el.get("id") or f"P{len(doc.parts) + 1}"
        doc.parts.append(_read_part(part_el, pid, names.get(pid, pid), doc))
    if not doc.parts:
        raise ValueError("the score has no parts")
    # Tablature shows no key signature, so a tab-only score's C major (no sharps or flats) is usually just never set.
    if all(part.clef_sign == "TAB" for part in doc.parts):
        unset = [m for part in doc.parts for m in part.measures if m.key == ("C", "major")]
        for m in unset:
            m.key = None
        if unset:
            doc.warnings.append("tablature only: its unseen key signature (no sharps or flats) is not kept; the key is unknown")
    return doc


def _read_part(part_el: ET.Element, pid: str, name: str, doc: Document) -> Part:
    divisions = 1
    diatonic, chromatic = 0, 0
    part = Part(id=re.sub(r"[^A-Za-z0-9_-]", "", pid) or "P", name=name, measures=[])
    ending: Optional[List[int]] = None
    staff_of: Dict[int, str] = {}  # id(event) -> its staff number
    clefs: Dict[str, str] = {}  # staff number -> first clef sign
    for m_el in part_el.findall("measure"):
        measure = Measure(number=m_el.get("number", str(len(part.measures) + 1)), length=Fraction(0))
        cursor, longest, last_onset = Fraction(0), Fraction(0), Fraction(0)
        for el in m_el:
            tag = el.tag
            if tag == "attributes":
                if el.find("divisions") is not None:
                    divisions = int(float(_text(el, "divisions", "1")))
                key = el.find("key")
                if key is not None and key.find("fifths") is not None:
                    measure.key = key_from_fifths(int(_text(key, "fifths")), _text(key, "mode", "major"))
                time = el.find("time")
                if time is not None and time.find("beats") is not None:
                    beats = sum(int(b) for b in re.split(r"\+", _text(time, "beats")) if b.strip().isdigit())
                    measure.meter = (beats, int(_text(time, "beat-type", "4")))
                for clef in el.findall("clef"):
                    clefs.setdefault(clef.get("number", "1"), _text(clef, "sign"))
                clef = el.find("clef")
                if clef is not None and not part.clef_sign:
                    part.clef_sign = _text(clef, "sign")
                    if _text(clef, "clef-octave-change") and el.find("transpose") is None and not part.transpose:
                        doc.warnings.append(f"part {name}: octave clef without <transpose>; pitches kept as encoded")
                tr = el.find("transpose")
                if tr is not None:
                    octave = int(_text(tr, "octave-change", "0") or 0)
                    diatonic = int(_text(tr, "diatonic", "0") or 0) + 7 * octave
                    chromatic = int(float(_text(tr, "chromatic", "0") or 0)) + 12 * octave
                    part.transpose = (diatonic, chromatic)
            elif tag == "note":
                if el.find("grace") is not None:
                    doc.drop("grace notes")
                    continue
                if el.find("cue") is not None:
                    doc.drop("cue notes")
                    continue
                if el.find("duration") is None:
                    doc.drop("notes without duration")
                    continue
                duration = Fraction(int(float(_text(el, "duration"))), divisions)
                onset = last_onset if el.find("chord") is not None else cursor
                voice = _text(el, "voice", "1")
                lyric = _lyric(el, doc)
                if el.find("notations/ornaments") is not None:
                    doc.drop("ornament marks")
                staff = _text(el, "staff", "1")
                if el.find("rest") is not None:
                    if duration > 0:
                        measure.events.append(Event("rest", onset, duration, voice))
                        staff_of[id(measure.events[-1])] = staff
                elif el.find("unpitched") is not None:
                    doc.drop("unpitched (percussion) notes")
                elif el.find("pitch") is not None and duration > 0:
                    p = el.find("pitch")
                    written = (_text(p, "step"), int(round(float(_text(p, "alter", "0") or 0))), int(_text(p, "octave")))
                    if _text(p, "alter") and float(_text(p, "alter")) % 1:
                        doc.drop("microtonal alterations (rounded)")
                    sounding = transpose(written, diatonic, chromatic) if (diatonic or chromatic) else written
                    ties = {t.get("type") for t in el.findall("tie")} | {t.get("type") for t in el.findall("notations/tied")}
                    measure.events.append(Event("note", onset, duration, voice, pitch=sounding,
                                                tie_start="start" in ties, tie_stop="stop" in ties, lyrics=lyric))
                    staff_of[id(measure.events[-1])] = staff
                if el.find("chord") is None:
                    last_onset = cursor
                    cursor += duration
            elif tag == "backup":
                cursor -= Fraction(int(float(_text(el, "duration", "0"))), divisions)
            elif tag == "forward":
                cursor += Fraction(int(float(_text(el, "duration", "0"))), divisions)
            elif tag in ("direction", "sound"):
                sound = el if tag == "sound" else el.find("sound")
                offset = cursor + Fraction(int(float(_text(el, "offset", "0") or 0)), divisions)
                if sound is not None and sound.get("tempo"):
                    measure.tempos.append((offset, float(sound.get("tempo"))))
                elif tag == "direction":
                    metronome = el.find("direction-type/metronome")
                    if metronome is not None and _text(metronome, "per-minute"):
                        unit = UNITS.get(_text(metronome, "beat-unit"), 1) * (Fraction(3, 2) if metronome.find("beat-unit-dot") is not None else 1)
                        try:
                            measure.tempos.append((offset, float(_text(metronome, "per-minute")) * float(unit)))
                        except ValueError:
                            pass
            elif tag == "harmony":
                symbol = _harmony(el, diatonic, chromatic)
                if symbol:
                    offset = cursor + Fraction(int(float(_text(el, "offset", "0") or 0)), divisions)
                    measure.harmony.append((offset, symbol))
            elif tag == "barline":
                repeat = el.find("repeat")
                if repeat is not None and repeat.get("direction") == "forward":
                    measure.start_repeat = True
                if repeat is not None and repeat.get("direction") == "backward":
                    measure.end_repeat = int(repeat.get("times") or 2)
                end = el.find("ending")
                if end is not None:
                    nums = [int(n) for n in re.findall(r"\d+", end.get("number", ""))]
                    if end.get("type") == "start":
                        ending = nums or [1]
                    measure.endings = ending
                    if end.get("type") in ("stop", "discontinue"):
                        measure.endings = measure.endings or nums
                        ending = None
            longest = max(longest, cursor)
        if ending and measure.endings is None:
            measure.endings = ending
        measure.length = longest
        if m_el.get("implicit") == "yes" and part.measures:
            doc.warnings.append(f"part {name}: implicit measure {measure.number} inside the score")
        part.measures.append(measure)
    _drop_repeated_tablature(part, staff_of, clefs, doc)
    return part


def _drop_repeated_tablature(part: Part, staff_of: Dict[int, str], clefs: Dict[str, str], doc: Document) -> None:
    """Drops the notes and rests of tablature staves that repeat the part's notation staves note for note."""
    tab = {n for n, sign in clefs.items() if sign == "TAB"}
    if not tab or tab == set(clefs):
        return
    def notes(measure: Measure, on_tab: bool):
        return sorted((e.offset, e.duration, e.pitch, e.tie_start, e.tie_stop) for e in measure.events
                      if e.kind == "note" and (staff_of.get(id(e), "1") in tab) == on_tab)
    if any(notes(m, True) != notes(m, False) for m in part.measures):
        doc.warnings.append(f"part {part.name}: a tablature staff differs from the notation staff; both kept")
        return
    count = 0
    for measure in part.measures:
        kept = [e for e in measure.events if staff_of.get(id(e), "1") not in tab]
        count += sum(e.kind == "note" for e in measure.events) - sum(e.kind == "note" for e in kept)
        measure.events = kept
    if count:
        doc.drop("notes on a tablature staff repeating the notation staff", count)


def _harmony(el: ET.Element, diatonic: int, chromatic: int) -> str:
    kind_el = el.find("kind")
    kind = (kind_el.text or "").strip() if kind_el is not None and kind_el.text else ""
    if kind == "none" or el.find("root") is None:
        return ""
    step, alter = _text(el, "root/root-step"), int(round(float(_text(el, "root/root-alter", "0") or 0)))
    root = transpose((step, alter, 4), diatonic, chromatic) if (diatonic or chromatic) else (step, alter, 4)
    suffix = kind_el.get("text") if kind_el is not None and kind_el.get("text") is not None else KINDS.get(kind, "")
    symbol = root[0] + ("#" * root[1] if root[1] > 0 else "b" * -root[1]) + suffix
    if el.find("bass") is not None:
        b = (_text(el, "bass/bass-step"), int(round(float(_text(el, "bass/bass-alter", "0") or 0))), 4)
        b = transpose(b, diatonic, chromatic) if (diatonic or chromatic) else b
        symbol += "/" + b[0] + ("#" * b[1] if b[1] > 0 else "b" * -b[1])
    return symbol
