import { adDocumentSchema, type AdDocumentParsed } from "../../../packages/ad-template-contract/src/schema.ts";
import type { AdTemplate } from "../../../packages/ad-template-contract/src/types.ts";
import { renderPlacement, type RenderOutput } from "../../../packages/ad-template-renderer/src/renderer.ts";
import { containsInlineImageData } from "./persisted-document.ts";
import { sha256Hex } from "./document-token.ts";

export type PreviewDeps = {
  loadAd: (adId: string, workspaceId: string) => Promise<{ templateId: string } | null>;
  loadTemplate: (templateId: string) => Promise<AdTemplate | null>;
  resolveImages: (document: AdDocumentParsed, adId: string, workspaceId: string) => Promise<Record<string, Buffer>>;
};

export async function handleCanonicalPreview(input: {
  adId: string;
  workspaceId: string;
  placement: "feed" | "story";
  document: unknown;
  deps: PreviewDeps;
}): Promise<{ render: RenderOutput; documentHash: string; templateHash: string }> {
  const parsed = adDocumentSchema.safeParse(input.document);
  if (!parsed.success) throw new Error("invalid_preview");
  const document = parsed.data;
  if (containsInlineImageData(document.sharedImageValues)) throw new Error("image_upload_required");
  const ad = await input.deps.loadAd(input.adId, input.workspaceId);
  if (!ad || ad.templateId !== document.templateId) throw new Error("ad_not_found");
  const template = await input.deps.loadTemplate(ad.templateId);
  if (!template) throw new Error("template_not_found");
  const imageValues = await input.deps.resolveImages(document, input.adId, input.workspaceId);
  const textValues = Object.fromEntries(template.textInputs.map(field => [field.key, document.sharedTextValues[field.key] ?? field.placeholder]));
  const render = await renderPlacement({
    template,
    imageValues,
    textValues,
    colourMap: document.resolvedColourMap,
    cropOverrides: input.placement === "feed" ? document.feedCropOverrides : document.storyCropOverrides,
  }, input.placement);
  return { render, documentHash: sha256Hex(document), templateHash: sha256Hex(template) };
}

