import { spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  resolveSupabaseServerCredential,
} from "./lib/supabase-server-credential.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "artifacts", "meta-app-review");
const secretsDir = path.join(repoRoot, ".secrets");
const defaultBaseUrl = "https://blockwise.sale";
const shortNetworkIdleTimeoutMs = 3000;

loadEnv(path.join(repoRoot, ".vercel", ".env.production.local"));
loadEnv(path.join(repoRoot, ".env.local"));

const baseUrl = trimTrailingSlash(
  process.env.META_REVIEW_BASE_URL ||
    process.env.PLAYWRIGHT_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    defaultBaseUrl,
);
const supabaseUrl = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
const supabaseAnonKey = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);
const supabaseServerCredential = resolveSupabaseServerCredential(process.env);
const supabaseJwtSecret = cleanEnv(process.env.SUPABASE_JWT_SECRET);
const generatedPassword = process.env.META_REVIEW_TEST_PASSWORD || process.env.BLOCKWISE_DEV_PASSWORD || makePassword();
const reviewEmail = process.env.META_REVIEW_TEST_EMAIL || "meta-review@blockwise.sale";
const reviewWorkspaceId = process.env.META_REVIEW_WORKSPACE_ID || "00000000-0000-4000-8000-000000000001";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase URL or anon key in local env files.");
}

mkdirSync(outputDir, { recursive: true });
mkdirSync(secretsDir, { recursive: true });
writeFileSync(path.join(secretsDir, "meta-review-test-password.txt"), `${generatedPassword}\n`, { mode: 0o600 });

seedTestUsers(generatedPassword);

const session = await createSupabaseSession({ email: reviewEmail, password: generatedPassword });
const campaignPack = buildReviewCampaignPack({ workspaceId: reviewWorkspaceId, privacyPolicyUrl: `${baseUrl}/privacy` });
const browserLoginTokenHash = await createMagicLinkTokenHash(reviewEmail);
const videoPath = await recordWalkthrough({ baseUrl, session, workspaceId: reviewWorkspaceId, campaignPack, browserLoginTokenHash });
const mp4Path = await convertToMp4(videoPath);

console.log(JSON.stringify({ baseUrl, videoPath, mp4Path }, null, 2));

function cleanEnv(value) {
  return value?.replace(/^\uFEFF/, "").trim() || "";
}

function trimTrailingSlash(value) {
  return cleanEnv(value).replace(/\/$/, "");
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;

  for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index < 0) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function makePassword() {
  return `MetaReview-${randomBytes(18).toString("base64url")}!`;
}

