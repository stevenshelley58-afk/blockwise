import { isAdStudioImageSrc, isTransientImagePreview } from "./image-src.ts";
import { FIRST_AD_FORMATS, type FirstAdInput } from "./types.ts";

/**
 * What the campaigns route accepts as a first-ad payload. It lives here rather
 * than inside the route module so the New Ad dialog and the tests can hold the
 * generator to the same rules instead of each re-deriving them.
 *
 * One message per reason a customer image cannot be generated from, so the
 * dialog can tell the customer what to do rather than "something went wrong".
 * The accepted source shapes are defined once in `./image-src.ts`.
 */
export function firstAdImageProblem(src: string | undefined): string | null {
  if (isAdStudioImageSrc(src)) return null;
  if (isTransientImagePreview(src)) {
    return "That image is still uploading. Wait for the upload to finish, then generate the ad.";
  }
  if (!src?.trim()) {
    return "Add a required image before generating the ad. Upload a file, choose from library, or generate an image.";
  }
  return "Blockwise can't read one of the selected images. Upload it again or choose another one from your library.";
}

export function validateFirstAd(firstAd: FirstAdInput | undefined): string | null {
  if (!firstAd) return "Choose an ad sample and add your assets before generating.";
  if (!firstAd.description?.trim()) return "Add a short description so Blockwise knows what to write. Include the property, suburb, offer, or key selling point.";
  if (firstAd.description.length > 500) return "Keep the short description to 500 characters or less.";
  const imageProblem = firstAdImageProblem(firstAd.imageDataUrl);
  if (imageProblem) return imageProblem;
  if (firstAd.templateCloneImage && !isAdStudioImageSrc(firstAd.templateCloneImage)) {
    return "Generated template clone is invalid. Generate the ad again.";
  }
  for (const cloneImage of Object.values(firstAd.templateCloneImagesByFormat ?? {})) {
    if (cloneImage && !isAdStudioImageSrc(cloneImage)) return "Generated template clone is invalid. Generate the ad again.";
  }
  for (const slotImage of Object.values(firstAd.imageDataUrls ?? {})) {
    const slotProblem = firstAdImageProblem(slotImage);
    if (slotImage && slotProblem) return slotProblem;
  }
  if (JSON.stringify(firstAd.formats) !== JSON.stringify(FIRST_AD_FORMATS)) {
    return "First ad formats must be Story and Feed.";
  }
  if (!firstAd.templateId?.trim()) return "Selected sample was not found.";
  if (firstAd.generationQuality && !["fast", "high"].includes(firstAd.generationQuality)) {
    return "Choose Fast or High quality generation.";
  }
  if (firstAd.colourSource && !["template", "brand"].includes(firstAd.colourSource)) {
    return "Choose the template colours or your Brand Pack colours.";
  }
  if (firstAd.copy) {
    const fields = [firstAd.copy.primaryText, firstAd.copy.headline, firstAd.copy.description, firstAd.copy.cta];
    if (fields.some((field) => typeof field !== "string" || field.length > 500)) {
      return "Generated copy is invalid. Generate the ad again.";
    }
  }
  for (const value of Object.values(firstAd.onImageCopy ?? {})) {
    if (typeof value !== "string" || value.length > 200) {
      return "Keep each ad text field to 200 characters or less.";
    }
  }
  return null;
}
