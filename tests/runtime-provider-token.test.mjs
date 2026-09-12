import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import test from "node:test";
import { decryptRuntimeProviderToken } from "../hermes/tools/research-runtime/bin/runtime-provider-token.mjs";

function packedToken(value, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "utf8"), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  const packed = Buffer.from(JSON.stringify({ ciphertext, nonce: nonce.toString("base64"), lastFour: value.slice(-4) }), "utf8").toString("hex");
  return { token_nonce: nonce.toString("base64"), encrypted_access_token: "\\x" + packed };
}

test("decrypts packed runtime vault rows without exposing a private-schema path", () => {
  const key = "0123456789abcdef0123456789abcdef";
  const row = packedToken("provider-token-fixture", key);
  assert.equal(decryptRuntimeProviderToken(row, key), "provider-token-fixture");
});

test("missing runtime vault rows are absence, not an env fallback", () => {
  assert.equal(decryptRuntimeProviderToken(null, "key"), null);
  assert.equal(decryptRuntimeProviderToken({ token_nonce: null }, "key"), null);
});
