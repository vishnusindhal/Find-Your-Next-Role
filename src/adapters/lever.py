from __future__ import annotations

from .common import make_job, path_token


def fetch(company: str, url: str, fetcher) -> list[dict[str, object]]:
    token = path_token(url)
    if not token:
        raise ValueError("Lever site token not found in URL")
    endpoint = f"https://api.lever.co/v0/postings/{token}?mode=json"
    payload = fetcher.get_json(endpoint)
    if not isinstance(payload, list):
        raise ValueError("unexpected Lever response shape")
    jobs = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        categories = item.get("categories") or {}
        jobs.append(
            make_job(
                job_id=str(item.get("id", "")),
                company=company,
                title=str(item.get("text", "")),
                url=str(item.get("hostedUrl") or item.get("applyUrl") or ""),
                platform="lever",
                location=str(categories.get("location", "")),
                posted=str(item.get("createdAt", "")),
                description=str(item.get("description", "")),
            )
        )
    return [job for job in jobs if job["id"] != "lever:"]
