import { NextResponse, type NextRequest } from "next/server";

import { requireOwnerOperator } from "@/lib/operator/auth";
import {
  assertPromptKey,
  createPromptServiceClient,
  getActivePromptSection,
  listPromptVersions,
} from "@/lib/operator/prompts/prompt-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ key: string }> | { key: string };
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const guard = await requireOwnerOperator();

  if (!guard.ok) {
    return guard.response;
  }

  const { key: rawKey } = await Promise.resolve(context.params);

  try {
    const key = assertPromptKey(decodeURIComponent(rawKey));
    const client = createPromptServiceClient();
    const [active, versions] = await Promise.all([
      getActivePromptSection(key, undefined, client),
      listPromptVersions(key, client),
    ]);

    return NextResponse.json({ key, active, versions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load prompt versions." },
      { status: 400 },
    );
  }
}
