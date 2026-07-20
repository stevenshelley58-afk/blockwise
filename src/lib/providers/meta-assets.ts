import type { MetaConnectionSetup } from "./meta-execution.ts";
import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export type MetaAdAccountAsset = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  status: "active" | "disabled" | "needs_attention" | "unknown";
};

export type MetaPageAsset = {
  id: string;
  name: string;
};

export type MetaInstagramActorAsset = {
  id: string;
  username: string;
  pageId?: string;
};

export type MetaPixelAsset = {
  id: string;
  name: string;
};

export type MetaLeadFormAsset = {
  id: string;
  name: string;
  pageId: string;
  status: string;
};

export type MetaAssetCatalog = {
  adAccounts: MetaAdAccountAsset[];
  pages: MetaPageAsset[];
  instagramActors: MetaInstagramActorAsset[];
  pixels: MetaPixelAsset[];
  leadForms: MetaLeadFormAsset[];
};

export type MetaConnectionHealth = {
  status: "healthy" | "expiring_soon" | "needs_reconnect" | "missing_token";
  checkedAt: string;
  message: string | null;
  expiresAt: string | null;
};

type FetchInput = {
  accessToken: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
};

type MetaListResponse<T> = {
  data?: T[];
  error?: { message?: string };
};

export async function fetchMetaAssetCatalog(input: FetchInput & { selectedAdAccountId?: string | null; selectedPageId?: string | null }): Promise<MetaAssetCatalog> {
  const adAccounts = await fetchMetaList<RawMetaAdAccount>(input, "/me/adaccounts", {
    fields: "id,name,currency,timezone_name,account_status",
    limit: "100",
  });
  const pages = await fetchMetaList<RawMetaPage>(input, "/me/accounts", {
    fields: "id,name,instagram_business_account{id,username},connected_instagram_account{id,username}",
    limit: "100",
  });
  const selectedAdAccountId = normalizeAdAccountId(input.selectedAdAccountId ?? adAccounts[0]?.id ?? "");
  const selectedPageIds = input.selectedPageId ? [input.selectedPageId] : pages.map((page) => page.id).filter(Boolean);
  const [pixels, leadForms] = await Promise.all([
    selectedAdAccountId
      ? fetchMetaList<RawMetaPixel>(input, `/${selectedAdAccountId}/adspixels`, { fields: "id,name", limit: "100" }).catch(() => [])
      : Promise.resolve([]),
    Promise.all(
      selectedPageIds.map(async (pageId) =>
        fetchMetaList<RawMetaLeadForm>(input, `/${pageId}/leadgen_forms`, { fields: "id,name,status", limit: "100" })
          .then((forms) => forms.map((form) => ({ ...form, page_id: pageId })))
          .catch(() => []),
      ),
    ).then((groups) => groups.flat()),
  ]);

  return {
    adAccounts: adAccounts.map((account) => ({
      id: normalizeAdAccountId(account.id),
      name: account.name ?? normalizeAdAccountId(account.id),
      currency: account.currency ?? "",
      timezone: account.timezone_name ?? "",
      status: normalizeAccountStatus(account.account_status),
    })),
    pages: pages.map((page) => ({ id: page.id, name: page.name ?? page.id })),
    instagramActors: pages.flatMap((page) => {
      const actors = [page.instagram_business_account, page.connected_instagram_account].filter(isRawInstagramActor);

      return uniqueById(actors).map((actor) => ({
        id: actor.id,
        username: actor.username ?? actor.id,
        pageId: page.id,
      }));
    }),
    pixels: pixels.map((pixel) => ({ id: pixel.id, name: pixel.name ?? pixel.id })),
    leadForms: leadForms.map((form) => ({
      id: form.id,
      name: form.name ?? form.id,
      pageId: form.page_id,
      status: form.status ?? "UNKNOWN",
    })),
  };
}

