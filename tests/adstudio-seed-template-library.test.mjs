import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  buildImageBriefRows,
  buildTemplateRows,
  loadSeed,
  validateSeed,
} from "../scripts/adstudio-seed-template-library.mjs";
import { ADSTUDIO_OFFER_TEMPLATES } from "../src/lib/adstudio/offers.ts";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const seedPath = path.join(root, "ad-template-library", "library-seed.json");
const scriptPath = path.join(root, "scripts", "adstudio-seed-template-library.mjs");

test("template library seed matches approved slice counts and AdStudio offer enums", async () => {
  const seed = await loadSeed(seedPath);
  const validation = validateSeed(seed);
  const offerIds = new Set(ADSTUDIO_OFFER_TEMPLATES.map((offer) => offer.offerId));

  assert.equal(validation.imageBriefs, 14);
  assert.equal(validation.templates, 45);
  assert.equal(validation.uniqueImageBriefIds, 14);
  assert.equal(validation.uniqueTemplateKeys, 45);
  assert.equal(validation.offerIds.every((offerId) => offerIds.has(offerId)), true);
});

test("template library seed rows use database column keys for idempotent upsert", async () => {
  const seed = await loadSeed(seedPath);
  validateSeed(seed);
  const imageBriefRows = buildImageBriefRows(seed.imageBriefs);
  const templateRows = buildTemplateRows(seed.templates);

  assert.equal(imageBriefRows.length, 14);
  assert.equal(templateRows.length, 45);
  assert.equal(templateRows.every((row) => row.status === "approved"), true);
  assert.equal(templateRows.every((row) => row.scorer_version === "seed-xlsx-v1"), true);
  assert.equal(templateRows.every((row) => !("id" in row) && !("updated_at" in row)), true);
  assert.equal(imageBriefRows.every((row) => !("updated_at" in row)), true);
});

test("seed script dry-runs without Supabase credentials", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", scriptPath],
    {
      cwd: root,
      env: {
        ...process.env,
        SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        SUPABASE_SERVICE_KEY: "",
        SERVICE_ROLE_KEY: "",
      },
      maxBuffer: 1024 * 1024,
    },
  );

  assert.match(stdout, /"mode": "dry-run"/);
  assert.match(stdout, /"imageBriefsPlanned": 14/);
  assert.match(stdout, /"templatesPlanned": 45/);
  assert.match(stdout, /Dry run only/);
});
