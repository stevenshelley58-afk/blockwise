import { notFound } from "next/navigation";

import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { buildTemplateTrace } from "@/lib/operator/template-trace";
import { TemplateTraceCockpit } from "@/components/template-trace/cockpit";

export const dynamic = "force-dynamic";

export default async function TemplateTraceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageSurfaceAccess("operator");
  const { id } = await params;
  const trace = buildTemplateTrace(decodeURIComponent(id));
  if (!trace) notFound();

  return <TemplateTraceCockpit traceId={trace.template.id} />;
}
