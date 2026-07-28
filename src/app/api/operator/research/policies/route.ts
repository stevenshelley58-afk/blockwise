import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/operator/auth";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { data, error } = await createResearchServiceClient()
    .schema("research")
    .from("refresh_policies")
    .select("*")
    .order("priority", { ascending: true })
    .order("postcode", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ policies: data ?? [] });
}

const upsertSchema = z.object({
  postcode: z.string().regex(/^\d{4}$/u),
  state: z.string().default("WA"),
  priority: z.number().int().min(1).max(6),
  refreshCadenceMinutes: z.number().int().min(15).max(60 * 24 * 30),
  active: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const parsed = upsertSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { data, error } = await createResearchServiceClient()
    .schema("research")
    .from("refresh_policies")
    .upsert(
      {
        postcode: parsed.data.postcode,
        state: parsed.data.state,
        priority: parsed.data.priority,
        refresh_cadence_minutes: parsed.data.refreshCadenceMinutes,
        active: parsed.data.active,
        notes: parsed.data.notes ?? null,
      },
      { onConflict: "postcode,state" },
    )
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ policy: data });
}
