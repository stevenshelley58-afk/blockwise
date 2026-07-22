import { buildOpenRouterHeaders } from "@/lib/ai/openrouter-client";
import { executeRefreshPostcode as executeSharedRefreshPostcode } from "@/lib/operator/postcode-refresh";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Conversational operator assistant for the Hermes research engine.
 *
 * This replaces the previous stub (which ignored the operator's question and
 * returned a canned status string). It runs a real tool-calling loop against
 * OpenRouter: read tools execute immediately and feed back into the model;
 * action tools (which mutate the live research queue / policies) are NOT
 * executed inline — they are surfaced as a `proposedAction` for explicit
 * operator confirmation, matching the "Operator actions require confirmation"
 * contract in the UI. On confirmation the route re-invokes this module with
 * `confirm` set and the action is executed via the same registry.
 *
 * All DB access uses the service-role client (auth is enforced upstream by
 * requireOperator). No location-based Meta discovery is ever triggered.
 */

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL =
  process.env.OPERATOR_ASSISTANT_MODEL ??
  process.env.BLOCKWISE_OPENROUTER_TEXT_MODEL ??
  "openai/gpt-5.5";
const MAX_ITERATIONS = 6;

type ResearchClient = ReturnType<ReturnType<typeof createSupabaseServiceClient>["schema"]>;

export type OperatorChatMessage = { role: "user" | "assistant"; content: string };

export type OperatorActionKind = "refresh_postcode" | "collect_ads_for_page" | "set_kill_switch";

export type OperatorProposedAction = {
  kind: OperatorActionKind;
  params: Record<string, unknown>;
  label: string;
  summary: string;
};

export type OperatorChatResult = {
  answer: string;
  proposedAction?: OperatorProposedAction;
};

type OperatorContext = { email: string };

type OrToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OrTextMessage = { role: "system" | "user" | "assistant"; content: string };
type OrAssistantToolMessage = { role: "assistant"; content: string; tool_calls: OrToolCall[] };
type OrToolResultMessage = { role: "tool"; tool_call_id: string; content: string };
type OrMessage = OrTextMessage | OrAssistantToolMessage | OrToolResultMessage;
type OrAssistantMessage = { content?: string | null; tool_calls?: OrToolCall[] };
type OrResponse = { choices?: Array<{ message?: OrAssistantMessage }>; error?: { message?: string } };

const ACTION_TOOLS = new Set<string>(["refresh_postcode", "collect_ads_for_page", "set_kill_switch"]);

const SYSTEM_PROMPT = `You are the Blockwise operator assistant for the Hermes real-estate ad-research engine.
You are talking to a trusted operator. Be concise, direct, and conversational — like a knowledgeable teammate, not a form.

ABOUT HERMES
Hermes is a Node.js daemon (on a VPS) that polls the Supabase research.work_queue and runs a 5-stage pipeline per postcode:
1. blockwise-agent-census  - finds real-estate agents/agencies for a postcode (only step allowed to mark is_real_estate=true)
2. blockwise-page-resolver  - resolves a verified agent/agency to its Meta advertiser page
3. blockwise-ad-collector   - collects ads for a resolved advertiser page
4. blockwise-media-collector- downloads ad images/videos
5. blockwise-ad-classifier  - classifies each creative
A kill-switch toggles research.refresh_policies.active to pause/resume all scheduled scraping.

HOW TO BEHAVE
- Use the read tools to answer questions with real, current numbers. Never invent figures.
- When the operator asks you to DO something that changes the system (refresh a postcode, collect ads for a page, pause/resume), call the matching action tool. Action tools are not executed immediately — they are shown to the operator for one-click confirmation, so call exactly one action tool when ready and briefly explain what it will do.
- To collect ads you need an advertiser_page_id. If the operator names an agency/agent, use find_page first to resolve it, then propose collect_ads_for_page with that id.
- Postcodes are 4 digits. States: WA, NSW, VIC, QLD, SA, TAS, ACT, NT.

GUARDRAILS (never violate)
- Never trigger location/suburb/postcode-based Meta Ad Library discovery. Ad collection only ever runs for pages already resolved through the census -> resolver chain.
- Only blockwise-agent-census may set is_real_estate=true.
- If a request would violate these rules, explain why instead of doing it.`;

