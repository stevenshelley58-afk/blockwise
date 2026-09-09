import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function workspaceRelative(root, path) {
  const value = relative(root, resolve(path)).split(sep).join("/");
  if (!value || value.startsWith("../") || value === "..") {
    throw new Error(`Customer-fixture path must remain inside the workspace: ${path}`);
  }
  return value;
}

/**
 * Blockwise has one offline render check: an independent customer fixture
 * cloned from a Frank-approved public sample. Frank owns every source-to-sample
 * operation.
 */
export function createLockedClonePacket(input) {
  const executionTransport = input.executionTransport ?? "codex_subscription_image_generation";
  if (!["codex_subscription_image_generation", "google_image_api", "production_image_api"].includes(executionTransport)) {
    throw new Error("Customer-fixture execution transport is invalid.");
  }
  if (input.stage !== undefined && input.stage !== "customer_fixture") {
    throw new Error("Blockwise only exports customer-fixture packets.");
  }
  if (input.referencePaths?.[0]?.role !== "approved_sample") {
    throw new Error("Customer-fixture reference image 1 must be the approved public sample.");
  }
  const references = input.referencePaths.map((entry, index) => {
    const absolute = resolve(entry.path);
    if (!existsSync(absolute)) throw new Error(`Reference ${index + 1} was not found: ${absolute}`);
    return {
      index: index + 1,
      key: entry.key,
      role: entry.role,
      path: workspaceRelative(input.root, absolute),
      contentHash: sha256(readFileSync(absolute)),
    };
  });
  const body = {
    schemaVersion: 1,
    stage: "customer_fixture",
    templateId: input.templateId,
    prompt: input.request.prompt,
    negativePrompt: input.request.negativePrompt ?? "",
    aspectRatio: input.request.aspectRatio,
    seed: input.request.seed ?? 0,
    copy: input.copy,
    references,
    expectedOutput: workspaceRelative(input.root, input.expectedOutput),
    executionTransport,
  };
  return { ...body, requestHash: sha256(canonicalJson(body)) };
}

export function verifyLockedClonePacket(packet, options) {
  if (packet?.schemaVersion !== 1 || packet.stage !== "customer_fixture") {
    throw new Error("Unsupported customer-fixture packet schema.");
  }
  const { requestHash, ...body } = packet;
  const actualRequestHash = sha256(canonicalJson(body));
  if (!/^[a-f0-9]{64}$/u.test(requestHash ?? "") || requestHash !== actualRequestHash) {
    throw new Error("Customer-fixture request changed after export.");
  }
  if (!Array.isArray(packet.references) || packet.references.length === 0) {
    throw new Error("Customer-fixture packet has no references.");
  }
  if (packet.references[0]?.role !== "approved_sample" || packet.references[0]?.index !== 1) {
    throw new Error("Customer-fixture reference image 1 must be the approved public sample.");
  }
  if (!["codex_subscription_image_generation", "google_image_api", "production_image_api"].includes(packet.executionTransport)) {
    throw new Error("Customer-fixture execution transport is invalid.");
  }
  packet.references.forEach((reference, index) => {
    if (reference.index !== index + 1) throw new Error("Customer-fixture reference order changed after export.");
    const absolute = resolve(options.root, reference.path);
    if (!existsSync(absolute)) throw new Error(`Locked reference was not found: ${reference.path}`);
    if (sha256(readFileSync(absolute)) !== reference.contentHash) {
      throw new Error(`Locked reference changed after export: ${reference.path}`);
    }
  });
  return { requestHash: actualRequestHash, stage: "customer_fixture" };
}
