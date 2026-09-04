import { ArrowRight, Clock3, Image as ImageIcon, Plus } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  listTemplates,
  getTemplate,
  type TemplateSummary,
} from "@/lib/adstudio/pack-gallery";
import { createCustomerAd } from "@/lib/adstudio/create-customer-ad";
import {
  loadAdStudioLibraryPage,
  type LibraryAdModel,
  type LibraryAssetModel,
} from "@/lib/adstudio/library-read-model";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

async function createAdAction(creationKey: string, formData: FormData) {
  "use server";

  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const templateId = String(formData.get("templateId") ?? "").trim();
  if (!templateId) notFound();

  const pack = await getTemplate(supabase, templateId);
  if (!pack) notFound();

  const ad = await createCustomerAd(supabase, access.workspaceId, pack, creationKey);
  redirect(`/ad-studio/ads/${encodeURIComponent(ad.adId)}`);
}

export default async function AdStudioPage() {
  const { supabase, access, auth } = await requirePageSurfaceAccess("adstudio");
  const timeZone = resolveTimeZone(auth.claims?.user_metadata?.timezone, access.region);
  const dateLocale = access.region === "US" ? "en-US" : "en-AU";
  const [templatesResult, assetsResult, adsResult] = await Promise.allSettled([
    listTemplates(supabase),
    loadAdStudioLibraryPage({
      supabase,
      workspaceId: access.workspaceId,
      kind: "assets",
      limit: 5,
    }),
    loadAdStudioLibraryPage({
      supabase,
      workspaceId: access.workspaceId,
      kind: "ads",
      limit: 3,
    }),
  ]);
  const templates =
    templatesResult.status === "fulfilled" ? templatesResult.value : [];
  const assets =
    assetsResult.status === "fulfilled"
      ? (assetsResult.value.items as LibraryAssetModel[])
      : [];
  const ads =
    adsResult.status === "fulfilled"
      ? (adsResult.value.items as LibraryAdModel[])
      : [];
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-8 pb-10 md:px-8 md:pt-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[27px] font-extrabold tracking-[-.02em] md:text-3xl">
            Create an ad.
          </h1>
          <p className="mt-2 max-w-[62ch] text-sm leading-6 text-muted-foreground">
            Start with a proven template, then make it yours with reusable media
            and on-brand copy.
          </p>
        </div>
        <Link
          href="#templates"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus size={16} aria-hidden />
          New ad
        </Link>
      </div>
      <section className="mt-10" aria-labelledby="continue-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2
              id="continue-heading"
              className="font-display text-[17px] font-extrabold"
            >
              Continue working
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your latest creative, ready where you left it.
            </p>
          </div>
          <Link
            href="/ad-studio/ads"
            className="hidden min-h-11 items-center gap-1 text-[12px] font-semibold hover:underline sm:inline-flex"
          >
            View all ads <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
        {adsResult.status === "rejected" ? (
          <ReadError label="Saved ads" />
        ) : ads.length > 0 ? (
          <div className="mt-5">
            {ads.slice(0, 1).map((ad) => (
              <article
                key={ad.adId}
                className="group flex min-w-0 overflow-hidden rounded-(--r-panel) border border-border bg-card shadow-card hover:shadow-float"
              >
                <Link
                  href={`/ad-studio/ads/${encodeURIComponent(ad.adId)}`}
                  aria-label={`Edit ${ad.name}`}
                  className="flex w-[38%] max-w-[360px] shrink-0 items-center justify-center bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {ad.src ? (
                    <img
                      src={ad.src}
                      alt={`${ad.name} preview`}
                      className="aspect-[4/5] h-full w-full object-cover"
                    />
                  ) : (
                    <span className="px-4 text-center text-xs text-muted-foreground">
                      Preview available after you save
                    </span>
                  )}
                </Link>
                <div className="flex min-w-0 flex-1 flex-col justify-center p-5 md:p-8">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock3 size={14} aria-hidden />
                    <span className="truncate">Last edited · {formatLastEdited(ad.updatedAt, timeZone, dateLocale)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Saved ad · {ad.format}</p>
                  <h3 className="mt-3 max-w-[18ch] truncate font-display text-2xl font-extrabold">
                    <Link href={`/ad-studio/ads/${encodeURIComponent(ad.adId)}`} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{ad.name}</Link>
                  </h3>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link href={`/ad-studio/ads/${encodeURIComponent(ad.adId)}`} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Edit <ArrowRight size={15} aria-hidden /></Link>
                    <Link href={`/ad-studio/templates/${encodeURIComponent(ad.templateId)}/publish?adId=${encodeURIComponent(ad.adId)}`} className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-[12.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Review</Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-8 text-center">
            <h3 className="font-display text-[17px] font-extrabold">
              No saved ads yet
            </h3>
            <p className="mx-auto mt-1 max-w-[42ch] text-sm text-muted-foreground">
              Choose a template below to create your first creative. Your
              progress will appear here.
            </p>
          </div>
        )}
      </section>
      {templatesResult.status === "rejected" ? (
        <section className="mt-12" aria-label="Templates">
          <ReadError label="Templates" />
        </section>
      ) : (
        <TemplateSection templates={templates} />
      )}
      <section className="mt-12" aria-labelledby="assets-heading">
        <div className="flex items-end justify-between">
          <div>
            <h2
              id="assets-heading"
              className="font-display text-[17px] font-extrabold"
            >
              Recent assets
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ready to reuse in your next ad.
            </p>
          </div>
          <Link
            href="/ad-studio/assets"
            className="inline-flex min-h-11 items-center gap-1 text-[12px] font-semibold hover:underline"
          >
            View all assets <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
        {assetsResult.status === "rejected" ? (
          <ReadError label="Recent assets" />
        ) : assets.length > 0 ? (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {assets.map((asset) => (
              <Link
                key={asset.id}
                href="/ad-studio/assets"
                className="group overflow-hidden rounded-(--r-card) border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img
                  src={asset.src}
                  alt={asset.label}
                  className="aspect-square w-full object-cover transition group-hover:scale-[1.02] motion-reduce:transform-none"
                />
                <span className="block truncate px-3 py-2 text-[11px] font-semibold">
                  {asset.label}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-(--r-card) border border-dashed border-(--line-heavy) p-6 text-center text-sm text-muted-foreground">
            <ImageIcon className="mx-auto mb-2" size={20} aria-hidden />
            Your uploaded media will appear here.
          </div>
        )}
      </section>
    </div>
  );
}

function ReadError({ label }: { label: string }) {
  return (
    <div className="mt-5 rounded-(--r-card) border border-(--ui-error)/25 bg-(--ui-error-soft) p-5 text-sm">
      <p className="font-semibold text-(--ui-error)">
        Couldn’t load {label.toLowerCase()}.
      </p>
      <p className="mt-1 text-muted-foreground">
        Refresh the page to try again. Other Studio sections are still
        available.
      </p>
    </div>
  );
}

function TemplateSection({ templates }: { templates: TemplateSummary[] }) {
  return (
    <section
      id="templates"
      className="mt-12"
      aria-labelledby="templates-heading"
    >
      <div className="flex items-end justify-between">
        <div>
          <h2
            id="templates-heading"
            className="font-display text-[17px] font-extrabold"
          >
            Start with a template
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Frank-built packs with matched Feed and Story layouts.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {templates.length} available
        </span>
      </div>
      {templates.length > 0 ? (
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <li key={template.templateId} className="min-w-0">
              <form
                action={createAdAction.bind(null, crypto.randomUUID())}
                className="h-full"
              >
                <input type="hidden" name="templateId" value={template.templateId} />
                <button
                  type="submit"
                  aria-label={`Start with ${template.name}`}
                  className="group block h-full w-full overflow-hidden rounded-(--r-card) border border-border bg-card text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none"
                >
                  <img
                    src={template.gallerySampleUrl}
                    alt={`${template.name} Feed preview`}
                    className="aspect-[4/5] w-full object-cover"
                  />
                  <span className="block p-4">
                    <span className="block truncate font-display text-[15.5px] font-extrabold">
                      {template.name}
                    </span>
                    <span className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
                      {template.description}
                    </span>
                    <span className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Start with this template</span>
                      <ArrowRight size={15} aria-hidden />
                    </span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-5 rounded-(--r-card) border border-dashed border-(--line-heavy) p-8 text-center">
          <h3 className="font-display text-[17px] font-extrabold">
            Templates are on their way
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            New starting points will appear here when they’re ready.
          </p>
        </div>
      )}
    </section>
  );
}

function formatLastEdited(value: string | null, timeZone: string, locale: "en-AU" | "en-US"): string {
  if (!value) return "recently";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "recently"
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}

function resolveTimeZone(value: unknown, region: string | undefined): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (candidate) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
      return candidate;
    } catch {
      // Fall through to the workspace-region default for malformed metadata.
    }
  }
  return region === "US" ? "America/New_York" : "Australia/Sydney";
}
