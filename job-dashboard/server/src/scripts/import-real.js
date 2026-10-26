import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { config } from "../config.js";
import { Company } from "../models/Company.js";
import { Job } from "../models/Job.js";
import { Run } from "../models/Run.js";
import { Tracking } from "../models/Tracking.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const agentRoot = resolve(scriptDirectory, "..", "..", "..", "..");
const jobsPath = resolve(agentRoot, "data", "js_jobs_browser.jsonl");
const reportPath = resolve(agentRoot, "data", "js_scan_browser_report.json");
const otherJobsPath = resolve(agentRoot, "data", "js_jobs_other.jsonl");
const otherReportPath = resolve(agentRoot, "data", "js_scan_other_report.json");
const theJobCompanyJobsPath = resolve(agentRoot, "data", "thejobcompany_jobs.jsonl");
const companiesPath = resolve(agentRoot, "js_fetch", "priority_companies.json");

const companyLinkedInUrls = {
  PayU: "https://www.linkedin.com/company/payu/",
  Atlan: "https://www.linkedin.com/company/atlan/",
  Nasdaq: "https://www.linkedin.com/company/nasdaq/",
  "Electronic Arts": "https://www.linkedin.com/company/electronic-arts/",
  "Vara 5": "https://www.linkedin.com/company/vara5/",
  Microsoft: "https://www.linkedin.com/company/microsoft/",
  MongoDB: "https://www.linkedin.com/company/mongodb/",
  YesMadam: "https://www.linkedin.com/company/yesmadam/",
  CloudSEK: "https://www.linkedin.com/company/cloudsek/",
  "IBM Research India": "https://www.linkedin.com/company/ibm-research/",
  Kulfi: "https://www.linkedin.com/company/kulfi/",
  Sutherland: "https://www.linkedin.com/company/sutherland-global/",
  MHTECHIN: "https://www.linkedin.com/company/mhtechin/",
  Graviton: "https://www.linkedin.com/company/graviton-research-capital/",
  Cisco: "https://www.linkedin.com/company/cisco/",
  Infosys: "https://www.linkedin.com/company/infosys/",
  Equifax: "https://www.linkedin.com/company/equifax/",
  Onsurity: "https://www.linkedin.com/company/onsurity/",
};

function parseJsonLines(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on jobs.jsonl line ${index + 1}: ${error.message}`);
    }
  });
}

function mapJob(raw) {
  return {
    id: raw.id,
    company: raw.company,
    companyLinkedInUrl: companyLinkedInUrls[raw.company] || null,
    title: raw.title,
    url: raw.url,
    applyUrl: raw.apply_url || null,
    sourcePlatform: raw.source_platform || "custom_js",
    type: raw.type || "unknown",
    location: raw.location || "not mentioned",
    posted: raw.posted || "",
    deadline: raw.deadline || {},
    pay: raw.pay || {},
    eligibility: raw.eligibility || { status: "unclear", evidence: null, reason: "Not mentioned" },
    requiredSkills: raw.required_skills || [],
    matchedSkills: raw.matched_skills || [],
    missingSkills: raw.missing_skills || [],
    score: Number(raw.score || 0),
    scoreReasons: raw.score_reasons || [],
    summary: raw.summary || "",
    descriptionText: raw.description_text || raw.descriptionText || "",
    contentHash: raw.content_hash || "",
    isNew: true,
    isUpdated: false,
    firstSeen: raw.first_seen || raw.firstSeen || new Date().toISOString().slice(0, 10),
    lastSeen: raw.last_seen || raw.lastSeen || new Date().toISOString().slice(0, 10),
  };
}

const [jobsText, reportText, otherJobsText, otherReportText, theJobCompanyJobsText, companiesText] = await Promise.all([
  readFile(jobsPath, "utf8"),
  readFile(reportPath, "utf8"),
  readFile(otherJobsPath, "utf8"),
  readFile(otherReportPath, "utf8"),
  readFile(theJobCompanyJobsPath, "utf8"),
  readFile(companiesPath, "utf8"),
]);
const rawJobs = [
  ...parseJsonLines(jobsText),
  ...parseJsonLines(otherJobsText),
  ...parseJsonLines(theJobCompanyJobsText),
];
const report = JSON.parse(reportText);
const otherReport = JSON.parse(otherReportText);
const priorityCompanies = JSON.parse(companiesText);
const reportByCompany = new Map([
  ...(report.companies || []),
  ...(otherReport.companies || []),
].map((item) => [item.company, item]));
const jobs = rawJobs.map(mapJob);
const jobsByCompany = new Map();
for (const job of jobs) jobsByCompany.set(job.company, (jobsByCompany.get(job.company) || 0) + 1);
const companies = priorityCompanies.map((item, index) => {
  const result = reportByCompany.get(item.company) || {};
  return {
    companyId: `priority-${String(index + 1).padStart(2, "0")}`,
    name: item.company,
    originalUrl: item.url,
    cleanUrl: item.url,
    finalUrl: item.url,
    platform: "custom_js",
    status: result.status === "failed" ? "failed" : "alive",
    linkFlag: result.status === "manual_review" ? "manual_check" : "",
    flagReason: result.reason || "",
    runState: result.status === "failed" ? "failed" : "done",
    failReason: result.status === "failed" ? result.reason : "",
    lastChecked: new Date().toISOString().slice(0, 10),
    lastJobCount: jobsByCompany.get(item.company) || 0,
  };
});
companies.push({
  companyId: "source-thejobcompany",
  name: "The Job Company",
  originalUrl: "https://thejobcompany.co.in/job-category/internships",
  cleanUrl: "https://thejobcompany.co.in/job-category/internships",
  finalUrl: "https://thejobcompany.co.in/job-category/internships",
  platform: "thejobcompany",
  status: "alive",
  linkFlag: "third_party_source",
  flagReason: "Third-party listing source; verify the employer application page.",
  runState: "done",
  failReason: "",
  lastChecked: new Date().toISOString().slice(0, 10),
  lastJobCount: jobs.filter((job) => job.source_platform === "thejobcompany").length,
});

await mongoose.connect(config.mongoUri);
await Promise.all([Job.deleteMany({}), Tracking.deleteMany({}), Company.deleteMany({}), Run.deleteMany({})]);
if (jobs.length) {
  await Job.insertMany(jobs, { ordered: true });
  await Tracking.insertMany(jobs.map((job) => ({ jobId: job.id, status: "new" })), { ordered: true });
}
if (companies.length) await Company.insertMany(companies, { ordered: true });
await Run.create({
  runDate: new Date().toISOString().slice(0, 10),
  companiesTotal: companies.length,
  companiesFetched: companies.filter((company) => company.runState === "done").length,
  companiesFailed: companies.filter((company) => company.runState === "failed").length,
  skipped: 0,
  manualCheck: companies.filter((company) => company.linkFlag === "manual_check").length,
  newJobs: jobs.length,
  updatedJobs: 0,
  durationSec: 0,
  failures: companies.filter((company) => company.failReason).map((company) => ({
    company: company.name,
    reason: company.failReason,
  })),
});
console.log(`Imported ${jobs.length} real jobs from ${companies.length} priority companies.`);
console.log("Existing sample jobs, companies, tracking records, and runs were removed.");
await mongoose.disconnect();
