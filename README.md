# Find Your Next Role — Job Agent

An automated pipeline that discovers job listings from company career pages, filters
them against your profile, and displays the results in a React dashboard. The agent
never submits applications, sends messages, or uses LinkedIn.

---

## High-level architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            INPUT                                        │
│  All_Companies_Career_Pages.xlsx  (raw company + URL spreadsheet)        │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │
                     ┌───────────▼───────────┐
                     │  Phase 0 — Cleaner    │   src/phase0_clean.py
                     │  normalize URLs        │
                     │  detect ATS platform   │
                     │  classify / flag links │
                     │  deduplicate           │
                     │  optional HTTP probe   │
                     │  write batches         │
                     └───────────┬───────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
    data/companies_clean.csv   data/batches/       data/state.json
                           batch_01.csv …
              │                  │
              │   ┌──────────────▼──────────────┐
              │   │  Phase 1 — Batch Runner     │   src/main.py
              │   │  per-company adapter chain:  │
              │   │   1. JSON ATS adapters       │   adapters/greenhouse, lever, ashby
              │   │   2. HTML fallback           │   adapters/html.py
              │   │   3. Browser fallback        │   adapters/browser.py (opt-in)
              │   │  filter against profile      │   src/filters.py
              │   │  append matched jobs         │
              │   └──────┬────────────┬──────────┘
              │          │            │
              │   data/jobs.jsonl   digests/<date>.html
              │          │            data/tracker.csv
              │          │
              │   ┌──────▼──────────────────────┐
              │   │  JS Scanner (parallel path) │   js_fetch/scan.mjs
              │   │  priority company list       │   js_fetch/priority_companies.json
              │   │  native fetch + JSON-LD      │
              │   │  opt-in Playwright browser   │
              │   └──────┬──────────────────────┘
              │          │
              │   data/js_jobs.jsonl
              │   data/js_jobs_browser.jsonl
              │   data/js_scan_report.json
              │          │
              │   ┌──────▼──────────────────────┐
              │   │  Resolve Apply URLs         │   js_fetch/resolve_apply_urls.mjs
              │   │  follow 2-step Apply Now     │
              │   │  record external destination │
              │   └──────┬──────────────────────┘
              │          │
              │   data/thejobcompany_jobs.jsonl (with apply_url)
              │          │
              └──────────┼──────────────────────┐
                         ▼                      ▼
              ┌─────────────────────────────────────┐
              │  Dashboard (job-dashboard/)          │
              │  Express API  →  MongoDB  →  React  │
              │  import:real script loads JSONL data │
              │  search, filter, track job status    │
              └─────────────────────────────────────┘
```

---

## End-to-end workflow

### 1. Phase 0 — Clean and classify (`src/phase0_clean.py`)

Reads the Excel spreadsheet, and for every row:

1. **Normalizes the URL** — adds `https://`, strips tracking params (`utm_*`,
   `fbclid`, etc.), collapses duplicate slashes, removes trailing slashes.
2. **Detects the ATS platform** — matches the domain against 18 known platforms
   (Greenhouse, Lever, Ashby, Workday, Darwinbox, etc.).
3. **Classifies the link** — flags third-party job boards (LinkedIn, Naukri, etc.)
   as `skipped_third_party`, flags staging/QA subdomains and Notion/Google Docs URLs
   as `review`, flags homepage-only URLs or domain-name mismatches.
4. **Deduplicates** — merges rows that share the same company name (case-insensitive)
   or domain.
5. **Optionally probes** (`--probe`) — makes a single polite HEAD/GET request per
   domain (respecting robots.txt) to check if the URL is alive, redirected, blocked,
   or dead, and re-detects the platform from the final landing page.
6. **Sorts** companies by priority (known ATS first, user-checked first, flagged last)
   and splits them into batch CSV files of 50 each in `data/batches/`.

**Outputs:**
| File | Purpose |
|------|---------|
| `data/companies_clean.csv` | Full cleaned + classified company list |
| `data/batches/batch_01.csv` … | Batched subsets for the Phase 1 runner |

---

### 2. Phase 1 — Batch runner (`src/main.py`)

Processes each batch CSV through a **four-tier adapter chain**, with up to 5
concurrent workers per batch:

| Priority | Adapter | When used | Source |
|----------|---------|-----------|--------|
| 1 | **Greenhouse** | URL contains `greenhouse.io` | `adapters/greenhouse.py` — calls `boards-api.greenhouse.io` JSON API |
| 2 | **Lever** | URL contains `lever.co` | `adapters/lever.py` — calls `api.lever.co` JSON API |
| 3 | **Ashby** | URL contains `ashbyhq.com` | `adapters/ashby.py` — calls `api.ashbyhq.com` JSON API |
| 4 | **HTML fallback** | Platform is `custom` and not browser-approved | `adapters/html.py` — fetches HTML, prefers JSON-LD `JobPosting` schema, falls back to visible link extraction |
| 5 | **Browser fallback** | Company ID is in the `--browser-sites` JSON file | `adapters/browser.py` — launches headless Chromium via Playwright, renders JS, then runs the HTML parser on the rendered DOM |

