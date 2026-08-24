import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/202608250001_adstudio_customer_image_uploads.sql", "utf8");
const mediaRoute = readFileSync("src/app/api/adstudio/ads/[id]/media/route.ts", "utf8");
const proxyRoute = readFileSync("src/app/api/adstudio/customer-media/route.ts", "utf8");
const genericMediaRoute = readFileSync("src/app/api/adstudio/media/route.ts", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");

test("customer image migration creates a private, constrained bucket", () => {
  assert.match(migration, /'adstudio-customer-images'[\s\S]*false[\s\S]*10485760/);
  assert.match(migration, /array\['image\/png', 'image\/jpeg', 'image\/webp'\]/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.adstudio_customer_image_uploads from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.adstudio_customer_image_uploads to service_role/);
});

test("customer image ledger has bounded workspace quotas and stale cleanup", () => {
  assert.match(migration, /used_count >= 1000/);
  assert.match(migration, /used_bytes \+ p_byte_size > 262144000/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_workspace_id::text, 0\)\)/);
  assert.match(migration, /status = 'pending'[\s\S]*expires_at < now\(\)/);
  assert.match(migration, /existing_sha256 <> p_sha256 or existing_mime_type <> p_mime_type or existing_byte_size <> p_byte_size/);
  assert.match(migration, /adstudio_prepare_customer_image_upload/);
  assert.match(migration, /adstudio_finalize_customer_image_upload/);
  assert.match(migration, /adstudio_claim_customer_image_finalize/);
  assert.match(migration, /adstudio_discard_customer_image_upload/);
  assert.match(migration, /status in \('pending', 'finalizing', 'deleting', 'finalized'\)/);
  assert.match(migration, /with claimed as \([\s\S]*update public\.adstudio_customer_image_uploads[\s\S]*workspace_id = p_workspace_id[\s\S]*returning id, object_path[\s\S]*from claimed/);
  assert.match(migration, /set status = 'deleting'/);
  assert.match(migration, /existing_status in \('finalizing', 'deleting'\)[\s\S]*upload_cleanup_in_progress/);
  assert.match(migration, /adstudio_complete_customer_image_stale_cleanup/);
  assert.match(migration, /p_reservation_id uuid/);
  assert.match(migration, /where id = p_reservation_id/);
  assert.match(migration, /status in \('pending', 'finalizing', 'deleting'\) and finalized_at is null/);
  assert.match(migration, /status = 'finalizing'[\s\S]*returning id into completed_id/);
  assert.match(migration, /expires_at > now\(\)[\s\S]*status = 'finalizing'/);
  assert.match(migration, /upload_finalization_not_claimed/);
  assert.match(migration, /returns boolean/);
});

test("finalize checks object metadata before downloading bytes", () => {
  const infoIndex = mediaRoute.indexOf("await bucket.info(parsed.path)");
  const downloadIndex = mediaRoute.indexOf("await bucket.download(parsed.path)");
  assert.ok(infoIndex >= 0);
  assert.ok(downloadIndex > infoIndex);
  assert.match(mediaRoute, /infoSize > CUSTOMER_IMAGE_MAX_BYTES/);
  assert.match(mediaRoute, /adstudio_claim_customer_image_finalize/);
  assert.ok(mediaRoute.indexOf("adstudio_claim_customer_image_finalize") < mediaRoute.indexOf("await bucket.info(parsed.path)"));
  assert.match(mediaRoute, /ledgerResult\.status === "finalized"/);
  assert.match(mediaRoute, /adstudio_complete_customer_image_stale_cleanup/);
  assert.match(mediaRoute, /if \(result\.error\)[\s\S]*continue/);
  assert.match(mediaRoute, /p_reservation_id: entry\.id/);
  assert.ok(mediaRoute.indexOf('ledgerResult.status === "finalized"') < mediaRoute.indexOf("createSignedUploadUrl"));
  assert.match(mediaRoute, /createSignedUploadUrl\(parsed\.path, \{ upsert: false \}\)/);
  assert.match(mediaRoute, /p_reservation_id: reservationId/);
  assert.match(mediaRoute, /p_reservation_id: entry\.id/);
  assert.match(mediaRoute, /alreadyUploaded/);
  assert.match(mediaRoute, /const claimed = await discardUpload/);
  assert.match(mediaRoute, /const removed = await removeUploadedObject/);
  assert.ok(mediaRoute.indexOf("const claimed = await discardUpload") < mediaRoute.indexOf("const removed = await removeUploadedObject"));
  assert.match(readFileSync("src/components/adstudio/editor/customer-image-upload.ts", "utf8"), /operation: "discard"/);
  const preparedTokenIndex = mediaRoute.indexOf("createSignedUploadUrl");
  assert.ok(preparedTokenIndex > 0);
  assert.match(readFileSync("src/components/adstudio/editor/customer-image-upload.ts", "utf8"), /upsert: false/);
  assert.match(mediaRoute, /from\(CUSTOMER_IMAGE_BUCKET\)/);
  assert.match(proxyRoute, /from\(CUSTOMER_IMAGE_BUCKET\)/);
  assert.match(proxyRoute, /adstudio_customer_image_uploads/);
  assert.match(proxyRoute, /status", "finalized"/);
  assert.match(genericMediaRoute, /workspace-artifacts/);
  assert.doesNotMatch(genericMediaRoute, /adstudio_customer_image_uploads/);
});

test("AdStudio image routes trace Sharp's Linux runtime on Vercel", () => {
  assert.match(nextConfig, /outputFileTracingIncludes/);
  assert.match(nextConfig, /"\/api\/adstudio\/ads\/\*\/media"/);
  assert.match(nextConfig, /"\/api\/adstudio\/customer-media"/);
  assert.match(nextConfig, /\.\/node_modules\/sharp\/\*\*\/\*/);
  assert.match(nextConfig, /\.\/node_modules\/@img\/sharp-linux-x64\/\*\*\/\*/);
  assert.match(nextConfig, /\.\/node_modules\/@img\/sharp-libvips-linux-x64\/\*\*\/\*/);
});
