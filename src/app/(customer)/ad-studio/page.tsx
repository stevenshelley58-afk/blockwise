import Link from "next/link";
import { StudioNavigation } from "@/components/adstudio/studio-navigation";
import { listCustomerTemplates } from "@/lib/adstudio/pack-gallery";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ad Studio — template gallery.
// Final layered templates are delivered by Hermes through the authenticated internal endpoint.
// This page is read-only: opening a template takes the customer into the layered
// editor shell. Save/Publish land in a later phase.
// ---------------------------------------------------------------------------

export default async function AdStudioPage() {
  const { supabase } = await requirePageSurfaceAccess("adstudio");
  const templates = await listCustomerTemplates(supabase);

  return (
    <div className="flex min-h-[calc(100dvh-54px)] flex-col bg-background text-foreground md:min-h-[calc(100dvh-60px)]">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Templates</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a new ad, or open Library to continue one you saved.
            </p>
          </div>
          <StudioNavigation active="templates" />
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Feed and native Story layouts are included in every template.</p>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {templates.length === 1 ? "1 template" : `${templates.length} templates`}
          </span>
        </div>
        {templates.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
            {templates.map((template) => (
              <li key={template.templateId}>
                <Link
                  href={`/ad-studio/templates/${encodeURIComponent(template.templateId)}`}
                  className="group block overflow-hidden rounded-(--r-card) border border-border bg-card transition duration-200 hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
                >
                  <div className="overflow-hidden border-b border-border bg-muted">
                    <img
                      loading="lazy"
                      width={1080}
                      height={1350}
                      src={template.gallerySampleUrl}
                      alt={`${template.name} Feed preview`}
                      className="aspect-[4/5] w-full object-cover transition duration-300 group-hover:scale-[1.01] motion-reduce:transform-none"
                    />
                  </div>
                  <div className="p-4">
                    <h2 className="truncate text-base font-semibold tracking-tight text-foreground">{template.name}</h2>
                    <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{template.description}</p>
                    <div className="mt-4 flex items-center justify-between text-xs font-medium">
                      <span className="text-muted-foreground">Feed + Story</span>
                      <span className="text-primary transition group-hover:translate-x-0.5 motion-reduce:transform-none">Customise →</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid place-items-center py-24">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-(--r-card) border border-border bg-card text-muted-foreground">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3 12.5 7 8.5l3 3 4-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          No templates yet
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          New starting points will appear here when they’re ready. Your saved ads
          stay private to your workspace.
        </p>
      </div>
    </div>
  );
}
