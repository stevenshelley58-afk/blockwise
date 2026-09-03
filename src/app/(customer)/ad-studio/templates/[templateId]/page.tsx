import { notFound } from "next/navigation";
import Link from "next/link";
import { createCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { getTemplate } from "@/lib/adstudio/pack-gallery";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

/** Read-only template details; the form is the explicit creation boundary. */
export default async function PackEditorPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { supabase } = await requirePageSurfaceAccess("adstudio");
  const pack = await getTemplate(supabase, templateId);
  if (!pack) notFound();
  const creationKey = crypto.randomUUID();
  return <main className="mx-auto flex min-h-screen max-w-xl items-center p-6"><section className="w-full rounded-(--r-card) border border-border bg-card p-6"><Link href="/ad-studio" className="text-sm text-muted-foreground">← All templates</Link><h1 className="mt-5 text-xl font-semibold">{pack.metadata.title || pack.templateId}</h1><p className="mt-2 text-sm text-muted-foreground">Create a new Feed + Story ad from this template.</p><form action={createAdAction} className="mt-5"><input type="hidden" name="templateId" value={templateId} /><input type="hidden" name="creationKey" value={creationKey} /><button type="submit" className="min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">Create ad</button></form></section></main>;
}

async function createAdAction(formData: FormData) {
  "use server";
  const { redirect } = await import("next/navigation");
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const templateId = String(formData.get("templateId") ?? "");
  const creationKey = String(formData.get("creationKey") ?? "");
  const pack = await getTemplate(supabase, templateId);
  if (!pack) notFound();
  const ad = await createCustomerAd(supabase, access.workspaceId, pack, creationKey || undefined);
  redirect(`/ad-studio/ads/${encodeURIComponent(ad.adId)}`);
}
