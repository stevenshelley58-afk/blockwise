// Runs detectTemplateRegions across all released gallery templates and reports
// coverage: how many regions matched cleanly, how many are flagged
// lowConfidence, and how many failed to match at all (box: null). This is
// a standalone diagnostic/checkpoint step — per the "no silent caps"
// principle, every gap gets logged here rather than silently skipped
// later in the pipeline.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectTemplateRegions } from "./detect-regions.mjs";

const GALLERY_DIR = path.resolve(process.cwd(), "src/lib/adstudio/template-gallery");
const REPORT_PATH = path.resolve(process.cwd(), ".cache/font-corpus/region-detection-report.json");

async function main() {
  const entries = await readdir(GALLERY_DIR, { withFileTypes: true });
  const templateFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();

  const report = {
    generatedAt: new Date().toISOString(),
    templates: [],
    totals: { templates: 0, regions: 0, matched: 0, lowConfidence: 0, unmatched: 0 },
  };

  for (const fileName of templateFiles) {
    const templateId = fileName.replace(/\.json$/, "");
    const raw = JSON.parse(await readFile(path.join(GALLERY_DIR, fileName), "utf8"));
    const imageSrc = raw?.sample?.imageSrc;
    const textInputs = raw?.inputs?.text ?? [];
    if (!imageSrc || textInputs.length === 0) {
      console.log(`SKIP ${templateId}: no sample.imageSrc or inputs.text`);
      continue;
    }
    const imagePath = path.resolve(process.cwd(), "public", imageSrc.replace(/^\//, ""));

    let result;
    try {
      result = await detectTemplateRegions(templateId, imagePath, textInputs);
    } catch (error) {
      console.log(`ERROR ${templateId}: ${error.message}`);
      report.templates.push({ templateId, error: error.message });
      continue;
    }

    const matched = result.regions.filter((r) => r.box && !r.lowConfidence).length;
    const lowConf = result.regions.filter((r) => r.box && r.lowConfidence).length;
    const unmatched = result.regions.filter((r) => !r.box).length;

    report.totals.templates += 1;
    report.totals.regions += result.regions.length;
    report.totals.matched += matched;
    report.totals.lowConfidence += lowConf;
    report.totals.unmatched += unmatched;

    report.templates.push({
      templateId,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      regionCount: result.regions.length,
      matched,
      lowConfidence: lowConf,
      unmatched,
      regions: result.regions.map((r) => ({
        key: r.key,
        score: Math.round(r.score * 1000) / 1000,
        lowConfidence: r.lowConfidence,
        hasBox: Boolean(r.box),
      })),
    });

    const flag = lowConf > 0 || unmatched > 0 ? "  <-- needs review" : "";
    console.log(
      `${templateId}: ${matched}/${result.regions.length} clean, ${lowConf} low-confidence, ${unmatched} unmatched${flag}`,
    );
  }

  const { templates, matched, lowConfidence, unmatched, regions } = report.totals;
  console.log("\n=== Summary ===");
  console.log(`Templates processed: ${templates}`);
  console.log(`Total regions: ${regions}`);
  console.log(`Clean matches: ${matched} (${((matched / regions) * 100).toFixed(1)}%)`);
  console.log(`Low-confidence matches: ${lowConfidence} (${((lowConfidence / regions) * 100).toFixed(1)}%)`);
  console.log(`Unmatched: ${unmatched} (${((unmatched / regions) * 100).toFixed(1)}%)`);

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
