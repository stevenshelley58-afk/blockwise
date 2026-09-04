/** Crash-safe Hermes publication compatible with Frank PR #121. */
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const FRANK_OPS_SCHEMA = "schema://frank.ops/v1" as const;
export const FRANK_POINTER_SCHEMA = "schema://frank.ops-pointer/v1" as const;
export const PROJECTIONS = ["customers", "email", "flows", "mautic", "enquiries", "bookings", "billing", "activity", "members", "capabilities"] as const;
type Projection = typeof PROJECTIONS[number];
export type OpsBundle = { project_id: "blockwise"; source_revision: string; source_receipt_ids: string[]; workspace_ids: string[]; fresh_until: string; projections: Partial<Record<Projection, unknown[] | null>>; generated_at?: string };

function durable(path: string, text: string): void { const fd = openSync(path, "w", 0o600); try { writeFileSync(fd, text, { encoding: "utf8" }); fsyncSync(fd); } finally { requireClose(fd); } chmodSync(path, 0o600); }
function requireClose(fd: number): void { closeSync(fd); }
function fsyncDir(path: string): void { try { const fd = openSync(path, "r"); fsyncSync(fd); requireClose(fd); } catch { /* Windows and some overlay filesystems reject directory fsync. */ } }

/** Writes Frank's generation directory, receipt, and pointer in one atomic cut. */
export function publishOpsBundle(root: string, input: OpsBundle): { receiptId: string; sha256: string; generation: string } {
  if (!root || input.project_id !== "blockwise" || !input.source_revision || !/^[A-Za-z0-9._:-]{1,256}$/u.test(input.source_revision) || !input.source_receipt_ids.length || !input.workspace_ids.length) throw new Error("ops bundle provenance is incomplete");
  const freshUntil = new Date(input.fresh_until); if (!Number.isFinite(freshUntil.getTime()) || freshUntil.getTime() <= Date.now()) throw new Error("ops bundle is already stale");
  const generated = input.generated_at ? new Date(input.generated_at) : new Date(); if (!Number.isFinite(generated.getTime())) throw new Error("ops bundle generated_at is invalid");
  const publicationReceiptId = `receipt:ops/${generated.toISOString().replace(/[-:.TZ]/gu, "")}-${randomUUID()}`;
  const output = root; mkdirSync(output, { recursive: true, mode: 0o750 }); const generations = join(output, "generations"); mkdirSync(generations, { recursive: true, mode: 0o750 });
  const generation = `gen-${generated.toISOString().replace(/[-:.TZ]/gu, "")}-${randomUUID()}`; const staging = join(generations, `.${generation}.tmp`); mkdirSync(staging, { recursive: true, mode: 0o700 });
  const names: Record<Projection, string> = { customers: "customers.json", email: "email.json", flows: "flows.json", mautic: "mautic.json", enquiries: "enquiries.json", bookings: "bookings.json", billing: "billing.json", activity: "activity.json", members: "members.json", capabilities: "capabilities.json" };
  const schemas: Record<Projection, string> = { customers: "schema://frank.ops.customer-summary/v1", email: "schema://frank.ops.transactional-email/v1", flows: "schema://frank.ops.email-flows/v1", mautic: "schema://frank.ops.mautic-lifecycle/v1", enquiries: "schema://frank.ops.chatwoot-enquiries/v1", bookings: "schema://frank.ops.snagtime-bookings/v1", billing: "schema://frank.ops.stripe-billing/v1", activity: "schema://frank.ops.activity/v1", members: "schema://frank.ops.members/v1", capabilities: "schema://blockwise.ops-action-capabilities/v1" };
  const bodyHashes: Record<string, string> = {};
  for (const name of PROJECTIONS) { const envelope = { schema: schemas[name], version: 1, projection: name, project_id: "blockwise", workspace_ids: [...input.workspace_ids].sort(), source_scope: { project_id: "blockwise", workspace_ids: [...input.workspace_ids].sort(), system: name }, source_revision: input.source_revision, source_receipt_ids: [...input.source_receipt_ids].sort(), publication_receipt_id: publicationReceiptId, published_at: generated.toISOString(), fresh_until: freshUntil.toISOString(), items: input.projections[name] ?? [] }; const body = JSON.stringify(envelope) + "\n"; durable(join(staging, names[name]), body); bodyHashes[names[name]] = createHash("sha256").update(body).digest("hex"); }
  const receipt = { schema: "schema://frank.ops-publication-receipt/v1", project_id: "blockwise", workspace_ids: [...input.workspace_ids].sort(), publication_receipt_id: publicationReceiptId, source_revision: input.source_revision, source_receipt_ids: [...input.source_receipt_ids].sort(), published_at: generated.toISOString(), projection_count: PROJECTIONS.length };
  const receiptBody = JSON.stringify(receipt) + "\n"; durable(join(staging, "publication-receipt.json"), receiptBody);
  const pointer = { schema: "schema://frank.ops-pointer/v1", version: 1, generation, publication_receipt_id: publicationReceiptId };
  const pointerBody = JSON.stringify(pointer) + "\n";
  const receiptSha256 = createHash("sha256").update(receiptBody).digest("hex");
  const pointerSha256 = createHash("sha256").update(pointerBody).digest("hex");
  const manifestInput = { generation, publication_receipt_id: publicationReceiptId, files: { ...bodyHashes, "publication-receipt.json": receiptSha256 }, pointer_sha256: pointerSha256 };
  const bundleSha256 = createHash("sha256").update(JSON.stringify(manifestInput)).digest("hex");
  const manifest = { schema: "schema://frank.ops-manifest/v1", version: 1, ...manifestInput, bundle_sha256: bundleSha256 };
  durable(join(staging, "manifest.json"), JSON.stringify(manifest) + "\n"); fsyncDir(staging); renameSync(staging, join(generations, generation)); fsyncDir(generations);
  const pointerTemp = join(output, `.current.${randomUUID()}.tmp`); durable(pointerTemp, pointerBody); renameSync(pointerTemp, join(output, "current.json")); fsyncDir(output);
  for (const old of readdirSync(generations)) if (old !== generation && !old.startsWith(".")) { try { /* only remove old complete generations; keep three for rollback. */ const all = readdirSync(generations).filter((v) => !v.startsWith(".")).sort().reverse(); if (all.indexOf(old) >= 3) { /* recursive removal intentionally avoided; files are immutable and old generations may be operator-retained. */ } } catch { /* best effort GC never affects publication */ } }
  return { receiptId: publicationReceiptId, sha256: `sha256:${bundleSha256}`, generation };
}
