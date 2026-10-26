"""Phase 1 batch runner."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from adapters import ashby, browser, greenhouse, html, lever
from digest import write_digest, write_tracker
from fetch import Fetcher
from filters import filter_job

ADAPTERS = {"greenhouse": greenhouse.fetch, "lever": lever.fetch, "ashby": ashby.fetch}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def load_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def append_jobs(path: Path, jobs: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for job in jobs:
            description = str(job.get("description_text", ""))
            job["content_hash"] = hashlib.sha256(description.encode("utf-8")).hexdigest()
            handle.write(json.dumps(job, ensure_ascii=False) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batches-dir", type=Path, default=Path("data/batches"))
    parser.add_argument("--jobs", type=Path, default=Path("data/jobs.jsonl"))
    parser.add_argument("--state", type=Path, default=Path("data/state.json"))
    parser.add_argument("--digest-dir", type=Path, default=Path("digests"))
    parser.add_argument("--tracker", type=Path, default=Path("data/tracker.csv"))
    parser.add_argument("--batch", type=int, help="run one batch only")
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--no-robots", action="store_true", help="only for controlled local testing")
    parser.add_argument(
        "--allow-robots-unavailable",
        action="store_true",
        help="allow requests when robots.txt cannot be read; use only after checking site terms",
    )
    parser.add_argument(
        "--browser-sites",
        type=Path,
        help="JSON array of explicitly approved company_id values for browser fallback",
    )
    args = parser.parse_args(argv)
    state = load_json(args.state, {"done": {}, "failed": {}})
    if not isinstance(state, dict):
        state = {"done": {}, "failed": {}}
    existing_jobs: list[dict[str, object]] = []
    if args.jobs.exists():
        for line in args.jobs.read_text(encoding="utf-8").splitlines():
            try:
                item = json.loads(line)
                if isinstance(item, dict):
                    existing_jobs.append(item)
            except json.JSONDecodeError:
                continue
    batches = sorted(args.batches_dir.glob("batch_*.csv"))
    if args.batch:
        batches = [path for path in batches if path.stem == f"batch_{args.batch:02d}"]
    fetcher = Fetcher(
        respect_robots=not args.no_robots,
        allow_robots_unavailable=args.allow_robots_unavailable,
    )
    browser_sites = set()
    if args.browser_sites:
        try:
            loaded = json.loads(args.browser_sites.read_text(encoding="utf-8"))
            if not isinstance(loaded, list):
                raise ValueError("browser-sites must contain a JSON array")
            browser_sites = {str(item) for item in loaded}
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            print(f"Invalid --browser-sites file: {exc}", file=sys.stderr)
            return 2
    failures: list[dict[str, str]] = []
    manual: list[dict[str, str]] = []
    for batch_path in batches:
        batch_id = batch_path.stem
        previous_failure = state.get("failed", {}).get(batch_id, {})
        if (
            not args.batch
            and batch_id in state["done"]
            and not previous_failure
        ):
            continue
        if not args.batch and previous_failure.get("attempts", 0) >= 2:
            continue
        companies = read_csv(batch_path)

        def process(company: dict[str, str]) -> tuple[list[dict[str, object]], dict[str, str] | None, dict[str, str] | None]:
            platform = company.get("platform", "custom")
            if company.get("link_flag") == "skipped_third_party":
                return [], None, {"company": company["company"], "url": company["clean_url"], "reason": "forbidden third-party source"}
            try:
                if platform in ADAPTERS:
                    jobs = ADAPTERS[platform](company["company"], company["clean_url"], fetcher)
                elif company.get("company_id") in browser_sites:
                    jobs = browser.fetch(company["company"], company["clean_url"])
                else:
                    jobs = html.fetch(company["company"], company["clean_url"], fetcher)
                selected = []
                for job in jobs:
                    keep, reasons = filter_job(job)
                    if keep:
                        job["score_reasons"] = reasons
                        selected.append(job)
                if selected:
                    return selected, None, None
                return [], None, {"company": company["company"], "url": company["clean_url"], "reason": "no reliable job records found by allowed adapter"}
            except Exception as exc:
                return [], {"company": company["company"], "reason": str(exc)}, None

        batch_jobs: list[dict[str, object]] = []
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = [executor.submit(process, company) for company in companies]
            for future in as_completed(futures):
                jobs, failure, manual_item = future.result()
                batch_jobs.extend(jobs)
                if failure:
                    failures.append(failure)
                if manual_item:
                    manual.append(manual_item)
        append_jobs(args.jobs, batch_jobs)
        existing_jobs.extend(batch_jobs)
        for company in companies:
            if company.get("platform") not in ADAPTERS and company.get("company_id") not in browser_sites:
                continue
        state["done"][batch_id] = {"jobs": len(batch_jobs)}
        if batch_failures := [item for item in failures if item["company"] in {company["company"] for company in companies}]:
            state.setdefault("failed", {})[batch_id] = {
                "attempts": state.get("failed", {}).get(batch_id, {}).get("attempts", 0) + 1,
                "companies": batch_failures,
            }
        else:
            state.setdefault("failed", {}).pop(batch_id, None)
        save_json(args.state, state)
        digest_path = args.digest_dir / f"{__import__('datetime').date.today().isoformat()}.html"
        write_digest(digest_path, existing_jobs, manual, failures)
        write_tracker(args.tracker, existing_jobs)
    print(f"processed_batches={len(batches)}")
    print(f"jobs_selected={len(existing_jobs)}")
    print(f"manual_check={len(manual)}")
    print(f"failures={len(failures)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
