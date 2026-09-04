import { ArrowRight } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { HomeCommand } from "@/components/adstudio/home-command";
import { getTemplate, listTemplates, type TemplateSummary } from "@/lib/adstudio/pack-gallery";
import { createCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { loadAdStudioLibraryPage, type LibraryAdModel, type LibraryAssetModel } from "@/lib/adstudio/library-read-model";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// Creation stays server-side and receives a fresh idempotency key per form.
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
    loadAdStudioLibraryPage({ supabase, workspaceId: access.workspaceId, kind: "assets", limit: 5 }),
    loadAdStudioLibraryPage({ supabase, workspaceId: access.workspaceId, kind: "ads", limit: 3 }),
  ]);
  const templates = templatesResult.status === "fulfilled" ? templatesResult.value : [];
  const assets = assetsResult.status === "fulfilled" ? assetsResult.value.items as LibraryAssetModel[] : [];
  const ads = adsResult.status === "fulfilled" ? adsResult.value.items as LibraryAdModel[] : [];

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <HomeCommand
        ads={ads}
        assets={assets}
        adsError={adsResult.status === "rejected"}
        assetsError={assetsResult.status === "rejected"}
        timeZone={timeZone}
        dateLocale={dateLocale}
      />
      <section className="mt-10" aria-labelledby="quick-starts-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[.12em] text-muted-foreground">Quick starts</p>
            <h2 id="quick-starts-heading" className="mt-1 font-display text-[17px] font-extrabold tracking-[-.015em]">Start from a proven layout</h2>
          </div>
          <Link href="/ad-studio/templates" className="inline-flex min-h-11 items-center gap-1 text-[12px] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Browse all <ArrowRight size={15} aria-hidden /></Link>
        </div>
        {templates.length > 0 ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {templates.slice(0, 3).map((template) => (
              <li key={template.templateId} className="min-w-0">
                <form action={createAdAction.bind(null, crypto.randomUUID())} className="h-full">
                  <input type="hidden" name="templateId" value={template.templateId} />
                  <button type="submit" aria-label={`Start with ${template.name}`} className="group flex min-h-11 w-full items-center gap-3 rounded-(--r-card) border border-border bg-card p-3 text-left transition hover:border-(--line-heavy) hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <img src={template.gallerySampleUrl} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-display text-[14px] font-extrabold">{template.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">Feed + Story · {template.imageInputs + template.textInputs} inputs</span></span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : templatesResult.status === "rejected" ? <ReadError label="templates" /> : (
          <div className="mt-4 rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-6 text-center text-sm text-muted-foreground">No starting points are available yet. Check the template gallery again when packs are ready.</div>
        )}
      </section>
    </div>
  );
}

function ReadError({ label }: { label: string }) {
  return <div className="mt-4 rounded-(--r-card) border border-(--ui-error)/25 bg-(--ui-error-soft) p-5 text-sm"><p className="font-semibold text-(--ui-error)">Couldn’t load {label}.</p><p className="mt-1 text-muted-foreground">Refresh to try again. Your other Studio sections remain available.</p></div>;
}

function resolveTimeZone(value: unknown, region: string | undefined): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (candidate) {
    try { new Intl.DateTimeFormat("en", { timeZone: candidate }).format(); return candidate; } catch { /* use region default */ }
  }
  return region === "US" ? "America/New_York" : "Australia/Sydney";
}

export function formatLastEdited(value: string | null, timeZone: string, locale: "en-AU" | "en-US"): string {
  if (!value) return "recently";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}

export type { TemplateSummary };
