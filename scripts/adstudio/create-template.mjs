#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import sharp from "sharp";

import { resolveModelProfile } from "../../src/lib/ai/model-registry.ts";
import { createTextProviderForCandidate } from "../../src/lib/adstudio/ai-providers.ts";
import { createGoogleImageProvider } from "../../src/lib/adstudio/google-image-provider.ts";
import { validateProviderJsonOutput } from "../../src/lib/adstudio/providers.ts";
import { buildCloneImageRequest } from "../../src/lib/adstudio/reference-clone.ts";
import {
  createLockedClonePacket,
  localAuditEvidence,
  validateLocalQaEvidence,
  verifyLockedClonePacket,
} from "./local-template-adapter.mjs";
import {
  lockedPacketImageRequest,
  loadVaultGoogleProviderEnvironment,
  resolvePricedGoogleImageFinalCandidate,
} from "./vault-template-execution.mjs";

const root = process.cwd();
const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));
loadLocalEnvironment();

if (command === "analyse") await analyseSource();
else if (command === "analyse-local") await analyseLocalSource();
else if (command === "render") await renderSample();
else if (command === "export-local") await exportLocalSample();
else if (command === "export-customer-local") await exportCustomerLocal();
else if (command === "render-locked-google") await renderLockedGooglePacket();
else if (command === "render-request-vault") await renderVaultLockedGooglePacket();
else if (command === "import-local") await importLocalSample();
else usage();

async function analyseSource() {
  const sourcePath = requiredPath("source");
  const id = required("id");
  const outputPath = resolve(args.output ?? join(root, "src", "lib", "adstudio", "template-gallery", `${id}.json`));
  const sourceRelative = relative(join(root, "meta_ad_candidates"), sourcePath).split(sep).join("/");
  if (sourceRelative.startsWith("..")) throw new Error("--source must be inside meta_ad_candidates.");

  const metadata = await sharp(sourcePath).metadata();
  const format = nearestFormat(metadata.width, metadata.height);
  const imageUrl = await pngDataUrl(sourcePath);
  const provider = createTextProviderForCandidate(candidate("openai", process.env.ADSTUDIO_TEMPLATE_VISION_MODEL ?? "gpt-4.1"));
  const response = await provider.generate({
    system: [
      "You analyse a single real-estate ad so a customer can recreate it with their own assets.",
      "Return JSON only. Identify every distinct customer-supplied image needed and every visible text field.",
      "Do not describe layout coordinates, layers, canvas objects, fonts, or a rendering recipe.",
      "Image fields: key, label, required, aspect (landscape|portrait|square), description.",
      "Text fields: key, label, maxLength, sample, required. Preserve visible sample copy exactly.",
      "Also return name, goal, offerId, audienceIntent, category, tags, and classification with ad_type, primary_intent, property_or_agent_focus.",
      "goal must be exactly one of: seller_leads, appraisal_bookings, buyer_leads, market_update_leads, downsizer_leads, investor_leads, open_home_followup, listing_nurture.",
      "The top-level JSON keys must be exactly: name, goal, offerId, audienceIntent, category, tags, inputs, classification.",
      "inputs must be an object with images and text arrays. classification must be an object with ad_type, primary_intent, and property_or_agent_focus.",
    ].join(" "),
    messages: [{ role: "user", content: "Extract the customer input contract from this source ad." }],
    schemaName: "adStudioTemplateAnalysis",
    imageUrl,
  });
  const validated = validateProviderJsonOutput({ rawText: response.rawText, schemaName: "adStudioTemplateAnalysis" });
  if (!validated.ok) throw new Error(`The vision model did not return a valid template analysis: ${validated.error}`);
  writeTemplateContract({ extracted: validated.value, sourcePath, id, outputPath, format });
}

async function analyseLocalSource() {
  const sourcePath = requiredPath("source");
  const analysisPath = requiredPath("analysis");
  const id = required("id");
  const outputPath = resolve(args.output ?? join(root, "src", "lib", "adstudio", "template-gallery", `${id}.json`));
  const metadata = await sharp(sourcePath).metadata();
  const format = nearestFormat(metadata.width, metadata.height);
  const validated = validateProviderJsonOutput({
    rawText: readFileSync(analysisPath, "utf8"),
    schemaName: "adStudioTemplateAnalysis",
  });
  if (!validated.ok) throw new Error(`The local vision analysis is invalid: ${validated.error}`);
  writeTemplateContract({ extracted: validated.value, sourcePath, id, outputPath, format });
}

