// Orchestrates the full offline font-matching pipeline (region detection ->
// target-profile extraction -> Stage A shortlist -> Stage B pixel match)
// across every gallery template and writes the winning typeSpec for each
// successfully-matched region into that template's own JSON file under
// `typography`, keyed by the region's inputs.text[] key.
//
// Per the "no silent caps" build principle: every region that doesn't get a
// typeSpec (no detected box, no usable profile, or Stage B found nothing)
// is logged by name and reason in the run summary, not just dropped from
// the count.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectTemplateRegions } from "./detect-regions.mjs";
import { extractTargetProfile } from "./extract-target-profile.mjs";
import { matchFont } from "./match-font.mjs";

const GALLERY_DIR = path.resolve(process.cwd(), "src/lib/adstudio/template-gallery");
const REPORT_PATH = path.resolve(process.cwd(), ".cache/font-corpus/type-spec-report.json");

async function processTemplate(templateId, raw) {
  const imageSrc = raw?.sample?.imageSrc;
  const textInputs = raw?.inputs?.text ?? [];
  const imagePath = path.resolve(process.cwd(), "public", imageSrc.replace(/^\//, ""));

  const { imageWidth, imageHeight, regions } = await detectTemplateRegions(templateId, imagePath, textInputs);

  const typography = {};
  const skipped = [];
  const matches = [];

  for (const region of regions) {
    if (!region.box) {
      skipped.push({ key: region.key, reason: "no detected box (OCR could not locate this region)" });
      continue;
    }
    const profile = await extractTargetProfile(templateId, region, imagePath, imageWidth, imageHeight);
    if (profile.error || profile.strokeToHeightRatio == null) {
      skipped.push({ key: region.key, reason: `profile extraction failed: ${profile.error ?? "no measurable ink"}` });
      continue;
    }
    const spec = await matchFont(profile, region);
    if (!spec) {
      skipped.push({ key: region.key, reason: "no candidate face rendered successfully" });
      continue;
    }
    const { candidatesEvaluated, key, ...typeSpec } = spec;
    typography[key] = typeSpec;
    matches.push({
      key,
      fontId: typeSpec.fontId,
      weight: typeSpec.weight,
      fitScore: typeSpec.fitScore,
      regionScore: Math.round(region.score * 1000) / 1000,
      regionLowConfidence: Boolean(region.lowConfidence),
    });
  }

  return { typography, skipped, matches, regionCount: regions.length };
}

async function main() {
  const entries = await readdir(GALLERY_DIR, { withFileTypes: true });
  const templateFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();

  const report = {
    generatedAt: new Date().toISOString(),
    templates: [],
    totals: { templates: 0, regions: 0, matched: 0, skipped: 0, fitScoreSum: 0 },
  };

  for (const fileName of templateFiles) {
    const templateId = fileName.replace(/\.json$/, "");
    const filePath = path.join(GALLERY_DIR, fileName);
    const raw = JSON.parse(await readFile(filePath, "utf8"));

    if (!raw?.sample?.imageSrc || !raw?.inputs?.text?.length) {
      console.log(`SKIP ${templateId}: no sample.imageSrc or inputs.text`);
      continue;
    }

    let result;
    try {
      result = await processTemplate(templateId, raw);
    } catch (error) {
      console.log(`ERROR ${templateId}: ${error.stack ?? error.message}`);
      report.templates.push({ templateId, error: error.message });
      continue;
    }

    // Merge into the existing gallery JSON — every other field is untouched.
    const updated = { ...raw, typography: result.typography };
    await writeFile(filePath, `${JSON.stringify(updated, null, 2)}\n`);

    report.totals.templates += 1;
    report.totals.regions += result.regionCount;
    report.totals.matched += result.matches.length;
    report.totals.skipped += result.skipped.length;
    report.totals.fitScoreSum += result.matches.reduce((s, m) => s + m.fitScore, 0);

    report.templates.push({
      templateId,
      regionCount: result.regionCount,
      matched: result.matches.length,
      skipped: result.skipped,
      matches: result.matches,
    });

    const skipNote = result.skipped.length ? `  <-- ${result.skipped.length} skipped: ${result.skipped.map((s) => s.key).join(", ")}` : "";
    console.log(`${templateId}: ${result.matches.length}/${result.regionCount} typeSpecs written${skipNote}`);
  }

  const { templates, regions, matched, skipped, fitScoreSum } = report.totals;
  console.log("\n=== Summary ===");
  console.log(`Templates processed: ${templates}`);
  console.log(`Total regions: ${regions}`);
  console.log(`typeSpecs written: ${matched} (${((matched / regions) * 100).toFixed(1)}%)`);
  console.log(`Skipped: ${skipped} (${((skipped / regions) * 100).toFixed(1)}%)`);
  console.log(`Average fitScore (matched only): ${matched ? (fitScoreSum / matched).toFixed(3) : "n/a"}`);

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
