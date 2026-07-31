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

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectTemplateRegions } from "./detect-regions.mjs";
import { extractTargetProfile } from "./extract-target-profile.mjs";
import { matchFont } from "./match-font.mjs";
import { parseArgs, selectTemplateFiles } from "./type-specs-args.mjs";

const GALLERY_DIR = path.resolve(process.cwd(), "src/lib/adstudio/template-gallery");
const REPORT_PATH = path.resolve(process.cwd(), ".cache/font-corpus/type-spec-report.json");

export function measuredLineSizeRatio(fullBoxSizeRatio, lineCount) {
  return fullBoxSizeRatio * Math.max(1, lineCount ?? 1);
}

async function processTemplate(templateId, raw, { regionsOnly }) {
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
    const regionMetadata = {
      sampleBox: region.box,
      sampleLineCount: Math.max(1, region.lineCount ?? 1),
      detectionScore: Math.round(region.score * 1000) / 1000,
      measurementSource: "ocr-v2",
      measuredLines: (region.lineBoxes ?? []).map((sampleBox, index) => ({
        text: region.lineTexts?.[index] ?? "",
        sampleBox,
        sizeRatio: 0,
        scaleX: 1,
      })),
    };
    if (regionsOnly) {
      const existing = raw.typography?.[region.key];
      if (!existing) {
        skipped.push({ key: region.key, reason: "no existing typeSpec to attach region metadata to" });
        continue;
      }
      typography[region.key] = { ...existing, ...regionMetadata };
      matches.push({
        key: region.key,
        fontId: existing.fontId,
        weight: existing.weight,
        fitScore: existing.fitScore,
        regionScore: regionMetadata.detectionScore,
        regionLowConfidence: Boolean(region.lowConfidence),
      });
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
    const measuredLines = regionMetadata.measuredLines.map((line) => ({
      ...line,
      // Each OCR line box already captures that line's own cap height. Use
      // the face's font-size-to-glyph-height ratio for every line; multiplying
      // the full-block ratio back by lineCount restores that glyph ratio.
      // Scaling by unionBox/lineBox instead would make every line the same
      // absolute font size and lose the sample's intentional hierarchy.
      sizeRatio: measuredLineSizeRatio(typeSpec.sizeRatio, region.lineCount),
      scaleX: line.scaleX ?? 1,
    }));
    typography[key] = { ...typeSpec, ...regionMetadata, measuredLines };
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
  const { help, regionsOnly, templateIds } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log("Usage: node scripts/build/font-corpus/adstudio-type-specs.mjs [--regions-only] [--template <id[,id...]>]");
    return;
  }
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  const entries = await readdir(GALLERY_DIR, { withFileTypes: true });
  const templateFiles = selectTemplateFiles(entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort(), templateIds);

  const report = {
    generatedAt: new Date().toISOString(),
    selection: templateIds.size ? [...templateIds].sort() : "all",
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
      result = await processTemplate(templateId, raw, { regionsOnly });
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
