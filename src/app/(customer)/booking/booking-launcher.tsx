"use client";

import { CalendarDays, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function BookingLauncher({ configured }: { configured: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startBooking() {
    if (pending || !configured) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutationId: crypto.randomUUID() }),
      });
      const payload = (await response.json()) as { redirectUrl?: string; error?: string };
      if (!response.ok || !payload.redirectUrl) {
        throw new Error(payload.error || "Booking could not be started.");
      }
      window.location.assign(payload.redirectUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Booking could not be started.");
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <Button
        type="button"
        size="lg"
        onClick={() => void startBooking()}
        disabled={pending || !configured}
        aria-describedby={error ? "booking-launch-error" : undefined}
      >
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <CalendarDays aria-hidden />}
        {pending ? "Opening calendar" : "Choose a time"}
        {!pending ? <ExternalLink aria-hidden /> : null}
      </Button>
      {error ? (
        <p id="booking-launch-error" className="text-sm font-semibold text-error" role="alert">
          {error} Try again, or ask support to resend your booking link.
        </p>
      ) : null}
      {!configured ? (
        <p className="text-sm font-semibold text-warning" role="status">
          Online scheduling is temporarily unavailable. Your product access is unaffected; support can arrange the call manually.
        </p>
      ) : null}
    </div>
  );
}
