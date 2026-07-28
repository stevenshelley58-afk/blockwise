import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/operator/auth";
import { executeRefreshPostcode } from "@/lib/operator/postcode-refresh";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  scope: z.enum(["postcode", "advertiser_page"]),
  value: z.string().min(1),
});

async function parseBody(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { body: await req.json(), redirectAfter: false };
  }

  const formData = await req.formData();
  return {
    body: Object.fromEntries(formData.entries()),
    redirectAfter: true,
  };
}

function redirectWithError(req: Request, code: "invalid_request" | "invalid_postcode" | "refresh_failed") {
  const url = new URL("/operator/research", req.url);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url, 303);
}

/**
 * POST /api/operator/research/refresh-now
 * Signals Hermes to refresh a specific postcode or page. Postcode refreshes
 * create a source-backed due policy and a one-off census job, recycling
 * failed/blocked dedupe keys so manual repair still works when the scheduler
 * is paused. Unsupported states are recorded as visible coverage defects.
 */
export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { body, redirectAfter } = await parseBody(req);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    if (redirectAfter) return redirectWithError(req, "invalid_request");
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { scope, value } = parsed.data;

  const research = createResearchServiceClient().schema("research");
  let message: string | undefined;

  if (scope === "postcode") {
    const postcode = value.trim();
    if (!/^\d{4}$/u.test(postcode)) {
      if (redirectAfter) return redirectWithError(req, "invalid_postcode");
      return NextResponse.json({ error: "postcode must be four digits" }, { status: 400 });
    }
    try {
      const result = await executeRefreshPostcode(research, postcode, guard.email);
      message = result.message;
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not refresh postcode.";
      if (redirectAfter) return redirectWithError(req, "refresh_failed");
      return NextResponse.json({ error: text }, { status: 500 });
    }
  } else {
    const { error } = await research
      .from("advertiser_pages")
      .update({ last_checked_at: null })
      .eq("id", value);
    if (error) {
      if (redirectAfter) return redirectWithError(req, "refresh_failed");
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Audit the operator action.
  await research.from("agent_decisions").insert({
    decision_type: "cadence_change",
    subject_type: scope === "postcode" ? "postcode" : "advertiser_page",
    subject_id: value,
    decision: { action: "refresh_now", operator: guard.email },
    rationale: "Operator triggered immediate refresh",
    confidence: 100,
    hermes_skill: "operator-console",
  });

  if (redirectAfter) {
    return NextResponse.redirect(new URL("/operator/research", req.url), 303);
  }

  return NextResponse.json(message ? { ok: true, message } : { ok: true });
}
