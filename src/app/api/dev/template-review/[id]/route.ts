import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  applyTemplateReviewOverride,
  deleteTemplateReviewOverride,
  fetchTemplateReviewOverride,
  findTypographyKeyWithoutTextInput,
  upsertTemplateReviewOverride,
  type TemplateReviewOverridePayload,
} from "@/lib/adstudio/template-review-overrides";

const GALLERY_DIR = path.join(
  process.cwd(),
  "src",
  "lib",
  "adstudio",
  "template-gallery",
);

function templatePath(id: string): string | null {
  // Prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  return path.join(GALLERY_DIR, `${id}.json`);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const filePath = templatePath(id);
  if (!filePath) {
    return NextResponse.json({ error: "Invalid template id" }, { status: 400 });
  }

  let template: Record<string, unknown>;
  try {
    const raw = await readFile(filePath, "utf-8");
    template = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Template not found" },
      { status: 404 },
    );
  }

  // Merge any saved override (Vercel saves land in Supabase, not on disk).
  try {
    const override = await fetchTemplateReviewOverride(id);
    if (override) template = applyTemplateReviewOverride(template, override);
  } catch (err) {
    console.error("[template-review] override lookup error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Override lookup failed" },
      { status: 500 },
    );
  }

  return NextResponse.json(template);
}

interface TypographyEntry {
  fontId: string;
  family: string;
  [key: string]: unknown;
}

interface TextInput {
  key: string;
  label: string;
  maxLength: number;
  sample: string;
  required: boolean;
}

interface PutBody {
  typography?: Record<string, TypographyEntry>;
  textInputs?: TextInput[];
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const filePath = templatePath(id);
  if (!filePath) {
    return NextResponse.json({ error: "Invalid template id" }, { status: 400 });
  }

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.typography && !body.textInputs) {
    return NextResponse.json(
      { error: "Must provide typography or textInputs" },
      { status: 400 },
    );
  }

  let template: Record<string, unknown>;
  try {
    const raw = await readFile(filePath, "utf-8");
    template = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Template not found" },
      { status: 404 },
    );
  }

  // Layer any previously saved override under the incoming edit so partial
  // bodies never resurrect stale on-disk state, then apply the edit itself.
  let existingOverride: TemplateReviewOverridePayload | null = null;
  try {
    existingOverride = await fetchTemplateReviewOverride(id);
  } catch (err) {
    console.error("[template-review] override lookup error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Override lookup failed" },
      { status: 500 },
    );
  }
  if (existingOverride) {
    template = applyTemplateReviewOverride(template, existingOverride);
  }
  template = applyTemplateReviewOverride(template, {
    typography: body.typography,
    textInputs: body.textInputs,
  });

  // Basic validation: every typography key needs a matching text input key
  const orphanKey = findTypographyKeyWithoutTextInput(template);
  if (orphanKey) {
    return NextResponse.json(
      { error: `Typography key "${orphanKey}" has no matching text input` },
      { status: 400 },
    );
  }

  // Disk first (local dev); on Vercel the filesystem is read-only, so fall
  // back to the Supabase override table.
  try {
    await writeFile(filePath, JSON.stringify(template, null, 2) + "\n", "utf-8");
    // Disk is now canonical; drop a shadowing override if one exists.
    let warning: string | undefined;
    if (existingOverride) {
      try {
        await deleteTemplateReviewOverride(id);
      } catch (err) {
        console.error("[template-review] override cleanup error:", err);
        warning = `Saved to disk, but the stale Supabase override could not be removed: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }
    return NextResponse.json({ ok: true, id, storage: "disk", warning });
  } catch (diskErr) {
    try {
      const payload: TemplateReviewOverridePayload = {
        ...existingOverride,
        ...(body.typography ? { typography: body.typography } : {}),
        ...(body.textInputs ? { textInputs: body.textInputs } : {}),
      };
      await upsertTemplateReviewOverride(id, payload);
      return NextResponse.json({ ok: true, id, storage: "supabase" });
    } catch (supabaseErr) {
      console.error("[template-review] PUT error:", diskErr, supabaseErr);
      return NextResponse.json(
        {
          error: `Failed to update template. Disk: ${
            diskErr instanceof Error ? diskErr.message : String(diskErr)
          }. Supabase: ${
            supabaseErr instanceof Error ? supabaseErr.message : String(supabaseErr)
          }`,
        },
        { status: 500 },
      );
    }
  }
}
