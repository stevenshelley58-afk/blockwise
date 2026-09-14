import Link from "next/link";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { Button } from "@/components/ui/button";
import { PublishFlow } from "./publish-history-flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publish flow history | Blockwise", robots: { index: false, follow: false } };

const sourceOnlyVersions = [
  { date: "2 June", title: "Utility panel", flow: "Publish · Budget · Schedule", note: "Small embedded panel in Ad Studio.", commit: "d35919eca5" },
  { date: "10 June", title: "Readiness form", flow: "Ads · Audience · Destination · Budget · Export", note: "One dense page with per-ad selection and local audience controls.", commit: "f029020af4" },
  { date: "24–30 July", title: "Six-step production wizard", flow: "Campaign · Creatives · Lead form · Budget · Review · Live", note: "Review submitted once. Live became the status screen. Later added multiple creatives.", commit: "0a9035a3f7" },
  { date: "2 August", title: "Managed preset", flow: "Audience · Ads · Budget · Review · Live", note: "Closest older match: one Blockwise campaign, multiple ads, lead form, suburb targeting and simple spend.", commit: "7f880af7ff", recommended: true },
  { date: "13 August", title: "Paused-object page", flow: "Frozen creative · Copy · Instant form · Create paused · Activate", note: "Moved publishing out of the workbench into a separate route.", commit: "494bd92063" },
  { date: "29 August", title: "Full Meta setup", flow: "Creative · Campaign/ad set · Audience · Placements · Schedule · Review", note: "Most technical version. Supported all new/existing campaign and ad-set combinations.", commit: "030c39687" },
  { date: "5 September", title: "Lead-first long page", flow: "Creative · Destination · Audience & budget · Review", note: "Same four groups on one scrolling page, with basic and advanced controls.", commit: "ba243edc5" },
];

export default async function PublishHistoryPage() {
  await requirePageSurfaceAccess("adstudio");
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border bg-card px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Publish flow history</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every materially different version found, oldest to newest. Example data only.</p>
        </div>
        <Button asChild variant="outline"><Link href="/ad-studio/ads">Back to current Ads</Link></Button>
      </div>
    </header>

    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap gap-x-6 gap-y-2 border-b border-border pb-5 text-sm text-muted-foreground">
        <span><b className="text-foreground">9</b> real implementations</span>
        <span><b className="text-foreground">1</b> design mockup</span>
        <span><b className="text-foreground">1</b> later proposal image</span>
        <span>Publishing disabled throughout this archive</span>
      </div>

      <section aria-labelledby="visual-evidence">
        <h2 id="visual-evidence" className="text-lg font-semibold">Original visual evidence</h2>
        <div className="mt-5 grid gap-8 lg:grid-cols-2">
          <HistoryImage date="22 July 2026" title="Guided six-step mockup" kind="Design mockup, never live" src="/publish-history/july-guided-mockup-desktop.png">
            <Button asChild variant="outline" size="sm"><a href="/publish-history/july-guided-mockup.html" target="_blank" rel="noreferrer">Open interactive mockup</a></Button>
          </HistoryImage>
          <HistoryImage date="8 September 2026" title="Four-stage publish flow" kind="Genuine live implementation" src="/publish-history/september-8-live-mobile.png" imageClass="mx-auto max-h-[680px] w-auto">
            <Button asChild variant="outline" size="sm"><a href="#september-four-stage">Open recovered interactive flow</a></Button>
          </HistoryImage>
          <HistoryImage date="12 September 2026" title="Five-step reference" kind="Proposal image, never live" src="/publish-history/september-12-reference.png" />
          <HistoryImage date="12 September 2026" title="Current three-stage flow" kind="Genuine live implementation" src="/publish-history/current-september-12.png" />
        </div>
      </section>

      <section aria-labelledby="code-history" className="mt-12 border-t border-border pt-8">
        <h2 id="code-history" className="text-lg font-semibold">Real versions recovered from source</h2>
        <p className="mt-1 text-sm text-muted-foreground">These survive as complete code, but no trustworthy original screenshot was retained.</p>
        <div className="mt-5 divide-y divide-border border-y border-border">
          {sourceOnlyVersions.map(version => <article key={version.commit} className="grid gap-2 py-5 md:grid-cols-[120px_240px_1fr_110px] md:items-start">
            <p className="text-sm font-medium text-muted-foreground">{version.date}</p>
            <div>
              <h3 className="font-semibold">{version.title}</h3>
              {version.recommended ? <span className="mt-2 inline-flex rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background">Closest to your brief</span> : null}
            </div>
            <div>
              <p className="text-sm font-medium">{version.flow}</p>
              <p className="mt-1 text-sm text-muted-foreground">{version.note}</p>
            </div>
            <code className="text-xs text-muted-foreground">{version.commit}</code>
          </article>)}
        </div>
      </section>

      <section id="september-four-stage" aria-labelledby="recovered-flow" className="mt-12 scroll-mt-6 border-t border-border pt-8">
        <div className="mb-5">
          <h2 id="recovered-flow" className="text-lg font-semibold">8 September interactive recovery</h2>
          <p className="mt-1 text-sm text-muted-foreground">Original four stages and layout using example data. Nothing is saved or published.</p>
        </div>
        <div className="min-h-[760px] overflow-hidden rounded-(--r-panel) border border-border">
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
      </section>
    </main>
  </div>;
}

function HistoryImage({ date, title, kind, src, imageClass = "w-full", children }: { date: string; title: string; kind: string; src: string; imageClass?: string; children?: React.ReactNode }) {
  return <article>
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
      <div><p className="text-sm text-muted-foreground">{date}</p><h3 className="font-semibold">{title}</h3></div>
      <span className="text-xs font-medium text-muted-foreground">{kind}</span>
    </div>
    <a href={src} target="_blank" rel="noreferrer" className="mt-4 block overflow-hidden rounded-(--r-card) border border-border bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-2">
      <img src={src} alt={`${title} screenshot`} loading="lazy" className={imageClass} />
    </a>
    {children ? <div className="mt-3">{children}</div> : null}
  </article>;
}
