import cors from "cors";
import express from "express";
import { prisma } from "./lib/db";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/logger";
import adminRouter from "./routes/admin";
import dimsRouter from "./routes/dims";
import progressRouter from "./routes/progress";
import skusRouter from "./routes/skus";
import syncRouter from "./routes/sync";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:5175",
  }),
);
app.use(express.json());
app.use(requestLogger);

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch {
    res.status(503).json({ status: "error", db: "error" });
  }
});

app.use("/api/skus", skusRouter);
app.use("/api/dims", dimsRouter);
app.use("/api/sync", syncRouter);
app.use("/api/admin", adminRouter);
app.use("/api/progress", progressRouter);

app.use(errorHandler);

export { app };
