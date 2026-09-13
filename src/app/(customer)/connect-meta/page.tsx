import { redirect } from "next/navigation";

import { ConnectMetaGuide } from "@/components/meta/connect-meta-guide";
import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { getMetaPartnerBusinessId } from "@/lib/providers/meta-partner";

export const dynamic = "force-dynamic";

type MetaConnectionRow = { status: string };

export default async function ConnectMetaPage() {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");

  // Build once, redirect when done: an already-connected workspace has no
  // reason to sit on the connect page, so send it to finish publishing setup.
  const { data } = await supabase
    .from("provider_connections")
    .select("status")
    .eq("workspace_id", access.workspaceId)
    .eq("provider", "meta")
    .order("updated_at", { ascending: false })
    .limit(1);

  const latest = (data?.[0] ?? null) as MetaConnectionRow | null;
  const isConnected = latest?.status === "connected";
  if (isConnected) {
    redirect("/settings#connections");
  }

  const canManage = canManageProviderConnections(access);
  const businessId = getMetaPartnerBusinessId();

  return (
    <main
      aria-label="Connect your Meta account"
      className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16"
    >
      <ConnectMetaGuide
        workspaceId={access.workspaceId}
        canManage={canManage}
        isConnected={isConnected}
        businessId={businessId}
      />
    </main>
  );
}
