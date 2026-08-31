import { NextResponse, type NextRequest } from "next/server";

import { requireOwnerOperator } from "@/lib/operator/auth";
import {
  assertPromptKey,
  createPromptServiceClient,
  promotePromptVersion,
} from "@/lib/operator/prompts/prompt-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ key: string; version: string }> | { key: string; version: string };
};

export async function POST(_request: NextRequest, context: RouteContext) {
  const guard = await requireOwnerOperator();

  if (!guard.ok) {
    return guard.response;
  }

  const { key: rawKey, version: rawVersion } = await Promise.resolve(context.params);

  try {
    const key = assertPromptKey(decodeURIComponent(rawKey));
    const version = Number(rawVersion);

    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "A valid prompt version is required." }, { status: 400 });
    }

    const client = createPromptServiceClient();
    const active = await promotePromptVersion(client, key, version, guard.userId);

    return NextResponse.json({ active });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to promote prompt version." },
      { status: 400 },
    );
  }
}
