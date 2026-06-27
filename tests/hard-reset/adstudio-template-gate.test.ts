import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Proves the template gate has teeth: it passes on the installed gallery AND it
// rejects a set that is homogeneous in WHAT THE ADS DO (semantic, ad-radar
// classification), not by any hard visual rule. If this ever needs weakening to
// pass, the gate is being defeated — fix the templates, not the gate.

const GATE = "scripts/verify/adstudio-templates.mjs";

function runGate(extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [GATE], { encoding: "utf8", env: { ...process.env, ...extraEnv } });
}

function listingTemplate(n: number) {
  return {
    id: `meta-feed-${String(n).padStart(3, "0")}`,
    templateKey: `meta-feed-${String(n).padStart(3, "0")}`,
    status: "approved",
    source: "builtin",
    name: "x",
    goal: "seller_leads",
    offerId: `offer-${n}`,
    format: "4:5",
    placement: "meta_feed",
    dimensions: { width: 1080, height: 1350 },
    sourceAd: { creativeId: `radar-${n}` },
    classification: { ad_type: "listing", primary_intent: "listing", property_or_agent_focus: "property" },
    gallery: { sampleImageSrc: "/x.svg", thumbnailSrc: "/x.svg", alt: "a" },
    canvas: {
      width: 1080, height: 1350, backgroundAssetId: null,
      objects: [{ objectId: `bg${n}`, type: "shape", role: "background", x: 0, y: 0, width: 1080, height: 1350, fill: "#fff", locked: true }],
      fabricJson: { version: "blockwise-fabric-v1", width: 1080, height: 1350, objects: [{ type: "rect", blockwise: { objectId: `bg${n}`, role: "background", type: "rect", locked: true, editableKind: "template" } }] },
    },
    meta: { platform: "meta", objective: "OUTCOME_LEADS", specialAdCategory: "housing" },
  };
}

test("template gate passes on the installed gallery", () => {
  const r = runGate();
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});

test("template gate REJECTS a set that is homogeneous in what the ads do", () => {
  const dir = mkdtempSync(join(tmpdir(), "adstudio-gate-"));
  try {
    for (let n = 1; n <= 12; n++) writeFileSync(join(dir, `meta-feed-${String(n).padStart(3, "0")}.json`), JSON.stringify(listingTemplate(n)));
    const r = runGate({ ADSTUDIO_GALLERY_DIR: dir });
    assert.notEqual(r.status, 0, "gate should reject an all-one-intent set");
    assert.match(`${r.stdout}\n${r.stderr}`, /intent|narrow|dominates/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("template gate requires ad-radar classification on each template", () => {
  const dir = mkdtempSync(join(tmpdir(), "adstudio-gate-"));
  try {
    const t = listingTemplate(1) as Record<string, unknown>;
    delete t.classification;
    writeFileSync(join(dir, "meta-feed-001.json"), JSON.stringify(t));
    const r = runGate({ ADSTUDIO_GALLERY_DIR: dir });
    assert.notEqual(r.status, 0);
    assert.match(`${r.stdout}\n${r.stderr}`, /classification/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
