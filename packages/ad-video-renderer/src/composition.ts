import type { RenderManifest, Transition, VideoAdProject, VideoScriptPlan } from "./types.js";
import { stableJson, sha256 } from "./validate.js";

const BEAT_NAMES = ["Hook", "Proof", "Value", "CTA"] as const;

export function buildComposition(project: VideoAdProject, plan: VideoScriptPlan, fingerprint: string, transition: Transition = "short_dissolve", fps = 30): RenderManifest {
  const duration = project.durationSeconds / 4;
  const beats = plan.scenes.map((scene, index) => ({ index: index + 1, kind: BEAT_NAMES[index] ?? "Value", startSeconds: Number((index * duration).toFixed(6)), durationSeconds: Number(duration.toFixed(6)), transition: index === 0 ? "hard_cut" as const : transition, assetIds: [...scene.assetIds].sort() }));
  const primaryColour = normalizeColour(project.brandSnapshot?.primaryColour, "#11263d");
  const secondaryColour = normalizeColour(project.brandSnapshot?.secondaryColour, "#d5a24a");
  const manifestBase = { schemaVersion: 1 as const, renderer: "@blockwise/ad-video-renderer" as const, rendererVersion: "1.0.0", composition: { width: 1080 as const, height: 1920 as const, fps, durationSeconds: project.durationSeconds, beats }, fallbackAssets: [], assetIds: project.assets.map((asset) => asset.id).sort(), captions: project.captions, audio: { codec: "aac" as const, ducking: project.assets.some((asset) => asset.kind === "music"), source: project.assets.some((asset) => asset.kind === "music") ? "music" as const : "silent" as const }, brand: { primaryColour, secondaryColour, businessName: project.brandSnapshot?.businessName?.trim() || "Local property team" } };
  return { ...manifestBase, deterministicFingerprint: sha256(stableJson({ ...manifestBase, sourceFingerprint: fingerprint })) };
}

export function makeWebVtt(plan: VideoScriptPlan, durationSeconds: number): string {
  const beatDuration = durationSeconds / 4;
  const lines = ["WEBVTT", ""];
  plan.scenes.forEach((scene, index) => {
    const start = index * beatDuration;
    const end = Math.min(durationSeconds, (index + 1) * beatDuration);
    lines.push(`${formatTime(start)} --> ${formatTime(end)}`, `${scene.narration.trim()}\n${scene.overlay.trim()}`, "");
  });
  return lines.join("\n");
}

function formatTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000); const m = Math.floor((ms % 3_600_000) / 60_000); const s = Math.floor((ms % 60_000) / 1000); const millis = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function normalizeColour(value: string | undefined, fallback: string): string { return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value.trim()) ? value.trim() : fallback; }
