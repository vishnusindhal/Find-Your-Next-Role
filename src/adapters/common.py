from __future__ import annotations

import re
from datetime import date
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit


class HTMLTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def clean_html(value: object) -> str:
    parser = HTMLTextParser()
    parser.feed(unescape(str(value or "")))
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def path_token(url: str, index_from_end: int = 1) -> str:
    parts = [part for part in urlsplit(url).path.split("/") if part]
    if len(parts) < index_from_end:
        return ""
    return parts[-index_from_end]


def iso_date(value: object) -> str:
    text = str(value or "").strip()
    return text[:10] if re.match(r"\d{4}-\d{2}-\d{2}", text) else ""


def classify_type(title: str, description: str) -> str:
    text = f"{title} {description}".lower()
    if re.search(r"\b(intern|internship|co[- ]op)\b", text):
        return "intern"
    if re.search(r"\b(full[- ]time|new grad|graduate|software engineer)\b", text):
        return "full-time"
    return "unknown"


def make_job(
    *,
    job_id: str,
    company: str,
    title: str,
    url: str,
    platform: str,
    location: str,
    posted: str,
    description: str,
) -> dict[str, object]:
    cleaned = clean_html(description)
    return {
        "id": f"{platform}:{job_id}",
        "company": company,
        "title": title.strip(),
        "url": url,
        "source_platform": platform,
        "type": classify_type(title, cleaned),
        "location": location.strip() or "not mentioned",
        "posted": iso_date(posted),
        "deadline": {"value": None, "evidence": None},
        "pay": {"value": None, "currency": None, "period": None, "evidence": None},
        "eligibility": {"status": "unclear", "evidence": None, "reason": "Phase 2 extraction pending"},
        "required_skills": [],
        "matched_skills": [],
        "missing_skills": [],
        "score": 0.0,
        "score_reasons": [],
        "summary": cleaned[:400],
        "description_text": cleaned,
        "first_seen": date.today().isoformat(),
        "last_seen": date.today().isoformat(),
        "content_hash": "",
    }