Every discovered job passes through **`filters.py`**, which applies your profile:

- **Include keywords:** intern, internship, 2027, graduate, new grad, fresher, sde,
  backend, full stack.
- **Avoid keywords in title:** senior, staff, principal, lead, manager, 5+ years,
  3+ years, director.
- **Allowed locations:** India, Remote.
- **Job types:** intern, full-time.
- **Target roles:** sde intern, software engineer, backend developer, full-stack
  developer, system software engineer, data engineer, ml engineer.

Matched jobs are appended to `data/jobs.jsonl`. After each batch the runner also:

- Updates `data/state.json` (tracks which batches are done, which failed, retry count).
- Writes an HTML digest to `digests/<date>.html` with Internship / Full-time /
  Other sections, a manual-check list, and a failure log.
- Writes `data/tracker.csv` for simple spreadsheet tracking.

---

### 3. JS Scanner (`js_fetch/scan.mjs`)

A parallel Node.js path for a curated list of **priority companies**
(`js_fetch/priority_companies.json` — Google, Amazon, Microsoft, Flipkart, Razorpay,
Groww, CRED, Meesho, etc.).

- **Default mode** — uses native `fetch()` to download career page HTML, extracts
  `JSON-LD JobPosting` records.
- **`--browser` mode** — launches Playwright Chromium for approved companies (passed
  via `--browser-sites "Groww,Meesho"`). Crawls up to 12 pages (follows career/jobs
  links and pagination up to depth 2), clicks "Load More" buttons, visits up to 50
  individual job detail pages, extracts JSON-LD or renders the full page text.
- Respects robots.txt, rate-limits to 1.2 s per domain.

**Outputs:**
| File | Content |
|------|---------|
| `data/js_jobs.jsonl` | Default-mode results |
| `data/js_jobs_browser.jsonl` | Browser-mode results |
| `data/js_jobs_other.jsonl` | Non-browser priority results |
| `data/js_scan_report.json` | Per-company status report |

---

### 4. Resolve Apply URLs (`js_fetch/resolve_apply_urls.mjs`)

For The Job Company listings (`data/thejobcompany_jobs.jsonl`), this script:

1. Opens each job URL in headless Chromium.
2. Finds the first visible "Apply Now" button/link.
3. Navigates to the intermediate page, waits 5 seconds.
4. Clicks the second "Apply" button or follows the redirect.
5. Records the final external URL as `apply_url` (only if it's a direct employer
   page — filters out LinkedIn, Naukri, login/signup pages).

This script **never** fills forms or submits applications.

---

### 5. Dashboard (`job-dashboard/`)

A full-stack web application that displays agent output:

| Layer | Tech | Location |
|-------|------|----------|
| **API** | Express.js + Mongoose | `job-dashboard/server/` |
| **Database** | MongoDB (local or Atlas) | configured in `server/.env` |
| **UI** | React + Vite | `job-dashboard/client/` |

**Features:**
- Search by title or company.
- Filter by minimum score, location, job type (intern / full-time).
- Default sort by deadline → posted date → score.
- Job detail view with pay, deadline, eligibility evidence.
- Status tracking (new → applied → rejected, etc.) persisted in MongoDB.
- Employer application URLs and company LinkedIn links.

**API endpoints:**
```
GET   /api/health
GET   /api/jobs           ?type=intern&pageSize=12&search=...
GET   /api/jobs/:id
PATCH /api/tracker/:jobId
```

**Data import:** `npm run import:real` loads JSONL files from `data/` into MongoDB,
replacing existing collections.

---

## File map

```
job agent/
├── All_Companies_Career_Pages.xlsx   ← raw input spreadsheet
├── requirements.txt                  ← Python deps (openpyxl)
├── src/
│   ├── phase0_clean.py               ← Phase 0: clean, classify, batch
│   ├── main.py                       ← Phase 1: batch runner
│   ├── fetch.py                      ← Polite HTTP client (rate-limit, robots.txt, retry)
│   ├── filters.py                    ← Job filtering against your profile
│   ├── digest.py                     ← HTML digest + tracker CSV writer
│   └── adapters/
│       ├── common.py                 ← Shared: make_job(), classify_type(), clean_html()
│       ├── greenhouse.py             ← Greenhouse JSON API adapter
│       ├── lever.py                  ← Lever JSON API adapter
│       ├── ashby.py                  ← Ashby JSON API adapter
│       ├── html.py                   ← HTML fallback: JSON-LD + visible link extraction
│       └── browser.py                ← Playwright browser fallback (opt-in)
├── js_fetch/
│   ├── priority_companies.json       ← Curated priority company list
│   ├── scan.mjs                      ← JS scanner (fetch + optional Playwright)
│   ├── resolve_apply_urls.mjs        ← 2-step Apply URL resolver
│   └── README.md                     ← JS scanner docs
├── data/
│   ├── companies_clean.csv           ← Phase 0 output
│   ├── batches/batch_01.csv …        ← Phase 0 batches
│   ├── jobs.jsonl                    ← Phase 1 output (append-only)
│   ├── state.json                    ← Batch progress + failure tracking
│   ├── tracker.csv                   ← Simple job status tracker
│   ├── js_jobs.jsonl                 ← JS scanner output
│   ├── js_jobs_browser.jsonl         ← JS browser-mode output
│   ├── js_jobs_other.jsonl           ← JS non-browser output
│   ├── js_scan_report.json           ← JS scan per-company report
│   ├── js_scan_browser_report.json   ← JS browser scan report
│   ├── js_scan_other_report.json     ← JS other scan report
│   └── thejobcompany_jobs.jsonl      ← The Job Company listings + apply_url
├── digests/
│   └── <date>.html                   ← Daily HTML digest
├── job-dashboard/
│   ├── server/                       ← Express API + Mongoose models + import scripts
│   ├── client/                       ← React + Vite frontend
│   └── README.md                     ← Dashboard-specific docs
└── tests/
    ├── test_phase0_clean.py          ← Phase 0 unit tests
    └── test_phase1.py                ← Phase 1 unit tests
```

