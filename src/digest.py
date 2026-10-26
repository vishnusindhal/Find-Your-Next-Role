from __future__ import annotations

import csv
import html
from datetime import date
from pathlib import Path


def write_tracker(path: Path, jobs: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["id", "company", "title", "url", "location", "type", "posted", "status"]
    existing: dict[str, str] = {}
    if path.exists():
        with path.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                existing[row["id"]] = row.get("status", "new")
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for job in jobs:
            writer.writerow({field: job.get(field, "") if field != "status" else existing.get(str(job["id"]), "new") for field in fields})


def write_digest(path: Path, jobs: list[dict[str, object]], manual: list[dict[str, str]], failures: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    grouped = {"intern": [], "full-time": [], "unknown": []}
    for job in jobs:
        grouped.setdefault(str(job.get("type", "unknown")), []).append(job)

    def section(title: str, values: list[dict[str, object]]) -> str:
        cards = []
        for job in values:
            cards.append(
                "<article><h3><a href='{}'>{}</a></h3><p><b>{}</b> | {} | {}</p>"
                "<p>{}</p><p>Pay: not mentioned | Posted: {}</p></article>".format(
                    html.escape(str(job.get("url", "")), quote=True),
                    html.escape(str(job.get("title", ""))),
                    html.escape(str(job.get("company", ""))),
                    html.escape(str(job.get("location", ""))),
                    html.escape(str(job.get("type", "unknown"))),
                    html.escape(str(job.get("summary", ""))),
                    html.escape(str(job.get("posted", "")) or "not mentioned"),
                )
            )
        return f"<h2>{title}</h2>" + ("".join(cards) or "<p>None found.</p>")

    manual_html = "".join(
        f"<li>{html.escape(item['company'])}: <a href='{html.escape(item['url'], quote=True)}'>{html.escape(item['url'])}</a></li>"
        for item in manual
    )
    failure_html = "".join(
        f"<li>{html.escape(item['company'])}: {html.escape(item['reason'])}</li>" for item in failures
    )
    body = (
        "<!doctype html><meta charset='utf-8'><title>Job digest</title>"
        "<style>body{font-family:Arial;max-width:1000px;margin:2rem auto}article{border:1px solid #ddd;padding:1rem;margin:1rem 0}a{color:#0645ad}</style>"
        f"<h1>Job digest - {date.today().isoformat()}</h1>"
        + section("Internships", grouped["intern"])
        + section("Full-time", grouped["full-time"])
        + section("Other / unclear type", grouped["unknown"])
        + f"<h2>Check manually</h2><ul>{manual_html or '<li>None</li>'}</ul>"
        + f"<h2>Coverage and failures</h2><ul>{failure_html or '<li>No failures recorded</li>'}</ul>"
    )
    path.write_text(body, encoding="utf-8")
