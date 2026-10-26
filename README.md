# Job Agent

The agent discovers jobs in this order:

1. Official JSON adapters for supported ATS platforms.
2. Conservative HTML parsing for public career pages.
3. Optional Playwright browser fallback only for explicitly approved company IDs.
4. Manual-check output when no reliable record can be extracted.

The dashboard does not scrape websites. It imports the agent outputs from `data/`.

## Run the cleaner

Install the Python dependency first:

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent"
python -m pip install -r requirements.txt
```

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent"
python src\phase0_clean.py `
  --input All_Companies_Career_Pages.xlsx `
  --output data\companies_clean.csv `
  --batches-dir data\batches
```

## Run the agent

The default run respects robots.txt and stops safely when robots.txt is unavailable.
Run one batch first from the project directory:

```powershell
python src\main.py `
  --batches-dir data\batches `
  --jobs data\jobs.jsonl `
  --state data\state.json `
  --digest-dir digests `
  --tracker data\tracker.csv `
  --batch 1
```

Run all remaining batches:

```powershell
python src\main.py `
  --batches-dir data\batches `
  --jobs data\jobs.jsonl `
  --state data\state.json `
  --digest-dir digests `
  --tracker data\tracker.csv
```

If a site's robots file cannot be read, use this only after checking the site's terms:

```powershell
python src\main.py ... --allow-robots-unavailable
```

This still obeys explicit disallow rules in a readable robots.txt. It does not bypass
forbidden third-party sources.

## Run the JavaScript scanner

The JavaScript scanner is useful for approved career pages that require rendered
JavaScript. Install the dashboard workspace dependencies and Chromium once:

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent"
npm install --prefix job-dashboard
npx --prefix job-dashboard playwright install chromium
```

Run the priority-company scan:

```powershell
node js_fetch\scan.mjs
```

For selected browser-rendered sites, explicitly provide the approved company names:

```powershell
node js_fetch\scan.mjs --browser --browser-sites "Groww,Meesho"
```

The scanner writes JSONL records and per-company reports under `data\`.

### Resolve The Job Company application URLs

This follows the two-step Apply Now flow on each extracted detail page. It waits five
seconds on the intermediate page and records only a reliable external destination.
It never fills or submits an application:

```powershell
node js_fetch\resolve_apply_urls.mjs
```

The resolved links are saved in `data\thejobcompany_jobs.jsonl` as `apply_url`.

## Optional browser fallback

Browser automation is disabled by default. Create a JSON array containing only company IDs
you have reviewed and are allowed to access:

```json
["company-id-approved-by-you"]
```

Install the optional dependency only when needed:

```powershell
python -m pip install playwright
python -m playwright install chromium
```

Then pass the file:

```powershell
python src\main.py ... --browser-sites config\browser_sites.json
```

The browser fallback only reads the page. It never clicks apply, submits a form, sends a
message, or uses LinkedIn.

## Safety and output behavior

- Search/listing URLs are not accepted as jobs.
- JSON-LD `JobPosting` records are preferred over guessed HTML links.
- Missing pay, deadlines, and eligibility remain `not mentioned`/`unclear`.
- Failed companies are recorded in `state.json` and the digest.
- Uncertain or unsupported pages appear in the manual-check section.
- `data/jobs.jsonl` is append-only output from successful runs.
