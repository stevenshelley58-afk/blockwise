import { MetaMonitorDashboard } from "@/components/monitor/MetaMonitorDashboard";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { getMetaMonitorData } from "@/lib/meta-monitor/getMetaMonitorData";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function MonitorPage() {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const initialPayload = await getMetaMonitorData({
    supabase,
    serviceSupabase: createSupabaseServiceClient(),
    workspaceId: access.workspaceId,
    range: "last_30",
  });

  return <MetaMonitorDashboard initialPayload={initialPayload} />;
}
