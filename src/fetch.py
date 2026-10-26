"""Polite HTTP helpers used by the Phase 1 job fetcher."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
import urllib.robotparser
from dataclasses import dataclass
from urllib.parse import urlsplit


USER_AGENT = "job-agent-phase1/1.0 (personal research; polite crawler)"


class FetchError(RuntimeError):
    """A fetch failed in a way that should be recorded, not crash the run."""


@dataclass
class Fetcher:
    timeout: float = 15.0
    retries: int = 2
    delay_seconds: float = 1.0
    respect_robots: bool = True
    allow_robots_unavailable: bool = False

    def __post_init__(self) -> None:
        self._lock = threading.Lock()
        self._last_request: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}

    def _wait_for_domain(self, domain: str) -> None:
        with self._lock:
            elapsed = time.monotonic() - self._last_request.get(domain, 0)
            if elapsed < self.delay_seconds:
                time.sleep(self.delay_seconds - elapsed)
            self._last_request[domain] = time.monotonic()

    def _allowed_by_robots(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        parsed = urlsplit(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        with self._lock:
            parser = self._robots.get(origin)
        if parser is None:
            parser = urllib.robotparser.RobotFileParser(f"{origin}/robots.txt")
            try:
                parser.read()
            except (OSError, urllib.error.URLError):
                return self.allow_robots_unavailable
            with self._lock:
                self._robots[origin] = parser
        return parser.can_fetch(USER_AGENT, url)

    def get_bytes(self, url: str, accept: str = "application/json") -> bytes:
        domain = urlsplit(url).netloc.lower()
        if not domain:
            raise FetchError("invalid URL")
        if not self._allowed_by_robots(url):
            raise FetchError("blocked by robots.txt or robots.txt unavailable")
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            self._wait_for_domain(domain)
            request = urllib.request.Request(
                url,
                headers={"Accept": accept, "User-Agent": USER_AGENT},
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return response.read()
            except (OSError, urllib.error.URLError, TimeoutError) as exc:
                last_error = exc
                if attempt < self.retries:
                    time.sleep(2**attempt)
        raise FetchError(str(last_error or "request failed"))

    def get_json(self, url: str) -> object:
        try:
            return json.loads(self.get_bytes(url).decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise FetchError(f"invalid JSON response: {exc}") from exc

    def get_text(self, url: str) -> str:
        return self.get_bytes(url, accept="text/html,application/xhtml+xml").decode(
            "utf-8", errors="replace"
        )
