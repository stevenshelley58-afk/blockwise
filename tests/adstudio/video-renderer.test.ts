import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderVideoProject, RenderValidationError, validateRenderRequest } from "../../packages/ad-video-renderer/src/index.ts";
const execFileAsync = promisify(execFile);

const plan = {
  version: 1 as const, durationSeconds: 15 as const,
  hookVariants: [{ id: "hook_a" as const, style: "question" as const, text: "What could your next move look like in Fremantle?" }, { id: "hook_b" as const, style: "proof" as const, text: "A clearer local property conversation starts in Fremantle." }, { id: "hook_c" as const, style: "offer" as const, text: "Get practical property guidance for Fremantle." }], selectedHookId: "hook_a" as const,
  body: "Fremantle homeowners deserve useful local context tailored to their property and timing today. We explain practical options clearly without pressure. This promise gives you a clear local next step.", cta: "Request a local conversation", wordCount: 31, promise: "a clear local next step", source: "deterministic" as const,
  scenes: [{ index: 1, beat: "local hook", narration: "In Fremantle, what is your next property move?", overlay: "Fremantle", assetIds: [] }, { index: 2, beat: "context", narration: "We explain local options clearly without pressure.", overlay: "Practical local guidance", assetIds: [] }, { index: 3, beat: "proof or process", narration: "Grounded advice gives you a clear local next step.", overlay: "Grounded advice", assetIds: [] }, { index: 4, beat: "next step", narration: "Start a practical conversation for your goals.", overlay: "Request a local conversation", assetIds: [] }],
};
const project = { recipeId: "home_value", audience: "sellers", objective: "appraisal", brief: { serviceArea: "Fremantle", offer: "A useful local property conversation" }, productionRoute: "no_camera" as const, hookStyle: "question" as const, brandSnapshot: { businessName: "Harbour Homes", primaryColour: "#102a43", secondaryColour: "#d5a24a" }, assets: [{ id: "logo_1", kind: "logo" as const, url: "storage://adstudio-videos/workspace/logo.png" }], captions: true, durationSeconds: 15 as const };

test("video render manifest and poster are deterministic without external providers", async () => {
  const first = await mkdtemp(join(tmpdir(), "ad-video-test-")); const second = await mkdtemp(join(tmpdir(), "ad-video-test-"));
  try {
    const request = { jobId: "job_fixture", workspaceId: "workspace", projectId: "project", project, plan };
    const a = await renderVideoProject(request, { outputDir: first, executeFfmpeg: false });
    const b = await renderVideoProject(request, { outputDir: second, executeFfmpeg: false });
    assert.equal(a.manifest.deterministicFingerprint, b.manifest.deterministicFingerprint);
    assert.equal(a.manifest.composition.beats.length, 4); assert.equal(a.manifest.composition.width, 1080); assert.equal(a.manifest.composition.height, 1920);
    assert.equal(await readFile(a.captionsPath, "utf8"), await readFile(b.captionsPath, "utf8"));
    assert.match(await readFile(a.captionsPath, "utf8"), /^WEBVTT/m);
  } finally { await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true }); }
});

test("renderer rejects an absent required recipe asset and invalid consent", () => {
  assert.throws(() => validateRenderRequest({ jobId: "j", workspaceId: "w", projectId: "p", project: { ...project, assets: [] }, plan }), RenderValidationError);
  assert.throws(() => validateRenderRequest({ jobId: "j", workspaceId: "w", projectId: "p", project: { ...project, recipeId: "testimonial_case_study", assets: [...project.assets, { id: "quote", kind: "testimonial", url: "storage://adstudio-videos/workspace/quote.jpg" }] }, plan }), /consent/iu);
});

test("workspace media proxy references remain accepted immutable refs", () => {
  const parsed = validateRenderRequest({ jobId: "j", workspaceId: "w", projectId: "p", project: { ...project, assets: [{ ...project.assets[0], url: "/api/adstudio/media?path=w%2Fbrand%2Flogo.png" }] }, plan });
  assert.equal(parsed.project.assets[0]?.url.startsWith("/api/adstudio/media?"), true);
});

test("optional FFmpeg fixture emits an H.264/AAC vertical MP4", { skip: process.env.ADVIDEO_RUN_FFMPEG_FIXTURE !== "1" }, async () => {
  const output = await mkdtemp(join(tmpdir(), "ad-video-ffmpeg-"));
  try {
    const result = await renderVideoProject({ jobId: "ffmpeg_fixture", workspaceId: "workspace", projectId: "project", project, plan }, { outputDir: output, executeFfmpeg: true });
    assert.ok(result.mp4Path); assert.match(result.sha256 ?? "", /^[a-f0-9]{64}$/u);
    const probe = await import("node:child_process");
    await new Promise<void>((resolve, reject) => probe.execFile("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", result.mp4Path!], (error, stdout) => {
      if (error) return reject(error); assert.match(stdout, /"codec_name":\s*"h264"/u); assert.match(stdout, /"width":\s*1080/u); assert.match(stdout, /"height":\s*1920/u); resolve();
    }));
  } finally { await rm(output, { recursive: true, force: true }); }
});

test("optional FFmpeg fixture uses a video beat as moving source media", { skip: process.env.ADVIDEO_RUN_FFMPEG_FIXTURE !== "1" }, async () => {
  const output = await mkdtemp(join(tmpdir(), "ad-video-clip-")); const clip = join(output, "clip.mp4");
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    const clipProject = { ...project, assets: [...project.assets, { id: "clip_1", kind: "video" as const, url: "storage://adstudio-videos/workspace/clip.mp4", attestation: { status: "validated" as const, codec: "h264", durationMs: 1000 } }] };
    const clipPlan = { ...plan, scenes: plan.scenes.map((scene, index) => index === 0 ? { ...scene, assetIds: ["clip_1"] } : scene) as typeof plan.scenes };
    const result = await renderVideoProject({ jobId: "clip_fixture", workspaceId: "workspace", projectId: "project", project: clipProject, plan: clipPlan }, { outputDir: output, executeFfmpeg: true, assetResolver: async (asset) => asset.id === "clip_1" ? { path: clip, mimeType: "video/mp4" } : null });
    assert.ok(result.mp4Path); assert.match(result.sha256 ?? "", /^[a-f0-9]{64}$/u);
  } finally { await rm(output, { recursive: true, force: true }); }
});
