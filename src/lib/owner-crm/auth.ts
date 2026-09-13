import { type InternalAuthResult, verifyInternalRequest } from "../internal-auth.ts";
import { OWNER_CRM_SNAPSHOT_INTERNAL_SCOPE } from "./customer-snapshot.ts";
import { OWNER_CRM_LEAD_INTAKE_INTERNAL_SCOPE } from "./lead-intake.ts";
type InternalVerifier = typeof verifyInternalRequest;
export async function verifyOwnerCrmSnapshotRequest(request: Request, verifier: InternalVerifier = verifyInternalRequest): Promise<InternalAuthResult> {
  if (request.headers.has("authorization")) return { ok: false, status: 401, error: "legacy_bearer_not_permitted" };
  const secret = process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET ?? "";
  if (secret && [process.env.BLOCKWISE_INTERNAL_AUTH_SECRET, process.env.BLOCKWISE_INTERNAL_SECRET].includes(secret)) return { ok: false, status: 503, error: "dedicated_secret_required" };
  return verifier(request, OWNER_CRM_SNAPSHOT_INTERNAL_SCOPE, { secret });
}
export async function verifyOwnerLeadIntakeRequest(request: Request, verifier: InternalVerifier = verifyInternalRequest): Promise<InternalAuthResult> {
  if (request.headers.has("authorization")) return { ok: false, status: 401, error: "legacy_bearer_not_permitted" };
  const secret = process.env.OWNER_LEAD_INTAKE_AUTH_SECRET ?? "";
  if (secret && [process.env.BLOCKWISE_INTERNAL_AUTH_SECRET, process.env.BLOCKWISE_INTERNAL_SECRET, process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET].includes(secret)) return { ok: false, status: 503, error: "dedicated_secret_required" };
  return verifier(request, OWNER_CRM_LEAD_INTAKE_INTERNAL_SCOPE, { secret });
}