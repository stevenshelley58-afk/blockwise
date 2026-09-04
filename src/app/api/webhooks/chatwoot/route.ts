import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { readBoundedRequestBody, RequestBodyTooLargeError } from "@/lib/ops/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let raw: string;
  try { raw = await readBoundedRequestBody(request, 128 * 1024); } catch (error) { return NextResponse.json({ error: error instanceof RequestBodyTooLargeError ? error.code : "request_body_unavailable" }, { status: 413 }); }
  let secret: string; try { secret=webhookSecret(); } catch { return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 }); }
  const signature = request.headers.get("x-chatwoot-signature")?.trim() ?? ""; const timestamp = request.headers.get("x-chatwoot-timestamp")?.trim() ?? "";
  if (!signature || !timestamp || !/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp) * 1000) > 300000 || !verify(signature, timestamp, raw, secret)) return NextResponse.json({ error: "invalid_webhook_signature" }, { status: 401 });
  let body: Record<string, unknown>;
  try { const parsed=JSON.parse(raw); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); body=parsed as Record<string, unknown>; } catch { return NextResponse.json({ error: "invalid_webhook" }, { status: 422 }); }
  const eventType=typeof body.event === "string" ? body.event : ""; const conversation=record(body.conversation); const message=record(body.message);
  const conversationId=String(conversation?.id ?? body.conversation_id ?? ""); const messageId=String(message?.id ?? body.id ?? ""); const status=typeof conversation?.status === "string" ? conversation.status : (typeof body.status === "string" ? body.status : "");
  const account=record(body.account); const accountId=String(account?.id ?? body.account_id ?? "");
  if (!/^\d+$/.test(conversationId) || !/^\d+$/.test(accountId) || accountId !== (process.env.CHATWOOT_ACCOUNT_ID?.trim() ?? "") || !["message_created","message_updated","conversation_status_changed","conversation_updated"].includes(eventType)) return NextResponse.json({ error: "unsupported_webhook" }, { status: 422 });
  const content=typeof body.content === "string" ? body.content.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim().slice(0,4000) : (typeof message?.content === "string" ? message.content.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim().slice(0,4000) : "");
  const direction=String(body.message_type ?? message?.message_type ?? ""); if (eventType.startsWith("message_") && !["incoming","incoming_email"].includes(direction)) return NextResponse.json({ ok: true, status: "ignored" });
  const delivery=request.headers.get("x-chatwoot-delivery")?.trim() || String(body.id ?? createHash("sha256").update(raw).digest("hex"));
  const result=await createSupabaseServiceClient().rpc("record_ops_chatwoot_webhook", { p_event_id: delivery, p_payload_hash: createHash("sha256").update(raw).digest("hex"), p_account_id: accountId, p_event_type: eventType, p_provider_conversation_id: conversationId, p_provider_message_id: messageId, p_status: status, p_body: content });
  if (result.error) return NextResponse.json({ error: "webhook_processing_failed" }, { status: 503 });
  return NextResponse.json({ ok: true, status: typeof result.data === "object" && result.data ? (result.data as Record<string, unknown>).status : "processed" });
}
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function verify(value: string, timestamp: string, raw: string, secret: string): boolean { if (!/^sha256=[0-9a-f]{64}$/iu.test(value)) return false; const expected=createHmac("sha256",secret).update(`${timestamp}.${raw}`).digest("hex"); return timingSafeEqual(Buffer.from(value.slice(7),"hex"),Buffer.from(expected,"hex")); }
function webhookSecret(): string { const path=process.env.CHATWOOT_WEBHOOK_SECRET_FILE?.trim(); if (!path || !isAbsolute(path)) throw new Error("CHATWOOT_WEBHOOK_SECRET_FILE is required"); const resolved=resolve(path); const stat=lstatSync(resolved); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("CHATWOOT_WEBHOOK_SECRET_FILE is unsafe"); const value=readFileSync(resolved,"utf8").trim(); if (!value) throw new Error("CHATWOOT_WEBHOOK_SECRET_FILE is empty"); return value; }
