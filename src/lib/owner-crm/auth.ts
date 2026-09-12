import {
  type InternalAuthResult,
  verifyInternalRequest,
} from "../internal-auth.ts";

import { OWNER_CRM_SNAPSHOT_INTERNAL_SCOPE } from "./customer-snapshot.ts";

type InternalVerifier = (
  request: Request,
  expectedScope: string,
) => Promise<InternalAuthResult>;

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
  return verifier(request, OWNER_CRM_SNAPSHOT_INTERNAL_SCOPE);
}
