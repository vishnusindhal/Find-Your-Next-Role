import mongoose from "mongoose";

const evidenceSchema = new mongoose.Schema(
  {
    value: { type: String, default: null },
    evidence: { type: String, default: null },
    currency: { type: String, default: null },
    period: { type: String, default: null },
  },
  { _id: false },
);

const eligibilitySchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["eligible", "ineligible", "unclear"], required: true },
    evidence: { type: String, default: null },
    reason: { type: String, default: "" },
  },
  { _id: false },
);

const jobSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    company: { type: String, required: true, index: true },
    companyLinkedInUrl: { type: String, default: null },
    title: { type: String, required: true },
    url: { type: String, required: true },
    applyUrl: { type: String, default: null },
    sourcePlatform: { type: String, default: "custom" },
    type: { type: String, enum: ["intern", "full-time", "unknown"], default: "unknown", index: true },
    location: { type: String, default: "not mentioned" },
    posted: { type: String, default: "" },
    deadline: { type: evidenceSchema, default: () => ({}) },
    pay: { type: evidenceSchema, default: () => ({}) },
    eligibility: { type: eligibilitySchema, required: true },
    requiredSkills: { type: [String], default: [] },
    matchedSkills: { type: [String], default: [] },
    missingSkills: { type: [String], default: [] },
    score: { type: Number, default: 0, index: true },
    scoreReasons: { type: [String], default: [] },
    summary: { type: String, default: "" },
    descriptionText: { type: String, default: "" },
    contentHash: { type: String, default: "" },
    isNew: { type: Boolean, default: false },
    isUpdated: { type: Boolean, default: false },
    firstSeen: { type: String, default: "" },
    lastSeen: { type: String, default: "" },
  },
  { timestamps: true, suppressReservedKeysWarning: true },
);

jobSchema.index({ title: "text", company: "text" });
jobSchema.index({ "eligibility.status": 1 });
jobSchema.index({ "deadline.value": 1 });

export const Job = mongoose.model("Job", jobSchema);
