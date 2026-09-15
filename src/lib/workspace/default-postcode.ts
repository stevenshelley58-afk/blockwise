import { createHash } from "node:crypto";

import type { User } from "@supabase/supabase-js";
import { z } from "zod";

import type { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveAdRadarPostcodeSuburbs } from "../research/ad-radar-location.ts";

export const workspacePostcodeSchema = z.string().trim()
  .regex(/^\d{4}$/u, "Enter a four-digit Australian postcode.")
  .refine((postcode) => resolveAdRadarPostcodeSuburbs(postcode).length > 0, "Enter a recognized Australian postcode.");

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type LocationProjectionRow = {
  postcode?: string | null;
  projected_at?: string | null;
};

const PROJECTION_FRESHNESS_MS = 48 * 60 * 60 * 1000;

export function isFreshLocationProjection(projectedAt: unknown, now = Date.now()): boolean {
  if (typeof projectedAt !== "string") return false;
  const timestamp = Date.parse(projectedAt);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= PROJECTION_FRESHNESS_MS;
}

export function normalizeVerifiedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function verifiedEmailHash(email: string): string {
  return createHash("sha256").update(normalizeVerifiedEmail(email)).digest("hex");
}

/**
 * Seed a missing workspace postcode from the service-only research projection.
 *
 * The caller supplies the authoritative auth user, never an email from a
 * request body or OAuth query. The null-only update means a customer save that
 * wins the race is never overwritten by collected research.
 */
export async function seedMissingWorkspacePostcode(input: {
  serviceSupabase: ServiceClient;
  user: Pick<User, "id" | "email" | "email_confirmed_at">;
  workspaceId: string;
}): Promise<string | null> {
  const email = input.user.email;
  if (!email || !input.user.email_confirmed_at) return null;

  const { data: membership, error: membershipError } = await input.serviceSupabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", input.workspaceId)
    .eq("profile_id", input.user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) return null;

  const { data: workspace, error: workspaceError } = await input.serviceSupabase
    .from("workspaces")
    .select("default_postcode")
    .eq("id", input.workspaceId)
    .maybeSingle();
  if (workspaceError) throw new Error(workspaceError.message);

  const current = workspacePostcodeSchema.safeParse((workspace as { default_postcode?: unknown } | null)?.default_postcode);
  if (current.success) return current.data;

  const { data: projection, error: projectionError } = await input.serviceSupabase
    .from("research_email_location_projections")
    .select("postcode,projected_at")
    .eq("email_sha256", verifiedEmailHash(email))
    .maybeSingle();
  if (projectionError) throw new Error(projectionError.message);

  const projectionRow = projection as LocationProjectionRow | null;
  if (!isFreshLocationProjection(projectionRow?.projected_at)) return null;

  const postcode = workspacePostcodeSchema.safeParse(projectionRow?.postcode);
  if (!postcode.success) return null;

  const { data: updated, error: updateError } = await input.serviceSupabase
    .from("workspaces")
    .update({ default_postcode: postcode.data, updated_at: new Date().toISOString() })
    .eq("id", input.workspaceId)
    .is("default_postcode", null)
    .select("default_postcode")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);

  const saved = workspacePostcodeSchema.safeParse((updated as { default_postcode?: unknown } | null)?.default_postcode);
  return saved.success ? saved.data : null;
}
