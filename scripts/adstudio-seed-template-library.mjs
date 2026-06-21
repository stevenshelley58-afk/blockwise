#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ADSTUDIO_OFFER_TEMPLATES } from "../src/lib/adstudio/offers.ts";
import {
  deriveTemplateSampleStyle,
  sampleCardImagePath,
  sampleCopyForTemplate,
  sampleVarianceErrors,
  sampleVarianceSummary,
} from "../src/lib/adstudio/template-samples.ts";
import { RESOLVABLE_AD_STUDIO_TEMPLATES } from "../src/lib/adstudio/templates.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SEED_PATH = path.join(ROOT, "ad-template-library", "library-seed.json");
const SCHEMA = "research";
const IMAGE_BRIEFS_TABLE = "ad_template_image_briefs";
const TEMPLATES_TABLE = "ad_template_candidates";
const LIBRARY_VIEW = "v_ad_template_library";
const EXPECTED_IMAGE_BRIEFS = 14;
const EXPECTED_TEMPLATES = 45;
const DEFAULT_SCORER_VERSION = "seed-xlsx-v1";

export async function main(argv = process.argv) {
  const execute = argv.includes("--execute");
  const seedPath = path.resolve(ROOT, argValue(argv, "--seed") ?? DEFAULT_SEED_PATH);
  const seed = await loadSeed(seedPath);
  const validation = validateSeed(seed);
  const imageBriefRows = buildImageBriefRows(seed.imageBriefs);
  const templateRows = buildTemplateRows(seed.templates);
  const summary = {
    mode: execute ? "execute" : "dry-run",
    seedPath,
    imageBriefsPlanned: imageBriefRows.length,
    templatesPlanned: templateRows.length,
    validation,
  };

  if (execute) {
    const supabase = createServiceClient(env());
    await upsertRows(supabase, IMAGE_BRIEFS_TABLE, imageBriefRows, "brief_id");
    await upsertRows(supabase, TEMPLATES_TABLE, templateRows, "template_key");
    summary.database = {
      seededImageBriefs: await countRows(supabase, IMAGE_BRIEFS_TABLE, (query) =>
        query.in("brief_id", imageBriefRows.map((row) => row.brief_id)),
      ),
      seededApprovedTemplates: await countRows(supabase, TEMPLATES_TABLE, (query) =>
        query.in("template_key", templateRows.map((row) => row.template_key)).eq("status", "approved"),
      ),
      imageBriefsTotal: await countRows(supabase, IMAGE_BRIEFS_TABLE),
      approvedTemplatesTotal: await countRows(supabase, TEMPLATES_TABLE, (query) => query.eq("status", "approved")),
      libraryViewRowsTotal: await countRows(supabase, LIBRARY_VIEW),
    };
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!execute) {
    console.log("Dry run only. Re-run with --execute to write template library seed rows.");
  }
}

export async function loadSeed(seedPath = DEFAULT_SEED_PATH) {
  return JSON.parse(await readFile(seedPath, "utf8"));
}

