"""Conservative HTML fallback for simple, public career pages."""

from __future__ import annotations

import json
import re
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin
from urllib.parse import parse_qs, urlsplit

from .common import make_job


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self.text: list[str] = []
        self.json_ld: list[str] = []
        self._href = ""
        self._in_script = False
        self._script_type = ""
        self._script_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "a":
            self._href = attributes.get("href") or ""
        if tag == "script":
            self._in_script = True
            self._script_type = attributes.get("type") or ""
            self._script_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            self._href = ""
        if tag == "script" and self._in_script:
            if self._script_type.lower() == "application/ld+json":
                self.json_ld.append("".join(self._script_text))
            self._in_script = False

    def handle_data(self, data: str) -> None:
        if self._in_script:
            self._script_text.append(data)
        else:
            cleaned = re.sub(r"\s+", " ", unescape(data)).strip()
            if cleaned:
                self.text.append(cleaned)
                if self._href:
                    self.links.append((self._href, cleaned))


def _json_records(value: object) -> list[dict[str, object]]:
    if isinstance(value, dict):
        if value.get("@type") == "JobPosting" or (
            isinstance(value.get("@type"), list) and "JobPosting" in value["@type"]
        ):
            return [value]
        records: list[dict[str, object]] = []
        for nested in value.values():
            records.extend(_json_records(nested))
        return records
    if isinstance(value, list):
        records = []
        for item in value:
            records.extend(_json_records(item))
        return records
    return []


def _from_json_ld(company: str, page_url: str, scripts: list[str]) -> list[dict[str, object]]:
    jobs = []
    for script in scripts:
        try:
            payload = json.loads(script)
        except json.JSONDecodeError:
            continue
        for item in _json_records(payload):
            title = str(item.get("title", "")).strip()
            if not title:
                continue
            identifier = str(item.get("url") or item.get("identifier") or title)
            location = item.get("jobLocation", "")
            if isinstance(location, dict):
                address = location.get("address", {})
                location = ", ".join(
                    str(address.get(key, ""))
                    for key in ("addressLocality", "addressRegion", "addressCountry")
                    if address.get(key)
                )
            description = str(item.get("description", ""))
            jobs.append(
                make_job(
                    job_id=identifier,
                    company=company,
                    title=title,
                    url=urljoin(page_url, str(item.get("url") or page_url)),
                    platform="custom_html",
                    location=str(location),
                    posted=str(item.get("datePosted", "")),
                    description=description,
                )
            )
    return jobs


def fetch(company: str, url: str, fetcher) -> list[dict[str, object]]:
    parser = _PageParser()
    parser.feed(fetcher.get_text(url))
    jobs = _from_json_ld(company, url, parser.json_ld)
    if jobs:
        return jobs

    job_words = re.compile(r"\b(intern|internship|engineer|developer|software|data|machine learning|sde)\b", re.I)
    candidates = []
    seen: set[str] = set()
    for href, label in parser.links:
        absolute = urljoin(url, href)
        parsed = urlsplit(absolute)
        query_keys = {key.casefold() for key in parse_qs(parsed.query)}
        path = parsed.path.casefold()
        looks_like_detail = any(token in path for token in ("/job", "/career", "/position", "/opening", "/intern"))
        is_search_page = bool(query_keys.intersection({"q", "query", "search", "keyword", "location", "page"}))
        if (
            absolute in seen
            or absolute == url
            or not looks_like_detail
            or is_search_page
            or not job_words.search(label)
        ):
            continue
        seen.add(absolute)
        candidates.append(
            make_job(
                job_id=absolute,
                company=company,
                title=label,
                url=absolute,
                platform="custom_html",
                location="not mentioned",
                posted="",
                description="Job discovered from a visible career-page link; details require opening the job page.",
            )
        )
    return candidates