const TOOL_SPECS = [
  {
    type: "function",
    function: {
      name: "get_status",
      description:
        "Overall health of the research engine: work-queue counts by status, seconds since the last ingest event (heartbeat), 24h collector spend, and refresh-policy active/paused counts. Call this for 'how is it going / status / is it running' questions.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_jobs",
      description: "Recent work-queue jobs, newest first. Use to inspect failures/blocks or what a stage is doing.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "claimed", "blocked", "failed", "complete"] },
          jobType: { type: "string", description: "e.g. blockwise-ad-collector" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_coverage",
      description: "Postcode coverage rows (score, active ads, advertiser pages, health). Use for coverage / gap questions.",
      parameters: {
        type: "object",
        properties: {
          postcode: { type: "string" },
          state: { type: "string" },
          onlyGaps: { type: "boolean", description: "Only rows with zero active ads / low score." },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_defects",
      description: "Open coverage defects (gaps the engine has flagged for attention).",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 40 } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_page",
      description:
        "Resolve an agency or agent name to its advertiser page(s). Returns advertiser_page_id (needed for collect_ads_for_page), page name, Meta page id and status.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Agency or agent name (partial ok)." },
          limit: { type: "integer", minimum: 1, maximum: 10 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "refresh_postcode",
      description: "ACTION (needs confirmation): queue an immediate census refresh for a postcode.",
      parameters: {
        type: "object",
        properties: { postcode: { type: "string", description: "4-digit postcode." } },
        required: ["postcode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "collect_ads_for_page",
      description: "ACTION (needs confirmation): queue an ad-collection run for a resolved advertiser page.",
      parameters: {
        type: "object",
        properties: { advertiserPageId: { type: "string", description: "research.advertiser_pages.id (uuid)." } },
        required: ["advertiserPageId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_kill_switch",
      description: "ACTION (needs confirmation): pause (true) or resume (false) ALL scheduled scraping.",
      parameters: {
        type: "object",
        properties: { paused: { type: "boolean" } },
        required: ["paused"],
        additionalProperties: false,
      },
    },
  },
] as const;

function researchClient(): ResearchClient {
  return createSupabaseServiceClient().schema("research");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(1, Math.trunc(n)), max);
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function now(): string {
  return new Date().toISOString();
}

// ---------- read tools ----------

async function statusCount(research: ResearchClient, status: string): Promise<number> {
  const { count } = await research.from("work_queue").select("id", { count: "exact", head: true }).eq("status", status);
  return count ?? 0;
}

async function getStatus(research: ResearchClient): Promise<string> {
  const [pending, claimed, blocked, failed, lastEvent, policies, spendRows] = await Promise.all([
    statusCount(research, "pending"),
    statusCount(research, "claimed"),
    statusCount(research, "blocked"),
    statusCount(research, "failed"),
    research.from("ingest_events").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    research.from("refresh_policies").select("active,next_refresh_at").limit(5000),
    research.from("ad_fetch_runs").select("cost_usd,started_at").gte("started_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()).limit(2000),
  ]);

  const lastCreated = (lastEvent.data as { created_at?: string } | null)?.created_at ?? null;
  const heartbeatSeconds = lastCreated ? Math.max(0, Math.round((Date.now() - new Date(lastCreated).getTime()) / 1000)) : null;
  const policyRows = (policies.data ?? []) as { active: boolean; next_refresh_at: string | null }[];
  const activePolicies = policyRows.filter((row) => row.active).length;
  const nextRefresh = policyRows
    .filter((row) => row.active && row.next_refresh_at)
    .map((row) => row.next_refresh_at as string)
    .sort()[0] ?? null;
  const spend24h = ((spendRows.data ?? []) as { cost_usd: number | null }[]).reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0);

  return JSON.stringify({
    queue: { pending, claimed, blocked, failed },
    heartbeat_seconds_since_last_event: heartbeatSeconds,
    daemon_alive: heartbeatSeconds !== null && heartbeatSeconds < 600,
    refresh_policies: { total: policyRows.length, active: activePolicies, paused: policyRows.length - activePolicies, all_paused: policyRows.length > 0 && activePolicies === 0 },
    next_scheduled_refresh: nextRefresh,
    spend_24h_usd: Math.round(spend24h * 100) / 100,
  });
}

async function listJobs(research: ResearchClient, args: Record<string, unknown>): Promise<string> {
  const status = asString(args.status);
  const jobType = asString(args.jobType);
  const limit = asInt(args.limit, 15, 50);
  let query = research
    .from("v_operator_work_queue_diagnostics")
    .select("id,job_type,status,attempts,max_attempts,blocked_reason,last_error,updated_at,is_stale_claim")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status);
  if (jobType) query = query.eq("job_type", jobType);
  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    job_type: row.job_type,
    status: row.status,
    attempts: `${row.attempts ?? 0}/${row.max_attempts ?? 0}`,
    stale: Boolean(row.is_stale_claim),
    blocked_reason: row.blocked_reason ?? null,
    last_error: typeof row.last_error === "string" ? row.last_error.slice(0, 200) : null,
    updated_at: row.updated_at,
  }));
  return JSON.stringify({ count: rows.length, jobs: rows });
}

async function getCoverage(research: ResearchClient, args: Record<string, unknown>): Promise<string> {
  const postcode = asString(args.postcode);
  const state = asString(args.state);
  const onlyGaps = args.onlyGaps === true;
  const limit = asInt(args.limit, 15, 50);
  let query = research
    .from("v_coverage_status")
    .select("postcode,state,last_audit_score,live_active_ads,live_advertiser_pages,health,next_refresh_at,last_refreshed_at,policy_active")
    .order("priority")
    .order("postcode")
    .limit(onlyGaps ? 500 : limit);
  if (postcode) query = query.eq("postcode", postcode);
  if (state) query = query.eq("state", state.toUpperCase());
  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  let rows = (data ?? []) as Record<string, unknown>[];
  if (onlyGaps) {
    rows = rows.filter((row) => Number(row.live_active_ads ?? 0) === 0).slice(0, limit);
  }
  const mapped = rows.map((row) => ({
    postcode: row.postcode,
    state: row.state,
    score: row.last_audit_score ?? null,
    active_ads: row.live_active_ads ?? 0,
    advertiser_pages: row.live_advertiser_pages ?? 0,
    health: row.health,
    next_refresh_at: row.next_refresh_at,
    last_refreshed_at: row.last_refreshed_at,
    policy_active: row.policy_active,
  }));
  return JSON.stringify({ count: mapped.length, coverage: mapped });
}

async function listDefects(research: ResearchClient, args: Record<string, unknown>): Promise<string> {
  const limit = asInt(args.limit, 15, 40);
  const { data, error } = await research
    .from("coverage_defects")
    .select("id,postcode,state,notes,status,created_at")
    .in("status", ["open", "investigating", "blocked"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return JSON.stringify({ error: error.message });
  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    postcode: row.postcode ?? null,
    state: row.state ?? null,
    status: row.status,
    notes: typeof row.notes === "string" ? row.notes.slice(0, 200) : null,
    created_at: row.created_at,
  }));
  return JSON.stringify({ count: rows.length, defects: rows });
}

async function findPage(research: ResearchClient, args: Record<string, unknown>): Promise<string> {
  const query = asString(args.query);
  if (!query) return JSON.stringify({ error: "query is required" });
  const limit = asInt(args.limit, 5, 10);
  const term = `%${query}%`;

  const [agencies, agents, pagesByName] = await Promise.all([
    research.from("agencies").select("id,name,state,primary_postcode,is_real_estate,status").ilike("name", term).limit(limit),
    research.from("agents").select("id,full_name,agency_id,state,primary_postcode,status").ilike("full_name", term).limit(limit),
    research.from("advertiser_pages").select("id,page_name,page_id,status,agency_id,agent_id").ilike("page_name", term).limit(limit),
  ]);

  const agencyIds = ((agencies.data ?? []) as { id: string }[]).map((row) => row.id);
  const agentIds = ((agents.data ?? []) as { id: string }[]).map((row) => row.id);

  const pageMatches = new Map<string, Record<string, unknown>>();
  for (const page of (pagesByName.data ?? []) as Record<string, unknown>[]) {
    pageMatches.set(String(page.id), page);
  }
  if (agencyIds.length > 0) {
    const { data } = await research.from("advertiser_pages").select("id,page_name,page_id,status,agency_id,agent_id").in("agency_id", agencyIds).limit(20);
    for (const page of (data ?? []) as Record<string, unknown>[]) pageMatches.set(String(page.id), page);
  }
  if (agentIds.length > 0) {
    const { data } = await research.from("advertiser_pages").select("id,page_name,page_id,status,agency_id,agent_id").in("agent_id", agentIds).limit(20);
    for (const page of (data ?? []) as Record<string, unknown>[]) pageMatches.set(String(page.id), page);
  }

  const pages = Array.from(pageMatches.values()).map((page) => ({
    advertiser_page_id: page.id,
    page_name: page.page_name ?? null,
    meta_page_id: page.page_id ?? null,
    status: page.status,
    collectable: Boolean(page.page_id) && String(page.status ?? "").includes("resolved"),
  }));

  return JSON.stringify({
    agencies: ((agencies.data ?? []) as Record<string, unknown>[]).map((row) => ({ id: row.id, name: row.name, state: row.state, postcode: row.primary_postcode, is_real_estate: row.is_real_estate, status: row.status })),
    agents: ((agents.data ?? []) as Record<string, unknown>[]).map((row) => ({ id: row.id, name: row.full_name, state: row.state, postcode: row.primary_postcode, status: row.status })),
    advertiser_pages: pages,
  });
}

async function executeReadTool(research: ResearchClient, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "get_status":
      return getStatus(research);
    case "list_jobs":
      return listJobs(research, args);
    case "get_coverage":
      return getCoverage(research, args);
    case "list_defects":
      return listDefects(research, args);
    case "find_page":
      return findPage(research, args);
    default:
      return JSON.stringify({ error: `unknown tool ${name}` });
  }
}

