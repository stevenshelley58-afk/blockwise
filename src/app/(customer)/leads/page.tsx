import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { LeadWorkspace } from "@/components/leads/lead-workspace";
import type { LeadView } from "@/components/leads/types.ts";

export const dynamic = "force-dynamic";

const VIEWS: LeadView[] = ["action", "all", "pipeline", "tasks"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The customer entry point for leads.
 *
 * The server only resolves the session, the workspace and the role. Every
 * record is read through the lead API by the client workspace, so the CRM
 * stays the single source of truth for stage, owner, tasks and outcomes.
 */
export default async function LeadsPage({ searchParams }: { searchParams?: SearchParams }) {
  const { access, auth } = await requirePageSurfaceAccess("monitor");
  const params = searchParams ? await searchParams : {};

  const leadParam = first(params["lead"]);
  const viewParam = first(params["view"]);
  const view = VIEWS.includes(viewParam as LeadView) ? (viewParam as LeadView) : "action";

  // Only workspace managers may see and work unassigned enquiries.
  const canSeeUnassigned = access.role === "owner" || access.role === "admin";

  return (
    <LeadWorkspace
      workspaceId={access.workspaceId}
      canSeeUnassigned={canSeeUnassigned}
      initialLeadId={leadParam && leadParam.length <= 200 ? leadParam : null}
      initialView={view}
      timeZone={resolveTimeZone(auth.claims?.user_metadata?.timezone, access.region)}
    />
  );
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function resolveTimeZone(value: unknown, region: string | undefined): string | undefined {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (candidate) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
      return candidate;
    } catch {
      // Fall through to the workspace-region default.
    }
  }
  return region === "US" ? "America/New_York" : "Australia/Sydney";
}
