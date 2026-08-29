import type { InstantForm, FormGenerationInput } from "./instant-form-types";

// ---------------------------------------------------------------------------
// AI Instant Form generator — Phase 7.1
//
// Process:
// 1. Deterministic rules select valid field types, remove prohibited categories
// 2. Cheapest text model drafts the wording (stub: template-based)
// 3. Deterministic validator checks Meta requirements
// 4. Cheap critic checks relevance and duplication
// 5. Stronger model only if validation or critics disagree
// ---------------------------------------------------------------------------

/** Prohibited contact field types (Meta doesn't allow these in lead forms). */
const PROHIBITED_FIELDS = new Set(["country", "street_address"]);

/** Minimum required contact fields per Meta policy. */
const MIN_REQUIRED_FIELDS: Record<string, string[]> = {
  higher_intent: ["email", "full_name", "phone"],
  more_volume: ["email", "full_name"],
};

/** Prohibited question categories. */
const PROHIBITED_QUESTION_PATTERNS = [
  /income|salary|wage|earnings/i,
  /race|ethnicity|religion|nationality/i,
  /health|medical|disability|condition/i,
  /political|vote|party/i,
  /password|login|credential/i,
  /credit.card|bank.account|social.security|passport/i,
];

// ---------------------------------------------------------------------------
// Deterministic field selection
// ---------------------------------------------------------------------------

function selectContactFields(input: FormGenerationInput): InstantForm["contactFields"] {
  const fields: InstantForm["contactFields"] = [];
  const required = MIN_REQUIRED_FIELDS[inferFormType(input)] ?? MIN_REQUIRED_FIELDS.more_volume;

  for (const type of required) {
    if (!PROHIBITED_FIELDS.has(type)) {
      fields.push({ type: type as InstantForm["contactFields"][number]["type"], required: true });
    }
  }

  // Add phone if it's a higher-intent form
  if (inferFormType(input) === "higher_intent" && !fields.find(f => f.type === "phone")) {
    fields.push({ type: "phone", required: false });
  }

  return fields;
}

function inferFormType(input: FormGenerationInput): "higher_intent" | "more_volume" {
  const signal = `${input.campaignGoal} ${input.offer}`.toLowerCase();
  if (/appraisal|valuation|consult|inspection|visit|call/i.test(signal)) return "higher_intent";
  return "more_volume";
}

// ---------------------------------------------------------------------------
// Template-based wording (stub — real AI in production via cheapest text model)
// ---------------------------------------------------------------------------

function generateIntro(input: FormGenerationInput, formType: string): InstantForm["intro"] {
  if (formType === "higher_intent") {
    return {
      headline: `Get your free ${shorten(input.offer, 40)}`,
      body: `Fill in your details and ${input.business.agentName ? `${input.business.agentName} from ` : ""}${input.business.name} will be in touch to ${shorten(input.campaignGoal, 100)}.`,
    };
  }
  return {
    headline: shorten(input.offer, 55),
    body: `Enter your details to ${shorten(input.campaignGoal, 100)}. ${input.business.name} will follow up with more information.`,
  };
}

function generateThankYou(input: FormGenerationInput): InstantForm["thankYou"] {
  return {
    title: "Thank you!",
    body: `We've received your details. ${input.business.name} will be in touch shortly.`,
    actionType: "visit_website",
    actionUrl: input.destinationUrl,
  };
}

