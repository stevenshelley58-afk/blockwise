#!/usr/bin/env node
//
// AdStudio template gate — SEMANTIC diversity, no hard visual rules.
//
// Diversity is measured on the ad-radar classification (what the ad is DOING:
// ad_type / primary_intent / property_or_agent_focus) — the SAME taxonomy the
// research pipeline extracts with AI into research.ad_creatives
// (hermes/tools/research-runtime/bin/ad-classifier.mjs). There is NO fixed-role
// schema and NO hard visual bucket list; those caused the prior homogenization.
//
// Process + doctrine: hermes/skills/adstudio-template-builder/SKILL.md
// Never weaken this gate to make work pass. Strengthen it if it is wrong.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const GAL = process.env.ADSTUDIO_GALLERY_DIR
  ? resolve(process.env.ADSTUDIO_GALLERY_DIR)
  : join(root, "src", "lib", "adstudio", "template-gallery");
const SRC = join(root, "meta_ad_candidates");

// Intent/type labels come from the AI ad-radar classifier. The gate does NOT
// hard-code the taxonomy — it only requires the labels exist and measures their
// spread, so the taxonomy can evolve without ever touching this gate.
const NON_DIVERSE = new Set(["other", "", null, undefined]); // not a distinct "doing"

// Diversity enforcement scales with the set; early building is never blocked.
const DIVERSITY_MIN_COUNT = 12;
const MIN_DISTINCT_INTENTS = 5;
const MAX_INTENT_SHARE = 0.5;

const failures = [];
const fail = (id, msg) => failures.push(`${id}: ${msg}`);

const files = existsSync(GAL) ? readdirSync(GAL).filter((n) => /^meta-.*\.json$/u.test(n)).sort() : [];
const templates = [];
for (const fn of files) {
  try { templates.push({ fn, t: JSON.parse(readFileSync(join(GAL, fn), "utf8")) }); }
  catch (e) { fail(fn, `invalid JSON: ${e.message}`); }
}

const KNOWN_FORMATS = {
  "4:5": { w: 1080, h: 1350, placement: "meta_feed" },
  "9:16": { w: 1080, h: 1920, placement: "meta_fullscreen" },
  "1:1": { w: 1080, h: 1080, placement: "meta_feed" },
};

const seenSource = new Map();
const seenIds = new Set();
const intentCounts = {};

