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
};

export type VerifiedInternalRequestSignature = {
  nonce: string;
  scope: typeof TEMPLATE_ARTIFACT_SIGNATURE_SCOPE;
  expiresAt: string;
};

export function verifyInternalRequestSignature(
  input: VerifyInternalRequestSignatureInput,
): VerifiedInternalRequestSignature | null {
  const secret = input.secret?.trim();
  if (!secret || input.scope !== TEMPLATE_ARTIFACT_SIGNATURE_SCOPE) return null;
  if (!/^\d{1,10}$/.test(input.timestamp ?? "")) return null;
  if (!/^[a-f0-9]{32}$/.test(input.nonce ?? "")) return null;
  if (!/^[a-f0-9]{64}$/.test(input.signature ?? "")) return null;

  const timestampSeconds = Number(input.timestamp);
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (
    !Number.isSafeInteger(timestampSeconds)
    || Math.abs(nowSeconds - timestampSeconds) >= INTERNAL_REQUEST_MAX_CLOCK_SKEW_SECONDS
  ) return null;

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
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  return {
    nonce: input.nonce!,
    scope: TEMPLATE_ARTIFACT_SIGNATURE_SCOPE,
    expiresAt: new Date(
      (timestampSeconds + INTERNAL_REQUEST_MAX_CLOCK_SKEW_SECONDS) * 1_000,
    ).toISOString(),
  };
}
