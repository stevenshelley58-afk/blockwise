import { createSupabaseServiceClient } from "@/lib/supabase/service";

type Asset = { kind?: string; contentType?: string; storagePath?: string; byteSize?: number };

async function main() {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("customer_ad_radar_cards")
    .select("page_name, image_storage_path, media_assets")
    .ilike("page_name", "%Agency%")
    .limit(40);

  const rows = (data ?? []) as Array<{ page_name: string; image_storage_path: string | null; media_assets: unknown }>;
  const paths = new Set<string>();
  for (const row of rows) {
    if (row.image_storage_path) paths.add(row.image_storage_path);
    if (Array.isArray(row.media_assets)) {
      for (const asset of row.media_assets as Asset[]) {
        if (asset?.storagePath && (asset.contentType ?? "").startsWith("image/")) paths.add(asset.storagePath);
      }
    }
  }
  console.log("candidate paths:", paths.size);

  for (const path of paths) {
    const { data: blob, error } = await service.storage.from("research-ad-creatives").download(path);
    const size = blob ? Buffer.from(await blob.arrayBuffer()).byteLength : 0;
    console.log(size, error?.message ?? "", path);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
