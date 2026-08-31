import { NextResponse } from "next/server";

import { loadDbSchema } from "@/lib/operator/database";
import { requireOwnerOperator } from "@/lib/operator/auth";

export const dynamic = "force-dynamic";

/** Operator-only: list every public base table and its columns. */
export async function GET() {
  const auth = await requireOwnerOperator();
  if (!auth.ok) return auth.response;

  try {
    const tables = await loadDbSchema();
    return NextResponse.json({ tables });
  } catch (error) {
    console.error("[operator/database/schema]", error);
    return NextResponse.json({ error: "schema_load_failed" }, { status: 500 });
  }
}
