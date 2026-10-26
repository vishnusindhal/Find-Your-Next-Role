from __future__ import annotations

from .common import make_job, path_token


def fetch(company: str, url: str, fetcher) -> list[dict[str, object]]:
    token = path_token(url)
    if not token:
        raise ValueError("Greenhouse board token not found in URL")
    endpoint = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
    payload = fetcher.get_json(endpoint)
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise ValueError("unexpected Greenhouse response shape")
    jobs = []
    for item in payload["jobs"]:
        if not isinstance(item, dict):
            continue
        jobs.append(
            make_job(
                job_id=str(item.get("id", "")),
                company=company,
                title=str(item.get("title", "")),
                url=str(item.get("absolute_url", "")),
                platform="greenhouse",
                location=str((item.get("location") or {}).get("name", "")),
                posted=str(item.get("updated_at", "")),
                description=str(item.get("content", "")),
            )
        )
    return [job for job in jobs if job["id"] != "greenhouse:"]
