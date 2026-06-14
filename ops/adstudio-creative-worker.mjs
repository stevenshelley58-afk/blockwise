#!/usr/bin/env node
// Blockwise Ad Studio — creative generation worker.
//
// Polls the public.adstudio_creative_jobs queue, generates a finished, on-brand
// ad creative for each job (the chosen template's mined design recipe + the
// agent's photo as a real image input + the campaign copy), uploads it to
// Supabase Storage, and marks the job done. Runs anywhere with Node 18+ and
// outbound HTTPS to Supabase + the image model — no npm install required.
//
// Env required:
//   SUPABASE_URL                  e.g. https://uwwbvdloschaccycjozr.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY     service role key (server-only)
//   OPENROUTER_API_KEY            preferred — uses the photo (gemini image)
//   OPENAI_API_KEY                fallback — gpt-image, text-to-image
// Optional:
//   BLOCKWISE_OPENROUTER_IMAGE_MODEL  default google/gemini-3.1-flash-image-preview
//   BLOCKWISE_OPENAI_IMAGE_MODEL      default gpt-image-1
//   NEXT_PUBLIC_APP_URL               sent as OpenRouter HTTP-Referer
//   WORKER_POLL_MS                    idle poll interval, default 3000

import { randomUUID } from "node:crypto";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENROUTER_API_KEY,
  OPENAI_API_KEY,
  BLOCKWISE_OPENROUTER_IMAGE_MODEL = "google/gemini-3.1-flash-image-preview",
  BLOCKWISE_OPENAI_IMAGE_MODEL = "gpt-image-1",
  NEXT_PUBLIC_APP_URL = "https://app.cuz.fail",
  WORKER_POLL_MS = "3000",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!OPENROUTER_API_KEY && !OPENAI_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY and OPENAI_API_KEY (need at least one)");
  process.exit(1);
}

const REST = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;
const STORAGE = `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1`;
const AUTH = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
const BUCKET = "workspace-artifacts";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

async function claimJob() {
  const list = await fetch(`${REST}/adstudio_creative_jobs?status=eq.queued&order=created_at.asc&limit=1`, { headers: AUTH });
  const rows = await list.json();
  const job = Array.isArray(rows) ? rows[0] : null;
  if (!job) return null;
  // Atomic-ish claim: only succeeds if the row is still queued.
  const upd = await fetch(`${REST}/adstudio_creative_jobs?id=eq.${job.id}&status=eq.queued`, {
    method: "PATCH",
    headers: { ...AUTH, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ status: "running", attempts: (job.attempts ?? 0) + 1, updated_at: new Date().toISOString() }),
  });
  const claimed = await upd.json();
  return Array.isArray(claimed) ? claimed[0] ?? null : null;
}

