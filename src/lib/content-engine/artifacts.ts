import type { ContentArtifactType, ContentSkillName } from "./contracts.ts";

export type GeneratedArtifact = {
  artifactType: ContentArtifactType;
  title: string;
  data: Record<string, unknown>;
};

export function artifactsForSkill(skillName: ContentSkillName, output: Record<string, unknown>): GeneratedArtifact[] {
  switch (skillName) {
    case "blockwise-topic-researcher":
      return [{ artifactType: "research_brief", title: "Research brief", data: output }];
    case "blockwise-content-strategist":
      return [{ artifactType: "strategy_brief", title: String(output.blog_title ?? "Strategy brief"), data: output }];
    case "blockwise-blog-writer":
      return [{ artifactType: "blog_draft", title: String(output.title ?? "Blog draft"), data: output }];
    case "blockwise-blog-editor":
      return [{ artifactType: "blog_final", title: "Edited blog", data: output }];
    case "blockwise-blog-formatter":
      return [{ artifactType: "formatted_page", title: String(output.page_title ?? "Formatted page"), data: output }];
    case "blockwise-seo-schema-builder":
      return [{ artifactType: "seo_schema", title: "SEO schema", data: output }];
    case "blockwise-image-brief-writer":
      return [{ artifactType: "image_prompt", title: "Image prompt pack", data: output }];
    case "blockwise-page-builder":
      return [{ artifactType: "formatted_page", title: "Draft page package", data: output }];
    case "blockwise-social-post-generator":
      return [
        { artifactType: "social_facebook", title: "Facebook post", data: asRecord(output.facebook_post) },
        {
          artifactType: "social_instagram",
          title: "Instagram post and story",
          data: {
            instagram_post: output.instagram_post ?? {},
            instagram_story: output.instagram_story ?? {},
            linkedin_optional: output.linkedin_optional ?? {},
          },
        },
      ];
    case "blockwise-lead-ad-generator":
      return [{ artifactType: "lead_ad", title: "Meta lead ad package", data: output }];
    case "blockwise-instant-form-generator":
      return [{ artifactType: "instant_form", title: "Instant Form draft", data: output }];
    case "blockwise-compliance-reviewer":
      return [{ artifactType: "compliance_report", title: "Compliance report", data: output }];
    case "blockwise-agent-reviewer":
      return [{ artifactType: "review_report", title: "Agent review report", data: output }];
    case "blockwise-artifact-packager":
      return [{ artifactType: "artifact_package", title: "Publishing-ready artifact package", data: output }];
    default:
      return [];
  }
}

export function buildLatestArtifactMap(
  rows: Array<{ artifact_type?: string | null; data_json?: unknown; created_at?: string | null }>,
): Record<string, unknown> {
  const sorted = [...rows].sort((left, right) => String(left.created_at ?? "").localeCompare(String(right.created_at ?? "")));
  const artifacts: Record<string, unknown> = {};

  for (const row of sorted) {
    if (row.artifact_type) {
      artifacts[row.artifact_type] = row.data_json ?? {};
    }
  }

  return artifacts;
}

export function artifactVariables(artifacts: Record<string, unknown>): Record<string, unknown> {
  return {
    research_summary: (artifacts.research_brief as { research_summary?: unknown } | undefined)?.research_summary ?? "",
    strategy_brief: artifacts.strategy_brief ?? {},
    article_outline: (artifacts.strategy_brief as { article_outline?: unknown } | undefined)?.article_outline ?? [],
    blog_draft: artifacts.blog_draft ?? {},
    blog_final: artifacts.blog_final ?? {},
    edited_markdown: (artifacts.blog_final as { edited_markdown?: unknown } | undefined)?.edited_markdown ?? "",
    formatted_page: artifacts.formatted_page ?? {},
    image_slots: (artifacts.formatted_page as { image_slots?: unknown } | undefined)?.image_slots ?? [],
    seo_schema: artifacts.seo_schema ?? {},
    instant_form: artifacts.instant_form ?? {},
    artifact_package: artifacts,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

