/**
 * Operational build queue for the first Ad Studio feed portfolio.
 *
 * The source ads remain private inputs to the v2 builder. This selection index
 * is not a runtime gallery registration or template document; builder output (safe sample,
 * plate, template.json and evidence.json) is intentionally not fabricated
 * here and must be attached by the durable build job before release.
 */
export type InitialTemplateBuildQueueEntry = {
  id: string;
  sourceFile: `01_feed_4x5_best/meta_${string}.png`;
  sourceSha256: string;
  evidenceRef: string;
  selectionReason: string;
};

export const initialTemplateBuildQueue: readonly InitialTemplateBuildQueueEntry[] = [
  { id: "meta-feed-006", sourceFile: "01_feed_4x5_best/meta_006.png", sourceSha256: "ca438800de425720d46b811f9fcf2b1f3c6aae8114f070308dee52cac424319e", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_006.png", selectionReason: "editorial interior / buyer-seller education" },
  { id: "meta-feed-014", sourceFile: "01_feed_4x5_best/meta_014.png", sourceSha256: "5a35c1e80d3354b9b1913929f21c5e17a041bbfcacfa99744325f0dee8e78e97", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_014.png", selectionReason: "clean just-listed hero with agent proof" },
  { id: "meta-feed-021", sourceFile: "01_feed_4x5_best/meta_021.png", sourceSha256: "e6b02d57ecd1ebafa04d7e017bb8deaebdcd67ca8aeeb0e55392792e9b3e484e", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_021.png", selectionReason: "magazine-style market education" },
  { id: "meta-feed-033", sourceFile: "01_feed_4x5_best/meta_033.png", sourceSha256: "c99bd8d9d5e9615c18932456f8285c3f6a47cbf4538a738d759f5592e89a0f90", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_033.png", selectionReason: "dark luxury listing card" },
  { id: "meta-feed-035", sourceFile: "01_feed_4x5_best/meta_035.png", sourceSha256: "7f460eccc4ac5610e92a5be196a2e77e7e782bdf7568df8477131f6737f1bbaf", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_035.png", selectionReason: "bold coastal new-listing editorial" },
  { id: "meta-feed-039", sourceFile: "01_feed_4x5_best/meta_039.png", sourceSha256: "46b06c29b8c652368f50eded9ebcd8a002b58c93f721c69ac8047a60ef82a342", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_039.png", selectionReason: "information-dense property feature sheet" },
  { id: "meta-feed-044", sourceFile: "01_feed_4x5_best/meta_044.png", sourceSha256: "5b3fe382b2b0dfe60f5d21f82671d66d423b4efe2bc4f1e98ab747acf1a5c873", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_044.png", selectionReason: "open-home storefront composition" },
  { id: "meta-feed-056", sourceFile: "01_feed_4x5_best/meta_056.png", sourceSha256: "1a2c8ec4cb9a01695329b67dfee5921c16e34aba7b20baeff116ac2a4983bf65", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_056.png", selectionReason: "map-led land / development offer" },
  { id: "meta-feed-062", sourceFile: "01_feed_4x5_best/meta_062.png", sourceSha256: "e7ce1c928dd2710ff61fbea6c85aecf39f9d64b7d17815f00786266f4352b540", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_062.png", selectionReason: "architectural listing with strong hierarchy" },
  { id: "meta-feed-087", sourceFile: "01_feed_4x5_best/meta_087.png", sourceSha256: "7482e2da2a37848763dc54be7f4505243f7f319dbc3e554edc0202bdfbe04cad", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_087.png", selectionReason: "green residential listing variant" },
  { id: "meta-feed-096", sourceFile: "01_feed_4x5_best/meta_096.png", sourceSha256: "921acf81b468376317534ffe15d4efdbe4305f6aaf0aeb7e024029cfa5995814", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_096.png", selectionReason: "soft luxury just-sold proof" },
  { id: "meta-feed-108", sourceFile: "01_feed_4x5_best/meta_108.png", sourceSha256: "d3f25a649babf1ab4cf15d349b7bde0cc1515c655cc2485ba0b276e1372840e9", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_108.png", selectionReason: "phone-in-hand seller problem hook" },
  { id: "meta-feed-111", sourceFile: "01_feed_4x5_best/meta_111.png", sourceSha256: "2d263dc76522e6195116d0b90ad6f384f02aac08fa22a2afc6ae3e5704a4e6e8", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_111.png", selectionReason: "apartment inventory / buyer lead card" },
  { id: "meta-feed-122", sourceFile: "01_feed_4x5_best/meta_122.png", sourceSha256: "220185fda5203a2889be745ea5fc7158f74eceaef1cccdb119ad86700d9531ff", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_122.png", selectionReason: "coastal listing with image strip" },
  { id: "meta-feed-127", sourceFile: "01_feed_4x5_best/meta_127.png", sourceSha256: "d8251f5d22b924774d6c8e26b0c34b7468d3d07c45fb1248fc669f41f93b088b", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_127.png", selectionReason: "dark just-sold property proof" },
  { id: "meta-feed-143", sourceFile: "01_feed_4x5_best/meta_143.png", sourceSha256: "5f21893f2a16edf613d9b2b1a12ca9c133f5199cb1f3e77b94dc2ede7a979ed5", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_143.png", selectionReason: "open-home collage / event response" },
  { id: "meta-feed-148", sourceFile: "01_feed_4x5_best/meta_148.png", sourceSha256: "dcd46a0f804a900ce38e176abb705b6cb27448782168fddee339c0f2f724fe31", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_148.png", selectionReason: "warm lifestyle seller aspiration" },
  { id: "meta-feed-153", sourceFile: "01_feed_4x5_best/meta_153.png", sourceSha256: "c4bb5a638d5379011a719e74b1bbd8686ace7843cd09c709a7f6487abb9e2011", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_153.png", selectionReason: "modern house listing with strong type block" },
  { id: "meta-feed-159", sourceFile: "01_feed_4x5_best/meta_159.png", sourceSha256: "6267d29cc07da5bbf5873f04b0adec787c86d7184f7377f5a770c1fbb3f6ddf8", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_159.png", selectionReason: "dark villa-for-rent editorial" },
  { id: "meta-feed-182", sourceFile: "01_feed_4x5_best/meta_182.png", sourceSha256: "c846294f742bb137cc45e4648b5ec6f9b84872553f9f1335df73e72bb65f92db", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_182.png", selectionReason: "apartment-for-sale vertical information card" },
] as const;

if (initialTemplateBuildQueue.length !== 20) {
  throw new Error(`Ad Studio launch build queue must contain exactly 20 templates; got ${initialTemplateBuildQueue.length}.`);
}
