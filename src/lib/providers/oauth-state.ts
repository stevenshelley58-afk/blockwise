import { createHmac, randomBytes } from "node:crypto";

import type { MonitorProvider } from "../monitor/dashboard-data.ts";
import { safeEqual } from "./token-crypto.ts";

export type OAuthStatePayload = {
  provider: MonitorProvider;
  workspaceId: string;
  userId: string;
  returnPath: string;
  campaignId?: string | null;
  issuedAt: number;
  nonce: string;
};

type VerifyOptions = {
  expectedProvider: MonitorProvider;
  expectedUserId: string;
  nowSeconds?: number;
  maxAgeSeconds?: number;
  secret?: string;
};

const DEFAULT_MAX_AGE_SECONDS = 10 * 60;
const ALLOWED_RETURN_PATHS = new Set([
  "/results",
  "/onboarding",
  "/ad-studio",
  "/settings#connections",
]);

export function sanitizeOAuthReturnPath(value: string | null | undefined): string {
  const path = value?.trim();
  return path && ALLOWED_RETURN_PATHS.has(path) ? path : "/results";
}

export function createOAuthStatePayload(input: {
  provider: MonitorProvider;
  workspaceId: string;
  userId: string;
  returnPath?: string;
  campaignId?: string | null;
  nowSeconds?: number;
}): OAuthStatePayload {
  return {
    provider: input.provider,
    workspaceId: input.workspaceId,
    userId: input.userId,
    returnPath: sanitizeOAuthReturnPath(input.returnPath),
    campaignId: sanitizeOAuthCampaignId(input.campaignId),
    issuedAt: input.nowSeconds ?? Math.floor(Date.now() / 1000),
    nonce: randomBytes(16).toString("base64url"),
  };
}

export function signOAuthState(payload: OAuthStatePayload, secret = process.env.TOKEN_ENCRYPTION_KEY ?? ""): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifyOAuthState(
  state: string,
  options: VerifyOptions,
): { ok: true; payload: OAuthStatePayload } | { ok: false; error: string } {
  const [encodedPayload, signature, extra] = state.split(".");

  if (!encodedPayload || !signature || extra !== undefined) {
    return { ok: false, error: "Invalid OAuth state." };
  }

  if (!safeEqual(sign(encodedPayload, options.secret ?? process.env.TOKEN_ENCRYPTION_KEY ?? ""), signature)) {
    return { ok: false, error: "Invalid OAuth state signature." };
  }

  let payload: OAuthStatePayload;

  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as OAuthStatePayload;
  } catch {
    return { ok: false, error: "Invalid OAuth state payload." };
  }

  if (payload.provider !== options.expectedProvider) {
    return { ok: false, error: "OAuth provider mismatch." };
  }

  if (payload.userId !== options.expectedUserId) {
    return { ok: false, error: "OAuth user mismatch." };
  }
  const campaignId = sanitizeOAuthCampaignId(payload.campaignId);
  if (payload.campaignId !== undefined && payload.campaignId !== null && campaignId !== payload.campaignId) {
    return { ok: false, error: "Invalid OAuth campaign resume identifier." };
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  if (!Number.isFinite(payload.issuedAt) || payload.issuedAt < now - maxAge || payload.issuedAt > now + 60) {
    return { ok: false, error: "OAuth state expired." };
  }

  return { ok: true, payload: { ...payload, campaignId } };
}

export function sanitizeOAuthCampaignId(value: string | null | undefined): string | null {
  const campaignId = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{1,128}$/.test(campaignId) ? campaignId : null;
}

function sign(encodedPayload: string, secret: string): string {
  if (!secret.trim()) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required to sign OAuth state.");
  }

  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}