// ---------- action proposal + execution ----------

async function buildProposal(
  research: ResearchClient,
  name: string,
  args: Record<string, unknown>,
): Promise<OperatorProposedAction | { error: string }> {
  if (name === "refresh_postcode") {
    const postcode = asString(args.postcode);
    if (!postcode || !/^\d{4}$/u.test(postcode)) return { error: "I need a valid 4-digit postcode to refresh." };
    return {
      kind: "refresh_postcode",
      params: { postcode },
      label: `Refresh postcode ${postcode}`,
      summary: `Queue an immediate census refresh for postcode ${postcode}. Hermes will re-scan the agent roster and continue the pipeline for any new pages.`,
    };
  }
  if (name === "collect_ads_for_page") {
    const advertiserPageId = asString(args.advertiserPageId);
    if (!advertiserPageId) return { error: "I need an advertiser_page_id. Tell me the agency/agent and I'll look it up first." };
    const { data } = await research.from("advertiser_pages").select("id,page_name,page_id,status").eq("id", advertiserPageId).maybeSingle();
    const page = data as { id: string; page_name: string | null; page_id: string | null; status: string | null } | null;
    if (!page) return { error: `No advertiser page found with id ${advertiserPageId}.` };
    if (!page.page_id) return { error: `${page.page_name ?? "That page"} has no resolved Meta page id yet, so ads can't be collected. It needs the page-resolver step first.` };
    return {
      kind: "collect_ads_for_page",
      params: { advertiserPageId },
      label: `Collect ads for ${page.page_name ?? advertiserPageId}`,
      summary: `Queue a Meta ad-collection run for ${page.page_name ?? "this page"} (Meta page ${page.page_id}, status ${page.status ?? "unknown"}).`,
    };
  }
  if (name === "set_kill_switch") {
    const paused = args.paused === true || args.paused === "true";
    return {
      kind: "set_kill_switch",
      params: { paused },
      label: paused ? "Pause all scheduled scraping" : "Resume all scheduled scraping",
      summary: paused
        ? "Set every refresh policy to inactive. Hermes finishes in-flight jobs but starts no new scheduled work. Manual refreshes still work."
        : "Re-activate every refresh policy so Hermes resumes scheduled scraping.",
    };
  }
  return { error: `Unknown action ${name}.` };
}

