import { handleCalcomBookingWebhook } from "@/lib/booking/webhook-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleCalcomBookingWebhook(request);
}
