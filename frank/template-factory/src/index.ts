import express from "express";
import { config } from "./config.js";
import healthRouter from "./routes/health.js";
import packsRouter from "./routes/packs.js";

const app = express();
app.use(express.json());

// Routes
app.use("/health", healthRouter);
app.use("/packs", packsRouter);

// Start
app.listen(config.port, config.host, () => {
  console.log(`Frank template factory running on http://${config.host}:${config.port}`);
  console.log(`  Dev mode: ${config.isDev}`);
  console.log(`  Database: ${config.databaseUrl ? "configured" : "not configured (lazy)"}`);
});

export { app };
