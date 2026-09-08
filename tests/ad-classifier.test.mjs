import assert from "node:assert/strict";
import test from "node:test";

import {
  CLASSIFIER_VERSION,
  classifyCreativeFromSavedEvidence,
} from "../hermes/tools/research-runtime/bin/ad-classifier.mjs";

test("saved-evidence classification reuses deterministic rules and returns a stable result", () => {
  const creative = {
    headline: "Free appraisal for Perth homeowners",
    body: "Find out what your property could actually sell for.",
    format: "image",
  };
  const first = classifyCreativeFromSavedEvidence(creative);
  const second = classifyCreativeFromSavedEvidence(creative);
  assert.deepEqual(first, second);
  assert.equal(first.model, "deterministic-saved-evidence");
  assert.equal(first.evidenceSource, "text");
  assert.equal(first.usedFallback, false);
  assert.equal(first.classification.ad_type, "appraisal");
  assert.equal(first.classification.primary_intent, "appraisal");
  assert.equal(first.classification.classifier_version, CLASSIFIER_VERSION);
});

test("weak saved evidence remains unknown instead of receiving a guessed ad type", () => {
  const result = classifyCreativeFromSavedEvidence({ headline: "Hi" });
  assert.equal(result.evidenceSource, "fallback");
  assert.equal(result.usedFallback, true);
  assert.equal(result.classification.is_real_estate_ad, false);
  assert.equal(result.classification.industry, "unknown");
  assert.equal(result.classification.ad_type, "other");
  assert.equal(result.classification.primary_intent, "other");
  assert.equal(result.classification.property_or_agent_focus, "unknown");
});

test("saved-evidence path does not require captured media", () => {
  const result = classifyCreativeFromSavedEvidence({
    body: "Just sold for $850,000 via auction in Perth.",
    primary_image_url: "https://cdn.invalid/image.jpg",
  });
  assert.equal(result.classification.ad_type, "just_sold");
  assert.equal(result.evidenceSource, "text");
});

test("dynamic placeholders are not treated as settled display evidence", () => {
  const result = classifyCreativeFromSavedEvidence({
    headline: "{{headline}}",
    body: "Campaign {{suburb}}",
  });
  assert.equal(result.classification.ad_type, "other");
  assert.equal(result.classification.is_real_estate_ad, false);
});

test("generic real-estate wording without a supported intent stays unknown", () => {
  const result = classifyCreativeFromSavedEvidence({
    headline: "Real estate services",
    body: "Our property and agency team is here to help.",
  });
  assert.equal(result.classification.ad_type, "agency_brand");
});

test("saved evidence preserves listing, open-home, and sold semantics", () => {
  assert.equal(
    classifyCreativeFromSavedEvidence({ body: "New listing, 4 bedrooms, for sale at 10 King Street." }).classification.ad_type,
    "listing",
  );
  assert.equal(
    classifyCreativeFromSavedEvidence({ body: "Home open this Saturday, inspection from 11am." }).classification.ad_type,
    "open_home",
  );
  assert.equal(
    classifyCreativeFromSavedEvidence({ body: "Just sold for $900,000 via auction." }).classification.ad_type,
    "just_sold",
  );
});
