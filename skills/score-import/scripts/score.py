#!/usr/bin/env python3
"""score-import: find scores on the web with CloakBrowser and convert them to scorify Score JSON.

  score.py visit URL [--out DIR] [--screenshot]       read a page: text, score links, inline notation
  score.py download URL [--from PAGE] [--out DIR]     save a file through the browser, with a provenance sidecar
  score.py tunes FILE.abc                             list the tunes of an ABC file
  score.py convert FILE [-o OUT.scorify.json] [...]   MusicXML / MXL / ABC / MIDI -> scorify Score JSON
  score.py check FILE.scorify.json [--json]           validate against scorify's rules and summarize (or a score set)
  score.py bundle FILE... -o OUT.scorify-set.json     several versions of one piece in one file, by difficulty

Exit codes: 0 done, 2 the claim failed (invalid score, blocked page, nothing found), 1 usage or runtime error.
Python 3.9+, standard library only. See ../SKILL.md.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.robotparser
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from scorekit import VERSION  # noqa: E402
from scorekit.model import ROLES, Source, build_score, default_roles, dumps  # noqa: E402

SCORE_EXT = {".musicxml": "musicxml", ".mxl": "musicxml", ".xml": "musicxml?", ".abc": "abc", ".mid": "midi", ".midi": "midi",
             ".krn": "humdrum (unsupported)", ".mei": "mei (unsupported)", ".ly": "lilypond (unsupported)", ".pdf": "pdf (unsupported)",
             ".gp": "guitar pro (unsupported)",
             ".gp5": "guitar pro (unsupported)", ".gpx": "guitar pro (unsupported)"}
HINTS = re.compile(r"\b(musicxml|mxl|abc|midi|\.mid\b|download|score|sheet|tab)\b", re.I)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "page"


def classify(href: str, text: str) -> str:
    path = urllib.parse.urlparse(href).path.lower()
    for ext, kind in SCORE_EXT.items():
        if path.endswith(ext):
            return kind
    if re.search(r"(musicxml|\bmxl\b)", f"{href} {text}", re.I):
        return "musicxml?"
    if re.search(r"\babc\b", text, re.I) or re.search(r"[?&/](abc|format=abc)", href, re.I):
        return "abc?"
    if re.search(r"\bmidi?\b", text, re.I):
        return "midi?"
    return ""


def robots_allows(browser, url: str) -> bool:
    """robots.txt read through the same browser; a missing or unreadable file allows the fetch."""
    parts = urllib.parse.urlparse(url)
    robots = f"{parts.scheme}://{parts.netloc}/robots.txt"
    try:
        response = browser.fetch_body(robots, referer_settle=0)
    except Exception:
        return True
    if response["status"] >= 400 or b"<html" in response["body"][:200].lower():
        return True
    parser = urllib.robotparser.RobotFileParser()
    parser.parse(response["body"].decode("utf-8", "replace").splitlines())
    return parser.can_fetch("*", url)


def cmd_visit(args) -> int:
    from scorekit.cloak import Browser, wall
    parsed = urllib.parse.urlparse(args.url)
    # Searches often share a path and differ only by query. Preserve each result's evidence.
    digest = hashlib.sha256(args.url.encode("utf-8")).hexdigest()[:12]
    out = Path(args.out) / f"{slug(parsed.netloc + parsed.path)}-{digest}"
    out.mkdir(parents=True, exist_ok=True)
    with Browser(timeout=args.timeout) as browser:
        if not args.allow_disallowed and not robots_allows(browser, args.url):
            print(f"BLOCKED robots.txt disallows {args.url}; stop unless the site owner permits automated access "
                  "(then pass --allow-disallowed)")
            return 2
        document = browser.goto(args.url, settle=args.settle)
        page = browser.read_page()
        if args.screenshot:
            (out / "page.png").write_bytes(browser.screenshot())
    (out / "page.txt").write_text(page["text"], encoding="utf-8")
    (out / "page.html").write_text(page["html"], encoding="utf-8")
    links = []
    for link in page["links"]:
        kind = classify(link["href"], link["text"])
        if kind or (link.get("download") and HINTS.search(link["text"])):
            links.append({**link, "kind": kind or "download?"})
    inline = []
    for i, block in enumerate(page["blocks"]):
        if re.search(r"^X:\s*\d*", block, re.M) and re.search(r"^K:", block, re.M):
            name = f"inline-{i + 1}.abc"
        elif "<score-partwise" in block or "<score-timewise" in block:
            name = f"inline-{i + 1}.musicxml"
        else:
            continue
        (out / name).write_text(block, encoding="utf-8")
        inline.append({"file": str(out / name), "kind": name.rsplit(".", 1)[1], "preview": block[:160]})
    blocked = wall(page["text"], page["title"])
    manifest = {
        "url": args.url, "finalUrl": page["url"], "status": document.get("status"), "title": page["title"], "visitedAt": now(),
        "wall": blocked, "meta": {k: v for k, v in page["meta"].items() if k and re.search(r"author|description|title", k, re.I)},
        "scoreLinks": links, "inlineNotation": inline, "text": str(out / "page.txt"), "html": str(out / "page.html"),
        **({"screenshot": str(out / "page.png")} if args.screenshot else {}),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"PAGE {page['title']!r} status={document.get('status')} -> {out / 'manifest.json'}")
    if blocked:
        print(f"WALL {blocked}: the page asks for a human check, a login or a payment; do not work around it, tell the human")
    for link in links[:40]:
        print(f"LINK {link['kind']:<22} {link['href']}  {link['text'][:60]!r}")
    for block in inline:
        print(f"INLINE {block['kind']} {block['file']}")
    if not links and not inline:
        print("NONE no score files or inline notation found; read page.txt for links to follow")
    return 2 if blocked else 0


def cmd_download(args) -> int:
    from scorekit.cloak import Browser, wall
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with Browser(timeout=args.timeout) as browser:
        if not args.allow_disallowed and not robots_allows(browser, args.url):
            print(f"BLOCKED robots.txt disallows {args.url}")
            return 2
        if args.page:
            browser.goto(args.page, settle=0.5)
            time.sleep(1.0)  # be polite: one request at a time, with a pause
        response = browser.fetch_body(args.url)
    body = response["body"]
    if response["status"] >= 400:
        print(f"FAILED HTTP {response['status']} for {args.url}")
        return 2
    if b"<html" in body[:500].lower() and not re.search(r"(xml|abc|midi)", response["mimeType"]):
        text = re.sub(r"<[^>]+>", " ", body.decode("utf-8", "replace"))
        kind = wall(text)
        print(f"FAILED got an HTML page instead of a score{f' ({kind} wall)' if kind else ''}; visit it to see why")
        return 2
    disposition = response["headers"].get("content-disposition", "")
    m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", disposition)
    name = args.name or (urllib.parse.unquote(m.group(1)) if m else Path(urllib.parse.urlparse(response["url"]).path).name or "score")
    target = out / re.sub(r"[^\w.\-]+", "_", name)
    target.write_bytes(body)
    sidecar = {"url": response["url"], "requested": args.url, "page": args.page or "", "retrievedAt": now(), "status": response["status"],
               "contentType": response["mimeType"], "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    Path(str(target) + ".source.json").write_text(json.dumps(sidecar, indent=1), encoding="utf-8")
    print(f"SAVED {target} ({len(body)} bytes, {response['mimeType'] or 'unknown type'}) + {target.name}.source.json")
    return 0


def detect(path: Path, data: bytes, forced: str) -> str:
    if forced != "auto":
        return forced
    if data[:4] == b"MThd":
        return "midi"
    if data[:2] == b"PK" or b"<score-partwise" in data[:4000] or b"<score-timewise" in data[:4000]:
        return "musicxml"
    text = data[:20000].decode("utf-8", "replace")
    if re.search(r"^K:", text, re.M):
        return "abc"
    raise SystemExit(f"cannot tell the format of {path}; pass --format musicxml|abc|midi")


def role_function(doc, args):
    base = default_roles(doc)
    if doc.format == "midi":
        # MIDI track names are unreliable: the top line of the highest-sounding track carries the melody, the bottom
        # line of the lowest-sounding track the bass (one track: its top and bottom lines).
        from scorekit.pitch import midi
        means = {p.id: sum(midi(e.pitch) for m in p.measures for e in m.events) / max(1, sum(len(m.events) for m in p.measures)) for p in doc.parts}
        top, bottom = max(means, key=means.get), min(means, key=means.get)
        lines = {p.id: {e.voice for m in p.measures for e in m.events} for p in doc.parts}
        low = "2" if "2" in lines[bottom] else None if top == bottom else "1"

        def base(part, voice, p):
            if part == top and voice == "1":
                return "melody"
            return "bass" if part == bottom and voice == low else "harmony"
    overrides = {}
    for spec, role in [(s, "melody") for s in args.melody] + [(s, "bass") for s in args.bass] + \
            [tuple(s.split("=", 1)) for s in args.role]:
        if role not in ROLES:
            raise SystemExit(f"unknown role {role!r}; use one of {', '.join(ROLES)}")
        part, _, voice = spec.partition(":")
        overrides[(part, voice or "*")] = role
    if args.melody:  # a named melody replaces the default one
        previous = base
        base = lambda part, voice, p: "harmony" if previous(part, voice, p) == "melody" else previous(part, voice, p)  # noqa: E731
    return lambda part, voice, p: overrides.get((part, voice), overrides.get((part, "*"), base(part, voice, p)))


def cmd_convert(args) -> int:
    path = Path(args.input)
    data = path.read_bytes()
    fmt = detect(path, data, args.format)
    if fmt == "musicxml":
        from scorekit.musicxml import read_musicxml
        doc = read_musicxml(data)
    elif fmt == "abc":
        from scorekit.abc import read_abc
        doc = read_abc(data.decode("utf-8", "replace"), tune=args.tune)
    elif fmt == "midi":
        from scorekit.midi import read_midi
        doc = read_midi(data, grid=Fraction(args.grid) if args.grid else None, split=not args.no_split,
                        pickup=Fraction(args.pickup) if args.pickup else None)
    else:
        raise SystemExit(f"unsupported format {fmt}")
    if args.title:
        doc.title = args.title
    if args.composer:
        doc.composer = args.composer
    sidecar = Path(str(path) + ".source.json")
    meta = json.loads(sidecar.read_text()) if sidecar.is_file() else {}
    source = Source(url=args.source_url or meta.get("page") or meta.get("url", ""), site=args.site or urllib.parse.urlparse(args.source_url or meta.get("page") or meta.get("url", "")).netloc,
                    retrieved_at=meta.get("retrievedAt", ""), file=meta.get("url", "") if meta.get("page") else "",
                    sha256=hashlib.sha256(data).hexdigest(), format=fmt, license=meta.get("license", ""))
    score = build_score(doc, unfold_repeats=args.repeats == "unfold", role=role_function(doc, args), source=source,
                        default_tempo=args.tempo)
    from scorekit.check import report, validate
    errors = validate(score)
    out = Path(args.output) if args.output else path.with_suffix(".scorify.json")
    out.write_text(dumps(score), encoding="utf-8")
    summary = report(score)
    print(f"WROTE {out}: {summary['notes']} notes, {len(summary['parts'])} parts, {summary['seconds']} s, range {summary['range']}")
    for line in summary["assumptions"]:
        print(f"ASSUMED {line}")
    for line in summary["warnings"]:
        print(f"WARNING {line}")
    for what, count in summary["dropped"].items():
        print(f"DROPPED {count} {what}")
    for error in errors:
        print(f"INVALID {error}")
    return 2 if errors else 0


def cmd_bundle(args) -> int:
    """Several versions of one piece (an easy and a full arrangement, say) in one score set, easiest first."""
    from scorekit.check import LEVELS, SET_SCHEMA, density, estimate_level, validate
    named = lambda pairs: dict(x.split("=", 1) for x in pairs)  # noqa: E731
    labels, levels = named(args.label), named(args.difficulty)
    order = [l[0] for l in LEVELS]
    for level in levels.values():
        if level not in order:
            raise SystemExit(f"unknown difficulty {level!r}; use one of {', '.join(order)}")
    variants = []
    for file in args.inputs:
        score = json.loads(Path(file).read_text(encoding="utf-8"))
        errors = validate(score)
        if errors:
            print(f"INVALID {file}: {errors[0]}")
            return 2
        attacks, polyphony = density(score)
        key = next((k for k in (file, Path(file).name, Path(file).stem) if k in labels or k in levels), file)
        level = levels.get(key) or estimate_level(score)
        label = labels.get(key) or (score.get("notation") or {}).get("title") or Path(file).name.split(".")[0]
        variants.append({"id": slug(Path(file).name.split(".")[0]), "label": label, "difficulty": level,
                         "difficultyBasis": "given" if key in levels else f"estimated: {attacks} attacks in a second, {polyphony} notes at once",
                         "score": score})
    variants.sort(key=lambda v: (order.index(v["difficulty"]), len(v["score"]["notes"])))
    seen: dict = {}
    for v in variants:
        seen[v["id"]] = seen.get(v["id"], 0) + 1
        if seen[v["id"]] > 1:
            v["id"] += f"-{seen[v['id']]}"
    first = variants[0]["score"].get("notation") or {}
    data = {"schema": SET_SCHEMA, "title": args.title or first.get("title", ""), "composer": args.composer or first.get("composer", ""),
            "variants": variants}
    out = Path(args.output)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"WROTE {out}: {len(variants)} versions")
    for v in variants:
        print(f"VARIANT {v['id']:<20} {v['difficulty']:<9} {len(v['score']['notes']):>5} notes  {v['label']!r} ({v['difficultyBasis']})")
    return 0


def cmd_check(args) -> int:
    from scorekit.check import SET_SCHEMA, report, validate, validate_set
    score = json.loads(Path(args.input).read_text(encoding="utf-8"))
    if isinstance(score, dict) and score.get("schema") == SET_SCHEMA:
        errors = validate_set(score)
        for error in errors:
            print(f"INVALID {error}")
        if errors:
            return 2
        print(f"VALID {args.input}: score set {score.get('title', '')!r} · {len(score['variants'])} versions")
        for v in score["variants"]:
            r = report(v["score"])
            print(f"VARIANT {v['id']:<20} {v['difficulty']:<9} {r['notes']:>5} notes · {r['seconds']} s · up to {r['maxSimultaneous']} at once · {v.get('label', '')!r}")
        return 0
    errors = validate(score)
    if args.json:
        print(json.dumps({"valid": not errors, "errors": errors, **({"report": report(score)} if not errors else {})}, indent=1, ensure_ascii=False))
        return 2 if errors else 0
    for error in errors:
        print(f"INVALID {error}")
    if errors:
        return 2
    r = report(score)
    print(f"VALID {args.input}: {r['title']!r} {r['composer']!r} · {r['notes']} notes · {r['seconds']} s · range {r['range']} · "
          f"up to {r['maxSimultaneous']} at once")
    print(f"SOURCE {r['source'].get('url') or r['source'].get('file') or 'not recorded'}")
    print(f"MAPS meters {r['meters']} keys {r['keys']} tempos {r['tempos']}")
    if r["chordSymbols"]:
        print(f"CHORDS {' '.join(r['chordSymbols'])}")
    for p in r["parts"]:
        print(f"PART {p['id']} {p['name']!r} voices={p['voices']} notes={p['notes']} roles={p['roles']} range={p['range']}"
              + (f" writtenToSounding={p['writtenToSounding']}" if p.get("writtenToSounding") else ""))
    for label, fit in r["fits"].items():
        print(f"FIT {label:<26} out-of-range={fit['outOfRange']:<4} best-octave-shift={fit['bestOctaveShift']:+d} "
              f"remaining={fit['outOfRangeAfterShift']:<4} {fit['hint']}")
    for line in r["assumptions"]:
        print(f"ASSUMED {line}")
    for line in r["warnings"]:
        print(f"WARNING {line}")
    return 0


def cmd_tunes(args) -> int:
    from scorekit.abc import split_tunes
    for number, title, lines in split_tunes(Path(args.input).read_text(encoding="utf-8", errors="replace")):
        key = next((ln[2:].strip() for ln in lines if ln.startswith("K:")), "?")
        meter = next((ln[2:].strip() for ln in lines if ln.startswith("M:")), "?")
        print(f"X:{number:<5} {title!r} M:{meter} K:{key}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="score.py", description=__doc__.split("\n\n")[0])
    parser.add_argument("--version", action="version", version=f"score-import {VERSION}")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("visit", "download"):
        p = sub.add_parser(name)
        p.add_argument("url")
        p.add_argument("--out", default="score-import")
        p.add_argument("--timeout", type=float, default=45.0)
        p.add_argument("--allow-disallowed", action="store_true", help="ignore robots.txt (only with the site owner's permission)")
        if name == "visit":
            p.add_argument("--screenshot", action="store_true")
            p.add_argument("--settle", type=float, default=1.0, help="seconds without network activity before reading")
        else:
            p.add_argument("--from", dest="page", help="open this page first (cookies, referer), then download")
            p.add_argument("--name", help="file name to save as")
    p = sub.add_parser("convert")
    p.add_argument("input")
    p.add_argument("-o", "--output")
    p.add_argument("--format", default="auto", choices=["auto", "musicxml", "abc", "midi"])
    p.add_argument("--tune", help="ABC: the X: number to convert (default: the first tune)")
    p.add_argument("--repeats", default="unfold", choices=["unfold", "written"])
    p.add_argument("--grid", help="MIDI: snap to this many quarters, e.g. 1/4 for sixteenths (recorded performances)")
    p.add_argument("--pickup", help="MIDI: length of an anacrusis (pickup bar) in quarters, e.g. 1/2 for an eighth")
    p.add_argument("--no-split", action="store_true", help="MIDI: keep each polyphonic track as one voice")
    p.add_argument("--tempo", type=float, default=120.0, help="quarter notes per minute when the score has no tempo")
    p.add_argument("--title")
    p.add_argument("--composer")
    p.add_argument("--source-url")
    p.add_argument("--site")
    p.add_argument("--melody", action="append", default=[], metavar="PART[:VOICE]")
    p.add_argument("--bass", action="append", default=[], metavar="PART[:VOICE]")
    p.add_argument("--role", action="append", default=[], metavar="PART[:VOICE]=ROLE")
    p = sub.add_parser("check")
    p.add_argument("input")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("bundle")
    p.add_argument("inputs", nargs="+", metavar="FILE.scorify.json")
    p.add_argument("-o", "--output", required=True, metavar="OUT.scorify-set.json")
    p.add_argument("--title")
    p.add_argument("--composer")
    p.add_argument("--label", action="append", default=[], metavar="FILE=LABEL")
    p.add_argument("--difficulty", action="append", default=[], metavar="FILE=LEVEL", help="the level a version was written for (default: estimated)")
    p = sub.add_parser("tunes")
    p.add_argument("input")
    args = parser.parse_args(argv)
    try:
        return {"visit": cmd_visit, "download": cmd_download, "convert": cmd_convert, "check": cmd_check, "bundle": cmd_bundle,
                "tunes": cmd_tunes}[args.command](args)
    except (ValueError, OSError) as error:
        print(f"ERROR {error}", file=sys.stderr)
        return 1
    except Exception as error:  # CloakError and parser errors carry a readable message
        print(f"ERROR {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
