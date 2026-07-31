import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const GALLERY_DIR = path.join(
  process.cwd(),
  "src",
  "lib",
  "adstudio",
  "template-gallery",
);
const MANIFEST_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "adstudio",
  "manifest.json",
);

interface TemplateSummary {
  id: string;
  name: string;
  format: string;
  dimensions: { width: number; height: number };
  sample: { imageSrc: string };
  textInputCount: number;
  typographyCount: number;
  fontFileCount: number;
  deterministicOnly: boolean;
}

export async function GET() {
  try {
    const files = (await readdir(GALLERY_DIR)).filter(
      (f) => f.startsWith("meta-") && f.endsWith(".json"),
    );

    const templates: TemplateSummary[] = [];

    for (const file of files) {
      const raw = await readFile(path.join(GALLERY_DIR, file), "utf-8");
      const tpl = JSON.parse(raw) as {
        id: string;
        name: string;
        format: string;
        dimensions: { width: number; height: number };
        sample: { imageSrc: string };
        deterministicOnly?: boolean;
        inputs?: { text?: unknown[] };
        typography?: Record<string, { fontFile?: string }>;
      };

      const textInputs = tpl.inputs?.text ?? [];
      const typography = tpl.typography ?? {};
      const typographyCount = Object.keys(typography).length;
      const fontFileCount = Object.values(typography).filter(
        (t) => typeof t.fontFile === "string" && t.fontFile.length > 0,
      ).length;

      templates.push({
        id: tpl.id,
        name: tpl.name,
        format: tpl.format,
        dimensions: tpl.dimensions,
        sample: { imageSrc: tpl.sample.imageSrc },
        textInputCount: textInputs.length,
        typographyCount,
        fontFileCount,
        deterministicOnly: tpl.deterministicOnly ?? false,
      });
    }

    // Read font manifest
    const manifestRaw = await readFile(MANIFEST_PATH, "utf-8");
    const manifest = JSON.parse(manifestRaw) as {
      faces: Array<{
        fontId: string;
        family: string;
        weight: number;
        italic: boolean;
        file: string;
      }>;
    };

    const fonts = manifest.faces.map((f) => ({
      fontId: f.fontId,
      family: f.family,
      weight: f.weight,
      italic: f.italic,
      file: f.file,
    }));

    return NextResponse.json({ templates, fonts });
  } catch (err) {
    console.error("[template-review] GET list error:", err);
    return NextResponse.json(
      { error: "Failed to read template gallery" },
      { status: 500 },
    );
  }
}
