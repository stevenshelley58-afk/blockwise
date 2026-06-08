import { NextResponse } from "next/server";

import { createServiceWorkerSource } from "@/lib/pwa/sw-policy";

export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
  return new NextResponse(createServiceWorkerSource(), {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
