import { NextResponse, type NextRequest } from "next/server";

import { requireOwnerOperator } from "@/lib/operator/auth";
import {
  assertPromptKey,
  createDraftPromptVersion,
  createPromptServiceClient,
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

  try {
    const key = assertPromptKey(decodeURIComponent(rawKey));
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      body?: string;
      notes?: string;
      metadata?: Record<string, unknown>;
      outputSchema?: unknown;
    };

    if (typeof body.body !== "string" || !body.body.trim()) {
      return NextResponse.json({ error: "Prompt body is required." }, { status: 400 });
    }

    const client = createPromptServiceClient();
    const draft = await createDraftPromptVersion(client, key, {
      title: body.title,
      body: body.body,
      notes: body.notes,
      metadata: body.metadata,
      outputSchema: body.outputSchema,
      createdBy: guard.userId,
    });

    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create prompt draft." },
      { status: 400 },
    );
  }
}
