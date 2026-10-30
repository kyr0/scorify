"""Spelled pitches, keys and intervals. A pitch is (step, alter, octave); octave 4 holds middle C (MIDI 60)."""
from __future__ import annotations

from typing import Optional, Tuple

STEPS = "CDEFGAB"
SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
Pitch = Tuple[str, int, int]

# Major-key tonics by number of fifths (-7 .. 7), and the tonic's degree in the major scale for each mode.
MAJOR_BY_FIFTHS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"]
MODE_DEGREE = {"major": 0, "ionian": 0, "dorian": 1, "phrygian": 2, "lydian": 3, "mixolydian": 4,
               "minor": 5, "aeolian": 5, "locrian": 6}


def midi(p: Pitch) -> int:
    step, alter, octave = p
    return 12 * (octave + 1) + SEMITONES[step] + alter


def name(p: Pitch) -> str:
    step, alter, octave = p
    return f"{step}{'#' * alter if alter > 0 else 'b' * -alter}{octave}"


def parse_name(text: str) -> Pitch:
    """'F#4' -> ('F', 1, 4)."""
    step, rest = text[0].upper(), text[1:]
    alter = 0
    while rest[:1] in ("#", "b"):
        alter += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    return step, alter, int(rest)


def transpose(p: Pitch, diatonic: int, chromatic: int) -> Pitch:
    """Move by diatonic steps and semitones, keeping the spelling a musician would write."""
    step, alter, octave = p
    index = STEPS.index(step) + 7 * octave + diatonic
    new_step, new_octave = STEPS[index % 7], index // 7
    return new_step, midi(p) + chromatic - midi((new_step, 0, new_octave)), new_octave


def interval_name(diatonic: int, chromatic: int) -> str:
    """A tonal/scorify interval such as '-8P', '2M' or '-3m' for a diatonic/chromatic pair in the same direction."""
    sign = -1 if diatonic < 0 or (diatonic == 0 and chromatic < 0) else 1
    d, c = abs(diatonic), abs(chromatic)
    simple, octaves = d % 7, d // 7
    diff = c - ([0, 2, 4, 5, 7, 9, 11][simple] + 12 * octaves)
    if simple in (0, 3, 4):
        quality = {0: "P", 1: "A", -1: "d", 2: "AA", -2: "dd"}.get(diff)
    else:
        quality = {0: "M", -1: "m", 1: "A", -2: "d", 2: "AA"}.get(diff)
    if quality is None:
        raise ValueError(f"no interval name for {diatonic} steps / {chromatic} semitones")
    return f"{'-' if sign < 0 else ''}{d + 1}{quality}"


def tonic_name(text: str) -> str:
    """Normalize 'f#' / 'Bb' / 'B♭' to scorify's tonic spelling ('F#', 'Bb')."""
    text = text.replace("♯", "#").replace("♭", "b")
    return text[0].upper() + text[1:]


def key_from_fifths(fifths: int, mode: str = "major") -> Tuple[str, str]:
    """(tonic, mode) from a key signature; the tonic sits on the mode's degree of the signature's major scale."""
    mode = (mode or "major").lower()
    if not -7 <= fifths <= 7:
        raise ValueError(f"key signature out of range: {fifths}")
    major = MAJOR_BY_FIFTHS[fifths + 7]
    degree = MODE_DEGREE.get(mode)
    if degree is None:
        return major, mode
    scale = scale_of(major)
    return scale[degree], mode


def scale_of(tonic: str) -> list:
    """The seven spelled pitch classes of a major scale, e.g. scale_of('F') -> ['F', 'G', 'A', 'Bb', 'C', 'D', 'E']."""
    out, start = [], (tonic[0], tonic.count("#") - tonic.count("b"), 4)
    for diatonic, chromatic in zip(range(7), [0, 2, 4, 5, 7, 9, 11]):
        step, alter, _ = transpose(start, diatonic, chromatic)
        out.append(step + ("#" * alter if alter > 0 else "b" * -alter))
    return out


def fifths_of(tonic: str, mode: str) -> Optional[int]:
    """The key signature (number of sharps, negative for flats) of a tonic and mode, or None for an unknown mode."""
    degree = MODE_DEGREE.get(mode.lower())
    if degree is None:
        return None
    for fifths in range(-7, 8):
        if scale_of(MAJOR_BY_FIFTHS[fifths + 7])[degree] == tonic:
            return fifths
    return None


def signature_alters(fifths: int) -> dict:
    """The alteration a key signature gives each step: fifths=2 -> {'F': 1, 'C': 1, ...0}."""
    alters = {s: 0 for s in STEPS}
    for i in range(abs(fifths)):
        alters["FCGDAEB"[i] if fifths > 0 else "BEADGCF"[i]] = 1 if fifths > 0 else -1
    return alters


def spell_midi(number: int, fifths: int = 0) -> Pitch:
    """A spelling for a MIDI number: the key's own scale tones first, then sharps in sharp keys and flats in flat keys."""
    alters = signature_alters(fifths)
    pc, octave = number % 12, number // 12 - 1
    for step in STEPS:
        if (SEMITONES[step] + alters[step]) % 12 == pc:
            return _fix_octave((step, alters[step], octave), number)
    for step in STEPS:
        alter = 1 if fifths >= 0 else -1
        if (SEMITONES[step] + alter) % 12 == pc:
            return _fix_octave((step, alter, octave), number)
    raise ValueError(number)


def _fix_octave(p: Pitch, number: int) -> Pitch:
    step, alter, octave = p
    while midi((step, alter, octave)) > number:
        octave -= 1
    while midi((step, alter, octave)) < number:
        octave += 1
    return step, alter, octave
