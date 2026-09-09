import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { buildComposition, makeWebVtt } from "./composition.js";
import { renderBeatFrame, renderBeatOverlay } from "./frame.js";
import type { RenderOptions, RenderRequest, RenderResult, ResolvedAsset, VideoAssetRef } from "./types.js";
import { validateRenderRequest } from "./validate.js";

const execFileAsync = promisify(execFile);
const DEFAULT_FPS = 30;

export async function renderVideoProject(request: RenderRequest, options: RenderOptions): Promise<RenderResult> {
  const { project, plan, fingerprint } = validateRenderRequest(request);
  const fps = options.fps ?? DEFAULT_FPS;
  const manifest = buildComposition(project, plan, fingerprint, options.transition ?? "short_dissolve", fps);
  const workDir = join(options.outputDir, `.render-${safeSegment(request.jobId)}`);
  await mkdir(workDir, { recursive: true });
  try {
    const resolved = new Map<string, ResolvedAsset>(); const sourceAssets = new Map<string, ResolvedAsset>(); const fallbackAssets: string[] = [];
    for (const asset of project.assets) {
      const result = options.assetResolver ? await options.assetResolver(asset) : null;
      if (result) { sourceAssets.set(asset.id, result); resolved.set(asset.id, asset.kind === "video" ? await extractVideoPoster(result, workDir, asset.id, options.ffmpegPath ?? "ffmpeg", Boolean(options.executeFfmpeg)) : result); }
      else if (asset.kind !== "logo" && asset.kind !== "music") fallbackAssets.push(asset.id);
    }
    manifest.fallbackAssets.push(...fallbackAssets.sort());
    // A source asset listed in a beat is required to be available; optional
    // unlisted media falls back to kinetic brand text by design.
    const used = new Set(plan.scenes.flatMap((scene) => scene.assetIds));
    const missingUsed = project.assets.filter((asset) => used.has(asset.id) && !resolved.has(asset.id) && asset.kind !== "logo");
    if (missingUsed.some((asset) => ["video", "testimonial", "proof"].includes(asset.kind))) throw new Error(`Required render asset unavailable: ${missingUsed.map((asset) => asset.id).join(", ")}`);
    const framePaths: string[] = []; const overlayPaths: string[] = [];
    for (const scene of plan.scenes) { const frame = await renderBeatFrame(project, scene, resolved); const path = join(workDir, `beat-${scene.index}.png`); await writeFile(path, frame); framePaths.push(path); const overlayPath = join(workDir, `overlay-${scene.index}.png`); await writeFile(overlayPath, renderBeatOverlay(project, scene)); overlayPaths.push(overlayPath); }
    const posterPath = join(options.outputDir, `${safeSegment(request.jobId)}.poster.jpg`);
    await writePoster(framePaths[0]!, posterPath);
    const captionsPath = join(options.outputDir, `${safeSegment(request.jobId)}.vtt`);
    await writeFile(captionsPath, makeWebVtt(plan, project.durationSeconds), "utf8");
    const manifestPath = join(options.outputDir, `${safeSegment(request.jobId)}.manifest.json`);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    let mp4Path: string | null = null; let sha256: string | null = null;
    if (options.executeFfmpeg) {
      mp4Path = join(options.outputDir, `${safeSegment(request.jobId)}.mp4`);
      const musicAsset = project.assets.find((asset) => asset.kind === "music");
      const musicResolved = musicAsset ? resolved.get(musicAsset.id) : undefined;
      const musicPath = musicResolved?.path ?? (musicResolved?.bytes ? await materialize(musicResolved.bytes, join(workDir, "music.bin")) : undefined);
      const clipPaths = new Map<number, string>();
      for (const scene of plan.scenes) {
        const clip = project.assets.find((asset) => scene.assetIds.includes(asset.id) && asset.kind === "video"); const source = clip ? sourceAssets.get(clip.id) : undefined;
        if (clip && source) clipPaths.set(scene.index - 1, source.path ?? await materialize(source.bytes!, join(workDir, `clip-${safeSegment(clip.id)}.video`)));
      }
      await encodeMp4(framePaths, overlayPaths, project.durationSeconds, fps, manifest.composition.beats.map((beat) => beat.transition), mp4Path, options.ffmpegPath ?? "ffmpeg", musicPath, clipPaths);
      const bytes = await (await import("node:fs/promises")).readFile(mp4Path); sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    return { manifest, manifestPath, mp4Path, posterPath, captionsPath, sha256, durationMs: project.durationSeconds * 1000, width: 1080, height: 1920, fps, providerMetadata: { renderer: "deterministic-canvas-ffmpeg", rendererVersion: "1.0.0", deterministicFingerprint: manifest.deterministicFingerprint, fallbackAssets: fallbackAssets.sort(), transition: options.transition ?? "short_dissolve", clips: [...new Set(plan.scenes.flatMap((scene) => scene.assetIds).filter((id) => project.assets.find((asset) => asset.id === id)?.kind === "video"))] }, costMetadata: { currency: "USD", amount: 0, basis: "self-hosted-render-worker" } };
  } finally { await rm(workDir, { recursive: true, force: true }); }
}

async function writePoster(framePath: string, outputPath: string): Promise<void> {
  const image = await loadImage(framePath); const canvas = createCanvas(1080, 1920); const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, 1080, 1920);
  await writeFile(outputPath, canvas.toBuffer("image/jpeg"));
}

