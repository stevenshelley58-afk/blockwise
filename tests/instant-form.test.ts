import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveFormGenerationInput, generateInstantForm, validateInstantForm } from "../src/lib/adstudio/instant-form-generator.ts";
import type { FormGenerationInput } from "../src/lib/adstudio/instant-form-types.ts";

const validInput: FormGenerationInput = {
  campaignGoal: "Get a free property appraisal",
  offer: "Free home valuation report",
  primaryText: "Thinking of selling?",
  headline: "Free Home Valuation",
  description: "Get an expert valuation of your property.",
  cta: "CONTACT_US",
  business: { name: "Blockwise Real Estate", agentName: "Steve", phone: "0412345678" },
  privacyPolicyUrl: "https://blockwise.sale/privacy",
  destinationUrl: "https://blockwise.sale",
};

describe("Instant Form generator", () => {
  it("generates a valid form from input", () => {
    const { form, issues } = generateInstantForm(validInput);
    assert.equal(issues.length, 0, JSON.stringify(issues));
    assert.ok(form.name.length > 0);
    assert.ok(form.contactFields.length >= 2);
    assert.ok(form.intro.headline.length > 0);
    assert.ok(form.intro.body.length > 0);
    assert.equal(form.privacy.url, validInput.privacyPolicyUrl);
  });

  it("infers higher_intent for appraisal/call goals", () => {
    const { form } = generateInstantForm(validInput);
    assert.equal(form.formType, "higher_intent");
  });

  it("infers more_volume for download/report goals", () => {
    const { form } = generateInstantForm({
      ...validInput,
      campaignGoal: "Download a market report",
      offer: "Free market report PDF",
      cta: "DOWNLOAD",
    });
    assert.equal(form.formType, "more_volume");
  });

  it("includes required contact fields for higher_intent", () => {
    const { form } = generateInstantForm(validInput);
    const types = form.contactFields.map(f => f.type);
    assert.ok(types.includes("email"));
    assert.ok(types.includes("full_name"));
    assert.ok(types.includes("phone"));
  });

  it("rejects prohibited field types", () => {
    const issues = validateInstantForm({
      name: "Test",
      formType: "more_volume",
      intro: { headline: "Hi", body: "Hello" },
      contactFields: [
        { type: "email", required: true },
        { type: "country", required: true },
      ],
      customQuestions: [],
      privacy: { url: "https://example.com/privacy", linkText: "Privacy" },
      thankYou: { title: "Thanks", body: "Done", actionType: "visit_website" },
    });
    assert.ok(issues.some(i => i.code === "prohibited_field"));
  });

  it("rejects prohibited question categories", () => {
    const issues = validateInstantForm({
      name: "Test",
      formType: "more_volume",
      intro: { headline: "Hi", body: "Hello" },
      contactFields: [
        { type: "email", required: true },
        { type: "full_name", required: true },
      ],
      customQuestions: [
        { type: "short_answer", label: "What is your annual income?", required: false },
      ],
      privacy: { url: "https://example.com/privacy", linkText: "Privacy" },
      thankYou: { title: "Thanks", body: "Done", actionType: "visit_website" },
    });
    assert.ok(issues.some(i => i.code === "prohibited_question"));
  });

  it("rejects duplicate contact fields", () => {
    const issues = validateInstantForm({
      name: "Test",
      formType: "more_volume",
      intro: { headline: "Hi", body: "Hello" },
      contactFields: [
        { type: "email", required: true },
        { type: "email", required: false },
        { type: "full_name", required: true },
      ],
      customQuestions: [],
      privacy: { url: "https://example.com/privacy", linkText: "Privacy" },
      thankYou: { title: "Thanks", body: "Done", actionType: "visit_website" },
    });
    assert.ok(issues.some(i => i.code === "duplicate_field"));
  });

  it("rejects missing privacy URL", () => {
    const issues = validateInstantForm({
      name: "Test",
      formType: "more_volume",
      intro: { headline: "Hi", body: "Hello" },
      contactFields: [
        { type: "email", required: true },
        { type: "full_name", required: true },
      ],
      customQuestions: [],
      privacy: { url: "", linkText: "" },
      thankYou: { title: "Thanks", body: "Done", actionType: "visit_website" },
    });
    assert.ok(issues.some(i => i.code === "missing_privacy_url"));
  });

  it("shortens long offer text in form name", () => {
    const { form } = generateInstantForm({
      ...validInput,
      offer: "A".repeat(200),
    });
    assert.ok(form.name.length <= 100 + validInput.business.name.length + 3);
  });
});

describe("deriveFormGenerationInput", () => {
  const context = {
    ad: {
      metaPrimaryText: "Thinking of selling?",
      metaHeadline: "Free Home Valuation",
      metaDescription: "Get an expert valuation of your property.",
      metaCta: "CONTACT_US",
    },
    business: { name: "Blockwise Real Estate", phone: "0412345678" },
    privacyPolicyUrl: "https://blockwise.sale/privacy",
    fallbackGoal: "Real estate ads",
  };

  it("maps ad copy and business state into generator input", () => {
    const input = deriveFormGenerationInput(context);
    assert.equal(input.offer, context.ad.metaHeadline);
    assert.equal(input.campaignGoal, context.ad.metaDescription);
    assert.equal(input.primaryText, context.ad.metaPrimaryText);
    assert.equal(input.cta, context.ad.metaCta);
    assert.equal(input.business.name, context.business.name);
    assert.equal(input.business.phone, context.business.phone);
    assert.equal(input.privacyPolicyUrl, context.privacyPolicyUrl);
    assert.equal(input.destinationUrl, context.privacyPolicyUrl);
  });

  it("falls back to primary text / business name when copy is empty", () => {
    const input = deriveFormGenerationInput({
      ...context,
      ad: { metaPrimaryText: "Book a free appraisal", metaHeadline: "", metaDescription: "", metaCta: "" },
    });
    assert.equal(input.offer, "Book a free appraisal");
    assert.equal(input.campaignGoal, "Book a free appraisal");
    assert.equal(input.cta, "LEARN_MORE");
  });

  it("falls back to business name and fallback goal with no copy at all", () => {
    const input = deriveFormGenerationInput({
      ad: { metaPrimaryText: "", metaHeadline: "", metaDescription: "", metaCta: "" },
      business: { name: "Coastal Realty" },
      privacyPolicyUrl: "",
      fallbackGoal: "Real estate ads",
    });
    assert.equal(input.offer, "Coastal Realty");
    assert.equal(input.campaignGoal, "Real estate ads");
    assert.equal(input.privacyPolicyUrl, "");
    assert.equal(input.destinationUrl, "");
  });

  it("prefers an explicit destination URL over the privacy URL", () => {
    const input = deriveFormGenerationInput({ ...context, destinationUrl: "https://blockwise.sale/" });
    assert.equal(input.destinationUrl, "https://blockwise.sale/");
  });
});

