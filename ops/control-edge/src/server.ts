import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { parseOpsAction, actionCapability, type OpsActionEnvelope } from "../../../src/lib/ops/action-contract.ts";
import { authenticate } from "./auth.ts";
import { loadConfig, type ControlConfig } from "./config.ts";
import { createSupabaseRepository, type ActionRepository } from "./repository.ts";
import { InternalBlockwiseExecutor, runOneAction } from "./executor.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORRELATION = /^[A-Za-z0-9._:-]{8,128}$/;
type Dependencies = { config: ControlConfig; repo: ActionRepository; executor: InternalBlockwiseExecutor };

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const declared = Number(req.headers["content-length"] ?? "");
  if (Number.isSafeInteger(declared) && declared > max) throw Object.assign(new Error("request body exceeds limit"), { status: 413 });
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const value = Buffer.from(chunk as Uint8Array); size += value.length; if (size > max) throw Object.assign(new Error("request body exceeds limit"), { status: 413 }); chunks.push(value); }
  return Buffer.concat(chunks).toString("utf8");
}
function json(res: ServerResponse, status: number, value: unknown, correlationId: string): void { const body = JSON.stringify(value); res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-correlation-id": correlationId, "content-length": Buffer.byteLength(body) }); res.end(body); }
function errorStatus(error: unknown): number { const message = error instanceof Error ? error.message.toLowerCase() : ""; if (message.includes("version conflict") || message.includes("already bound")) return 409; if (message.includes("target") || message.includes("operator") || message.includes("role_required")) return 403; if (message.includes("payload") || message.includes("invalid")) return 422; return 503; }
function correlation(req: IncomingMessage): string { const value = req.headers["x-correlation-id"]?.toString().trim() ?? ""; return CORRELATION.test(value) ? value : randomUUID(); }
function clientKey(req: IncomingMessage): string { return req.socket.remoteAddress ?? "unknown"; }

export function createControlEdgeServer(deps: Dependencies): ReturnType<typeof createServer> {
  const buckets = new Map<string, { start: number; count: number }>();
  function rateLimited(req: IncomingMessage): boolean { const now = Date.now(); const key = clientKey(req); if (buckets.size > 10000) for (const [candidate, bucket] of buckets) if (now - bucket.start >= 60000) buckets.delete(candidate); const previous = buckets.get(key); if (!previous || now - previous.start >= 60000) { buckets.set(key, { start: now, count: 1 }); return false; } previous.count += 1; return previous.count > 60; }
  async function guarded(req: IncomingMessage, res: ServerResponse, path: string, body: string, scope: string, correlationId: string): Promise<boolean> { if (rateLimited(req)) { json(res, 429, { error: "rate_limited", correlationId }, correlationId); return false; } try { const result = await authenticate(req, path, body, scope, deps.config.internalSecret, deps.repo, new Date(), deps.config.replayWindowSeconds); if (!result.ok) { json(res, result.status, { error: result.error, correlationId }, correlationId); return false; } return true; } catch { json(res, 503, { error: "internal_auth_unavailable", correlationId }, correlationId); return false; } }
  const server = createServer(async (req, res) => {
    const correlationId = correlation(req); const url = new URL(req.url ?? "/", "http://control-edge.local");
    try {
      if (req.method === "GET" && url.pathname === "/health/live") return json(res, 200, { status: "ok" }, correlationId);
      if (url.pathname === "/health/ready") { const body = ""; if (!(await guarded(req, res, `${url.pathname}${url.search}`, body, "ops.read", correlationId))) return; if (!(await deps.repo.ready())) return json(res, 503, { status: "not_ready", correlationId }, correlationId); return json(res, 200, { status: "ready" }, correlationId); }
      if (url.pathname === "/v1/control/actions" && req.method === "POST") {
        if (req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return json(res, 415, { error: "application_json_required", correlationId }, correlationId);
        const body = await readBody(req, deps.config.maxBodyBytes); if (!(await guarded(req, res, `${url.pathname}${url.search}`, body, "ops.write", correlationId))) return;
        let action: OpsActionEnvelope; try { action = parseOpsAction(JSON.parse(body)); } catch { return json(res, 422, { error: "invalid_action", correlationId }, correlationId); }
        if (action.action === "billing_portal_link") return json(res, 501, { error: "portal_handoff_unavailable", message: "A protected one-time portal handoff is not configured; no action was queued.", correlationId }, correlationId);
        try { const result = await deps.repo.enqueue(action); return json(res, 202, { schema: "blockwise.ops.action.v1", actionId: result.actionId, status: result.status, capability: actionCapability(action.action).capability, correlationId }, correlationId); } catch (error) { return json(res, errorStatus(error), { error: "action_not_accepted", correlationId }, correlationId); }
      }
      const match = /^\/v1\/control\/actions\/([^/]+)$/.exec(url.pathname);
      if (match && req.method === "GET") {
        const actionId = match[1]; const workspaceId = req.headers["x-blockwise-workspace-id"]?.toString().trim() ?? "";
        if (!UUID.test(actionId) || !UUID.test(workspaceId)) return json(res, 400, { error: "action_id_and_workspace_header_required", correlationId }, correlationId);
        if (!(await guarded(req, res, `${url.pathname}${url.search}`, "", "ops.read", correlationId))) return;
        const result = await deps.repo.status(actionId, workspaceId); if (!result) return json(res, 404, { error: "action_not_found", correlationId }, correlationId); return json(res, 200, { ...result, correlationId }, correlationId);
      }
      return json(res, 404, { error: "not_found", correlationId }, correlationId);
    } catch (error) { const status = (error as { status?: number }).status ?? 503; console.error(JSON.stringify({ event: "control_edge_error", status, error: error instanceof Error ? error.message.slice(0, 160) : "unknown", correlationId })); return json(res, status, { error: status === 413 ? "request_too_large" : "service_unavailable", correlationId }, correlationId); }
    finally { /* response ownership stays local to this request */ }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

export async function startControlEdge(config = loadConfig()): Promise<void> {
  const repo = await createSupabaseRepository(config.supabaseUrl, config.supabaseServiceRoleKey); const executor = new InternalBlockwiseExecutor(config.executorUrl, config.executorSecret);
  const server = createControlEdgeServer({ config, repo, executor });
  server.listen(config.port, config.host, () => console.log(JSON.stringify({ event: "control_edge_started", host: config.host, port: config.port, worker: config.workerEnabled })));
  if (config.workerEnabled) { const tick = async () => { try { await runOneAction(repo, executor); } catch (error) { console.error(JSON.stringify({ event: "control_edge_worker_error", error: error instanceof Error ? error.message.slice(0, 160) : "unknown" })); } }; await tick(); const timer = setInterval(tick, config.workerIntervalMs); timer.unref(); }
}

if (import.meta.url === `file://${process.argv[1]}`) startControlEdge().catch((error) => { console.error(error instanceof Error ? error.message : "control edge failed"); process.exitCode = 1; });
