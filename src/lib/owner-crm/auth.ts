import {
  type InternalAuthResult,
  verifyInternalRequest,
} from "../internal-auth.ts";

import { OWNER_CRM_SNAPSHOT_INTERNAL_SCOPE } from "./customer-snapshot.ts";

type InternalVerifier = typeof verifyInternalRequest;

/**
 * This privacy-sensitive endpoint deliberately does not inherit the temporary
 * legacy bearer compatibility path available to some older internal routes.
 */
export async function verifyOwnerCrmSnapshotRequest(
  request: Request,
  verifier: InternalVerifier = verifyInternalRequest,
): Promise<InternalAuthResult> {
  if (request.headers.has("authorization")) {
    return { ok: false, status: 401, error: "legacy_bearer_not_permitted" };
  }
  const secret = process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET ?? "";
  if (secret && [process.env.BLOCKWISE_INTERNAL_AUTH_SECRET, process.env.BLOCKWISE_INTERNAL_SECRET].includes(secret)) {
    return { ok: false, status: 503, error: "dedicated_secret_required" };
  }
  return verifier(request, OWNER_CRM_SNAPSHOT_INTERNAL_SCOPE, {
    // Never fall back to the shared internal API secret. This projection has
    // its own least-privilege credential shared only with the owner CRM sync.
    secret,
  });
}
