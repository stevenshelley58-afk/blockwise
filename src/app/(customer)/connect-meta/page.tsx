import { redirect } from "next/navigation";

import { ConnectMetaGuide } from "@/components/meta/connect-meta-guide";
import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type MetaConnectionRow = { status: string };

type ConnectMetaPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function ConnectMetaPage({ searchParams }: ConnectMetaPageProps) {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const params = searchParams ? await Promise.resolve(searchParams) : {};
  const reconnect = params.reconnect === "1" || params.reconnect === "true";

  // Build once, redirect when done: an already-connected workspace has no
  // reason to sit on the connect page, so send it to finish publishing setup.
  // ?reconnect=1 (the Settings "Reconnect" button) skips the redirect —
  // otherwise Settings → Reconnect → here → Settings is an instant bounce loop.
  const { data } = await supabase
    .from("provider_connections")
    .select("status")
    .eq("workspace_id", access.workspaceId)
    .eq("provider", "meta")
    .order("updated_at", { ascending: false })
    .limit(1);

  const latest = (data?.[0] ?? null) as MetaConnectionRow | null;
  if (latest && latest.status === "connected" && !reconnect) {
    redirect("/settings#connections");
  }

  const canManage = canManageProviderConnections(access);

  return (
    <main
      aria-label="Connect Meta"
      className="mx-auto w-full max-w-[640px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16"
    >
      <header className="mb-6">
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
          Connect → paste → done
        </p>
        <h1 className="mt-1 font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
          Connect your Meta ad account
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Give Blockwise access to your ad account through Meta&apos;s Partners page. No app to install, nothing to
          approve on our side — access is instant once you save.
        </p>
      </header>

      <ConnectMetaGuide workspaceId={access.workspaceId} canManage={canManage} />
    </main>
  );
}
