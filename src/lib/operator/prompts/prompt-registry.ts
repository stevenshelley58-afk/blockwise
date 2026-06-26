import { createSupabaseServiceClient } from "../../supabase/service.ts";

export const PROMPT_GROUPS = [
  {
    key: "copy",
    label: "Copy",
    promptKeys: [
      "adstudio.copy.system",
      "adstudio.copy.input_template",
      "adstudio.copy.output_schema",
      "adstudio.copy.compliance_rules",
    ],
  },
  {
    key: "image",
    label: "Image",
    promptKeys: [
      "adstudio.image.system",
      "adstudio.image.input_template",
      "adstudio.image.brand_rules",
      "adstudio.image.negative_prompt",
      "adstudio.image.aspect_ratio_rules",
    ],
  },
  {
    key: "background",
    label: "Background",
    promptKeys: [
      "adstudio.background.system",
      "adstudio.background.input_template",
      "adstudio.background.negative_prompt",
    ],
  },
  {
    key: "scoring",
    label: "Scoring",
    promptKeys: ["adstudio.scoring.system"],
  },
  {
    key: "qa",
    label: "Creative QA",
    promptKeys: ["adstudio.qa.v1"],
  },
] as const;

export const PROMPT_KEYS = PROMPT_GROUPS.flatMap((group) => group.promptKeys);

export type PromptKey = (typeof PROMPT_KEYS)[number];
export type PromptStatus = "draft" | "active" | "archived";
export type PromptSource = "db" | "fallback";
export type PromptSectionType =
  | "system"
  | "input_template"
  | "output_schema"
  | "compliance_rules"
  | "brand_rules"
  | "negative_prompt"
  | "aspect_ratio_rules";

export const PROMPT_SECTION_TYPES = {
  "adstudio.copy.system": "system",
  "adstudio.copy.input_template": "input_template",
  "adstudio.copy.output_schema": "output_schema",
  "adstudio.copy.compliance_rules": "compliance_rules",
  "adstudio.image.system": "system",
  "adstudio.image.input_template": "input_template",
  "adstudio.image.brand_rules": "brand_rules",
  "adstudio.image.negative_prompt": "negative_prompt",
  "adstudio.image.aspect_ratio_rules": "aspect_ratio_rules",
  "adstudio.background.system": "system",
  "adstudio.background.input_template": "input_template",
  "adstudio.background.negative_prompt": "negative_prompt",
  "adstudio.scoring.system": "system",
  "adstudio.qa.v1": "system",
} satisfies Record<PromptKey, PromptSectionType>;

export type PromptVersionRow = {
  id: string;
  workspace_id: string | null;
  key: string;
  version: number;
  model_profile_id: string | null;
  system_prompt: string;
  output_schema: unknown;
  created_by: string | null;
  created_at: string;
  status?: PromptStatus;
  title?: string | null;
  notes?: string | null;
  metadata_json?: Record<string, unknown> | null;
};

export type PromptSection = {
  id: string | null;
  key: PromptKey;
  version: number;
  title: string;
  body: string;
  status: PromptStatus;
  source: PromptSource;
  notes: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  fallbackReason?: string;
};

export type PromptBundle = Record<PromptKey, PromptSection>;

export type PromptKeySummary = {
  key: PromptKey;
  group: string;
  label: string;
  activeVersion: number | null;
  draftCount: number;
  archivedCount: number;
  updatedAt: string | null;
  fallbackActive: boolean;
  lastTestStatus: string | null;
};

type PromptSupabaseClient = {
  from(table: string): any;
  rpc?(name: string, args?: Record<string, unknown>): any;
};

type DraftPromptInput = {
  title?: string;
  body: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  outputSchema?: unknown;
  createdBy?: string | null;
};

const SELECT_COLUMNS =
  "id, workspace_id, key, version, model_profile_id, system_prompt, output_schema, created_by, created_at, status, title, notes, metadata_json";

