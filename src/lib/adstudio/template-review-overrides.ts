/**
 * Template review overrides.
 *
 * The template-review tool edits the template-gallery JSON files. On Vercel
 * the filesystem is read-only, so edits are persisted to the
 * adstudio_template_review_overrides table (service-role only) and merged
 * over the on-disk templates at read time. Overrides are folded back into
 * git with scripts/adstudio/apply-template-review-overrides.mjs.
 */
import { createSupabaseServiceClient } from "../supabase/service.ts";

const OVERRIDE_TABLE = "adstudio_template_review_overrides";

export interface TemplateReviewOverridePayload {
  typography?: Record<string, unknown>;
  textInputs?: unknown[];
}

/* ── Pure merge/validation helpers ─────────────────────────────────── */

export function applyTemplateReviewOverride<T extends Record<string, unknown>>(
  template: T,
  payload: TemplateReviewOverridePayload,
): T {
  const merged: Record<string, unknown> = { ...template };
  if (payload.typography) {
    merged.typography = payload.typography;
  }
  if (payload.textInputs) {
    const inputs = {
      ...((merged.inputs as Record<string, unknown> | undefined) ?? {}),
    };
    inputs.text = payload.textInputs;
    merged.inputs = inputs;
  }
  return merged as T;
}

/** Every typography key must have a matching text input key. Returns the first orphan key, or null when consistent. */
export function findTypographyKeyWithoutTextInput(
  template: Record<string, unknown>,
): string | null {
  const inputs = template.inputs as
    | { text?: Array<{ key?: unknown }> }
    | undefined;
  const textKeys = new Set(
    (inputs?.text ?? [])
      .map((t) => t?.key)
      .filter((k): k is string => typeof k === "string"),
  );
  const typography =
    (template.typography as Record<string, unknown> | undefined) ?? {};
  for (const key of Object.keys(typography)) {
    if (!textKeys.has(key)) return key;
  }
  return null;
}

/* ── Supabase-backed store (service-role only) ─────────────────────── */

function createServiceClientOrNull() {
  try {
    return createSupabaseServiceClient();
  } catch (error) {
    // Local dev without service-role env falls back to disk-only behaviour.
    if (
      error instanceof Error &&
      error.message === "Supabase service-role environment is missing."
    ) {
      return null;
    }
    throw error;
  }
}

export async function fetchTemplateReviewOverride(
  templateId: string,
): Promise<TemplateReviewOverridePayload | null> {
  const supabase = createServiceClientOrNull();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(OVERRIDE_TABLE)
    .select("payload")
    .eq("template_id", templateId)
    .maybeSingle();
  if (error) {
    throw new Error(`Template review override lookup failed: ${error.message}`);
  }
  return (data?.payload as TemplateReviewOverridePayload | undefined) ?? null;
}

export async function fetchAllTemplateReviewOverrides(): Promise<
  Map<string, TemplateReviewOverridePayload>
> {
  const overrides = new Map<string, TemplateReviewOverridePayload>();
  const supabase = createServiceClientOrNull();
  if (!supabase) return overrides;
  const { data, error } = await supabase
    .from(OVERRIDE_TABLE)
    .select("template_id,payload");
  if (error) {
    throw new Error(`Template review override list failed: ${error.message}`);
  }
  for (const row of data ?? []) {
    overrides.set(
      row.template_id as string,
      row.payload as TemplateReviewOverridePayload,
    );
  }
  return overrides;
}

export async function upsertTemplateReviewOverride(
  templateId: string,
  payload: TemplateReviewOverridePayload,
): Promise<void> {
  const supabase = createServiceClientOrNull();
  if (!supabase) {
    throw new Error(
      "Supabase service-role environment is missing; cannot persist template review override.",
    );
  }
  const { error } = await supabase.from(OVERRIDE_TABLE).upsert({
    template_id: templateId,
    payload,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`Template review override upsert failed: ${error.message}`);
  }
}

export async function deleteTemplateReviewOverride(
  templateId: string,
): Promise<void> {
  const supabase = createServiceClientOrNull();
  if (!supabase) return;
  const { error } = await supabase
    .from(OVERRIDE_TABLE)
    .delete()
    .eq("template_id", templateId);
  if (error) {
    throw new Error(`Template review override delete failed: ${error.message}`);
  }
}
