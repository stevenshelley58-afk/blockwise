/**
 * Operational build queue for the first Ad Studio feed portfolio.
 *
 * The source ads remain private inputs to the v2 builder. This selection index
 * is not a runtime gallery registration or template document; builder output (safe sample,
 * plate, template.json and evidence.json) is intentionally not fabricated
 * here and must be attached by the durable build job before release. Every
 * entry must produce a NEW source-free `adstudio.template.v2` document with
 * native Feed and Story layouts; legacy gallery JSON is evidence only.
 */
export type InitialTemplateBuildQueueEntry = {
  id: string;
  sourceFile: `01_feed_4x5_best/meta_${string}.png`;
  sourceSha256: string;
  evidenceRef: string;
  selectionReason: string;
};

export const initialTemplateBuildQueue: readonly InitialTemplateBuildQueueEntry[] = [
  { id: "meta-feed-180", sourceFile: "01_feed_4x5_best/meta_180.png", sourceSha256: "929ba683dba200ff6a0fde8684ffb465988f7314afc849849374543b2aae625f", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_180.png", selectionReason: "clean listing hero with interior rail and details" },
  { id: "meta-feed-149", sourceFile: "01_feed_4x5_best/meta_149.png", sourceSha256: "110af622424bb8e0e5fb2f9d6ef1987c567e7e59482c86096b4a8d460efedf3b", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_149.png", selectionReason: "split property hero with price and interior rail" },
  { id: "meta-feed-033", sourceFile: "01_feed_4x5_best/meta_033.png", sourceSha256: "c99bd8d9d5e9615c18932456f8285c3f6a47cbf4538a738d759f5592e89a0f90", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_033.png", selectionReason: "modern house hero with photo strip and features" },
  { id: "meta-feed-044", sourceFile: "01_feed_4x5_best/meta_044.png", sourceSha256: "5b3fe382b2b0dfe60f5d21f82671d66d423b4efe2bc4f1e98ab747acf1a5c873", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_044.png", selectionReason: "open-home hero collage with checklist CTA" },
  { id: "meta-feed-021", sourceFile: "01_feed_4x5_best/meta_021.png", sourceSha256: "e6b02d57ecd1ebafa04d7e017bb8deaebdcd67ca8aeeb0e55392792e9b3e484e", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_021.png", selectionReason: "magazine-style market collage and metrics" },
  { id: "meta-feed-006", sourceFile: "01_feed_4x5_best/meta_006.png", sourceSha256: "ca438800de425720d46b811f9fcf2b1f3c6aae8114f070308dee52cac424319e", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_006.png", selectionReason: "editorial interior / buyer-seller education" },
  { id: "meta-feed-039", sourceFile: "01_feed_4x5_best/meta_039.png", sourceSha256: "46b06c29b8c652368f50eded9ebcd8a002b58c93f721c69ac8047a60ef82a342", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_039.png", selectionReason: "information-dense property feature sheet" },
  { id: "meta-feed-062", sourceFile: "01_feed_4x5_best/meta_062.png", sourceSha256: "e7ce1c928dd2710ff61fbea6c85aecf39f9d64b7d17815f00786266f4352b540", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_062.png", selectionReason: "architectural listing with strong hierarchy" },
  { id: "meta-feed-154", sourceFile: "01_feed_4x5_best/meta_154.png", sourceSha256: "a6de2ddce0926887d61e9690a19bd0b7d8da7d7efa463b54ed651e62c62635cd", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_154.png", selectionReason: "interior-design collage with service angle" },
  { id: "meta-feed-108", sourceFile: "01_feed_4x5_best/meta_108.png", sourceSha256: "d3f25a649babf1ab4cf15d349b7bde0cc1515c655cc2485ba0b276e1372840e9", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_108.png", selectionReason: "phone-in-hand seller problem hook" },
  { id: "meta-feed-111", sourceFile: "01_feed_4x5_best/meta_111.png", sourceSha256: "2d263dc76522e6195116d0b90ad6f384f02aac08fa22a2afc6ae3e5704a4e6e8", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_111.png", selectionReason: "apartment inventory / buyer lead card" },
  { id: "meta-feed-182", sourceFile: "01_feed_4x5_best/meta_182.png", sourceSha256: "c846294f742bb137cc45e4648b5ec6f9b84872553f9f1335df73e72bb65f92db", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_182.png", selectionReason: "apartment price matrix and amenity rail" },
  { id: "meta-feed-143", sourceFile: "01_feed_4x5_best/meta_143.png", sourceSha256: "5f21893f2a16edf613d9b2b1a12ca9c133f5199cb1f3e77b94dc2ede7a979ed5", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_143.png", selectionReason: "open-home collage / event response" },
  { id: "meta-feed-145", sourceFile: "01_feed_4x5_best/meta_145.png", sourceSha256: "a02d69ea0ad6472b5253927f7429bdeaf8920de9e3caad2fabb47a73ccc74cdd", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_145.png", selectionReason: "open-home card with agent CTA" },
  { id: "meta-feed-148", sourceFile: "01_feed_4x5_best/meta_148.png", sourceSha256: "dcd46a0f804a900ce38e176abb705b6cb27448782168fddee339c0f2f724fe31", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_148.png", selectionReason: "warm lifestyle seller aspiration" },
  { id: "meta-feed-159", sourceFile: "01_feed_4x5_best/meta_159.png", sourceSha256: "6267d29cc07da5bbf5873f04b0adec787c86d7184f7377f5a770c1fbb3f6ddf8", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_159.png", selectionReason: "dark villa-for-rent editorial" },
  { id: "meta-feed-176", sourceFile: "01_feed_4x5_best/meta_176.png", sourceSha256: "67ed6da6697dd21398f40e8c724de844bb67056b02dda8916affcd2e2e6267ab", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_176.png", selectionReason: "sunset home with price and contact CTA" },
  { id: "meta-feed-194", sourceFile: "01_feed_4x5_best/meta_194.png", sourceSha256: "07bd424d942baa333370c6a8593ebefa228216a944b0c8822f65f7b6414531bc", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_194.png", selectionReason: "aerial estate offer with strong sale CTA" },
  { id: "meta-feed-127", sourceFile: "01_feed_4x5_best/meta_127.png", sourceSha256: "d8251f5d22b924774d6c8e26b0c34b7468d3d07c45fb1248fc669f41f93b088b", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_127.png", selectionReason: "dark just-sold property proof" },
  { id: "meta-feed-199", sourceFile: "01_feed_4x5_best/meta_199.png", sourceSha256: "2f0f173292ebd0c184a7d0543a8a36794ea15a1ca0c40ba219ff80dc0aebd8a0", evidenceRef: "ad-template-sources/candidates-2026-08-24/01_feed_4x5_best/meta_199.png", selectionReason: "stacked interiors with just-listed DM CTA" },
] as const;

if (initialTemplateBuildQueue.length !== 20) {
  throw new Error(`Ad Studio launch build queue must contain exactly 20 templates; got ${initialTemplateBuildQueue.length}.`);
}
