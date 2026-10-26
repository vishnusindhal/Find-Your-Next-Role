"""Phase 0: clean, classify, deduplicate, and batch company career links."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable


PLATFORMS = {
    "greenhouse": ("greenhouse.io", "boards.greenhouse.io"),
    "lever": ("lever.co", "jobs.lever.co"),
    "ashby": ("ashbyhq.com", "jobs.ashbyhq.com"),
    "workday": ("myworkdayjobs.com",),
    "workable": ("apply.workable.com", "workable.com"),
    "recruitee": ("recruitee.com",),
    "freshteam": ("freshteam.com",),
    "darwinbox": ("darwinbox.in", "darwinbox.com"),
    "skillate": ("skillate.com",),
    "zohorecruit": ("zohorecruit.com",),
    "recruiterbox": ("recruiterbox.com",),
    "peoplestrong": ("peoplestrong.com",),
    "oracle_cloud": ("oraclecloud.com",),
    "avature": ("avature.net",),
    "eightfold": ("eightfold.ai",),
    "icims": ("icims.com",),
    "smartrecruiters": ("smartrecruiters.com",),
    "gr8people": ("gr8people.com",),
    "param.ai": ("param.ai",),
}

THIRD_PARTY_DOMAINS = {
    "linkedin.com",
    "naukri.com",
    "angel.co",
    "angelist.com",
    "instahyre.com",
    "indeed.com",
    "glassdoor.com",
    "careerbliss.com",
}

REVIEW_DOMAINS = {"notion.so", "docs.google.com", "drive.google.com"}
DEFUNCT_OR_RENAMED = {
    "twitter",
    "xilinx",
    "cerner",
    "vmware",
    "credit suisse",
    "ihs markit",
    "fireeye",
    "symantec",
}
TRACKING_PARAMS = {"fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source"}
USER_AGENT = "job-agent-phase0/1.0 (polite URL checker)"


@dataclass
class Company:
    company_id: str
    company: str
    original_url: str
    clean_url: str
    final_url: str = ""
    platform: str = "custom"
    status: str = "not_probed"
    link_flag: str = ""
    flag_reason: str = ""
    my_checked: str = ""
    my_note: str = ""


def _domain(url: str) -> str:
    return (urllib.parse.urlparse(url).hostname or "").lower().removeprefix("www.")


def _domain_matches(domain: str, candidate: str) -> bool:
    return domain == candidate or domain.endswith("." + candidate)


def normalize_url(value: object) -> str:
    """Return a canonical HTTP(S) URL while removing common tracking junk."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.startswith("//"):
        raw = "https:" + raw
    elif not re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.I):
        raw = "https://" + raw
    parsed = urllib.parse.urlsplit(raw)
    scheme = parsed.scheme.lower() or "https"
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return ""
    try:
        port = parsed.port
    except ValueError:
        port = None
    host = hostname if not port or port in (80, 443) else f"{hostname}:{port}"
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if path != "/":
        path = path.rstrip("/")
    query = urllib.parse.urlencode(
        [
            (key, value)
            for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() not in TRACKING_PARAMS and not key.lower().startswith("utm_")
        ]
    )
    return urllib.parse.urlunsplit((scheme, host, path, query, ""))


def detect_platform(url: str, html: str = "") -> str:
    """Detect a supported ATS from a URL or embedded page signals."""
    haystack = f"{url}\n{html}".lower()
    for platform, domains in PLATFORMS.items():
        if any(domain in haystack for domain in domains):
            return platform
    return "custom"


def _tokens(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", value.lower())
        if len(token) >= 3
    }


