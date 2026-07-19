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
          eyebrow="Blockwise field guides"
          title="Transcript to blog"
          description="Paste source material and create a review-ready field guide. Nothing can leave draft state without operator approval."
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
        eyebrow="Blockwise field guides"
        title="Transcript to blog"
        description="Turn one transcript into a sourced, structured field guide and its supporting draft package. Every claim, asset, and publish action stays in operator review."
      />
      <ContentRunConsole runs={runs} promptSets={promptSets} />
    </main>
  );
}

