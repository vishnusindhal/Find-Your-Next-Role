import express from "express";
import { z } from "zod";
import { Job } from "../models/Job.js";
import { Tracking } from "../models/Tracking.js";
import { validateBody } from "../middleware/validate.js";

const statusSchema = z.object({
  status: z.enum(["new", "interested", "applied", "rejected", "interview", "offer", "archived"]),
  notes: z.string().max(5000).optional(),
  appliedDate: z.string().date().nullable().optional(),
  followUpDate: z.string().date().nullable().optional(),
});

const router = express.Router();

router.patch("/:jobId", validateBody(statusSchema), async (request, response, next) => {
  try {
    const job = await Job.exists({ id: request.params.jobId });
    if (!job) return response.status(404).json({ error: "Job not found" });
    const tracking = await Tracking.findOneAndUpdate(
      { jobId: request.params.jobId },
      { $set: request.validatedBody, $setOnInsert: { jobId: request.params.jobId } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    return response.json(tracking);
  } catch (error) {
    return next(error);
  }
});

export { router as trackerRouter };
