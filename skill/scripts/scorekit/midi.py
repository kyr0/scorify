"""Standard MIDI files (format 0 and 1, ticks per quarter) -> Document.

MIDI from notation programs is already exact in ticks, so onsets stay exact fractions of a quarter. A recorded
performance needs `grid` (e.g. 1/4 for sixteenths): onsets and ends snap to it and the largest shift is reported.
MIDI has no pickup bar: pass `pickup` (in quarters) when the first bar is an anacrusis, or every bar line is shifted.
A polyphonic track (two voices on one staff, a piano reduction) is split into lines: the top line is voice 1, the
bottom line voice 2 and inner notes voice 3. Spelling follows the key signature meta event; channel 10 is dropped.
"""
from __future__ import annotations

import struct
from fractions import Fraction
from typing import Dict, List, Optional, Tuple

from .model import Document, Event, Measure, Part
from .pitch import key_from_fifths, spell_midi


def _varlen(data: bytes, i: int) -> Tuple[int, int]:
    value = 0
    while True:
        b = data[i]
        i += 1
        value = (value << 7) | (b & 0x7F)
        if not b & 0x80:
            return value, i


def _chunks(data: bytes):
    i = 0
    while i + 8 <= len(data):
        kind, size = data[i:i + 4], struct.unpack(">I", data[i + 4:i + 8])[0]
        yield kind, data[i + 8:i + 8 + size]
        i += 8 + size


def read_midi(data: bytes, grid: Optional[Fraction] = None, split: bool = True,
              pickup: Optional[Fraction] = None) -> Document:
    if data[:4] != b"MThd":
        raise ValueError("not a standard MIDI file")
    chunks = list(_chunks(data))
    fmt, ntracks, division = struct.unpack(">HHh", chunks[0][1][:6])
    if division < 0:
        raise ValueError("SMPTE-timed MIDI files are not supported; export with ticks per quarter note")
    doc = Document(parts=[], format="midi")
    tempos: List[Tuple[int, float]] = []
    meters: List[Tuple[int, int, int]] = []
    keys: List[Tuple[int, int, int]] = []
    tracks: List[dict] = []
    for kind, body in chunks[1:]:
        if kind != b"MTrk":
            continue
        track = {"name": "", "notes": []}
        tracks.append(track)
        i, tick, status = 0, 0, 0
        open_notes: Dict[Tuple[int, int], List[Tuple[int, int]]] = {}
        while i < len(body):
            delta, i = _varlen(body, i)
            tick += delta
            b = body[i]
            if b == 0xFF:
                meta = body[i + 1]
                length_, j = _varlen(body, i + 2)
                payload = body[j:j + length_]
                i = j + length_
                if meta == 0x51 and length_ == 3:
                    tempos.append((tick, 60_000_000 / int.from_bytes(payload, "big")))
                elif meta == 0x58 and length_ >= 2:
                    meters.append((tick, payload[0], 2 ** payload[1]))
                elif meta == 0x59 and length_ == 2:
                    keys.append((tick, struct.unpack("b", payload[:1])[0], payload[1]))
                elif meta == 0x03 and not track["name"]:
                    track["name"] = payload.decode("latin-1", "replace").strip()
                elif meta == 0x2F:
                    break
                continue
            if b in (0xF0, 0xF7):
                length_, j = _varlen(body, i + 1)
                i = j + length_
                continue
            if b & 0x80:
                status = b
                i += 1
            elif not status:
                raise ValueError("MIDI running status without a status byte")
            kind_, channel = status & 0xF0, status & 0x0F
            size = 1 if kind_ in (0xC0, 0xD0) else 2
            args = body[i:i + size]
            i += size
            if kind_ == 0x90 and args[1] > 0:
                open_notes.setdefault((channel, args[0]), []).append((tick, args[1]))
            elif kind_ == 0x80 or (kind_ == 0x90 and args[1] == 0):
                stack = open_notes.get((channel, args[0]))
                if stack:
                    start, velocity = stack.pop(0)
                    if tick > start:
                        track["notes"].append((start, tick, args[0], channel, velocity))
        unreleased = sum(len(stack) for stack in open_notes.values())
        if unreleased:
            doc.drop("notes never released", unreleased)

    # Format 0 holds every channel in one track: split it by channel so instruments become parts.
    if fmt == 0 and tracks:
        by_channel: Dict[int, dict] = {}
        for n in tracks[0]["notes"]:
            by_channel.setdefault(n[3], {"name": f"Channel {n[3] + 1}", "notes": []})["notes"].append(n)
        tracks = [by_channel[c] for c in sorted(by_channel)]
    drums = sum(1 for t in tracks for n in t["notes"] if n[3] == 9)
    if drums:
        doc.drop("drum notes (channel 10)", drums)
    tracks = [{"name": t["name"], "notes": [n for n in t["notes"] if n[3] != 9]} for t in tracks]
    tracks = [t for t in tracks if t["notes"]]
    if not tracks:
        raise ValueError("the MIDI file has no pitched notes")

    def at(tick: int) -> Fraction:
        return Fraction(tick, division)

    worst = Fraction(0)
    if grid:
        for t in tracks:
            snapped = []
            for start, end, key, channel, velocity in t["notes"]:
                s = round(at(start) / grid) * grid
                e = max(s + grid, round(at(end) / grid) * grid)
                worst = max(worst, abs(s - at(start)), abs(e - at(end)))
                snapped.append((s, e, key, channel, velocity))
            t["notes"] = snapped
        doc.assumptions.append(f"onsets and ends snapped to {grid} quarter; largest shift {worst} quarter")
    else:
        for t in tracks:
            t["notes"] = [(at(s), at(e), k, c, v) for s, e, k, c, v in t["notes"]]

    meters = sorted({m[0]: m for m in meters}.values()) or [(0, 4, 4)]
    if meters[0][0] != 0:
        meters.insert(0, (0, 4, 4))
        doc.assumptions.append("no time signature at the start; 4/4 assumed")
    keys = sorted({k[0]: k for k in keys}.values())
    end = max(n[1] for t in tracks for n in t["notes"])

    # Bars from the time signatures; a note belongs to the bar of its onset and may ring past it.
    bars: List[Tuple[Fraction, Fraction, Optional[Tuple[int, int]]]] = []
    position, mi, previous = Fraction(0), 0, None
    meter_ticks = [(at(m[0]), (m[1], m[2])) for m in meters]
    while position < end or not bars:
        while mi + 1 < len(meter_ticks) and meter_ticks[mi + 1][0] <= position:
            mi += 1
        meter = meter_ticks[mi][1]
        length_ = Fraction(meter[0] * 4, meter[1])
        if not bars and pickup:
            if not 0 < pickup < length_:
                raise ValueError(f"a pickup must be shorter than the first bar ({length_} quarters)")
            length_ = pickup
        if mi + 1 < len(meter_ticks) and position + length_ > meter_ticks[mi + 1][0]:
            length_ = meter_ticks[mi + 1][0] - position
        bars.append((position, length_, meter if meter != previous else None))
        previous, position = meter, position + length_

    def bar_of(x: Fraction) -> int:
        lo = 0
        for index, (start, _, _) in enumerate(bars):
            if start <= x:
                lo = index
            else:
                break
        return lo

    def fifths_at(x: Fraction) -> int:
        current = 0
        for tick, sf, _ in keys:
            if at(tick) <= x:
                current = sf
        return current

    # The lowest-sounding track's salient line is its bottom (the bass); every other track's is its top.
    means = [sum(n[2] for n in t["notes"]) / len(t["notes"]) for t in tracks]
    lowest = means.index(min(means)) if len(tracks) > 1 else -1
    for index, t in enumerate(tracks):
        measures = [Measure(number=str(b + 1), length=bars[b][1], meter=bars[b][2]) for b in range(len(bars))]
        notes = sorted(t["notes"])
        voice_of = _lines(notes, "2" if index == lowest else "1") if split and _polyphonic(notes) else {}
        if voice_of:
            doc.assumptions.append(f"track {index + 1} is polyphonic: split into a top line (voice 1), a bottom line (voice 2) and inner notes (voice 3)")
        for k, (start, stop, key, channel, velocity) in enumerate(notes):
            b = bar_of(start)
            measures[b].events.append(Event("note", start - bars[b][0], stop - start, voice_of.get(k, "1"), pitch=spell_midi(key, fifths_at(start))))
        if index == 0:
            for tick, bpm in tempos:
                b = bar_of(at(tick))
                measures[b].tempos.append((at(tick) - bars[b][0], bpm))
            for tick, sf, minor in keys:
                b = bar_of(at(tick))
                if at(tick) != bars[b][0]:
                    doc.warnings.append(f"key change at {at(tick)} quarters moved to the start of bar {b + 1}")
                measures[b].key = key_from_fifths(sf, "minor" if minor else "major")
        tracks[index]["measures"] = measures
        doc.parts.append(Part(id=f"P{index + 1}", name=t["name"] or f"Track {index + 1}", measures=measures))
    if not tempos:
        doc.assumptions.append("no tempo event; 120 quarter notes per minute assumed (the MIDI default)")
    return doc


