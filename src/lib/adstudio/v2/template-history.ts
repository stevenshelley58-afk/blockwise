// Immutable local history for repo-versioned template documents. A creative
// pins its template hash, so replacing the current doc must first preserve the
// previous canonical document under that hash.

import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { templateDocV2Schema, type AdTemplateDocV2 } from "./template-doc.ts";
import { hashTemplateDoc } from "./template-hash.ts";

export type TemplateHistorySnapshot = { previousHash: string; path: string; created: boolean } | null;

function readCanonicalTemplate(path: string): AdTemplateDocV2 {
  const parsed = templateDocV2Schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`cannot snapshot invalid template ${path}: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

/**
 * Snapshot template.json before replacing it when its semantic content
 * changes. `linkSync` publishes a fully-written temporary file atomically and
 * fails rather than overwriting an existing snapshot.
 */
export function snapshotTemplateBeforeWrite(templateDir: string, nextDoc: AdTemplateDocV2): TemplateHistorySnapshot {
  const currentPath = join(templateDir, "template.json");
  if (!existsSync(currentPath)) return null;

  const previous = readCanonicalTemplate(currentPath);
  if (previous.id !== nextDoc.id) {
    throw new Error(`cannot replace ${previous.id} with ${nextDoc.id} in one template directory`);
  }
  const previousHash = hashTemplateDoc(previous);
  if (previousHash === hashTemplateDoc(nextDoc)) return null;

  const historyDir = join(templateDir, "history");
  const snapshotPath = join(historyDir, `${previousHash}.json`);
  if (existsSync(snapshotPath)) {
    const snapshot = readCanonicalTemplate(snapshotPath);
    if (hashTemplateDoc(snapshot) !== previousHash) {
      throw new Error(`history snapshot hash mismatch: ${snapshotPath}`);
    }
    return { previousHash, path: snapshotPath, created: false };
  }

  mkdirSync(historyDir, { recursive: true });
  const temporaryPath = join(historyDir, `.${previousHash}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(previous, null, 2)}\n`, { flag: "wx" });
  try {
    try {
      // Hard-link publication is atomic and EEXIST protects an immutable
      // snapshot from a concurrent writer.
      linkSync(temporaryPath, snapshotPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const snapshot = readCanonicalTemplate(snapshotPath);
      if (hashTemplateDoc(snapshot) !== previousHash) {
        throw new Error(`history snapshot hash mismatch: ${snapshotPath}`);
      }
      return { previousHash, path: snapshotPath, created: false };
    }
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return { previousHash, path: snapshotPath, created: true };
}
