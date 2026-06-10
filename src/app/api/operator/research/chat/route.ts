import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/operator/auth";
import { runOperatorAssistant, type OperatorChatMessage } from "@/lib/operator/assistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const proposedActionSchema = z.object({
  kind: z.enum(["refresh_postcode", "collect_ads_for_page", "set_kill_switch"]),
  params: z.record(z.unknown()),
  label: z.string(),
  summary: z.string(),
});

const bodySchema = z
  .object({
    query: z.string().min(1).max(4000).optional(),
    messages: z.array(messageSchema).min(1).max(40).optional(),
    confirm: proposedActionSchema.optional(),
  })
  .refine((body) => Boolean(body.query || body.messages || body.confirm), {
    message: "Provide a query, messages, or a confirm action.",
  });

export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { query, messages, confirm } = parsed.data;
  const history: OperatorChatMessage[] = messages ?? (query ? [{ role: "user", content: query }] : []);

  if (history.length === 0 && !confirm) {
    return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
  }

  try {
    const result = await runOperatorAssistant({
      messages: history,
      confirm,
      context: { email: guard.email },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Operator assistant failed." },
      { status: 500 },
    );
  }
}
