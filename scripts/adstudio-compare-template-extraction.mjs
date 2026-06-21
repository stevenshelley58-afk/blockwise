#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  createAzureOpenAiTextProvider,
  createOpenAiTextProvider,
  createOpenRouterTextProvider,
} from "../src/lib/adstudio/ai-providers.ts";
import { renderDesign } from "../src/lib/adstudio/renderer.ts";
import { templateDesignSchema } from "../src/lib/adstudio/template-design.ts";
import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";
import { parseEnvFile } from "../src/lib/config/env.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE = path.join(ROOT, "meta_ad_candidates", "01_feed_4x5_best", "meta_055.png");
const DEFAULT_SAMPLE_PHOTO = path.join(
  ROOT,
  "public",
  "adstudio-samples",
  "generated-au-properties",
  "au-modern-coastal.png",
);
const FORMAT = "4:5";
const CANVAS = { w: 1080, h: 1350 };

function parseArgs(argv) {
  const args = {
    source: DEFAULT_SOURCE,
    samplePhoto: DEFAULT_SAMPLE_PHOTO,
    outDir: path.join(ROOT, "artifacts", "adstudio-template-extraction-comparison"),
    templateId: "experiment_meta_055",
    cheapProvider: "",
    cheapModel: "",
    frontierProvider: "",
    frontierModel: "",
    fixture: false,
    repairAttempts: 1,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") args.source = path.resolve(argv[++index] ?? "");
    else if (arg === "--sample-photo") args.samplePhoto = path.resolve(argv[++index] ?? "");
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++index] ?? "");
    else if (arg === "--template-id") args.templateId = argv[++index] ?? args.templateId;
    else if (arg === "--cheap-provider") args.cheapProvider = argv[++index] ?? "";
    else if (arg === "--cheap-model") args.cheapModel = argv[++index] ?? "";
    else if (arg === "--frontier-provider") args.frontierProvider = argv[++index] ?? "";
    else if (arg === "--frontier-model") args.frontierModel = argv[++index] ?? "";
    else if (arg === "--repair-attempts") args.repairAttempts = Number(argv[++index] ?? "1");
    else if (arg === "--fixture") args.fixture = true;
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/adstudio-compare-template-extraction.mjs [options]

Options:
  --source PATH              Source ad image. Default: meta_055 candidate.
  --sample-photo PATH        Replacement property photo for rendering.
  --out-dir PATH             Output directory. Default: artifacts/adstudio-template-extraction-comparison.
  --cheap-provider NAME      openai, azure, openrouter, or fixture. Default prefers openrouter, azure, then openai.
  --cheap-model NAME         Default openrouter google/gemini-2.0-flash-001 or openai gpt-4.1-mini.
  --frontier-provider NAME   openai, azure, openrouter, or fixture. Default prefers openai, azure, then openrouter.
  --frontier-model NAME      Default openai gpt-5.5, azure deployment env/name, or openrouter openai/gpt-5.5.
  --fixture                  No API calls; render deterministic fixture designs for both profiles.
