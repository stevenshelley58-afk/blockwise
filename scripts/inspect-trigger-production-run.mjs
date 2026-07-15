import { runs } from "@trigger.dev/sdk";

const runId = process.argv[2]?.trim();
if (!runId?.startsWith("run_")) process.exit(0);

const detail = await runs.retrieve(runId);
console.log(`Latest failed Trigger run: ${detail.error?.message ?? "No error message returned."}`);
