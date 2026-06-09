import { redirect } from "next/navigation";

import { PageHeading } from "@/components/page-heading";
import { StartChoice } from "@/components/onboarding/start-choice";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type OnboardingStatus = "not_started" | "fast_path" | "full_setup" | "complete";

function normalizeStatus(value: unknown): OnboardingStatus {
  return value === "fast_path" || value === "full_setup" || value === "complete" ? value : "not_started";
}

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const confirmed = params["confirmed"];
  redirect(confirmed === "1" ? "/self-serve?confirmed=1" : "/self-serve");
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");
  const { data: workspace } = await supabase.from("workspaces").select("*").eq("id", access.workspaceId).maybeSingle();
  const onboardingStatus = normalizeStatus((workspace as { onboarding_status?: unknown } | null)?.onboarding_status);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Start"
        title="What do you want to do first?"
        description="Create an ad now, or take a few minutes to set up your workspace first."
      />

      <StartChoice workspaceId={access.workspaceId} onboardingStatus={onboardingStatus} />

      <section className="panel">
        <h2>Your trial includes 10 free ad packs</h2>
        <p className="item-meta">
          Creating your first ad uses 1 pack. You can connect Meta later when you are ready to publish.
        </p>
      </section>
    </main>
  );
}
