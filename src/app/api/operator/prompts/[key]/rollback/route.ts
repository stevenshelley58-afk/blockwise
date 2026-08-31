import { NextResponse, type NextRequest } from "next/server";

import { requireOwnerOperator } from "@/lib/operator/auth";
import {
  assertPromptKey,
  createPromptServiceClient,
  rollbackPromptVersion,
} from "@/lib/operator/prompts/prompt-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ key: string }> | { key: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const guard = await requireOwnerOperator();

  if (!guard.ok) {
    return guard.response;
  }

  const { key: rawKey } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as { targetVersion?: unknown };

  try {
    const key = assertPromptKey(decodeURIComponent(rawKey));
    const targetVersion = Number(body.targetVersion);

    if (!Number.isInteger(targetVersion) || targetVersion < 1) {
      return NextResponse.json({ error: "A valid rollback targetVersion is required." }, { status: 400 });
    }

    const client = createPromptServiceClient();
    const active = await rollbackPromptVersion(client, key, targetVersion, guard.userId);

    return NextResponse.json({ active });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to rollback prompt version." },
      { status: 400 },
    );
  }
}
