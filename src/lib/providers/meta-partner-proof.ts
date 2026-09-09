import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  buildPausedMetaPublishPlan,
  type PublishLoadResult,
} from "../adstudio/publish-adapter.ts";
import {
  createMetaExecutionAdapter,
  type MetaConnectionSetup,
  type MetaPublishControls,
  type MetaPublishPlan,
} from "./meta-execution.ts";
import { fetchEligibleMetaCampaigns } from "./meta-campaigns.ts";
import { fetchMetaLeadFormLeads } from "./meta-leads.ts";
import { resolveMetaPageAccessToken } from "./meta-assets.ts";
import { fetchMetaAdAccounts, fetchMetaInsightRows } from "./meta-reporting.ts";
import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";

/**
 * Step 0 proof tooling for the Meta partner-assisted connection flow.
 *
 * This module powers `scripts/meta/verify-partner-external.mjs`, the go/no-go
 * gate that proves a genuinely external business can share an ad account and
 * Page with Blockwise's Business Portfolio and that one Blockwise system-user
 * token can then run the full disposable product path against them.
 *
 * The live run itself is human-gated (proof_executor + independent
 * proof_reviewer); this module is the tooling they drive. Everything here must
 * stay validatable offline: `--dry-run` replays a committed fixture set
 * through the exact same code path with zero network I/O.
 */

export const PROOF_PERMISSIONS = [
  "ads_read",
  "ads_management",
  "business_management",
  "leads_retrieval",
  "pages_manage_ads",
  "pages_show_list",
  "pages_read_engagement",
] as const;

export const PROOF_EXPIRY_DAYS = 90;

const GRAPH_HOST = "graph.facebook.com";
const DEFAULT_GRAPH_TIMEOUT_MS = 30_000;
const REDACTED = "[REDACTED]";

/** 1x1 transparent PNG used as the disposable proof creative image. */
const PROOF_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export type ProofProbeStatus = "PASS" | "FAIL" | "SKIP";

export type ProofProbeOutcome = {
  id: string;
  label: string;
  status: ProofProbeStatus;
  detail: string;
};

export type ProofCleanupReceipt = {
  objectType: "ad" | "creative" | "adset" | "campaign" | "lead_form";
  hashedId: string;
  action: "deleted" | "archived" | "failed";
  detail: string;
};

export type ProofReceipt = {
  commitSha: string;
  graphVersion: string;
  appId: string;
  appMode: string;
  accessTier: string;
  permissions: string[];
  externalBusinessAttested: true;
  utcStart: string;
  utcEnd: string;
  hashedMetaObjectIds: Record<string, string[]>;
  probeOutcomes: ProofProbeOutcome[];
  cleanupReceipts: ProofCleanupReceipt[];
  fixtureHashes: Record<string, string>;
  expiresAt: string;
  proofExecutor: string;
  proofReviewer: string;
};

export type ProofRunOptions = {
  dryRun: boolean;
  /** Flag-gated disposable product path (create → verify → test lead → report). */
  fullPath?: boolean;
  accessToken: string;
  externalBusinessId: string;
  adAccountId: string;
  pageId: string;
  /** Blockwise's own Business Portfolio ID (META_BUSINESS_ID); null aborts real runs. */
  blockwiseBusinessId: string | null;
  appToken: string | null;
  appId: string;
  graphVersion?: string;
  accessTier: string;
  appMode: string;
  permissions: string[];
  proofExecutor: string;
  proofReviewer: string;
  outputDir: string;
  destinationUrl: string;
  privacyPolicyUrl: string;
  leadWaitSeconds?: number;
  /** Dry-run fixture file (see scripts/meta/fixtures/proof-dry-run.json). */
  fixturesFile?: string | null;
  fetchImpl?: typeof fetch;
  cwd?: string;
  commitSha?: string;
  now?: () => Date;
  transmit?: (line: string) => void;
  writeArtifacts?: boolean;
};

export type ProofRunResult = {
  ok: boolean;
  exitCode: 0 | 1 | 2;
  receipt: ProofReceipt | null;
  probes: ProofProbeOutcome[];
  cleanupReceipts: ProofCleanupReceipt[];
  fixtureFiles: string[];
  errors: string[];
};

export class ProofAbortError extends Error {}

// ---------------------------------------------------------------------------
// Receipt currency (Step 1B will wire this into the partner-starts gate)
// ---------------------------------------------------------------------------

/**
 * A proof receipt is current only until its expiry day ends (UTC). Anything
 * unparseable counts as expired — fail closed.
 */
export function isProofReceiptCurrent(
  receipt: Pick<ProofReceipt, "expiresAt">,
  now: Date = new Date(),
): boolean {
  const raw = receipt.expiresAt?.trim() ?? "";
  if (!raw) return false;
  const boundary = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw;
  const expiryMs = Date.parse(boundary);
  if (!Number.isFinite(expiryMs)) return false;
  return expiryMs >= now.getTime();
}

// ---------------------------------------------------------------------------
// Redaction + hashing
// ---------------------------------------------------------------------------

const TOKEN_LIKE_PATTERNS: RegExp[] = [
  /\bEA[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._|_-]{8,}/gi,
  /\b(?:access_token|input_token)=[^&\s"']+/gi,
];

function redactString(value: string, secrets: string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret && redacted.includes(secret)) {
      redacted = redacted.split(secret).join(REDACTED);
    }
  }
  for (const pattern of TOKEN_LIKE_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  return redacted;
}

/**
 * Remove any token-like string (Meta EAAG… tokens, Bearer headers, token
 * query parameters, plus any explicitly known secrets) from an arbitrary
 * JSON value. Returns a deep-redacted copy; the input is never mutated.
 */
