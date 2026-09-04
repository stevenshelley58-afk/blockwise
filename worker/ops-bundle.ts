import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

export type OpsBundle = {
  project_id: "blockwise";
  source_revision: string;
  source_receipt_ids: string[];
  workspace_ids: string[];
  generated_at: string;
  fresh_until: string;
  projections: Record<string, unknown[]>;
};

/** Hermes-owned crash-safe publisher for Frank's read-only ops mount. */
export function publishOpsBundle(root: string, input: Omit<OpsBundle, "generated_at"> & { generated_at?: string }): { receiptId: string; sha256: string } {
  if (!root || input.project_id !== "blockwise" || !input.source_revision || !input.source_receipt_ids.length || !input.workspace_ids.length) throw new Error("ops bundle provenance is incomplete");
  if (new Date(input.fresh_until).getTime() <= Date.now()) throw new Error("ops bundle is already stale");
  const bundle: OpsBundle = { ...input, generated_at: input.generated_at ?? new Date().toISOString() };
  const body = Buffer.from(JSON.stringify(bundle)); const sha256 = createHash("sha256").update(body).digest("hex"); const receiptId = `receipt:ops/${Date.now()}-${randomUUID()}`;
  const dir = join(root, "releases"); mkdirSync(dir, { recursive: true, mode: 0o700 }); const name = `${bundle.source_revision}.json`; const temp = join(dir, `.${name}.${randomUUID()}.tmp`);
  writeFileSync(temp, body, { mode: 0o600 }); chmodSync(temp, 0o600); renameSync(temp, join(dir, name));
  const pointer = Buffer.from(JSON.stringify({ schema: "schema://frank.ops-pointer/v1", project_id: "blockwise", current: name, source_revision: bundle.source_revision, published_at: bundle.generated_at, fresh_until: bundle.fresh_until, publication_receipt_id: receiptId, sha256 }));
  const pointerTemp = join(root, `.current.${randomUUID()}.tmp`); writeFileSync(pointerTemp, pointer, { mode: 0o600 }); chmodSync(pointerTemp, 0o600); renameSync(pointerTemp, join(root, "current.json"));
  return { receiptId, sha256 };
}
