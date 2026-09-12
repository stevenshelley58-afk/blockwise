import { createDecipheriv, createHash } from "node:crypto";

const TAG_BYTES = 16;

function normalizeKey(keyMaterial) {
  const trimmed = String(keyMaterial || "").trim();
  if (!trimmed) throw new Error("TOKEN_ENCRYPTION_KEY is required for provider token decryption.");
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/u, "") === trimmed.replace(/=+$/u, "")) return decoded;
  if (Buffer.byteLength(trimmed, "utf8") === 32) return Buffer.from(trimmed, "utf8");
  return createHash("sha256").update(trimmed, "utf8").digest();
}

function byteaToBuffer(value) {
  if (!value) return null;
  if (typeof value === "string") {
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    return Buffer.from(value, "hex");
  }
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

/** Decrypts the packed JSON bytea returned by runtime_provider_token_vault_get. */
export function decryptRuntimeProviderToken(row, keyMaterial = process.env.TOKEN_ENCRYPTION_KEY) {
  if (!row?.token_nonce || !row?.encrypted_access_token) return null;
  const packed = byteaToBuffer(row.encrypted_access_token);
  if (!packed) return null;
  let ciphertext = packed;
  let nonce = row.token_nonce;
  try {
    const decoded = JSON.parse(packed.toString("utf8"));
    if (decoded && typeof decoded === "object" && decoded.ciphertext && decoded.nonce) {
      ciphertext = Buffer.from(decoded.ciphertext, "base64");
      nonce = decoded.nonce;
    }
  } catch {
    // Legacy rows store raw ciphertext bytea with the nonce in the RPC row.
  }
  const payload = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext);
  if (payload.length <= TAG_BYTES) throw new Error("runtime provider token ciphertext is invalid");
  const iv = Buffer.from(String(nonce), "base64");
  const body = payload.subarray(0, payload.length - TAG_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", normalizeKey(keyMaterial), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

function isLegacyJwt(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(String(value || ""));
}

/** Read one service-scoped token through the public service-role RPC only. */
export async function loadRuntimeProviderToken({ url, credential, provider, keyMaterial = process.env.TOKEN_ENCRYPTION_KEY, fetchImpl = fetch }) {
  const base = String(url || "").replace(/\/+$/u, "");
  const key = String(credential || "").trim();
  if (!base || !key || !String(provider || "").trim()) throw new Error("runtime provider vault configuration is incomplete");
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (isLegacyJwt(key)) headers.Authorization = "Bearer " + key;
  const response = await fetchImpl(base + "/rest/v1/rpc/runtime_provider_token_vault_get", {
    method: "POST",
    headers,
    body: JSON.stringify({ p_runtime_provider: String(provider).trim() }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error("runtime_provider_token_vault_get failed: " + response.status);
  const row = Array.isArray(body) ? body[0] : body;
  return decryptRuntimeProviderToken(row, keyMaterial);
}
