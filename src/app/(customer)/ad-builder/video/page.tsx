import { AdBuilderVideoHome, type VideoProjectRow } from "@/components/adbuilder/video/video-home";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { buildVideoMediaRef } from "@/lib/adbuilder/video-refs";
import {
  describeDeadline,
  formatDeadline,
  formatOfferAmount,
  nextWorkingDayDeadline,
} from "@/lib/adbuilder/video-offer";

export const dynamic = "force-dynamic";

/**
 * Ad Builder Video.
 *
 * A server component so the customer's own records are read with their session
 * and RLS applies. Projects are the one video table the browser role may read
 * directly; assets stay server-only, so a download link is built from the
 * authorised media route rather than from a stored path.
 */
export default async function AdBuilderVideoPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adbuilder");
  const workspaceId = access.workspaceId;

  const now = new Date();
  // The exact commitment for a brief started now, using the same rules the
  // stored due date uses. Computed here so the server and the client cannot
  // disagree during hydration.
  const previewDue = formatDeadline(nextWorkingDayDeadline(now));

  const { data, error } = await supabase
    .from("video_projects")
    .select("id, mode, title, status, created_at")
    .eq("workspace_id", workspaceId)
    .eq("customer_visible", true)
    .order("created_at", { ascending: false })
    .limit(100);

  const projects: VideoProjectRow[] = (data ?? []).map((row) => ({
    id: String(row.id),
    mode: row.mode === "commissioned" ? "commissioned" : "uploaded",
    title: String(row.title ?? "Untitled video"),
    status: String(row.status ?? "draft"),
    createdAt: String(row.created_at),
  }));

  // video_assets is server-only, so the download reference is built here from
  // the authorised record. It points at the media route rather than a signed
  // URL, because a signed URL would expire and leave a dead link on the page.
  const downloadable = await loadDownloadableSources(
    supabase,
    workspaceId,
    projects.filter((project) => project.mode === "uploaded").map((project) => project.id),
  );

  const projectsWithMedia: VideoProjectRow[] = projects.map((project) => ({
    ...project,
    mediaHref: downloadable.get(project.id)?.href,
    mediaLabel: downloadable.get(project.id)?.label,
  }));

  return (
    <AdBuilderVideoHome
      workspaceId={workspaceId}
      projects={projectsWithMedia}
      loadError={Boolean(error)}
      priceLabel={`${formatOfferAmount()} total`}
      deadlineSummary={`${describeDeadline()} (by ${previewDue})`}
    />
  );
}

type SourceRow = { project_id: unknown; id: unknown; object_path: unknown; original_name: unknown };

/**
 * The newest ready, customer-visible source for each project, as an authorised
 * download reference. A project with no ready source simply has no link yet,
 * which is the honest state for an upload that has not finished.
 */
async function loadDownloadableSources(
  supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"],
  workspaceId: string,
  projectIds: string[],
): Promise<Map<string, { href: string; label: string }>> {
  const result = new Map<string, { href: string; label: string }>();
  if (projectIds.length === 0) return result;

  const { data } = await supabase
    .from("video_assets")
    .select("id, project_id, object_path, original_name, created_at")
    .eq("workspace_id", workspaceId)
    .eq("visibility", "customer")
    .eq("upload_state", "ready")
    .eq("kind", "source_upload")
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  for (const row of (data ?? []) as SourceRow[]) {
    const projectId = String(row.project_id);
    if (result.has(projectId)) continue; // newest wins
    const assetId = String(row.id);
    const objectPath = String(row.object_path);
    result.set(projectId, {
      href: buildVideoMediaRef({ workspaceId, assetId, objectPath }),
      label: typeof row.original_name === "string" && row.original_name.length > 0 ? row.original_name : "video",
    });
  }

  return result;
}
