#!/usr/bin/env node

const supabaseUrl = (process.env.HERMES_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/u, "");
const serviceRoleKey = process.env.HERMES_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("missing supabase env");
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Accept-Profile": "research",
  "Content-Profile": "research",
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} failed ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

const suspectNames = ["Kind Patches"];
let rejectedPages = 0;
let hiddenCreatives = 0;

for (const name of suspectNames) {
  const pages = await rest(`advertiser_pages?select=id,page_name&page_name=eq.${encodeURIComponent(name)}`);
  for (const page of pages || []) {
    await rest(`advertiser_pages?id=eq.${page.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "rejected_non_real_estate",
        metadata: { rejected_by: "hermes-safety-check", rejection_reason: "exact-name resolver produced a non-real-estate Meta page name" },
      }),
    });
    rejectedPages += 1;

    const ads = await rest(`observed_ads?select=id&advertiser_page_id=eq.${page.id}&limit=1000`);
    for (const ad of ads || []) {
      await rest(`ad_creatives?observed_ad_id=eq.${ad.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          classification_status: "classified",
          display_state: "hidden",
          classification: {
            is_real_estate_ad: false,
            real_estate_relevance: "irrelevant",
            ad_type: "other",
            primary_intent: "other",
            rejection_reason: "Advertiser page rejected as non-real-estate.",
          },
        }),
      });
      hiddenCreatives += 1;
    }
  }
}

const leaked = await rest("v_customer_meta_ad_library_cards?select=page_name,library_id&page_name=ilike.*Kind%20Patches*&limit=10");
console.log(JSON.stringify({ rejectedPages, hiddenCreatives, leakedCustomerRows: leaked.length }));
