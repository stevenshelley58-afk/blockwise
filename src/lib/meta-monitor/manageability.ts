import type { MetaReconciledObjects } from "../providers/meta-execution.ts";

/**
 * Sets of live Meta object IDs that Blockwise created (via a publish plan) and
 * therefore can confidently attribute to itself. Used to label rows on the
 * Results page as "Blockwise" vs "In Meta". Note: with provider writes enabled
 * every reachable object is mutable; this flag only drives the label/affordance,
 * not permission.
 */
export type ManagedMetaObjects = {
  campaignIds: Set<string>;
  adSetIds: Set<string>;
  adIds: Set<string>;
};

export function emptyManagedMetaObjects(): ManagedMetaObjects {
  return { campaignIds: new Set(), adSetIds: new Set(), adIds: new Set() };
}

/** Collect the reconciled live Meta IDs across every publish plan for a workspace. */
export function collectManagedMetaObjects(
  plans: Array<{ reconciledObjects: MetaReconciledObjects }>,
): ManagedMetaObjects {
  const managed = emptyManagedMetaObjects();

  for (const plan of plans) {
    const reconciled = plan.reconciledObjects;
    if (reconciled.campaignId) {
      managed.campaignIds.add(reconciled.campaignId);
    }
    for (const id of Object.values(reconciled.adSetIds ?? {})) {
      if (id) managed.adSetIds.add(id);
    }
    for (const id of Object.values(reconciled.adIds ?? {})) {
      if (id) managed.adIds.add(id);
    }
  }

  return managed;
}

/** True when an ad (or its ad set/campaign) was created through Blockwise. */
export function isAdBlockwiseManaged(
  ad: { adId: string; adsetId: string; campaignId: string },
  managed: ManagedMetaObjects,
): boolean {
  return (
    (ad.adId !== "" && managed.adIds.has(ad.adId)) ||
    (ad.adsetId !== "" && managed.adSetIds.has(ad.adsetId)) ||
    (ad.campaignId !== "" && managed.campaignIds.has(ad.campaignId))
  );
}
