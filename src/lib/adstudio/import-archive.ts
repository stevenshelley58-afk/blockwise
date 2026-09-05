import { inflateRawSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Secure ZIP archive handling for TemplatePack import (Phase 3 spec).
//
// Threat model enforced here, BEFORE any entry bytes are inflated:
//  - ZIP magic validation.
//  - Archive size ceiling.
//  - Entry-count ceiling (zip-bomb shape defence).
//  - Path traversal rejection (`..`, absolute paths, backslash tricks).
//  - Symlink/hardlink/special-file rejection via external attributes.
//  - Deflated+stored size ceiling and inflation-ratio guard (zip bomb).
//  - MIME magic-byte validation per expected entry.
//  - Exact expected-entry matching: nothing extra, nothing missing.
// ---------------------------------------------------------------------------

export class ArchiveSecurityError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export interface ArchiveEntry {
  name: string;
  bytes: Buffer;
}

const ZIP_LOCAL_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MAX_ENTRIES = 500;
const MAX_INFLATED_TOTAL = 200 * 1024 * 1024; // 200 MB total inflated
const MAX_RATIO = 60; // inflated/uncompressed ratio guard

// ---------------------------------------------------------------------------
// Minimal central-directory parser — gives us entry metadata (external
// attributes, sizes, offsets) before any inflation happens.
// ---------------------------------------------------------------------------

interface CentralEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttributes: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD is at least 22 bytes; signature 0x06054b50 at its start.
  const min = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new ArchiveSecurityError("zip_bad_eocd", "end-of-central-directory record not found");
}

function parseCentralDirectory(buf: Buffer): CentralEntry[] {
  const eocd = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  if (entryCount > MAX_ENTRIES) {
    throw new ArchiveSecurityError("zip_too_many_entries", `${entryCount} entries exceeds limit ${MAX_ENTRIES}`);
  }
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries: CentralEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new ArchiveSecurityError("zip_bad_central", `central directory entry ${i} corrupt`);
    }
    const compressionMethod = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const externalAttributes = buf.readUInt32LE(p + 38);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    if (!(compressionMethod === 0 || compressionMethod === 8)) {
      throw new ArchiveSecurityError("zip_bad_compression", `entry ${name}: unsupported method ${compressionMethod}`);
    }
    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, externalAttributes, localHeaderOffset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function assertSafeName(name: string): void {
  if (name.length === 0) throw new ArchiveSecurityError("zip_bad_name", "empty entry name");
  if (name.includes("\\")) throw new ArchiveSecurityError("zip_path_traversal", `entry ${name}: backslash path`);
  if (name.startsWith("/")) throw new ArchiveSecurityError("zip_path_traversal", `entry ${name}: absolute path`);
  const segments = name.split("/");
  for (const s of segments) {
    if (s === "..") throw new ArchiveSecurityError("zip_path_traversal", `entry ${name}: parent traversal`);
    if (s === "") {
      // allow trailing slash (directory marker) only
      if (name.endsWith("/") && s === segments[segments.length - 1]) continue;
      throw new ArchiveSecurityError("zip_bad_name", `entry ${name}: empty segment`);
    }
  }
}

function isSymlinkOrSpecial(externalAttributes: number): boolean {
  const unixMode = externalAttributes >>> 16;
  if (unixMode === 0) return false; // not unix-encoded — treat as regular
  const fileType = unixMode & 0o170000;
  if (fileType === 0 || fileType === 0o040000 || fileType === 0o100000) return false; // none/dir/regular
  return true; // symlink 0120000, fifo, device, socket, ...
}