export function redactTokenLike<T>(value: T, secrets: string[] = []): T {
  const known = secrets.filter((secret) => typeof secret === "string" && secret.length > 0);

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return redactString(node, known);
    if (Array.isArray(node)) return node.map(walk);
    if (node instanceof Date) return node.toISOString();
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([key, entry]) => [key, walk(entry)]),
      );
    }
    return node;
  };

  return walk(value) as T;
}

/** SHA-256 of a Meta object ID. Raw IDs must never reach the receipt. */
export function hashMetaId(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed ? createHash("sha256").update(trimmed).digest("hex") : "";
}

// ---------------------------------------------------------------------------
// Graph fetch helpers
// ---------------------------------------------------------------------------

/**
 * Wraps a fetch implementation so that any `access_token` query parameter on a
 * graph.facebook.com request is stripped from the URL and moved into an
 * `Authorization: Bearer` header. Repository read adapters
 * (meta-reporting/meta-campaigns/meta-leads/meta-assets) build tokenized query
 * URLs; this wrapper lets the proof reuse them unchanged while guaranteeing no
 * token ever appears on the wire in a URL (including Meta paging URLs).
 */
export function createBearerEnforcingFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (typeof input === "string" || input instanceof URL) {
      const url = new URL(input.toString());
      if (url.hostname === GRAPH_HOST) {
        const token = url.searchParams.get("access_token");
        if (token) {
          url.searchParams.delete("access_token");
          const headers = new Headers(init?.headers);
          if (!headers.has("authorization")) {
            headers.set("authorization", `Bearer ${token}`);
          }
          return inner(url.toString(), { ...(init ?? {}), headers });
        }
      }
    }
    return inner(input, init);
  };
}

export type DryRunFixture = {
  scenario: {
    externalBusinessId: string;
    blockwiseBusinessId: string;
    adAccountId: string;
    pageId: string;
    instagramActorId: string | null;
    appId: string;
    appTokenAvailable: boolean;
  };
  /** Keys are "METHOD <path>" (no query string, no graph version prefix). */
  routes: Record<string, unknown>;
};

export function loadDryRunFixture(path: string): DryRunFixture {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as DryRunFixture;
}

