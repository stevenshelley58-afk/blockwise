import { notFound, redirect } from "next/navigation";
import type { AdDocumentParsed } from "../../../../../../../packages/ad-template-contract/src/schema";
import type { AdTemplate } from "../../../../../../../packages/ad-template-contract/src/types";
import { VueEditorShell } from "@/components/adstudio/vue-editor/vue-editor-shell";
import { readVueNativeEditor } from "@/components/adstudio/vue-editor/fabric-scene";
import { CustomerAdNotFoundError, InvalidActiveRevisionError, loadCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { loadAdStudioBrandDefaults } from "@/lib/adstudio/brand-defaults";
import { loadAdStudioWorkspaceAssetRows, mediaLibraryAssetForRow } from "@/lib/adstudio/assets";
import { getTemplateForExistingCustomerAd } from "@/lib/adstudio/pack-gallery";
import { loadNativeTrialIdentity } from "@/lib/adstudio/vue-native-copy";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Stock Vue Fabric Editor trial. Only a server-marked trial copy may enter. */
export default async function NativeCanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  let ad;
  try { ad = await loadCustomerAd(supabase, access.workspaceId, id); }
  catch (error) {
    if (error instanceof CustomerAdNotFoundError) notFound();
    if (error instanceof InvalidActiveRevisionError) return <NativeRecovery adId={id} issues={error.issues} />;
    throw error;
  }
  const trial = await loadNativeTrialIdentity(supabase, access.workspaceId, ad.adId);
  const native = readVueNativeEditor(ad.initialDocument);
  // A typed canvas URL for an original must never turn that original into a
  // native document. The explicit trial action creates the marked copy first.
  if (!trial && !native) redirect(`/ad-studio/ads/${encodeURIComponent(ad.adId)}`);
  if (!trial || trial.templateId !== ad.templateId) notFound();

  const pack = await getTemplateForExistingCustomerAd({
    customerSupabase: supabase,
    internalSupabase: createSupabaseServiceClient(),
    workspaceId: access.workspaceId,
    adId: ad.adId,
    templateId: ad.templateId,
  });
  if (!pack) notFound();
  const [brand, rows] = await Promise.all([
    loadAdStudioBrandDefaults(supabase, access.workspaceId),
    loadAdStudioWorkspaceAssetRows(supabase, access.workspaceId),
  ]);
  const libraryAssets = rows.flatMap(row => {
    const asset = mediaLibraryAssetForRow(access.workspaceId, row);
    return asset?.src.startsWith("/") ? [{ id: asset.id, name: asset.label, url: asset.src, thumbnailUrl: asset.src }] : [];
  });
  const initialDocument = ad.initialDocument ?? newDocument(pack);

  return <div className="h-[calc(100dvh-54px-4.75rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)-var(--consent-banner-height,0px))] min-h-[42rem] overflow-hidden md:h-[calc(100dvh-60px)] md:min-h-[36rem]">
    <VueEditorShell
      pack={pack}
      adId={ad.adId}
      workspaceId={access.workspaceId}
      initialDocument={initialDocument}
      initialRevision={ad.revisionNumber ?? 0}
      sourceAdId={trial.sourceAdId}
      businessName={initialDocument.brandBusinessName || brand.businessName}
      logoUrl={brand.logoUrl}
      libraryAssets={libraryAssets}
    />
  </div>;
}

function newDocument(pack: AdTemplate): AdDocumentParsed {
  return {
    schema: "blockwise.ad-document", templateId: pack.templateId,
    sharedImageValues: {}, sharedTextValues: {}, feedCropOverrides: {}, storyCropOverrides: {},
    colourMode: "template", resolvedColourMap: { ...pack.semanticColours },
    metaPrimaryText: pack.metadata.metaCopyDefaults.primaryText[0] ?? "",
    metaHeadline: pack.metadata.metaCopyDefaults.headlines[0] ?? "",
    metaDescription: pack.metadata.metaCopyDefaults.descriptions[0] ?? "",
    metaCta: pack.metadata.metaCopyDefaults.cta || "LEARN_MORE", revision: 1,
  };
}

function NativeRecovery({ adId, issues }: { adId: string; issues: string[] }) {
  return <div className="grid min-h-[50dvh] place-items-center p-6"><div role="alert" className="max-w-lg rounded-(--r-card) border border-(--ui-error)/25 bg-(--ui-error-soft) p-6 text-(--ui-error)"><h1 className="text-[17px] font-extrabold">We couldn&apos;t open this saved ad</h1><p className="mt-2 text-sm">Your native canvas is preserved. Contact support and provide ad ID <code>{adId}</code>.</p>{issues.length ? <ul className="mt-3 list-disc pl-5 text-sm">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}</div></div>;
}
