#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import sharp from "sharp";

import { resolveModelProfile } from "../../src/lib/ai/model-registry.ts";
import { createImageProviderForCandidate } from "../../src/lib/adstudio/ai-providers.ts";
import { buildCloneImageRequest } from "../../src/lib/adstudio/reference-clone.ts";
import { createLockedClonePacket, verifyLockedClonePacket } from "./local-template-adapter.mjs";
import {
  assertPacketTransportMatchesCandidate,
  loadVaultImageProviderEnvironment,
  lockedPacketImageRequest,
  resolvePricedImageFinalCandidate,
} from "./vault-template-execution.mjs";

const root = process.cwd();
const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));
loadLocalEnvironment();

if (command === "export") await exportCustomerFixture();
else if (command === "render") await renderLockedPacket();
else if (command === "render-request-vault") await renderVaultLockedPacket();
else usage();

async function exportCustomerFixture() {
  const templatePath = requiredPath("template");
  const samplePath = requiredPath("sample");
  const packetPath = resolve(required("packet"));
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  const sampleRelative = workspacePath(samplePath);
  if (!sampleRelative.startsWith("artifacts/adstudio-template-imports/")) {
    throw new Error("Customer-fixture design reference must come from an imported Frank release package.");
  }
  if (sha256(readFileSync(samplePath)) !== template.sample?.contentHash) {
    throw new Error("Customer-fixture design reference does not match the approved factory sample hash.");
  }

  const assets = {};
  const assetPaths = {};
  for (const pair of arrayArg("asset")) {
    const [key, pathValue] = splitPair(pair, "asset");
    if (!template.inputs.images.some((field) => field.key === key)) throw new Error(`Unknown image input: ${key}`);
    const path = resolve(pathValue);
    if (!existsSync(path)) throw new Error(`Replacement asset not found: ${path}`);
    assetPaths[key] = path;
    assets[key] = await pngDataUrl(path);
  }
  const missingAssets = template.inputs.images.filter((field) => field.required && !assets[field.key]);
  if (missingAssets.length) throw new Error(`Missing --asset values: ${missingAssets.map((field) => field.key).join(", ")}`);

  const copy = {};
  for (const pair of arrayArg("copy")) {
    const [key, value] = splitPair(pair, "copy");
    const field = template.inputs.text.find((item) => item.key === key);
    if (!field) throw new Error(`Unknown text input: ${key}`);
    if (value.length > field.maxLength) throw new Error(`Customer fixture copy for ${key} exceeds maxLength.`);
    copy[key] = value;
  }
  const missingCopy = template.inputs.text.filter((field) => copy[field.key] === undefined || (field.required && !copy[field.key].trim()));
  if (missingCopy.length) throw new Error(`Customer fixtures require complete --copy values: ${missingCopy.map((field) => field.key).join(", ")}`);
  if (canonicalJson(copy) === canonicalJson(Object.fromEntries(template.inputs.text.map((field) => [field.key, field.sample])))) {
    throw new Error("Customer-fixture copy must differ from the approved gallery sample copy.");
  }

  const request = buildCloneImageRequest(template, {
    referenceImage: await pngDataUrl(samplePath),
    images: assets,
    copy,
    seed: Number(args.seed ?? 0),
    reviewCorrection: typeof args.correction === "string" ? args.correction : undefined,
  });
  const expectedOutput = resolve(required("output"));
  const outputRelative = workspacePath(expectedOutput);
  if (!outputRelative.startsWith("artifacts/")) throw new Error("Customer-fixture output must stay under artifacts/.");
  const packet = createLockedClonePacket({
    root,
    stage: "customer_fixture",
    executionTransport: requestedTransport(),
    templateId: template.id,
    request,
    copy,
    referencePaths: [
      { key: "approved_sample", role: "approved_sample", path: samplePath },
      ...template.inputs.images.filter((field) => assetPaths[field.key]).map((field) => ({ key: field.key, role: "replacement_asset", path: assetPaths[field.key] })),
    ],
    expectedOutput,
  });
  mkdirSync(dirname(packetPath), { recursive: true });
  writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, { flag: "wx" });
  console.log(`Locked independent customer-fixture request written to ${workspacePath(packetPath)}.`);
}

async function renderVaultLockedPacket() {
  const selected = resolvePricedImageFinalCandidate(resolveModelProfile("image_final"), candidateIndexArg());
  const providerEnv = await loadVaultImageProviderEnvironment(selected.candidate.provider);
  await renderLockedPacket({ providerEnv, selected });
}