function writeTemplateContract({ extracted, sourcePath, id, outputPath, format }) {
  const sourceRelative = relative(join(root, "meta_ad_candidates"), sourcePath).split(sep).join("/");
  if (sourceRelative.startsWith("..")) throw new Error("--source must be inside meta_ad_candidates.");

  const template = {
    id,
    name: stringValue(extracted.name, "Untitled ad"),
    goal: stringValue(extracted.goal, "seller_leads"),
    offerId: stringValue(extracted.offerId, id),
    source: "builtin",
    status: "approved",
    format,
    dimensions: format === "4:5" ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 },
    audienceIntent: stringValue(extracted.audienceIntent, "Local property prospects"),
    category: stringValue(extracted.category, "real-estate"),
    tags: stringArray(extracted.tags),
    sample: {
      imageSrc: `/adstudio-samples/meta/${id}-sample.png`,
      thumbnailSrc: `/adstudio-samples/meta/${id}-sample.png`,
      alt: `Generated sample for ${stringValue(extracted.name, id)}.`,
      contentHash: "0".repeat(64),
      generatedBy: "reference_clone",
    },
    inputs: {
      images: normaliseImageInputs(extracted.inputs?.images),
      text: normaliseTextInputs(extracted.inputs?.text),
    },
    sourceAd: { file: sourceRelative, contentHash: sha256(readFileSync(sourcePath)) },
    classification: normaliseClassification(extracted.classification),
    meta: defaultMeta(),
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(template, null, 2)}\n`);
  console.log(`Template input contract written to ${relative(root, outputPath)}.`);
  console.log("Review the extracted fields, then run the render command with one --asset key=path for each required image.");
}

async function exportLocalSample() {
  const executionTransport = requestedTransport();
  const templatePath = requiredPath("template");
  const packetPath = resolve(required("packet"));
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  const sourcePath = resolve(root, "meta_ad_candidates", template.sourceAd.file);
  if (!existsSync(sourcePath)) throw new Error(`Source ad not found: ${sourcePath}`);

  const assets = {};
  const assetPaths = {};
  for (const pair of arrayArg("asset")) {
    const equals = pair.indexOf("=");
    if (equals < 1) throw new Error(`Invalid --asset ${pair}; use key=path.`);
    const key = pair.slice(0, equals);
    const path = resolve(pair.slice(equals + 1));
    if (!existsSync(path)) throw new Error(`Replacement asset not found: ${path}`);
    assetPaths[key] = path;
    assets[key] = await pngDataUrl(path);
  }
  const missing = template.inputs.images.filter((field) => field.required && !assets[field.key]);
  if (missing.length) throw new Error(`Missing --asset values: ${missing.map((field) => field.key).join(", ")}`);
  const copy = Object.fromEntries(template.inputs.text.map((field) => [field.key, field.sample]));
  const request = buildCloneImageRequest(template, {
    referenceImage: await pngDataUrl(sourcePath),
    images: assets,
    copy,
    seed: Number(args.seed ?? 0),
    reviewCorrection: typeof args.correction === "string" ? args.correction : undefined,
  });
  const suppliedFields = template.inputs.images.filter((field) => assetPaths[field.key]);
  const expectedOutput = resolve(args.output ?? join(root, "public", template.sample.imageSrc.replace(/^[/\\]+/u, "")));
  const packet = createLockedClonePacket({
    root,
    stage: "gallery_sample",
    executionTransport,
    templateId: template.id,
    request,
    copy,
    referencePaths: [
      { key: "source_ad", role: "source", path: sourcePath },
      ...suppliedFields.map((field) => ({ key: field.key, role: "replacement_asset", path: assetPaths[field.key] })),
    ],
    expectedOutput,
  });
  mkdirSync(dirname(packetPath), { recursive: true });
  writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
  console.log(`Locked local clone request written to ${relative(root, packetPath)}.`);
}

async function exportCustomerLocal() {
  const executionTransport = requestedTransport();
  const templatePath = requiredPath("template");
  const packetPath = resolve(required("packet"));
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  const approvedSamplePath = resolve(root, "public", template.sample.imageSrc.replace(/^[/\\]+/u, ""));
  if (!existsSync(approvedSamplePath) || sha256(readFileSync(approvedSamplePath)) !== template.sample.contentHash) {
    throw new Error("Customer-fixture generation requires the exact approved public sample from the template manifest.");
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
    if (!template.inputs.text.some((field) => field.key === key)) throw new Error(`Unknown text input: ${key}`);
    copy[key] = value;
  }
  const missingCopy = template.inputs.text.filter((field) => copy[field.key] === undefined || (field.required && !copy[field.key].trim()));
  if (missingCopy.length) throw new Error(`Customer fixtures require complete --copy values: ${missingCopy.map((field) => field.key).join(", ")}`);

  const request = buildCloneImageRequest(template, {
    referenceImage: await pngDataUrl(approvedSamplePath),
    images: assets,
    copy,
    seed: Number(args.seed ?? 0),
    reviewCorrection: typeof args.correction === "string" ? args.correction : undefined,
  });
  const expectedOutput = resolve(required("output"));
  const outputRelative = relative(root, expectedOutput).split(sep).join("/");
  if (!outputRelative.startsWith("artifacts/") || outputRelative.startsWith("../")) {
    throw new Error("Customer-fixture output must stay under artifacts/ and can never overwrite a public sample.");
  }
  const packet = createLockedClonePacket({
    root,
    stage: "customer_fixture",
    executionTransport,
    templateId: template.id,
    request,
    copy,
    referencePaths: [
      { key: "approved_sample", role: "approved_sample", path: approvedSamplePath },
      ...template.inputs.images.filter((field) => assetPaths[field.key]).map((field) => ({ key: field.key, role: "replacement_asset", path: assetPaths[field.key] })),
    ],
    expectedOutput,
  });
  mkdirSync(dirname(packetPath), { recursive: true });
  writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
  console.log(`Locked customer-fixture clone request written to ${relative(root, packetPath)}.`);
}

/**
 * Renders an already-exported packet through the same Google image provider
 * and primary image-final model used by the production clone lane. The packet
 * is authoritative: this command cannot change the references, prompt, copy,
 * output path, or transport after it was locked.
 */
async function renderVaultLockedGooglePacket() {
  const providerEnv = await loadVaultGoogleProviderEnvironment();
  await renderLockedGooglePacket({ providerEnv, candidateIndex: candidateIndexArg() });
}

async function renderLockedGooglePacket(options = {}) {
  const templatePath = requiredPath("template");
  const packetPath = requiredPath("packet");
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  const verified = verifyLockedClonePacket(packet, { root });
  if (packet.templateId !== template.id) throw new Error("Locked clone packet belongs to another template.");
  if (packet.executionTransport !== "google_image_api") {
    throw new Error("render-locked-google requires a packet exported with --transport google_image_api.");
  }

  const outputPath = resolve(root, packet.expectedOutput);
  assertLockedOutputPath({ template, stage: verified.stage, outputPath });
  const rawPath = outputPath.replace(/\.png$/iu, ".raw.png");
  const manifestPath = outputPath.replace(/\.png$/iu, ".manifest.json");
  if (rawPath === outputPath) throw new Error("Locked Google output must be a PNG path.");
  if (manifestPath === outputPath) throw new Error("Locked Google output must have a distinct manifest path.");
  if (existsSync(outputPath) || existsSync(rawPath) || existsSync(manifestPath)) {
    throw new Error("Locked Google render refuses to overwrite an existing output, raw artifact, or manifest.");
  }

  const referenceAssets = await Promise.all(packet.references.map((reference) => (
    pngDataUrl(resolve(root, reference.path))
  )));
  const request = lockedPacketImageRequest(packet, referenceAssets);
  const profile = resolveModelProfile("image_final");
  const selected = resolvePricedGoogleImageFinalCandidate(profile, options.candidateIndex ?? candidateIndexArg());
  const { candidate, candidateIndex } = selected;
  const model = candidate.model;
  const provider = createGoogleImageProvider({
    model,
    pricing: {
      inputUsdPerMillionTokens: candidate.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: candidate.outputUsdPerMillionTokens,
      imageUsdPerUnit: candidate.imageUsdPerUnit,
      currency: "USD",
      inputTokenBasis: "per_million_tokens",
      outputTokenBasis: "per_million_tokens",
      imageBasis: "per_output_image",
      source: "default",
      snapshotId: null,
    },
  }, { model, ...(options.providerEnv ? { env: options.providerEnv } : {}) });
  const generated = await provider.generate(request);
  const rawBytes = await assetBytes(generated.assetUrl);
  const normalized = await sharp(rawBytes)
    .resize(template.dimensions.width, template.dimensions.height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
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
    candidateIndex,
    selectedCandidate: {
      provider: candidate.provider,
      model: candidate.model,
      imageUsdPerUnit: candidate.imageUsdPerUnit,
    },
    model: generated.model,
    providerRequestId: generated.usage?.providerRequestId
      ?? generated.providerMetadata?.requestId
      ?? null,
  }, null, 2)}\n`, { flag: "wx" });
  console.log(`Google image render completed with ${generated.model}.`);
  console.log(`Raw provider artifact written to ${relative(root, rawPath)}.`);
  console.log(`Normalized locked output written to ${relative(root, outputPath)}.`);
  console.log(`Locked output manifest written to ${relative(root, manifestPath)}.`);
}

