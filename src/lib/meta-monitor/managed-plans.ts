import type { createSupabaseServiceClient } from "../supabase/service.ts";

import { collectManagedMetaObjects, emptyManagedMetaObjects, type ManagedMetaObjects } from "./manageability.ts";
import type { MetaReconciledObjects } from "../providers/meta-execution.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Load the set of live Meta object IDs that Blockwise created for a workspace
 * (across all publish plans). Used to label Results rows as "Blockwise" vs
 * "In Meta". Fully degradable: any failure yields an empty set so the dashboard
 * still renders.
 */
export async function loadManagedMetaObjects(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
): Promise<ManagedMetaObjects> {
  try {
    const { data, error } = await serviceSupabase
      .from("meta_publish_plans")
      .select("reconciled_objects_json")
      .eq("workspace_id", workspaceId);

    if (error || !data) {
      return emptyManagedMetaObjects();
    }

    const plans = data.map((row) => ({
      reconciledObjects: ((row as { reconciled_objects_json?: MetaReconciledObjects }).reconciled_objects_json ?? {
        leadFormIds: {},
        adSetIds: {},
        creativeIds: {},
        adIds: {},
      }) as MetaReconciledObjects,
    }));

    return collectManagedMetaObjects(plans);
  } catch {
    return emptyManagedMetaObjects();
  }
}
