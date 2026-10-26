import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    originalUrl: { type: String, default: "" },
    cleanUrl: { type: String, default: "" },
    finalUrl: { type: String, default: "" },
    platform: { type: String, default: "custom" },
    status: { type: String, default: "not_probed" },
    linkFlag: { type: String, default: "" },
    flagReason: { type: String, default: "" },
    myChecked: { type: String, default: "" },
    myNote: { type: String, default: "" },
    runState: { type: String, enum: ["pending", "done", "failed"], default: "pending" },
    failReason: { type: String, default: "" },
    lastChecked: { type: String, default: "" },
    lastJobCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Company = mongoose.model("Company", companySchema);
