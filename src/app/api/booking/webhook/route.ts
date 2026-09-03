import { handleCalcomBookingWebhook } from "@/lib/booking/webhook-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Legacy Cal.com URL retained for existing provider webhook registrations.
// The shared handler verifies `verifyCalcomWebhook` with `CALCOM_WEBHOOK_SECRET`.
export async function POST(request: Request) {
  return handleCalcomBookingWebhook(request);
}