def classify_link(company: str, url: str, platform: str) -> tuple[str, str]:
    domain = _domain(url)
    if any(_domain_matches(domain, item) for item in THIRD_PARTY_DOMAINS):
        return "skipped_third_party", f"forbidden third-party job board domain: {domain}"
    if any(_domain_matches(domain, item) for item in REVIEW_DOMAINS):
        return "review", f"generic document/workspace domain: {domain}"
    if re.match(r"^(qa|stage|staging|test)[.-]", domain):
        return "review", "QA, staging, or test subdomain"
    if platform == "custom":
        company_tokens = _tokens(company)
        domain_tokens = _tokens(domain.split(".")[0])
        if company_tokens and domain_tokens and not company_tokens.intersection(domain_tokens):
            return "review", "domain does not visibly match the company name"
    parsed = urllib.parse.urlsplit(url)
    if parsed.path in ("", "/") and platform == "custom":
        return "review", "homepage URL has no visible career path"
    if company.lower().strip() in DEFUNCT_OR_RENAMED:
        return "review", "company may be defunct or renamed"
    return "", ""


def _header_map(row: list[object]) -> dict[str, int]:
    aliases = {
        "company": {"company", "company name", "name", "employer"},
        "url": {"url", "career url", "career page / source url", "career page", "source url"},
        "checked": {"my checked", "checked", "status", "checked flag"},
        "note": {"note", "notes", "my note", "result"},
    }
    result: dict[str, int] = {}
    for index, value in enumerate(row):
        normalized = re.sub(r"\s+", " ", str(value or "").strip().lower())
        for key, names in aliases.items():
            if normalized in names:
                result[key] = index
    return result


def read_companies(path: Path) -> list[dict[str, str]]:
    try:
        import openpyxl
    except ImportError as exc:
        raise RuntimeError(
            "openpyxl is required. Install dependencies with: python -m pip install -r requirements.txt"
        ) from exc
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = [list(row) for row in sheet.iter_rows(values_only=True)]
    if not rows:
        return []
    headers = _header_map(rows[0])
    has_header = "company" in headers or "url" in headers
    start = 1 if has_header else 0
    if not has_header:
        headers = {"company": 0, "url": 1}
        if len(rows[0]) >= 5:
            headers.update({"checked": 4})
        if len(rows[0]) >= 6:
            headers["note"] = 5
    records = []
    for row in rows[start:]:
        def value(key: str) -> str:
            index = headers.get(key)
            return str(row[index]).strip() if index is not None and index < len(row) and row[index] is not None else ""

        company, url = value("company"), value("url")
        if company or url:
            records.append({"company": company, "url": url, "checked": value("checked"), "note": value("note")})
    return records


def _company_id(company: str, url: str) -> str:
    source = f"{company.lower().strip()}|{_domain(url)}"
    return hashlib.sha1(source.encode("utf-8")).hexdigest()[:12]


def clean_companies(records: Iterable[dict[str, str]]) -> tuple[list[Company], int]:
    merged: dict[str, Company] = {}
    duplicates = 0
    for record in records:
        company = re.sub(r"\s+", " ", record["company"]).strip()
        clean_url = normalize_url(record["url"])
        if not company or not clean_url:
            continue
        platform = detect_platform(clean_url)
        link_flag, reason = classify_link(company, clean_url, platform)
        key = company.casefold() or _domain(clean_url)
        domain_key = _domain(clean_url)
        existing_key = next(
            (candidate for candidate in merged if candidate == key or _domain(merged[candidate].clean_url) == domain_key),
            None,
        )
        if existing_key is not None:
            duplicates += 1
            existing = merged[existing_key]
            if record["checked"] and not existing.my_checked:
                existing.my_checked = record["checked"]
            if record["note"] and not existing.my_note:
                existing.my_note = record["note"]
            continue
        merged[key] = Company(
            company_id=_company_id(company, clean_url),
            company=company,
            original_url=record["url"],
            clean_url=clean_url,
            platform=platform,
            link_flag=link_flag,
            flag_reason=reason,
            my_checked=record["checked"],
            my_note=record["note"],
        )
    return list(merged.values()), duplicates


