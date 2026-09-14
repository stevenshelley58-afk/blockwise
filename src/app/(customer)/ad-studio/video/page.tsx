import { AdStudioVideoHome, type VideoProjectRow } from "@/components/adstudio/video/video-home";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import {
  describeDeadline,
  formatDeadline,
  formatOfferAmount,
  nextWorkingDayDeadline,
} from "@/lib/adstudio/video-offer";

export const dynamic = "force-dynamic";

/**
 * Ad Studio Video.
 *
 * A server component so the customer's own records are read with their session
 * and RLS applies. Projects are the one video table the browser role may read
 * directly; assets stay server-only, so a download link is built from the
 * authorised media route rather than from a stored path.
 */
export default async function AdStudioVideoPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
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

  return (
    <AdStudioVideoHome
      workspaceId={workspaceId}
      projects={projects}
      loadError={Boolean(error)}
      priceLabel={`${formatOfferAmount()} total`}
      deadlineSummary={`${describeDeadline()} (by ${previewDue})`}
    />
  );
}
