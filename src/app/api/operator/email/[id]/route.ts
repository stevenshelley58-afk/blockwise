import { NextResponse } from "next/server";

import { OperatorEmailError, getOperatorEmail } from "@/lib/operator/email-service";
import { requireOperator } from "@/lib/operator/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  try {
    const result = await getOperatorEmail(id);
    if (!result.message) {
      return NextResponse.json({ error: "email_not_found", mailbox: result.mailbox }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OperatorEmailError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Operator email detail route failed", error);
    return NextResponse.json({ error: "operator_email_detail_failed" }, { status: 500 });
  }
}
