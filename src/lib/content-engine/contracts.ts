import { z } from "zod";

export const contentRunStatusSchema = z.enum([
  "queued",
  "researching",
  "briefing",
  "drafting",
  "editing",
  "formatting",
  "image_prompting",
  "image_generation",
  "image_review",
  "page_building",
  "social_generation",
  "ad_generation",
  "compliance_review",
  "final_review",
  "waiting_operator_approval",
  "approved",
  "publish_ready",
  "published",
  "needs_operator_image_review",
  "failed",
]);

export const publishModeSchema = z.enum([
  "draft_only",
  "publish_blog_only",
  "publish_social_only",
  "prepare_ad_only",
  "publish_all_after_approval",
]);

export const contentArtifactTypeSchema = z.enum([
  "research_brief",
  "strategy_brief",
  "blog_draft",
  "blog_final",
  "formatted_page",
  "image_prompt",
  "image_file",
  "seo_schema",
  "social_facebook",
  "social_instagram",
  "lead_ad",
  "instant_form",
  "review_report",
  "compliance_report",
  "artifact_package",
]);

export const contentSkillNameSchema = z.enum([
  "blockwise-topic-researcher",
  "blockwise-content-strategist",
  "blockwise-blog-writer",
  "blockwise-blog-editor",
  "blockwise-blog-formatter",
  "blockwise-seo-schema-builder",
  "blockwise-image-brief-writer",
  "blockwise-page-builder",
  "blockwise-social-post-generator",
  "blockwise-lead-ad-generator",
  "blockwise-instant-form-generator",
  "blockwise-compliance-reviewer",
  "blockwise-agent-reviewer",
  "blockwise-artifact-packager",
]);

export const contentModelPolicySchema = z.enum([
  "best_reasoning",
  "best_copywriting",
  "best_json",
  "best_image_prompting",
  "best_image_generation",
  "fast_low_cost",
  "critic_review",
  "code_generation",
]);

function emptyStringToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

export function deriveTranscriptTopic(transcript: string): string {
  const firstUsefulLine = transcript
    .split(/\r?\n/u)
    .map((line) => line
      .replace(/^\s*(?:\[[^\]]{1,24}\]\s*)?/u, "")
      .replace(/^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?\s*)/u, "")
      .replace(/^\s*[A-Z][A-Za-z0-9 .'-]{0,40}:\s*/u, "")
      .replace(/\s+/gu, " ")
      .trim())
    .find((line) => line.length >= 8);

  if (!firstUsefulLine) return "Transcript-led authority article";
  if (firstUsefulLine.length <= 220) return firstUsefulLine;
  return `${firstUsefulLine.slice(0, 217).trimEnd()}...`;
}

export const createContentRunInputSchema = z.object({
  topic: z.preprocess(emptyStringToUndefined, z.string().trim().min(8).max(220).optional()),
  source_transcript: z.preprocess(emptyStringToUndefined, z.string().trim().min(80).max(100_000).optional()),
  source_url: z.preprocess(emptyStringToUndefined, z.string().trim().url().max(500).optional()),
  target_audience: z.string().min(3).max(160),
  business_goal: z.string().min(3).max(180),
  primary_cta: z.string().min(3).max(120),
  content_angle: z.string().min(3).max(240),
  offer: z.string().min(3).max(160),
  status: z.literal("draft_only").optional(),
  suburb_focus: z.string().trim().max(120).nullable().optional(),
  state_focus: z.string().trim().max(40).nullable().optional(),
  agent_type: z.string().trim().max(120).nullable().optional(),
  tone_profile: z.string().trim().max(160).nullable().optional(),
  word_count: z.coerce.number().int().min(500).max(2600).optional(),
  image_style: z.string().trim().max(240).nullable().optional(),
  meta_budget_hint: z.coerce.number().min(0).max(10000).optional(),
  landing_page_template: z.string().trim().max(80).nullable().optional(),
  publish_target: z.string().trim().max(160).nullable().optional(),
  prompt_set_id: z.string().uuid().optional(),
  prompt_set_name: z.string().trim().max(120).optional(),
  model_policy_id: z.string().trim().max(120).optional(),
  operator_notes: z.string().trim().max(2000).optional(),
}).superRefine((value, context) => {
  if (!value.topic && !value.source_transcript) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source_transcript"],
      message: "Paste a transcript or add a working topic.",
    });
  }
}).transform((value) => ({
  ...value,
  topic: value.topic ?? deriveTranscriptTopic(value.source_transcript ?? ""),
}));

export const approvalPatchSchema = z.object({
  artifactType: contentArtifactTypeSchema,
  status: z.enum(["approved", "rejected", "cancelled"]),
  notes: z.string().max(2000).optional(),
});

export const rerunBodySchema = z.object({
  fromStep: contentSkillNameSchema,
});

export type ContentRunStatus = z.infer<typeof contentRunStatusSchema>;
export type ContentArtifactType = z.infer<typeof contentArtifactTypeSchema>;
export type ContentSkillName = z.infer<typeof contentSkillNameSchema>;
export type ContentModelPolicy = z.infer<typeof contentModelPolicySchema>;
export type CreateContentRunInput = z.infer<typeof createContentRunInputSchema>;
export type PublishMode = z.infer<typeof publishModeSchema>;

export type ContentStepDefinition = {
  skillName: ContentSkillName;
  status: ContentRunStatus;
  defaultModelPolicy: ContentModelPolicy;
};

export const CONTENT_STEPS: ContentStepDefinition[] = [
  { skillName: "blockwise-topic-researcher", status: "researching", defaultModelPolicy: "best_reasoning" },
  { skillName: "blockwise-content-strategist", status: "briefing", defaultModelPolicy: "best_reasoning" },
  { skillName: "blockwise-blog-writer", status: "drafting", defaultModelPolicy: "best_copywriting" },
  { skillName: "blockwise-blog-editor", status: "editing", defaultModelPolicy: "critic_review" },
  { skillName: "blockwise-blog-formatter", status: "formatting", defaultModelPolicy: "best_json" },
  { skillName: "blockwise-seo-schema-builder", status: "formatting", defaultModelPolicy: "best_json" },
  { skillName: "blockwise-image-brief-writer", status: "image_prompting", defaultModelPolicy: "best_image_prompting" },
  { skillName: "blockwise-page-builder", status: "page_building", defaultModelPolicy: "code_generation" },
  { skillName: "blockwise-social-post-generator", status: "social_generation", defaultModelPolicy: "best_copywriting" },
  { skillName: "blockwise-lead-ad-generator", status: "ad_generation", defaultModelPolicy: "best_copywriting" },
  { skillName: "blockwise-instant-form-generator", status: "ad_generation", defaultModelPolicy: "best_json" },
  { skillName: "blockwise-compliance-reviewer", status: "compliance_review", defaultModelPolicy: "critic_review" },
  { skillName: "blockwise-agent-reviewer", status: "final_review", defaultModelPolicy: "best_reasoning" },
  { skillName: "blockwise-artifact-packager", status: "final_review", defaultModelPolicy: "best_json" },
];

export function compactSkillLabel(skillName: ContentSkillName): string {
  return skillName
    .replace(/^blockwise-/u, "")
    .replace(/^blog-/u, "guide-")
    .replace(/-/gu, " ");
}