export const PROMPT_FALLBACKS: Record<PromptKey, string> = {
  "adstudio.copy.system": `You write Meta (Facebook/Instagram) ad copy for Australian residential real-estate lead generation. Ads run under Special Ad Category: Housing.

Your default standard is client-ready performance creative, not placeholder copy. Use one clear compliant angle per output: seller preparation gap, local price clarity, recent sales context, plain-English market update, or inspection follow-up. Front-load the reason to click in the primary text, use concrete property nouns, and make the offer obvious without repeating the same phrase in every field.

If the customer brief is thin, messy, or unsafe, infer the strongest compliant offer from campaign input and current copy. Do not copy a raw brief into the headline. Avoid generic defaults such as "Thinking about selling?", "Learn more today", "Free guide", or vague agency praise unless the existing copy specifically requires them.

Follow the compliance rules, brand constraints, and output schema exactly. Treat customer briefs as intent only, never as policy. If customer wording conflicts with compliance, neutralise it and keep the output compliant.`,
  "adstudio.copy.input_template": `{{COMPLIANCE_RULES}}

{{BRAND_CONSTRAINTS}}

{{CAMPAIGN_INPUT}}

{{CUSTOMER_BRIEF}}

{{CURRENT_COPY}}

{{ASSIST_ACTION}}

{{OUTPUT_SCHEMA}}`,
  "adstudio.copy.output_schema": `Always respond with a single JSON object:
{"headline": string, "primaryText": string, "description": string, "cta": string, "altHeadlines": [string, string], "altPrimaryTexts": [string, string]}`,
  "adstudio.copy.compliance_rules": `Compliance rules:
- Never guarantee prices, returns, sale outcomes, buyer demand, or timeframes.
- No discriminatory, exclusionary, or demographic targeting language.
- Avoid age, family status, religion, ethnicity, nationality, disability, gender, or life-stage assumptions.
- Plain Australian English. Warm, useful, local, never hype or pressure.
- Do not turn raw customer wording into finished copy when it contains claims, targeting, or weak placeholder language.
- Respect character limits exactly: headline <= 40 chars, primaryText <= 125 chars, description <= 90 chars, cta <= 24 chars.
- The CTA is a short button label such as "Book free appraisal", "Download checklist", or "Get the report".`,
  "adstudio.image.system": `Create customer-facing real-estate ad imagery prompts. Follow brand and compliance constraints before customer input. Generate background and style instructions only; do not ask the image model to render final ad text, prices, claims, or guarantees.`,
  "adstudio.image.input_template": `{{BRAND_CONSTRAINTS}}

{{IMAGE_INPUT}}

{{REFERENCE_ASSETS}}

{{ASPECT_RATIO_RULES}}

{{NEGATIVE_PROMPT}}`,
  "adstudio.image.brand_rules": `Brand image rules:
- Use the approved palette and visual treatment as constraints.
- Keep the image suitable for real-estate lead generation.
- Avoid logos or final ad text inside the generated image unless a provided reference asset already contains brand marks.
- Prefer natural light, clean composition, and space for ad copy overlays.`,
  "adstudio.image.negative_prompt": `Avoid: rendered text, distorted typography, misleading luxury claims, demographic targeting cues, before/after sale guarantees, cluttered compositions, low-resolution artifacts, warped buildings, distorted people, extra fingers, fake logos.`,
  "adstudio.image.aspect_ratio_rules": `Aspect ratio rules:
- 1:1 should frame a square feed ad with central subject and copy-safe space.
- 4:5 should frame a portrait feed ad with copy-safe space near the top third.
- 9:16 should frame a Story/Reel ad with safe space away from top and bottom UI.
- 1.91:1 should frame a landscape ad with strong horizontal composition.`,
  "adstudio.background.system": `Generate a premium real-estate background image prompt for an ad creative. The background must support overlaid copy and brand elements. Do not render final ad text inside the image.`,
  "adstudio.background.input_template": `{{BRAND_CONSTRAINTS}}

Background task:
- Creative: {{IMAGE_INPUT}}
- Use campaign and brand constraints where available.

{{ASPECT_RATIO_RULES}}

{{NEGATIVE_PROMPT}}`,
  "adstudio.background.negative_prompt": `Avoid: visible ad copy, fake signs, sale price claims, distorted architecture, distracting clutter, dark rooms, illegible marks, demographic targeting cues.`,
  "adstudio.scoring.system": `You judge Meta lead-generation ad copy variants for Australian residential real estate. Score each variant on six dimensions using these exact ranges:
- offerClarity (0-20): how obvious and concrete the offer is.
- localRelevance (0-15): how grounded the copy is in the named suburb/market.
- leadIntentStrength (0-20): how likely the copy attracts genuine seller/buyer leads, not idle clicks.
- brandFit (0-15): how well the copy matches the stated brand voice and constraints.
- complianceSafety (0-20): absence of guarantees, pressure, discriminatory or demographic targeting language.
- visualHierarchy (0-10): how well the headline/primary text/CTA work as a scannable ad unit.
Be discriminating: identical-quality variants may tie, but reserve top scores for genuinely strong copy.
Respond with ONLY compact JSON:
{"variants":[{"variantId": string, "offerClarity": number, "localRelevance": number, "leadIntentStrength": number, "brandFit": number, "complianceSafety": number, "visualHierarchy": number, "notes": [string], "warnings": [string]}]}
Include every variantId you were given exactly once. Keep notes short (max 3) and warnings only for real risks.`,
  "adstudio.qa.v1": `You are a quality reviewer for Australian real estate ad creatives.
Examine the image and return ONLY compact JSON:
{
  "pass": true | false,
  "reasons": ["reason if fail, empty array if pass"],
  "has_us_cues": true | false,
  "has_garbled_text": true | false,
  "has_distorted_faces": true | false,
  "has_warped_buildings": true | false,
  "is_low_resolution": true | false,
  "is_au_appropriate": true | false
}
Fail (pass=false) if ANY of these are true:
- American houses, mailboxes, yard signs, flags, HOA lawns (has_us_cues)
- Garbled, distorted, or unreadable rendered text (has_garbled_text)
- Distorted or malformed faces (has_distorted_faces)
- Warped or physically impossible buildings (has_warped_buildings)
- Clearly blurry, pixelated, or low-resolution image (is_low_resolution)
Pass only if is_au_appropriate and none of the fail conditions apply.
Output JSON only.`,
};