async function encodeMp4(frames: string[], overlays: string[], duration: number, fps: number, transitions: string[], output: string, ffmpeg: string, musicPath?: string, clipPaths = new Map<number, string>()): Promise<void> {
  const args: string[] = ["-hide_banner", "-loglevel", "error", "-y"];
  const segment = duration / frames.length; const overlap = 0.25;
  for (let i = 0; i < frames.length; i++) {
    const clip = clipPaths.get(i);
    const inputDuration = i === frames.length - 1 ? segment : segment + overlap;
    if (clip) args.push("-stream_loop", "-1", "-t", String(inputDuration), "-i", clip);
    else args.push("-loop", "1", "-framerate", String(fps), "-t", String(inputDuration), "-i", frames[i]!);
  }
  for (const overlay of overlays) args.push("-loop", "1", "-framerate", String(fps), "-t", String(segment + overlap), "-i", overlay);
  args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"); const musicIndex = frames.length + overlays.length + 1;
  if (musicPath) args.push("-stream_loop", "-1", "-i", musicPath);
  const clipAudio = new Map<number, boolean>(); for (const [index, path] of clipPaths) clipAudio.set(index, await sourceHasAudio(path, ffmpeg));
  const filters: string[] = [];
  for (let i = 0; i < frames.length; i++) filters.push(`[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=${fps},setsar=1,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  const transition = transitions.find((item) => item !== "hard_cut") ?? "hard_cut";
  for (let i = 0; i < frames.length; i++) {
    if (clipPaths.has(i)) { const overlayInput = frames.length + i; filters.push(`[v${i}][${overlayInput}:v]overlay=0:0:shortest=1[vo${i}]`); }
    else filters.push(`[v${i}]null[vo${i}]`);
  }
  let videoLabel = "vout";
  if (transition === "hard_cut") filters.push(`${frames.map((_, i) => `[vo${i}]`).join("")}concat=n=${frames.length}:v=1:a=0[vout]`);
  else {
    const xfade = transition === "brand_wipe" ? "wipeleft" : transition === "smart_push" ? "smoothleft" : "fade"; let current = "vo0";
    for (let i = 1; i < frames.length; i++) { const out = `vx${i}`; const offset = i * segment; filters.push(`[${current}][vo${i}]xfade=transition=${xfade}:duration=${overlap}:offset=${offset.toFixed(3)}[${out}]`); current = out; }
    videoLabel = current;
  }
  const silenceIndex = frames.length + overlays.length; filters.push(`[${silenceIndex}:a]atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,asplit=${frames.length}${frames.map((_, i) => `[asilence${i}]`).join("")}`);
  for (let i = 0; i < frames.length; i++) {
    if (clipPaths.has(i) && clipAudio.get(i)) filters.push(`[${i}:a]aresample=48000,apad,atrim=duration=${segment.toFixed(3)},asetpts=PTS-STARTPTS[aseg${i}]`);
    else filters.push(`[asilence${i}]atrim=start=${(i * segment).toFixed(3)}:duration=${segment.toFixed(3)},asetpts=PTS-STARTPTS[aseg${i}]`);
  }
  filters.push(`${frames.map((_, i) => `[aseg${i}]`).join("")}concat=n=${frames.length}:v=0:a=1[abase]`);
  if (musicPath) filters.push(`[${musicIndex}:a]aresample=48000,volume=0.18,apad,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS[amusic];[abase][amusic]amix=inputs=2:duration=first:weights=1 0.18[aout]`); else filters.push("[abase]anull[aout]");
  args.push("-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", "[aout]", "-t", String(duration), "-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-metadata", "creation_time=1970-01-01T00:00:00Z", output);
  try { await execFileAsync(ffmpeg, args, { maxBuffer: 2 * 1024 * 1024 }); } catch (error) { const detail = error as { message?: string; stderr?: string }; const message = detail.stderr || detail.message || String(error); throw new Error(`FFmpeg render failed: ${message.slice(0, 2000)}`); }
}

function safeSegment(value: string): string { return value.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 120) || "render"; }

export function outputSha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

async function extractVideoPoster(asset: ResolvedAsset, workDir: string, id: string, ffmpeg: string, enabled: boolean): Promise<ResolvedAsset> {
  if (!enabled || (!asset.bytes && !asset.path)) return asset;
  const source = asset.path ?? await materialize(asset.bytes!, join(workDir, `source-${safeSegment(id)}.video`));
  const output = join(workDir, `source-${safeSegment(id)}.png`);
  try { await execFileAsync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-frames:v", "1", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", output]); return { path: output, mimeType: "image/png" }; }
  catch (error) { throw new Error(`Video asset ${id} could not be decoded: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`); }
}

async function materialize(bytes: Uint8Array, path: string): Promise<string> { await writeFile(path, bytes); return path; }

async function sourceHasAudio(path: string, ffmpeg: string): Promise<boolean> {
  const ffprobe = ffmpeg.toLowerCase().endsWith("ffmpeg.exe") ? `${ffmpeg.slice(0, -10)}ffprobe.exe` : ffmpeg.replace(/ffmpeg$/iu, "ffprobe");
  try { const { stdout } = await execFileAsync(ffprobe, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", path], { maxBuffer: 64 * 1024 }); return Boolean(stdout.trim()); } catch { return false; }
}
