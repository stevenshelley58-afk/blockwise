import Link from "next/link";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { PublishFlow } from "./publish-history-flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Previous publish flow | Blockwise", robots: { index: false, follow: false } };

export default async function PublishHistoryPage() {
  await requirePageSurfaceAccess("adstudio");
  return <div className="flex min-h-[600px] flex-col bg-background text-foreground md:h-[calc(100dvh-60px)]">
    <header className="shrink-0 border-b border-border bg-card px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Previous publish flow</h1>
        <Link href="/ad-studio/ads" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Back to current Ads</Link>
      </div>
      <p className="text-sm text-muted-foreground">12 September 2026 · Example data · Publishing disabled</p>
      <p className="mt-1 text-xs text-muted-foreground">Recovered from aa3b081c. Original stages and layout with current shared styles and example artwork. Form editor replaced by a read-only example. Nothing is saved.</p>
    </header>
    <div className="min-h-0 flex-1">
      <PublishFlow adId="archive-example" workspaceId="archive-example" templateId="archive-example" templateName="Example guide"
        publishRequirements={{ destinationMode: "instant_form", requiredCtaTypes: [], objective: "OUTCOME_LEADS", specialAdCategory: "HOUSING", fulfilmentRequired: false, fulfilmentDependency: null }}
        notSaved={false} initialIssues={[]} providerWritesEnabled={false} audienceLocations={[]}
        canRequestManualPublish={false} automatedPublishAvailable={true} metaConnectionConnected={false}
        initialState={{
          ad: { metaPrimaryText: "Request our example guide.", metaHeadline: "Example guide", metaDescription: "Sample copy for this historical comparison.", metaCta: "LEARN_MORE", destinationUrl: "https://example.invalid/guide" },
          revision: { id: "archive", revisionNumber: 1, documentHash: "archive", feedPngHash: "archive", storyPngHash: "archive", feedPngPath: "/ads/ad-coastline.webp", storyPngPath: "/ads/ad-coastline.webp", createdAt: "2026-09-12T00:00:00Z" },
          form: { name: "Example guide form", formType: "more_volume", intro: { headline: "Request the example guide" }, contactFields: [{ type: "FULL_NAME", required: true }, { type: "EMAIL", required: true }, { type: "PHONE", required: true }] }, formRevision: 1,
        }} />
    </div>
  </div>;
}
