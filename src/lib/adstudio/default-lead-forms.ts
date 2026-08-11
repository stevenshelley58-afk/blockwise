export type AdStudioLeadFormPreset = {
  id: string;
  headline: string;
  questions: string[];
  thankYouTitle: string;
  thankYouBodyTemplate: string;
};

export const DEFAULT_LEAD_FORM_PRESETS: readonly AdStudioLeadFormPreset[] = [
  { id: "buyer-register", headline: "Register your interest in this property", questions: ["What is your best contact number?"], thankYouTitle: "Request received", thankYouBodyTemplate: "{agencyName} will be in touch within 24 hours to arrange your {nextStep}." },
  { id: "seller-consult", headline: "Request your free seller consultation", questions: ["What is your best contact number?"], thankYouTitle: "Request received", thankYouBodyTemplate: "{agencyName} will be in touch within 24 hours to arrange your {nextStep}." },
  { id: "appraisal", headline: "Request your free property appraisal", questions: ["What is your best contact number?"], thankYouTitle: "Request received", thankYouBodyTemplate: "{agencyName} will be in touch within 24 hours to arrange your {nextStep}." },
  { id: "content-offer", headline: "Get your free property guide", questions: ["What is your best contact number?"], thankYouTitle: "Request received", thankYouBodyTemplate: "{agencyName} will be in touch within 24 hours to arrange your {nextStep}." },
  { id: "property-details", headline: "Request the property details", questions: ["What is your best contact number?"], thankYouTitle: "Request received", thankYouBodyTemplate: "{agencyName} will be in touch within 24 hours to arrange your {nextStep}." },
] as const;

export const MAX_LEAD_FORM_QUESTIONS = 5;

export function normalizeLeadFormQuestions(questions: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of questions) {
    const question = raw.trim();
    if (!question) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(question);
    if (normalized.length >= MAX_LEAD_FORM_QUESTIONS) break;
  }
  return normalized;
}

export function resolveDefaultLeadFormPreset(template: {
  classification?: { primary_intent?: string } | null;
  name?: string;
}): AdStudioLeadFormPreset {
  const intent = template.classification?.primary_intent?.toLowerCase() ?? "";
  const name = template.name?.toLowerCase() ?? "";
  const matches = (value: string) => intent.includes(value) || name.includes(value);
  const byId = (id: string) => DEFAULT_LEAD_FORM_PRESETS.find((preset) => preset.id === id)!;

  if (matches("appraisal") || matches("rental")) return byId("appraisal");
  if (matches("seller") || matches("downsizer") || matches("investor")) return byId("seller-consult");
  if (matches("buyer")) return byId("buyer-register");
  if (matches("market") || matches("offmarket") || matches("off-market")) return byId("content-offer");
  return byId("property-details");
}

export function renderPresetLeadForm(preset: AdStudioLeadFormPreset, agencyName: string, nextStep: string) {
  return {
    headline: preset.headline,
    questions: [...preset.questions],
    thankYouScreen: {
      title: preset.thankYouTitle,
      body: preset.thankYouBodyTemplate.replaceAll("{agencyName}", agencyName).replaceAll("{nextStep}", nextStep),
    },
  };
}
