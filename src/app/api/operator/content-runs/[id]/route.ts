import { NextResponse } from "next/server";

import { loadContentRunBundle } from "@/lib/content-engine";
import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function GET(_req: Request, context: RouteContext) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await Promise.resolve(context.params);
  const bundle = await loadContentRunBundle(createSupabaseServiceClient() as never, id);

  return NextResponse.json(bundle);
}