for (const { fn, t } of templates) {
  const id = t.id ?? fn;

  // --- envelope ---
  if (t.id !== fn.replace(/\.json$/u, "")) fail(id, "id must equal file name");
  if (t.templateKey !== t.id) fail(id, "templateKey must equal id");
  if (t.status !== "approved") fail(id, "status must be approved");
  if (t.source !== "builtin") fail(id, "source must be builtin");
  if (seenIds.has(t.id)) fail(id, "duplicate id");
  seenIds.add(t.id);
  const fmt = KNOWN_FORMATS[t.format];
  if (!fmt) fail(id, `unknown format ${t.format}`);
  else {
    if (t.placement !== fmt.placement) fail(id, `placement must be ${fmt.placement}`);
    if (t.dimensions?.width !== fmt.w || t.dimensions?.height !== fmt.h) fail(id, `dimensions must be ${fmt.w}x${fmt.h}`);
    if (t.canvas?.width !== fmt.w || t.canvas?.height !== fmt.h) fail(id, "canvas dimensions must match format");
  }
  if (t.canvas?.fabricJson?.version !== "blockwise-fabric-v1") fail(id, "fabricJson.version must be blockwise-fabric-v1");
  if (!t.gallery?.sampleImageSrc || !t.gallery?.thumbnailSrc) fail(id, "gallery sample/thumbnail required");
  if (t.meta?.platform !== "meta" || t.meta?.objective !== "OUTCOME_LEADS" || t.meta?.specialAdCategory !== "housing") fail(id, "meta must be Meta OUTCOME_LEADS housing");

  // --- provenance: derives from a real, uniquely-used source ad (radar creative id OR candidate file) ---
  const sa = t.sourceAd;
  if (!sa || (!sa.creativeId && !sa.file)) {
    fail(id, "sourceAd is required (radar creativeId or meta_ad_candidates file) — templates derive from a real ad");
  } else {
    const key = sa.creativeId ?? sa.file;
    if (sa.file && !sa.creativeId && !existsSync(join(SRC, sa.file))) fail(id, `sourceAd.file not found: ${sa.file}`);
    if (seenSource.has(key)) fail(id, `sourceAd ${key} already used by ${seenSource.get(key)}`);
    else seenSource.set(key, id);
  }

  // --- semantic classification (from the AI ad-radar classifier; no hard rules here) ---
  const c = t.classification ?? {};
  const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
  if (!nonEmpty(c.ad_type)) fail(id, "classification.ad_type required (from the ad-radar classifier)");
  if (!nonEmpty(c.primary_intent)) fail(id, "classification.primary_intent required (from the ad-radar classifier)");
  if (!nonEmpty(c.property_or_agent_focus)) fail(id, "classification.property_or_agent_focus required (from the ad-radar classifier)");
  const intent = c.primary_intent;
  if (!NON_DIVERSE.has(intent)) intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;

  // --- technical correctness of slots (NOT aesthetics): no fixed roles, just renderability ---
  const objs = Array.isArray(t.canvas?.objects) ? t.canvas.objects : [];
  if (objs.length === 0) fail(id, "canvas.objects is empty");
  const W = t.canvas?.width ?? 0, H = t.canvas?.height ?? 0;
  const objIds = new Set();
  for (const o of objs) {
    if (!o.objectId) { fail(id, "object missing objectId"); continue; }
    if (objIds.has(o.objectId)) fail(id, `duplicate objectId ${o.objectId}`);
    objIds.add(o.objectId);
    if (!o.role) fail(id, `${o.objectId} missing role`);
    const w = o.width ?? 0, h = o.height ?? w;
    if (o.x < 0 || o.y < 0 || o.x + w > W + 1 || o.y + h > H + 1) fail(id, `${o.objectId} out of bounds`);
    if (o.type === "text") {
      for (const bad of ["fontSize", "fontWeight", "textAlign"]) if (bad in o) fail(id, `${o.objectId} uses Fabric-only "${bad}" on canvas.objects (use size/weight/align)`);
      if (typeof o.size !== "number") fail(id, `${o.objectId} text needs numeric "size"`);
      else if (o.size < 18) fail(id, `${o.objectId} text size ${o.size} < 18`);
    }
  }
  // object <-> fabric lockstep by objectId (no required roles)
  const fabIds = new Map();
  for (const fo of (t.canvas?.fabricJson?.objects ?? [])) {
    const m = fo.blockwise; if (m?.objectId) fabIds.set(m.objectId, m.role);
  }
  for (const o of objs) {
    if (!fabIds.has(o.objectId)) fail(id, `${o.objectId} has no fabric mirror`);
    else if (fabIds.get(o.objectId) !== o.role) fail(id, `${o.objectId} role mismatch object/fabric`);
  }
  for (const [oid] of fabIds) if (!objIds.has(oid)) fail(id, `fabric object ${oid} has no canvas object`);
}

// --- diversity by WHAT THE AD DOES (semantic), engaged once the set is judgeable ---
const N = templates.length;
const distinctIntents = Object.keys(intentCounts).length;
if (N >= DIVERSITY_MIN_COUNT) {
  if (distinctIntents < MIN_DISTINCT_INTENTS) {
    fail("DIVERSITY", `only ${distinctIntents} distinct primary_intent(s) across ${N} templates (need >= ${MIN_DISTINCT_INTENTS}); the mix is too narrow`);
  }
  for (const [intent, n] of Object.entries(intentCounts)) {
    if (n > Math.ceil(MAX_INTENT_SHARE * N)) fail("DIVERSITY", `primary_intent "${intent}" dominates the set (${n}/${N} > ${Math.round(MAX_INTENT_SHARE * 100)}%)`);
  }
}

if (failures.length) {
  console.error(`AdStudio template gate FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`AdStudio template gate passed - ${N} template(s).`);
if (N > 0) {
  console.log(`  distinct primary_intent: ${distinctIntents}`);
  console.log(`  intent mix: ${Object.entries(intentCounts).map(([k, v]) => `${k}=${v}`).join("  ") || "(none)"}`);
  if (N < DIVERSITY_MIN_COUNT) console.log(`  (semantic-diversity enforcement engages at ${DIVERSITY_MIN_COUNT} templates)`);
}
