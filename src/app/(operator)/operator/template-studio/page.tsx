import Link from "next/link";

import { PageHeading } from "@/components/page-heading";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { studioQueue } from "@/lib/adstudio/v2/studio-queue";

export const dynamic = "force-dynamic";

export default async function TemplateStudioQueuePage() {
  await requirePageSurfaceAccess("operator");
  const templates = studioQueue();

  const byStatus = templates.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1;
    return acc;
  }, {});
  const intents = new Set(templates.map((entry) => entry.intent).filter((intent) => intent && intent !== "other"));

  return (
    <main className="content">
      <PageHeading
        eyebrow="Internal control plane"
        title="Template Studio"
        description="QA queue for v2 layered templates. Drafts need decompose + restyle + a human sign-off at 100% zoom before they can serve customers."
      />
      <p className="mb-4 text-sm text-[var(--muted)]">
        {templates.length} templates · {intents.size} distinct intents ·{" "}
        {Object.entries(byStatus).map(([status, count]) => `${count} ${status}`).join(", ")}
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
            <th className="py-2 pr-4">Template</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Intent</th>
            <th className="py-2 pr-4">Story</th>
            <th className="py-2 pr-4">Baked</th>
            <th className="py-2 pr-4">Worst residual</th>
            <th className="py-2">Restyle</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((entry) => (
            <tr key={entry.id} className="border-b border-[var(--line-soft)]">
              <td className="py-2 pr-4">
                <Link className="font-semibold underline-offset-2 hover:underline" href={`/operator/template-studio/${entry.id}`}>
                  {entry.id}
                </Link>
              </td>
              <td className="py-2 pr-4">{entry.status}</td>
              <td className="py-2 pr-4">{entry.intent}</td>
              <td className="py-2 pr-4">{entry.hasStory ? "yes" : "no"}</td>
              <td className="py-2 pr-4">{entry.bakedCount}</td>
              <td className="py-2 pr-4">{entry.residualMax === null ? "—" : entry.residualMax.toFixed(3)}</td>
              <td className="py-2">{entry.restyleTrivial ? "pending" : "recorded"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
