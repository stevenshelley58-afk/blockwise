import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type EncryptedToken = {
  ciphertext: string;
  nonce: string;
  lastFour: string;
};

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function encryptToken(plaintext: string, keyMaterial = process.env.TOKEN_ENCRYPTION_KEY ?? ""): EncryptedToken {
  const key = normalizeEncryptionKey(keyMaterial);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString("base64"),
    nonce: nonce.toString("base64"),
    lastFour: plaintext.slice(-4),
  };
}

export function decryptToken(encrypted: EncryptedToken, keyMaterial = process.env.TOKEN_ENCRYPTION_KEY ?? ""): string {
  const key = normalizeEncryptionKey(keyMaterial);
  const payload = Buffer.from(encrypted.ciphertext, "base64");
  const nonce = Buffer.from(encrypted.nonce, "base64");
  const ciphertext = payload.subarray(0, Math.max(0, payload.length - TAG_BYTES));
  const tag = payload.subarray(Math.max(0, payload.length - TAG_BYTES));
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function tokenCiphertextToPostgresBytea(ciphertext: string): string {
  return `\\x${Buffer.from(ciphertext, "base64").toString("hex")}`;
}

export function postgresByteaToTokenCiphertext(value: string | Uint8Array | ArrayBuffer | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (typeof value !== "string") {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    return Buffer.from(bytes).toString("base64");
  }

  if (value.startsWith("\\x")) {
    return Buffer.from(value.slice(2), "hex").toString("base64");
  }

  return Buffer.from(value, "hex").toString("base64");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeEncryptionKey(keyMaterial: string): Buffer {
  const trimmed = keyMaterial.trim();

  if (!trimmed) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required for provider token encryption.");
  }

  const decoded = Buffer.from(trimmed, "base64");

  if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === trimmed.replace(/=+$/, "")) {
    return decoded;
  }

  if (Buffer.byteLength(trimmed, "utf8") === 32) {
    return Buffer.from(trimmed, "utf8");
  }

  return createHash("sha256").update(trimmed).digest();
}
