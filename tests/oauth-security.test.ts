import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decryptToken, encryptToken } from "../src/lib/providers/token-crypto.ts";
import {
  createOAuthStatePayload,
  sanitizeOAuthCampaignId,
  sanitizeOAuthReturnPath,
  signOAuthState,
  verifyOAuthState,
} from "../src/lib/providers/oauth-state.ts";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const stateSecret = Buffer.alloc(32, 9).toString("base64");

test("OAuth state validates provider, workspace, user, and expiry", () => {
  const state = signOAuthState(
    {
      provider: "google",
      workspaceId: "workspace_demo",
      userId: "user_demo",
      returnPath: "/monitor",
      issuedAt: 1_779_840_000,
      nonce: "nonce_demo",
    },
    stateSecret,
  );

  const verified = verifyOAuthState(state, {
    expectedProvider: "google",
    expectedUserId: "user_demo",
    nowSeconds: 1_779_840_300,
    secret: stateSecret,
  });

  assert.equal(verified.ok, true);
  assert.equal(verified.ok && verified.payload.workspaceId, "workspace_demo");
});

test("OAuth state rejects tampering and wrong providers", () => {
  const state = signOAuthState(
    {
      provider: "meta",
      workspaceId: "workspace_demo",
      userId: "user_demo",
      returnPath: "/monitor",
      issuedAt: 1_779_840_000,
      nonce: "nonce_demo",
    },
    stateSecret,
  );

  assert.equal(
    verifyOAuthState(`${state.slice(0, -2)}xx`, {
      expectedProvider: "meta",
      expectedUserId: "user_demo",
      nowSeconds: 1_779_840_300,
      secret: stateSecret,
    }).ok,
    false,
  );
  assert.equal(
    verifyOAuthState(state, {
      expectedProvider: "google",
      expectedUserId: "user_demo",
      nowSeconds: 1_779_840_300,
      secret: stateSecret,
    }).ok,
    false,
  );
});

test("provider tokens encrypt with last-four metadata and decrypt with the same key", () => {
  const encrypted = encryptToken("access-token-abc123", encryptionKey);

  assert.equal(encrypted.lastFour, "c123");
  assert.notEqual(encrypted.ciphertext, "access-token-abc123");
  assert.equal(decryptToken(encrypted, encryptionKey), "access-token-abc123");
});

test("OAuth return paths are allowlisted for onboarding", () => {
  assert.equal(sanitizeOAuthReturnPath("/onboarding"), "/onboarding");
  assert.equal(sanitizeOAuthReturnPath("https://evil.example/onboarding"), "/results");
  assert.equal(sanitizeOAuthReturnPath("/settings"), "/results");

  const payload = createOAuthStatePayload({
    provider: "meta",
    workspaceId: "workspace_demo",
    userId: "user_demo",
    returnPath: "/onboarding",
    nowSeconds: 1_779_840_000,
  });

  assert.equal(payload.returnPath, "/onboarding");
});

test("Meta OAuth state signs a safe Ad Studio resume path and campaign identifier", () => {
  const payload = createOAuthStatePayload({
    provider: "meta",
    workspaceId: "workspace_demo",
    userId: "user_demo",
    returnPath: "/ad-studio",
    campaignId: "campaign_123",
    nowSeconds: 1_779_840_000,
  });
  const verified = verifyOAuthState(signOAuthState(payload, stateSecret), {
    expectedProvider: "meta",
    expectedUserId: "user_demo",
    nowSeconds: 1_779_840_100,
    secret: stateSecret,
  });

  assert.equal(payload.returnPath, "/ad-studio");
  assert.equal(verified.ok && verified.payload.campaignId, "campaign_123");
  assert.equal(sanitizeOAuthCampaignId("../../billing"), null);
  assert.equal(sanitizeOAuthReturnPath("//evil.example"), "/results");
});

test("Meta connect and callback preserve the signed resume path and campaign", () => {
  const connectRoute = readFileSync("src/app/api/integrations/meta/connect/route.ts", "utf8");
  const callbackRoute = readFileSync("src/app/api/integrations/meta/callback/route.ts", "utf8");

  assert.match(connectRoute, /sanitizeOAuthReturnPath\(request\.nextUrl\.searchParams\.get\("returnPath"\)\)/);
  assert.match(connectRoute, /sanitizeOAuthCampaignId\(request\.nextUrl\.searchParams\.get\("campaignId"\)\)/);
  assert.match(connectRoute, /returnPath,/);
  assert.match(connectRoute, /campaignId,/);
  assert.match(callbackRoute, /providerReturnUrl\(verified\.payload\.returnPath/);
  assert.match(callbackRoute, /verified\.payload\.campaignId/);
  assert.doesNotMatch(callbackRoute, /const finalUrl = .*\/results/);
});
