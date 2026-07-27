import { createClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "../lib/supabase-server-credential.mjs";

const PAGE_SIZE = 500;
const apply = process.argv.includes("--apply");
const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
}

const supabase = createSupabaseServerClient(createClient, supabaseUrl, process.env, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const inactiveAds = await loadAllRows(
  () => supabase
    .schema("research")
    .from("observed_ads")
    .select("id,external_ad_id,active_status,last_seen_at")
    .eq("active_status", "inactive")
    .order("id", { ascending: true }),
);

const missingMedia = await loadAllRows(
  () => supabase
    .schema("research")
    .from("v_operator_missing_media")
    .select("ad_creative_id,observed_ad_id,external_ad_id,page_name,created_at")
    .order("ad_creative_id", { ascending: true }),
);

console.log(JSON.stringify({
  apply,
  confirmedInactive: inactiveAds.length,
  activeMissingMedia: missingMedia.length,
  missingMedia,
}));

if (missingMedia.length > 0) {
  throw new Error(`${missingMedia.length} active ads still need media recovery`);
}

if (!apply || inactiveAds.length === 0) {
  process.exit(0);
}

let deleted = 0;
for (let offset = 0; offset < inactiveAds.length; offset += PAGE_SIZE) {
  const ids = inactiveAds.slice(offset, offset + PAGE_SIZE).map((row) => row.id);
  const { data, error } = await supabase
    .schema("research")
    .from("observed_ads")
    .delete()
    .in("id", ids)
    .eq("active_status", "inactive")
    .select("id");

  if (error) throw new Error(error.message);
  deleted += data?.length ?? 0;
}

if (deleted !== inactiveAds.length) {
  throw new Error(`Inactive ad purge mismatch: selected ${inactiveAds.length}, deleted ${deleted}`);
}

console.log(JSON.stringify({ deletedConfirmedInactive: deleted }));

async function loadAllRows(buildQuery) {
  const rows = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
