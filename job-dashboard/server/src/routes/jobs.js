import express from "express";
import { z } from "zod";
import { Job } from "../models/Job.js";
import { Tracking } from "../models/Tracking.js";
import { validateQuery } from "../middleware/validate.js";

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const jobsQuerySchema = z.object({
  type: z.enum(["intern", "full-time", "unknown"]).optional(),
  eligibility: z.enum(["eligible", "ineligible", "unclear"]).optional(),
  minScore: z.coerce.number().min(0).max(10).optional(),
  company: z.string().trim().min(1).max(100).optional(),
  platform: z.string().trim().min(1).max(50).optional(),
  location: z.string().trim().min(1).max(100).optional(),
  postedWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  hasDeadline: booleanQuery.optional(),
  deadlineWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  newToday: booleanQuery.optional(),
  updated: booleanQuery.optional(),
  trackingStatus: z.enum(["new", "interested", "applied", "rejected", "interview", "offer", "archived"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(["default", "score", "posted", "deadline"]).default("default"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

const startOfDay = (date = new Date()) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const isoDateAfterDays = (days) => {
  const result = startOfDay();
  result.setDate(result.getDate() + days);
  return result.toISOString().slice(0, 10);
};

function buildFilter(query) {
  const filter = {};
  if (query.type) filter.type = query.type;
  if (query.eligibility) filter["eligibility.status"] = query.eligibility;
  if (query.minScore !== undefined) filter.score = { $gte: query.minScore };
  if (query.company) filter.company = { $regex: query.company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (query.platform) filter.sourcePlatform = query.platform;
  if (query.location) filter.location = { $regex: query.location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (query.postedWithinDays !== undefined) {
    filter.posted = { $gte: isoDateAfterDays(-query.postedWithinDays) };
  }
  if (query.hasDeadline === true) filter["deadline.value"] = { $ne: null, $exists: true };
  if (query.hasDeadline === false) filter["deadline.value"] = null;
  if (query.deadlineWithinDays !== undefined) {
    filter["deadline.value"] = { $gte: startOfDay().toISOString().slice(0, 10), $lte: isoDateAfterDays(query.deadlineWithinDays) };
  }
  if (query.newToday === true) filter.isNew = true;
  if (query.updated === true) filter.isUpdated = true;
  if (query.search) {
    filter.$text = { $search: query.search };
  }
  return filter;
}

function sortFor(query) {
  if (query.sort === "score") return { score: -1, _id: 1 };
  if (query.sort === "posted") return { posted: -1, score: -1, _id: 1 };
  if (query.sort === "deadline") return { "deadline.value": 1, posted: -1, score: -1, _id: 1 };
  return { "deadline.value": 1, posted: -1, score: -1, _id: 1 };
}

const router = express.Router();

router.get("/", validateQuery(jobsQuerySchema), async (request, response, next) => {
  try {
    const query = request.validatedQuery;
    const filter = buildFilter(query);
    const skip = (query.page - 1) * query.pageSize;
    const [jobs, total] = await Promise.all([
      Job.find(filter).sort(sortFor(query)).skip(skip).limit(query.pageSize).lean(),
      Job.countDocuments(filter),
    ]);
    const tracking = await Tracking.find({ jobId: { $in: jobs.map((job) => job.id) } }).lean();
    const trackingByJob = new Map(tracking.map((item) => [item.jobId, item]));
    response.json({
      data: jobs.map((job) => ({ ...job, tracking: trackingByJob.get(job.id) || { jobId: job.id, status: "new", notes: "" } })),
      pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (request, response, next) => {
  try {
    const job = await Job.findOne({ id: request.params.id }).lean();
    if (!job) return response.status(404).json({ error: "Job not found" });
    const tracking = await Tracking.findOne({ jobId: job.id }).lean();
    return response.json({ ...job, tracking: tracking || { jobId: job.id, status: "new", notes: "" } });
  } catch (error) {
    return next(error);
  }
});

export { router as jobsRouter };
