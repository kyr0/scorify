"""scorekit: readers, the Score builder, the validator and CloakBrowser helpers. Run: python3 -m unittest discover -s skills/score-import/tests

The CloakBrowser end-to-end test runs only with SCORE_IMPORT_LIVE=1 (it starts the browser and a local web server).
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile
from fractions import Fraction as F
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
FIXTURES = HERE / "fixtures"
sys.path.insert(0, str(SCRIPTS))

from scorekit.abc import read_abc  # noqa: E402
from scorekit.check import report, validate  # noqa: E402
from scorekit.cloak import binary, wall  # noqa: E402
from scorekit.midi import read_midi  # noqa: E402
from scorekit.model import Source, build_score  # noqa: E402
from scorekit.musicxml import read_musicxml  # noqa: E402
from scorekit.pitch import fifths_of, interval_name, key_from_fifths, spell_midi, transpose  # noqa: E402
from score import cmd_visit  # noqa: E402


def notes(score):
    """(onset, duration, pitch name, tie group) for every note, in time order."""
    out = []
    for n in score["notes"]:
        p = n["pitch"]
        out.append((F(*n["onset"]), F(*n["duration"]), f"{p['step']}{'#' * p['alter'] if p['alter'] > 0 else 'b' * -p['alter']}{p['octave']}", n.get("tieGroupId")))
    return out


def varlen(value: int) -> bytes:
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.insert(0, 0x80 | (value & 0x7F))
        value >>= 7
    return bytes(out)


def make_midi(jitter: int = 0) -> bytes:
    """Format 1, 480 ticks per quarter: a conductor track (100 BPM, 3/4, G major), a melody and a bass track."""
    def track(events):
        body, last = b"", 0
        for tick, data in sorted(events, key=lambda e: e[0]):
            body += varlen(tick - last) + data
            last = tick
        body += b"\x00\xff\x2f\x00"
        return b"MTrk" + struct.pack(">I", len(body)) + body
    conductor = [(0, b"\xff\x51\x03" + (600000).to_bytes(3, "big")), (0, b"\xff\x58\x04\x03\x02\x18\x08"), (0, b"\xff\x59\x02\x01\x00")]
    melody, bass = [(0, b"\xff\x03\x05Flute")], [(0, b"\xff\x03\x04Bass")]
    for i, key in enumerate([67, 66, 69, 71, 72, 74]):  # G4 F#4 A4 B4 C5 D5 in quarters
        start = i * 480 + (jitter if i % 2 else -jitter if i else 0)
        melody += [(start, bytes([0x90, key, 90])), (start + 470, bytes([0x80, key, 0]))]
    bass += [(0, bytes([0x91, 43, 80])), (1440, bytes([0x91, 43, 0])), (1440, bytes([0x91, 38, 80])), (2880, bytes([0x81, 38, 0]))]
    bass += [(960, bytes([0x99, 36, 100])), (1000, bytes([0x89, 36, 0]))]  # a drum hit: dropped
    return b"MThd" + struct.pack(">IHHh", 6, 1, 3, 480) + track(conductor) + track(melody) + track(bass)


def make_chorale() -> bytes:
    """Format 1, 480 ticks: 6/8 with an eighth-note pickup; two staves of two voices each, as notation programs export
    four-part harmony. The alto moves under a held soprano; each staff ends on a single (unison) note."""
    def track(events):
        body, last = b"", 0
        for tick, data in sorted(events, key=lambda e: (e[0], e[1][0] & 0xF0 == 0x90)):
            body += varlen(tick - last) + data
            last = tick
        return b"MTrk" + struct.pack(">I", len(body) + 4) + body + b"\x00\xff\x2f\x00"

    def play(channel, start, length, key):
        return [(start, bytes([0x90 | channel, key, 80])), (start + length, bytes([0x80 | channel, key, 0]))]
    conductor = [(0, b"\xff\x51\x03" + (1000000).to_bytes(3, "big")), (0, b"\xff\x58\x04\x06\x03\x18\x08")]
    upper = [(0, b"\xff\x03\x05upper")] + play(0, 0, 240, 64) + play(0, 0, 240, 59) + play(0, 240, 480, 67) + \
        play(0, 240, 240, 64) + play(0, 480, 240, 62) + play(0, 720, 240, 62)
    lower = [(0, b"\xff\x03\x05lower")] + play(1, 0, 240, 55) + play(1, 0, 240, 52) + play(1, 240, 480, 59) + \
        play(1, 240, 480, 52) + play(1, 720, 240, 50)
    return b"MThd" + struct.pack(">IHHh", 6, 1, 3, 480) + track(conductor) + track(upper) + track(lower)


class PitchTest(unittest.TestCase):
    def test_spelling_and_intervals(self):
        self.assertEqual(interval_name(-7, -12), "-8P")
        self.assertEqual(interval_name(-1, -2), "-2M")
        self.assertEqual(interval_name(2, 3), "3m")
        self.assertEqual(transpose(("B", -1, 4), -1, -2), ("A", -1, 4))  # written Bb4 for a Bb clarinet sounds Ab4
        self.assertEqual(transpose(("E", 0, 3), -7, -12), ("E", 0, 2))
        self.assertEqual(key_from_fifths(-1, "minor"), ("D", "minor"))
        self.assertEqual(key_from_fifths(1, "dorian"), ("A", "dorian"))
        self.assertEqual(fifths_of("A", "dorian"), 1)
        self.assertEqual(fifths_of("Bb", "major"), -2)
        self.assertEqual(spell_midi(66, 1), ("F", 1, 4))
        self.assertEqual(spell_midi(70, -2), ("B", -1, 4))
        self.assertEqual(spell_midi(59, -7), ("C", -1, 4))  # Cb major spells B as Cb


class AbcTest(unittest.TestCase):
    def setUp(self):
        self.text = (FIXTURES / "reel.abc").read_text()

    def test_exact_time_repeats_and_endings(self):
        score = build_score(read_abc(self.text))
        self.assertEqual(validate(score), [])
        got = notes(score)
        self.assertEqual(got[:2], [(F(0), F(1, 2), "F#4", None), (F(1, 2), F(1, 2), "A4", None)])  # pickup in D major
        self.assertEqual([g[:3] for g in got[7:10]], [(F(5), F(1, 3), "A4"), (F(16, 3), F(1, 3), "B4"), (F(17, 3), F(1, 3), "A4")])  # (3 triplet
        self.assertEqual([g[:3] for g in got[10:12]], [(F(6), F(3, 4), "F#4"), (F(27, 4), F(1, 4), "E4")])  # F>E
        self.assertEqual(got[12][3], got[13][3])  # D2-D2 is one tie group
        self.assertEqual([g[2] for g in got[14:17]], ["F4", "F4", "F4"])  # =F holds to the bar line
        self.assertEqual(got[19][2], "F#4")  # ... and not beyond it
        self.assertEqual([g[:3] for g in got[-2:]], [(F(29), F(2), "D5"), (F(31), F(2), "D5")])  # 2nd ending after the repeat
        self.assertEqual(len(got), 39)
        self.assertEqual(score["meterMap"], [{"at": [0, 1], "numerator": 1, "denominator": 4}, {"at": [1, 1], "numerator": 4, "denominator": 4}])
        self.assertEqual(score["tempoMap"], [{"at": [0, 1], "quarterBpm": 96.0}])
        self.assertEqual(score["keyMap"], [{"at": [0, 1], "tonic": "D", "mode": "major"}])
        self.assertEqual([h["selected"] for h in score["harmony"]][:6], ["D", "G", "A", "Bm", "A7", "G"])
        repeated = [n for n in score["notes"] if n.get("sourceIds")]
        self.assertTrue(repeated and all(s in {n["id"] for n in score["notes"]} for n in repeated for s in n["sourceIds"]))

    def test_written_repeats_and_second_tune(self):
        self.assertEqual(len(build_score(read_abc(self.text), unfold_repeats=False)["notes"]), 23)
        second = build_score(read_abc(self.text, tune="2"))
        self.assertEqual(second["keyMap"][0], {"at": [0, 1], "tonic": "A", "mode": "dorian"})
        self.assertEqual(second["meterMap"][0]["numerator"], 6)
        self.assertEqual(notes(second)[1][:3], (F(1, 2), F(1, 2), "A4"))


    def test_lyrics_align_to_the_line_above(self):
        score = build_score(read_abc("X:1\nT:Song\nM:3/4\nL:1/4\nK:C\nC D E|F2-F|\nw:Twin-kle lit-* tle\nw:Sec-ond verse * here\nW:Words after the tune\n"))
        self.assertEqual(validate(score), [])
        sung = [(n["pitch"]["step"], score["notation"]["lyrics"].get(n["id"])) for n in score["notes"]]
        self.assertEqual(sung, [("C", "Twin-"), ("D", "kle"), ("E", "lit-"), ("F", None), ("F", "tle")])
        self.assertEqual(score["notation"]["vocal"], ["P1"])
        self.assertEqual(score["notation"]["words"], ["Words after the tune"])
        second = [score["notation"]["verses"][0].get(n["id"]) for n in score["notes"]]
        self.assertEqual(second, ["Sec-", "ond", "verse", None, "here"])
        self.assertEqual(score["notation"]["dropped"], {})

    def test_header_key_applies_to_voices_defined_before_it(self):
        # Hymnals declare their voices first: V: lines, then K:. The key and its signature reach every voice.
        score = build_score(read_abc("X:1\nM:3/4\nL:1/4\nV:S clef=treble\nV:B clef=bass\nK:G % key signature\n[V:S] F G A|\n[V:B] G,, D, G,|\n"))
        self.assertEqual(validate(score), [])
        self.assertEqual(score["keyMap"], [{"at": [0, 1], "tonic": "G", "mode": "major"}])
        self.assertEqual(score["meterMap"], [{"at": [0, 1], "numerator": 3, "denominator": 4}])
        self.assertEqual([n["pitch"]["alter"] for n in score["notes"] if n["pitch"]["step"] == "F"], [1])


class MusicXmlTest(unittest.TestCase):
    def setUp(self):
        self.data = (FIXTURES / "duet.musicxml").read_bytes()

    def check(self, score):
        self.assertEqual(validate(score), [])
        parts = {p["id"]: p for p in score["parts"]}
        self.assertEqual(parts["P2"]["writtenToSounding"], "-8P")
        self.assertEqual(parts["P2"]["voices"], ["1", "2"])
        guitar = [(F(*n["onset"]), n["voiceId"], n["pitch"]["step"], n["pitch"]["octave"]) for n in score["notes"] if n["partId"] == "P2"]
        self.assertIn((F(0), "1", "G", 2), guitar)  # written G3 sounds G2
        self.assertIn((F(0), "1", "D", 3), guitar)  # <chord/> shares the onset
        self.assertIn((F(0), "2", "G", 2), guitar)  # <backup> starts voice 2 at the bar line
        flute = notes({"notes": [n for n in score["notes"] if n["partId"] == "P1"]})
        self.assertEqual(flute[1][3], flute[2][3])  # tied D5
        self.assertEqual(flute[3][:3], (F(3), F(3, 2), "F#5"))  # grace note dropped, no time taken
        self.assertEqual(len(flute), 7)  # bar 2 repeats
        self.assertEqual(score["tempoMap"][0]["quarterBpm"], 90.0)
        self.assertEqual([h["selected"] for h in score["harmony"]], ["G", "D7/F#", "D7/F#"])
        self.assertEqual(score["notation"]["dropped"], {"grace notes": 1})
        roles = {(n["partId"], n["role"]) for n in score["notes"]}
        self.assertEqual(roles, {("P1", "melody"), ("P2", "harmony")})

    def test_partwise(self):
        self.check(build_score(read_musicxml(self.data)))

    def test_compressed_mxl(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as z:
            z.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="score/duet.musicxml"/></rootfiles></container>')
            z.writestr("score/duet.musicxml", self.data)
        self.check(build_score(read_musicxml(buffer.getvalue())))


class MidiTest(unittest.TestCase):
    def test_exact_ticks_meta_and_drums(self):
        score = build_score(read_midi(make_midi()))
        self.assertEqual(validate(score), [])
        self.assertEqual(score["tempoMap"], [{"at": [0, 1], "quarterBpm": 100.0}])
        self.assertEqual(score["meterMap"][0], {"at": [0, 1], "numerator": 3, "denominator": 4})
        self.assertEqual(score["keyMap"][0], {"at": [0, 1], "tonic": "G", "mode": "major"})
        flute = notes({"notes": [n for n in score["notes"] if n["partId"] == "P1"]})
        self.assertEqual([f[2] for f in flute], ["G4", "F#4", "A4", "B4", "C5", "D5"])
        self.assertEqual(flute[1][:2], (F(1), F(47, 48)))  # 470 ticks of 480 stay exact
        self.assertEqual(score["notation"]["dropped"], {"drum notes (channel 10)": 1})
        self.assertEqual([p["name"] for p in score["parts"]], ["Flute", "Bass"])

    def test_grid_snaps_a_performance(self):
        doc = read_midi(make_midi(jitter=17), grid=F(1, 4))
        score = build_score(doc)
        flute = notes({"notes": [n for n in score["notes"] if n["partId"] == "P1"]})
        self.assertEqual([f[0] for f in flute], [F(0), F(1), F(2), F(3), F(4), F(5)])
        self.assertTrue(any("snapped to 1/4" in a for a in score["notation"]["assumptions"]))

    def test_cli_keeps_the_sidecar_source_and_license(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "song.abc"
            path.write_text("X:1\nT:Song\nM:3/4\nL:1/4\nK:C\nC D E|\nw:la la la\n")
            Path(str(path) + ".source.json").write_text(json.dumps({"url": "https://example.org/song.abc", "page": "https://example.org/song",
                                                                     "retrievedAt": "2026-10-31T12:00:00+00:00", "license": "public domain"}))
            run = subprocess.run([sys.executable, str(SCRIPTS / "score.py"), "convert", str(path)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            source = json.loads(path.with_suffix(".scorify.json").read_text())["notation"]["source"]
            self.assertEqual((source["url"], source["file"], source["license"]), ("https://example.org/song", "https://example.org/song.abc", "public domain"))

    def test_cli_assigns_roles_by_register(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "duo.mid"
            path.write_bytes(make_midi())
            run = subprocess.run([sys.executable, str(SCRIPTS / "score.py"), "convert", str(path)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            score = json.loads(path.with_suffix(".scorify.json").read_text())
            self.assertEqual({(n["partId"], n["role"]) for n in score["notes"]}, {("P1", "melody"), ("P2", "bass")})


    def test_two_voices_per_staff_and_a_pickup(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "chorale.mid"
            path.write_bytes(make_chorale())
            run = subprocess.run([sys.executable, str(SCRIPTS / "score.py"), "convert", str(path), "--pickup", "1/2"],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            score = json.loads(path.with_suffix(".scorify.json").read_text())
        self.assertEqual(validate(score), [])
        self.assertEqual(score["meterMap"], [{"at": [0, 1], "numerator": 1, "denominator": 8},
                                             {"at": [1, 2], "numerator": 6, "denominator": 8}])
        lines = {(n["partId"], F(*n["onset"]), n["pitch"]["step"] + str(n["pitch"]["octave"])): (n["voiceId"], n["role"]) for n in score["notes"]}
        self.assertEqual(lines, {
            ("P1", F(0), "E4"): ("1", "melody"), ("P1", F(0), "B3"): ("2", "harmony"),
            ("P1", F(1, 2), "G4"): ("1", "melody"), ("P1", F(1, 2), "E4"): ("2", "harmony"),
            ("P1", F(1), "D4"): ("2", "harmony"),  # below the held soprano: an inner move, not the melody
            ("P1", F(3, 2), "D4"): ("1", "melody"),  # a unison on the upper staff joins the melody
            ("P2", F(0), "G3"): ("1", "harmony"), ("P2", F(0), "E3"): ("2", "bass"),
            ("P2", F(1, 2), "B3"): ("1", "harmony"), ("P2", F(1, 2), "E3"): ("2", "bass"),
            ("P2", F(3, 2), "D3"): ("2", "bass"),  # a unison on the lowest staff joins the bass
        })


class LyricsXmlTest(unittest.TestCase):
    def test_first_verse_with_syllables(self):
        xml = ('<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>'
               '<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>'
               '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice>'
               '<lyric number="1"><syllabic>begin</syllabic><text>Hel</text></lyric><lyric number="2"><text>Two</text></lyric></note>'
               '<note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice>'
               '<lyric number="1"><syllabic>end</syllabic><text>lo</text></lyric></note></measure></part></score-partwise>')
        score = build_score(read_musicxml(xml.encode()))
        self.assertEqual(list(score["notation"]["lyrics"].values()), ["Hel-", "lo"])
        self.assertEqual(list(score["notation"]["verses"][0].values()), ["Two"])
        self.assertEqual(score["notation"]["vocal"], ["P1"])


class TablatureXmlTest(unittest.TestCase):
    """A guitar part shown as staff and tablature together encodes every note twice, once per staff."""

    def xml(self, tab_pitch: str) -> bytes:
        note = lambda step, staff, voice: (f'<note><pitch><step>{step}</step><octave>3</octave></pitch><duration>2</duration>'
                                           f'<voice>{voice}</voice><staff>{staff}</staff></note>')
        return ('<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>'
                '<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>'
                '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>'
                '<clef number="2"><sign>TAB</sign><line>5</line></clef></attributes>'
                + note("D", 1, 1) + note("E", 1, 1) + '<backup><duration>4</duration></backup>'
                + note("D", 2, 5) + note(tab_pitch, 2, 5) + '</measure></part></score-partwise>').encode()

    def test_a_repeating_tablature_staff_is_dropped_and_counted(self):
        score = build_score(read_musicxml(self.xml("E")))
        self.assertEqual([(n["pitch"]["step"], n["voiceId"]) for n in score["notes"]], [("D", "1"), ("E", "1")])
        self.assertEqual(score["notation"]["dropped"], {"notes on a tablature staff repeating the notation staff": 2})
        self.assertEqual(validate(score), [])

    def test_a_tab_only_score_without_sharps_or_flats_has_no_known_key(self):
        def tab(fifths: int) -> bytes:
            return ('<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>'
                    f'<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>{fifths}</fifths></key>'
                    '<time><beats>1</beats><beat-type>4</beat-type></time><clef><sign>TAB</sign><line>5</line></clef></attributes>'
                    '<note><pitch><step>F</step><alter>1</alter><octave>3</octave></pitch><duration>1</duration><voice>1</voice></note>'
                    '</measure></part></score-partwise>').encode()
        unset = build_score(read_musicxml(tab(0)))
        self.assertEqual(unset["keyMap"], [])
        self.assertTrue(any("key is unknown" in w for w in unset["notation"]["warnings"]))
        self.assertEqual(validate(unset), [])
        self.assertEqual(build_score(read_musicxml(tab(2)))["keyMap"][0]["tonic"], "D")

    def test_a_differing_tablature_staff_is_kept_with_a_warning(self):
        score = build_score(read_musicxml(self.xml("F")))
        self.assertEqual(len(score["notes"]), 4)
        self.assertTrue(any("tablature staff differs" in w for w in score["notation"]["warnings"]))


class SungPartNameTest(unittest.TestCase):
    def test_a_part_named_voice_in_another_language_is_sung_without_words(self):
        for name, sung in [("Голос", True), ("Gesang", True), ("Voix", True), ("Электрогитара", False), ("Altsaxophon", False)]:
            xml = ('<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>' + name + '</part-name></score-part></part-list>'
                   '<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>'
                   '<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note></measure></part></score-partwise>')
            score = build_score(read_musicxml(xml.encode()))
            self.assertEqual(score["notation"].get("vocal", []), ["P1"] if sung else [], name)


class SetTest(unittest.TestCase):
    def test_bundle_orders_versions_by_difficulty(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "fixtures.scorify-set.json"
            cli = [sys.executable, str(SCRIPTS / "score.py")]
            run = subprocess.run(cli + ["bundle", str(FIXTURES / "duet.scorify.json"), str(FIXTURES / "reel.scorify.json"), "-o", str(out),
                                        "--title", "Fixtures", "--difficulty", "duet.scorify.json=expert", "--label", "reel.scorify.json=Easy reel"],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            data = json.loads(out.read_text())
            self.assertEqual(data["schema"], "scorify-set-1")
            self.assertEqual([(v["id"], v["difficulty"], v["label"]) for v in data["variants"]],
                             [("reel", "beginner", "Easy reel"), ("duet", "expert", "Fixture Duet")])
            self.assertTrue(data["variants"][0]["difficultyBasis"].startswith("estimated"))
            check = subprocess.run(cli + ["check", str(out)], capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stdout + check.stderr)
            self.assertIn("2 versions", check.stdout)
            data["variants"][1]["difficulty"] = "wizard"
            out.write_text(json.dumps(data))
            self.assertEqual(subprocess.run(cli + ["check", str(out)], capture_output=True, text=True).returncode, 2)


class ValidatorTest(unittest.TestCase):
    def base(self):
        return {"schemaVersion": 1, "temperament": "12-TET", "concertAHz": 440,
                "notes": [{"id": "a", "onset": [0, 1], "duration": [1, 1], "pitch": {"step": "C", "alter": 0, "octave": 4}, "partId": "P", "voiceId": "1"}],
                "rests": [], "parts": [{"id": "P", "voices": ["1"]}], "tempoMap": [{"at": [0, 1], "quarterBpm": 90}],
                "meterMap": [{"at": [0, 1], "numerator": 4, "denominator": 4}], "keyMap": [], "harmony": []}

    def test_accepts_minimal(self):
        self.assertEqual(validate(self.base()), [])

    def test_rejects_what_scorify_rejects(self):
        cases = {
            "rest overlap": lambda s: s["rests"].append({"id": "r", "onset": [1, 2], "duration": [1, 1], "partId": "P", "voiceId": "1"}),
            "meter": lambda s: s["meterMap"].__setitem__(0, {"at": [0, 1], "numerator": 4, "denominator": 3}),
            "voice": lambda s: s["notes"][0].__setitem__("voiceId", "2"),
            "tempo start": lambda s: s["tempoMap"].__setitem__(0, {"at": [1, 1], "quarterBpm": 90}),
            "gate": lambda s: s["notes"][0].__setitem__("gateDuration", [2, 1]),
            "tie gap": lambda s: s["notes"].extend([
                {**s["notes"][0], "id": "b", "onset": [2, 1], "tieGroupId": "t"}, {**s["notes"][0], "id": "c", "onset": [4, 1], "tieGroupId": "t"}]),
            "duplicate id": lambda s: s["notes"].append(dict(s["notes"][0])),
        }
        for label, change in cases.items():
            score = self.base()
            change(score)
            self.assertTrue(validate(score), label)


class CloakTest(unittest.TestCase):
    def test_search_queries_preserve_separate_evidence(self):
        urls = ["https://example.test/search?q=one", "https://example.test/search?q=two"]
        with tempfile.TemporaryDirectory() as out, patch("scorekit.cloak.Browser") as browser_type:
            browser = browser_type.return_value.__enter__.return_value
            browser.goto.return_value = {"status": 200}
            browser.read_page.side_effect = [
                {"url": url, "title": title, "text": title, "html": f"<h1>{title}</h1>",
                 "meta": {}, "links": [], "blocks": []}
                for url, title in zip(urls, ["First song", "Second song"])
            ]
            for url in urls:
                args = argparse.Namespace(url=url, out=out, timeout=1, allow_disallowed=True, settle=0, screenshot=False)
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(cmd_visit(args), 0)
            manifests = list(Path(out).glob("*/manifest.json"))
            self.assertEqual(len(manifests), 2)
            self.assertEqual({json.loads(p.read_text())["url"] for p in manifests}, set(urls))
            self.assertEqual({p.with_name("page.txt").read_text() for p in manifests}, {"First song", "Second song"})

    def test_walls(self):
        self.assertEqual(wall("Please verify you are human to continue"), "challenge")
        self.assertEqual(wall("Sign in to download this score"), "login")
        self.assertIsNone(wall("Download MusicXML · Public domain"))

    @unittest.skipUnless(os.environ.get("SCORE_IMPORT_LIVE") == "1" and binary(), "SCORE_IMPORT_LIVE=1 and CloakBrowser required")
    def test_visit_download_convert(self):
        with tempfile.TemporaryDirectory() as site, tempfile.TemporaryDirectory() as out:
            (Path(site) / "duet.musicxml").write_bytes((FIXTURES / "duet.musicxml").read_bytes())
            (Path(site) / "index.html").write_text(
                "<html><head><title>Fixture tunes</title></head><body><h1>Tunes</h1>"
                f"<pre>{(FIXTURES / 'reel.abc').read_text()}</pre>"
                '<a href="duet.musicxml" download>Download MusicXML</a></body></html>')
            handler = lambda *a, **k: SimpleHTTPRequestHandler(*a, directory=site, **k)  # noqa: E731
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            base = f"http://127.0.0.1:{server.server_address[1]}"
            try:
                cli = [sys.executable, str(SCRIPTS / "score.py")]
                visit = subprocess.run(cli + ["visit", f"{base}/index.html", "--out", out], capture_output=True, text=True, timeout=120)
                self.assertEqual(visit.returncode, 0, visit.stdout + visit.stderr)
                self.assertIn("duet.musicxml", visit.stdout)
                self.assertIn("INLINE abc", visit.stdout)
                download = subprocess.run(cli + ["download", f"{base}/duet.musicxml", "--from", f"{base}/index.html", "--out", out], capture_output=True, text=True, timeout=120)
                self.assertEqual(download.returncode, 0, download.stdout + download.stderr)
                saved = Path(out) / "duet.musicxml"
                self.assertEqual(saved.read_bytes(), (FIXTURES / "duet.musicxml").read_bytes())
                convert = subprocess.run(cli + ["convert", str(saved)], capture_output=True, text=True)
                self.assertEqual(convert.returncode, 0, convert.stdout + convert.stderr)
                score = json.loads(saved.with_suffix(".scorify.json").read_text())
                self.assertEqual(score["notation"]["source"]["url"], f"{base}/index.html")
                self.assertEqual(score["notation"]["source"]["file"], f"{base}/duet.musicxml")
            finally:
                server.shutdown()
                server.server_close()


class GoldenTest(unittest.TestCase):
    """The committed *.scorify.json files are what the converters write today; scorify's own tests load them."""

    def test_fixtures_match(self):
        for source, golden in [("reel.abc", "reel.scorify.json"), ("duet.musicxml", "duet.scorify.json"), ("duo.mid", "duo.scorify.json"), ("verses.abc", "verses.scorify.json")]:
            path = FIXTURES / source
            if source.endswith(".mid") and not path.exists():
                path.write_bytes(make_midi())
            run = subprocess.run([sys.executable, str(SCRIPTS / "score.py"), "convert", str(path), "-o", str(Path(tempfile.gettempdir()) / golden)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            got = json.loads((Path(tempfile.gettempdir()) / golden).read_text())
            want = json.loads((FIXTURES / golden).read_text())
            for score in (got, want):
                score["notation"].get("source", {}).pop("retrievedAt", None)
            self.assertEqual(got, want, f"{golden} changed: regenerate it with score.py convert if the change is intended")


if __name__ == "__main__":
    unittest.main()
