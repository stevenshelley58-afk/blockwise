import { NextResponse } from "next/server";
import { z } from "zod";

import {
  runOperatorAssistant,
  type OperatorChatMessage,
  type OperatorProposedAction,
} from "@/lib/operator/assistant";
import { requireOperator } from "@/lib/operator/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const proposedActionSchema = z.object({
  kind: z.enum(["refresh_postcode", "collect_ads_for_page", "set_kill_switch"]),
  params: z.record(z.unknown()),
  label: z.string().min(1).max(200),
  summary: z.string().min(1).max(1000),
});

const conversationBodySchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(40),
  confirm: proposedActionSchema.optional(),
});

const legacyBodySchema = z.object({
  query: z.string().min(1).max(1000),
});

const bodySchema = z.union([conversationBodySchema, legacyBodySchema]);

type ChatBody = z.infer<typeof bodySchema>;

export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid operator chat request." }, { status: 400 });
  }

  try {
    const result = await runOperatorAssistant({
      messages: messagesFromBody(body.data),
      confirm: confirmFromBody(body.data),
      context: { email: guard.email },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: readableError(error) }, { status: 500 });
  }
}

function messagesFromBody(body: ChatBody): OperatorChatMessage[] {
  if ("messages" in body) return body.messages;
  return [{ role: "user", content: body.query.trim() }];
}

function confirmFromBody(body: ChatBody): OperatorProposedAction | undefined {
  if (!("confirm" in body)) return undefined;
  return body.confirm;
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Operator assistant failed.";
}
