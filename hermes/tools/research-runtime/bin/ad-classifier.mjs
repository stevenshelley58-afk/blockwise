export const CLASSIFIER_VERSION = "ad-library-classifier-v2";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const REAL_ESTATE_BRANDS =
  /\b(real estate|property|agent|agency|ray white|harcourts|realmark|haiven|whitefox|noble avenue|lj hooker|professionals|belle property|acton|reiwa)\b/iu;

const AD_CLASSIFICATION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "blockwise_ad_classification",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "isRealEstateAd",
        "realEstateRelevance",
        "adType",
        "primaryIntent",
        "propertyOrAgentFocus",
        "hooks",
        "tone",
        "style",
        "audience",
        "suburbSignals",
        "confidence",
        "rejectionReason",
        "rationale",
      ],
      properties: {
        isRealEstateAd: { type: "boolean" },
        realEstateRelevance: {
          type: "string",
          enum: ["agent_brand", "appraisal", "listing", "sold", "rental", "market_update", "irrelevant"],
        },
        adType: {
          type: "string",
          enum: ["appraisal", "listing", "open_home", "just_sold", "property_management", "agency_brand", "market_update", "other"],
        },
        primaryIntent: {
          type: "string",
          enum: ["appraisal", "listing", "open_home", "just_sold", "property_management", "agency_brand", "market_update", "other"],
        },
        propertyOrAgentFocus: { type: "string", enum: ["property", "agent", "agency", "suburb", "unknown"] },
        hooks: { type: "array", items: { type: "string" } },
        tone: { type: "string" },
        style: { type: "string" },
        audience: { type: "string" },
        suburbSignals: { type: "array", items: { type: "string" } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        rejectionReason: { type: ["string", "null"] },
        rationale: { type: "string" },
      },
    },
  },
};

export async function classifyCreativeWithModels(creative, capturedAssets = [], options = {}) {
  const evidenceSource = evidenceSourceForCreative(creative, capturedAssets);
  if (evidenceSource === "unavailable") throw new Error("no_usable_text_or_captured_media");

  const result = await classifyWithOpenAi(creative, capturedAssets, evidenceSource, options);
  return {
    classification: normaliseAdClassification(result.classification, { evidenceSource }),
    model: result.model,
    evidenceSource,
  };
}

export function shouldWaitForMediaClassification(creative, capturedAssets = []) {
  return !hasUsableCreativeCopy(creative) && !hasUsableCapturedMedia(capturedAssets) && hasSourceMedia(creative);
}

export function shouldReclassifyCreative(row, classifierVersion = CLASSIFIER_VERSION) {
  const classification = isObject(row?.classification) ? row.classification : {};
  const status = cleanString(row?.classification_status)?.toLowerCase();
  const adType = normaliseAdType(cleanString(row?.ad_type) ?? cleanString(classification.ad_type) ?? cleanString(classification.adType));
  const primaryIntent = normaliseAdType(
    cleanString(row?.primary_intent) ?? cleanString(classification.primary_intent) ?? cleanString(classification.primaryIntent),
  );

  if (status === "unclassified" || status === "failed") return true;
  if (!Object.keys(classification).length) return true;
  if (classification.classifier_version !== classifierVersion) return true;
  if (!adType || adType === "other") return true;
  if (!primaryIntent || primaryIntent === "other") return true;
  return false;
}

