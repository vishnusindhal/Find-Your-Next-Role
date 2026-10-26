import mongoose from "mongoose";

const failureSchema = new mongoose.Schema(
  { company: { type: String, required: true }, reason: { type: String, required: true } },
  { _id: false },
);

const runSchema = new mongoose.Schema(
  {
    runDate: { type: String, required: true, index: true },
    companiesTotal: { type: Number, default: 0 },
    companiesFetched: { type: Number, default: 0 },
    companiesFailed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    manualCheck: { type: Number, default: 0 },
    newJobs: { type: Number, default: 0 },
    updatedJobs: { type: Number, default: 0 },
    durationSec: { type: Number, default: 0 },
    failures: { type: [failureSchema], default: [] },
  },
  { timestamps: true },
);

export const Run = mongoose.model("Run", runSchema);
