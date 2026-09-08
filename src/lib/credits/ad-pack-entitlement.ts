import { randomUUID } from "node:crypto";

import {
  refundOutstandingWorkspaceCredits,
  reserveWorkspaceCredits,
  settleWorkspaceCreditReservation,
  type WorkspaceCreditReservation,
} from "./workspace-credits.ts";

export type ServiceSupabase = Parameters<typeof reserveWorkspaceCredits>[0]["serviceSupabase"];

/** One complete Feed + Story ad pack = two renders (one of each format). */
export const CREDITS_PER_AD_PACK = 2;

export function adPackReserveMutationKey(input: {
  workspaceId: string;
  idempotencyKey?: string | null;
}): string {
  const scope = input.idempotencyKey?.trim() || randomUUID();
  return `ad-pack-reserve:${input.workspaceId}:${scope}`;
}

export function adPackSettleMutationKey(adId: string): string {
  return `ad-pack-settle:${adId}`;
}

/**
 * Reserve the render credits for one ad pack before the ad row is created.
 * The reservation is replay-safe per mutation key and refunded if the ad
 * creation fails, so an abandoned request never consumes a pack.
 */
export async function reserveAdPackCredits(input: {
  workspaceId: string;
  actorProfileId: string;
  mutationKey: string;
  serviceSupabase?: ServiceSupabase;
}): Promise<WorkspaceCreditReservation> {
  return reserveWorkspaceCredits({
    workspaceId: input.workspaceId,
    actorProfileId: input.actorProfileId,
    credits: CREDITS_PER_AD_PACK,
    mutationKey: input.mutationKey,
    purpose: "ad_pack_creation",
    metadata: { kind: "ad_pack" },
    serviceSupabase: input.serviceSupabase,
  });
}

/**
 * Consume the reserved pack once the ad exists. Ordinary text edits, fixes,
 * repeat saves, and repeat downloads never pass through this — they stay free.
 */
export async function settleAdPackCredits(input: {
  reservation: WorkspaceCreditReservation;
  adId: string;
  serviceSupabase?: ServiceSupabase;
}): Promise<void> {
  try {
    await settleWorkspaceCreditReservation({
      reservation: input.reservation,
      credits: CREDITS_PER_AD_PACK,
      mutationKey: adPackSettleMutationKey(input.adId),
      metadata: { adId: input.adId },
      serviceSupabase: input.serviceSupabase,
    });
  } catch (error) {
    // Settlement is bookkeeping on an already-created ad; keep the ad and let
    // the outstanding reservation surface through the wallet.
    console.error("[credits] ad pack settlement failed", { adId: input.adId, error });
  }
}

export async function refundAdPackReservation(input: {
  reservation: WorkspaceCreditReservation | null;
  mutationKey: string;
  serviceSupabase?: ServiceSupabase;
}): Promise<void> {
  await refundOutstandingWorkspaceCredits({
    reservation: input.reservation,
    mutationKey: input.mutationKey,
    reason: "ad_pack_creation_failed",
    metadata: { kind: "ad_pack" },
    serviceSupabase: input.serviceSupabase,
  });
}
