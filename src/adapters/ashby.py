from __future__ import annotations

from .common import make_job, path_token


def fetch(company: str, url: str, fetcher) -> list[dict[str, object]]:
    board = path_token(url)
    if not board:
        raise ValueError("Ashby job-board name not found in URL")
    endpoint = f"https://api.ashbyhq.com/posting-api/job-board/{board}"
    payload = fetcher.get_json(endpoint)
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise ValueError("unexpected Ashby response shape")
    jobs = []
    for item in payload["jobs"]:
        if not isinstance(item, dict):
            continue
        jobs.append(
            make_job(
                job_id=str(item.get("jobUrl") or item.get("id", "")),
                company=company,
                title=str(item.get("title", "")),
                url=str(item.get("jobUrl", "")),
                platform="ashby",
                location=", ".join(item.get("location", []) if isinstance(item.get("location"), list) else [str(item.get("location", ""))]),
                posted=str(item.get("publishedAt", "")),
                description=str(item.get("descriptionHtml") or item.get("description", "")),
            )
        )
    return [job for job in jobs if job["id"] != "ashby:"]
