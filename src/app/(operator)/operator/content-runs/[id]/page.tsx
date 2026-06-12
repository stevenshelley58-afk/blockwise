import { notFound } from "next/navigation";

import { PageHeading } from "@/components/page-heading";
import { ContentRunReview } from "@/components/operator/content-runs/content-run-review";
import { ServiceRoleRequired } from "@/components/operator/service-role-required";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { ContentRunNotFoundError, loadContentRunBundle } from "@/lib/content-engine";
import { createOperatorSupabaseServiceClient } from "@/lib/operator/service-role";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
};

export default async function OperatorContentRunDetailPage({ params }: PageProps) {
  await requirePageSurfaceAccess("operator");
  const { id } = await Promise.resolve(params);
  const supabase = createOperatorSupabaseServiceClient();
  if (!supabase) {
    return (
      <main className="content">
        <PageHeading
          eyebrow="Draft package review"
          title="Content run unavailable"
          description="Review generated artifacts, prompt/model trace, compliance warnings, and operator approvals before anything can leave draft state."
        />
        <ServiceRoleRequired />
      </main>
    );
  }

  let bundle: Awaited<ReturnType<typeof loadContentRunBundle>>;
  try {
    bundle = await loadContentRunBundle(supabase as never, id);
  } catch (error) {
    if (error instanceof ContentRunNotFoundError) notFound();
    throw error;
  }

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

