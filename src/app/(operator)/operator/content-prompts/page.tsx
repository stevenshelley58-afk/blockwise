import { PageHeading } from "@/components/page-heading";
import { ContentPromptEditor } from "@/components/operator/content-runs/content-prompt-editor";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listPromptSets, listPromptTemplates } from "@/lib/content-engine";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function OperatorContentPromptsPage() {
  await requirePageSurfaceAccess("operator");
  const supabase = createSupabaseServiceClient();
  const [promptSets, promptTemplates] = await Promise.all([
    listPromptSets(supabase as never).catch(() => []),
    listPromptTemplates(supabase as never).catch(() => []),
  ]);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Prompt control"
        title="Content Prompts"
        description="Edit and version the prompts used by the Content-to-Lead workflow. New versions are explicit and do not silently change generated runs."
      />
      <ContentPromptEditor promptSets={promptSets} promptTemplates={promptTemplates} />
    </main>
  );
}

