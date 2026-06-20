import { PageHeading } from "@/components/page-heading";
import { ServiceRoleRequired } from "@/components/operator/service-role-required";
import { TemplateSampleConsole, type SampleImportView } from "@/components/operator/template-samples/template-sample-console";
import { creativeSkeletonSchema } from "@/lib/ad-template-library/skeleton";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { createOperatorSupabaseServiceClient } from "@/lib/operator/service-role";

export const dynamic = "force-dynamic";

type SampleImportRow = {
  id: string;
  sample_asset_url: string | null;
  status: string | null;
  candidate_template_key: string | null;
  extracted_json: { skeleton?: unknown } | null;
};

export default async function OperatorTemplateSamplesPage() {
  const { access } = await requirePageSurfaceAccess("operator");
  const supabase = createOperatorSupabaseServiceClient();

  const heading = (
    <PageHeading
      eyebrow="Ad Studio template generator"
      title="Template Samples"
      description="Drop a sample creative (an uploaded PNG or a scraped winning ad) → review the detected slots, copy roles, and classification → approve it into the template library."
    />
  );

  if (!supabase) {
    return (
      <main className="content">
        {heading}
        <ServiceRoleRequired />
      </main>
    );
  }

  const { data } = await supabase
    .schema("research")
    .from("template_sample_imports")
    .select("id, sample_asset_url, status, candidate_template_key, extracted_json")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(50);

  const imports: SampleImportView[] = ((data ?? []) as SampleImportRow[]).flatMap((row) => {
    const parsed = creativeSkeletonSchema.safeParse(row.extracted_json?.skeleton);
    if (!parsed.success || !row.candidate_template_key || !row.sample_asset_url) return [];
    return [
      {
        id: row.id,
        templateKey: row.candidate_template_key,
        status: row.status ?? "draft",
        sampleAssetUrl: row.sample_asset_url,
        skeleton: parsed.data,
      },
    ];
  });

  return (
    <main className="content">
      {heading}
      <TemplateSampleConsole imports={imports} workspaceId={access.workspaceId} />
    </main>
  );
}