export function normaliseAdClassification(input, options = {}) {
  const source = isObject(input) ? input : {};
  const adType = normaliseAdType(
    cleanString(source.ad_type) ??
      cleanString(source.adType) ??
      cleanString(source.type) ??
      cleanString(source.realEstateRelevance) ??
      "other",
  );
  const primaryIntent = normaliseAdType(
    cleanString(source.primary_intent) ??
      cleanString(source.primaryIntent) ??
      cleanString(source.intent) ??
      adType,
  );
  const isRealEstateAd = Boolean(source.is_real_estate_ad ?? source.isRealEstateAd ?? adType !== "other");
  const confidence = normaliseConfidence(source.confidence);
  const rejectionReason =
    cleanString(source.rejection_reason) ??
    cleanString(source.rejectionReason) ??
    (isRealEstateAd ? null : "Creative was not confidently identified as a real-estate ad.");

  return {
    is_real_estate_ad: isRealEstateAd,
    industry: isRealEstateAd ? "real_estate" : "unknown",
    real_estate_relevance:
      normaliseRelevance(cleanString(source.real_estate_relevance) ?? cleanString(source.realEstateRelevance)) ??
      relevanceForAdType(adType),
    ad_type: adType,
    primary_intent: primaryIntent,
    property_or_agent_focus:
      normaliseFocus(cleanString(source.property_or_agent_focus) ?? cleanString(source.propertyOrAgentFocus)) ?? "unknown",
    hooks: arrayOfStrings(source.hooks),
    tone: cleanString(source.tone) ?? "",
    style: cleanString(source.style) ?? "",
    audience: cleanString(source.audience) ?? "",
    suburb_signals: arrayOfStrings(source.suburb_signals ?? source.suburbSignals),
    confidence,
    rejection_reason: rejectionReason,
    rationale: cleanString(source.rationale) ?? cleanString(source.reasoning) ?? "",
    classifier_version: CLASSIFIER_VERSION,
    evidence_source: options.evidenceSource ?? cleanString(source.evidence_source) ?? cleanString(source.evidenceSource) ?? "unavailable",
  };
}

export function hasUsableCreativeCopy(creative) {
  const text = creativeText(creative);
  const letters = text.match(/[a-z]/giu)?.length ?? 0;
  if (letters < 12) return false;
  if (hasClassificationSignal(text.toLowerCase())) return true;
  return text.split(/\s+/u).filter(Boolean).length >= 8 && letters >= 45;
}

export function hasUnresolvedDynamicPlaceholder(creative) {
  return [
    creative?.headline,
    creative?.body,
    creative?.cta,
    creative?.metadata?.description,
  ].some((value) => /\{\{\s*[a-z0-9_.-]+\s*\}\}/iu.test(cleanString(value) ?? ""));
}

const MIN_DISPLAY_IMAGE_BYTES = 2_048;
const MIN_DISPLAY_IMAGE_WIDTH = 200;
const MIN_DISPLAY_IMAGE_HEIGHT = 150;

export function assessCapturedImageQuality(input = {}) {
  const byteSize = positiveMediaNumber(input.byteSize ?? input.byte_size);
  const width = positiveMediaNumber(input.width);
  const height = positiveMediaNumber(input.height);
  if (byteSize !== null && byteSize < MIN_DISPLAY_IMAGE_BYTES) {
    return { displayable: false, reason: "image_too_small" };
  }
  if (
    (width !== null && width < MIN_DISPLAY_IMAGE_WIDTH) ||
    (height !== null && height < MIN_DISPLAY_IMAGE_HEIGHT)
  ) {
    return { displayable: false, reason: "image_dimensions_too_small" };
  }
  return { displayable: true, reason: null };
}

export function readImageDimensions(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return dimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return readWebpDimensions(buffer);
  }
  if (buffer.length >= 16 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return readIsobmffImageDimensions(buffer);
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return readJpegDimensions(buffer);
  }
  return null;
}

function readIsobmffImageDimensions(buffer) {
  let offset = 0;
  let largest = null;
  const marker = Buffer.from("ispe", "ascii");
  while ((offset = buffer.indexOf(marker, offset)) >= 0) {
    if (offset >= 4 && offset + 16 <= buffer.length && buffer.readUInt32BE(offset - 4) >= 20) {
      const candidate = dimensions(buffer.readUInt32BE(offset + 8), buffer.readUInt32BE(offset + 12));
      if (candidate && (!largest || candidate.width * candidate.height > largest.width * largest.height)) {
        largest = candidate;
      }
    }
    offset += marker.length;
  }
  return largest;
}

function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + segmentLength + 2 > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return dimensions(buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5));
    }
    offset += segmentLength + 2;
  }
  return null;
}

