import mongoose from "mongoose";

const trackingSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["new", "interested", "applied", "rejected", "interview", "offer", "archived"],
      default: "new",
    },
    notes: { type: String, default: "" },
    appliedDate: { type: String, default: null },
    followUpDate: { type: String, default: null },
  },
  { timestamps: true },
);

export const Tracking = mongoose.model("Tracking", trackingSchema);