def _polyphonic(notes) -> bool:
    """True when a note starts before an earlier one ends (`notes` sorted by onset)."""
    end = None
    for start, stop, *_ in notes:
        if end is not None and start < end:
            return True
        end = stop if end is None else max(end, stop)
    return False


def _lines(notes, salient: str) -> Dict[int, str]:
    """Voice '1' for the top line, '2' for the bottom line, '3' for inner notes.

    Notes starting together go to the top and bottom by pitch, but a note below a still-sounding top note is not top
    (and one above a still-sounding bottom note is not bottom). A lone note when both lines are free (a unison, or
    one line resting) joins the salient line: the top for a melody track, the bottom for the bass track."""
    groups: Dict[Fraction, List[int]] = {}
    for k, n in enumerate(notes):
        groups.setdefault(n[0], []).append(k)
    voice: Dict[int, str] = {}
    last: Dict[str, Optional[int]] = {"1": None, "2": None}

    def free(line: str, k: int, onset: Fraction) -> bool:
        held = last[line]
        if held is None or notes[held][1] <= onset:
            return True
        return notes[k][2] > notes[held][2] if line == "1" else notes[k][2] < notes[held][2]

    for onset in sorted(groups):
        ks = sorted(groups[onset], key=lambda k: notes[k][2])
        if len(ks) == 1:
            k = ks[0]
            lines = [line for line in ("1", "2") if free(line, k, onset)]
            chosen = salient if len(lines) == 2 else lines[0] if lines else "3"
        else:
            chosen = None
        for k in ks:
            if chosen is not None:
                line = chosen
            elif k == ks[-1] and free("1", k, onset):
                line = "1"
            elif k == ks[0] and free("2", k, onset):
                line = "2"
            else:
                line = "3"
            voice[k] = line
            if line != "3":
                last[line] = k
    return voice
