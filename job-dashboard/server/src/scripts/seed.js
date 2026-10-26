import mongoose from "mongoose";
import { config } from "../config.js";
import { Company } from "../models/Company.js";
import { Job } from "../models/Job.js";
import { Run } from "../models/Run.js";
import { Tracking } from "../models/Tracking.js";

const companies = Array.from({ length: 40 }, (_, index) => {
  const number = index + 1;
  return {
    companyId: `sample-company-${number}`,
    name: `Sample Company ${number}`,
    originalUrl: `https://example.com/company-${number}/careers`,
    cleanUrl: `https://example.com/company-${number}/careers`,
    platform: number % 4 === 0 ? "greenhouse" : "custom",
    status: number % 9 === 0 ? "dead" : "alive",
    linkFlag: number % 10 === 0 ? "review" : "",
    flagReason: number % 10 === 0 ? "sample suspicious link" : "",
    runState: number % 11 === 0 ? "failed" : "done",
    failReason: number % 11 === 0 ? "sample timeout" : "",
    lastChecked: "2026-10-26",
    lastJobCount: number % 8,
  };
});

const jobs = Array.from({ length: 60 }, (_, index) => {
  const number = index + 1;
  const type = number % 3 === 0 ? "full-time" : "intern";
  const eligibilityStatus = number % 7 === 0 ? "ineligible" : number % 4 === 0 ? "unclear" : "eligible";
  const score = Math.round((5 + ((number * 7) % 51) / 10) * 10) / 10;
  return {
    id: `sample:job:${number}`,
    company: `Sample Company ${(number % 40) + 1}`,
    title: type === "intern" ? `Software Engineer Intern ${number}` : `Backend Software Engineer ${number}`,
    url: `https://example.com/jobs/${number}`,
    sourcePlatform: number % 4 === 0 ? "greenhouse" : "custom",
    type,
    location: number % 5 === 0 ? "Remote" : "Bengaluru, India",
    posted: "2026-10-26",
    deadline: number % 6 === 0
      ? { value: "2026-11-02", evidence: "Applications close on November 2, 2026." }
      : { value: null, evidence: null },
    pay: number % 5 === 0
      ? { value: "INR 50,000/month", currency: "INR", period: "month", evidence: "The stipend is INR 50,000/month." }
      : { value: null, evidence: null },
    eligibility: {
      status: eligibilityStatus,
      evidence: eligibilityStatus === "ineligible" ? "2026 graduates only." : eligibilityStatus === "eligible" ? "Students graduating in 2027 may apply." : null,
      reason: eligibilityStatus === "unclear" ? "Batch year is not stated." : "Sample eligibility rule",
    },
    requiredSkills: ["Python", "SQL", "REST APIs"],
    matchedSkills: ["Python", "SQL"],
    missingSkills: number % 2 === 0 ? ["Docker"] : [],
    score,
    scoreReasons: ["role matches target title", "Python appears in required skills"],
    summary: "Build and maintain backend services with a small engineering team.",
    descriptionText: "This is realistic fake sample data for dashboard development.",
    contentHash: `sample-hash-${number}`,
    isNew: number <= 10,
    isUpdated: number > 10 && number <= 15,
    firstSeen: "2026-10-25",
    lastSeen: "2026-10-26",
  };
});

const tracking = jobs.map((job, index) => ({
  jobId: job.id,
  status: ["new", "interested", "applied", "interview", "offer", "rejected"][index % 6],
  notes: index % 6 === 2 ? "Follow up after application." : "",
  appliedDate: index % 6 >= 2 ? "2026-10-25" : null,
  followUpDate: index % 6 === 3 ? "2026-10-30" : null,
}));

const runs = [0, 1, 2].map((offset) => ({
  runDate: `2026-10-${24 + offset}`,
  companiesTotal: 40,
  companiesFetched: 32 + offset,
  companiesFailed: 2,
  skipped: 3,
  manualCheck: 3,
  newJobs: 10 - offset,
  updatedJobs: 5 + offset,
  durationSec: 18 + offset * 4,
  failures: [{ company: "Sample Company 11", reason: "sample timeout" }],
}));

await mongoose.connect(config.mongoUri);
await Promise.all([Job.deleteMany({}), Tracking.deleteMany({}), Company.deleteMany({}), Run.deleteMany({})]);
await Promise.all([Job.insertMany(jobs), Tracking.insertMany(tracking), Company.insertMany(companies), Run.insertMany(runs)]);
console.log(`Seeded ${jobs.length} jobs, ${companies.length} companies, and ${runs.length} runs.`);
await mongoose.disconnect();
