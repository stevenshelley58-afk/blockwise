import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { assertPromptKey, createPromptServiceClient } from "@/lib/operator/prompts/prompt-registry";
import { runPromptTest } from "@/lib/operator/prompts/prompt-test-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ key: string }> | { key: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const guard = await requireOperator();

  if (!guard.ok) {
    return guard.response;
  }

  const { key: rawKey } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as {
    fixtureId?: unknown;
    version?: unknown;
  };

  try {
    const key = assertPromptKey(decodeURIComponent(rawKey));
    const fixtureId = typeof body.fixtureId === "string" ? body.fixtureId : "";
    const version = body.version === undefined || body.version === null ? undefined : Number(body.version);

    if (!fixtureId) {
      return NextResponse.json({ error: "fixtureId is required." }, { status: 400 });
    }

    if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
      return NextResponse.json({ error: "version must be a positive integer." }, { status: 400 });
    }

    const result = await runPromptTest({
      key,
      fixtureId,
      version,
      client: createPromptServiceClient(),
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run prompt test." },
      { status: 400 },
    );
  }
}
