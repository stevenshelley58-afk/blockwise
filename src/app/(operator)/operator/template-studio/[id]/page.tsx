import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

import { TemplateStudioScreen } from "@/components/operator/template-studio-client";

export const dynamic = "force-dynamic";

export default async function TemplateStudioDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageSurfaceAccess("operator");
  const { id } = await params;
  return (
    <main className="content">
      <TemplateStudioScreen id={id} />
    </main>
  );
}
