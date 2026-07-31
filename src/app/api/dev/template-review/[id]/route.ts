import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

  try {
    const raw = await readFile(filePath, "utf-8");
    const template = JSON.parse(raw);
    return NextResponse.json(template);
  } catch {
    return NextResponse.json(
      { error: "Template not found" },
      { status: 404 },
    );
  }
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

  try {
    const raw = await readFile(filePath, "utf-8");
    const template = JSON.parse(raw) as Record<string, unknown>;

    if (body.typography) {
      template.typography = body.typography;
    }

    if (body.textInputs) {
      const inputs = (template.inputs ?? {}) as Record<string, unknown>;
      inputs.text = body.textInputs;
      template.inputs = inputs;
    }

    // Basic validation: ensure required fields still exist
    const tplInputs = template.inputs as { text?: unknown[] } | undefined;
    const textKeys = new Set(
      (tplInputs?.text as Array<{ key: string }>)?.map((t) => t.key) ?? [],
    );
    const typoKeys = Object.keys(
      (template.typography as Record<string, unknown>) ?? {},
    );

    // Every typography key should have a matching text input key
    for (const tk of typoKeys) {
      if (!textKeys.has(tk)) {
        return NextResponse.json(
          {
            error: `Typography key "${tk}" has no matching text input`,
          },
          { status: 400 },
        );
      }
    }

    await writeFile(filePath, JSON.stringify(template, null, 2) + "\n", "utf-8");

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[template-review] PUT error:", err);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 },
    );
  }
}