function seedTestUsers(password) {
  const result = spawnSync(process.execPath, ["scripts/seed-test-users.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BLOCKWISE_DEV_PASSWORD: password,
      BLOCKWISE_OPERATOR_EMAIL: reviewEmail,
    },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Unable to seed test users: ${result.stderr || result.stdout}`);
  }
}

async function createSupabaseSession({ email, password }) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (!error && data.session) {
    return data.session;
  }

  if (!supabaseServerCredential) {
    throw new Error(`Unable to create test session: ${error?.message ?? "No session returned"}`);
  }

  const magicLinkSession = await createMagicLinkSession(email).catch((magicLinkError) => {
    if (!supabaseJwtSecret) throw magicLinkError;
    return null;
  });

  if (magicLinkSession) return magicLinkSession;

  return createSignedServiceSession(email);
}

async function createMagicLinkSession(email) {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const tokenHash = await createMagicLinkTokenHash(email);

  const { data, error } = await client.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });

  if (error || !data.session) {
    throw new Error(`Unable to exchange magic link for session: ${error?.message ?? "No session returned"}`);
  }

  return data.session;
}

async function createMagicLinkTokenHash(email) {
  if (!supabaseServerCredential) {
    throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required to create a browser auth link.");
  }

  const admin = createSupabaseServerClient(createClient, supabaseUrl, process.env, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError) throw linkError;

  const tokenHash =
    link.properties?.hashed_token ||
    link.properties?.action_link?.match(/[?&]token_hash=([^&]+)/)?.[1];

  if (!tokenHash) {
    throw new Error("Supabase did not return a magic-link token hash.");
  }

  return tokenHash;
}

async function createSignedServiceSession(email) {
  const admin = createSupabaseServerClient(createClient, supabaseUrl, process.env, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const user = await findAuthUserByEmail(admin, email);

  if (!user) {
    throw new Error(`Unable to find seeded auth user for ${email}.`);
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 60 * 60;
  const claims = {
    iss: `${supabaseUrl}/auth/v1`,
    sub: user.id,
    aud: "authenticated",
    exp: expiresAt,
    iat: now,
    email: user.email,
    phone: "",
    app_metadata: user.app_metadata ?? { provider: "email", providers: ["email"] },
    user_metadata: user.user_metadata ?? {},
    role: "authenticated",
    aal: "aal1",
    amr: [{ method: "password", timestamp: now }],
    session_id: randomUUID(),
    is_anonymous: false,
  };
  const accessToken = signJwt(claims, supabaseJwtSecret);

  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresAt - now,
    expires_at: expiresAt,
    refresh_token: `meta-review-${randomBytes(24).toString("base64url")}`,
    user,
  };
}

async function findAuthUserByEmail(admin, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) return null;
  }
}

function signJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function buildReviewCampaignPack({ workspaceId, privacyPolicyUrl }) {
  const brandKitId = randomUUID();
  const campaignId = randomUUID();
  const now = new Date().toISOString();
  const brandKit = {
    brandKitId,
    workspaceId,
    source: {
      type: "website",
      url: "https://blockwise.sale/meta-review",
      lastExtractedAt: now,
      pagesScanned: ["https://blockwise.sale"],
    },
    identity: {
      businessName: "Northstar Realty",
      tradingName: "Northstar Realty",
      marketCountry: "AU",
      marketRegion: "WA",
      licenceText: "Licensed real estate agency",
    },
    logos: {
      primaryLogoUrl: null,
      darkLogoUrl: null,
      lightLogoUrl: null,
      faviconUrl: null,
    },
    colours: {
      primary: "#10233F",
      secondary: "#F5F7FA",
      accent: "#16A34A",
      background: "#FFFFFF",
      text: "#111827",
      confidence: {
        primary: 1,
        secondary: 1,
      },
    },
    typography: {
      headingFont: "Inter",
      bodyFont: "Inter",
      fallbackHeading: "sans-serif",
      fallbackBody: "sans-serif",
    },
    visualStyle: {
      styleTags: ["clear", "local", "professional"],
      imageTreatment: "bright editorial property photography",
      layoutDensity: "medium",
      cornerRadius: "small",
    },
    tone: {
      voice: "clear and practical",
      avoid: ["pressure", "guarantees"],
      preferredPhrases: ["local selling plan", "property preparation"],
      sampleCopy: ["Find out what to fix before you sell."],
    },
    assets: {
      headshots: [],
      officeImages: [],
      listingImages: [],
      socialProofImages: [],
    },
    contact: {
      phone: "+61 8 5550 0100",
      email: "hello@blockwise.sale",
      address: "Perth WA",
      socialLinks: [],
    },
    compliance: {
      disclaimers: ["General information only. No sale price guarantee is made."],
      privacyPolicyUrl,
      termsUrl: null,
    },
    reviewStatus: "approved",
    lockedFields: [],
  };
  const campaign = {
    campaignId,
    workspaceId,
    brandKitId,
    name: "Canning Vale seller preparation review",
    goal: "seller_leads",
    market: {
      country: "AU",
      state: "WA",
      city: "Perth",
      suburb: "Canning Vale",
    },
    audienceIntent: "Home owners preparing to sell in the next 3 to 12 months.",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    creativeFormats: ["4:5"],
    status: "ready",
  };
  const angles = [
    {
      angle: "pre_sale_repairs",
      headline: "Know what to fix before you sell",
      offer: "Free pre-sale preparation checklist",
      primary: "Thinking of selling in Canning Vale? Get a practical checklist of repairs and presentation steps before you spend.",
    },
    {
      angle: "local_market_plan",
      headline: "Plan your Canning Vale sale",
      offer: "Local seller planning guide",
      primary: "See the steps local sellers use to prepare, present, and launch a property campaign with less guesswork.",
    },
    {
      angle: "appraisal_ready",
      headline: "Get appraisal-ready faster",
      offer: "Seven day appraisal prep plan",
      primary: "Use a simple seven day plan to tidy the details buyers notice before your appraisal or first open home.",
    },
  ];
  const variants = angles.map((item) => {
    const variantId = randomUUID();
    return {
      variantId,
      campaignId,
      angle: item.angle,
      headline: item.headline,
      offer: item.offer,
      cta: "Download checklist",
      score: {
        score: 86,
        notes: ["Local relevance and lead intent are clear."],
        warnings: [],
        dimensions: {
          offerClarity: 9,
          localRelevance: 9,
          leadIntentStrength: 8,
          brandFit: 8,
          complianceSafety: 9,
          visualHierarchy: 8,
        },
      },
      status: "approved",
      lockedFields: [],
      primary: item.primary,
    };
  });
  const creatives = variants.map((variant) => ({
    creativeId: randomUUID(),
    campaignId,
    variantId: variant.variantId,
    format: "4:5",
    canvas: {
      width: 1080,
      height: 1350,
      backgroundAssetId: null,
      objects: [
        {
          objectId: randomUUID(),
          type: "shape",
          role: "background",
          x: 0,
          y: 0,
          width: 1080,
          height: 1350,
          fill: "#F5F7FA",
          locked: true,
        },
        {
          objectId: randomUUID(),
          type: "text",
          role: "headline",
          content: variant.headline,
          x: 96,
          y: 160,
          width: 820,
          height: 160,
          font: "brand_heading",
          size: 72,
          fill: "#10233F",
          locked: false,
        },
      ],
      fabricJson: null,
    },
    safeZones: {
      metaStory: false,
      googleDemandGen: true,
    },
    previewSvg: "",
  }));
  const copyPacks = variants.map((variant) => ({
    copyPackId: randomUUID(),
    campaignId,
    variantId: variant.variantId,
    meta: {
      platform: "meta",
      specialAdCategory: "housing",
      primaryText: [variant.primary],
      headlines: [variant.headline],
      descriptions: [variant.offer],
      cta: "LEARN_MORE",
      leadForm: {
        headline: variant.offer,
        questions: ["What is your property address?", "When are you thinking of selling?", "What is the best way to contact you?"],
        privacyPolicyUrl,
        thankYouScreen: {
          title: "Thanks, your checklist request is in.",
          body: "Northstar Realty will follow up with the local preparation guide.",
        },
      },
    },
    googleSearch: emptyGoogleSearchPack(),
    googlePmax: emptyGoogleAssetPack("google_pmax"),
    googleDemandGen: emptyGoogleAssetPack("google_demand_gen"),
    landingPage: {
      headline: variant.headline,
      subheadline: variant.offer,
      cta: "Get the checklist",
    },
    followUp: {
      sms: ["Thanks for requesting the Canning Vale seller checklist. We will send the next steps shortly."],
      email: [
        {
          subject: "Your Canning Vale seller checklist",
          body: "Here are the practical preparation steps to review before your appraisal.",
        },
      ],
    },
    lockedFields: [],
  }));

  return {
    brandKit,
    campaign,
    variants: variants.map(({ primary, ...variant }) => variant),
    creatives,
    copyPacks,
    compliance: {
      reportId: randomUUID(),
      campaignId,
      status: "approved",
      issues: [],
      checkedAt: now,
    },
  };
}

function emptyGoogleSearchPack() {
  return {
    platform: "google_search",
    finalUrl: "https://blockwise.sale",
    headlines: [],
    descriptions: [],
    paths: [],
    keywords: [],
    negativeKeywords: [],
  };
}

function emptyGoogleAssetPack(platform) {
  return {
    platform,
    businessName: "Northstar Realty",
    finalUrl: "https://blockwise.sale",
    headlines: [],
    longHeadlines: [],
    descriptions: [],
    images: {
      landscape_1_91: [],
      square_1_1: [],
      portrait_4_5: [],
      vertical_9_16: [],
    },
    logos: {
      square: [],
      landscape: [],
    },
  };
}

async function recordWalkthrough({ baseUrl, session, workspaceId, campaignPack, browserLoginTokenHash }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: outputDir, size: { width: 1440, height: 1000 } },
  });

  await context.addCookies(createSupabaseCookies({ baseUrl, session }));

  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  await gotoStep(page, `${baseUrl}/privacy`, "Privacy policy URL", "Shows the public privacy policy Meta requires in app settings.");
  await acceptCookies(page);
  await pause(page, 2200);

  await gotoStep(
    page,
    `${baseUrl}/data-deletion`,
    "Data deletion URL",
    "Shows the public data deletion page and callback route required by Meta.",
  );
  await pause(page, 2500);

  await authenticateBrowser(page, baseUrl, browserLoginTokenHash, workspaceId);
  await pause(page, 1800);

  await gotoStep(
    page,
    `${baseUrl}/settings`,
    "pages_show_list, pages_read_engagement, ads_read",
    "User opens Settings to connect a Meta ad account, select Page assets, and allow reporting access.",
  );
  await completeMetaSetup(page, workspaceId);
  await scroll(page, 580);
  await pause(page, 3000);

  await highlightConnectMeta(page);
  await pause(page, 2500);

  await showMetaOAuthHandoff(page, workspaceId);
  await pause(page, 2500);

  await gotoStep(
    page,
    `${baseUrl}/results`,
    "ads_read",
    "Monitor reads Meta reporting so the customer can see spend, leads, CPL, and campaign status.",
  );
  await pause(page, 3000);

  await gotoStep(
    page,
    `${baseUrl}/leads`,
    "leads_retrieval",
    "Leads are retrieved from Meta lead forms into the customer workspace for review and follow-up.",
  );
  await pause(page, 3000);

  await gotoStep(
    page,
    `${baseUrl}/ad-studio`,
    "ads_management",
    "Ad Studio creates compliant real-estate creative and prepares the campaign for paused Meta publishing.",
  );
  await pause(page, 2500);
  await clickIfVisible(page, /Publish/i);
  await annotate(page, "ads_management, pages_manage_ads", "Publish flow creates paused campaign, ad set, lead form, creative, and ad objects after approval.");
  await pause(page, 2200);
  await createPublishPlanEvidence(page, { workspaceId, campaignPack });
  await pause(page, 3500);

  await gotoStep(
    page,
    `${baseUrl}/approvals`,
    "Human approval gate",
    "Blockwise queues provider writes for review before any Meta object is published or activated.",
  );
  await pause(page, 2800);

  await annotate(
    page,
    "Review summary",
    "Requested permissions: ads_read, ads_management, business_management, leads_retrieval, pages_manage_ads, pages_show_list, pages_read_engagement.",
  );
  await pause(page, 3500);

  const video = page.video();
  await context.close();
  await browser.close();

  return video.path();
}

async function authenticateBrowser(page, baseUrl, tokenHash, workspaceId) {
  const next = `/settings?workspaceId=${encodeURIComponent(workspaceId)}`;
  await page.goto(
    `${baseUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink&next=${encodeURIComponent(next)}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForLoadState("networkidle", { timeout: shortNetworkIdleTimeoutMs }).catch(() => undefined);
  await page.locator("body").waitFor({ state: "visible" });
  await annotate(
    page,
    "Reviewer workspace signed in",
    "The app confirms the reviewer test user through Supabase and sets the same SSR auth cookies used by protected pages and APIs.",
  );
}

function createSupabaseCookies({ baseUrl, session }) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const encoded = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const expires = Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60;
  const url = new URL(baseUrl);

  return createChunks(storageKey, encoded).map(({ name, value }) => ({
    name,
    value,
    domain: url.hostname,
    path: "/",
    expires,
    httpOnly: false,
    secure: url.protocol === "https:",
    sameSite: "Lax",
  }));
}

function createChunks(key, value, chunkSize = 3180) {
  const encodedValue = encodeURIComponent(value);
  if (encodedValue.length <= chunkSize) return [{ name: key, value }];

  const chunks = [];
  let remaining = encodedValue;

  while (remaining.length > 0) {
    let encodedHead = remaining.slice(0, chunkSize);
    const lastEscape = encodedHead.lastIndexOf("%");
    if (lastEscape > chunkSize - 3) encodedHead = encodedHead.slice(0, lastEscape);

    let decodedHead = "";
    while (encodedHead.length > 0) {
      try {
        decodedHead = decodeURIComponent(encodedHead);
        break;
      } catch (error) {
        if (error instanceof URIError && encodedHead.at(-3) === "%" && encodedHead.length > 3) {
          encodedHead = encodedHead.slice(0, encodedHead.length - 3);
        } else {
          throw error;
        }
      }
    }

    chunks.push(decodedHead);
    remaining = remaining.slice(encodedHead.length);
  }

  return chunks.map((chunk, index) => ({ name: `${key}.${index}`, value: chunk }));
}

async function gotoStep(page, url, title, body) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: shortNetworkIdleTimeoutMs }).catch(() => undefined);
  await page.locator("body").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 80).catch(() => undefined);
  await annotate(page, title, body);
}

