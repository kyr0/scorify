"""Validate scorify Score JSON with the rules scorify's normalizeScore applies, and describe what is in it."""
from __future__ import annotations

import math
import re
from fractions import Fraction
from typing import Dict, List, Tuple

from .pitch import midi, name, parse_name

ROLES = {"melody", "bass", "harmony", "ornament", "unknown"}
# Lowest open string to 15 frets above the highest open string; strings counted for simultaneous notes.
INSTRUMENTS = {
    "concert ukulele (high G)": (["G4", "C4", "E4", "A4"], 15),
    "concert ukulele (low G)": (["G3", "C4", "E4", "A4"], 15),
    "baritone ukulele": (["D3", "G3", "B3", "E4"], 15),
    "guitar (standard)": (["E2", "A2", "D3", "G3", "B3", "E4"], 15),
    "7-string guitar": (["B1", "E2", "A2", "D3", "G3", "B3", "E4"], 15),
    "8-string guitar": (["F#1", "B1", "E2", "A2", "D3", "G3", "B3", "E4"], 15),
    "mandolin": (["G3", "D4", "A4", "E5"], 15),
}


def _q(value, where: str, errors: List[str]) -> Fraction:
    if (not isinstance(value, list) or len(value) != 2 or not all(isinstance(x, int) and not isinstance(x, bool) for x in value)
            or value[1] == 0 or max(abs(value[0]), abs(value[1])) > 2 ** 53 - 1):
        errors.append(f"{where}: time must be [numerator, denominator] safe integers, got {value!r}")
        return Fraction(0)
    return Fraction(value[0], value[1])


def _json_ok(value, path="$", errors=None) -> List[str]:
    errors = [] if errors is None else errors
    if isinstance(value, float) and not math.isfinite(value):
        errors.append(f"{path}: non-finite number")
    elif isinstance(value, dict):
        for k, v in value.items():
            _json_ok(v, f"{path}.{k}", errors)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _json_ok(v, f"{path}[{i}]", errors)
    elif value is not None and not isinstance(value, (str, int, float, bool)):
        errors.append(f"{path}: not JSON data")
    return errors


