import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest, readJsonBody } from "@/lib/adstudio/http";

type RenameBody = { name?: unknown };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const body = await readJsonBody<RenameBody>(request);
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 120) return NextResponse.json({ error: "Ad name must be between 1 and 120 characters." }, { status: 400 });
  const { data, error } = await access.supabase.from("ad_customer_ads").update({ name }).eq("id", id).eq("workspace_id", access.access.workspaceId).select("name").maybeSingle();
  if (error) return NextResponse.json({ error: "Ad name could not be saved." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Ad not found." }, { status: 404 });
  return NextResponse.json({ name: data.name });
}