async function annotate(page, title, body) {
  await page.evaluate(
    ({ title, body }) => {
      const id = "meta-review-annotation";
      let node = document.getElementById(id);

      if (!node) {
        node = document.createElement("div");
        node.id = id;
        node.style.position = "fixed";
        node.style.left = "24px";
        node.style.top = "24px";
        node.style.zIndex = "2147483647";
        node.style.maxWidth = "560px";
        node.style.padding = "16px 18px";
        node.style.borderRadius = "8px";
        node.style.background = "rgba(8, 12, 20, 0.91)";
        node.style.color = "#fff";
        node.style.boxShadow = "0 18px 50px rgba(0, 0, 0, 0.32)";
        node.style.fontFamily = "Arial, sans-serif";
        node.style.lineHeight = "1.35";
        document.body.appendChild(node);
      }

      node.innerHTML = `
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 0; color: #9ee6c8; margin-bottom: 6px;">Meta App Review Evidence</div>
        <div style="font-size: 22px; font-weight: 700; margin-bottom: 7px;">${escapeHtml(title)}</div>
        <div style="font-size: 16px; color: #e8edf5;">${escapeHtml(body)}</div>
      `;

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }
    },
    { title, body },
  );
}

async function highlightConnectMeta(page) {
  const connectButton = page.getByRole("link", { name: /connect meta/i }).or(page.getByRole("button", { name: /connect meta/i })).first();

  if (!(await connectButton.isVisible().catch(() => false))) {
    await annotate(page, "Meta connection setup", "The Settings screen contains the Meta connection flow used to request the required OAuth permissions.");
    return;
  }

  await connectButton.evaluate((node) => {
    node.scrollIntoView({ block: "center", inline: "center" });
    node.style.outline = "4px solid #22c55e";
    node.style.outlineOffset = "4px";
  });
  await annotate(
    page,
    "Meta OAuth entry point",
    "Connect Meta starts OAuth for ads_read, ads_management, leads_retrieval, pages_manage_ads, pages_show_list, pages_read_engagement, and business_management.",
  );
}

