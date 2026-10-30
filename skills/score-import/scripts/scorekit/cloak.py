"""Drive CloakBrowser (a patched, fingerprint-consistent Chromium) over the DevTools protocol, standard library only.

The pattern follows defuss-vae's vae_cloak.py (github.com/kyr0/defuss-vae): one headless browser with a throwaway
profile, a minimal RFC 6455 WebSocket client, and DevTools commands. On top of that this module waits for the network
to settle, reads response bodies (so a download is captured even when Chromium would save it to disk) and recognizes
challenge and login walls, which the skill reports instead of trying to get past.

Binary: $CLOAKBROWSER_BINARY_PATH, else the newest chromium-* build in ${CLOAKBROWSER_CACHE_DIR:-~/.cloakbrowser}
(install it with `bunx cloakbrowser install` or `npx cloakbrowser install`).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import re
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
WALLS = [
    ("challenge", r"verify (that )?you are (a )?human|are you a robot|checking your browser|captcha|unusual traffic|cf-chl|just a moment\.\.\."),
    ("login", r"(sign|log) ?in to (download|continue|view)|please (sign|log) ?in|create a free account to download"),
    ("paywall", r"subscribe to (download|unlock|access)|purchase to download|premium members only|upgrade to (pro|premium) to download"),
]


class CloakError(RuntimeError):
    pass


def binary() -> Optional[Path]:
    explicit = os.environ.get("CLOAKBROWSER_BINARY_PATH")
    if explicit:
        return Path(explicit) if Path(explicit).is_file() else None
    cache = Path(os.environ.get("CLOAKBROWSER_CACHE_DIR") or Path.home() / ".cloakbrowser")
    exe = "Chromium.app/Contents/MacOS/Chromium" if sys.platform == "darwin" else "chrome"
    builds = sorted((p for p in cache.glob("chromium-*") if (p / exe).is_file()),
                    key=lambda p: [int(n) for n in re.findall(r"\d+", p.name)])
    return builds[-1] / exe if builds else None


def _local_json(url: str, timeout: float) -> Any:
    # The DevTools endpoint is on 127.0.0.1: never route it through a proxy from the environment.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=timeout) as response:
        return json.loads(response.read().decode())


class WebSocket:
    """The client half of RFC 6455 over a blocking socket: masked text frames out, reassembled messages in."""

    def __init__(self, url: str, timeout: float):
        if not url.startswith("ws://"):
            raise CloakError(f"only ws:// is supported: {url}")
        hostport, _, path = url[5:].partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port or 80)), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise CloakError("the browser closed the connection during the WebSocket handshake")
            head += chunk
        head, self.buf = head.split(b"\r\n\r\n", 1)
        lines = head.decode("latin-1").split("\r\n")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        fields = {k.strip().lower(): v.strip() for k, _, v in (ln.partition(":") for ln in lines[1:])}
        if " 101 " not in lines[0] + " " or fields.get("sec-websocket-accept") != accept:
            raise CloakError(f"WebSocket handshake refused: {lines[0]}")

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self.buf)))
            if not chunk:
                raise CloakError("the browser closed the WebSocket")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _frame(self, opcode: int, payload: bytes) -> None:
        n = len(payload)
        head = bytes([0x80 | opcode]) + (bytes([0x80 | n]) if n < 126 else
                                         bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else
                                         bytes([0x80 | 127]) + struct.pack(">Q", n))
        mask = os.urandom(4)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send(self, text: str) -> None:
        self._frame(0x1, text.encode("utf-8"))

    def recv(self) -> str:
        parts: List[bytes] = []
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            n = struct.unpack(">H", self._read(2))[0] if n == 126 else struct.unpack(">Q", self._read(8))[0] if n == 127 else n
            mask = self._read(4) if b1 & 0x80 else b""
            payload = self._read(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            opcode = b0 & 0x0F
            if opcode == 0x8:
                raise CloakError("the browser closed the WebSocket")
            if opcode == 0x9:
                self._frame(0xA, payload)
                continue
            if opcode in (0x0, 0x1, 0x2):
                parts.append(payload)
                if b0 & 0x80:
                    return b"".join(parts).decode("utf-8", "replace")

    def close(self) -> None:
        try:
            self._frame(0x8, b"")
        except OSError:
            pass
        self.sock.close()


class Page:
    """One tab: commands with ids; events are queued until something waits for them."""

    def __init__(self, ws: WebSocket, timeout: float):
        self.ws, self.timeout, self.next_id = ws, timeout, 0
        self.events: List[Dict[str, Any]] = []

    def _message(self, deadline: float) -> Dict[str, Any]:
        self.ws.sock.settimeout(max(0.05, deadline - time.time()))
        try:
            return json.loads(self.ws.recv())
        except socket.timeout:
            raise CloakError("the page did not answer in time") from None

    def post(self, method: str, **params: Any) -> int:
        """Send a command without waiting for its answer (an intercepted navigation answers only once released)."""
        self.next_id += 1
        self.ws.send(json.dumps({"id": self.next_id, "method": method, "params": params}))
        return self.next_id

    def send(self, method: str, **params: Any) -> Dict[str, Any]:
        self.post(method, **params)
        deadline = time.time() + self.timeout
        while True:
            msg = self._message(deadline)
            if msg.get("id") == self.next_id:
                if "error" in msg:
                    raise CloakError(f"{method}: {msg['error'].get('message')}")
                return msg.get("result", {})
            if "method" in msg:
                self.events.append(msg)

    def next_event(self, deadline: float) -> Optional[Dict[str, Any]]:
        """The next queued or arriving event; None at the deadline. Answers to posted commands are skipped."""
        if self.events:
            return self.events.pop(0)
        while time.time() < deadline:
            try:
                msg = self._message(deadline)
            except CloakError:
                return None
            if "method" in msg:
                return msg
        return None

    def evaluate(self, expression: str) -> Any:
        result = self.send("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        if result.get("exceptionDetails"):
            raise CloakError(f"page script failed: {result['exceptionDetails'].get('text')}")
        return result.get("result", {}).get("value")


class Browser:
    """One headless CloakBrowser with a throwaway profile; close() stops it and deletes the profile."""

    def __init__(self, exe: Optional[Path] = None, timeout: float = 45.0):
        exe = exe or binary()
        if exe is None:
            raise CloakError("CloakBrowser is not installed: run `bunx cloakbrowser install` (or npx), "
                             "or set CLOAKBROWSER_BINARY_PATH")
        self.timeout = timeout
        self.profile = tempfile.mkdtemp(prefix="score-import-cloak-")
        platform = "macos" if sys.platform == "darwin" else "windows"
        self.proc = subprocess.Popen(
            [str(exe), "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={self.profile}",
             "--no-first-run", "--no-default-browser-check", "--no-sandbox", "--window-size=1280,900",
             f"--fingerprint={random.randint(10000, 99999)}", f"--fingerprint-platform={platform}", "about:blank"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        port_file, deadline = Path(self.profile) / "DevToolsActivePort", time.time() + timeout
        while not (port_file.is_file() and port_file.read_text().strip()):
            if self.proc.poll() is not None or time.time() > deadline:
                self.close()
                raise CloakError(f"CloakBrowser did not open its DevTools port (exit {self.proc.poll()}); "
                                 "on macOS run `xattr -dr com.apple.quarantine ~/.cloakbrowser` once")
            time.sleep(0.05)
        self.port = int(port_file.read_text().split()[0])
        self._page: Optional[Page] = None

    def page(self) -> Page:
        if self._page is None:
            targets = _local_json(f"http://127.0.0.1:{self.port}/json/list", self.timeout)
            target = next((t for t in targets if t.get("type") == "page"), None)
            if not target:
                raise CloakError("the browser has no page target")
            self._page = Page(WebSocket(target["webSocketDebuggerUrl"], self.timeout), self.timeout)
            self._page.send("Page.enable")
            self._page.send("Network.enable")
        return self._page

    def close(self) -> None:
        if self._page is not None:
            self._page.ws.close()
        if self.proc.poll() is None:
            try:
                os.killpg(self.proc.pid, signal.SIGTERM)
                self.proc.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    os.killpg(self.proc.pid, signal.SIGKILL)
                except OSError:
                    pass
                self.proc.wait()
        shutil.rmtree(self.profile, ignore_errors=True)

    def __enter__(self) -> "Browser":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # ---- navigation ---------------------------------------------------------------------------------------------------
    def goto(self, url: str, settle: float = 1.0) -> Dict[str, Any]:
        """Open url; wait for the load event and then for `settle` seconds without network activity. Returns the
        main document's {status, url, mimeType}."""
        page = self.page()
        page.events.clear()
        nav = page.send("Page.navigate", url=url)
        if nav.get("errorText"):
            raise CloakError(f"navigation failed: {nav['errorText']}")
        deadline, loaded, document = time.time() + self.timeout, False, {}
        inflight: set = set()
        quiet_since = None
        while time.time() < deadline:
            ev = page.next_event(min(deadline, time.time() + 0.25))
            if ev is not None:
                method, p = ev["method"], ev.get("params", {})
                if method == "Network.requestWillBeSent":
                    inflight.add(p.get("requestId"))
                elif method in ("Network.loadingFinished", "Network.loadingFailed"):
                    inflight.discard(p.get("requestId"))
                elif method == "Network.responseReceived" and p.get("type") == "Document" and p.get("loaderId") == nav.get("loaderId"):
                    r = p["response"]
                    document = {"status": r.get("status"), "url": r.get("url"), "mimeType": r.get("mimeType")}
                elif method == "Page.loadEventFired":
                    loaded = True
            if loaded:
                if inflight:
                    quiet_since = None
                elif quiet_since is None:
                    quiet_since = time.time()
                elif time.time() - quiet_since >= settle:
                    break
        return document

    def read_page(self) -> Dict[str, Any]:
        """Title, final url, visible text, every link, preformatted/code blocks, meta tags and HTML."""
        return json.loads(self.page().evaluate(EXTRACT_JS))

    def screenshot(self) -> bytes:
        return base64.b64decode(self.page().send("Page.captureScreenshot", format="png", captureBeyondViewport=False)["data"])

    def fetch_body(self, url: str, referer_settle: float = 0.5) -> Dict[str, Any]:
        """Navigate to url and capture the main response body, also when Chromium would download it instead of
        showing it. Returns {status, url, headers, body (bytes), mimeType}."""
        page = self.page()
        page.events.clear()
        page.send("Fetch.enable", patterns=[{"urlPattern": "*", "requestStage": "Response"}])
        try:
            page.post("Page.navigate", url=url)
            deadline, captured = time.time() + self.timeout, None
            while time.time() < deadline and captured is None:
                ev = page.next_event(deadline)
                if ev is None:
                    break
                if ev["method"] != "Fetch.requestPaused":
                    continue
                p = ev["params"]
                status = p.get("responseStatusCode") or 0
                is_main = p.get("resourceType") == "Document" or p["request"]["url"] == url
                if is_main and not 300 <= status < 400:
                    body = page.send("Fetch.getResponseBody", requestId=p["requestId"])
                    data = base64.b64decode(body["body"]) if body.get("base64Encoded") else body["body"].encode("utf-8")
                    headers = {h["name"].lower(): h["value"] for h in p.get("responseHeaders", [])}
                    captured = {"status": status, "url": p["request"]["url"], "headers": headers, "body": data,
                                "mimeType": headers.get("content-type", "")}
                    # The body is ours now: answer the request without letting Chromium render or download it.
                    page.send("Fetch.fulfillRequest", requestId=p["requestId"], responseCode=204)
                else:
                    page.send("Fetch.continueRequest", requestId=p["requestId"])
            if captured is None:
                raise CloakError(f"no response captured for {url}")
            time.sleep(referer_settle)
            return captured
        finally:
            try:
                page.send("Fetch.disable")
            except CloakError:
                pass