`);
}

function loadEnv() {
  const fileEnv = {};
  for (const file of [".env.local", ".env"]) {
    const fullPath = path.join(ROOT, file);
    if (existsSync(fullPath)) Object.assign(fileEnv, parseEnvFile(readFileSync(fullPath, "utf8")));
  }
  return { ...fileEnv, ...process.env };
}

function resolveProfiles(args, env) {
  const cheapProvider = args.fixture
    ? "fixture"
    : args.cheapProvider || (env.OPENROUTER_API_KEY ? "openrouter" : hasAzureOpenAiEnv(env) ? "azure" : "openai");
  const frontierProvider = args.fixture
    ? "fixture"
    : args.frontierProvider || (env.OPENAI_API_KEY ? "openai" : hasAzureOpenAiEnv(env) ? "azure" : "openrouter");

  return [
    {
      id: "cheap",
      label: "cheap / fast",
      providerName: cheapProvider,
      model: args.cheapModel ||
        defaultModelForProvider(cheapProvider, "cheap", env),
    },
    {
      id: "frontier",
      label: "frontier",
      providerName: frontierProvider,
      model: args.frontierModel ||
        defaultModelForProvider(frontierProvider, "frontier", env),
    },
  ];
}

function providerFor(profile, env) {
  if (profile.providerName === "fixture") {
    throw new Error("Fixture provider must be run with --fixture or handled before providerFor().");
  }
  if (profile.providerName === "openrouter") {
    if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");
    return createOpenRouterTextProvider({ env, model: profile.model });
  }
  if (profile.providerName === "azure") {
    if (!env.AZURE_OPENAI_API_KEY) throw new Error("AZURE_OPENAI_API_KEY is not configured.");
    return createAzureOpenAiTextProvider({ env, model: profile.model });
  }
  if (profile.providerName === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
    return createOpenAiTextProvider({ env, model: profile.model });
  }
  throw new Error(`Unsupported provider: ${profile.providerName}`);
}

function defaultModelForProvider(providerName, tier, env) {
  if (providerName === "openrouter") {
    return tier === "cheap" ? "google/gemini-2.0-flash-001" : "openai/gpt-5.5";
  }
  if (providerName === "azure") {
    return (
      env.AZURE_OPENAI_DEPLOYMENT ??
      env.AZURE_OPENAI_CHAT_DEPLOYMENT ??
      env.AZURE_OPENAI_TEXT_DEPLOYMENT ??
      env.BLOCKWISE_AZURE_OPENAI_TEXT_DEPLOYMENT ??
      (tier === "cheap" ? "gpt-4.1-mini" : "gpt-5.5")
    );
  }
  if (providerName === "fixture") {
    return "deterministic-fixture";
  }
  return tier === "cheap" ? "gpt-4.1-mini" : "gpt-5.5";
}

function hasAzureOpenAiEnv(env) {
  return Boolean(
    env.AZURE_OPENAI_API_KEY &&
      (env.AZURE_OPENAI_CHAT_COMPLETIONS_URL ||
        (env.AZURE_OPENAI_ENDPOINT &&
          (env.AZURE_OPENAI_DEPLOYMENT ||
            env.AZURE_OPENAI_CHAT_DEPLOYMENT ||
            env.AZURE_OPENAI_TEXT_DEPLOYMENT ||
            env.BLOCKWISE_AZURE_OPENAI_TEXT_DEPLOYMENT))),
  );
}

async function imageDataUrl(filePath) {
  const bytes = readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function extractionPrompt(input) {
  return {
    system:
      "You are an expert performance-ad layout extraction model. Return only compact JSON. " +
      "Your job is to convert the attached Meta real-estate ad image into an editable Blockwise TemplateDesign, not a final image.",
    user: [
      "Extract a reusable editable ad template from the source image.",
      "Do not include the source image itself, source file names, screenshots, or baked pixels in the output.",
      "The final output must be strict JSON with a single top-level key named design.",
      "The design must validate this contract:",
      "- templateId: string",
      "- version: positive integer",
      '- format: "4:5"',
      "- canvas: { w: 1080, h: 1350 }",
      "- palette: 3-8 CSS hex colors",
      "- fonts: 1-4 font family names",
      "- layers: 6-18 layers in render order",
      "Allowed layer types:",
      '1. shape: { id, type:"shape", rect:{x,y,w,h}, fill, radius?, opacity?, role? }',
      '2. image_slot: { id, type:"image_slot", rect:{x,y,w,h}, role:"primary"|"secondary"|"agent_headshot", fit:"cover"|"contain"|"smart", mask? }',
      '3. logo: { id, type:"logo", rect:{x,y,w,h}, source:"brand_kit" }',
      '4. text: { id, type:"text", rect:{x,y,w,h}, slot:"eyebrow"|"headline"|"subhead"|"body"|"address"|"stat"|"handle"|"phone", align, font, size, lineHeight, weight, color, fill:"ai_copy"|"brand"|"static", text?, maxChars?, case? }',
      '5. cta_button: { id, type:"cta_button", rect:{x,y,w,h}, fill, radius, label:"cta", textColor, font, size }',
      "All rect values are normalized 0..1 and must stay inside the canvas.",
      "Use an image_slot for every reusable photo area. Keep text editable. Use static text only for small labels.",
      "Make it robust when a different Australian property photo is inserted.",
      "Avoid tiny text. Prefer font sizes: eyebrow 22-34, headline 48-78, body 24-34, CTA 22-30.",
      "Ensure the CTA does not overlap headline/body/address regions.",
      "The source ad is attached as the image input.",
      `Use templateId: ${input.templateId}_${input.profileId}.`,
    ].join("\n"),
  };
}

async function extractWithProvider({ provider, profile, sourceDataUrl, templateId, repairAttempts }) {
  let prompt = extractionPrompt({ templateId, profileId: profile.id });
  let lastRaw = "";
  let lastError = "";

  for (let attempt = 0; attempt <= repairAttempts; attempt += 1) {
    const response = await provider.generate({
      system: prompt.system,
      schemaName: "creativeSkeleton",
      imageUrl: sourceDataUrl,
      messages: [{ role: "user", content: prompt.user }],
    });
    lastRaw = response.rawText;

    try {
      const design = parseTemplateDesignResponse(response.json, templateId, profile.id);
      return {
        ok: true,
        design,
        rawText: response.rawText,
        usage: response.usage,
        providerMetadata: response.providerMetadata,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      prompt = {
        system: prompt.system,
        user: [
          "Your prior JSON did not validate. Return corrected JSON only.",
          `Validation error: ${lastError}`,
          "Prior raw output:",
          lastRaw.slice(0, 8000),
        ].join("\n"),
      };
    }
  }

  return {
    ok: false,
    error: lastError || "Model did not return a valid TemplateDesign.",
    rawText: lastRaw,
    usage: {},
    providerMetadata: {},
  };
}

function parseTemplateDesignResponse(json, templateId, profileId) {
  const candidate = json && typeof json === "object" && "design" in json ? json.design : json;
  const parsed = templateDesignSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }

  return templateDesignSchema.parse({
    ...parsed.data,
    templateId: parsed.data.templateId || `${templateId}_${profileId}`,
    format: FORMAT,
    canvas: CANVAS,
  });
}

function fixtureDesign(templateId, profileId) {
  const premium = profileId === "frontier";
  return templateDesignSchema.parse({
    templateId: `${templateId}_${profileId}`,
    version: 1,
    format: FORMAT,
    canvas: CANVAS,
    palette: premium
      ? ["#F6F2EA", "#10202F", "#D8A84E", "#FFFFFF"]
      : ["#8E8778", "#101820", "#E7B24B", "#FFFFFF"],
    fonts: ["Inter, Arial, sans-serif", "Inter, Arial, sans-serif"],
    layers: premium ? premiumFixtureLayers() : cheapFixtureLayers(),
  });
}

function cheapFixtureLayers() {
  return [
    { id: "background", type: "shape", rect: rect(0, 0, 1, 1), fill: "#8E8778", role: "background", locked: true },
    { id: "primary_photo", type: "image_slot", rect: rect(0.06, 0.07, 0.88, 0.48), role: "primary", fit: "smart", mask: "none" },
    { id: "panel", type: "shape", rect: rect(0.08, 0.62, 0.84, 0.27), fill: "#101820", radius: 24, opacity: 0.9, role: "panel" },
    { id: "logo", type: "logo", rect: rect(0.08, 0.04, 0.28, 0.05), source: "brand_kit" },
    textLayer("eyebrow", "eyebrow", rect(0.13, 0.65, 0.7, 0.04), 24, "#E7B24B", "static", "JUST SOLD"),
    textLayer("headline", "headline", rect(0.13, 0.7, 0.7, 0.09), 50, "#FFFFFF", "ai_copy"),
    textLayer("body", "body", rect(0.13, 0.79, 0.55, 0.07), 25, "#DCE7EF", "ai_copy"),
    { id: "cta", type: "cta_button", rect: rect(0.63, 0.82, 0.24, 0.045), fill: "#E7B24B", radius: 999, label: "cta", textColor: "#101820", font: "Inter, Arial, sans-serif", size: 22 },
  ];
}

function premiumFixtureLayers() {
  return [
    { id: "background", type: "shape", rect: rect(0, 0, 1, 1), fill: "#F6F2EA", role: "background", locked: true },
    { id: "primary_photo", type: "image_slot", rect: rect(0.07, 0.09, 0.86, 0.5), role: "primary", fit: "smart", mask: "none" },
    { id: "copy_panel", type: "shape", rect: rect(0.09, 0.66, 0.82, 0.24), fill: "#10202F", radius: 28, opacity: 0.96, role: "panel" },
    { id: "logo", type: "logo", rect: rect(0.08, 0.045, 0.28, 0.04), source: "brand_kit" },
    textLayer("eyebrow", "eyebrow", rect(0.14, 0.69, 0.45, 0.035), 24, "#D8A84E", "static", "LOCAL RESULT"),
    textLayer("headline", "headline", rect(0.14, 0.73, 0.68, 0.08), 54, "#FFFFFF", "ai_copy"),
    textLayer("body", "body", rect(0.14, 0.815, 0.52, 0.055), 25, "#E9EEF3", "ai_copy"),
    { id: "cta", type: "cta_button", rect: rect(0.68, 0.82, 0.18, 0.047), fill: "#D8A84E", radius: 999, label: "cta", textColor: "#10202F", font: "Inter, Arial, sans-serif", size: 22 },
  ];
}

function textLayer(id, slot, layerRect, size, color, fill, text) {
  return {
    id,
    type: "text",
    rect: layerRect,
    slot,
    align: "left",
    font: "Inter, Arial, sans-serif",
    size,
    lineHeight: slot === "headline" ? 1.04 : 1.16,
    weight: slot === "headline" ? 900 : 750,
    color,
    fill,
    ...(text ? { text } : {}),
    ...(slot === "headline" ? { maxChars: 48 } : {}),
  };
}

function rect(x, y, w, h) {
  return { x, y, w, h };
}

function sampleBrandKit() {
  const kit = buildTrialFallbackBrandKit({
    workspaceId: "workspace_template_experiment",
    workspaceName: "Blockwise Realty",
    region: "WA",
  });
  return {
    ...kit,
    contact: {
      ...kit.contact,
      phone: "08 6111 2400",
      email: "hello@blockwise.example",
      socialLinks: ["@blockwiserealty"],
    },
  };
}

function sampleContent(samplePhotoDataUrl) {
  return {
    text: {
      eyebrow: "JUST SOLD",
      headline: "Sold in North Perth",
      subhead: "Use the latest local result to plan your next step.",
      body: "Use the latest local result to plan your next step.",
      cta: "Get local context",
      address: "65 North Perth Road",
      phone: "08 6111 2400",
      handle: "@blockwiserealty",
    },
    images: {
      primary: samplePhotoDataUrl,
      primary_photo: samplePhotoDataUrl,
      secondary: samplePhotoDataUrl,
    },
  };
}

async function renderCandidate({ outDir, profile, design, samplePhotoDataUrl }) {
  const creative = renderDesign(design, sampleContent(samplePhotoDataUrl), sampleBrandKit(), {
    creativeId: `template_extraction:${profile.id}`,
    campaignId: "template_extraction",
    variantId: profile.id,
  });
  const pngPath = path.join(outDir, `${profile.id}.render.png`);
  await sharp(Buffer.from(creative.previewSvg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(pngPath);
  return { creative, pngPath };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function qualityReport(design, creative, samplePhotoDataUrl, sourceDataUrl) {
  const problems = [];
  const objects = creative.canvas.objects;
  const textObjects = objects.filter((object) => object.type === "text");
  const ctaObjects = objects.filter((object) => object.role === "cta_button");
  const imageObjects = objects.filter((object) => object.type === "image");

  const dimensionsOk = creative.canvas.width === CANVAS.w && creative.canvas.height === CANVAS.h;
  if (!dimensionsOk) problems.push(`wrong canvas ${creative.canvas.width}x${creative.canvas.height}`);

  if (!imageObjects.length) problems.push("no image slots rendered");
  if (!imageObjects.some((object) => object.content === samplePhotoDataUrl)) problems.push("replacement sample photo was not bound");

  const serializedDesign = JSON.stringify(design);
  if (serializedDesign.includes(sourceDataUrl.slice(0, 80))) problems.push("design appears to contain source image data");

  for (const text of textObjects) {
    if ((text.size ?? 0) < 18) problems.push(`${text.objectId} text is below 18px`);
    if ((text.x ?? 0) < 0 || (text.y ?? 0) < 0) problems.push(`${text.objectId} text starts outside canvas`);
  }

  for (const cta of ctaObjects) {
    for (const text of textObjects.filter((object) => object.objectId !== `${cta.sourceLayerId}_label`)) {
      if (rectsOverlap(cta, text)) problems.push(`CTA overlaps ${text.objectId}`);
    }
  }

  return {
    dimensionsOk,
    layerCount: design.layers.length,
    imageSlotCount: design.layers.filter((layer) => layer.type === "image_slot").length,
    textLayerCount: design.layers.filter((layer) => layer.type === "text").length,
    ctaCount: design.layers.filter((layer) => layer.type === "cta_button").length,
    problems,
    passed: problems.length === 0,
  };
}

async function makeContactSheet({ outDir, sourcePath, candidates }) {
  const panelW = 360;
  const panelH = 450;
  const labelH = 84;
  const gap = 24;
  const columns = 1 + candidates.length;
  const width = gap + columns * panelW + columns * gap;
  const height = gap + panelH + labelH + gap;
  const composites = [];

  composites.push({
    input: await sharp(sourcePath).resize(panelW, panelH, { fit: "contain", background: "#f3f4f6" }).png().toBuffer(),
    left: gap,
    top: gap,
  });
  composites.push({ input: labelSvg("source", "Original ad image", panelW, labelH), left: gap, top: gap + panelH });

  for (const [index, candidate] of candidates.entries()) {
    const x = gap + (index + 1) * (panelW + gap);
    const input = candidate.pngPath
      ? await sharp(candidate.pngPath).resize(panelW, panelH, { fit: "contain", background: "#f3f4f6" }).png().toBuffer()
      : failureSvg(candidate.profile.id, candidate.error ?? "failed", panelW, panelH);
    composites.push({ input, left: x, top: gap });
    composites.push({
      input: labelSvg(
        candidate.profile.id,
        `${candidate.profile.providerName} / ${candidate.profile.model}${candidate.report?.passed ? " / pass" : " / review"}`,
        panelW,
        labelH,
      ),
      left: x,
      top: gap + panelH,
    });
  }

  const outputPath = path.join(outDir, "comparison.png");
  await sharp({ create: { width, height, channels: 4, background: "#e5e7eb" } })
    .composite(composites)
    .png()
    .toFile(outputPath);
  return outputPath;
}

function labelSvg(title, detail, width, height) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111827"/><text x="16" y="30" font-family="Arial" font-size="22" font-weight="700" fill="#fff">${escapeXml(title)}</text><text x="16" y="60" font-family="Arial" font-size="15" fill="#d1d5db">${escapeXml(detail).slice(0, 80)}</text></svg>`);
}

