import { notFound } from "next/navigation";

import { PublishFlow } from "./publish-flow";
import { getOrCreateCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { getImportedPack } from "@/lib/adstudio/pack-gallery";
import { loadPublishState, PublishError, validatePublishState } from "@/lib/adstudio/publish-adapter";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ad Studio — separate Publish flow (BW-M).
//
// Freezes the LAST SAVED revision and creates Meta objects PAUSED through the
// existing publish adapter + Meta pipeline. Activation is a later task — this
// surface never says "live". Server-renders the frozen publish state, issues,
// and provider-write mode; the client handles the Freeze & Create PAUSED call.
// ---------------------------------------------------------------------------

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

export default async function PublishPage({
  params,
}: {
  params: Promise<{ packId: string }>;
}) {
  const { packId } = await params;
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const pack = await getImportedPack(supabase, packId);
  if (!pack) notFound();

  const { adId } = await getOrCreateCustomerAd(supabase, access.workspaceId, pack);

  // Frozen publish state — the LAST SAVED revision. not_saved means the user
  // must Save in the editor before publishing; render a clear gate.
  let state: Awaited<ReturnType<typeof loadPublishState>> | null = null;
  let notSaved = false;
  try {
    state = await loadPublishState(supabase, adId, access.workspaceId);
  } catch (err) {
    if (err instanceof PublishError && err.code === "not_saved") {
      notSaved = true;
    } else {
      throw err;
    }
  }

  const issues = state ? validatePublishState(state) : [];
  const providerWrites = providerWritesEnabled();

  return (
    <main className="fixed inset-0 flex flex-col bg-(--canvas) text-foreground">
      <header className="flex h-12 shrink-0 items-center border-b border-(--line) bg-(--surface) px-5">
        <a
          href={`/ad-studio/packs/${encodeURIComponent(packId)}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M8.5 3.5 5 7l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to editor
        </a>
        <span className="ml-4 truncate text-sm font-medium">
          Publish — {pack.classification.label || pack.templateId}
        </span>
        {!providerWrites && (
          <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
            Provider writes disabled — dry run
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1">
        <PublishFlow
          adId={adId}
          workspaceId={access.workspaceId}
          packId={packId}
          packName={pack.classification.label || pack.templateId}
          notSaved={notSaved}
          initialState={state}
          initialIssues={issues}
          providerWritesEnabled={providerWrites}
        />
      </div>
    </main>
  );
}