async function renderLockedPacket(options = {}) {
  const template = JSON.parse(readFileSync(requiredPath("template"), "utf8"));
  const packetPath = requiredPath("packet");
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  const verified = verifyLockedClonePacket(packet, { root });
  if (verified.stage !== "customer_fixture" || packet.templateId !== template.id) {
    throw new Error("Only an imported template's customer-fixture packet can be rendered here.");
  }
  const outputPath = resolve(root, packet.expectedOutput);
  if (!workspacePath(outputPath).startsWith("artifacts/")) throw new Error("Customer-fixture output must stay under artifacts/.");
  const rawPath = outputPath.replace(/\.png$/iu, ".raw.png");
  const manifestPath = outputPath.replace(/\.png$/iu, ".manifest.json");
  if (rawPath === outputPath || manifestPath === outputPath || [outputPath, rawPath, manifestPath].some(existsSync)) {
    throw new Error("Customer-fixture render refuses to overwrite an existing output.");
  }
  const referenceAssets = await Promise.all(packet.references.map((reference) => pngDataUrl(resolve(root, reference.path))));
  const request = lockedPacketImageRequest(packet, referenceAssets);
  const selected = options.selected ?? resolvePricedImageFinalCandidate(resolveModelProfile("image_final"), options.candidateIndex ?? candidateIndexArg());
  assertPacketTransportMatchesCandidate(packet.executionTransport, selected.candidate);
  const provider = createImageProviderForCandidate(selected.candidate, options.providerEnv ? { env: options.providerEnv } : {});
  const generated = await provider.generate(request);
  const rawBytes = await assetBytes(generated.assetUrl);
  const normalized = await sharp(rawBytes).resize(template.dimensions.width, template.dimensions.height, { fit: "cover", position: "centre" }).png().toBuffer();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(rawPath, rawBytes, { flag: "wx" });
  writeFileSync(outputPath, normalized, { flag: "wx" });
  writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    templateId: template.id,
    stage: verified.stage,
    requestHash: verified.requestHash,
    outputSha256: sha256(normalized),
    rawOutputSha256: sha256(rawBytes),
    candidateIndex: selected.candidateIndex,
    selectedCandidate: {
      provider: selected.candidate.provider,
      model: selected.candidate.model,
      imageUsdPerUnit: selected.candidate.imageUsdPerUnit,
    },
    model: generated.model,
    providerRequestId: generated.usage?.providerRequestId ?? generated.providerMetadata?.requestId ?? null,
  }, null, 2)}\n`, { flag: "wx" });
  console.log(`Independent customer fixture written to ${workspacePath(outputPath)}.`);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    index += 1;
    if (parsed[key] === undefined) parsed[key] = value;
    else parsed[key] = Array.isArray(parsed[key]) ? [...parsed[key], value] : [parsed[key], value];
  }
  return parsed;
}

function splitPair(pair, kind) {
  const equals = pair.indexOf("=");
  if (equals < 1) throw new Error(`Invalid --${kind} ${pair}; use key=value.`);
  return [pair.slice(0, equals), pair.slice(equals + 1)];
}

function requestedTransport() {
  const value = String(args.transport ?? "production_image_api").trim();
  if (!new Set(["codex_subscription_image_generation", "google_image_api", "production_image_api"]).has(value)) throw new Error("Unsupported --transport.");
  return value;
}

function candidateIndexArg() {
  const value = Number(args["candidate-index"] ?? 0);
  if (!Number.isInteger(value) || value < 0) throw new Error("--candidate-index must be a non-negative integer.");
  return value;
}

function required(key) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing --${key}.`);
  return value;
}

function requiredPath(key) {
  const path = resolve(required(key));
  if (!existsSync(path)) throw new Error(`File not found for --${key}: ${path}`);
  return path;
}

function arrayArg(key) {
  const value = args[key];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function loadLocalEnvironment() {
  for (const file of [resolve(root, ".env.local"), resolve(root, ".env")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/gu, "");
    }
  }
}

async function pngDataUrl(path) {
  const buffer = await sharp(path).png().toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function assetBytes(value) {
  if (value.startsWith("data:")) return Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
  const response = await fetch(value, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Generated asset download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function workspacePath(path) {
  const value = relative(root, resolve(path)).split(sep).join("/");
  if (!value || value === ".." || value.startsWith("../")) throw new Error("Path must stay inside the workspace.");
  return value;
}

function usage() {
  console.error("Usage:");
  console.error("  npm run adstudio:customer-fixture -- export --template artifacts/.../prepared-manifest.json --sample artifacts/.../sample.png --packet artifacts/.../customer.packet.json --output artifacts/.../customer.png --asset key=path --copy key='New copy'");
  console.error("  npm run adstudio:customer-fixture -- render --template artifacts/.../prepared-manifest.json --packet artifacts/.../customer.packet.json");
  process.exit(1);
}
