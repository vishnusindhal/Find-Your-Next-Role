# JavaScript priority scanner

This scanner is limited to the 20-company shortlist in `priority_companies.json`.
It uses native Node `fetch` first and only accepts structured `JobPosting` JSON-LD
from official career pages. Pages with no reliable structured jobs are reported for
manual review; they are not converted into guessed job records.

Run from PowerShell:

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent"
node js_fetch\scan.mjs
```

Outputs:

- `data\js_jobs.jsonl`: real records found on official pages.
- `data\js_scan_report.json`: per-company status and reason.

JavaScript-rendered pages are opt-in:

```powershell
npm install --prefix job-dashboard playwright
npx --prefix job-dashboard playwright install chromium
node js_fetch\scan.mjs --browser --browser-sites "Groww,Meesho"
```

Only explicitly named companies are rendered in a browser. The scanner never submits
applications or interacts with application controls.

## Resolve third-party apply links

For The Job Company records, resolve the two-step Apply Now flow without submitting
an application:

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent"
node js_fetch\resolve_apply_urls.mjs
```

The resolver waits five seconds on the intermediate page, clicks the second Apply Now
button, and stores the destination in `data\thejobcompany_jobs.jsonl` as `apply_url`.
It rejects LinkedIn, Naukri, sign-in pages, and known Greenhouse error pages instead of
showing them as direct application links.