function assertLockedOutputPath({ template, stage, outputPath }) {
  const workspacePath = relative(root, outputPath).split(sep).join("/");
  if (!workspacePath || workspacePath === ".." || workspacePath.startsWith("../")) {
    throw new Error("Locked output must remain inside the workspace.");
  }
  if (stage === "gallery_sample") {
    const samplePath = resolve(root, "public", template.sample.imageSrc.replace(/^[/\\]+/u, ""));
    if (outputPath !== samplePath) throw new Error("Gallery-sample packet output must be the declared public sample path.");
    return;
  }
  if (stage === "customer_fixture" && workspacePath.startsWith("artifacts/")) return;
  throw new Error("Customer-fixture packet output must stay under artifacts/.");
}

async function importLocalSample() {
  const templatePath = requiredPath("template");
  const packetPath = requiredPath("packet");
  const outputPath = requiredPath("output");
  const qaPath = requiredPath("qa");
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  const qa = JSON.parse(readFileSync(qaPath, "utf8"));
  const verifiedPacket = verifyLockedClonePacket(packet, { root });
  if (verifiedPacket.stage !== "gallery_sample") throw new Error("Only a gallery-sample packet can update the public template sample.");
  if (packet.templateId !== template.id) throw new Error("Local clone packet belongs to another template.");
  const bytes = readFileSync(outputPath);
  const outputHash = sha256(bytes);
  validateLocalQaEvidence({ qa, packet, template, outputHash });

  const metadata = await sharp(outputPath).metadata();
  if (metadata.width !== template.dimensions.width || metadata.height !== template.dimensions.height) {
    throw new Error(`QA output must be exactly ${template.dimensions.width}x${template.dimensions.height}; received ${metadata.width}x${metadata.height}.`);
  }
  const lockedReviewedOutput = resolve(root, packet.expectedOutput);
  if (lockedReviewedOutput !== outputPath) throw new Error("QA output path does not match the locked reviewed candidate.");
  const declaredFinalPath = resolve(root, "public", template.sample.imageSrc.replace(/^[/\\]+/u, ""));
  const finalPath = declaredFinalPath;
  mkdirSync(dirname(finalPath), { recursive: true });
  writeFileSync(finalPath, bytes);
  template.sample.contentHash = sha256(bytes);
  writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`);
  const evidencePath = join(root, "src", "lib", "adstudio", "template-gallery", "evidence", `${template.id}.json`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(localAuditEvidence({
    template,
    packet,
    qa,
    outputHash: template.sample.contentHash,
  }), null, 2)}\n`);
  console.log(`QA-approved local sample imported to ${relative(root, finalPath)}.`);
}

