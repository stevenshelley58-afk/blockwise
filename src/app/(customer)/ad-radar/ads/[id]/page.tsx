import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdCardActions } from "@/components/research/ad-card-actions";
import { StatusPill } from "@/components/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { niche } from "@/config/niche";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadCustomerResearchAdDetail } from "@/lib/research/customer-ad-library-pages";

export const dynamic = "force-dynamic";

const ghostButtonClass =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card";
const panelClass = "rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card";
const panelTitleClass = "font-display text-[15.5px] font-extrabold tracking-[-0.015em]";
const thClass = "font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase";
const mediaClass =
  "block max-h-[min(72svh,520px)] w-full max-w-full rounded-(--r-card) border border-(--line) bg-(--surface-subtle) object-contain";

export default async function ResearchAdDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!niche.features.adRadar) notFound();
  const { id } = await params;
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const { ad, versions, error } = await loadCustomerResearchAdDetail(supabase, id);

  if (error || !ad) {
    return (
      <main className="mx-auto grid w-full max-w-[1120px] gap-3.5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
        <header>
          <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
            Competitor intelligence
          </p>
          <h1 className="mt-1 font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">Ad not found</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            The selected research ad is no longer available in this workspace view.
          </p>
        </header>
        <div>
          <Link className={ghostButtonClass} href="/ad-radar">
            Back to Ad Radar
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-[1120px] gap-3.5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <header>
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
          Competitor intelligence
        </p>
        <h1 className="mt-1 font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
          {ad.creative.headline ?? ad.page.name}
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Meta Library {ad.libraryId ?? "ID unavailable"} from {ad.page.name}.
        </p>
      </header>

      <section className={`grid gap-5 ${panelClass} lg:grid-cols-2`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">
                <Link href={`/ad-radar/advertisers/${ad.page.id}`} className="hover:underline">
                  {ad.page.name}
                </Link>
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[ad.agency.name, ad.agent.name].filter(Boolean).join(" / ") || "Advertiser page"}
              </p>
            </div>
            <StatusPill tone={ad.status.active === "active" ? "green" : ad.status.active === "inactive" ? "amber" : "blue"}>
              {ad.status.active}
            </StatusPill>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <dt className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">Format</dt>
              <dd className="mt-1 text-[13px] font-bold text-foreground">{ad.creative.format ?? "-"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
                Classification
              </dt>
              <dd className="mt-1 text-[13px] font-bold text-foreground">
                {[ad.creative.adType, ad.creative.primaryIntent].filter(Boolean).join(" / ") || "-"}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">First seen</dt>
              <dd className="mt-1 text-[13px] font-bold text-foreground">{formatDate(ad.dates.firstSeenAt)}</dd>
            </div>
            <div>
              <dt className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">Last seen</dt>
              <dd className="mt-1 text-[13px] font-bold text-foreground">{formatDate(ad.dates.lastSeenAt)}</dd>
            </div>
          </dl>
          {ad.creative.body ? (
            <p className="mt-3.5 text-[13px]/relaxed text-muted-foreground">{ad.creative.body}</p>
          ) : null}
          <div className="mt-4">
            <AdCardActions observedAdId={ad.id} libraryId={ad.libraryId} />
          </div>
        </div>

        <div className="min-w-0">
          {ad.media[0] ? (
            ad.media[0].kind === "video" ? (
              <video className={mediaClass} src={ad.media[0].url} controls preload="metadata" playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={mediaClass} src={ad.media[0].url} alt={ad.creative.headline ?? ad.page.name} />
            )
          ) : (
            <div className="grid min-h-[180px] place-items-center rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-4 text-center">
              <span className="text-[12.5px] font-bold text-muted-foreground">No stored media captured</span>
            </div>
          )}
        </div>
      </section>

      <section className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={panelTitleClass}>Creative versions</h2>
          {ad.source.snapshotUrl ? (
            <a className={ghostButtonClass} href={ad.source.snapshotUrl} target="_blank" rel="noreferrer">
              Meta source <ExternalLink size={13} aria-hidden />
            </a>
          ) : null}
        </div>
        <div className="-mx-5 mt-3.5 overflow-x-auto px-5">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={thClass}>Version</TableHead>
                <TableHead className={thClass}>Changed</TableHead>
                <TableHead className={thClass}>Format</TableHead>
                <TableHead className={thClass}>Type</TableHead>
                <TableHead className={thClass}>Intent</TableHead>
                <TableHead className={thClass}>Display</TableHead>
                <TableHead className={thClass}>Ad ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell className="font-bold">{version.version}</TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{formatDate(version.createdAt)}</TableCell>
                  <TableCell className="text-[12px]">{version.format ?? "-"}</TableCell>
                  <TableCell className="text-[12px]">{version.adType ?? "-"}</TableCell>
                  <TableCell className="text-[12px]">{version.primaryIntent ?? "-"}</TableCell>
                  <TableCell className="text-[12px]">{version.displayState ?? "-"}</TableCell>
                  <TableCell>
                    <span className="rounded-lg bg-(--surface-subtle) px-2 py-0.5 font-mono text-[11px] text-(--faint)">
                      {version.creativeHash.slice(0, 16)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {versions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-[12px] text-muted-foreground">
                    No creative version history has been recorded for this ad.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>
    </main>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-AU");
}
