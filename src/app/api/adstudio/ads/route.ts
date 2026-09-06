import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest, readJsonBody } from "@/lib/adstudio/http";
import { createCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { getTemplate } from "@/lib/adstudio/pack-gallery";
import { creditErrorMessage, WorkspaceCreditError } from "@/lib/credits/workspace-credits";
import {
  adPackReserveMutationKey,
  refundAdPackReservation,
  reserveAdPackCredits,
  settleAdPackCredits,
} from "@/lib/credits/ad-pack-entitlement";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explicitly create a customer ad from a direct template. GET never creates rows. */
export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const body = await readJsonBody<{ templateId?: unknown; idempotencyKey?: unknown }>(request);
  const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
  if (!templateId || templateId.length > 200) return NextResponse.json({ error: "A valid templateId is required." }, { status: 400 });
  const suppliedKey = request.headers.get("Idempotency-Key") ?? (typeof body.idempotencyKey === "string" ? body.idempotencyKey : "");
  const key = suppliedKey.trim() || undefined;
  if (key && !/^[a-z0-9-]{20,200}$/i.test(key)) {
    return NextResponse.json({ error: "Idempotency-Key must be a valid opaque key." }, { status: 400 });
  }
  const pack = await getTemplate(access.supabase, templateId);
  if (!pack) return NextResponse.json({ error: "Template not found." }, { status: 404 });

  // One complete Feed + Story pack per created ad. Ordinary text edits,
  // fixes, repeat saves, and repeat downloads never consume another pack.
  const serviceSupabase = createSupabaseServiceClient();
  const { data: authUser } = await access.supabase.auth.getUser();
  const actorProfileId = authUser.user?.id ?? null;
  if (!actorProfileId) {
    return NextResponse.json({ error: "Authentication is required to create an ad." }, { status: 401 });
  }

  const reserveMutationKey = adPackReserveMutationKey({
    workspaceId: access.access.workspaceId,
    idempotencyKey: key ?? null,
  });
  let reservation: Awaited<ReturnType<typeof reserveAdPackCredits>> | null = null;
  try {
    reservation = await reserveAdPackCredits({
      workspaceId: access.access.workspaceId,
      actorProfileId,
      mutationKey: reserveMutationKey,
      serviceSupabase,
    });
  } catch (error) {
    if (error instanceof WorkspaceCreditError) {
      return NextResponse.json({ error: creditErrorMessage(error.reason) }, { status: 402 });
    }
    console.error("[adstudio] ad pack reservation failed", { workspaceId: access.access.workspaceId, error });
    return NextResponse.json({ error: "Could not create ad. Please try again." }, { status: 500 });
  }

  try {
    const ad = await createCustomerAd(access.supabase, access.access.workspaceId, pack, key);
    await settleAdPackCredits({ reservation, adId: ad.adId, serviceSupabase });
    return NextResponse.json(ad, { status: 201 });
  } catch (error) {
    await refundAdPackReservation({ reservation, mutationKey: reserveMutationKey, serviceSupabase });
    console.error("[adstudio] customer ad creation failed", { workspaceId: access.access.workspaceId, templateId });
    return NextResponse.json({ error: "Could not create ad. Please try again." }, { status: 500 });
  }
}
