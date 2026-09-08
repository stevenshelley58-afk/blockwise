import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const digest = (body) => createHash("sha256").update(body).digest("hex");
function journalPath(root, runId) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(String(runId))) throw new Error("Invalid capture run ID");
  return join(root, "capture-journal", runId + ".json");
}
export async function saveCaptureJournal(root, input, { body, receipt, status }) {
  const path = journalPath(root, input.adFetchRunId);
  if (typeof body !== "string" || !body.length) throw new Error("Empty capture evidence");
  const record = {
    version: 1, runId: input.adFetchRunId, pageId: String(input.metaPageId),
    capturedAt: new Date().toISOString(), status, receipt, body, sha256: digest(body),
  };
  await mkdir(join(root, "capture-journal"), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  return record;
}
export async function loadCaptureJournal(root, input) {
  let record;
  try { record = JSON.parse(await readFile(journalPath(root, input.adFetchRunId), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (record.version !== 1 || record.runId !== input.adFetchRunId || record.pageId !== String(input.metaPageId)
      || typeof record.body !== "string" || digest(record.body) !== record.sha256
      || !Number.isInteger(record.status) || record.status < 100 || record.status > 599) {
    throw new Error("Capture journal identity or checksum mismatch");
  }
  return record;
}
export async function ensureFetchRun(rest, row) {
  let result;
  try {
    result = await rest("research", "ad_fetch_runs", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row),
    });
  } catch (error) {
    // The maintained database has a partial unique idempotency index. A
    // conflict is expected after restart; never create a second paid run.
    if (!/409|23505|duplicate key/iu.test(String(error.message))) throw error;
  }
  if (result?.[0]?.id) return result[0].id;
  const existing = await rest("research", "ad_fetch_runs?select=id,advertiser_page_id&idempotency_key=eq."
    + encodeURIComponent(row.idempotency_key) + "&limit=1");
  if (!existing?.[0]?.id || existing[0].advertiser_page_id !== row.advertiser_page_id) throw new Error("Fetch run identity was not confirmed");
  return existing[0].id;
}
