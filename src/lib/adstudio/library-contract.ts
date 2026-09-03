export function adFormatLabel(hasFeed: boolean, hasStory: boolean): "Feed" | "Story" | "Feed + Story" {
  if (hasFeed && hasStory) return "Feed + Story";
  if (hasFeed) return "Feed";
  if (hasStory) return "Story";
  return "Feed + Story";
}

export type AdLibraryStatus = "saved" | "created_on_meta_paused" | "active" | "ended";

export const AD_LIBRARY_STATUS_LABEL: Record<AdLibraryStatus, string> = {
  saved: "Saved",
  created_on_meta_paused: "Created on Meta · Paused",
  active: "Active",
  ended: "Ended",
};

/**
 * Derive a library label only from explicit execution evidence. A successful
 * Meta object creation is not enough to call an ad active; Meta must report a
 * paused or active state. Rows without those fields remain truthful as Saved.
 */
export function deriveAdLibraryStatus(input: {
  status?: unknown;
  publishStatus?: unknown;
  metaStatus?: unknown;
  metaConfiguredStatus?: unknown;
  metaEffectiveStatus?: unknown;
  endedAt?: unknown;
  mutationActions?: readonly { action?: unknown; status?: unknown }[];
}): AdLibraryStatus {
  const values = [
    input.status,
    input.publishStatus,
    input.metaStatus,
    input.metaConfiguredStatus,
    input.metaEffectiveStatus,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase().replace(/[\s-]+/g, "_"));

  const appliedActions = (input.mutationActions ?? []).filter((mutation) => mutation.status === "applied").map((mutation) => mutation.action);
  if (input.endedAt || appliedActions.includes("pause") || values.some((value) => ["ended", "archived", "deleted", "expired", "completed"].includes(value))) {
    return "ended";
  }
  if (appliedActions.includes("activate") || values.some((value) => ["active", "active_delivery", "delivering"].includes(value))) {
    return "active";
  }
  if (values.some((value) => ["paused", "paused_live", "created_on_meta_paused", "created_paused"].includes(value))) {
    return "created_on_meta_paused";
  }
  return "saved";
}

export function adLibraryStatusLabel(status: AdLibraryStatus): string {
  return AD_LIBRARY_STATUS_LABEL[status];
}

export type LibraryAdFilterItem = {
  adId: string;
  name: string;
  format: string;
  updatedAt: string | null;
  status: AdLibraryStatus;
};

export function filterAndSortAds<T extends LibraryAdFilterItem>(
  ads: readonly T[],
  input: { query?: string; status?: AdLibraryStatus | "all"; sort?: "recent" | "name" | "status" },
): T[] {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const status = input.status ?? "all";
  const sort = input.sort ?? "recent";
  return [...ads]
    .filter((ad) => status === "all" || ad.status === status)
    .filter((ad) => !query || `${ad.name} ${ad.adId} ${ad.format}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) || a.adId.localeCompare(b.adId);
      if (sort === "status") return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name);
      return dateValue(b.updatedAt) - dateValue(a.updatedAt) || a.adId.localeCompare(b.adId);
    });
}

const STATUS_ORDER: AdLibraryStatus[] = ["saved", "created_on_meta_paused", "active", "ended"];
function dateValue(value: string | null): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export type LibraryAssetFilterItem = {
  id: string;
  label: string;
  type: string;
  role: "property" | "person" | "logo" | "background";
  createdAt: string | null;
};

export function filterAndSortAssets<T extends LibraryAssetFilterItem>(
  assets: readonly T[],
  input: { query?: string; role?: LibraryAssetFilterItem["role"] | "all"; sort?: "recent" | "name" | "role" },
): T[] {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const role = input.role ?? "all";
  const sort = input.sort ?? "recent";
  const roleOrder = ["property", "person", "logo", "background"] as const;
  return [...assets]
    .filter((asset) => role === "all" || asset.role === role)
    .filter((asset) => !query || `${asset.label} ${asset.type} ${asset.role}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      if (sort === "name") return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
      if (sort === "role") return roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.label.localeCompare(b.label);
      return dateValue(b.createdAt) - dateValue(a.createdAt) || a.id.localeCompare(b.id);
    });
}