---

## Job record schema

Every job (in `jobs.jsonl`, `js_jobs.jsonl`, etc.) has this shape:

```jsonc
{
  "id": "greenhouse:12345",         // <platform>:<id>
  "company": "Razorpay",
  "title": "SDE Intern",
  "url": "https://...",             // direct job listing URL
  "source_platform": "greenhouse",  // greenhouse | lever | ashby | custom_html | custom_js
  "type": "intern",                 // intern | full-time | unknown
  "location": "Bangalore, India",   // or "not mentioned"
  "posted": "2026-10-15",           // ISO date or ""
  "deadline": { "value": null, "evidence": null },
  "pay": { "value": null, "currency": null, "period": null, "evidence": null },
  "eligibility": { "status": "unclear", "evidence": null, "reason": "..." },
  "required_skills": [],
  "matched_skills": [],
  "missing_skills": [],
  "score": 0.0,
  "score_reasons": ["matches configured role and location rules"],
  "summary": "First 400 chars of cleaned description ...",
  "description_text": "Full cleaned description ...",
  "first_seen": "2026-10-26",
  "last_seen": "2026-10-26",
  "content_hash": "sha256-hex"
}
```

Fields like `deadline`, `pay`, `eligibility`, `required_skills`, `matched_skills`,
`missing_skills`, and `score` are **placeholders** for Phase 2 extraction logic that
is not yet implemented.

---

## Quick start

### 1. Install Python dependencies

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent"
python -m pip install -r requirements.txt
```

### 2. Run Phase 0 (clean + batch)

```powershell
python src\phase0_clean.py `
  --input All_Companies_Career_Pages.xlsx `
  --output data\companies_clean.csv `
  --batches-dir data\batches
```

### 3. Run Phase 1 (fetch + filter jobs)

One batch:

```powershell
python src\main.py `
  --batches-dir data\batches `
  --jobs data\jobs.jsonl `
  --state data\state.json `
  --digest-dir digests `
  --tracker data\tracker.csv `
  --batch 1
```

All batches:

```powershell
python src\main.py `
  --batches-dir data\batches `
  --jobs data\jobs.jsonl `
  --state data\state.json `
  --digest-dir digests `
  --tracker data\tracker.csv
```

### 4. Run the JS scanner (priority companies)

```powershell
npm install --prefix job-dashboard
npx --prefix job-dashboard playwright install chromium
node js_fetch\scan.mjs
```

With browser mode for approved sites:

```powershell
node js_fetch\scan.mjs --browser --browser-sites "Groww,Meesho"
```

### 5. Resolve apply URLs

```powershell
node js_fetch\resolve_apply_urls.mjs
```

### 6. Launch the dashboard

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent\job-dashboard"
Copy-Item server\.env.example server\.env   # first time only
npm install && npm install --prefix server && npm install --prefix client
cd server && npm run import:real && cd ..
npm run dev
```

Open http://localhost:5173.

---

## Robots.txt and safety

- The agent respects `robots.txt` by default. If `robots.txt` cannot be read,
  requests are blocked unless `--allow-robots-unavailable` is explicitly passed.
- Browser automation is disabled by default; it requires an explicit
  `--browser-sites` JSON allowlist.
- Search/listing URLs are never accepted as jobs.
- JSON-LD `JobPosting` records are preferred over guessed HTML links.
- The agent never clicks "Apply", fills forms, sends messages, or uses LinkedIn.
- Failed companies are retried up to 2 times, then skipped.
- Missing pay, deadlines, and eligibility remain marked as `not mentioned` / `unclear`.

---

## What is not yet implemented (Phase 2 placeholders)

These fields exist in the job schema but are always set to placeholder values:

| Field | Current value | Intended purpose |
|-------|---------------|------------------|
| `score` | `0.0` | Match score against your profile |
| `required_skills` | `[]` | Skills extracted from the job description |
| `matched_skills` | `[]` | Your skills that match |
| `missing_skills` | `[]` | Skills you'd need to learn |
| `deadline` | `null` | Application deadline extracted from the listing |
| `pay` | `null` | Salary / stipend extracted from the listing |
| `eligibility` | `"unclear"` | Whether you meet the listed requirements |
