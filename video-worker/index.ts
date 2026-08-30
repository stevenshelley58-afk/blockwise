import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { claimNextVideoRenderJob, failVideoRenderJob, loadRenderRequest, succeedVideoRenderJob, type RenderProvider, type RenderProviderOutput } from "../src/lib/adstudio/video/render.ts";
import type { VideoRenderJob } from "../src/lib/adstudio/video/repository.ts";
import { renderVideoProject, outputSha256, type RenderRequest, type ResolvedAsset, type VideoAssetRef } from "@blockwise/ad-video-renderer";

const MAX_ATTEMPTS = clampInteger(process.env.ADVIDEO_MAX_ATTEMPTS, 3, 1, 8);
const POLL_MS = clampInteger(process.env.ADVIDEO_POLL_MS, 2_000, 250, 60_000);
const OUTPUT_ROOT = process.env.ADVIDEO_OUTPUT_DIR || join(tmpdir(), "blockwise-video-worker");
const WORKER_NAME = process.env.ADVIDEO_WORKER_NAME || "adstudio-video-renderer";
const ALLOWED_ASSET_HOSTS = new Set((process.env.ADVIDEO_ALLOWED_ASSET_HOSTS || "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
const execFileAsync = promisify(execFile);
let stopping = false;

export type WorkerConfig = { supabase: SupabaseClient; pollMs: number; maxAttempts: number; outputRoot: string; ffmpegPath?: string };

export class SupabaseVideoRenderProvider implements RenderProvider {
  readonly name = "deterministic-canvas-ffmpeg";
  constructor(private readonly supabase: SupabaseClient, private readonly outputRoot: string, private readonly ffmpegPath?: string) {}

  async render(input: RenderRequest): Promise<RenderProviderOutput> {
    input = await this.attestPendingVideoSources(input);
    const outputDir = join(this.outputRoot, input.workspaceId, input.jobId);
    try {
      const result = await renderVideoProject(input, { outputDir, executeFfmpeg: true, ffmpegPath: this.ffmpegPath, assetResolver: (asset) => this.resolveAsset(input.workspaceId, input.projectId, asset) });
      if (!result.mp4Path || !result.sha256) throw new Error("Renderer did not produce an MP4 output.");
      const mp4 = await readFile(result.mp4Path); const poster = await readFile(result.posterPath); const captions = await readFile(result.captionsPath);
      const mp4AssetId = await this.uploadOutput(input, mp4, "video/mp4", "output", result.durationMs, result.width, result.height);
      const posterAssetId = await this.uploadOutput(input, poster, "image/jpeg", "poster", null, result.width, result.height);
      const captionsAssetId = await this.uploadOutput(input, captions, "text/vtt", "captions", null, null, null);
      return { mp4AssetId, posterAssetId, captionsAssetId, providerJobId: input.jobId, providerMetadata: { ...result.providerMetadata, worker: WORKER_NAME, manifestPath: result.manifestPath }, costMetadata: result.costMetadata };
    } finally { await rm(outputDir, { recursive: true, force: true }); }
  }

  /** Browser-finalized source rows are deliberately pending. Only this
   * service-role worker may turn their bytes into a trusted codec attestation. */
  private async attestPendingVideoSources(input: RenderRequest): Promise<RenderRequest> {
    const project = JSON.parse(JSON.stringify(input.project)) as Record<string, unknown>;
    const assets = Array.isArray(project.assets) ? project.assets as Array<Record<string, unknown>> : [];
    const rows = await this.supabase.from("ad_video_assets").select("id,object_path,mime_type,sha256,validation_status").eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).eq("asset_role", "source");
    if (rows.error) throw new Error(`Video source ledger lookup failed: ${rows.error.message}`);
    const byId = new Map((rows.data ?? []).map((row) => [String(row.id), row])); const byPath = new Map((rows.data ?? []).map((row) => [String(row.object_path), row]));
    for (const asset of assets.filter((entry) => entry.kind === "video")) {
      const row = byId.get(String(asset.id)) ?? byPath.get(storagePathFromReference(String(asset.url)) ?? "");
      if (!row) throw new Error(`Video asset ${String(asset.id)} is missing from the workspace source ledger.`);
      const source = await this.resolveAsset(input.workspaceId, input.projectId, asset as unknown as VideoAssetRef);
      if (!source?.bytes && !source?.path) throw new Error(`Video asset ${String(asset.id)} is unavailable.`);
      const sourcePath = source.path ?? join(this.outputRoot, input.workspaceId, input.jobId, `attest-${String(asset.id)}.video`);
      if (source.bytes) { await mkdir(join(this.outputRoot, input.workspaceId, input.jobId), { recursive: true }); await writeFile(sourcePath, source.bytes); }
      const bytes = source.bytes ?? await readFile(sourcePath); const expectedHash = String(row.sha256 ?? "").toLowerCase();
      if (!expectedHash || outputSha256(bytes) !== expectedHash) { await this.rejectSource(row.id, input, "sha256_mismatch"); throw new Error(`Video asset ${String(asset.id)} failed SHA-256 verification.`); }
      if (!videoMagic(bytes, String(row.mime_type ?? "video/mp4"))) { await this.rejectSource(row.id, input, "magic_mismatch"); throw new Error(`Video asset ${String(asset.id)} failed MP4/WebM magic verification.`); }
      const metadata = await probeVideo(sourcePath);
      if (metadata.durationMs <= 0 || metadata.durationMs > 90_000) throw new Error(`Video asset ${String(asset.id)} duration exceeds the 90 second limit.`);
      if (!["h264", "hevc", "vp8", "vp9", "av1", "mpeg4"].includes(metadata.codec)) throw new Error(`Video asset ${String(asset.id)} uses unsupported codec ${metadata.codec}.`);
      const attestation = { worker: WORKER_NAME, codec: metadata.codec, durationMs: metadata.durationMs, width: metadata.width, height: metadata.height };
      const updated = await this.supabase.from("ad_video_assets").update({ validation_status: "validated", validated_at: new Date().toISOString(), duration_ms: metadata.durationMs, width: metadata.width, height: metadata.height, validation_attestation_json: attestation }).eq("id", row.id).eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).eq("asset_role", "source").select("id").single();
      if (updated.error || !updated.data) throw new Error(`Video asset ${String(asset.id)} attestation could not be saved: ${updated.error?.message ?? "not found"}`);
      asset.attestation = { status: "validated", codec: metadata.codec, durationMs: metadata.durationMs };
    }
    return { ...input, project };
  }

  private async rejectSource(assetId: string, input: RenderRequest, reason: string): Promise<void> {
    await this.supabase.from("ad_video_assets").update({ validation_status: "rejected", validation_attestation_json: { worker: WORKER_NAME, reason } }).eq("id", assetId).eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).eq("asset_role", "source");
  }

  private async resolveAsset(workspaceId: string, projectId: string, asset: VideoAssetRef): Promise<ResolvedAsset | null> {
    if (/^https:\/\//u.test(asset.url)) return fetchRemoteAsset(asset);
    const isMediaProxy = asset.url.startsWith("/api/adstudio/media?");
    const raw = isMediaProxy ? new URLSearchParams(asset.url.slice(asset.url.indexOf("?") + 1)).get("path") ?? "" : asset.url.slice("storage://".length);
    const slash = raw.indexOf("/"); const bucket = isMediaProxy ? "workspace-artifacts" : raw.slice(0, slash); const path = isMediaProxy ? raw : raw.slice(slash + 1);
    if (isMediaProxy && !path) throw new Error(`Invalid workspace media reference for asset ${asset.id}.`);
    if (!isMediaProxy && !["adstudio-videos", "workspace-artifacts"].includes(bucket)) throw new Error(`Asset ${asset.id} references an unapproved storage bucket.`);
    if (!path || path.includes("..") || !path.startsWith(`${workspaceId}/`)) throw new Error(`Asset ${asset.id} is outside the workspace storage prefix.`);
    const download = await this.supabase.storage.from(bucket).download(path);
    if (download.error || !download.data) throw new Error(`Asset ${asset.id} could not be downloaded: ${download.error?.message ?? "missing object"}`);
    return { bytes: new Uint8Array(await download.data.arrayBuffer()), mimeType: asset.kind === "video" ? "video/mp4" : "image/*" };
  }

  private async uploadOutput(input: RenderRequest, bytes: Uint8Array, mimeType: string, role: "output" | "poster" | "captions", durationMs: number | null, width: number | null, height: number | null): Promise<string> {
    const hash = outputSha256(bytes); const extension = mimeType === "video/mp4" ? "mp4" : mimeType === "image/jpeg" ? "jpg" : "vtt";
    const path = `${input.workspaceId}/adstudio/videos/${input.projectId}/renders/${hash}.${extension}`;
    const upload = await this.supabase.storage.from("adstudio-videos").upload(path, bytes, { contentType: mimeType, upsert: false });
    if (upload.error && !/already exists|duplicate|conflict/iu.test(upload.error.message)) throw new Error(`Output upload failed (${role}): ${upload.error.message}`);
    const inserted = await this.supabase.from("ad_video_assets").insert({ workspace_id: input.workspaceId, project_id: input.projectId, asset_role: role, object_path: path, sha256: hash, mime_type: mimeType, byte_size: bytes.byteLength, duration_ms: durationMs, width, height, provenance_json: { worker: WORKER_NAME, jobId: input.jobId, renderer: "@blockwise/ad-video-renderer" }, rights_json: { source: "generated" }, consent_json: {}, validation_status: "pending" }).select("id").maybeSingle();
    if (!inserted.error && inserted.data) {
      const attested = await this.supabase.from("ad_video_assets").update({ validation_status: "validated", validated_at: new Date().toISOString(), validation_attestation_json: { worker: WORKER_NAME, codec: mimeType === "video/mp4" ? "h264/aac" : mimeType, durationMs, width, height } }).eq("id", inserted.data.id).eq("workspace_id", input.workspaceId).select("id").single();
      if (attested.error || !attested.data) throw new Error(`Output attestation failed (${role}): ${attested.error?.message ?? "not found"}`);
      return inserted.data.id;
    }
    if (inserted.error && !/duplicate|unique/iu.test(inserted.error.message)) throw new Error(`Output ledger insert failed (${role}): ${inserted.error.message}`);
    const existing = await this.supabase.from("ad_video_assets").select("id").eq("workspace_id", input.workspaceId).eq("object_path", path).single();
    if (existing.error || !existing.data) throw new Error(`Output ledger lookup failed (${role}).`);
    return existing.data.id;
  }
}