// ---------------------------------------------------------------------------
// Deterministic validation
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export function validateInstantForm(form: InstantForm): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Required contact fields check
  const required = MIN_REQUIRED_FIELDS[form.formType] ?? MIN_REQUIRED_FIELDS.more_volume;
  for (const type of required) {
    if (!form.contactFields.find(f => f.type === type)) {
      issues.push({ field: `contactFields.${type}`, code: "missing_required_field", message: `Form must include ${type}`, severity: "error" });
    }
  }

  // Prohibited field types
  for (const field of form.contactFields) {
    if (PROHIBITED_FIELDS.has(field.type)) {
      issues.push({ field: `contactFields.${field.type}`, code: "prohibited_field", message: `${field.type} is not allowed in Meta lead forms`, severity: "error" });
    }
  }

  // Prohibited questions
  for (const q of form.customQuestions) {
    for (const pattern of PROHIBITED_QUESTION_PATTERNS) {
      if (pattern.test(q.label)) {
        issues.push({ field: `customQuestions.${q.label}`, code: "prohibited_question", message: "Question contains prohibited category", severity: "error" });
      }
    }
  }

  // Duplicate contact fields
  const seen = new Set<string>();
  for (const field of form.contactFields) {
    if (seen.has(field.type)) {
      issues.push({ field: `contactFields.${field.type}`, code: "duplicate_field", message: `Duplicate contact field: ${field.type}`, severity: "error" });
    }
    seen.add(field.type);
  }

  // Name length
  if (form.name.length > 100) {
    issues.push({ field: "name", code: "name_too_long", message: "Form name must be under 100 characters", severity: "error" });
  }

  // Privacy URL required
  if (!form.privacy.url) {
    issues.push({ field: "privacy.url", code: "missing_privacy_url", message: "Privacy policy URL is required", severity: "error" });
  } else if (!isHttpsUrl(form.privacy.url)) {
    issues.push({ field: "privacy.url", code: "invalid_privacy_url", message: "Privacy policy must use a valid HTTPS URL", severity: "error" });
  }

  if ((form.thankYou.actionType === "visit_website" || form.thankYou.actionType === "download") && !isHttpsUrl(form.thankYou.actionUrl ?? "")) {
    issues.push({ field: "thankYou.actionUrl", code: "invalid_action_url", message: "Thank-you action must use a valid HTTPS URL", severity: "error" });
  }

  return issues;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateFormOutput {
  form: InstantForm;
  issues: ValidationIssue[];
}

export function generateInstantForm(input: FormGenerationInput): GenerateFormOutput {
  const formType = inferFormType(input);

  const form: InstantForm = {
    name: `${input.business.name} — ${input.offer.slice(0, 50)}`,
    formType,
    intro: generateIntro(input, formType),
    contactFields: selectContactFields(input),
    customQuestions: [],
    privacy: {
      url: input.privacyPolicyUrl,
      linkText: "View our privacy policy",
    },
    thankYou: generateThankYou(input),
  };

  const issues = validateInstantForm(form);

  return { form, issues };
}

// ---------------------------------------------------------------------------
// Input derivation — builds FormGenerationInput from server-side state.
// Pure and isomorphic so the Publish flow can derive + preview drafts from
// the ad row, Brand Pack, and Meta connection without a model call.
// ---------------------------------------------------------------------------

export interface FormGenerationContext {
  ad: {
    metaPrimaryText: string;
    metaHeadline: string;
    metaDescription: string;
    metaCta: string;
  };
  business: {
    name: string;
    agentName?: string;
    phone?: string;
    email?: string;
  };
  privacyPolicyUrl: string;
  destinationUrl?: string;
  /** Fallback campaign goal when the ad has no copy yet (e.g. pack classification). */
  fallbackGoal?: string;
}

export function deriveFormGenerationInput(context: FormGenerationContext): FormGenerationInput {
  const { ad, business } = context;

  const primaryText = ad.metaPrimaryText.trim();
  const headline = ad.metaHeadline.trim();
  const description = ad.metaDescription.trim();

  return {
    campaignGoal: description || primaryText || context.fallbackGoal?.trim() || "Get in touch",
    offer: headline || primaryText || business.name,
    primaryText,
    headline,
    description,
    cta: ad.metaCta.trim() || "LEARN_MORE",
    business: {
      name: business.name,
      agentName: business.agentName?.trim() || undefined,
      phone: business.phone?.trim() || undefined,
      email: business.email?.trim() || undefined,
    },
    privacyPolicyUrl: context.privacyPolicyUrl,
    destinationUrl: context.destinationUrl?.trim() || context.privacyPolicyUrl || "",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3).trimEnd() + "...";
}
