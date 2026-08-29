import type { ReactElement } from "react";
import Link from "next/link";
import type { Layout, LayoutLayer, TemplatePack } from "../../../../packages/ad-template-pack-contract/src/types";
import { listImportedPacks } from "@/lib/adstudio/pack-gallery";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ad Studio — gallery of imported template packs.
// Packs are built in Frank and imported through the signed import endpoint.
// This page is read-only: opening a pack takes the customer into the layered
// editor shell. Save/Publish land in a later phase.
// ---------------------------------------------------------------------------

export default async function AdStudioPage() {
  const { supabase } = await requirePageSurfaceAccess("adstudio");
  const packs = await listImportedPacks(supabase);

  return (
    <div className="flex min-h-[calc(100dvh-54px)] flex-col bg-background text-foreground md:min-h-[calc(100dvh-60px)]">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-baseline justify-between gap-4 px-6 py-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Ad Studio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a starting point, then shape the ad in the editor.
            </p>
          </div>
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
            {packs.length === 1 ? "1 template" : `${packs.length} templates`}
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {packs.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {packs.map((pack) => (
              <li key={pack.packId}>
                <Link
                  href={`/ad-studio/packs/${encodeURIComponent(pack.packId)}`}
                  className="group block rounded-(--r-card) border border-border bg-card p-3 transition hover:border-foreground/30 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="overflow-hidden rounded-(--r-card) border border-(--line-soft) bg-white">
                    {pack.gallerySampleUrl ? (
                      <img loading="lazy" width={1080} height={1350} src={pack.gallerySampleUrl} alt={`${pack.name} sample`} className="aspect-[1080/1350] w-full object-cover" />
                    ) : (
                      <LayoutThumb layout={pack.feedLayout} colours={pack.semanticColours} />
                    )}
                  </div>
                  <div className="px-1 pb-1 pt-3">
                    <h2 className="truncate text-sm font-medium text-foreground">{pack.name}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      v{pack.version} · imported {formatDate(pack.importedAt)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge variant="outline">
                        Feed
                      </Badge>
                      <Badge variant="outline">
                        Story
                      </Badge>
                      <Badge variant="outline">
                        {pack.imageInputs + pack.textInputs} inputs
                      </Badge>
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

// ---------------------------------------------------------------------------
// Schematic thumbnail — derived from the pack's real layout geometry and
// semantic colours, not a placeholder image.
// ---------------------------------------------------------------------------

function LayoutThumb({
  layout,
  colours,
}: {
  layout: Layout;
  colours: TemplatePack["semanticColours"];
}) {
  const width = 1080;
  const height = layout.placement === "story" ? 1920 : 1350;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      className="aspect-[1080/1350] w-full"
      role="img"
      aria-label={`${layout.placement} layout preview`}
    >
      {layout.layers.map((layer) => renderLayer(layer, colours))}
      {layout.safeZones.map((zone, index) => (
        <rect
          key={`safe-${index}`}
          x={zone.x}
          y={zone.y}
          width={zone.width}
          height={zone.height}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray="12 12"
          opacity="0.35"
          className="text-slate-400"
        />
      ))}
    </svg>
  );
}

function renderLayer(
  layer: LayoutLayer,
  colours: TemplatePack["semanticColours"],
): ReactElement {
  const fill = (role: string) => colours[role as keyof TemplatePack["semanticColours"]] ?? "#cbd5e1";
  const g = layer.geometry ?? { x: 0, y: 0, width: 1080, height: 1350 };

  switch (layer.type) {
    case "plate":
      return (
        <rect
          key={layer.layerId}
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          fill={fill(layer.colourRole)}
        />
      );
    case "image_slot":
      return (
        <rect
          key={layer.layerId}
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          fill="#ffffff"
          stroke="#94a3b8"
          strokeWidth="4"
        />
      );
    case "overlay_patch":
      return (
        <rect
          key={layer.layerId}
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          fill={fill(layer.colourRole)}
          opacity={Math.max(0.05, Math.min(1, layer.opacity))}
        />
      );
    case "text":
      return (
        <rect
          key={layer.layerId}
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          fill={fill(layer.colourRole)}
          opacity="0.85"
        />
      );
    case "logo":
      return (
        <rect
          key={layer.layerId}
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          fill={colours.primary ?? "#334155"}
          rx={Math.min(24, g.width / 4)}
        />
      );
    case "vector":
      return layer.shape === "circle" ? (
        <circle key={layer.layerId} cx={g.x + g.width / 2} cy={g.y + g.height / 2} r={Math.min(g.width, g.height) / 2} fill={fill(layer.colourRole)} opacity={layer.opacity ?? 1} />
      ) : (
        <rect key={layer.layerId} x={g.x} y={g.y} width={g.width} height={g.height} rx={layer.shape === "pill" || layer.shape === "rounded" ? Math.min(24, g.height / 2) : 0} fill={fill(layer.colourRole)} opacity={layer.opacity ?? 1} />
      );
    case "icon":
      return <circle key={layer.layerId} cx={g.x + g.width / 2} cy={g.y + g.height / 2} r={Math.min(g.width, g.height) / 3} fill="none" stroke={fill(layer.colourRole)} strokeWidth={Math.max(2, Math.min(g.width, g.height) / 12)} />;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
