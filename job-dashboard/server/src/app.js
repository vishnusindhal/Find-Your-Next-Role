import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { config } from "./config.js";
import { jobsRouter } from "./routes/jobs.js";
import { trackerRouter } from "./routes/tracker.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: "100kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "job-agent-dashboard-api", timestamp: new Date().toISOString() });
});

app.get("/api/health/config", (_request, response) => {
  const result = z.object({ mongoUri: z.string().min(1) }).safeParse({ mongoUri: config.mongoUri });
  response.json({ ok: result.success, host: config.host, port: config.port });
});

app.use("/api/jobs", jobsRouter);
app.use("/api/tracker", trackerRouter);

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Internal server error" });
});