async function completeMetaSetup(page, workspaceId) {
  const result = await page.evaluate(async ({ workspaceId }) => {
    const workspaceQuery = new URLSearchParams({ workspaceId }).toString();
    const setupResponse = await fetch(`/api/integrations/meta/setup?${workspaceQuery}`);
    const setupPayload = await setupResponse.json().catch(() => null);

    if (!setupResponse.ok || !setupPayload?.setup || !setupPayload.assets) {
      return { ready: false, reason: "Meta setup endpoint was not ready." };
    }

    const assets = setupPayload.assets;
    const account = assets.adAccounts?.[0];
    const pageAsset = assets.pages?.[0];
    const pixel = assets.pixels?.[0];
    const setup = {
      ...setupPayload.setup,
      metaAdAccountId: setupPayload.setup.metaAdAccountId || account?.id || "",
      pageId: setupPayload.setup.pageId || pageAsset?.id || "",
      pixelId: setupPayload.setup.pixelId || pixel?.id || null,
      privacyPolicyUrl: setupPayload.setup.privacyPolicyUrl || `${location.origin}/privacy`,
      leadDestination: {
        ...(setupPayload.setup.leadDestination ?? {}),
        type: "manual",
        label: setupPayload.setup.leadDestination?.label || "Manual review",
        config: {
          ...(setupPayload.setup.leadDestination?.config ?? {}),
          endpoint: setupPayload.setup.leadDestination?.config?.endpoint || "",
        },
      },
      currency: setupPayload.setup.currency || account?.currency || "AUD",
      timezone: setupPayload.setup.timezone || account?.timezone || "Australia/Perth",
    };

    const saveResponse = await fetch(`/api/integrations/meta/setup?${workspaceQuery}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, setup }),
    });
    const savePayload = await saveResponse.json().catch(() => null);

    return {
      ready: Boolean(saveResponse.ok && savePayload?.ready),
      blockers: savePayload?.blockers ?? [],
      pageName: pageAsset?.name ?? null,
      accountName: account?.name ?? null,
    };
  }, { workspaceId });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: shortNetworkIdleTimeoutMs }).catch(() => undefined);
  await annotate(
    page,
    result.ready ? "Meta publishing setup complete" : "Meta publishing setup checked",
    result.ready
      ? `Configured Meta ad account, Page${result.pageName ? ` (${result.pageName})` : ""}, lead destination, Pixel, and privacy policy URL.`
      : `Setup still has blockers: ${Array.isArray(result.blockers) ? result.blockers.join(", ") : result.reason}`,
  );
}

async function showMetaOAuthHandoff(page, workspaceId) {
  const origin = new URL(page.url()).origin;
  const response = await page.goto(
    `${origin}/api/integrations/meta/connect?returnPath=%2Fsettings&workspaceId=${encodeURIComponent(workspaceId)}`,
    { waitUntil: "domcontentloaded", timeout: 10_000 },
  ).catch(() => null);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  const hostname = new URL(page.url()).hostname;

  await annotate(
    page,
    "Meta OAuth handoff",
    hostname.includes("facebook.com")
      ? "Blockwise redirects to Facebook OAuth for the requested Marketing API and Page permissions."
      : response?.status() === 302
        ? "Blockwise generated the Meta OAuth authorization redirect for the requested permissions."
        : "OAuth connect route is available; the current recording returns to the already-connected reviewer workspace.",
  );

  await pause(page, 2600);
  await page.goto(`${origin}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: shortNetworkIdleTimeoutMs }).catch(() => undefined);
}

async function createPublishPlanEvidence(page, { workspaceId, campaignPack }) {
  await annotate(
    page,
    "Creating publish plan",
    "The reviewer workspace submits a generated Meta campaign pack to the production publish endpoint.",
  );

  const result = await page.evaluate(async ({ workspaceId, campaignPack }) => {
    const now = new Date();
    const end = new Date(now);
    end.setDate(now.getDate() + 7);
    const variantIds = Array.isArray(campaignPack.variants)
      ? campaignPack.variants
          .map((variant) => variant?.variantId)
          .filter((variantId) => typeof variantId === "string" && variantId.length > 0)
          .slice(0, 3)
      : [];
    const publishResponse = await fetch(
      `/api/adstudio/export-packages/${encodeURIComponent(campaignPack.campaign.campaignId)}/publish?workspaceId=${encodeURIComponent(workspaceId)}`,
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaignPack,
        adapter: "marketing_api",
        requestApproval: true,
        dryRun: false,
        variantIds,
        controls: {
          dailyBudgetMinorUnits: 2000,
          geo: {
            type: "country",
            country: campaignPack.campaign.market?.country ?? "AU",
          },
          schedule: {
            startTime: now.toISOString(),
            endTime: end.toISOString(),
          },
          placements: {
            publisherPlatforms: ["facebook", "instagram"],
            facebookPositions: [],
            instagramPositions: [],
          },
        },
      }),
    });
    const publishPayload = await publishResponse.json().catch(() => ({}));
    const plan = publishPayload.metaPublishPlan;

    if (!publishResponse.ok || !plan?.id) {
      return {
        ok: false,
        stage: "publish",
        status: publishResponse.status,
        campaignName: campaignPack.campaign.name,
        error: publishPayload.error ?? "Publish endpoint did not return a Meta publish plan.",
        blockers: publishPayload.blockers ?? [],
      };
    }

    return {
      ok: true,
      campaignName: campaignPack.campaign.name,
      campaignId: campaignPack.campaign.campaignId,
      publishReady: Boolean(publishPayload.publishReady),
      providerWritesEnabled: Boolean(publishPayload.providerWritesEnabled),
      blockers: publishPayload.blockers ?? [],
      plan: {
        id: plan.id,
        status: plan.status,
        approvalRequestId: plan.approvalRequestId,
        plannedObjects: plan.plannedObjects,
        variantIds: plan.variantIds ?? [],
      },
    };
  }, { workspaceId, campaignPack });

  if (!result.ok) {
    await annotate(
      page,
      "Publish plan blocker",
      `${result.stage} returned ${result.status}: ${result.error}${result.blockers?.length ? ` Blockers: ${result.blockers.join(", ")}` : ""}`,
    );
    return result;
  }

  const objects = result.plan.plannedObjects ?? {};
  await annotate(
    page,
    "Publish plan and approval request",
    [
      `Created Meta publish plan ${shortId(result.plan.id)} for "${result.campaignName}".`,
      `Approval request ${shortId(result.plan.approvalRequestId)} is queued.`,
      `Planned paused objects: ${objects.adSets ?? 0} ad set, ${objects.leadForms ?? 0} lead form, ${objects.creatives ?? 0} creative, ${objects.ads ?? 0} ads.`,
      result.publishReady
        ? "Approved plans can be queued for Meta provider writes."
        : `Provider writes remain approval-gated: ${result.blockers.join(", ") || "review required"}.`,
    ].join(" "),
  );

  return result;
}

function shortId(value) {
  return typeof value === "string" && value.length > 8 ? value.slice(0, 8) : String(value ?? "none");
}

async function clickIfVisible(page, label) {
  const button = page.getByRole("button", { name: label }).first();
  if ((await button.isVisible().catch(() => false)) && (await button.isEnabled().catch(() => false))) {
    await button.click({ timeout: 2500 }).catch(() => undefined);
  }
}

async function acceptCookies(page) {
  const button = page.getByRole("button", { name: /accept all/i }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await page.waitForTimeout(600);
  }
}

async function scroll(page, amount) {
  await page.mouse.wheel(0, amount);
  await page.waitForTimeout(900);
}

async function pause(page, ms) {
  await page.waitForTimeout(ms);
}

async function convertToMp4(webmPath) {
  const mp4Path = path.join(outputDir, `meta-app-review-${timestamp}.mp4`);
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-i", webmPath, "-movflags", "+faststart", "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", mp4Path],
    { cwd: repoRoot, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`ffmpeg conversion failed: ${result.stderr || result.stdout}`);
  }

  return mp4Path;
}