def _probe_one(company: Company, timeout: float, respect_robots: bool) -> Company:
    parsed = urllib.parse.urlsplit(company.clean_url)
    try:
        if respect_robots:
            robots = urllib.robotparser.RobotFileParser()
            robots.set_url(f"{parsed.scheme}://{parsed.netloc}/robots.txt")
            robots.read()
            if not robots.can_fetch(USER_AGENT, company.clean_url):
                company.status, company.final_url = "blocked", company.clean_url
                return company
        request = urllib.request.Request(company.clean_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            final_url = response.geturl()
            body = response.read(250_000).decode("utf-8", errors="ignore")
        company.final_url = final_url
        detected = detect_platform(final_url, body)
        if company.platform == "custom" and detected != "custom":
            company.platform = detected
        company.status = "redirected" if normalize_url(final_url) != company.clean_url else "alive"
    except urllib.error.HTTPError as exc:
        company.status = "blocked" if exc.code in (401, 403, 429) else "dead"
        company.final_url = company.clean_url
    except TimeoutError:
        company.status, company.final_url = "timeout", company.clean_url
    except (urllib.error.URLError, OSError):
        company.status, company.final_url = "dead", company.clean_url
    return company


def probe_companies(companies: list[Company], timeout: float = 10, workers: int = 5) -> None:
    """Probe politely with one request per domain at a time."""
    last_request: dict[str, float] = {}

    def probe(company: Company) -> Company:
        domain = _domain(company.clean_url)
        elapsed = time.monotonic() - last_request.get(domain, 0)
        if elapsed < 1:
            time.sleep(1 - elapsed)
        last_request[domain] = time.monotonic()
        return _probe_one(company, timeout, respect_robots=True)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(probe, company) for company in companies]
        for future in as_completed(futures):
            future.result()


def _sort_key(company: Company) -> tuple[int, int, str]:
    platform_rank = 0 if company.platform != "custom" else 1
    checked_rank = 0 if company.my_checked.casefold() in {"yes", "y", "true"} else 1
    review_rank = 1 if company.link_flag in {"review", "skipped_third_party"} else 0
    return (review_rank, platform_rank, checked_rank, company.company.casefold())


def write_csv(path: Path, companies: Iterable[Company]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(Company.__dataclass_fields__)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(asdict(company) for company in companies)


def write_batches(directory: Path, companies: list[Company], batch_size: int = 50) -> int:
    directory.mkdir(parents=True, exist_ok=True)
    for old_file in directory.glob("batch_*.csv"):
        old_file.unlink()
    count = 0
    for start in range(0, len(companies), batch_size):
        count += 1
        write_csv(directory / f"batch_{count:02d}.csv", companies[start : start + batch_size])
    return count


def coverage_report(companies: list[Company], duplicates: int, batches: int) -> str:
    platforms = Counter(company.platform for company in companies)
    flags = Counter(company.link_flag or "clean" for company in companies)
    statuses = Counter(company.status for company in companies)
    lines = [
        "Phase 0 coverage report",
        f"total rows after deduplication: {len(companies)}",
        f"duplicates merged: {duplicates}",
        f"batches written: {batches}",
        f"third-party skipped: {flags['skipped_third_party']}",
        f"flagged for review: {flags['review']}",
        "platforms: " + ", ".join(f"{key}={value}" for key, value in sorted(platforms.items())),
        "statuses: " + ", ".join(f"{key}={value}" for key, value in sorted(statuses.items())),
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/companies.xlsx"))
    parser.add_argument("--output", type=Path, default=Path("data/companies_clean.csv"))
    parser.add_argument("--batches-dir", type=Path, default=Path("data/batches"))
    parser.add_argument("--probe", action="store_true", help="check URLs politely and respect robots.txt")
    parser.add_argument("--timeout", type=float, default=10)
    args = parser.parse_args(argv)
    if not args.input.exists():
        print(f"Input workbook not found: {args.input}", file=sys.stderr)
        return 2
    try:
        companies, duplicates = clean_companies(read_companies(args.input))
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if args.probe:
        probe_companies(companies, timeout=args.timeout)
    companies.sort(key=_sort_key)
    write_csv(args.output, companies)
    batches = write_batches(args.batches_dir, companies)
    print(coverage_report(companies, duplicates, batches))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
