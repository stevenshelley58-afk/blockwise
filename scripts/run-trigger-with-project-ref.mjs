import { spawn } from "node:child_process";

const [command, ...passthroughArgs] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/run-trigger-with-project-ref.mjs <dev|deploy> [trigger.dev args...]");
  process.exit(1);
}

const projectRef = process.env.TRIGGER_PROJECT_ID?.trim() || process.env.TRIGGER_PROJECT_REF?.trim();

if (!projectRef) {
  console.error("TRIGGER_PROJECT_ID or TRIGGER_PROJECT_REF is required to deploy or run Trigger.dev tasks.");
  process.exit(1);
}

const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(npxBin, ["trigger.dev", command, "--project-ref", projectRef, ...passthroughArgs], {
  env: {
    ...process.env,
    TRIGGER_PROJECT_ID: projectRef,
    TRIGGER_PROJECT_REF: projectRef,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`trigger.dev ${command} exited with signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`Failed to start trigger.dev ${command}: ${error.message}`);
  process.exit(1);
});