async function fetchRemoteAsset(asset: VideoAssetRef): Promise<ResolvedAsset> {
  const url = new URL(asset.url); if (!ALLOWED_ASSET_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal") || !(await isPublicRemoteHost(url.hostname))) throw new Error(`Remote asset ${asset.id} uses a blocked host.`);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" }); if (!response.ok) throw new Error(`Remote asset ${asset.id} returned HTTP ${response.status}.`);
  const length = Number(response.headers.get("content-length") ?? 0); if (length > 25 * 1024 * 1024) throw new Error(`Remote asset ${asset.id} exceeds the 25 MB limit.`);
  const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > 25 * 1024 * 1024) throw new Error(`Remote asset ${asset.id} exceeds the 25 MB limit.`); return { bytes, mimeType: response.headers.get("content-type") ?? undefined };
}

async function probeVideo(path: string): Promise<{ codec: string; durationMs: number; width: number; height: number }> {
  try {
    const { stdout } = await execFileAsync(process.env.ADVIDEO_FFPROBE_PATH || "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,duration:format=duration", "-of", "json", path], { maxBuffer: 128 * 1024 });
    const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_name?: string; width?: number; height?: number; duration?: string }>; format?: { duration?: string } }; const stream = parsed.streams?.[0]; const duration = Number(stream?.duration ?? parsed.format?.duration ?? 0); const width = Number(stream?.width ?? 0); const height = Number(stream?.height ?? 0); const codec = String(stream?.codec_name ?? "");
    if (!codec || !Number.isFinite(duration) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("missing codec metadata"); return { codec, durationMs: Math.round(duration * 1000), width, height };
  } catch (error) { throw new Error(`Video codec attestation failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`); }
}