function readWebpDimensions(buffer) {
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && buffer.length >= 30) {
    return dimensions(1 + readUInt24LE(buffer, 24), 1 + readUInt24LE(buffer, 27));
  }
  if (chunk === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return dimensions(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const width = 1 + buffer[21] + ((buffer[22] & 0x3f) << 8);
    const height = 1 + (buffer[22] >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10);
    return dimensions(width, height);
  }
  return null;
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function dimensions(width, height) {
  return width > 0 && height > 0 ? { width, height } : null;
}

export function hasUsableCapturedMedia(capturedAssets = []) {
  return Array.isArray(capturedAssets) && capturedAssets.some((asset) => {
    if (!firstMediaUrl([asset]) && !cleanString(asset?.storage_path)) return false;
    const byteSize = mediaByteSize(asset);
    if (cleanString(asset?.kind)?.toLowerCase() === "image") {
      return assessCapturedImageQuality({ ...asset, byteSize }).displayable;
    }
    return byteSize === null || byteSize >= MIN_DISPLAY_IMAGE_BYTES;
  });
}

export function shouldDisplayClassifiedCreative(creative, capturedAssets = [], classification = {}) {
  const requiresMedia = ["image", "video", "carousel"].includes(cleanString(creative?.format) ?? "");
  const mediaReady = !requiresMedia || hasUsableCapturedMedia(capturedAssets);
  return Boolean(classification?.is_real_estate_ad) && mediaReady && !hasUnresolvedDynamicPlaceholder(creative);
}

async function classifyWithOpenAi(creative, capturedAssets, evidenceSource, options) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const task = evidenceSource === "vision" ? "vision_classification" : "ad_classification";
  const model = modelForTask(env, task);
  const messages = messagesForCreative(creative, capturedAssets, evidenceSource, options);
  let lastContent = "";
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const output = await openAiComplete({
        env,
        fetchImpl,
        model,
        messages:
          attempt === 0
            ? messages
            : [
                ...messages,
                { role: "assistant", content: lastContent },
                { role: "user", content: "Repair the previous answer. Return only valid JSON matching the schema." },
              ],
      });
      lastContent = output.content;
      return { model: output.model, classification: parseClassificationJson(output.content) };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("classification_model_failed");
}

