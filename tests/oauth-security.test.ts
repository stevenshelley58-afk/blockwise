import assert from "node:assert/strict";
import test from "node:test";

import { decryptToken, encryptToken } from "../src/lib/providers/token-crypto.ts";
import { signOAuthState, verifyOAuthState } from "../src/lib/providers/oauth-state.ts";

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