function failureSvg(title, detail, width, height) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff1f2"/><text x="24" y="54" font-family="Arial" font-size="24" font-weight="700" fill="#9f1239">${escapeXml(title)} failed</text><foreignObject x="24" y="84" width="${width - 48}" height="${height - 108}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial;font-size:16px;color:#4b5563;line-height:1.35">${escapeXml(detail)}</div></foreignObject></svg>`);
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function runProfile({ args, profile, env, sourceDataUrl, samplePhotoDataUrl }) {
  try {
    if (args.fixture || profile.providerName === "fixture") {
      const design = fixtureDesign(args.templateId, profile.id);
      const rendered = await renderCandidate({ outDir: args.outDir, profile, design, samplePhotoDataUrl });
      const report = qualityReport(design, rendered.creative, samplePhotoDataUrl, sourceDataUrl);
      return { profile, ok: true, design, ...rendered, report, rawText: JSON.stringify({ design }, null, 2), usage: {}, providerMetadata: { fixture: true } };
    }

    const provider = providerFor(profile, env);
    const extraction = await extractWithProvider({
      provider,
      profile,
      sourceDataUrl,
      templateId: args.templateId,
      repairAttempts: args.repairAttempts,
    });

    if (!extraction.ok) {
      return { profile, ok: false, error: extraction.error, rawText: extraction.rawText, usage: extraction.usage, providerMetadata: extraction.providerMetadata };
    }

    const rendered = await renderCandidate({ outDir: args.outDir, profile, design: extraction.design, samplePhotoDataUrl });
    const report = qualityReport(extraction.design, rendered.creative, samplePhotoDataUrl, sourceDataUrl);
    return { profile, ok: true, design: extraction.design, ...rendered, report, rawText: extraction.rawText, usage: extraction.usage, providerMetadata: extraction.providerMetadata };
  } catch (error) {
    return {
      profile,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      rawText: "",
      usage: {},
      providerMetadata: {},
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const profiles = resolveProfiles(args, env);

  if (!existsSync(args.source)) throw new Error(`Source image not found: ${args.source}`);
  if (!existsSync(args.samplePhoto)) throw new Error(`Sample photo not found: ${args.samplePhoto}`);

  await mkdir(args.outDir, { recursive: true });
  const sourceDataUrl = await imageDataUrl(args.source);
  const samplePhotoDataUrl = await imageDataUrl(args.samplePhoto);

  const results = [];
  for (const profile of profiles) {
    console.log(`Running ${profile.id}: ${profile.providerName} / ${profile.model}`);
    const result = await runProfile({ args, profile, env, sourceDataUrl, samplePhotoDataUrl });
    results.push(result);
    await writeFile(path.join(args.outDir, `${profile.id}.raw.json`), result.rawText ?? "");
    if (result.design) {
      await writeFile(path.join(args.outDir, `${profile.id}.design.json`), `${JSON.stringify(result.design, null, 2)}\n`);
    }
  }

  const comparisonPath = await makeContactSheet({ outDir: args.outDir, sourcePath: args.source, candidates: results });
  const summary = {
    source: args.source,
    samplePhoto: args.samplePhoto,
    comparisonPath,
    fixture: args.fixture,
    results: results.map((result) => ({
      id: result.profile.id,
      provider: result.profile.providerName,
      model: result.profile.model,
      ok: result.ok,
      error: result.error,
      renderPath: result.pngPath,
      designPath: result.design ? path.join(args.outDir, `${result.profile.id}.design.json`) : undefined,
      report: result.report,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
    })),
  };

  await writeFile(path.join(args.outDir, "report.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(args.outDir, "report.md"), markdownReport(summary));

  console.log(`Wrote comparison: ${comparisonPath}`);
  console.log(`Wrote report: ${path.join(args.outDir, "report.json")}`);
  if (!results.some((result) => result.ok)) {
    process.exitCode = 1;
  }
}

function markdownReport(summary) {
  const lines = [
    "# Ad Studio Template Extraction Comparison",
    "",
    `Source: ${summary.source}`,
    `Sample photo: ${summary.samplePhoto}`,
    `Contact sheet: ${summary.comparisonPath}`,
    "",
  ];
  for (const result of summary.results) {
    lines.push(`## ${result.id}: ${result.provider} / ${result.model}`);
    lines.push(`Status: ${result.ok ? "ok" : "failed"}`);
    if (result.renderPath) lines.push(`Render: ${result.renderPath}`);
    if (result.designPath) lines.push(`Design: ${result.designPath}`);
    if (result.error) lines.push(`Error: ${result.error}`);
    if (result.report) {
      lines.push(`Quality passed: ${result.report.passed}`);
      lines.push(`Layers: ${result.report.layerCount}, image slots: ${result.report.imageSlotCount}, text layers: ${result.report.textLayerCount}, CTAs: ${result.report.ctaCount}`);
      if (result.report.problems.length) lines.push(`Problems: ${result.report.problems.join("; ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