def validate(score: dict) -> List[str]:
    """Every rule scorify's validateScore enforces; an empty list means scorify will accept the file."""
    errors = _json_ok(score)
    if not isinstance(score, dict) or score.get("schemaVersion") != 1 or score.get("temperament") != "12-TET" \
            or not isinstance(score.get("concertAHz"), (int, float)) or not score["concertAHz"] > 0:
        return errors + ["header: schemaVersion 1, temperament '12-TET' and a positive concertAHz are required"]
    for key in ("notes", "rests", "parts", "tempoMap", "meterMap", "keyMap", "harmony"):
        if not isinstance(score.get(key), list):
            errors.append(f"missing array: {key}")
    if errors:
        return errors

    def ordered(entries, label):
        last = None
        for i, e in enumerate(entries):
            at = _q(e.get("at"), f"{label}[{i}].at", errors)
            if at < 0 or (last is not None and at <= last):
                errors.append(f"{label}: entries must be strictly ordered from 0")
            last = at
        return entries

    tempo = ordered(score["tempoMap"], "tempoMap")
    if not tempo or _q(tempo[0].get("at"), "tempoMap[0].at", errors) != 0:
        errors.append("tempoMap must begin at 0")
    for t in tempo:
        if not isinstance(t.get("quarterBpm"), (int, float)) or not t["quarterBpm"] > 0:
            errors.append(f"tempoMap: invalid quarterBpm {t.get('quarterBpm')!r}")
    meters = ordered(score["meterMap"], "meterMap")
    if not meters or _q(meters[0].get("at"), "meterMap[0].at", errors) != 0:
        errors.append("meterMap must begin at 0")
    for m in meters:
        n, d = m.get("numerator"), m.get("denominator")
        if not isinstance(n, int) or n < 1 or not isinstance(d, int) or d < 1 or d & (d - 1):
            errors.append(f"meterMap: invalid meter {n}/{d} (denominator must be a power of two)")
        if m.get("grouping") is not None and (not all(isinstance(x, int) and x >= 1 for x in m["grouping"]) or sum(m["grouping"]) != n):
            errors.append("meterMap: grouping must add up to the numerator")
    for k in ordered(score["keyMap"], "keyMap"):
        if not re.fullmatch(r"[A-G](?:#{1,4}|b{1,4})?", str(k.get("tonic"))) or not k.get("mode"):
            errors.append(f"keyMap: invalid key {k.get('tonic')!r} {k.get('mode')!r}")

    voices: Dict[str, set] = {}
    for p in score["parts"]:
        vs = p.get("voices")
        if not p.get("id") or p["id"] in voices or not isinstance(vs, list) or not vs or len(set(vs)) != len(vs) or not all(isinstance(v, str) and v for v in vs):
            errors.append(f"parts: invalid part {p.get('id')!r} (unique id and unique non-empty voices required)")
            continue
        if "writtenToSounding" in p and not re.fullmatch(r"-?\d+(?:P|M|m|A+|d+)", str(p["writtenToSounding"])):
            errors.append(f"parts: {p['id']}: writtenToSounding {p['writtenToSounding']!r} is not an interval such as -8P")
        voices[p["id"]] = set(vs)
    ids = set()
    spans: Dict[str, Tuple[Fraction, Fraction]] = {}
    for kind in ("notes", "rests"):
        for e in score[kind]:
            eid = e.get("id")
            if not isinstance(eid, str) or not eid or eid in ids:
                errors.append(f"{kind}: event ids must be unique non-empty strings ({eid!r})")
            ids.add(eid)
            if e.get("voiceId") not in voices.get(e.get("partId"), set()):
                errors.append(f"{eid}: unknown part/voice {e.get('partId')!r}/{e.get('voiceId')!r}")
            onset, duration = _q(e.get("onset"), f"{eid}.onset", errors), _q(e.get("duration"), f"{eid}.duration", errors)
            if onset < 0 or duration <= 0:
                errors.append(f"{eid}: onset must be >= 0 and duration > 0")
            spans[eid] = (onset, onset + duration)
    ties: Dict[str, List[dict]] = {}
    for n in score["notes"]:
        p = n.get("pitch") or {}
        if p.get("step") not in list("ABCDEFG") or not isinstance(p.get("alter"), int) or not isinstance(p.get("octave"), int):
            errors.append(f"{n.get('id')}: pitch must be {{step: A-G, alter: int, octave: int}}")
        if n.get("role") is not None and n["role"] not in ROLES:
            errors.append(f"{n.get('id')}: role must be one of {sorted(ROLES)}")
        if n.get("importance") is not None and not (isinstance(n["importance"], (int, float)) and 0 <= n["importance"] <= 1):
            errors.append(f"{n.get('id')}: importance must be in [0, 1]")
        if n.get("gateDuration") is not None:
            gate = _q(n["gateDuration"], f"{n.get('id')}.gateDuration", errors)
            if gate <= 0 or gate > spans.get(n.get("id"), (0, 0))[1] - spans.get(n.get("id"), (0, 0))[0]:
                errors.append(f"{n.get('id')}: gateDuration must be positive and at most the duration")
        for field in ("techniques", "sourceIds"):
            if n.get(field) is not None and (not isinstance(n[field], list) or not all(isinstance(x, str) and x for x in n[field])):
                errors.append(f"{n.get('id')}: {field} must be a list of non-empty strings")
        if n.get("locked") is not None and (not isinstance(n["locked"], dict) or not all(isinstance(v, bool) for v in n["locked"].values())):
            errors.append(f"{n.get('id')}: locked must map to booleans")
        if n.get("tieGroupId") is not None:
            ties.setdefault(str(n["tieGroupId"]), []).append(n)
    for group, members in ties.items():
        members.sort(key=lambda n: spans[n["id"]][0])
        for a, b in zip(members, members[1:]):
            if a.get("partId") != b.get("partId") or a.get("voiceId") != b.get("voiceId") or a.get("pitch") != b.get("pitch") \
                    or spans[a["id"]][1] != spans[b["id"]][0] or a.get("gateDuration") is not None:
                errors.append(f"tie {group}: fragments must be contiguous, same part/voice/pitch, without early gates")
    note_ids = {n.get("id") for n in score["notes"]}
    harmony_ids = set()
    for h in score["harmony"]:
        hid = h.get("id")
        onset, end = _q(h.get("onset"), f"{hid}.onset", errors), _q(h.get("end"), f"{hid}.end", errors)
        if not hid or hid in harmony_ids or onset < 0 or end <= onset or h.get("provenance") not in ("provided", "inferred") or not h.get("method"):
            errors.append(f"harmony {hid!r}: unique id, onset < end, provenance provided|inferred and a method are required")
        harmony_ids.add(hid)
        if not isinstance(h.get("candidates"), list) or not all(c.get("symbol") and isinstance(c.get("score"), (int, float)) for c in h["candidates"]):
            errors.append(f"harmony {hid!r}: candidates need a symbol and a numeric score")
        if not isinstance(h.get("evidenceNoteIds"), list) or any(i not in note_ids for i in h["evidenceNoteIds"]):
            errors.append(f"harmony {hid!r}: evidenceNoteIds must name existing notes")
        if h.get("selected") is not None and not h["selected"]:
            errors.append(f"harmony {hid!r}: selected must be non-empty when present")
    by_voice: Dict[Tuple[str, str], List[Tuple[Fraction, Fraction]]] = {}
    for n in score["notes"]:
        by_voice.setdefault((n.get("partId"), n.get("voiceId")), []).append(spans.get(n.get("id"), (0, 0)))
    for r in score["rests"]:
        a, b = spans.get(r.get("id"), (0, 0))
        if any(s < b and a < e for s, e in by_voice.get((r.get("partId"), r.get("voiceId")), [])):
            errors.append(f"rest {r.get('id')}: overlaps a note in its own voice")
    return errors