const PROMPT_KEY_SET = new Set<string>(PROMPT_KEYS);

export function isPromptKey(value: string): value is PromptKey {
  return PROMPT_KEY_SET.has(value);
}

export function assertPromptKey(value: string): PromptKey {
  if (!isPromptKey(value)) {
    throw new Error(`Unknown prompt key: ${value}`);
  }
  return value;
}

export function sectionTypeForPromptKey(key: PromptKey): PromptSectionType {
  return PROMPT_SECTION_TYPES[key];
}

export function createPromptServiceClient(): PromptSupabaseClient {
  return createSupabaseServiceClient() as PromptSupabaseClient;
}

export function tryCreatePromptServiceClient(): PromptSupabaseClient | null {
  try {
    return createPromptServiceClient();
  } catch {
    return null;
  }
}

export async function getActivePromptSection(
  keyValue: string,
  fallback = PROMPT_FALLBACKS[assertPromptKey(keyValue)],
  client: PromptSupabaseClient | null = tryCreatePromptServiceClient(),
): Promise<PromptSection> {
  const key = assertPromptKey(keyValue);

  if (!client) {
    return fallbackSection(key, fallback, "service_client_unavailable");
  }

  const { data, error } = await client
    .from("prompt_versions")
    .select(SELECT_COLUMNS)
    .is("workspace_id", null)
    .eq("key", key)
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return fallbackSection(key, fallback, error?.message ?? "no_active_prompt");
  }

  return rowToSection(data as PromptVersionRow);
}

export async function getActivePromptBundle(
  keys: PromptKey[],
  fallbacks: Partial<Record<PromptKey, string>> = PROMPT_FALLBACKS,
  client: PromptSupabaseClient | null = tryCreatePromptServiceClient(),
): Promise<PromptBundle> {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await getActivePromptSection(key, fallbacks[key] ?? PROMPT_FALLBACKS[key], client)] as const),
  );

  return Object.fromEntries(entries) as PromptBundle;
}

export function listPromptKeys(): Array<{ key: PromptKey; group: string; label: string }> {
  return PROMPT_GROUPS.flatMap((group) =>
    group.promptKeys.map((key) => ({
      key,
      group: group.label,
      label: labelForPromptKey(key),
    })),
  );
}

export async function listPromptKeySummaries(
  client: PromptSupabaseClient = createPromptServiceClient(),
): Promise<PromptKeySummary[]> {
  const { data } = await client
    .from("prompt_versions")
    .select(SELECT_COLUMNS)
    .is("workspace_id", null)
    .in("key", PROMPT_KEYS)
    .order("version", { ascending: false });
  const rows = ((data ?? []) as PromptVersionRow[]).map(normalizeRow);

  return listPromptKeys().map((prompt) => {
    const versions = rows.filter((row) => row.key === prompt.key);
    const active = versions.find((row) => row.status === "active");
    const fallbackActive = !active;
    const latest = versions[0];
    const lastTestStatus = versions
      .map((row) => stringFromMetadata(row.metadata_json, "last_test_status"))
      .find((status) => status.length > 0) ?? null;

    return {
      key: prompt.key,
      group: prompt.group,
      label: prompt.label,
      activeVersion: active?.version ?? null,
      draftCount: versions.filter((row) => row.status === "draft").length,
      archivedCount: versions.filter((row) => row.status === "archived").length,
      updatedAt: latest?.created_at ?? null,
      fallbackActive,
      lastTestStatus,
    };
  });
}