async function renderSample() {
  const templatePath = requiredPath("template");
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  const sourcePath = resolve(root, "meta_ad_candidates", template.sourceAd.file);
  if (!existsSync(sourcePath)) throw new Error(`Source ad not found: ${sourcePath}`);

  const assets = {};
  for (const pair of arrayArg("asset")) {
    const equals = pair.indexOf("=");
    if (equals < 1) throw new Error(`Invalid --asset ${pair}; use key=path.`);
    const key = pair.slice(0, equals);
    assets[key] = await pngDataUrl(resolve(pair.slice(equals + 1)));
  }
  const missing = template.inputs.images.filter((field) => field.required && !assets[field.key]);
  if (missing.length) throw new Error(`Missing --asset values: ${missing.map((field) => field.key).join(", ")}`);

  const request = buildCloneImageRequest(template, {
    referenceImage: await pngDataUrl(sourcePath),
    images: assets,
    copy: Object.fromEntries(template.inputs.text.map((field) => [field.key, field.sample])),
    seed: Number(args.seed ?? 0),
    reviewCorrection: typeof args.correction === "string" ? args.correction : undefined,
  });
  console.log(`Rendering ${template.id} from one source ad and ${Object.keys(assets).length} replacement asset(s)...`);
  const generated = generateImageWithCurl(request);
  console.log(`Image model completed with ${generated.model}.`);
  const outputPath = resolve(args.output ?? join(root, "public", template.sample.imageSrc));
  const bytes = await assetBytes(generated.assetUrl);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
  template.sample.contentHash = sha256(bytes);
  writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`);
  console.log(`Safe gallery sample written to ${relative(root, outputPath)} with the same clone request used for customer ads.`);
}

function generateImageWithCurl(request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const model = process.env.ADSTUDIO_TEMPLATE_IMAGE_MODEL ?? "gpt-image-2";
  const work = mkdtempSync(join(tmpdir(), "adstudio-template-"));
  try {
    const configPath = join(work, "curl.conf");
    const responsePath = join(work, "response.json");
    writeFileSync(configPath, `header = "Authorization: Bearer ${apiKey}"\n`);
    const curlArgs = [
      "--show-error",
      "--fail-with-body",
      "--config",
      configPath,
      "--output",
      responsePath,
      "--form-string",
      `model=${model}`,
      "--form-string",
      `prompt=${request.negativePrompt ? `${request.prompt}\nAvoid: ${request.negativePrompt}.` : request.prompt}`,
      "--form-string",
      `size=${request.aspectRatio === "9:16" ? "1024x1536" : "1024x1280"}`,
      "--form-string",
      `quality=${process.env.BLOCKWISE_OPENAI_IMAGE_QUALITY ?? "high"}`,
      "--form-string",
      "n=1",
    ];
    request.referenceAssets.forEach((asset, index) => {
      const comma = asset.indexOf(",");
      if (!asset.startsWith("data:") || comma < 0) throw new Error("Template rendering expects local data-URL references.");
      const path = join(work, `reference-${index}.png`);
      writeFileSync(path, Buffer.from(asset.slice(comma + 1), "base64"));
      curlArgs.push("--form", `image[]=@${path};type=image/png`);
    });
    curlArgs.push("https://api.openai.com/v1/images/edits");
    const result = spawnSync("curl.exe", curlArgs, { timeout: 600_000, stdio: ["ignore", "inherit", "inherit"] });
    const payload = existsSync(responsePath) ? JSON.parse(readFileSync(responsePath, "utf8")) : {};
    if (result.status !== 0) {
      const detail = result.error?.message ?? result.signal ?? result.status;
      throw new Error(payload.error?.message ?? `Image request failed (${detail}).`);
    }
    const first = payload.data?.[0];
    const assetUrl = first?.url ?? (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : "");
    if (!assetUrl) throw new Error("OpenAI returned no image.");
    return { assetUrl, model };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function candidate(provider, model) {
  return {
    provider,
    model,
    inputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
    imageUsdPerUnit: 0,
    supportsStructuredOutput: true,
    maxContextTokens: 128000,
    maxLatencyMs: 180000,
  };
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    index += 1;
    parsed[key] = key === "asset" || key === "copy" ? [...(parsed[key] ?? []), value] : value;
  }
  return parsed;
}

function splitPair(pair, kind) {
  const equals = pair.indexOf("=");
  if (equals < 1) throw new Error(`Invalid --${kind} ${pair}; use key=value.`);
  return [pair.slice(0, equals), pair.slice(equals + 1)];
}

function requestedTransport() {
  const transport = typeof args.transport === "string" ? args.transport : "codex_subscription_image_generation";
  if (!["codex_subscription_image_generation", "google_image_api"].includes(transport)) {
    throw new Error("--transport must be codex_subscription_image_generation or google_image_api.");
  }
  return transport;
}

function candidateIndexArg() {
  const value = args["candidate-index"];
  if (value === undefined) return 0;
  if (Array.isArray(value) || !/^\d+$/u.test(value)) {
    throw new Error("--candidate-index must be a non-negative integer.");
  }
  const candidateIndex = Number(value);
  if (!Number.isSafeInteger(candidateIndex)) {
    throw new Error("--candidate-index must be a non-negative integer.");
  }
  return candidateIndex;
}

function required(key) {
  const value = args[key];
  if (!value || Array.isArray(value)) throw new Error(`--${key} is required.`);
  return value;
}

function requiredPath(key) {
  const path = resolve(required(key));
  if (!existsSync(path)) throw new Error(`--${key} was not found: ${path}`);
  return path;
}

function arrayArg(key) {
  const value = args[key];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function loadLocalEnvironment() {
  for (const path of [join(root, ".env.local"), join(root, ".env")]) {
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

async function pngDataUrl(path) {
  const bytes = await sharp(path).png().toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function assetBytes(value) {
  if (value.startsWith("data:")) return Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
  const response = await fetch(value);
  if (!response.ok) throw new Error(`Generated image could not be downloaded (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function nearestFormat(width = 4, height = 5) {
  const ratio = width / height;
  return Math.abs(ratio - 4 / 5) <= Math.abs(ratio - 9 / 16) ? "4:5" : "9:16";
}

function stringValue(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function normaliseImageInputs(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Vision analysis returned no image inputs.");
  return value.map((field, index) => ({
    key: stringValue(field.key, `image_${index + 1}`).replace(/[^a-z0-9_]/giu, "_").toLowerCase(),
    label: stringValue(field.label, `Image ${index + 1}`),
    required: field.required !== false,
    aspect: ["landscape", "portrait", "square"].includes(field.aspect) ? field.aspect : "landscape",
    description: stringValue(field.description, `customer image ${index + 1}`),
  }));
}

function normaliseTextInputs(value) {
  if (!Array.isArray(value)) return [];
  return value.map((field, index) => ({
    key: stringValue(field.key, `text_${index + 1}`).replace(/[^a-z0-9_]/giu, "_").toLowerCase(),
    label: stringValue(field.label, `Text ${index + 1}`),
    maxLength: Math.max(1, Math.min(240, Number(field.maxLength) || String(field.sample ?? "").length * 2 || 40)),
    sample: stringValue(field.sample, "Sample text"),
    required: field.required !== false,
  }));
}

function normaliseClassification(value = {}) {
  return {
    ad_type: stringValue(value.ad_type, "real_estate"),
    primary_intent: stringValue(value.primary_intent, "listing"),
    property_or_agent_focus: stringValue(value.property_or_agent_focus, "property"),
  };
}

function defaultMeta() {
  return {
    platform: "meta",
    objective: "OUTCOME_LEADS",
    specialAdCategory: "housing",
    publisherPlatforms: ["facebook", "instagram"],
    facebookPositions: ["feed"],
    instagramPositions: ["stream"],
    primaryText: ["Ask for the property details."],
    headlines: ["Property details"],
    descriptions: ["Request more information"],
    cta: "LEARN_MORE",
    leadForm: {
      headline: "Request the property details",
      questions: ["What is your best contact number?"],
      privacyPolicyUrl: null,
      thankYouScreen: { title: "Request received", body: "The agency will be in touch shortly." },
    },
  };
}

function usage() {
  console.error("Usage:");
  console.error("  node scripts/adstudio/create-template.mjs analyse --source meta_ad_candidates/... --id meta-feed-001");
  console.error("  node scripts/adstudio/create-template.mjs analyse-local --source meta_ad_candidates/... --analysis analysis.json --id meta-feed-001");
  console.error("  node scripts/adstudio/create-template.mjs render --template src/lib/adstudio/template-gallery/meta-feed-001.json --asset photo=path --asset logo=path [--correction review-feedback]");
  console.error("  node scripts/adstudio/create-template.mjs export-local --template template.json --packet packet.json --asset photo=path [--correction review-feedback]");
  console.error("  node scripts/adstudio/create-template.mjs export-customer-local --template template.json --packet packet.json --output artifacts/.../candidate.png --asset photo=path --copy headline='Exact copy' [--correction review-feedback]");
  console.error("  node scripts/adstudio/create-template.mjs render-locked-google --template template.json --packet packet.json");
  console.error("  BLOCKWISE_TEMPLATE_EXECUTION_CONTEXT=vps node scripts/adstudio/create-template.mjs render-request-vault --template template.json --packet packet.json [--candidate-index 0]");
  console.error("  node scripts/adstudio/create-template.mjs import-local --template template.json --packet packet.json --output generated.png --qa qa.json");
  process.exit(1);
}