def seconds(at: Fraction, tempo: List[dict]) -> float:
    total, last_at, last_bpm = 0.0, Fraction(0), None
    for t in tempo:
        t_at = Fraction(*t["at"])
        if t_at >= at:
            break
        if last_bpm is not None:
            total += float(t_at - last_at) * 60 / last_bpm
        last_at, last_bpm = t_at, t["quarterBpm"]
    return total + float(at - last_at) * 60 / (last_bpm or tempo[0]["quarterBpm"])


def report(score: dict) -> dict:
    """A summary an agent can act on: parts, roles, ranges, density, and how it fits common fretted instruments."""
    notes = score["notes"]
    pitch_of = lambda n: (n["pitch"]["step"], n["pitch"]["alter"], n["pitch"]["octave"])
    span = lambda n: (Fraction(*n["onset"]), Fraction(*n["onset"]) + Fraction(*n["duration"]))
    end = max((span(n)[1] for n in notes), default=Fraction(0))
    # Sweep line: a note ending at t frees its string before one starting at t takes it (tie fragments never overlap).
    polyphony, active = 0, 0
    for _, delta in sorted([(span(n)[0], 1) for n in notes] + [(span(n)[1], -1) for n in notes]):
        active += delta
        polyphony = max(polyphony, active)
    parts = []
    for p in score["parts"]:
        mine = [n for n in notes if n["partId"] == p["id"]]
        roles: Dict[str, int] = {}
        for n in mine:
            roles[n.get("role", "unset")] = roles.get(n.get("role", "unset"), 0) + 1
        midis = [midi(pitch_of(n)) for n in mine]
        parts.append({"id": p["id"], "name": p.get("name", ""), "voices": p["voices"], "notes": len(mine), "roles": roles,
                      "range": [name(pitch_of(min(mine, key=lambda n: midi(pitch_of(n))))), name(pitch_of(max(mine, key=lambda n: midi(pitch_of(n)))))] if mine else None,
                      **({"writtenToSounding": p["writtenToSounding"]} if p.get("writtenToSounding") else {})})
    midis = [midi(pitch_of(n)) for n in notes]
    fits = {}
    for label, (tuning, frets) in INSTRUMENTS.items():
        opens = [midi(parse_name(t)) for t in tuning]
        low, high = min(opens), max(opens) + frets
        outside = sum(1 for m in midis if m < low or m > high)
        shifts = {k: sum(1 for m in midis if m + 12 * k < low or m + 12 * k > high) for k in (-2, -1, 0, 1, 2)}
        best = min(shifts, key=lambda k: (shifts[k], abs(k)))
        fits[label] = {"outOfRange": outside, "bestOctaveShift": best, "outOfRangeAfterShift": shifts[best],
                       "tooManyAtOnce": polyphony > len(tuning),
                       "hint": "exact mode can keep every note" if shifts[best] == 0 and polyphony <= len(tuning)
                       else "needs adaptive mode (octave shifts / dropped accompaniment)"}
    notation = score.get("notation") or {}
    return {
        "title": notation.get("title", ""), "composer": notation.get("composer", ""), "source": notation.get("source", {}),
        "notes": len(notes), "rests": len(score["rests"]), "quarters": str(end), "seconds": round(seconds(end, score["tempoMap"]), 2) if notes else 0,
        "range": [name(pitch_of(min(notes, key=lambda n: midi(pitch_of(n))))), name(pitch_of(max(notes, key=lambda n: midi(pitch_of(n)))))] if notes else None,
        "maxSimultaneous": polyphony,
        "meters": [f"{m['numerator']}/{m['denominator']}@{Fraction(*m['at'])}" for m in score["meterMap"]],
        "keys": [f"{k['tonic']} {k['mode']}@{Fraction(*k['at'])}" for k in score["keyMap"]],
        "tempos": [f"{t['quarterBpm']:g}@{Fraction(*t['at'])}" for t in score["tempoMap"]],
        "chordSymbols": sorted({h.get("selected") for h in score["harmony"] if h.get("selected")}),
        "parts": parts, "fits": fits,
        "assumptions": notation.get("assumptions", []), "warnings": notation.get("warnings", []), "dropped": notation.get("dropped", {}),
    }


