#!/usr/bin/env python3
"""Counts the chord progressions behind scorify/songs PROGRESSIONS in the McGill Billboard corpus.

The corpus (J. A. Burgoyne, J. Wild and I. Fujinaga, "An Expert Ground Truth Set for Audio Chord Recognition and Music
Analysis", ISMIR 2011, pp. 633-638; annotations under CC0) annotates the chords of 890 Billboard Hot 100 slots, 739 distinct
songs from 1958 to 1991. Download billboard-2.0-salami_chords.tar.gz (md5 6954a6fad962a111e69c9c80cb87d3a5, linked from
https://ddmal.ca/research/The_McGill_Billboard_Project_(Chord_Analysis_Dataset)/), unpack it and run:

    python3 scripts/billboard-progressions.py path/to/McGill-Billboard

Chords are read relative to the annotated tonic (a new "# tonic" line changes it), as roman numerals: lower case for
minor and half-diminished chords, "°" for diminished ones, "b" for lowered degrees; sevenths, inversions and
suspensions count as their triad. Repeated chords are merged. A song counts once per progression: when one of its
phrases (an annotation line) starts with the four chords. The 12-bar blues counts the songs with twelve bars on
I I I I IV IV I I V (IV or V) I (I or V), read from the first chord of each bar. It prints the blues and the
progressions that start on the tonic in at least four songs. Standard library only.
"""
import collections
import os
import re
import sys

NOTES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
DEGREES = {0: "I", 1: "bII", 2: "II", 3: "bIII", 4: "III", 5: "IV", 6: "#IV", 7: "V", 8: "bVI", 9: "VI", 10: "bVII", 11: "VII"}
BLUES = [0, 0, 0, 0, 5, 5, 0, 0, 7, (5, 7), 0, (0, 7)]


def pitch_class(name):
    value = NOTES[name[0]]
    for accidental in name[1:]:
        value += 1 if accidental == "#" else -1 if accidental == "b" else 0
    return value % 12


def numeral(chord, tonic):
    match = re.match(r"([A-G][#b]*):([^/]*)", chord)
    if not match:
        return None
    root, quality = pitch_class(match.group(1)), match.group(2)
    name = DEGREES[(root - tonic) % 12]
    if quality.startswith("min") or quality.startswith("hdim"):
        return name.lower()
    return name.lower() + "°" if quality.startswith("dim") else name


def songs(root):
    """Yields (phrases of numerals, first-chord root of every bar) per distinct song (title and artist)."""
    seen = set()
    for entry in sorted(os.listdir(root)):
        path = os.path.join(root, entry, "salami_chords.txt")
        if not os.path.exists(path):
            continue
        lines = open(path, encoding="utf8", errors="replace").read().splitlines()
        head = dict(re.match(r"# (\w+): ?(.*)", line).groups() for line in lines if re.match(r"# \w+:", line))
        key = (head.get("title", "").strip().lower(), head.get("artist", "").strip().lower())
        if key in seen:
            continue
        seen.add(key)
        tonic, phrases, bars = None, [], []
        for line in lines:
            match = re.match(r"# tonic: ?(\S+)", line)
            if match:
                tonic = pitch_class(match.group(1))
                continue
            if line.startswith("#") or "|" not in line or tonic is None:
                continue
            phrase = []
            for bar in line[line.index("|"):line.rindex("|") + 1].split("|")[1:-1]:
                tokens = [t for t in bar.split() if t != "." and not t.startswith("(")]
                first = re.match(r"([A-G][#b]*):", tokens[0]) if tokens else None
                bars.append((pitch_class(first.group(1)) - tonic) % 12 if first else None)
                for token in tokens:
                    chord = numeral(token, tonic)
                    if chord is None:
                        phrase.append(None)
                    elif not phrase or phrase[-1] != chord:
                        phrase.append(chord)
            phrases.append(phrase)
        yield phrases, bars


def main(root):
    starts, blues, total = collections.Counter(), 0, 0
    for phrases, bars in songs(root):
        total += 1
        starts.update({tuple(p[:4]) for p in phrases if len(p) >= 4 and None not in p[:4] and len(set(p[:4])) >= 3})
        fits = lambda b, w: b in w if isinstance(w, tuple) else b == w
        blues += any(all(fits(b, w) for b, w in zip(bars[i:i + 12], BLUES)) for i in range(len(bars) - 11))
    print(f"{total} distinct songs")
    print(f"{blues:4d}  12-bar blues chorus")
    # Progressions that start on the tonic, as a loop is practised; rotations that start elsewhere are left out.
    for progression, count in starts.most_common():
        if count >= 4 and progression[0] in ("I", "i"):
            print(f"{count:4d}  {' – '.join(progression)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "McGill-Billboard")
