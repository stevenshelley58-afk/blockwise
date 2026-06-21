import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { runDraftCheckPropertyCheck } from "@/lib/property-check/adapter";
import { createPropertyCheckRecord, listPropertyChecks } from "@/lib/property-check/persistence";
import { propertyCheckCreateSchema } from "@/lib/property-check/schema";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await requireApiWorkspace(request, "property_check");

  if (!context.ok) {
    return context.response;
  }

  try {
    const checks = await listPropertyChecks(context.supabase, context.access.workspaceId);
    return NextResponse.json({ checks });
  } catch (error) {
    console.error("[property-check] list failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Property checks could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const context = await requireApiWorkspace(request, "property_check");

  if (!context.ok) {
    return context.response;
  }

  const body = await request.json().catch(() => null);
  const parsed = propertyCheckCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "A valid address and client situation are required." }, { status: 400 });
  }

  const result = await runDraftCheckPropertyCheck({
    workspaceId: context.access.workspaceId,
    userId: context.access.userId,
    address: parsed.data.address,
    clientSituation: parsed.data.clientSituation,
    notes: parsed.data.notes,
  });

  try {
    const check = await createPropertyCheckRecord(context.supabase, {
      workspaceId: context.access.workspaceId,
      userId: context.access.userId,
      address: parsed.data.address,
      clientSituation: parsed.data.clientSituation,
      result,
    });

    return NextResponse.json({ check }, { status: 201 });
  } catch (error) {
    console.error("[property-check] save failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Property check could not be saved." }, { status: 500 });
  }
}
