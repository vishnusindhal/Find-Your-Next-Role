/**
 * Scan a small, explicitly approved company list.
 *
 * The default path uses native Node fetch and conservative HTML extraction.
 * Playwright is opt-in because it is heavier and must not silently browse
 * pages that the user has not approved.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = new Set(process.argv.slice(2));
const optionValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const input = optionValue("--input", `${root}js_fetch/priority_companies.json`);
const output = optionValue("--output", `${root}data/js_jobs.jsonl`);
const reportPath = optionValue("--report", `${root}data/js_scan_report.json`);
const approved = new Set(
  (optionValue("--browser-sites", ""))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const useBrowser = args.has("--browser");
const allowRobotsUnavailable = args.has("--allow-robots-unavailable");
const userAgent = "job-agent-js-priority/1.0 (personal research; polite crawler)";
const lastRequest = new Map();
const robotsCache = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const domainOf = (value) => new URL(value).hostname.toLowerCase();

async function allowedByRobots(url) {
  const origin = new URL(url).origin;
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  try {
    const response = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": userAgent } });
    if (!response.ok) {
      robotsCache.set(origin, allowRobotsUnavailable);
      return allowRobotsUnavailable;
    }
    const lines = (await response.text()).split(/\r?\n/);
    let applies = false;
    let allowed = true;
    for (const rawLine of lines) {
      const line = rawLine.split("#", 1)[0].trim();
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key === "user-agent") applies = value === "*" || value.toLowerCase().includes("job-agent-js");
      if (applies && key === "disallow" && value && new URL(url).pathname.startsWith(value)) allowed = false;
    }
    robotsCache.set(origin, allowed);
    return allowed;
  } catch {
    robotsCache.set(origin, allowRobotsUnavailable);
    return allowRobotsUnavailable;
  }
}

async function getText(url) {
  if (!(await allowedByRobots(url))) throw new Error("blocked by robots.txt or robots.txt unavailable");
  const domain = domainOf(url);
  const elapsed = Date.now() - (lastRequest.get(domain) || 0);
  if (elapsed < 1200) await sleep(1200 - elapsed);
  lastRequest.set(domain, Date.now());
  const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { html: await response.text(), finalUrl: response.url };
}

function stripTags(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function jsonLdRecords(html) {
  const records = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1].trim());
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        const entries = item?.["@graph"] || [item];
        for (const entry of entries) {
          const type = entry?.["@type"];
          if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) records.push(entry);
        }
      }
    } catch {
      // Invalid JSON-LD is ignored; the page remains eligible for manual review.
    }
  }
  return records;
}

function makeJob(company, pageUrl, item) {
  const location = item.jobLocation?.address || item.jobLocation || {};
  const locationText = typeof location === "string"
    ? location
    : [location.addressLocality, location.addressRegion, location.addressCountry].filter(Boolean).join(", ");
  const description = stripTags(String(item.description || ""));
  const title = String(item.title || "").trim();
  const url = new URL(String(item.url || pageUrl), pageUrl).href;
  const id = `custom_js:${createHash("sha1").update(`${company}:${url}`).digest("hex").slice(0, 16)}`;
  const type = /\b(intern|internship|co-?op)\b/i.test(`${title} ${description}`) ? "intern"
    : /\b(engineer|developer|full[- ]time|new grad|graduate)\b/i.test(`${title} ${description}`) ? "full-time"
      : "unknown";
  return {
    id, company, title, url, source_platform: "custom_js", type,
    location: locationText || "not mentioned", posted: String(item.datePosted || "").slice(0, 10),
    deadline: { value: null, evidence: null },
    pay: { value: null, currency: null, period: null, evidence: null },
    eligibility: { status: "unclear", evidence: null, reason: "Eligibility extraction requires Phase 2 rules." },
    required_skills: [], matched_skills: [], missing_skills: [], score: 0,
    score_reasons: ["Discovered from official career-page JSON-LD"],
    summary: description.slice(0, 400), description_text: description,
    first_seen: new Date().toISOString().slice(0, 10), last_seen: new Date().toISOString().slice(0, 10),
    content_hash: createHash("sha256").update(description).digest("hex"),
  };
}

function extractVisibleJobLinks(company, pageUrl, html) {
  const jobs = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = new URL(match[1], pageUrl);
    const label = stripTags(match[2]);
    const path = href.pathname.toLowerCase();
    const query = href.search.toLowerCase();
    const detail = /\/(job|jobs|career|careers|position|opening|intern)/.test(path);
    const search = /(?:^|[?&])(q|query|search|keyword|location|page)=/.test(query);
    if (!detail || search || !label || label.length < 4 || label.length > 180 || seen.has(href.href)) continue;
    if (!/\b(intern|engineer|developer|software|data|machine|sde|product)\b/i.test(label)) continue;
    seen.add(href.href);
    const description = `Visible job link discovered on the official career page for ${company}.`;
    jobs.push({
      id: `custom_js:${createHash("sha1").update(`${company}:${href.href}`).digest("hex").slice(0, 16)}`,
      company, title: label, url: href.href, source_platform: "custom_js", type: /\b(intern|internship)\b/i.test(label) ? "intern" : "full-time",
      location: "not mentioned", posted: "", deadline: { value: null, evidence: null },
      pay: { value: null, currency: null, period: null, evidence: null },
      eligibility: { status: "unclear", evidence: null, reason: "Eligibility not stated in listing link." },
      required_skills: [], matched_skills: [], missing_skills: [], score: 0,
      score_reasons: ["Discovered from official career-page link"], summary: description,
      description_text: description, first_seen: new Date().toISOString().slice(0, 10),
      last_seen: new Date().toISOString().slice(0, 10), content_hash: createHash("sha256").update(description).digest("hex"),
    });
  }
  return jobs;
}

function pageLinks(pageUrl, html) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(match[1], pageUrl);
      url.hash = "";
      const label = stripTags(match[2]);
      if (url.origin === new URL(pageUrl).origin && label) links.push({ url: url.href, label });
    } catch {
      // Ignore malformed links from the page.
    }
  }
  return links;
}

function isDiscoveryLink(link) {
  return /\b(join us|explore (jobs|careers)|view (all )?jobs|see (all )?jobs|careers?|opportunities|openings)\b/i.test(link.label)
    || /\/(careers?|jobs?|opportunities|openings)(\/|$)/i.test(new URL(link.url).pathname);
}

function isPaginationLink(link) {
  return /\b(next|older|more jobs|load more|page\s*\d+)\b/i.test(link.label)
    || /(?:[?&](page|offset|start|limit)=|\b(page|offset)=\d+)/i.test(link.url);
}

function isJobDetailLink(link) {
  const parsed = new URL(link.url);
  const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  const label = link.label.trim().toLowerCase();
  if (/^(skip to|home|jobs?|careers?|job search|saved jobs|job alerts|recommended jobs|privacy|dashboard)/i.test(label)) return false;
  if (/(^|\/)(results?|search|dashboard|alerts|saved|recommendations|privacy-policy|teams|how-we-hire|students?)($|\/)/i.test(path)) return false;
  if (parsed.hostname === "www.google.com" && !/\/results\/\d+-/i.test(path)) return false;
  if (/\/(job|jobs|position|opening|requisition|vacancy|internship)\//i.test(path)) {
    return !/[?&](q|query|search|keyword|location|page)=/i.test(parsed.search);
  }
  return /\/careers?\/jobs(?:\/[^/]*)?$/i.test(path) && parsed.searchParams.has("id");
}

function jobFromRenderedPage(company, url, title, html) {
  const description = stripTags(html).slice(0, 20_000);
  const type = /\b(intern|internship|co-?op)\b/i.test(`${title} ${description}`) ? "intern"
    : /\b(engineer|developer|software|new grad|graduate|full[- ]time)\b/i.test(`${title} ${description}`) ? "full-time"
      : "unknown";
  return {
    id: `custom_js:${createHash("sha1").update(`${company}:${url}`).digest("hex").slice(0, 16)}`,
    company, title: title || `Career opportunity at ${company}`, url, source_platform: "custom_js",
    type, location: "not mentioned", posted: "", deadline: { value: null, evidence: null },
    pay: { value: null, currency: null, period: null, evidence: null },
    eligibility: { status: "unclear", evidence: null, reason: "Eligibility requires rule extraction from the detail text." },
    required_skills: [], matched_skills: [], missing_skills: [], score: 0,
    score_reasons: ["Discovered by rendered official career-page crawl"],
    summary: description.slice(0, 400), description_text: description,
    first_seen: new Date().toISOString().slice(0, 10), last_seen: new Date().toISOString().slice(0, 10),
    content_hash: createHash("sha256").update(description).digest("hex"),
  };
}

async function browserExtract(company, url) {
  if (!(await allowedByRobots(url))) throw new Error("blocked by robots.txt or robots.txt unavailable");
  let playwright;
  try {
    playwright = createRequire(import.meta.url)(`${root}job-dashboard/node_modules/playwright`);
  } catch {
    throw new Error("Playwright is not installed; install it explicitly before using --browser");
  }

function visibleJobLinks(company, pageUrl, html) {
    const jobs = [];
    const seen = new Set();
    const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(pattern)) {
      const href = new URL(match[1], pageUrl);
      const label = stripTags(match[2]);
      const path = href.pathname.toLowerCase();
      const query = href.search.toLowerCase();
      const detail = /\/(job|jobs|career|careers|position|opening|intern)/.test(path);
      const search = /(?:^|[?&])(q|query|search|keyword|location|page)=/.test(query);
      if (!detail || search || !label || label.length < 4 || label.length > 180 || seen.has(href.href)) continue;
      if (!/\b(intern|engineer|developer|software|data|machine|sde|product)\b/i.test(label)) continue;
      seen.add(href.href);
      const description = `Visible job link discovered on the official career page for ${company}.`;
      jobs.push({
        id: `custom_js:${createHash("sha1").update(`${company}:${href.href}`).digest("hex").slice(0, 16)}`,
        company, title: label, url: href.href, source_platform: "custom_js", type: /\b(intern|internship)\b/i.test(label) ? "intern" : "full-time",
        location: "not mentioned", posted: "", deadline: { value: null, evidence: null },
        pay: { value: null, currency: null, period: null, evidence: null },
        eligibility: { status: "unclear", evidence: null, reason: "Eligibility not stated in listing link." },
        required_skills: [], matched_skills: [], missing_skills: [], score: 0,
        score_reasons: ["Discovered from official career-page link"], summary: description,
        description_text: description, first_seen: new Date().toISOString().slice(0, 10),
        last_seen: new Date().toISOString().slice(0, 10), content_hash: createHash("sha256").update(description).digest("hex"),
      });
}
    return jobs;
  }
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent });
    const pending = [{ url, depth: 0 }];
    const visited = new Set();
    const jobLinks = new Map();
    const maxPages = 12;
    while (pending.length && visited.size < maxPages) {
      const current = pending.shift();
      if (visited.has(current.url) || !(await allowedByRobots(current.url))) continue;
      visited.add(current.url);
      await page.goto(current.url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(800);
      for (let click = 0; click < 5; click += 1) {
        const more = page.getByText(/^(load more|show more|next)$/i).first();
        if (!(await more.isVisible().catch(() => false))) break;
        await more.click().catch(() => {});
        await page.waitForTimeout(700);
      }
      const html = await page.content();
      const links = pageLinks(page.url(), html);
      for (const link of links) {
        if (isJobDetailLink(link)) jobLinks.set(link.url, link.label);
        if (current.depth < 2 && (isDiscoveryLink(link) || isPaginationLink(link)) && !visited.has(link.url)) {
          pending.push({ url: link.url, depth: current.depth + 1 });
        }
      }
    }
    const jobs = [];
    for (const [jobUrl, label] of [...jobLinks].slice(0, 50)) {
      if (!(await allowedByRobots(jobUrl))) continue;
      await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(500);
      const html = await page.content();
      const structured = jsonLdRecords(html);
      if (structured.length) jobs.push(...structured.map((item) => makeJob(company, page.url(), item)));
      else jobs.push(jobFromRenderedPage(company, page.url(), label, html));
    }
    return { html: "", finalUrl: url, jobs, pagesVisited: visited.size };
  } finally {
    await browser.close();
  }
}

const companies = JSON.parse(await readFile(input, "utf8"));
const jobs = [];
const report = [];
for (const company of companies) {
  const result = { company: company.company, url: company.url, source: company.source, status: "", jobs: 0, reason: "" };
  try {
    const fetched = useBrowser && approved.has(company.company)
      ? await browserExtract(company.company, company.url)
      : await getText(company.url);
    const records = jsonLdRecords(fetched.html);
    const found = fetched.jobs || (records.length
      ? records.map((item) => makeJob(company.company, fetched.finalUrl, item))
      : (useBrowser && approved.has(company.company) ? extractVisibleJobLinks(company.company, fetched.finalUrl, fetched.html) : []));
    jobs.push(...found);
    result.status = found.length ? "jobs_found" : "manual_review";
    result.jobs = found.length;
    if (!found.length) result.reason = "No reliable JobPosting data or approved job links found.";
  } catch (error) {
    result.status = "failed";
    result.reason = String(error.message || error);
  }
  report.push(result);
  console.log(`${result.status}: ${company.company} (${result.jobs}) ${result.reason}`);
}
await mkdir(`${root}data`, { recursive: true });
await writeFile(output, jobs.map((job) => JSON.stringify(job)).join("\n") + (jobs.length ? "\n" : ""), "utf8");
await writeFile(reportPath, JSON.stringify({ generated_at: new Date().toISOString(), jobs: jobs.length, companies: report }, null, 2), "utf8");
console.log(`jobs=${jobs.length} report=${reportPath}`);