/** Offline fetch that replays a committed fixture set. Never touches network. */
export function createDryRunFetch(fixture: DryRunFixture): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = new URL(input.toString());
    if (url.protocol !== "https:" || url.hostname !== GRAPH_HOST) {
      throw new Error(`Dry-run fetch refuses non-Graph request: ${url.protocol}//${url.hostname}`);
    }
    // Fixture route keys are version-independent: strip the /v{major}.{minor} prefix.
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const key = `${method} ${path}`;
    const route = fixture.routes[key];
    if (route === undefined) {
      return new Response(
        JSON.stringify({ error: { message: `Dry-run fixture has no route ${key}`, code: 190 } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(route), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

type GraphJsonOptions = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  token: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  graphVersion: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
};

/**
 * Minimal local Graph helper for probes and cleanup that have no repository
 * adapter. HTTPS graph.facebook.com only, Bearer header only, bounded timeout,
 * and it refuses access_token parameters outright. (Exception: /debug_token
 * keeps Meta's mandated input_token query parameter; that value is redacted
 * from every transcript line.)
 */
async function graphJson(options: GraphJsonOptions): Promise<Record<string, unknown>> {
  if (options.params && "access_token" in options.params) {
    throw new Error("graphJson refuses access_token query parameters; use the Bearer header.");
  }
  const url = new URL(`https://${GRAPH_HOST}/${options.graphVersion}${options.path}`);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    url.searchParams.set(key, value);
  }
  if (url.protocol !== "https:" || url.hostname !== GRAPH_HOST) {
    throw new Error(`Refusing non-Graph request: ${url.protocol}//${url.hostname}`);
  }

  const response = await options.fetchImpl(url.toString(), {
    method: options.method,
    headers: {
      authorization: `Bearer ${options.token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_GRAPH_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number };
  };

  if (!response.ok) {
    const detail = payload.error?.error_user_msg ?? payload.error?.message
      ?? `Graph ${options.method} ${options.path} failed with ${response.status}.`;
    const code = payload.error?.code !== undefined
      ? ` (code ${payload.error.code}${payload.error.error_subcode !== undefined ? `/${payload.error.error_subcode}` : ""})`
      : "";
    throw new Error(`${detail}${code}`);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Proof plan (the same OUTCOME_LEADS + HOUSING plan Ad Studio publishes)
// ---------------------------------------------------------------------------

function buildProofPublishState(): PublishLoadResult {
  return {
    ad: {
      id: "proof_ad_1",
      templateId: "proof-disposable-template",
      colourMode: "template",
      metaPrimaryText: "Proof run primary text (disposable).",
      metaHeadline: "Proof run headline",
      metaDescription: "Disposable Step 0 proof creative.",
      metaCta: "LEARN_MORE",
    },
    revision: {
      id: "proof_revision_1",
      revisionNumber: 1,
      documentHash: "proof-document-hash",
      feedPngHash: "proof-feed-hash",
      feedPngPath: "proof/ads/proof_ad_1/feed.png",
      storyPngHash: "proof-story-hash",
      storyPngPath: "proof/ads/proof_ad_1/story.png",
    },
    pack: {
      templateId: "proof-disposable-template",
      metadata: { title: "Step 0 partner proof" },
      publishRequirements: {
        destinationMode: "instant_form",
        requiredCtaTypes: ["LEARN_MORE"],
      },
    } as unknown as PublishLoadResult["pack"],
    form: {
      name: "Step 0 partner proof",
      formType: "higher_intent",
      intro: {
        headline: "Proof run form",
        body: "Disposable Instant Form for the Step 0 proof run.",
      },
      contactFields: [{ type: "email", required: true }],
      customQuestions: [{ type: "short_answer", label: "Proof question (disposable)", required: false }],
      privacy: {
        url: "https://example.com/privacy",
        linkText: "Privacy Policy",
      },
      thankYou: {
        title: "Proof run thank you",
        body: "Disposable thank-you screen.",
        actionType: "visit_website",
      },
    },
    formDraftId: "proof_form_draft_1",
    formRevision: 1,
  };
}

function buildProofControls(input: { destinationUrl: string }): MetaPublishControls {
  return {
    target: { mode: "new_campaign_new_adset" },
    dailyBudgetMinorUnits: 3500,
    newCampaign: {
      objective: "OUTCOME_LEADS",
      specialAdCategories: ["HOUSING"],
      specialAdCategoryCountries: ["AU"],
      budgetMode: "campaign",
    },
    destinationMode: "instant_form",
    destinationUrl: input.destinationUrl,
    variantIds: ["feed", "story"],
    geo: {
      type: "cities",
      locations: [{ key: "perth-6000", name: "Perth", region: "WA" }],
      includeSurroundingSuburbs: true,
    },
    placements: {
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed", "story"],
      instagramPositions: ["stream", "story"],
    },
    schedule: { startTime: null, endTime: null },
  };
}

function buildProofPublishPlan(input: {
  adAccountId: string;
  pageId: string;
  instagramActorId: string | null;
  destinationUrl: string;
  privacyPolicyUrl: string;
}): MetaPublishPlan {
  const setup: MetaConnectionSetup = {
    metaAdAccountId: input.adAccountId,
    pageId: input.pageId,
    instagramActorId: input.instagramActorId,
    pixelId: null,
    leadDestination: { type: "manual", label: "Step 0 proof run (manual review)" },
    privacyPolicyUrl: input.privacyPolicyUrl,
    currency: "AUD",
    timezone: "Australia/Perth",
  };
  const plan = buildPausedMetaPublishPlan({
    adId: "proof_ad_1",
    workspaceId: "proof_workspace",
    connectionId: "proof_connection",
    setup,
    controls: buildProofControls({ destinationUrl: input.destinationUrl }),
    state: buildProofPublishState(),
  });

  // Deviation (documented in the runbook): the proof has no Supabase storage,
  // so the storage→inline asset resolution normally done by
  // resolvePublishCreativeAssets/meta-publish-worker is done in memory here
  // with a disposable 1x1 PNG.
  return {
    ...plan,
    status: "approved",
    creatives: plan.creatives.map((creative) => ({
      ...creative,
      asset: {
        type: "image" as const,
        source: "inline" as const,
        mimeType: "image/png",
        filename: `${creative.localId}.png`,
        bytesBase64: PROOF_PNG_BASE64,
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function utcDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysUtc(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function resolveCommitSha(cwd: string | undefined): Promise<string> {
  const { stdout } = await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: cwd ?? process.cwd() });
  return stdout.trim();
}

function normalizeAdAccountId(value: string): string {
  return value.startsWith("act_") ? value : `act_${value}`;
}

function assertDigits(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ProofAbortError(`${label} must be a numeric Meta ID (received a non-numeric or empty value).`);
  }
  return trimmed;
}

type CreatedObjects = {
  campaignId?: string;
  adSetIds: string[];
  creativeIds: string[];
  adIds: string[];
  leadFormIds: string[];
};

/**
 * Run the full proof: read probes, optional disposable product path, cleanup,
 * receipt + sanitized fixture emission. Network is fully injectable; dry-run
 * mode replays fixtures and performs zero network I/O.
 */
export async function runProof(options: ProofRunOptions): Promise<ProofRunResult> {
  const now = options.now ?? (() => new Date());
  const transmit = options.transmit ?? ((line: string) => console.log(line));
  const graphVersion = options.graphVersion ?? DEFAULT_META_GRAPH_VERSION;
  const errors: string[] = [];
  const probes: ProofProbeOutcome[] = [];
  const cleanupReceipts: ProofCleanupReceipt[] = [];
  const fixtureFiles: string[] = [];
  const created: CreatedObjects = { adSetIds: [], creativeIds: [], adIds: [], leadFormIds: [] };
  const utcStart = now().toISOString();
  const secretValues: string[] = [];

  const recordProbe = (id: string, label: string, status: ProofProbeStatus, detail: string) => {
    probes.push({ id, label, status, detail });
    transmit(`[${status}] ${label}: ${redactTokenLike(detail, secretValues)}`);
  };
  const transmitJson = (label: string, payload: unknown) => {
    transmit(`${label} ${JSON.stringify(redactTokenLike(payload, secretValues))}`);
  };

  // ---- Validation (fail closed before any I/O) -----------------------------
  if (!options.dryRun && (!options.accessToken || options.accessToken.startsWith("PLACEHOLDER"))) {
    throw new ProofAbortError("A real system-user token is required on stdin (empty or PLACEHOLDER tokens are refused).");
  }
  const externalBusinessId = options.dryRun && !options.externalBusinessId.trim()
    ? ""
    : assertDigits(options.externalBusinessId, "--external-business-id");
  const pageId = options.dryRun && !options.pageId.trim() ? "" : assertDigits(options.pageId, "--page-id");
  const adAccountId = options.dryRun && !options.adAccountId.trim()
    ? ""
    : normalizeAdAccountId(options.adAccountId.trim());
  if (adAccountId && !/^act_\d+$/.test(adAccountId)) {
    throw new ProofAbortError("--ad-account-id must be an act_<digits> ad account ID.");
  }
  if (!options.proofExecutor.trim() || !options.proofReviewer.trim()) {
    throw new ProofAbortError("Both --proof-executor and --proof-reviewer are required.");
  }
  if (options.proofExecutor.trim() === options.proofReviewer.trim()) {
    throw new ProofAbortError("The proof reviewer must differ from the proof executor.");
  }
  if (options.permissions.length === 0) {
    throw new ProofAbortError("--permissions must list at least one granted permission.");
  }
  if (!options.accessTier.trim() || !options.appMode.trim()) {
    throw new ProofAbortError("--access-tier and --app-mode are required for the receipt.");
  }

  const blockwiseBusinessId = options.blockwiseBusinessId?.trim() || null;
  if (!options.dryRun && !blockwiseBusinessId) {
    throw new ProofAbortError(
      "META_BUSINESS_ID is not configured; the external-business check cannot be performed. Configure it before the live proof run.",
    );
  }

  // Dry-run scenario values (fixture-driven) keep the code path identical.
  const fixture = options.dryRun
    ? loadDryRunFixture(options.fixturesFile ?? resolve("scripts/meta/fixtures/proof-dry-run.json"))
    : null;
  const scenario = fixture?.scenario ?? null;
  const effectiveBlockwiseBusinessId = blockwiseBusinessId ?? scenario?.blockwiseBusinessId ?? null;
  const effectiveExternalBusinessId = externalBusinessId || assertDigits(scenario?.externalBusinessId ?? "", "fixture externalBusinessId");
  const effectiveAdAccountId = adAccountId || normalizeAdAccountId(scenario?.adAccountId ?? "");
  const effectivePageId = pageId || assertDigits(scenario?.pageId ?? "", "fixture pageId");
  const appId = options.appId.trim() || scenario?.appId || "";
  const appToken = options.appToken
    ?? (options.dryRun && scenario?.appTokenAvailable ? "EAAG_dryrun_app_token_0123456789" : null);

  secretValues.push(options.accessToken, appToken ?? "");

  // Fetch wiring: dry-run replays fixtures; every request (including repo
  // adapters that tokenize query URLs) is forced through Bearer-header
  // enforcement. The global fetch is swapped for the duration of the run so
  // adapters using bare fetch are covered too, then restored.
  const outerFetch = options.fetchImpl ?? (fixture ? createDryRunFetch(fixture) : fetch);
  const proofFetch = createBearerEnforcingFetch(outerFetch);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = proofFetch;

  let pageToken: string | null = null;
  let instagramActorId: string | null = null;
  let ok = true;
  let cleanupRan = false;

  try {
    // ---- Probe (a): token identity -----------------------------------------
    try {
      const me = await graphJson({
        method: "GET",
        path: "/me",
        token: options.accessToken,
        params: { fields: "id,name" },
        graphVersion,
        fetchImpl: proofFetch,
      });
      transmitJson("probe/token-identity/me:", me);
      if (appToken) {
        // Meta mandates input_token as a query parameter for /debug_token; the
        // value is redacted from every transcript line and never logged raw.
        const debug = await graphJson({
          method: "GET",
          path: "/debug_token",
          token: appToken,
          params: { input_token: options.accessToken },
          graphVersion,
          fetchImpl: proofFetch,
        });
        transmitJson("probe/token-identity/debug_token:", debug);
        recordProbe("token_identity", "Token identity (/me + debug_token)", "PASS", "Token identity and token metadata resolved.");
      } else {
        recordProbe(
          "token_identity",
          "Token identity (/me + debug_token)",
          "SKIP",
          "No app token available (META_APP_ID/META_APP_SECRET unset); /me succeeded, debug_token skipped cleanly.",
        );
      }
    } catch (error) {
      recordProbe("token_identity", "Token identity (/me + debug_token)", "FAIL", error instanceof Error ? error.message : "unknown error");
      errors.push("Token identity probe failed.");
      ok = false;
    }

    // ---- Probe (b): external ad account read + external-business enforcement
    try {
      const accounts = await fetchMetaAdAccounts(options.accessToken);
      const listed = accounts.find((account) => account.id === effectiveAdAccountId);
      if (!listed) {
        throw new Error(`Ad account ${effectiveAdAccountId} is not visible to the system token; the share has not landed.`);
      }
      const accountBusinessId = listed.businessId ?? null;
      if (!accountBusinessId) {
        throw new Error("The ad account response did not include business.id; the external-business check cannot be performed.");
      }
      if (effectiveBlockwiseBusinessId && accountBusinessId === effectiveBlockwiseBusinessId) {
        throw new ProofAbortError("The probed ad account belongs to Blockwise's own Business Portfolio; refusing to run against a Blockwise-owned fixture.");
      }
      if (accountBusinessId !== effectiveExternalBusinessId) {
        throw new ProofAbortError("The probed ad account's business does not match the attested external Business Portfolio ID.");
      }
      transmitJson("probe/ad-account-read:", {
        id: hashMetaId(listed.id),
        name: "External ad account",
        currency: listed.currency ?? "",
        timezone: listed.timezone ?? "",
        accountStatus: listed.isActive ? "active" : "not_active",
        businessId: hashMetaId(accountBusinessId),
      });
      recordProbe(
        "ad_account_read",
        "External ad account read (listing + business check)",
        listed.isActive ? "PASS" : "FAIL",
        listed.isActive
          ? "Account visible, active, and owned by the attested external business."
          : "Account is visible but not active.",
      );
      if (!listed.isActive) ok = false;
    } catch (error) {
      recordProbe("ad_account_read", "External ad account read (listing + business check)", "FAIL", error instanceof Error ? error.message : "unknown error");
      errors.push("External ad account probe failed.");
      ok = false;
      if (error instanceof ProofAbortError) throw error;
    }

    // ---- Probe (c): Page access-token resolution ----------------------------
    try {
      pageToken = await resolveMetaPageAccessToken({
        accessToken: options.accessToken,
        pageId: effectivePageId,
        fetchImpl: proofFetch,
      });
      secretValues.push(pageToken);
      recordProbe("page_token_resolution", "Page access-token resolution", "PASS", "Page token resolved transiently; never printed or persisted.");
    } catch (error) {
      recordProbe("page_token_resolution", "Page access-token resolution", "FAIL", error instanceof Error ? error.message : "unknown error");
      errors.push("Page token resolution failed.");
      ok = false;
    }

    // ---- Probe (d): Page-linked Instagram discovery -------------------------
    try {
      if (!pageToken) throw new Error("Page token unavailable; Instagram discovery cannot run.");
      const page = await graphJson({
        method: "GET",
        path: `/${effectivePageId}`,
        token: pageToken,
        params: { fields: "id,name,instagram_business_account{id,username}" },
        graphVersion,
        fetchImpl: proofFetch,
      });
      transmitJson("probe/instagram-discovery:", {
        pageId: hashMetaId(effectivePageId),
        instagram_business_account: page.instagram_business_account ?? null,
      });
      const instagram = page.instagram_business_account as { id?: string } | null | undefined;
      if (instagram?.id) {
        instagramActorId = instagram.id;
        secretValues.push(instagramActorId);
        recordProbe(
          "instagram_discovery",
          "Page-linked Instagram discovery",
          "PASS",
          "Instagram business account is linked to the shared Page; customers do NOT need to share Instagram separately.",
        );
      } else {
        recordProbe(
          "instagram_discovery",
          "Page-linked Instagram discovery",
          "FAIL",
          "No instagram_business_account on the shared Page. DECISION: customers must share Instagram as a separate asset (or run without an Instagram identity).",
        );
      }
    } catch (error) {
      recordProbe("instagram_discovery", "Page-linked Instagram discovery", "FAIL", error instanceof Error ? error.message : "unknown error");
    }

    // ---- Probe (e): campaign listing on the external ad account -------------
    try {
      const campaigns = await fetchEligibleMetaCampaigns({
        accessToken: options.accessToken,
        accountId: effectiveAdAccountId,
        fetchImpl: proofFetch,
      });
      transmitJson("probe/campaign-listing:", {
        count: campaigns.length,
        campaigns: campaigns.map((campaign) => ({ id: hashMetaId(campaign.id), status: campaign.status })),
      });
      recordProbe("campaign_listing", "Campaign listing on external ad account", "PASS", `Listed ${campaigns.length} eligible campaign(s).`);
    } catch (error) {
      recordProbe("campaign_listing", "Campaign listing on external ad account", "FAIL", error instanceof Error ? error.message : "unknown error");
      errors.push("Campaign listing probe failed.");
      ok = false;
    }

    // ---- Probe (f): Insights/reporting read ---------------------------------
    const today = utcDateStamp(now());
    try {
      const rows = await fetchMetaInsightRows({
        accessToken: options.accessToken,
        accountId: effectiveAdAccountId,
        since: today,
        until: today,
      });
      transmitJson("probe/insights:", {
        rows: rows.map((row) => ({ ad_id: hashMetaId(row.ad_id ?? ""), spend: row.spend ?? "0", impressions: row.impressions ?? "0" })),
      });
      recordProbe("insights_read", "Insights/reporting read", "PASS", `Read ${rows.length} insight row(s) for today.`);
    } catch (error) {
      recordProbe("insights_read", "Insights/reporting read", "FAIL", error instanceof Error ? error.message : "unknown error");
      errors.push("Insights probe failed.");
      ok = false;
    }

    // ---- Full disposable product path (flag-gated) --------------------------
    let publishResultStatus: string | null = null;
    let retrievedLeadHash = "";
    if (options.fullPath === true) {
      try {
        if (!pageToken) throw new Error("Page token unavailable; the full product path requires the Page as ad identity.");
        const plan = buildProofPublishPlan({
          adAccountId: effectiveAdAccountId,
          pageId: effectivePageId,
          instagramActorId,
          destinationUrl: options.destinationUrl,
          privacyPolicyUrl: options.privacyPolicyUrl,
        });
        const adapter = createMetaExecutionAdapter("marketing_api");
        const result = await adapter.publish(plan, {
          accessToken: options.accessToken,
          pageAccessToken: pageToken,
          graphVersion,
          fetchImpl: proofFetch,
        });
        publishResultStatus = result.status;
        if (result.status !== "paused_live") {
          throw new Error(result.lastError ?? "Meta publish execution did not reach paused_live.");
        }

        created.campaignId = result.reconciledObjects.ownedCampaignId ?? result.reconciledObjects.campaignId;
        created.adSetIds = Object.values(result.reconciledObjects.ownedAdSetIds ?? result.reconciledObjects.adSetIds ?? {});
        created.creativeIds = Object.values(result.reconciledObjects.creativeIds ?? {});
        created.adIds = Object.values(result.reconciledObjects.ownedAdIds ?? result.reconciledObjects.adIds ?? {});
        created.leadFormIds = Object.values(result.reconciledObjects.leadFormIds ?? {});

        // Fail hard if anything came back non-PAUSED.
        const statuses = result.reconciledObjects.objectStatuses ?? {};
        const nonPaused: string[] = [];
        if (statuses.campaign && !isPausedStatus(statuses.campaign)) nonPaused.push(`campaign ${hashMetaId(statuses.campaign.id)}`);
        for (const [localId, status] of Object.entries(statuses.adSets ?? {})) {
          if (!isPausedStatus(status)) nonPaused.push(`adset ${localId} ${hashMetaId(status.id)}`);
        }
        for (const [localId, status] of Object.entries(statuses.ads ?? {})) {
          if (!isPausedStatus(status)) nonPaused.push(`ad ${localId} ${hashMetaId(status.id)}`);
        }
        if (nonPaused.length > 0) {
          throw new Error(`Created Meta objects are not PAUSED: ${nonPaused.join(", ")}`);
        }

        // Read every object back and verify ownership + PAUSED status.
        await verifyCreatedObjects({
          accessToken: options.accessToken,
          pageToken,
          adAccountId: effectiveAdAccountId,
          pageId: effectivePageId,
          created,
          graphVersion,
          fetchImpl: proofFetch,
          transmitJson,
        });
        recordProbe("publish_path", "Full disposable product path (create + read-back)", "PASS", "Campaign, ad sets, creatives, ads and Instant Form created PAUSED, read back, and ownership-verified.");

        // Synthetic test lead via Meta's approved Lead Ads testing path.
        retrievedLeadHash = await runTestLeadStep({
          accessToken: pageToken,
          formIds: created.leadFormIds,
          leadWaitSeconds: options.leadWaitSeconds ?? 300,
          graphVersion,
          now,
          transmit,
          transmitJson,
          recordProbe,
          secretValues,
          fetchImpl: proofFetch,
        });

        // Reporting read for the created objects.
        for (const adId of created.adIds) {
          const insights = await graphJson({
            method: "GET",
            path: `/${adId}/insights`,
            token: options.accessToken,
            params: { fields: "impressions,spend,clicks" },
            graphVersion,
            fetchImpl: proofFetch,
          });
          transmitJson(`probe/created-object-insights/${hashMetaId(adId)}:`, insights);
        }
        recordProbe("created_object_reporting", "Reporting read for created objects", "PASS", `Read insights for ${created.adIds.length} created ad(s).`);
      } catch (error) {
        recordProbe("publish_path", "Full disposable product path (create + read-back)", "FAIL", error instanceof Error ? error.message : "unknown error");
        errors.push("Full product path failed.");
        ok = false;
      }
    }

    // ---- Cleanup (always, before the receipt so exit codes are accurate) ----
    cleanupRan = true;
    cleanupReceipts.push(...await cleanupCreatedObjects({
      accessToken: options.accessToken,
      pageToken,
      created,
      graphVersion,
      fetchImpl: proofFetch,
      transmit,
      secretValues,
    }));
    const cleanupFailed = cleanupReceipts.some((receipt) => receipt.action === "failed");

    // ---- Receipt ------------------------------------------------------------
    const utcEnd = now().toISOString();
    const runOk = ok && !cleanupFailed;
    let receipt: ProofReceipt | null = null;

    if (runOk) {
      const commitSha = options.commitSha ?? await resolveCommitSha(options.cwd);
      receipt = {
        commitSha,
        graphVersion,
        appId,
        appMode: options.appMode.trim(),
        accessTier: options.accessTier.trim(),
        permissions: [...options.permissions],
        externalBusinessAttested: true,
        utcStart,
        utcEnd,
        hashedMetaObjectIds: {
          externalAdAccount: [hashMetaId(effectiveAdAccountId)],
          externalPage: [hashMetaId(effectivePageId)],
          campaign: created.campaignId ? [hashMetaId(created.campaignId)] : [],
          adSets: created.adSetIds.map(hashMetaId),
          creatives: created.creativeIds.map(hashMetaId),
          ads: created.adIds.map(hashMetaId),
          leadForms: created.leadFormIds.map(hashMetaId),
        },
        probeOutcomes: probes,
        cleanupReceipts,
        fixtureHashes: {},
        expiresAt: addDaysUtc(now(), PROOF_EXPIRY_DAYS),
        proofExecutor: options.proofExecutor.trim(),
        proofReviewer: options.proofReviewer.trim(),
      };

      if (options.writeArtifacts !== false) {
        const fixtures = buildSanitizedFixtures({
          adAccountId: effectiveAdAccountId,
          pageId: effectivePageId,
          instagramActorId,
          created,
          publishResultStatus,
          retrievedLeadHash,
        });
        const outDir = resolve(options.outputDir);
        mkdirSync(outDir, { recursive: true });
        for (const [name, payload] of Object.entries(fixtures)) {
          const serialized = `${JSON.stringify(payload, null, 2)}\n`;
          const filePath = join(outDir, name);
          writeFileSync(filePath, serialized);
          fixtureFiles.push(filePath);
          receipt.fixtureHashes[name] = createHash("sha256").update(serialized).digest("hex");
        }
        const receiptPath = join(outDir, "receipt.json");
        writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
        fixtureFiles.push(receiptPath);
        transmit(`Receipt written: ${receiptPath}`);
      }
    }

    const exitCode: 0 | 1 | 2 = runOk ? 0 : (cleanupFailed ? 2 : 1);
    return { ok: runOk, exitCode, receipt, probes, cleanupReceipts, fixtureFiles, errors };
  } finally {
    globalThis.fetch = originalFetch;
    // Safety net: if the happy-path cleanup never ran (abort/throw), clean up
    // whatever was created so no Meta object is ever left behind silently.
    if (!cleanupRan) {
      const remaining = await cleanupCreatedObjects({
        accessToken: options.accessToken,
        pageToken,
        created,
        graphVersion,
        fetchImpl: proofFetch,
        transmit,
        secretValues,
      });
      cleanupReceipts.push(...remaining);
    }
  }
}

function isPausedStatus(status: { configuredStatus: string | null; effectiveStatus: string | null }): boolean {
  const configured = status.configuredStatus?.toUpperCase() ?? null;
  const effective = status.effectiveStatus?.toUpperCase() ?? null;
  return configured === "PAUSED" && (effective === "PAUSED" || effective?.endsWith("_PAUSED") === true);
}

async function verifyCreatedObjects(input: {
  accessToken: string;
  pageToken: string;
  adAccountId: string;
  pageId: string;
  created: CreatedObjects;
  graphVersion: string;
  fetchImpl: typeof fetch;
  transmitJson: (label: string, payload: unknown) => void;
}): Promise<void> {
  const readBack = async (objectId: string, token: string, fields: string) =>
    graphJson({
      method: "GET",
      path: `/${objectId}`,
      token,
      params: { fields },
      graphVersion: input.graphVersion,
      fetchImpl: input.fetchImpl,
    });

  const assertAccountOwnership = (objectId: string, payload: Record<string, unknown>) => {
    const accountId = typeof payload.account_id === "string" ? payload.account_id : null;
    const normalized = accountId ? (accountId.startsWith("act_") ? accountId : `act_${accountId}`) : null;
    if (normalized !== input.adAccountId) {
      throw new Error(`Read-back ownership check failed for ${hashMetaId(objectId)}: not on the external ad account.`);
    }
    const configured = typeof payload.configured_status === "string" ? payload.configured_status.toUpperCase() : null;
    if (configured !== "PAUSED") {
      throw new Error(`Read-back status check failed for ${hashMetaId(objectId)}: ${configured ?? "unknown"}.`);
    }
  };

  for (const adId of input.created.adIds) {
    assertAccountOwnership(adId, await readBack(adId, input.accessToken, "id,account_id,configured_status,effective_status"));
  }
  for (const adSetId of input.created.adSetIds) {
    assertAccountOwnership(adSetId, await readBack(adSetId, input.accessToken, "id,account_id,configured_status,effective_status"));
  }
  if (input.created.campaignId) {
    assertAccountOwnership(input.created.campaignId, await readBack(input.created.campaignId, input.accessToken, "id,account_id,configured_status,effective_status"));
  }
  for (const creativeId of input.created.creativeIds) {
    await readBack(creativeId, input.accessToken, "id,name");
  }
  // Forms live on the Page; verify via the Page's form list with the Page token.
  const pageForms = await graphJson({
    method: "GET",
    path: `/${input.pageId}/leadgen_forms`,
    token: input.pageToken,
    params: { fields: "id,name,status", limit: "100" },
    graphVersion: input.graphVersion,
    fetchImpl: input.fetchImpl,
  });
  const pageFormIds = new Set(
    ((pageForms.data as Array<{ id?: string }> | undefined) ?? []).map((form) => form.id).filter(Boolean),
  );
  for (const formId of input.created.leadFormIds) {
    if (!pageFormIds.has(formId)) {
      throw new Error(`Read-back ownership check failed for form ${hashMetaId(formId)}: not listed on the shared Page.`);
    }
  }
  input.transmitJson("verify/read-back:", {
    ads: input.created.adIds.map(hashMetaId),
    adSets: input.created.adSetIds.map(hashMetaId),
    campaign: input.created.campaignId ? hashMetaId(input.created.campaignId) : null,
    creatives: input.created.creativeIds.map(hashMetaId),
    leadForms: input.created.leadFormIds.map(hashMetaId),
    allPaused: true,
  });
}

async function runTestLeadStep(input: {
  accessToken: string;
  formIds: string[];
  leadWaitSeconds: number;
  graphVersion: string;
  now: () => Date;
  transmit: (line: string) => void;
  transmitJson: (label: string, payload: unknown) => void;
  recordProbe: (id: string, label: string, status: ProofProbeStatus, detail: string) => void;
  secretValues: string[];
  fetchImpl: typeof fetch;
}): Promise<string> {
  if (input.formIds.length === 0) throw new Error("No Instant Form was created; the test-lead step cannot run.");
  const formId = input.formIds[0];

  // Meta's approved Lead Ads testing path (see the runbook's lead test
  // sequence): create one synthetic test lead, prove it is retrievable through
  // the repo lead adapter, then delete it on Meta.
  const created = await graphJson({
    method: "POST",
    path: `/${formId}/test_leads`,
    token: input.accessToken,
    body: {},
    graphVersion: input.graphVersion,
    fetchImpl: input.fetchImpl,
  });
  const testLeadId = typeof created.id === "string" ? created.id : null;
  if (!testLeadId) throw new Error("Meta did not return a test lead ID from the Lead Ads testing path.");

  input.transmit(
    "Synthetic test lead created via POST /{form-id}/test_leads. " +
    `Polling the repo lead adapter for up to ${input.leadWaitSeconds}s...`,
  );

  const deadline = input.now().getTime() + input.leadWaitSeconds * 1000;
  let retrieved = false;
  while (input.now().getTime() < deadline) {
    const leads = await fetchMetaLeadFormLeads({
      accessToken: input.accessToken,
      formIds: [formId],
      fetchImpl: input.fetchImpl,
    });
    if (leads.some((lead) => lead.externalId === testLeadId)) {
      retrieved = true;
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
  }
  if (!retrieved) throw new Error("The synthetic test lead is unretrievable through the repo lead adapter (STOP criterion).");

  // Remove the synthetic test lead on Meta, then drop all local test-lead
  // data: only the hashed lead ID is ever recorded; field data is redacted.
  await graphJson({
    method: "DELETE",
    path: `/${testLeadId}`,
    token: input.accessToken,
    graphVersion: input.graphVersion,
    fetchImpl: input.fetchImpl,
  });
  input.transmitJson("probe/lead-retrieve:", {
    formId: hashMetaId(formId),
    leadId: hashMetaId(testLeadId),
    fieldDataStored: false,
    testLeadDeletedOnMeta: true,
  });
  input.recordProbe(
    "lead_retrieval",
    "Synthetic test lead retrieval (repo lead adapter)",
    "PASS",
    "Test lead created via the Lead Ads testing path, retrieved through fetchMetaLeadFormLeads, deleted on Meta; field data redacted and dropped (no local test-lead data stored).",
  );
  return hashMetaId(testLeadId);
}

async function cleanupCreatedObjects(input: {
  accessToken: string;
  pageToken: string | null;
  created: CreatedObjects;
  graphVersion: string;
  fetchImpl: typeof fetch;
  transmit: (line: string) => void;
  secretValues: string[];
}): Promise<ProofCleanupReceipt[]> {
  const receipts: ProofCleanupReceipt[] = [];
  const deleteObject = async (
    objectType: ProofCleanupReceipt["objectType"],
    objectId: string,
    token: string,
    allowArchiveFallback: boolean,
  ) => {
    const hashedId = hashMetaId(objectId);
    try {
      await graphJson({
        method: "DELETE",
        path: `/${objectId}`,
        token,
        graphVersion: input.graphVersion,
        fetchImpl: input.fetchImpl,
      });
      receipts.push({ objectType, hashedId, action: "deleted", detail: "Deleted via Graph DELETE." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      if (allowArchiveFallback) {
        try {
          await graphJson({
            method: "POST",
            path: `/${objectId}`,
            token,
            body: { status: "ARCHIVED" },
            graphVersion: input.graphVersion,
            fetchImpl: input.fetchImpl,
          });
          receipts.push({
            objectType,
            hashedId,
            action: "archived",
            detail: `DELETE rejected (${redactTokenLike(message, input.secretValues)}); archived instead.`,
          });
          return;
        } catch (archiveError) {
          receipts.push({
            objectType,
            hashedId,
            action: "failed",
            detail: `DELETE and archive both failed: ${redactTokenLike(archiveError instanceof Error ? archiveError.message : "unknown error", input.secretValues)}`,
          });
          return;
        }
      }
      receipts.push({ objectType, hashedId, action: "failed", detail: redactTokenLike(message, input.secretValues) });
    }
  };

  // Proven safe order: ad → creative → adset → campaign → form.
  for (const adId of input.created.adIds) await deleteObject("ad", adId, input.accessToken, false);
  for (const creativeId of input.created.creativeIds) await deleteObject("creative", creativeId, input.accessToken, false);
  for (const adSetId of input.created.adSetIds) await deleteObject("adset", adSetId, input.accessToken, false);
  if (input.created.campaignId) await deleteObject("campaign", input.created.campaignId, input.accessToken, false);
  for (const formId of input.created.leadFormIds) {
    await deleteObject("lead_form", formId, input.pageToken ?? input.accessToken, true);
  }

  for (const receipt of receipts) {
    input.transmit(`[CLEANUP:${receipt.action}] ${receipt.objectType} ${receipt.hashedId.slice(0, 12)}… ${receipt.detail}`);
  }
  return receipts;
}

function buildSanitizedFixtures(input: {
  adAccountId: string;
  pageId: string;
  instagramActorId: string | null;
  created: CreatedObjects;
  publishResultStatus: string | null;
  retrievedLeadHash: string;
}): Record<string, unknown> {
  return {
    "ad-account-read.json": {
      adAccount: {
        id: hashMetaId(input.adAccountId),
        name: "External ad account",
        currency: "AUD",
        timezone: "Australia/Perth",
        accountStatus: "active",
        businessId: "attested_external_business",
      },
    },
    "page-token-resolution.json": {
      pageId: hashMetaId(input.pageId),
      pageTokenResolved: true,
      pageTokenValue: "omitted_by_design",
    },
    "instagram-discovery.json": {
      pageId: hashMetaId(input.pageId),
      instagramBusinessAccount: input.instagramActorId
        ? { id: hashMetaId(input.instagramActorId), username: "external_business_instagram" }
        : null,
      decision: input.instagramActorId
        ? "linked_to_page_no_separate_share_needed"
        : "customers_must_share_instagram_separately",
    },
    "campaign-create-read.json": {
      publishStatus: input.publishResultStatus,
      campaignId: input.created.campaignId ? hashMetaId(input.created.campaignId) : null,
      adSetIds: input.created.adSetIds.map(hashMetaId),
      creativeIds: input.created.creativeIds.map(hashMetaId),
      adIds: input.created.adIds.map(hashMetaId),
      leadFormIds: input.created.leadFormIds.map(hashMetaId),
      allObjectsPaused: true,
    },
    "lead-retrieve.json": {
      formId: input.created.leadFormIds[0] ? hashMetaId(input.created.leadFormIds[0]) : null,
      leadRetrieved: Boolean(input.retrievedLeadHash),
      leadIds: input.retrievedLeadHash ? [input.retrievedLeadHash] : [],
      fieldDataStored: false,
    },
    "insights.json": {
      accountId: hashMetaId(input.adAccountId),
      rows: input.created.adIds.map((adId) => ({ adId: hashMetaId(adId), impressions: 0, spend: "0", clicks: 0 })),
    },
  };
}
