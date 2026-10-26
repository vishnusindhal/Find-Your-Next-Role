from __future__ import annotations

import re


DEFAULT_PROFILE = {
    "locations_ok": ["India", "Remote"],
    "job_types": ["intern", "full-time"],
    "target_roles": [
        "sde intern",
        "software engineer",
        "backend developer",
        "full-stack developer",
        "system software engineer",
        "data engineer",
        "ml engineer",
    ],
    "keywords_include": ["intern", "internship", "2027", "graduate", "new grad", "fresher", "sde", "backend", "full stack"],
    "keywords_avoid": ["senior", "staff", "principal", "lead", "manager", "5+ years", "3+ years", "director"],
}


def _contains(text: str, words: list[str]) -> bool:
    lowered = text.casefold()
    return any(word.casefold() in lowered for word in words)


def filter_job(job: dict[str, object], profile: dict[str, object] | None = None) -> tuple[bool, list[str]]:
    profile = {**DEFAULT_PROFILE, **(profile or {})}
    title = str(job.get("title", ""))
    location = str(job.get("location", ""))
    text = f"{title} {job.get('description_text', '')}"
    reasons: list[str] = []
    if _contains(title, list(profile["keywords_avoid"])):
        return False, ["title contains an avoid keyword"]
    if not _contains(text, list(profile["keywords_include"])) and not _contains(title, list(profile["target_roles"])):
        return False, ["role does not match target keywords"]
    allowed_locations = list(profile["locations_ok"])
    if allowed_locations and location != "not mentioned" and not _contains(location, allowed_locations):
        return False, ["location is outside configured locations"]
    job_type = str(job.get("type", "unknown"))
    if job_type != "unknown" and job_type not in list(profile["job_types"]):
        return False, ["job type is outside configured types"]
    if job_type == "unknown":
        reasons.append("job type unclear")
    if location == "not mentioned":
        reasons.append("location unclear")
    return True, reasons or ["matches configured role and location rules"]
