import { z } from "zod";

// ---------------------------------------------------------------------------
// Instant Form types — Phase 7.1
// ---------------------------------------------------------------------------

export const FORM_TYPES = ["higher_intent", "more_volume"] as const;
export type FormType = (typeof FORM_TYPES)[number];

export const CONTACT_FIELD_TYPES = [
  "email",
  "full_name",
  "phone",
  "postcode",
  "street_address",
  "city",
  "state",
  "country",
] as const;
export type ContactFieldType = (typeof CONTACT_FIELD_TYPES)[number];

export const QUESTION_TYPES = ["short_answer", "multiple_choice", "conditional"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const ACTION_TYPES = ["visit_website", "call_now", "download", "none"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const contactFieldSchema = z.object({
  type: z.enum(CONTACT_FIELD_TYPES),
  required: z.boolean().default(true),
  label: z.string().optional(),
});

export const customQuestionSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  label: z.string().min(1).max(200),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1)).optional(),
});

export const instantFormSchema = z.object({
  name: z.string().min(1).max(100),
  formType: z.enum(FORM_TYPES),
  intro: z.object({
    headline: z.string().min(1).max(60),
    body: z.string().min(1).max(500),
  }),
  contactFields: z.array(contactFieldSchema).min(1).max(6),
  customQuestions: z.array(customQuestionSchema).max(5),
  privacy: z.object({
    url: z.string().url(),
    linkText: z.string().min(1).max(100),
  }),
  thankYou: z.object({
    title: z.string().min(1).max(60),
    body: z.string().min(1).max(500),
    actionType: z.enum(ACTION_TYPES),
    actionUrl: z.string().optional(),
  }),
});

export type InstantForm = z.infer<typeof instantFormSchema>;

// ---------------------------------------------------------------------------
// Generation input
// ---------------------------------------------------------------------------

export const formGenerationInputSchema = z.object({
  campaignGoal: z.string().min(1).max(200),
  offer: z.string().min(1).max(500),
  creativeContext: z.record(z.string(), z.string()).optional(),
  primaryText: z.string().max(500),
  headline: z.string().max(255),
  description: z.string().max(500),
  cta: z.string().max(50),
  business: z.object({
    name: z.string().min(1).max(200),
    agentName: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  }),
  privacyPolicyUrl: z.string().url(),
  destinationUrl: z.string().url(),
  metaRequirementsVersion: z.string().optional(),
});

export type FormGenerationInput = z.infer<typeof formGenerationInputSchema>;
