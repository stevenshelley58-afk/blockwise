import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const digest = (body) => createHash("sha256").update(body).digest("hex");
function journalPath(root, runId) {
  if (!UUID.test(String(runId))) throw new Error("Invalid capture run ID");
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


// Parsing a saved response may improve; the original paid receipt must not change.
export async function reconcileSavedCaptureSettlement({rest, settle, attemptId, runId, receipt, outcome}) {
  if (typeof rest !== "function" || typeof settle !== "function" || !UUID.test(attemptId || "") || !UUID.test(runId || "")) {
    throw new Error("saved capture settlement identity/handlers are required");
  }
  const credit = value => {
    if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  if (typeof receipt?.chargeKnown !== "boolean" || (receipt.chargeKnown && credit(receipt.credits) === null)) {
    throw new Error("saved capture provider receipt mismatch");
  }
  const rows = await rest("research",
    "provider_credit_attempts?select=attempt_id,provider,run_id,status,outcome,charge_known,actual_credits,reserved_credits,run_credit_cap"
    + "&attempt_id=eq." + encodeURIComponent(attemptId) + "&run_id=eq." + encodeURIComponent(runId)
    + "&provider=eq.scrapingbee&limit=1");
  const attempt = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!attempt || attempt.attempt_id !== attemptId || attempt.run_id !== runId || attempt.provider !== "scrapingbee") {
    throw new Error("saved capture provider attempt identity mismatch");
  }
  if (attempt.status === "settled") {
    const matchingCharge = attempt.charge_known === receipt.chargeKnown;
    const matchingCredits = receipt.chargeKnown
      ? credit(attempt.actual_credits) !== null && credit(attempt.actual_credits) === credit(receipt.credits)
      : attempt.actual_credits === null;
    if (!matchingCharge || !matchingCredits) throw new Error("saved capture provider receipt mismatch");
    return {settlement:"skipped_already_settled",ledgerOutcome:attempt.outcome};
  }
  if (attempt.status !== "reserved" || attempt.charge_known !== null || attempt.actual_credits !== null) {
    throw new Error("saved capture provider attempt has invalid unsettled state");
  }
  const reservation = credit(attempt.reserved_credits), cap = credit(attempt.run_credit_cap);
  if (reservation === null || cap === null || reservation <= 0 || cap <= 0 ||
      (receipt.chargeKnown && credit(receipt.credits) > Math.min(reservation, cap))) {
    throw new Error("saved capture provider receipt exceeds reservation");
  }
  await settle({p_attempt_id:attemptId,p_outcome:outcome,p_charge_known:receipt.chargeKnown,
    p_actual_credits:receipt.chargeKnown ? credit(receipt.credits) : null});
  return {settlement:"settled",ledgerOutcome:outcome};
}
