import { notFound } from "next/navigation";
import Link from "next/link";

import { PublishFlow } from "./publish-flow";
import { normalizeSavedPublishAudienceLocations } from "./publish-controls";
import { loadCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { getTemplate } from "@/lib/adstudio/pack-gallery";
import { loadPublishState, PublishError, readTemplatePublishRequirements, validatePublishState } from "@/lib/adstudio/publish-adapter";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ad Studio — Publish flow.
//
// Two explicit steps: freeze the LAST SAVED revision and create PAUSED Meta
// objects, then let the customer separately approve activation. Server-renders
// the frozen publish state, issues, and provider-write mode; the client drives
// both explicit actions.
// ---------------------------------------------------------------------------

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

export default async function PublishPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams?: Promise<{ adId?: string }>;
}) {
  const { templateId } = await params;
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const pack = await getTemplate(supabase, templateId);
  if (!pack) notFound();

  const adId = (await searchParams)?.adId?.trim();
  if (!adId) notFound();
  const ad = await loadCustomerAd(supabase, access.workspaceId, adId);
  if (ad.templateId !== templateId) notFound();
  const { data: campaignMarkets, error: campaignMarketsError } = await supabase
    .from("adstudio_campaigns")
    .select("market_json")
    .eq("workspace_id", access.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (campaignMarketsError) throw new Error(`Failed to load saved campaign locations: ${campaignMarketsError.message}`);
  const audienceLocations = normalizeSavedPublishAudienceLocations(
    (campaignMarkets ?? []).map(row => (row as { market_json?: unknown }).market_json),
  );

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

  const publishRequirements = readTemplatePublishRequirements(pack);
  const validationControls = publishRequirements.destinationMode === "website"
    ? { destinationMode: "website" as const, destinationUrl: "https://pending.invalid" }
    : { destinationMode: "instant_form" as const, destinationUrl: "https://pending.invalid" };
  const issues = state
    ? validatePublishState(state, { controls: validationControls }).filter((issue) => !isInteractiveDependencyIssue(issue))
    : [];
  const providerWrites = providerWritesEnabled();
  const { data: metaConnection } = await supabase
    .from("provider_connections")
    .select("status")
    .eq("workspace_id", access.workspaceId)
    .eq("provider", "meta")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const automatedPublishAvailable = providerWrites && metaConnection?.status === "connected";
  const metadata = (pack as unknown as { metadata?: { title?: string } }).metadata;
  const templateName = metadata?.title?.trim() || pack.metadata.title || pack.templateId;

  return (
    <div className="flex min-h-[calc(100dvh-54px)] flex-col bg-background text-foreground md:min-h-[calc(100dvh-60px)]">
      <header className="flex min-h-12 shrink-0 items-center border-b border-border bg-card px-4 md:px-5">
        <Link
          href={`/ad-studio/templates/${encodeURIComponent(templateId)}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        </Link>
        <span className="ml-4 truncate text-sm font-medium">
          Publish — {templateName}
        </span>
        {!providerWrites && (
          <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
            Preview only · nothing will be created
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1">
        <PublishFlow
          adId={adId}
          workspaceId={access.workspaceId}
          templateId={templateId}
          templateName={templateName}
          publishRequirements={publishRequirements}
          notSaved={notSaved}
          initialState={state}
          initialIssues={issues}
          providerWritesEnabled={providerWrites}
          audienceLocations={audienceLocations}
          canRequestManualPublish={access.isOperator || access.role === "owner" || access.role === "admin"}
          automatedPublishAvailable={automatedPublishAvailable}
        />
      </div>
    </div>
  );
}

function isInteractiveDependencyIssue(issue: string): boolean {
  return /destination URL|Instant Form|form revision|privacy policy|thank-you|campaign|ad set|variant|budget|audience|placement|schedule|fulfilment|offer/i.test(issue);
}
