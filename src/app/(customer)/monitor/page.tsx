import { MonitorDashboard } from "@/ui/monitor/monitor-dashboard";
import { requirePageSurfaceAccess } from "@/modules/auth/page-guards";
import { buildMonitorDashboardForWorkspace } from "@/modules/monitor/live-dashboard";
import { createSupabaseServiceClient } from "@/modules/supabase/service";

export const dynamic = "force-dynamic";

export default async function MonitorPage() {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const initialBundle = await buildMonitorDashboardForWorkspace({
    supabase,
    serviceSupabase: createSupabaseServiceClient(),
    workspaceId: access.workspaceId,
    range: "last_30",
  });

  return <MonitorDashboard initialBundle={initialBundle} />;
}
