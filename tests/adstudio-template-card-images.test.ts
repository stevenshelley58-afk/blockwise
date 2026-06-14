import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mapAdStudioLibraryTemplate } from "../src/lib/adstudio/index.ts";
import {
  buildTemplateCardPrompt,
  templateCardImageFromBrief,
  templateCardObjectPath,
  templateCardPublicUrl,
} from "../src/lib/adstudio/template-card-prompt.ts";

test("buildTemplateCardPrompt prepends brand direction and includes the mined recipe", () => {
  const prompt = buildTemplateCardPrompt({
    brief_id: "IMG-JUST-SOLD",
    name: "SOLD Stamp Over Property",
    imagery: "The actual sold property, hero angle.",
    ai_prompt_seed: "Celebration proof: bold SOLD sticker across a real recent sale photo.",
  });
  assert.match(prompt, /4:5 vertical real-estate/i);
  assert.match(prompt, /#E7B24B/);
  assert.match(prompt, /SOLD sticker/);
  assert.match(prompt, /Creative recipe:/);
});

test("templateCard URL + object path are stable per brief", () => {
  assert.equal(templateCardObjectPath("IMG-STAT-CARD"), "IMG-STAT-CARD.png");
  assert.equal(
    templateCardPublicUrl("https://x.supabase.co/", "IMG-STAT-CARD"),
    "https://x.supabase.co/storage/v1/object/public/template-cards/IMG-STAT-CARD.png",
  );
  const image = templateCardImageFromBrief("https://x.supabase.co", { brief_id: "IMG-STAT-CARD", name: "Suburb Stat Card" });
  assert.equal(image.label, "Suburb Stat Card");
  assert.match(image.src, /template-cards\/IMG-STAT-CARD\.png$/);
});

test("mapAdStudioLibraryTemplate attaches the brief's generated image when present", () => {
  const row = {
    template_key: "HV-01",
    status: "approved",
    goal: "appraisal_bookings",
    offer_id: "home_value_update",
    headline: "How much is your home worth?",
    image_brief_id: "IMG-HOMEVALUE-Q",
  };
  const briefImage = templateCardImageFromBrief("https://x.supabase.co", { brief_id: "IMG-HOMEVALUE-Q", name: "Home-Value Question Card" });
  const withImage = mapAdStudioLibraryTemplate(row, new Map([["IMG-HOMEVALUE-Q", briefImage]]));
  assert.equal(withImage?.images?.[0]?.src, briefImage.src);
  // Without a map, no generated image is attached (gallery falls back to the static card).
  const withoutImage = mapAdStudioLibraryTemplate(row);
  assert.equal(withoutImage?.images, undefined);
});

test("template-card cron is GET, CRON_SECRET-guarded, and stays idempotent", () => {
  const route = readFileSync("src/app/api/cron/template-card-images/route.ts", "utf8");
  assert.match(route, /export async function GET/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /Bearer \$\{secret\}/);
  // Only briefs without an image are generated unless forced.
  assert.match(route, /\.is\("card_image_path", null\)/);
  assert.match(route, /upsert: true/);
});

test("image provider requests a feed-sized (4:5) output, not square", () => {
  const providers = readFileSync("src/lib/adstudio/ai-providers.ts", "utf8");
  assert.match(providers, /aspectRatio === "4:5"\) return "1024x1280"/);
});

test("the image guard accepts generated template-card creatives", () => {
  const route = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  assert.match(route, /storage\/v1\/object\/public\/template-cards\//);
});

test("template-library route attaches generated brief images with a static fallback", () => {
  const route = readFileSync("src/app/api/adstudio/template-library/route.ts", "utf8");
  assert.match(route, /loadBriefImages/);
  assert.match(route, /mapAdStudioLibraryTemplate\(row, briefImages\)/);
  assert.match(route, /card_image_path/);
});