async function recordDecision(
  research: ResearchClient,
  email: string,
  subjectType: string,
  subjectId: string,
  decision: Record<string, unknown>,
  rationale: string,
): Promise<void> {
  try {
    await research.from("agent_decisions").insert({
      decision_type: "operator_chat",
      subject_type: subjectType,
      subject_id: subjectId,
      decision: { ...decision, operator: email },
      rationale,
      confidence: 100,
      hermes_skill: "blockwise-operator-chat",
    });
  } catch {
    // Audit logging is best-effort; never fail the operator action on it.
  }
}

async function executeRefreshPostcodeAction(research: ResearchClient, postcode: string, email: string): Promise<string> {
  if (!/^\d{4}$/u.test(postcode)) return "That isn't a valid 4-digit postcode.";
  const result = await executeSharedRefreshPostcode(research, postcode, email);
  await recordDecision(
    research,
    email,
    "postcode",
    postcode,
    {
      action: "refresh_postcode",
      postcode: result.postcode,
      state: result.state,
      source_backed: result.sourceBacked,
      queued: result.queued,
    },
    result.queued
      ? "Operator chat queued a source-backed postcode census refresh."
      : "Operator chat recorded an unsupported postcode refresh request.",
  );
  return result.message;
}

async function executeCollectAdsForPage(research: ResearchClient, advertiserPageId: string, email: string): Promise<string> {
  const { data } = await research.from("advertiser_pages").select("id,page_id,page_name,resolution_decision_id,status").eq("id", advertiserPageId).maybeSingle();
  const page = data as { id: string; page_id: string | null; page_name: string | null; resolution_decision_id: string | null; status: string | null } | null;
  if (!page) return `No advertiser page found with id ${advertiserPageId}.`;
  if (!page.page_id) return `${page.page_name ?? "That page"} has no resolved Meta page id yet, so ad collection can't run.`;

  await research.from("work_queue").insert({
    queue_name: "research",
    job_type: "blockwise-ad-collector",
    dedupe_key: `manual:ad-collector:${page.id}:${Date.now()}`,
    advertiser_page_id: page.id,
    priority: 1,
    payload: {
      advertiserPageId: page.id,
      metaPageId: page.page_id,
      resolverDecisionId: page.resolution_decision_id,
      realEstateGate: { verified: true, verifiedBySkill: "blockwise-agent-census", decisionId: page.resolution_decision_id, sourceDocumentIds: [], verifiedAt: now() },
      country: "AU",
      activeStatus: "all",
    },
    status: "pending",
    max_attempts: 3,
  });
  await recordDecision(research, email, "advertiser_page", page.id, { action: "collect_ads_for_page", meta_page_id: page.page_id }, "Operator chat queued ad collection");
  return `Done — queued an ad-collection run for ${page.page_name ?? "the page"} (Meta page ${page.page_id}). Check back with "list collector jobs" to see it run.`;
}

