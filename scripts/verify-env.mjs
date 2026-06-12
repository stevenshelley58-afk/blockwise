import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  getDeploymentReadiness,
  parseEnvFile,
} from "../src/lib/config/env.ts";

const dotenvFiles = [".env.local", ".env"];
const fileEnv = {};

for (const file of dotenvFiles) {
  const path = resolve(process.cwd(), file);

  if (existsSync(path)) {
    Object.assign(fileEnv, parseEnvFile(readFileSync(path, "utf8")));
  }
}

const env = {
  ...fileEnv,
  ...process.env,
};
const readiness = getDeploymentReadiness(env);
const isVercelPreview = env.VERCEL === "1" && env.VERCEL_ENV === "preview";

if (readiness.invalid.length > 0) {
  const message = `Invalid or missing required environment variables: ${readiness.invalid.join(", ")}`;

  if (isVercelPreview) {
    console.warn(`Preview environment incomplete: ${message}`);
  } else {
    console.error(message);
    process.exit(1);
  }
}

if (readiness.security.missingRecommended.length > 0) {
  console.warn(
    `Missing recommended production security variables: ${readiness.security.missingRecommended.join(", ")}`,
  );
}

console.log("All required Blockwise environment variables are present and non-placeholder.");
