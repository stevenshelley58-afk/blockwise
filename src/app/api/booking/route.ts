import { NextResponse } from "next/server";

import {
  createBookingInvitation,
  getLatestOnboardingBooking,
} from "@/lib/booking/service";
import {
  BookingConfigurationError,
  getBookingProviderReadiness,
  normalizeBookingMarket,
} from "@/lib/booking/provider";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const context = await bookingContext();
  if (!context.ok) return context.response;
  const latest = await getLatestOnboardingBooking({
    workspaceId: context.workspaceId,
    serviceSupabase: context.service,
  });
  return NextResponse.json({
    market: context.market,
    configured: getBookingProviderReadiness().ok,
    booking: latest,
  });
}

export async function POST(request: Request) {
  const context = await bookingContext();
  if (!context.ok) return context.response;
  const body = (await request.json().catch(() => ({}))) as { mutationId?: unknown };
  const mutationId = typeof body.mutationId === "string" ? body.mutationId.trim() : "";
  if (!mutationId || mutationId.length > 160) {
    return NextResponse.json({ error: "A valid booking mutation ID is required." }, { status: 400 });
  }

  const rateLimit = await checkRateLimit(context.workspaceId, context.workspaceId, {
    windowSeconds: 3600,
    maxRequests: 10,
    bucket: "booking-invitation",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many booking attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const booking = await createBookingInvitation({
      workspaceId: context.workspaceId,
      market: context.market,
      customerEmail: context.email,
      customerName: context.name,
      mutationKey: `customer:${mutationId}`,
      serviceSupabase: context.service,
    });
    return NextResponse.json({ booking, redirectUrl: booking.hostedBookingUrl }, { status: 201 });
  } catch (error) {
    if (error instanceof BookingConfigurationError) {
      return NextResponse.json(
        { error: error.message, code: "booking_provider_not_configured" },
        { status: 503 },
      );
    }
    console.error("Booking invitation failed", error);
    return NextResponse.json({ error: "Booking could not be started." }, { status: 500 });
  }
}

async function bookingContext(): Promise<
  | {
      ok: true;
      workspaceId: string;
      market: "US" | "AU";
      email: string | null;
      name: string | null;
      service: ReturnType<typeof createSupabaseServiceClient>;
    }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, { surface: "self_serve" });
  if (!access.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: access.error }, { status: access.status }),
    };
  }
  const [{ data: workspace }, { data: profile }] = await Promise.all([
    supabase
      .from("workspaces")
      .select("country_code,region")
      .eq("id", access.access.workspaceId)
      .single(),
    supabase
      .from("profiles")
      .select("email,full_name")
      .eq("id", access.access.userId)
      .maybeSingle(),
  ]);
  return {
    ok: true,
    workspaceId: access.access.workspaceId,
    market: normalizeBookingMarket(workspace?.country_code ?? workspace?.region ?? access.access.region),
    email: typeof profile?.email === "string" ? profile.email : null,
    name: typeof profile?.full_name === "string" ? profile.full_name : null,
    service: createSupabaseServiceClient(),
  };
}