export function validateSeed(seed) {
  const errors = [];
  const imageBriefs = Array.isArray(seed?.imageBriefs) ? seed.imageBriefs : [];
  const templates = Array.isArray(seed?.templates) ? seed.templates : [];
  const briefIds = uniqueValues(imageBriefs.map((brief) => brief.brief_id));
  const templateKeys = uniqueValues(templates.map((template) => template.template_key));
  const offerById = new Map(ADSTUDIO_OFFER_TEMPLATES.map((offer) => [offer.offerId, offer]));
  const knownGoals = new Set(ADSTUDIO_OFFER_TEMPLATES.map((offer) => offer.goal));
  const templateIds = new Set(RESOLVABLE_AD_STUDIO_TEMPLATES.map((template) => template.id));
  const referencedBriefIds = uniqueValues(templates.map((template) => template.image_brief_id).filter(Boolean));
  const offerIds = uniqueValues(templates.map((template) => template.offer_id).filter(Boolean));
  const goals = uniqueValues(templates.map((template) => template.goal).filter(Boolean));
  const adStudioTemplateIds = uniqueValues(templates.map((template) => template.adstudio_template_id).filter(Boolean));

  if (imageBriefs.length !== EXPECTED_IMAGE_BRIEFS) {
    errors.push(`Expected ${EXPECTED_IMAGE_BRIEFS} image briefs, found ${imageBriefs.length}.`);
  }
  if (templates.length !== EXPECTED_TEMPLATES) {
    errors.push(`Expected ${EXPECTED_TEMPLATES} templates, found ${templates.length}.`);
  }
  if (briefIds.length !== imageBriefs.length) {
    errors.push("Image brief IDs must be unique and non-empty.");
  }
  if (templateKeys.length !== templates.length) {
    errors.push("Template keys must be unique and non-empty.");
  }

  for (const brief of imageBriefs) {
    requireFields(errors, `image brief ${brief?.brief_id ?? "<missing>"}`, brief, [
      "brief_id",
      "name",
      "concept",
      "layout",
      "imagery",
      "palette",
      "text_rules",
    ]);
    if (!Array.isArray(brief?.formats) || brief.formats.length === 0) {
      errors.push(`Image brief ${brief?.brief_id ?? "<missing>"} must include formats[].`);
    }
  }

  for (const [index, template] of templates.entries()) {
    requireFields(errors, `template ${template?.template_key ?? "<missing>"}`, template, [
      "template_key",
      "category",
      "hook_style",
      "funnel_stage",
      "goal",
      "offer_id",
      "adstudio_template_id",
      "headline",
      "primary_text",
      "description",
      "cta",
      "image_brief_id",
      "winner_rationale",
    ]);
    for (const field of ["audience", "format", "variables"]) {
      if (!Array.isArray(template?.[field]) || template[field].length === 0) {
        errors.push(`Template ${template?.template_key ?? "<missing>"} must include ${field}[].`);
      }
    }
    if (typeof template?.evidence_score !== "number" || template.evidence_score < 0 || template.evidence_score > 100) {
      errors.push(`Template ${template?.template_key ?? "<missing>"} evidence_score must be a number from 0 to 100.`);
    }
    const sampleStyle = deriveTemplateSampleStyle(template, index);
    const sampleCopy = sampleCopyForTemplate(template, sampleStyle);
    if (!sampleCopy?.headline || !sampleCopy.primaryText || !sampleCopy.description || !sampleCopy.cta) {
      errors.push(`Template ${template?.template_key ?? "<missing>"} must produce sample headline, primary text, description, and CTA.`);
    }
    if (sampleCopy && Object.values(sampleCopy).some((value) => /\{\{[^}]+\}\}/.test(value))) {
      errors.push(`Template ${template?.template_key ?? "<missing>"} sample copy must not contain unresolved variables.`);
    }
    const expectedSamplePath = typeof template?.template_key === "string" ? sampleCardImagePath(template.template_key) : "";
    if (!sampleStyle.sampleCardImagePath || sampleStyle.sampleCardImagePath !== expectedSamplePath) {
      errors.push(`Template ${template?.template_key ?? "<missing>"} must produce a stable sample_card_image_path.`);
    }
    if (template?.goal && !knownGoals.has(template.goal)) {
      errors.push(`Template ${template.template_key} references unknown goal ${template.goal}.`);
    }
  }

  const missingOffers = offerIds.filter((offerId) => !offerById.has(offerId));
  const missingBriefs = referencedBriefIds.filter((briefId) => !briefIds.includes(briefId));
  const missingTemplates = adStudioTemplateIds.filter((templateId) => !templateIds.has(templateId));
  if (missingOffers.length) errors.push(`Unknown offer_id values: ${missingOffers.join(", ")}.`);
  if (missingBriefs.length) errors.push(`Unknown image_brief_id values: ${missingBriefs.join(", ")}.`);
  if (missingTemplates.length) errors.push(`Unknown adstudio_template_id values: ${missingTemplates.join(", ")}.`);
  errors.push(...sampleVarianceErrors(templates));

  if (errors.length) {
    throw new Error(`Template library seed validation failed:\n- ${errors.join("\n- ")}`);
  }

  return {
    imageBriefs: imageBriefs.length,
    templates: templates.length,
    uniqueImageBriefIds: briefIds.length,
    uniqueTemplateKeys: templateKeys.length,
    offerIds,
    goals,
    adStudioTemplateIds,
    offerGoalDifferences: templates
      .filter((template) => {
        const offer = offerById.get(template.offer_id);
        return offer && template.goal !== offer.goal;
      })
      .map((template) => ({
        templateKey: template.template_key,
        goal: template.goal,
        offerId: template.offer_id,
        offerGoal: offerById.get(template.offer_id).goal,
      })),
    scorerVersion: seed?.source?.scorerVersion ?? DEFAULT_SCORER_VERSION,
    sampleVariance: sampleVarianceSummary(templates),
  };
}

export function buildImageBriefRows(imageBriefs) {
  return imageBriefs.map((brief) => pick(brief, [
    "brief_id",
    "name",
    "concept",
    "layout",
    "imagery",
    "palette",
    "text_rules",
    "formats",
    "ai_prompt_seed",
  ]));
}

export function buildTemplateRows(templates) {
  return templates.map((template, index) => {
    const sample_style = deriveTemplateSampleStyle(template, index);
    return {
      ...pick(template, [
        "template_key",
        "category",
        "audience",
        "format",
        "hook_style",
        "funnel_stage",
        "adstudio_template_id",
        "offer_id",
        "goal",
        "headline",
        "primary_text",
        "description",
        "cta",
        "variables",
        "image_brief_id",
        "creative_skeleton",
        "evidence_score",
        "winner_rationale",
        "compliance_note",
      ]),
      sample_card_image_path: sample_style.sampleCardImagePath,
      sample_style,
      status: "approved",
      scorer_version: template.scorer_version ?? DEFAULT_SCORER_VERSION,
    };
  });
}

function env() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Set SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running --execute.");
  }

  return { supabaseUrl, serviceKey };
}

function createServiceClient({ supabaseUrl, serviceKey }) {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function upsertRows(supabase, table, rows, onConflict) {
  const { error } = await supabase.schema(SCHEMA).from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`Could not upsert ${SCHEMA}.${table}: ${error.message}`);
}

async function countRows(supabase, table, applyFilter = (query) => query) {
  const query = applyFilter(supabase.schema(SCHEMA).from(table).select("*", { count: "exact", head: true }));
  const { count, error } = await query;
  if (error) throw new Error(`Could not count ${SCHEMA}.${table}: ${error.message}`);
  return count ?? 0;
}

function requireFields(errors, label, row, fields) {
  for (const field of fields) {
    if (row?.[field] === null || row?.[field] === undefined || row[field] === "") {
      errors.push(`${label} is missing ${field}.`);
    }
  }
}

function pick(source, keys) {
  const row = {};
  for (const key of keys) {
    if (source[key] !== undefined) row[key] = source[key];
  }
  return row;
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function isDirectRun() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