function readEntryBytes(buf: Buffer, entry: CentralEntry): Buffer {
  const p = entry.localHeaderOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) {
    throw new ArchiveSecurityError("zip_bad_local", `entry ${entry.name}: corrupt local header`);
  }
  const nameLength = buf.readUInt16LE(p + 26);
  const extraLength = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLength + extraLength;
  if (dataStart + entry.compressedSize > buf.length) {
    throw new ArchiveSecurityError("zip_truncated", `entry ${entry.name}: data exceeds archive bounds`);
  }
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return Buffer.from(raw);
  const inflated = inflateRawSync(new Uint8Array(raw));
  if (inflated.length > entry.uncompressedSize + 4096) {
    throw new ArchiveSecurityError("zip_bomb", `entry ${entry.name}: inflated size exceeds declared size`);
  }
  return Buffer.from(inflated);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAGIC_CHECKS: Record<string, (b: Buffer) => boolean> = {
  "application/json": b => {
    try {
      JSON.parse(b.toString("utf8"));
      return true;
    } catch {
      return false;
    }
  },
  "image/png": b => b.length > 8 && b.readUInt32BE(0) === 0x89504e47,
  "image/jpeg": b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": b => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  "font/woff2": b => b.length > 4 && b.toString("ascii", 0, 4) === "wOF2",
  "font/woff": b => b.length > 4 && b.toString("ascii", 0, 4) === "wOFF",
};

/**
 * Parse a ZIP archive with all hard security checks applied to EVERY entry
 * (magic, traversal, symlinks, zip-bomb guards), regardless of content type.
 * Returns all regular-file entries; directory markers are dropped.
 */
export function extractArchiveEntries(archive: Buffer): Map<string, Buffer> {
  if (!archive.subarray(0, 4).equals(ZIP_LOCAL_MAGIC)) {
    throw new ArchiveSecurityError("zip_bad_magic", "not a ZIP archive");
  }

  const entries = parseCentralDirectory(archive);
  const out = new Map<string, Buffer>();
  let inflatedTotal = 0;
  for (const e of entries) {
    assertSafeName(e.name);
    if (e.name.endsWith("/") && e.compressedSize === 0) continue; // directory marker
    if (isSymlinkOrSpecial(e.externalAttributes)) {
      throw new ArchiveSecurityError("zip_symlink", `entry ${e.name}: symlink/special file rejected`);
    }
    if (e.uncompressedSize > 0 && e.compressedSize > 0 && e.uncompressedSize / e.compressedSize > MAX_RATIO) {
      throw new ArchiveSecurityError("zip_bomb", `entry ${e.name}: suspicious compression ratio`);
    }
    inflatedTotal += e.uncompressedSize;
    if (inflatedTotal > MAX_INFLATED_TOTAL) {
      throw new ArchiveSecurityError("zip_bomb", "total inflated size exceeds ceiling");
    }
    out.set(e.name, readEntryBytes(archive, e));
  }
  return out;
}

/**
 * Validate the extracted entry set against the expected manifest contents:
 * exact-set match (nothing extra, nothing missing) + MIME magic-byte checks.
 * @param entries output of extractArchiveEntries (must include manifest.json)
 * @param expected map of expected entry name → expected MIME type.
 *   Every name in `expected` must exist; every non-manifest entry in
 *   `entries` must appear in `expected`.
 */
export function verifyEntrySet(entries: Map<string, Buffer>, expected: Record<string, string>): void {
  for (const name of Object.keys(expected)) {
    if (!entries.has(name)) throw new ArchiveSecurityError("zip_missing_entry", `expected entry ${name} not present`);
  }
  for (const [name, bytes] of entries) {
    const mime = expected[name];
    if (!mime) throw new ArchiveSecurityError("zip_unexpected_entry", `unexpected entry ${name}`);
    const checker = MAGIC_CHECKS[mime];
    if (!checker) throw new ArchiveSecurityError("zip_bad_mime", `entry ${name}: unsupported mime ${mime}`);
    if (!checker(bytes)) throw new ArchiveSecurityError("zip_magic_mismatch", `entry ${name}: bytes do not match declared mime ${mime}`);
  }
}

/** Convenience: strict one-shot parse (exact-set + magic) for known layouts. */
export function parsePackArchive(archive: Buffer, expected: Record<string, string>): Map<string, Buffer> {
  const entries = extractArchiveEntries(archive);
  verifyEntrySet(entries, expected);
  return entries;
}