async function openAiComplete({ env, fetchImpl, model, messages }) {
  const apiKey = cleanString(env.OPENAI_API_KEY);
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const response = await fetchImpl(OPENAI_CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 900,
      response_format: AD_CLASSIFICATION_RESPONSE_FORMAT,
    }),
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${JSON.stringify(raw)}`);
  const content = raw?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenAI returned an empty classification");
  return { model, content };
}

function messagesForCreative(creative, capturedAssets, evidenceSource, options) {
  const system = [
    "Classify a Meta real-estate ad for Blockwise filters.",
    "Use exactly one adType and primaryIntent from: appraisal, listing, open_home, just_sold, property_management, agency_brand, market_update, other.",
    "Rules:",
    "- just_sold only for explicit sold results, sold prices, sold via auction, under contract, or successfully sold. Do not use for seller guides or unless sold prior.",
    "- open_home for a listing that contains home-open, open-home, inspection, or viewing times.",
    "- listing for new listing, new to market, for sale, address/specs, set date sale, or property detail ads.",
    "- appraisal for home-worth, valuation, price update, market report, appraisal, or owner value lead ads.",
    "- property_management for landlord, tenant, rental return, rental price check, property manager, vacancy, or maintenance ads.",
    "- agency_brand for seller guides, webinars, testimonials, agent advice, agent profile, auction tips, and market education.",
    "Return JSON only.",
  ].join("\n");
  const payload = {
    headline: creative.headline ?? null,
    body: creative.body ?? null,
    description: creative.metadata?.description ?? null,
    cta: creative.cta ?? null,
    landingUrl: creative.landing_url ?? creative.cta_url ?? null,
    pageName: creative.metadata?.page_name ?? null,
    format: creative.format ?? null,
  };
  const userText = `Creative evidence:\n${JSON.stringify(payload, null, 2)}`;
  if (evidenceSource !== "vision") return [{ role: "system", content: system }, { role: "user", content: userText }];

  const imageUrl = firstMediaUrl(capturedAssets, options);
  if (!imageUrl) throw new Error("vision classification requested without media");
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: `${userText}\nUse the attached creative image because copy is missing or too thin.` },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ];
}

function parseClassificationJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/u);
    if (!match) throw new Error("classification JSON was not parseable");
    return JSON.parse(match[0]);
  }
}

function modelForTask(env, task) {
  const taskModels = parseTaskModels(env.HERMES_MODELS_JSON);
  return cleanString(taskModels[task]) ?? cleanString(env.HERMES_DEFAULT_MODEL) ?? "gpt-5.5";
}

function parseTaskModels(value) {
  if (!cleanString(value)) return {};
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function evidenceSourceForCreative(creative, capturedAssets) {
  if (hasUsableCreativeCopy(creative)) return "text";
  if (hasUsableCapturedMedia(capturedAssets)) return "vision";
  return "unavailable";
}

function firstMediaUrl(capturedAssets, options = {}) {
  for (const asset of capturedAssets) {
    const value =
      cleanString(asset.url) ??
      cleanString(asset.public_url) ??
      cleanString(asset.source_url) ??
      (cleanString(asset.storage_path) && typeof options.storagePublicUrlForPath === "function"
        ? options.storagePublicUrlForPath(asset.storage_path)
        : null);
    if (value) return value;
  }
  return null;
}

function hasSourceMedia(creative) {
  return [
    creative?.primary_image_url,
    ...(Array.isArray(creative?.image_urls) ? creative.image_urls : []),
    creative?.video_url,
    creative?.video_thumbnail_url,
  ].some((value) => /^https?:\/\//iu.test(cleanString(value) ?? ""));
}

function creativeText(creative) {
  return [
    creative?.headline,
    creative?.body,
    creative?.cta,
    creative?.cta_url,
    creative?.landing_url,
    creative?.metadata?.description,
    creative?.metadata?.page_name,
  ]
    .map(cleanString)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasClassificationSignal(text) {
  return (
    hasExplicitSoldResult(text) ||
    hasOpenHomeSignal(text) ||
    hasPropertyManagementSignal(text) ||
    hasAppraisalSignal(text) ||
    hasListingSignal(text) ||
    hasMarketUpdateSignal(text) ||
    hasAgencyBrandSignal(text)
  );
}

function hasExplicitSoldResult(text) {
  if (/\bunless\s+sold\s+prior\b/iu.test(text) && !/\b(sold\s+(?:for|via|under|over|at)|successfully\s+sold|just\s+sold|under\s+contract)\b/iu.test(text)) {
    return false;
  }
  return /\b(just\s+sold|successfully\s+sold|sold\s+(?:for|via|under|over|at)|sold\s*[-|]|under\s+contract|sold\s+under\s+the\s+hammer|#justsold|#sold\b)/iu.test(text);
}

function hasOpenHomeSignal(text) {
  return /\b(open\s+home|home\s+open|home\s+opens|inspection|viewing)\b/iu.test(text);
}

function hasPropertyManagementSignal(text) {
  return /\b(property\s+manager|property\s+management|landlord|tenant|rental\s+(?:price|property|return|management)|free\s+rental\s+price\s+check|vacancy|maintenance|leased\s+at|lease\s+property)\b/iu.test(text);
}

function hasAppraisalSignal(text) {
  return /\b(what'?s\s+your\s+(?:home|property)\s+worth|home\s+value|property\s+value|valuation|price\s+update|property\s+report|market\s+report|sales\s+appraisal|free\s+appraisal|complimentary\s+appraisal|could\s+actually\s+sell\s+for|leaving\s+on\s+the\s+table)\b/iu.test(text);
}

function hasListingSignal(text) {
  return (
    /\b(new\s+listing|just\s+listed|new\s+to\s+market|for\s+sale|set\s+date\s+sale|offers?\s+(?:over|invited|from)|expressions?\s+of\s+interest|\d+\s*bed(?:room)?s?|\d+\s*bath(?:room)?s?|\d+\s*car\b|\d+\s*(?:sqm|m2)\b|property\s+link|price\s+guide|under\s+offer)\b/iu.test(text) ||
    (hasStreetAddressSignal(text) && hasPropertyListingLanguage(text))
  );
}

function mediaByteSize(asset) {
  const value = asset?.byte_size ?? asset?.byteSize;
  return positiveMediaNumber(value);
}

function positiveMediaNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasStreetAddressSignal(text) {
  return /\b\d{1,5}\s+[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3}\s+(?:ave(?:nue)?|boulevard|blvd|circle|cir|close|cl|court|ct|cres(?:cent)?|drive|dr|gardens?|gate|grove|gr|highway|hwy|lane|ln|loop|mews|parade|pde|place|pl|road|rd|rise|street|st|terrace|tce|view|vista|way)\b/iu.test(text);
}

function hasPropertyListingLanguage(text) {
  return /\b(apartment|auction|beautiful\s+family\s+home|development\s+site|duplex|family\s+home|must\s+see|office|prime\s+location|property|residence|townhouse|unit|villa|warehouse)\b/iu.test(text);
}

function hasMarketUpdateSignal(text) {
  return /\b(market\s+update|suburb\s+report|median\s+price|clearance\s+rate|buyer\s+demand|housing\s+crisis|market\s+shifted|12-month\s+growth)\b/iu.test(text);
}

function hasAgencyBrandSignal(text) {
  return (
    /\b(seller\s+guide|real\s+estate\s+book|webinar|testimonial|review|selling\s+tips|auction\s+tips|agent\s+advice|trusted\s+local\s+expertise|profile|team|sell\s+for\s+top\s+dollar|best\s+selling\s+price|selling\s+property|sale\s+campaign)\b/iu.test(text) ||
    REAL_ESTATE_BRANDS.test(text)
  );
}

function normaliseAdType(value) {
  const normalised = cleanString(value)?.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  if (!normalised) return null;
  if (["appraisal", "valuation", "home_value", "property_value", "price_update", "free_appraisal", "generate_appraisals"].includes(normalised)) return "appraisal";
  if (["listing", "listed", "just_listed", "new_listing", "new_to_market", "promote_listing", "win_listings"].includes(normalised)) return "listing";
  if (["open_home", "home_open", "inspection"].includes(normalised)) return "open_home";
  if (["just_sold", "sold", "sold_result", "sale_result", "under_contract"].includes(normalised)) return "just_sold";
  if (["property_mgmt", "property_management", "rental", "lease_property", "rental_management"].includes(normalised)) return "property_management";
  if (["agency_brand", "agent_brand", "agent_branding", "brand", "profile", "build_agent_brand"].includes(normalised)) return "agency_brand";
  if (["market_update", "suburb_report", "market_report"].includes(normalised)) return "market_update";
  if (["other", "unknown", "unclassified"].includes(normalised)) return "other";
  return normalised;
}

function normaliseRelevance(value) {
  const normalised = cleanString(value)?.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  if (!normalised) return null;
  if (["sold", "listing", "appraisal", "rental", "agent_brand", "market_update", "irrelevant"].includes(normalised)) return normalised;
  if (normalised === "real_estate") return "agent_brand";
  return null;
}

function normaliseFocus(value) {
  const normalised = cleanString(value)?.toLowerCase();
  return ["property", "agent", "agency", "suburb", "unknown"].includes(normalised) ? normalised : null;
}

function relevanceForAdType(adType) {
  if (adType === "appraisal") return "appraisal";
  if (adType === "listing" || adType === "open_home") return "listing";
  if (adType === "just_sold") return "sold";
  if (adType === "property_management") return "rental";
  if (adType === "market_update") return "market_update";
  if (adType === "agency_brand") return "agent_brand";
  return "irrelevant";
}

function propertyFocusForText(text, adType) {
  if (["listing", "open_home", "just_sold"].includes(adType)) return "property";
  if (/\b(suburb|postcode|median|market)\b/iu.test(text)) return "suburb";
  if (/\b(agent|team|profile)\b/iu.test(text)) return "agent";
  if (adType === "agency_brand" || adType === "property_management") return "agency";
  return "unknown";
}

function suburbSignalsForText(text) {
  const matches = text.match(/\b(?:Subiaco|Scarborough|Wembley|Leederville|Inglewood|Carrara|Perth|Bayswater|Coolbinia|City Beach|Wembley Downs)\b/giu);
  return [...new Set(matches ?? [])];
}

function deterministicRationale(adType) {
  const reasons = {
    appraisal: "Detected home-worth, valuation, appraisal, market report, or price update language.",
    listing: "Detected new listing, for-sale, property address/specification, or listing campaign language.",
    open_home: "Detected listing copy with open-home, home-open, inspection, or viewing language.",
    just_sold: "Detected explicit sold-result language.",
    property_management: "Detected landlord, tenant, rental return, property manager, or rental price check language.",
    market_update: "Detected market update, suburb report, median price, buyer demand, or market shift language.",
    agency_brand: "Detected seller education, guide, webinar, testimonial, advice, or agent/agency brand language.",
    other: "No strong classifier signal was detected.",
  };
  return reasons[adType] ?? reasons.other;
}

function normaliseConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  if (number > 1) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

function cleanString(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