async function isPublicRemoteHost(hostname: string): Promise<boolean> {
  if (isIP(hostname)) return isPublicAddress(hostname);
  try { const addresses = await lookup(hostname, { all: true, verbatim: true }); return addresses.length > 0 && addresses.every((entry) => isPublicAddress(entry.address)); } catch { return false; }
}
function isPublicAddress(address: string): boolean {
  if (address.includes(":")) { const value = address.toLowerCase(); return !(value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")); }
  const octets = address.split(".").map(Number); if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets; return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
}

export async function processJob(config: WorkerConfig, job: VideoRenderJob, provider: RenderProvider): Promise<void> {
  if (job.attempts > config.maxAttempts) { await failVideoRenderJob(config.supabase, { workspaceId: job.workspaceId, projectId: job.projectId, jobId: job.id, errorCode: "max_attempts_exceeded", errorMessage: `Render exceeded ${config.maxAttempts} attempts.` }); return; }
  try {
    const request = await loadRenderRequest({ supabase: config.supabase, workspaceId: job.workspaceId }, job);
    const output = await provider.render(request);
    await succeedVideoRenderJob(config.supabase, { workspaceId: job.workspaceId, projectId: job.projectId, jobId: job.id, output });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error); const retryable = !/validation|required|consent|rights|attestation|outside the workspace|invalid/iu.test(message) && job.attempts < config.maxAttempts;
    await failVideoRenderJob(config.supabase, { workspaceId: job.workspaceId, projectId: job.projectId, jobId: job.id, errorCode: retryable ? "render_retryable" : "render_failed", errorMessage: message, retryable });
  }
}

export async function runWorker(config: WorkerConfig): Promise<void> {
  const provider = new SupabaseVideoRenderProvider(config.supabase, config.outputRoot, config.ffmpegPath); await mkdir(config.outputRoot, { recursive: true });
  while (!stopping) {
    const workspaces = await config.supabase.from("ad_video_render_jobs").select("workspace_id").eq("status", "queued").order("queued_at", { ascending: true }).limit(50);
    if (workspaces.error) { console.error(JSON.stringify({ level: "error", event: "queue_poll_failed", message: workspaces.error.message })); await delay(config.pollMs); continue; }
    const ids = [...new Set((workspaces.data ?? []).map((row) => row.workspace_id as string))]; let processed = false;
    for (const workspaceId of ids) { const job = await claimNextVideoRenderJob(config.supabase, workspaceId); if (job) { processed = true; console.log(JSON.stringify({ event: "render_claimed", jobId: job.id, workspaceId, attempt: job.attempts })); await processJob(config, job, provider); break; } }
    if (!processed) await delay(config.pollMs);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--health")) { console.log(JSON.stringify({ ok: true, worker: WORKER_NAME, ffmpeg: process.env.ADVIDEO_FFMPEG_PATH || "ffmpeg", maxAttempts: MAX_ATTEMPTS })); return; }
  const url = requiredEnv("SUPABASE_URL"); const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY"); const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  console.log(JSON.stringify({ event: "worker_started", worker: WORKER_NAME, pollMs: POLL_MS, maxAttempts: MAX_ATTEMPTS }));
  await runWorker({ supabase, pollMs: POLL_MS, maxAttempts: MAX_ATTEMPTS, outputRoot: OUTPUT_ROOT, ffmpegPath: process.env.ADVIDEO_FFMPEG_PATH });
}
process.once("SIGTERM", () => { stopping = true; }); process.once("SIGINT", () => { stopping = true; });
if (import.meta.url === `file://${process.argv[1]}`) await main();

function requiredEnv(name: string): string { const value = process.env[name]; if (!value?.trim()) throw new Error(`${name} is required.`); return value; }
function storagePathFromReference(reference: string): string | null {
  if (reference.startsWith("storage://")) { const raw = reference.slice("storage://".length); const slash = raw.indexOf("/"); return slash > 0 ? raw.slice(slash + 1) : null; }
  if (reference.startsWith("/api/adstudio/media?")) return new URLSearchParams(reference.slice(reference.indexOf("?") + 1)).get("path");
  return null;
}
function videoMagic(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "video/webm") return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return bytes.length >= 12 && Buffer.from(bytes).subarray(4, 8).toString("ascii") === "ftyp";
}
function clampInteger(value: string | undefined, fallback: number, min: number, max: number): number { const parsed = Number(value); return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
