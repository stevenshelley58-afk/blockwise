import { PageHeading } from "@/components/page-heading";
import { ContentRunReview } from "@/components/operator/content-runs/content-run-review";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadContentRunBundle } from "@/lib/content-engine";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
};

export default async function OperatorContentRunDetailPage({ params }: PageProps) {
  await requirePageSurfaceAccess("operator");
  const { id } = await Promise.resolve(params);
  const bundle = await loadContentRunBundle(createSupabaseServiceClient() as never, id);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Draft package review"
        title={bundle.run.topic}
        description="Review generated artifacts, prompt/model trace, compliance warnings, and operator approvals before anything can leave draft state."
      />
      <ContentRunReview {...bundle} />
    </main>
  );
}

