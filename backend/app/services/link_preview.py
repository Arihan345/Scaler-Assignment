"""Link previews: fetch a page server-side and read its Open Graph tags.

The server making requests to user-supplied URLs is an SSRF risk, so this is deliberately strict: http(s) only,
every hop's host must resolve to public addresses only, redirects are followed manually (max 3) and re-checked,
the body is capped, and results are cached. (Residual risk, stated honestly: DNS can change between our check and
httpx's own lookup; production would pin the resolved IP.)
"""
import ipaddress
import socket
import time
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx

from app.core.config import settings
from app.core.errors import validation

MAX_BYTES = 256 * 1024
TIMEOUT_S = 4.0
CACHE_TTL_S = 3600
_cache: dict[str, tuple[float, dict | None]] = {}


def _check_public(url: str) -> None:
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise validation("Only http(s) links can be previewed")
    if getattr(settings, "link_preview_allow_private", False):  # tests only
        return
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror:
        raise validation("Couldn't resolve that link")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:  # loopback, private, link-local, metadata endpoints...
            raise validation("That link can't be previewed")


class _Meta(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, str] = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and a.get("content") and key not in self.meta:
                self.meta[key] = a["content"].strip()
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and len(self.title) < 200:
            self.title += data


def _fetch(url: str) -> tuple[str, str]:
    """Returns (final_url, html) following up to 3 validated redirects."""
    with httpx.Client(timeout=TIMEOUT_S, follow_redirects=False, headers={"User-Agent": "SignalCloneLinkPreview/1.0"}) as client:
        for _ in range(4):
            _check_public(url)
            with client.stream("GET", url) as r:
                if r.is_redirect and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                if r.status_code >= 400 or "html" not in r.headers.get("content-type", "").lower():
                    raise validation("No preview available")
                body = b""
                for chunk in r.iter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        break
                return url, body[:MAX_BYTES].decode(r.encoding or "utf-8", errors="replace")
    raise validation("Too many redirects")


def get_preview(url: str) -> dict | None:
    url = (url or "").strip()
    if len(url) > 2000:
        raise validation("Link is too long")
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return hit[1]
    try:
        final, html = _fetch(url)
    except httpx.HTTPError:
        raise validation("No preview available")
    p = _Meta()
    try:
        p.feed(html)
    except Exception:
        pass
    title = p.meta.get("og:title") or p.meta.get("twitter:title") or p.title.strip()
    desc = p.meta.get("og:description") or p.meta.get("description") or p.meta.get("twitter:description") or ""
    image = p.meta.get("og:image") or p.meta.get("twitter:image") or ""
    result = None
    if title:
        result = {
            "url": url,
            "title": title[:140],
            "description": desc[:240],
            "image": urljoin(final, image) if image.startswith(("http", "/")) else None,
            "site": urlparse(final).hostname,
        }
    if len(_cache) > 500:
        _cache.clear()
    _cache[url] = (time.time(), result)
    return result
