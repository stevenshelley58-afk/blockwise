import { NextResponse } from "next/server";

import {
  OperatorEmailError,
  getOperatorMailboxConfig,
  listOperatorEmails,
  parseEmailRecipients,
  sendOperatorEmail,
} from "@/lib/operator/email-service";
import { requireOperator } from "@/lib/operator/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const before = url.searchParams.get("before");
  const after = url.searchParams.get("after");

  try {
    const mailbox = await listOperatorEmails({ limit, before, after });
    return NextResponse.json(mailbox);
  } catch (error) {
    return operatorEmailErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as {
    to?: unknown;
    subject?: unknown;
    text?: unknown;
    replyTo?: unknown;
  };
  const to = parseEmailRecipients(body.to);
  const subject = typeof body.subject === "string" ? body.subject : "";
  const text = typeof body.text === "string" ? body.text : "";
  const replyTo = typeof body.replyTo === "string" ? body.replyTo.trim() : null;

  try {
    const result = await sendOperatorEmail({ to, subject, text, replyTo });
    return NextResponse.json(
      {
        ...result,
        mailbox: getOperatorMailboxConfig().mailboxAddress,
      },
      { status: 201 },
    );
  } catch (error) {
    return operatorEmailErrorResponse(error);
  }
}

function operatorEmailErrorResponse(error: unknown) {
  if (error instanceof OperatorEmailError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Operator email route failed", error);
  return NextResponse.json({ error: "operator_email_failed" }, { status: 500 });
}