def wall(text: str, title: str = "") -> Optional[str]:
    """'challenge', 'login' or 'paywall' when a page blocks access; the skill stops there and tells the human."""
    probe = f"{title}\n{text[:4000]}".lower()
    for kind, pattern in WALLS:
        if re.search(pattern, probe):
            return kind
    return None


EXTRACT_JS = r"""JSON.stringify((() => {
  const abs = h => { try { return new URL(h, location.href).href; } catch { return null; } };
  const links = [...document.querySelectorAll('a[href]')].map(a => ({
    href: abs(a.getAttribute('href')), text: (a.innerText || a.getAttribute('title') || a.getAttribute('download') || '').trim().slice(0, 200),
    download: a.hasAttribute('download') })).filter(l => l.href && !l.href.startsWith('javascript:'));
  const blocks = [...document.querySelectorAll('pre, textarea, code, .abc, [class*="abc" i]')]
    .map(e => (e.value !== undefined && e.tagName === 'TEXTAREA' ? e.value : e.innerText || '').trim()).filter(t => t.length > 20);
  const meta = {};
  for (const m of document.querySelectorAll('meta[name], meta[property]')) meta[m.getAttribute('name') || m.getAttribute('property')] = m.content;
  return { title: document.title, url: location.href, text: document.body ? document.body.innerText : '', links,
    blocks: [...new Set(blocks)].slice(0, 50), meta, html: document.documentElement.outerHTML };
})())"""
