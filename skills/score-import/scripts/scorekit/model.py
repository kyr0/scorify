"""The intermediate model every reader fills, and the writer of scorify Score JSON (docs: references/FORMAT.md).

Time is exact: fractions.Fraction quarter notes, written as [numerator, denominator]. Pitches are sounding pitches.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Callable, Dict, List, Optional, Tuple

from . import VERSION
from .pitch import Pitch, interval_name, midi

ROLES = ("melody", "bass", "harmony", "ornament", "unknown")


@dataclass
class Event:
    """A note or rest inside a measure; offset is measured from the measure start."""
    kind: str  # "note" | "rest"
    offset: Fraction
    duration: Fraction
    voice: str
    pitch: Optional[Pitch] = None
    tie_start: bool = False
    tie_stop: bool = False
    lyrics: List[Optional[str]] = field(default_factory=list)  # the syllable of each verse ("Twin-" goes on into the next note)


@dataclass
class Measure:
    number: str
    length: Fraction
    events: List[Event] = field(default_factory=list)
    start_repeat: bool = False
    end_repeat: int = 0  # how many times the section plays when this measure ends it; 0: no repeat
    endings: Optional[List[int]] = None  # volta numbers this measure belongs to
    meter: Optional[Tuple[int, int]] = None  # a meter that starts here
    key: Optional[Tuple[str, str]] = None
    tempos: List[Tuple[Fraction, float]] = field(default_factory=list)
    harmony: List[Tuple[Fraction, str]] = field(default_factory=list)


@dataclass
class Part:
    id: str
    name: str
    measures: List[Measure]
    transpose: Optional[Tuple[int, int]] = None  # (diatonic, chromatic) written -> sounding, already applied to pitches
    clef_sign: str = ""  # first clef seen ("G", "F", ...), a hint for roles


@dataclass
class Source:
    url: str = ""
    site: str = ""
    retrieved_at: str = ""
    file: str = ""
    sha256: str = ""
    format: str = ""
    # The source's reuse terms as its page states them ("public domain", "CC BY-SA 4.0"), from the download sidecar.
    license: str = ""


@dataclass
class Document:
    """What a reader returns: parts of measures, metadata and everything it had to drop or assume."""
    parts: List[Part]
    title: str = ""
    composer: str = ""
    format: str = ""
    warnings: List[str] = field(default_factory=list)
    assumptions: List[str] = field(default_factory=list)
    dropped: Dict[str, int] = field(default_factory=dict)
    words: List[str] = field(default_factory=list)  # lyrics printed after the tune (ABC W:), not aligned to notes
    vocal: List[str] = field(default_factory=list)  # ids of parts that are sung (set by readers or the CLI)

    def drop(self, what: str, count: int = 1) -> None:
        self.dropped[what] = self.dropped.get(what, 0) + count


def unfold(measures: List[Measure], warnings: List[str]) -> List[Tuple[int, int]]:
    """Playback order of (measure index, pass) through |: :| repeats and 1st/2nd endings. D.C./D.S./coda are not followed."""
    order: List[Tuple[int, int]] = []
    i, start, current, jumped = 0, 0, 1, False
    played: Dict[int, int] = {}
    while i < len(measures):
        if len(order) > 20 * len(measures) + 100:
            warnings.append("repeat structure did not terminate; stopped unfolding")
            break
        m = measures[i]
        if m.start_repeat and not jumped:
            start, current = i, 1
        jumped = False
        if m.endings and current not in m.endings:
            i += 1
            continue
        order.append((i, current))
        if m.end_repeat:
            count = played.get(i, 1)
            if count < m.end_repeat:
                played[i] = count + 1
                current += 1
                i, jumped = start, True
                continue
            played[i] = 1
            current = 1
            start = i + 1
        elif m.endings and (i + 1 >= len(measures) or not measures[i + 1].endings):
            # the last measure of a final ending: the next section starts fresh
            current, start = 1, i + 1
        i += 1
    return order


def _q(x: Fraction) -> List[int]:
    x = Fraction(x)
    return [x.numerator, x.denominator]


def _meter_for(length: Fraction) -> Tuple[int, int]:
    """The smallest x/2^n meter that spans `length` quarters exactly (used for a pickup bar)."""
    den = 4
    while (length * den / 4).denominator != 1 and den < 256:
        den *= 2
    return int(length * den / 4), den


RoleFn = Callable[[str, str, Part], str]
# Part names of a sung part beyond English: German, French, Spanish, Italian, Russian.
SUNG_NAMES = ("gesang", "singstimme", "stimme", "voix", "chant", "voz", "voce", "canto", "голос", "вокал", "сопрано", "тенор")
SUNG = re.compile(r"\b(voice|vocals?|singer|soprano|alto|tenor|melody|" + "|".join(SUNG_NAMES) + r"|альт)\b", re.I)


def default_roles(doc: Document) -> RoleFn:
    """Melody: the first voice of the part named like a melody instrument, else of the first part. Bass: the lowest
    voice of a bass-clef part or a part named like a bass. Everything else: harmony. The CLI can override each."""
    melodic = ("voice", "vocal", "melody", "lead", "soprano", "violin", "flute", "singer", "tenor sax", "trumpet", "oboe") + SUNG_NAMES
    basses = ("bass", "cello", "contrabass", "tuba", "bassoon", "baritone")
    named = [p for p in doc.parts if any(w in p.name.lower() for w in melodic)]
    melody_part = (named or doc.parts)[0].id if doc.parts else ""

    def voices(part: Part) -> List[str]:
        return sorted({e.voice for m in part.measures for e in m.events if e.kind == "note"}, key=_voice_key)

    first_voice = {p.id: (voices(p) or ["1"])[0] for p in doc.parts}
    last_voice = {p.id: (voices(p) or ["1"])[-1] for p in doc.parts}

    def role(part_id: str, voice: str, part: Part) -> str:
        if part_id == melody_part and voice == first_voice[part_id]:
            return "melody"
        if (any(w in part.name.lower() for w in basses) or part.clef_sign == "F") and voice == last_voice[part_id]:
            return "bass"
        return "harmony"
    return role


def _voice_key(v: str):
    return (0, int(v)) if v.isdigit() else (1, v)


def build_score(doc: Document, *, unfold_repeats: bool = True, role: Optional[RoleFn] = None,
                source: Optional[Source] = None, default_tempo: float = 120.0) -> dict:
    """Assemble a scorify Score dict: exact times, unique ids, ties, roles, maps and provenance."""
    if not doc.parts or not doc.parts[0].measures:
        raise ValueError("the score has no measures")
    role = role or default_roles(doc)
    warnings, assumptions = list(doc.warnings), list(doc.assumptions)
    reference = doc.parts[0].measures
    if any(len(p.measures) != len(reference) for p in doc.parts):
        warnings.append("parts have different numbers of measures; timing follows the first part")
    has_repeats = any(m.start_repeat or m.end_repeat or m.endings for m in reference)
    order = unfold(reference, warnings) if unfold_repeats else [(i, 1) for i in range(len(reference))]
    if has_repeats:
        assumptions.append("repeats unfolded into playing order" if unfold_repeats else "repeats kept as written (played once)")

    # Measure starts: every part's measure at index i has the length of the longest one.
    lengths = [max((p.measures[i].length for p in doc.parts if i < len(p.measures)), default=Fraction(0)) for i in range(len(reference))]
    starts, at = [], Fraction(0)
    for index, _ in order:
        starts.append(at)
        at += lengths[index]
    end = at

    notes, rests, harmony_marks = [], [], []
    verses: List[Dict[str, str]] = []
    tempo_map: List[Tuple[Fraction, float]] = []
    meter_map: List[Tuple[Fraction, int, int]] = []
    key_map: List[Tuple[Fraction, str, str]] = []
    pending: Dict[Tuple[str, str, int], dict] = {}
    tie_groups = 0
    current_meter: Optional[Tuple[int, int]] = None
    first_slot: Dict[int, int] = {}
    for slot, (index, _) in enumerate(order):
        first_slot.setdefault(index, slot)
    if not any(m.meter for m in reference):
        assumptions.append("no time signature; 4/4 assumed")
    for slot, (index, _) in enumerate(order):
        start = starts[slot]
        m0 = reference[index]
        if m0.meter:
            current_meter = m0.meter
        meter = current_meter or (4, 4)
        nominal = Fraction(meter[0] * 4, meter[1])
        if slot == 0 and lengths[index] and lengths[index] < nominal:
            meter_map.append((start, *_meter_for(lengths[index])))
            assumptions.append(f"first bar is a {lengths[index]}-quarter pickup, written as its own short meter")
            meter_map.append((start + lengths[index], *meter))
        elif m0.meter or slot == 0:
            meter_map.append((start, *meter))
        if m0.key:
            key_map.append((start, *m0.key))
        for offset, bpm in m0.tempos:
            tempo_map.append((start + offset, bpm))
        for offset, symbol in m0.harmony:
            harmony_marks.append((start + offset, symbol))
        for part in doc.parts:
            if index >= len(part.measures):
                continue
            measure = part.measures[index]
            if part is not doc.parts[0]:
                for offset, symbol in measure.harmony:
                    harmony_marks.append((start + offset, symbol))
                for offset, bpm in measure.tempos:
                    if not any(t[0] == start + offset for t in tempo_map):
                        tempo_map.append((start + offset, bpm))
            for k, e in enumerate(measure.events):
                written = f"{part.id}-m{index + 1}-v{e.voice}-{k + 1}"
                event_id = written if first_slot[index] == slot else f"{written}-x{slot + 1}"
                onset = start + e.offset
                if e.kind == "rest":
                    rests.append({"id": event_id, "onset": onset, "duration": e.duration, "partId": part.id, "voiceId": e.voice})
                    continue
                note = {"id": event_id, "onset": onset, "duration": e.duration, "pitch": e.pitch, "partId": part.id,
                        "voiceId": e.voice, "role": role(part.id, e.voice, part)}
                if event_id != written:
                    note["sourceIds"] = [written]
                if first_slot[index] == slot:
                    for verse, syllable in enumerate(e.lyrics):
                        if syllable:
                            while len(verses) <= verse:
                                verses.append({})
                            verses[verse][event_id] = syllable
                tie_key = (part.id, e.voice, midi(e.pitch))
                previous = pending.pop(tie_key, None)
                if e.tie_stop and previous is not None and previous["onset"] + previous["duration"] == onset:
                    if "tieGroupId" not in previous:
                        tie_groups += 1
                        previous["tieGroupId"] = f"tie-{tie_groups}"
                    note["tieGroupId"] = previous["tieGroupId"]
                elif e.tie_stop and previous is None:
                    warnings.append(f"tie into {written} has no matching start; kept as a separate note")
                if e.tie_start:
                    pending[tie_key] = note
                notes.append(note)
    for note in pending.values():
        if "tieGroupId" not in note:
            warnings.append(f"tie from {note['id']} has no matching end; kept as a separate note")

    # A notated rest may not overlap a note of its own voice (scorify rejects that); drop such rests.
    by_voice: Dict[Tuple[str, str], List[dict]] = {}
    for n in notes:
        by_voice.setdefault((n["partId"], n["voiceId"]), []).append(n)
    kept_rests = [r for r in rests if not any(n["onset"] < r["onset"] + r["duration"] and r["onset"] < n["onset"] + n["duration"]
                                              for n in by_voice.get((r["partId"], r["voiceId"]), []))]
    if len(kept_rests) < len(rests):
        warnings.append(f"{len(rests) - len(kept_rests)} rests overlapped notes of their own voice and were dropped")

    if not tempo_map or tempo_map[0][0] != 0:
        tempo_map.insert(0, (Fraction(0), default_tempo))
        assumptions.append(f"no tempo at the start; {default_tempo:g} quarter notes per minute assumed")

    def dedupe(entries, width):
        out = []
        for e in sorted(entries, key=lambda x: x[0]):
            if out and out[-1][0] == e[0]:
                out[-1] = e
            elif not out or out[-1][1:width] != e[1:width]:
                out.append(e)
        return out

    tempo_map, meter_map, key_map = dedupe(tempo_map, 2), dedupe(meter_map, 3), dedupe(key_map, 3)
    marks: List[Tuple[Fraction, str]] = []
    for mark in sorted(harmony_marks, key=lambda h: h[0]):
        if not marks or marks[-1][0] != mark[0]:
            marks.append(mark)  # one chord symbol per onset: the first part's
    harmony_marks = marks
    harmony = []
    for i, (onset, symbol) in enumerate(harmony_marks):
        span_end = harmony_marks[i + 1][0] if i + 1 < len(harmony_marks) else end
        if span_end <= onset:
            continue
        evidence = [n["id"] for n in notes if n["onset"] < span_end and onset < n["onset"] + n["duration"]]
        harmony.append({"id": f"harmony-{len(harmony) + 1}", "onset": _q(onset), "end": _q(span_end), "selected": symbol,
                        "candidates": [{"symbol": symbol, "score": 1}], "evidenceNoteIds": evidence,
                        "provenance": "provided", "method": f"{doc.format} chord symbol"})

    parts = []
    for part in doc.parts:
        voices = sorted({n["voiceId"] for n in notes if n["partId"] == part.id} | {r["voiceId"] for r in kept_rests if r["partId"] == part.id}, key=_voice_key)
        if not voices:
            continue
        entry = {"id": part.id, "name": part.name or part.id, "voices": voices}
        if part.transpose and part.transpose != (0, 0):
            # scorify stores written -> sounding; the readers already wrote sounding pitches.
            entry["writtenToSounding"] = interval_name(*part.transpose)
        parts.append(entry)

    for n in notes:
        n["onset"], n["duration"] = _q(n["onset"]), _q(n["duration"])
        step, alter, octave = n["pitch"]
        n["pitch"] = {"step": step, "alter": alter, "octave": octave}
    for r in kept_rests:
        r["onset"], r["duration"] = _q(r["onset"]), _q(r["duration"])
    notation = {
        "title": doc.title, "composer": doc.composer,
        "converter": {"name": "score-import skill", "version": VERSION, "input": doc.format},
        "assumptions": assumptions, "warnings": warnings, "dropped": doc.dropped,
    }
    lyrics = verses[0] if verses else {}
    if lyrics:
        notation["lyrics"] = lyrics
    if len(verses) > 1:
        notation["verses"] = verses[1:]
    if doc.words:
        notation["words"] = doc.words
    vocal = [p.id for p in doc.parts if p.id in doc.vocal or any(n["partId"] == p.id and any(n["id"] in v for v in verses) for n in notes)
             or SUNG.search(p.name)]
    if vocal:
        notation["vocal"] = vocal
    if source:
        notation["source"] = {k: v for k, v in {
            "url": source.url, "site": source.site, "retrievedAt": source.retrieved_at, "file": source.file,
            "sha256": source.sha256, "format": source.format or doc.format, "license": source.license}.items() if v}
    return {
        "schemaVersion": 1, "temperament": "12-TET", "concertAHz": 440,
        "notes": sorted(notes, key=lambda n: (Fraction(*n["onset"]), n["id"])),
        "rests": kept_rests,
        "parts": parts,
        "tempoMap": [{"at": _q(a), "quarterBpm": round(b, 6)} for a, b in tempo_map],
        "meterMap": [{"at": _q(a), "numerator": n, "denominator": d} for a, n, d in meter_map],
        "keyMap": [{"at": _q(a), "tonic": t, "mode": md} for a, t, md in key_map],
        "harmony": harmony,
        "notation": notation,
    }


def dumps(score: dict) -> str:
    return json.dumps(score, ensure_ascii=False, indent=1)
