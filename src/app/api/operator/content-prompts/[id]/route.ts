import { NextResponse } from "next/server";
import { z } from "zod";

import { savePromptTemplateVersion, setPromptTemplateStatus } from "@/lib/content-engine";
import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("version"), templateBody: z.string().min(20) }),
  z.object({ action: z.literal("status"), status: z.enum(["active", "locked", "archived", "draft"]) }),
]);

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function PATCH(req: Request, context: RouteContext) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id } = await Promise.resolve(context.params);
  const serviceSupabase = createSupabaseServiceClient();
  const {
    data: { user },
  } = await guard.supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (parsed.data.action === "version") {
    const template = await savePromptTemplateVersion({
      supabase: serviceSupabase as never,
      templateId: id,
      body: parsed.data.templateBody,
      createdBy: user.id,
    });
    return NextResponse.json({ template });
  }

  await setPromptTemplateStatus({
    supabase: serviceSupabase as never,
    templateId: id,
    status: parsed.data.status,
  });

  return NextResponse.json({ ok: true });
}

