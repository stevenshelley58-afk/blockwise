import { MonitorDashboard } from "@/components/monitor/monitor-dashboard";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { buildMonitorDashboardForWorkspace } from "@/lib/monitor/live-dashboard";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

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
