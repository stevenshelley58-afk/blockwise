import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = path.join(ROOT, "src", "lib", "adstudio", "gold-templates");
const REGISTRY_PATH = path.join(ROOT, "src", "lib", "adstudio", "gold-adstudio-templates.ts");

const BASE_ORDER = [
  "home-buyer-tips.ts",
  "interior-design-collage.ts",
  "market-types-table.ts",
  "elevate-residences.ts",
  "luxury-apartment-showcase.ts",
  "luxury-villa-night.ts",
  "elevated-living-editorial.ts",
  "dream-home-brand.ts",
  "house-for-rent-blue.ts",
  "first-buyer-notes.ts",
];

function metaNumber(fileName) {
  const match = /^meta-(\d+)\.ts$/u.exec(fileName);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function sortTemplateFiles(files) {
  const baseIndex = new Map(BASE_ORDER.map((file, index) => [file, index]));
  return [...files].sort((a, b) => {
    const aBase = baseIndex.get(a);
    const bBase = baseIndex.get(b);
    if (aBase !== undefined || bBase !== undefined) {
      return (aBase ?? Number.POSITIVE_INFINITY) - (bBase ?? Number.POSITIVE_INFINITY);
    }
    const aMeta = metaNumber(a);
    const bMeta = metaNumber(b);
    if (aMeta !== bMeta) return aMeta - bMeta;
    return a.localeCompare(b);
  });
}

function parseExport(source, suffix, fileName) {
  const match = new RegExp(`export\\s+const\\s+(\\w+)${suffix}\\b`, "u").exec(source);
  if (!match) throw new Error(`${fileName} is missing export const *${suffix}`);
  return `${match[1]}${suffix}`;
}

async function main() {
  const files = sortTemplateFiles((await readdir(TEMPLATE_DIR)).filter((file) => file.endsWith(".ts")));
  const modules = [];

  for (const file of files) {
    const source = await readFile(path.join(TEMPLATE_DIR, file), "utf8");
    modules.push({
      file,
      importPath: `./gold-templates/${file}`,
      templateExport: parseExport(source, "Template", file),
      sampleExport: parseExport(source, "Sample", file),
    });
  }

  const importLines = modules
    .map((module) => `import { ${module.sampleExport}, ${module.templateExport} } from "${module.importPath}";`)
    .join("\n");
  const templateLines = modules.map((module) => `  ${module.templateExport},`).join("\n");
  const sampleLines = modules.map((module) => `  [${module.templateExport}.id]: ${module.sampleExport},`).join("\n");

  const source = `import type { TextSlot } from "./template-design.ts";
import type { AdStudioTemplate } from "./templates.ts";
${importLines}

export const GOLD_SAMPLE_CARD_VERSION = "reference-board-pack-v1";

export type GoldTemplateRenderSample = {
  photoFile: string;
  photoFiles?: Record<string, string>;
  text: Partial<Record<TextSlot, string>>;
};

export const GOLD_AD_STUDIO_TEMPLATES: AdStudioTemplate[] = [
${templateLines}
];

export const GOLD_TEMPLATE_RENDER_SAMPLES: Record<string, GoldTemplateRenderSample> = {
${sampleLines}
};
`;

  await writeFile(REGISTRY_PATH, source, "utf8");
  console.log(`Synced ${modules.length} gold templates into ${path.relative(ROOT, REGISTRY_PATH)}`);
}

await main();
