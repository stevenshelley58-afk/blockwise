import { notFound } from "next/navigation";

import { PublishFlow } from "./publish-flow";
import { getOrCreateCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { getImportedPack } from "@/lib/adstudio/pack-gallery";
import { loadPublishState, PublishError, readPublishRequirements, validatePublishState } from "@/lib/adstudio/publish-adapter";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ad Studio — Publish flow.
//
// One click completes the whole server-side lifecycle: freezes the LAST
// SAVED revision, creates the Meta objects and activates them. The receipt
// reports "active" only after Meta confirms; partial failures report the
// real state with a safe retry. Server-renders the frozen publish state,
// issues, and provider-write mode; the client drives the publish call.
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

  const publishRequirements = readPublishRequirements(pack);
  const validationControls = publishRequirements.destinationMode === "website"
    ? { destinationMode: "website" as const, destinationUrl: "https://pending.invalid" }
    : { destinationMode: "instant_form" as const };
  const issues = state
    ? validatePublishState(state, { controls: validationControls }).filter((issue) => !isInteractiveDependencyIssue(issue))
    : [];
  const providerWrites = providerWritesEnabled();
  const metadata = (pack as unknown as { metadata?: { title?: string } }).metadata;
  const packName = metadata?.title?.trim() || pack.classification.label || pack.templateId;

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
          Publish — {packName}
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
          packName={packName}
          publishRequirements={publishRequirements}
          notSaved={notSaved}
          initialState={state}
          initialIssues={issues}
          providerWritesEnabled={providerWrites}
        />
      </div>
    </main>
  );
}

function isInteractiveDependencyIssue(issue: string): boolean {
  return /destination URL|Instant Form|form revision|privacy policy|thank-you/i.test(issue);
}