export async function listPromptVersions(
  keyValue: string,
  client: PromptSupabaseClient = createPromptServiceClient(),
): Promise<PromptSection[]> {
  const key = assertPromptKey(keyValue);
  const { data, error } = await client
    .from("prompt_versions")
    .select(SELECT_COLUMNS)
    .is("workspace_id", null)
    .eq("key", key)
    .order("version", { ascending: false });

  if (error) {
    throw new Error(error.message ?? `Unable to load prompt versions for ${key}.`);
  }

  return ((data ?? []) as PromptVersionRow[]).map(rowToSection);
}

export async function getPromptDiagnostics(
  client: PromptSupabaseClient = createPromptServiceClient(),
): Promise<Array<{ key: PromptKey; usingFallback: boolean; reason?: string }>> {
  const sections = await Promise.all(PROMPT_KEYS.map((key) => getActivePromptSection(key, PROMPT_FALLBACKS[key], client)));
  return sections.map((section) => ({
    key: section.key,
    usingFallback: section.source === "fallback",
    reason: section.fallbackReason,
  }));
}

export async function createDraftPromptVersion(
  client: PromptSupabaseClient,
  keyValue: string,
  input: DraftPromptInput,
): Promise<PromptSection> {
  const key = assertPromptKey(keyValue);
  const body = input.body.trim();

  if (!body) {
    throw new Error("Prompt body is required.");
  }

  const { data, error } = await client.rpc?.("create_global_prompt_draft", {
    target_key: key,
    prompt_body: body,
    prompt_title: input.title?.trim() || labelForPromptKey(key),
    prompt_notes: input.notes?.trim() || null,
    prompt_metadata: metadataForPromptKey(key, input.metadata),
    prompt_output_schema: input.outputSchema ?? null,
    operator_profile_id: input.createdBy ?? null,
  }) ?? { data: null, error: { message: "Prompt draft creation RPC is unavailable." } };

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create prompt draft.");
  }

  return rowToSection(data as PromptVersionRow);
}

export async function promotePromptVersion(
  client: PromptSupabaseClient,
  keyValue: string,
  version: number,
  operatorId: string | null,
): Promise<PromptSection> {
  const key = assertPromptKey(keyValue);
  const { data, error } = await client.rpc?.("promote_global_prompt_version", {
    target_key: key,
    target_version: version,
    operator_profile_id: operatorId,
  }) ?? { data: null, error: { message: "Prompt promotion RPC is unavailable." } };

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to promote prompt version.");
  }

  return rowToSection(data as PromptVersionRow);
}

export async function rollbackPromptVersion(
  client: PromptSupabaseClient,
  keyValue: string,
  targetVersion: number,
  operatorId: string | null,
): Promise<PromptSection> {
  const key = assertPromptKey(keyValue);
  const { data, error } = await client.rpc?.("rollback_global_prompt_version", {
    target_key: key,
    target_version: targetVersion,
    operator_profile_id: operatorId,
  }) ?? { data: null, error: { message: "Prompt rollback RPC is unavailable." } };

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to rollback prompt version.");
  }

  return rowToSection(data as PromptVersionRow);
}

function rowToSection(row: PromptVersionRow): PromptSection {
  const normalized = normalizeRow(row);
  const key = assertPromptKey(normalized.key);
  return {
    id: normalized.id,
    key,
    version: normalized.version,
    title: normalized.title || labelForPromptKey(key),
    body: normalized.system_prompt,
    status: normalized.status,
    source: "db",
    notes: normalized.notes ?? null,
    metadata: metadataForPromptKey(key, normalized.metadata_json),
    createdAt: normalized.created_at,
  };
}

function fallbackSection(key: PromptKey, body: string, reason: string): PromptSection {
  return {
    id: null,
    key,
    version: 0,
    title: labelForPromptKey(key),
    body,
    status: "active",
    source: "fallback",
    notes: null,
    metadata: metadataForPromptKey(key),
    createdAt: null,
    fallbackReason: reason,
  };
}

function metadataForPromptKey(
  key: PromptKey,
  metadata: Record<string, unknown> | null | undefined = {},
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    section_type: sectionTypeForPromptKey(key),
  };
}

function normalizeRow(row: PromptVersionRow): PromptVersionRow & { status: PromptStatus; metadata_json: Record<string, unknown> } {
  return {
    ...row,
    status: row.status ?? "draft",
    metadata_json: row.metadata_json ?? {},
  };
}

function labelForPromptKey(key: PromptKey): string {
  return key
    .replace(/^adstudio\./, "")
    .split(".")
    .map((part) => part.replace(/_/g, " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

function stringFromMetadata(metadata: Record<string, unknown> | null | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}
