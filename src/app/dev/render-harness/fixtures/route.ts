// Render-parity fixtures endpoint (dev only).
//
// The parity spec needs the fixture template docs + instances in the browser
// and on the server from the same bytes. This route reads them from
// tests/fixtures/adstudio-v2 and refuses to exist in production builds —
// same posture as /operator/template-trace tooling, but dev-guarded instead
// of operator-guarded because it serves test fixtures, not prod data.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function fixtureRoot(): string {
  return join(process.cwd(), "tests", "fixtures", "adstudio-v2");
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("not found", { status: 404 });
  }

  const root = fixtureRoot();
  const fixtures: Array<{ id: string; doc: unknown; instances: Record<string, unknown> }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("meta-fixture-")) continue;
    const doc = JSON.parse(readFileSync(join(root, entry.name, "template.json"), "utf8"));
    const instances: Record<string, unknown> = {};
    for (const name of ["feed", "story"]) {
      try {
        instances[name] = JSON.parse(readFileSync(join(root, entry.name, `instance-${name}.json`), "utf8"));
      } catch {
        // fixture has no instance for that format
      }
    }
    fixtures.push({ id: entry.name, doc, instances });
  }
  fixtures.sort((a, b) => a.id.localeCompare(b.id));
  return NextResponse.json({ fixtures });
}
