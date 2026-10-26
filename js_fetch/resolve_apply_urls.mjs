import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "../job-dashboard/node_modules/playwright/index.mjs";

const root = resolve(import.meta.dirname, "..");
const inputPath = resolve(root, "data", "thejobcompany_jobs.jsonl");
const outputPath = inputPath;
const waitMs = 5000;

function parseJsonLines(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
    }
  });
}

function isUsableApplicationUrl(url) {
  if (!url) return false;
  const lowered = url.toLowerCase();
  return !(
    lowered.includes("linkedin.com") ||
    lowered.includes("naukri.com") ||
    lowered.includes("greenhouse.io") && lowered.includes("error=true") ||
    lowered.includes("signup") ||
    lowered.includes("login")
  );
}

async function findApplyTarget(page) {
  const candidates = page.locator("a, button").filter({ hasText: /apply now|apply/i });
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const href = await candidate.getAttribute("href");
    if (href) return new URL(href, page.url()).href;
  }
  return null;
}

async function resolveOne(browser, job) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const firstTarget = await findApplyTarget(page);
    if (!firstTarget) {
      return { ...job, apply_url: null, apply_resolution: "first_apply_button_not_found" };
    }

    await page.goto(firstTarget, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(waitMs);
    const finalTarget = await findApplyTarget(page);
    if (!finalTarget) {
      return { ...job, apply_url: null, apply_resolution: "second_apply_button_not_found" };
    }

    const popupPromise = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
    const finalButton = page.locator("a, button").filter({ hasText: /apply now|apply/i }).filter({ visible: true }).last();
    await finalButton.click({ timeout: 10000 });
    const popup = await popupPromise;
    const destinationPage = popup || page;
    await destinationPage.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await destinationPage.waitForTimeout(1000);
    const destination = destinationPage.url();
    if (popup) await popup.close().catch(() => {});
    const applyUrl = isUsableApplicationUrl(destination) ? destination : null;
    return {
      ...job,
      apply_url: applyUrl,
      apply_resolution: applyUrl ? "resolved" : "not_direct_employer_or_invalid",
    };
  } catch (error) {
    return {
      ...job,
      apply_url: null,
      apply_resolution: `failed: ${error.message}`.slice(0, 500),
    };
  } finally {
    await context.close();
  }
}

const jobs = parseJsonLines(await readFile(inputPath, "utf8"));
const browser = await chromium.launch({ headless: true });
const resolved = [];
for (const job of jobs) {
  const result = await resolveOne(browser, job);
  resolved.push(result);
  console.log(`${result.id}: ${result.apply_resolution}${result.apply_url ? ` -> ${result.apply_url}` : ""}`);
}
await browser.close();
await writeFile(outputPath, `${resolved.map((job) => JSON.stringify(job)).join("\n")}\n`, "utf8");
console.log(`Resolved ${resolved.filter((job) => job.apply_url).length}/${resolved.length} apply URLs.`);