export function pickDefaultMetaSetupFromAssets(catalog: MetaAssetCatalog): MetaConnectionSetup {
  const adAccount = catalog.adAccounts.find((account) => account.status === "active") ?? catalog.adAccounts[0];
  const page = catalog.pages[0];
  const instagramActor = catalog.instagramActors.find((actor) => actor.pageId === page?.id) ?? catalog.instagramActors[0];
  const pixel = catalog.pixels[0];

  return {
    metaAdAccountId: adAccount?.id ?? "",
    pageId: page?.id ?? "",
    instagramActorId: instagramActor?.id ?? null,
    pixelId: pixel?.id ?? null,
    leadDestination: { type: "manual", label: "Manual review", config: { endpoint: "" } },
    privacyPolicyUrl: "",
    currency: adAccount?.currency ?? "",
    timezone: adAccount?.timezone ?? "",
  };
}

export async function checkMetaConnectionHealth(input: FetchInput & { tokenExpiresAt?: string | null; now?: string }): Promise<MetaConnectionHealth> {
  const checkedAt = input.now ?? new Date().toISOString();

  if (!input.accessToken) {
    return { status: "missing_token", checkedAt, message: "Meta access token is missing.", expiresAt: input.tokenExpiresAt ?? null };
  }

  const expiresAt = input.tokenExpiresAt ?? null;
  const nowMs = Date.parse(checkedAt);
  const expiresMs = expiresAt ? Date.parse(expiresAt) : Number.POSITIVE_INFINITY;

  if (expiresAt && Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    return { status: "needs_reconnect", checkedAt, message: "Meta token has expired. Reconnect Meta.", expiresAt };
  }

  try {
    await fetchMetaObject(input, "/me", { fields: "id,name" });
  } catch (error) {
    return {
      status: "needs_reconnect",
      checkedAt,
      message: error instanceof Error ? error.message : "Meta token was rejected. Reconnect Meta.",
      expiresAt,
    };
  }

  if (expiresAt && Number.isFinite(expiresMs) && expiresMs - nowMs <= EXPIRING_SOON_MS) {
    return { status: "expiring_soon", checkedAt, message: "Meta token expires soon. Reconnect before publishing.", expiresAt };
  }

  return { status: "healthy", checkedAt, message: null, expiresAt };
}

async function fetchMetaList<T>(input: FetchInput, path: string, params: Record<string, string>): Promise<T[]> {
  const payload = await fetchMetaObject<MetaListResponse<T>>(input, path, params);

  return payload.data ?? [];
}

async function fetchMetaObject<T = Record<string, unknown>>(input: FetchInput, path: string, params: Record<string, string>): Promise<T> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(`https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  url.searchParams.set("access_token", input.accessToken);

  const response = await fetchImpl(url.toString(), { method: "GET" });
  const payload = (await response.json().catch(() => ({}))) as MetaListResponse<T> & T;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Meta asset request failed with ${response.status}.`);
  }

  return payload as T;
}

type RawMetaAdAccount = {
  id: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
};

type RawInstagramActor = {
  id: string;
  username?: string;
};

type RawMetaPage = {
  id: string;
  name?: string;
  instagram_business_account?: RawInstagramActor | null;
  connected_instagram_account?: RawInstagramActor | null;
};

type RawMetaPixel = {
  id: string;
  name?: string;
};

type RawMetaLeadForm = {
  id: string;
  name?: string;
  status?: string;
  page_id: string;
};

function normalizeAccountStatus(status: number | undefined): MetaAdAccountAsset["status"] {
  if (status === 1) return "active";
  if (status === 2) return "disabled";
  if (typeof status === "number") return "needs_attention";

  return "unknown";
}

function normalizeAdAccountId(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";

  return trimmed && !trimmed.startsWith("act_") ? `act_${trimmed}` : trimmed;
}

function isRawInstagramActor(value: RawInstagramActor | null | undefined): value is RawInstagramActor {
  return Boolean(value?.id);
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);

    return true;
  });
}