# scorify's built-in difficulty levels (policy scorify-player-1): string attacks per second and notes at once. A static
# estimate only: fret span, shifts and barres depend on the fingering, which scorify searches.
LEVELS: List[Tuple[str, int, int]] = [("baby", 2, 3), ("beginner", 4, 4), ("amateur", 7, 6), ("semi-pro", 10, 8),
                                      ("pro", 14, 10), ("expert", 20, 12), ("maestro", 32, 16)]
SET_SCHEMA = "scorify-set-1"


def density(score: dict) -> Tuple[int, int]:
    """The most attacks in any one second and the most notes sounding at once, sung parts left out."""
    vocal = set((score.get("notation") or {}).get("vocal", []))
    notes = [n for n in score["notes"] if n["partId"] not in vocal] or score["notes"]
    onsets = sorted(seconds(Fraction(*n["onset"]), score["tempoMap"]) for n in notes)
    attacks, first = 0, 0
    for last, t in enumerate(onsets):
        while onsets[first] <= t - 1 + 1e-9:
            first += 1
        attacks = max(attacks, last - first + 1)
    events = sorted([(Fraction(*n["onset"]), 1) for n in notes] +
                    [(Fraction(*n["onset"]) + Fraction(*n["duration"]), -1) for n in notes])
    active = polyphony = 0
    for _, delta in events:
        active += delta
        polyphony = max(polyphony, active)
    return attacks, polyphony


def estimate_level(score: dict) -> str:
    """The lowest built-in level whose attack rate and polyphony limits the score stays within."""
    attacks, polyphony = density(score)
    return next((name_ for name_, a, p in LEVELS if attacks <= a and polyphony <= p), LEVELS[-1][0])


def validate_set(data: dict) -> List[str]:
    """A score set: several versions of one piece, each tagged with the difficulty it was written for."""
    if data.get("schema") != SET_SCHEMA:
        return [f"schema must be {SET_SCHEMA!r}"]
    variants = data.get("variants")
    if not isinstance(variants, list) or not variants:
        return ["variants must be a non-empty list"]
    errors, ids = [], set()
    for k, v in enumerate(variants):
        where = f"variants[{k}]"
        if not isinstance(v, dict) or not isinstance(v.get("id"), str) or not v["id"] or v["id"] in ids:
            errors.append(f"{where}: a unique, non-empty id is required")
            continue
        ids.add(v["id"])
        if v.get("difficulty") not in [l[0] for l in LEVELS]:
            errors.append(f"{where}: difficulty must be one of {', '.join(l[0] for l in LEVELS)}")
        errors += [f"{where}: {e}" for e in validate(v.get("score") or {})]
    return errors
