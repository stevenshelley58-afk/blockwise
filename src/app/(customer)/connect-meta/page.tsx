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
  if (latest && latest.status === "connected") {
    redirect("/settings#connections");
  }

  const canManage = canManageProviderConnections(access);

  return (
    <main
      aria-label="Share Meta assets"
      className="mx-auto w-full max-w-[760px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16"
    >
      <header className="mb-6">
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
          Meta partner access
        </p>
        <h1 className="mt-1 font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
          Share your Meta assets with Blockwise
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Follow the real Meta screens below to share your ad account, Facebook
          Page, and optional Instagram account. An authorised Blockwise operator
          will verify the exact assets before publishing anything.
        </p>
      </header>

      <ConnectMetaGuide
        workspaceId={access.workspaceId}
        canManage={canManage}
        businessId={getMetaPartnerBusinessId()}
      />
    </main>
  );
}