async function finishJob(id, fields) {
  await fetch(`${REST}/adstudio_creative_jobs?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
}

async function templateSeed(templateKey) {
  if (!templateKey) return "";
  const res = await fetch(
    `${REST}/v_ad_template_library?template_key=eq.${encodeURIComponent(templateKey)}&select=ai_prompt_seed,description&limit=1`,
    { headers: { ...AUTH, "Accept-Profile": "research" } },
  );
  if (!res.ok) return "";
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] ?? {} : {};
  return String(row.ai_prompt_seed || row.description || "").trim();
}

async function downloadPhotoDataUrl(imagePath) {
  if (!imagePath) return null;
  const res = await fetch(`${STORAGE}/object/${BUCKET}/${encPath(imagePath)}`, { headers: AUTH });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "image/jpeg";
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

function buildPrompt(seed, copy, brand) {
  return [
    "Design one polished, professional real-estate social media ad creative for the Australian market that looks like a real, finished Instagram/Facebook ad.",
    `Agency: ${brand.businessName || "the agency"}. Brand colours: primary ${brand.primary || "#123e75"}, accent ${brand.accent || "#e7b24b"}. Modern, trustworthy, premium-but-local with clean sans-serif type.`,
    "Use the supplied property photo as the hero image of the ad. Keep it realistic and Australian; do not invent a different property.",
    seed ? `Creative direction (layout, imagery, mood):\n${seed}` : "",
    "Render this exact on-image copy, correctly spelled and clearly legible:",
    `- Headline: "${copy.headline}"`,
    copy.primaryText ? `- Supporting line: "${copy.primaryText}"` : "",
    copy.cta ? `- Call-to-action button: "${copy.cta}"` : "",
    "Compose like a finished ad: strong focal hierarchy, balanced negative space, a clear call-to-action button. Never add fake, scrambled, duplicated or misspelled text, watermarks, or other brand logos.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function generateWithOpenRouter(prompt, photoDataUrl) {
  const content = [{ type: "text", text: prompt }];
  if (photoDataUrl) content.push({ type: "image_url", image_url: { url: photoDataUrl } });
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": NEXT_PUBLIC_APP_URL,
      "X-Title": "Blockwise",
    },
    body: JSON.stringify({ model: BLOCKWISE_OPENROUTER_IMAGE_MODEL, modalities: ["image", "text"], messages: [{ role: "user", content }] }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `openrouter ${res.status}`);
  const message = json?.choices?.[0]?.message;
  const url = message?.images?.[0]?.image_url?.url ?? message?.images?.[0]?.url;
  if (url) return url;
  if (typeof message?.content === "string") {
    const m = message.content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
    if (m) return m[0];
  }
  throw new Error("openrouter returned no image");
}

async function generateWithOpenAI(prompt, aspectRatio) {
  const size = aspectRatio === "1:1" ? "1024x1024" : aspectRatio === "1.91:1" ? "1536x1024" : "1024x1536";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: BLOCKWISE_OPENAI_IMAGE_MODEL, prompt, size, quality: "high", n: 1 }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `openai ${res.status}`);
  const d = json?.data?.[0];
  if (d?.url) return d.url;
  if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
  throw new Error("openai returned no image");
}

async function uploadResult(workspaceId, imageRef) {
  let bytes;
  let contentType;
  if (imageRef.startsWith("data:")) {
    const m = imageRef.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error("bad data url");
    contentType = m[1];
    bytes = Buffer.from(m[2], "base64");
  } else {
    const res = await fetch(imageRef);
    if (!res.ok) throw new Error(`fetch generated image ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
    contentType = res.headers.get("content-type") || "image/png";
  }
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const path = `${workspaceId}/adstudio/creatives/${randomUUID()}.${ext}`;
  const up = await fetch(`${STORAGE}/object/${BUCKET}/${encPath(path)}`, {
    method: "POST",
    headers: { ...AUTH, "Content-Type": contentType, "x-upsert": "false" },
    body: bytes,
  });
  if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`);
  return path;
}

async function processJob(job) {
  const brand = job.brand && typeof job.brand === "object" ? job.brand : {};
  const seed = await templateSeed(job.template_key);
  const photo = await downloadPhotoDataUrl(job.image_path);
  const prompt = buildPrompt(seed, { headline: job.headline, primaryText: job.primary_text, cta: job.cta }, brand);

  let image = null;
  let model = null;
  let lastErr = null;
  if (OPENROUTER_API_KEY) {
    try {
      image = await generateWithOpenRouter(prompt, photo);
      model = BLOCKWISE_OPENROUTER_IMAGE_MODEL;
    } catch (e) {
      lastErr = e;
      console.error(`[worker] openrouter failed for ${job.id}:`, e.message ?? e);
    }
  }
  if (!image && OPENAI_API_KEY) {
    try {
      image = await generateWithOpenAI(prompt, job.aspect_ratio);
      model = BLOCKWISE_OPENAI_IMAGE_MODEL;
    } catch (e) {
      lastErr = e;
      console.error(`[worker] openai failed for ${job.id}:`, e.message ?? e);
    }
  }
  if (!image) throw new Error(`generation failed: ${lastErr?.message ?? "no provider produced an image"}`);

  const resultPath = await uploadResult(job.workspace_id, image);
  await finishJob(job.id, { status: "done", result_path: resultPath, model, error: null });
  console.log(`[worker] job ${job.id} done via ${model} -> ${resultPath}`);
}

async function main() {
  const idleMs = Number(WORKER_POLL_MS) || 3000;
  console.log(`[worker] started; polling ${REST}/adstudio_creative_jobs every ${idleMs}ms`);
  for (;;) {
    try {
      const job = await claimJob();
      if (!job) {
        await sleep(idleMs);
        continue;
      }
      console.log(`[worker] claimed job ${job.id} (template ${job.template_key ?? "—"})`);
      try {
        await processJob(job);
      } catch (e) {
        await finishJob(job.id, { status: "failed", error: String(e.message ?? e).slice(0, 800) });
        console.error(`[worker] job ${job.id} failed:`, e.message ?? e);
      }
    } catch (loopError) {
      console.error("[worker] loop error:", loopError.message ?? loopError);
      await sleep(5000);
    }
  }
}

main();
