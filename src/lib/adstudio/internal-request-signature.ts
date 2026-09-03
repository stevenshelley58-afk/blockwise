import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const TEMPLATE_ARTIFACT_SIGNATURE_SCOPE = "adstudio.templates";
export const INTERNAL_REQUEST_MAX_CLOCK_SKEW_SECONDS = 300;

type VerifyInternalRequestSignatureInput = {
  body: string;
  method: string;
  path: string;
  timestamp: string | null;
  nonce: string | null;
  scope: string | null;
  signature: string | null;
  secret?: string;
  nowMs?: number;
  onFailure?: (reason: InternalRequestSignatureFailure) => void;
};

export type InternalRequestSignatureFailure =
  | "missing_secret"
  | "invalid_scope"
  | "invalid_timestamp"
  | "invalid_nonce"
  | "invalid_signature_format"
  | "timestamp_outside_window"
  | "signature_mismatch";

export type VerifiedInternalRequestSignature = {
  nonce: string;
  scope: typeof TEMPLATE_ARTIFACT_SIGNATURE_SCOPE;
  expiresAt: string;
};

export function verifyInternalRequestSignature(
  input: VerifyInternalRequestSignatureInput,
): VerifiedInternalRequestSignature | null {
  const reject = (reason: InternalRequestSignatureFailure) => {
    input.onFailure?.(reason);
    return null;
  };
  const secret = input.secret?.trim();
  if (!secret) return reject("missing_secret");
  if (input.scope !== TEMPLATE_ARTIFACT_SIGNATURE_SCOPE) return reject("invalid_scope");
  if (!/^\d{1,10}$/.test(input.timestamp ?? "")) return reject("invalid_timestamp");
  if (!/^[a-f0-9]{32}$/.test(input.nonce ?? "")) return reject("invalid_nonce");
  if (!/^[a-f0-9]{64}$/.test(input.signature ?? "")) return reject("invalid_signature_format");

  const timestampSeconds = Number(input.timestamp);
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (
    !Number.isSafeInteger(timestampSeconds)
    || Math.abs(nowSeconds - timestampSeconds) >= INTERNAL_REQUEST_MAX_CLOCK_SKEW_SECONDS
  ) return reject("timestamp_outside_window");

  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const signingPayload = [
    "v1",
    input.timestamp,
    input.nonce,
    input.scope,
    input.method.toUpperCase(),
    input.path,
    bodyHash,
  ].join("\n");
  const expected = Buffer.from(createHmac("sha256", secret).update(signingPayload).digest("hex"), "hex");
  const provided = Buffer.from(input.signature!, "hex");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return reject("signature_mismatch");
  }

  return {
    nonce: input.nonce!,
    scope: TEMPLATE_ARTIFACT_SIGNATURE_SCOPE,
    expiresAt: new Date(
      (timestampSeconds + INTERNAL_REQUEST_MAX_CLOCK_SKEW_SECONDS) * 1_000,
    ).toISOString(),
  };
}
