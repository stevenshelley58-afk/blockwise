import { createHash } from "node:crypto";

import type { ContentModelPolicy, ContentSkillName } from "./contracts.ts";

type QueryResult<T> = { data: T | null; error: { message: string } | null };

type SupabaseLike = {
  from(table: string): any;
};

export type ResolvedPrompt = {
  templateId: string;
  version: number;
  skillName: ContentSkillName;
  modelPolicy: ContentModelPolicy;
  body: string;
  hash: string;
};

export async function resolvePromptForSkill(input: {
  supabase: SupabaseLike;
  promptSetId: string;
  skillName: ContentSkillName;
  variables: Record<string, unknown>;
  defaultModelPolicy: ContentModelPolicy;
}): Promise<ResolvedPrompt> {
  const itemResult = await input.supabase
    .from("prompt_set_items")
    .select("prompt_template_id,prompt_version,model_policy_id")
    .eq("prompt_set_id", input.promptSetId)
    .eq("skill_name", input.skillName)
    .maybeSingle();

  if (itemResult.error || !itemResult.data) {
    throw new Error(itemResult.error?.message ?? `No prompt set item found for ${input.skillName}.`);
  }

  const templateId = String(itemResult.data.prompt_template_id);
  const templateResult = await input.supabase
    .from("prompt_templates")
    .select("id,skill_name,version,template_body,status")
    .eq("id", templateId)
    .maybeSingle();

  if (templateResult.error || !templateResult.data) {
    throw new Error(templateResult.error?.message ?? `Prompt template ${templateId} was not found.`);
  }

  if (templateResult.data.status === "archived") {
    throw new Error(`Prompt template ${templateId} is archived.`);
  }

  const body = renderPrompt(String(templateResult.data.template_body), input.variables);

  return {
    templateId,
    version: Number(templateResult.data.version ?? itemResult.data.prompt_version ?? 1),
    skillName: input.skillName,
    modelPolicy: parseContentModelPolicy(String(itemResult.data.model_policy_id), input.defaultModelPolicy),
    body,
    hash: createHash("sha256").update(body).digest("hex"),
  };
}

export function renderPrompt(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/gu, (_match, key: string) => stringifyPromptVariable(variables[key]));
}

function stringifyPromptVariable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function parseContentModelPolicy(value: string, fallback: ContentModelPolicy): ContentModelPolicy {
  switch (value) {
    case "best_reasoning":
    case "best_copywriting":
    case "best_json":
    case "best_image_prompting":
    case "best_image_generation":
    case "fast_low_cost":
    case "critic_review":
    case "code_generation":
      return value;
    default:
      return fallback;
  }
}
