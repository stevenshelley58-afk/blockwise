import { generateAuditAds } from "@/lib/audit/audit-ad-engine";
import { loadPostcodeGap } from "@/lib/audit/postcode-gap";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const postcode = process.argv[2] ?? "6000";
const website = process.argv[3]?.trim() || null;
const name = process.argv[4]?.trim() || null;

async function main() {
  const gap = await loadPostcodeGap(postcode);
  console.log("suburb:", gap?.suburb, "ads:", gap?.observedAds);
  console.log("concepts:", gap?.concepts.map((concept) => concept.key).join(" | "));

  const service = createSupabaseServiceClient();
  const bundle = await generateAuditAds(service, {
    website,
    name,
    postcode,
    suburb: gap?.suburb ?? null,
    concepts: gap?.concepts ?? [],
  });

  console.log(JSON.stringify(bundle, null, 2));

  const { writeFileSync } = await import("node:fs");
  for (const ad of bundle.ads) {
    const { data } = await service.storage
      .from("workspace-artifacts")
      .download(`audit-previews/${bundle.auditId}/ad-${ad.index}.png`);
    if (data) {
      writeFileSync(`/tmp/audit-preview-${ad.index}.png`, Buffer.from(await data.arrayBuffer()));
      console.log("wrote /tmp/audit-preview-" + ad.index + ".png");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