async function executeKillSwitch(research: ResearchClient, paused: boolean, email: string): Promise<string> {
  const { error } = await research.from("refresh_policies").update({ active: !paused }).neq("postcode", "__never__");
  if (error) return `Couldn't change the kill-switch: ${error.message}`;
  await recordDecision(research, email, "operator_query", "kill-switch", { action: "set_kill_switch", paused }, paused ? "Operator chat paused all scheduled scraping" : "Operator chat resumed all scheduled scraping");
  return paused
    ? "Done — paused all scheduled scraping. Every refresh policy is now inactive; in-flight jobs finish but no new scheduled work starts. Tell me to resume when you're ready."
    : "Done — resumed all scheduled scraping. Refresh policies are active again.";
}

async function executeAction(research: ResearchClient, action: OperatorProposedAction, email: string): Promise<string> {
  switch (action.kind) {
    case "refresh_postcode":
      return executeRefreshPostcodeAction(research, String(action.params.postcode ?? ""), email);
    case "collect_ads_for_page":
      return executeCollectAdsForPage(research, String(action.params.advertiserPageId ?? ""), email);
    case "set_kill_switch":
      return executeKillSwitch(research, action.params.paused === true, email);
    default:
      return "Unknown action.";
  }
}

// ---------- model loop ----------

async function callOpenRouter(messages: OrMessage[], allowTools: boolean): Promise<OrAssistantMessage> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    temperature: 0.2,
    provider: { require_parameters: true },
  };
  if (allowTools) {
    body.tools = TOOL_SPECS;
    body.tool_choice = "auto";
  }
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: buildOpenRouterHeaders(),
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as OrResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `OpenRouter request failed with status ${response.status}.`);
  }
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("OpenRouter returned no message.");
  return message;
}

export async function runOperatorAssistant(input: {
  messages: OperatorChatMessage[];
  confirm?: OperatorProposedAction;
  context: OperatorContext;
}): Promise<OperatorChatResult> {
  const research = researchClient();

  if (input.confirm) {
    const answer = await executeAction(research, input.confirm, input.context.email);
    return { answer };
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return {
      answer:
        "I can't reach a model yet — OPENROUTER_API_KEY isn't set in this environment. Add it (and optionally OPERATOR_ASSISTANT_MODEL) and I'll be able to chat and drive Hermes.",
    };
  }

  const conversation: OrMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...input.messages.slice(-12).map((message) => ({ role: message.role, content: message.content })),
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const message = await callOpenRouter(conversation, true);
    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      return { answer: (message.content ?? "").trim() || "Done." };
    }

    conversation.push({ role: "assistant", content: message.content ?? "", tool_calls: toolCalls });

    const actionCall = toolCalls.find((call) => ACTION_TOOLS.has(call.function.name));
    if (actionCall) {
      const proposal = await buildProposal(research, actionCall.function.name, safeParseArgs(actionCall.function.arguments));
      if ("error" in proposal) {
        return { answer: (message.content ?? "").trim() ? `${message.content}\n\n${proposal.error}` : proposal.error };
      }
      const lead = (message.content ?? "").trim();
      return { answer: lead || proposal.summary, proposedAction: proposal };
    }

    for (const call of toolCalls) {
      const result = await executeReadTool(research, call.function.name, safeParseArgs(call.function.arguments));
      conversation.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  const closing = await callOpenRouter(conversation, false);
  return { answer: (closing.content ?? "").trim() || "I pulled the data but couldn't compose a reply — try asking again more specifically." };
}
