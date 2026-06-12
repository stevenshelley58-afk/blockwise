import { PageHeading } from "@/components/page-heading";
import { ContentRunConsole } from "@/components/operator/content-runs/content-run-console";
import { ServiceRoleRequired } from "@/components/operator/service-role-required";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listContentRuns, listPromptSets } from "@/lib/content-engine";
import { createOperatorSupabaseServiceClient } from "@/lib/operator/service-role";

export const dynamic = "force-dynamic";

export default async function OperatorContentRunsPage() {
  const { access } = await requirePageSurfaceAccess("operator");
  const supabase = createOperatorSupabaseServiceClient();
  if (!supabase) {
    return (
      <main className="content">
        <PageHeading
          eyebrow="Hermes content engine"
          title="Content-to-Lead Runs"
          description="Create one authority topic and review the complete draft package before anything can leave draft state."
        />
        <ServiceRoleRequired />
      </main>
    );
  }
  const [runs, promptSets] = await Promise.all([
    listContentRuns(supabase as never, access.workspaceId).catch(() => []),
    listPromptSets(supabase as never).catch(() => []),
  ]);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Hermes content engine"
        title="Content-to-Lead Runs"
        description="Create one authority topic and review the complete draft package: blog, image briefs, social posts, Meta lead ad, Instant Form, compliance, and approval trace."
      />
      <ContentRunConsole runs={runs} promptSets={promptSets} />
    </main>
  );
}

