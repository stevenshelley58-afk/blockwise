import { CalendarCheck2, Clock3, Globe2, RefreshCw } from "lucide-react";

import { BookingLauncher } from "./booking-launcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { getHostedBookingUrl, normalizeBookingMarket } from "@/lib/booking/provider";
import { getLatestOnboardingBooking } from "@/lib/booking/service";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function BookingPage() {
  const { supabase, access, auth } = await requirePageSurfaceAccess("self_serve");
  const service = createSupabaseServiceClient();
  const [{ data: workspace }, booking] = await Promise.all([
    supabase
      .from("workspaces")
      .select("country_code,region")
      .eq("id", access.workspaceId)
      .single(),
    getLatestOnboardingBooking({ workspaceId: access.workspaceId, serviceSupabase: service }),
  ]);
  const market = normalizeBookingMarket(workspace?.country_code ?? workspace?.region ?? access.region);
  const timeZone = resolveTimeZone(auth.claims?.user_metadata?.timezone, market);
  const configured = Boolean(getHostedBookingUrl(market));
  const scheduled = booking?.scheduledStartAt
    ? new Intl.DateTimeFormat(market === "US" ? "en-US" : "en-AU", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone,
        timeZoneName: "short",
      }).format(new Date(booking.scheduledStartAt))
    : null;

  return (
    <main className="mx-auto grid w-full max-w-[720px] gap-5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <header className="grid gap-2">
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
          Onboarding assistance
        </p>
        <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] text-balance md:text-[27px]">
          Book your onboarding call
        </h1>
        <p className="max-w-[68ch] text-sm leading-6 text-muted-foreground">
          Choose a convenient time with the Blockwise team. The call is optional, and booking availability never limits access to your workspace.
        </p>
      </header>

      {booking && ["booked", "rescheduled", "completed"].includes(booking.status) ? (
        <Card className="gap-5 rounded-(--r-panel) border-(--line) bg-card py-5 shadow-card">
          <CardHeader className="gap-2 px-5">
            <div className="flex size-10 items-center justify-center rounded-full bg-success-soft text-success">
              <CalendarCheck2 aria-hidden className="size-5" />
            </div>
            <CardTitle className="font-display text-[17px] font-extrabold">
              {booking.status === "completed" ? "Onboarding completed" : "Your call is booked"}
            </CardTitle>
            <CardDescription className="leading-6">
              {scheduled ?? "The scheduler has your booking. Timing details remain available in your confirmation email."}
            </CardDescription>
          </CardHeader>
          {booking.status !== "completed" ? (
            <CardContent className="flex flex-wrap gap-3 px-5">
              <Button asChild variant="ghost-pill" size="pill">
                <a href={booking.rescheduleUrl ?? booking.hostedBookingUrl} target="_blank" rel="noreferrer">
                  <RefreshCw aria-hidden />
                  Reschedule with Cal.com
                </a>
              </Button>
            </CardContent>
          ) : null}
        </Card>
      ) : (
        <Card className="gap-5 rounded-(--r-panel) border-(--line) bg-card py-5 shadow-card">
          <CardHeader className="gap-3 px-5">
            <CardTitle className="font-display text-[17px] font-extrabold">Pick a time in your region</CardTitle>
            <CardDescription className="leading-6">
              You will continue to the hosted Blockwise calendar for {market === "US" ? "United States" : "Australian"} customers.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 px-5">
            <div className="grid gap-3 rounded-(--r-card) bg-(--surface-subtle) p-4 text-sm text-muted-foreground sm:grid-cols-2">
              <span className="flex items-center gap-2">
                <Clock3 aria-hidden className="size-4 text-foreground" />
                Times shown in your timezone
              </span>
              <span className="flex items-center gap-2">
                <Globe2 aria-hidden className="size-4 text-foreground" />
                Hosted securely by Cal.com
              </span>
            </div>
            <BookingLauncher configured={configured} />
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function resolveTimeZone(value: unknown, market: "AU" | "US") {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (candidate) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
      return candidate;
    } catch {
      // Fall through to the market default for malformed legacy metadata.
    }
  }
  return market === "US" ? "America/New_York" : "Australia/Sydney";
}
