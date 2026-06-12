import type { CreateContentRunInput } from "./contracts.ts";

type QueryResult<T> = { data: T | null; error: { message: string } | null };
type QueryRows<T> = { data: T[] | null; error: { message: string } | null };

export class ContentRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Content run not found: ${runId}`);
    this.name = "ContentRunNotFoundError";
  }
}

export type ContentRunRow = {
  id: string;
  workspace_id: string;
  operator_user_id: string | null;
  topic: string;
  target_audience: string;
  business_goal: string;
  content_angle: string;
  offer: string;
  primary_cta: string;
  prompt_set_id: string | null;
  model_policy_id: string;
  publish_mode: string;
  status: string;
  current_step: string | null;
  input_json: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ContentArtifactRow = {
  id: string;
  content_run_id: string;
  artifact_type: string;
  title: string;
  status: string;
  data_json: unknown;
  model_used: string | null;
  prompt_template_id: string | null;
  prompt_version: number | null;
  created_at: string;
};

export type ContentReviewRow = {
  id: string;
  content_run_id: string;
  review_type: string;
  reviewer_type: string;
  score: number | null;
  status: string;
  issues_json: unknown;
  required_changes_json: unknown;
  created_at: string;
};

export type PromptSetRow = {
  id: string;
  name: string;
  description: string;
  status: string;
};

export type PromptTemplateRow = {
  id: string;
  key: string;
  name: string;
  skill_name: string;
  description: string;
  template_body: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ContentRepositoryClient = {
  from(table: string): any;
};

export async function loadDefaultPromptSet(supabase: ContentRepositoryClient): Promise<PromptSetRow> {
  const result = await queryMaybeSingle<PromptSetRow>(
    supabase
      .from("prompt_sets")
      .select("id,name,description,status")
      .eq("name", "default-blockwise-authority-v1")
      .eq("status", "active"),
  );

  if (!result) {
    throw new Error("Default content prompt set is missing. Run the content engine migration.");
  }

  return result;
}

export async function createContentRunRecord(input: {
  supabase: ContentRepositoryClient;
  workspaceId: string;
  operatorUserId: string;
  body: CreateContentRunInput;
}): Promise<ContentRunRow> {
  const promptSetId = input.body.prompt_set_id ?? (await loadDefaultPromptSet(input.supabase)).id;
  const result = await querySingle<ContentRunRow>(
    input.supabase
      .from("content_runs")
      .insert({
        workspace_id: input.workspaceId,
        operator_user_id: input.operatorUserId,
        topic: input.body.topic,
        target_audience: input.body.target_audience,
        business_goal: input.body.business_goal,
        content_angle: input.body.content_angle,
        offer: input.body.offer,
        primary_cta: input.body.primary_cta,
        prompt_set_id: promptSetId,
        model_policy_id: input.body.model_policy_id ?? "best-available-balanced",
        publish_mode: "draft_only",
        status: "queued",
        input_json: input.body,
      })
      .select("*")
      .single(),
  );

  return result;
}

export async function loadContentRun(
  supabase: ContentRepositoryClient,
  runId: string,
): Promise<ContentRunRow> {
  const run = await queryMaybeSingle<ContentRunRow>(
    supabase.from("content_runs").select("*").eq("id", runId).maybeSingle(),
  );
  if (!run) throw new ContentRunNotFoundError(runId);
  return run;
}

export async function listContentRuns(
  supabase: ContentRepositoryClient,
  workspaceId: string,
): Promise<ContentRunRow[]> {
  return queryRows<ContentRunRow>(
    supabase
      .from("content_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
  );
}

export async function loadContentRunBundle(
  supabase: ContentRepositoryClient,
  runId: string,
): Promise<{
  run: ContentRunRow;
  artifacts: ContentArtifactRow[];
  reviews: ContentReviewRow[];
  approvals: Array<Record<string, unknown>>;
  promptRuns: Array<Record<string, unknown>>;
}> {
  const run = await loadContentRun(supabase, runId);
  const [artifacts, reviews, approvals, promptRuns] = await Promise.all([
    queryRows<ContentArtifactRow>(
      supabase.from("content_artifacts").select("*").eq("content_run_id", runId).order("created_at", { ascending: false }),
    ),
    queryRows<ContentReviewRow>(
      supabase.from("content_reviews").select("*").eq("content_run_id", runId).order("created_at", { ascending: false }),
    ),
    queryRows<Record<string, unknown>>(
      supabase.from("operator_approvals").select("*").eq("content_run_id", runId).order("created_at", { ascending: false }),
    ),
    queryRows<Record<string, unknown>>(
      supabase.from("prompt_runs").select("*").eq("content_run_id", runId).order("created_at", { ascending: false }),
    ),
  ]);

  return { run, artifacts, reviews, approvals, promptRuns };
}

export async function updateContentRunStatus(input: {
  supabase: ContentRepositoryClient;
  runId: string;
  status: string;
  currentStep?: string | null;
  errorMessage?: string | null;
  completed?: boolean;
}): Promise<void> {
  await expectOk(
    input.supabase
      .from("content_runs")
      .update({
        status: input.status,
        current_step: input.currentStep ?? null,
        error_message: input.errorMessage ?? null,
        updated_at: new Date().toISOString(),
        completed_at: input.completed ? new Date().toISOString() : null,
      })
      .eq("id", input.runId),
  );
}

export async function insertContentArtifact(input: {
  supabase: ContentRepositoryClient;
  workspaceId: string;
  runId: string;
  artifactType: string;
  title: string;
  data: Record<string, unknown>;
  modelUsed: string;
  promptTemplateId: string;
  promptVersion: number;
}): Promise<void> {
  await expectOk(
    input.supabase.from("content_artifacts").insert({
      workspace_id: input.workspaceId,
      content_run_id: input.runId,
      artifact_type: input.artifactType,
      title: input.title,
      status: "generated",
      data_json: input.data,
      model_used: input.modelUsed,
      prompt_template_id: input.promptTemplateId,
      prompt_version: input.promptVersion,
      updated_at: new Date().toISOString(),
    }),
  );
}

export async function insertPromptRun(input: {
  supabase: ContentRepositoryClient;
  workspaceId: string;
  runId: string;
  promptTemplateId: string;
  promptVersion: number;
  skillName: string;
  promptHash: string;
  provider: string;
  modelUsed: string;
  modelPolicyId: string;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown>;
}): Promise<void> {
  await expectOk(
    input.supabase.from("prompt_runs").insert({
      workspace_id: input.workspaceId,
      content_run_id: input.runId,
      prompt_template_id: input.promptTemplateId,
      prompt_version: input.promptVersion,
      skill_name: input.skillName,
      resolved_prompt_hash: input.promptHash,
      provider: input.provider,
      model_used: input.modelUsed,
      model_policy_id: input.modelPolicyId,
      input_json: input.inputJson,
      output_json: input.outputJson,
    }),
  );
}

export async function insertContentReview(input: {
  supabase: ContentRepositoryClient;
  workspaceId: string;
  runId: string;
  reviewType: string;
  reviewerType: "ai" | "operator";
  score?: number | null;
  status: string;
  issues?: unknown[];
  requiredChanges?: unknown[];
}): Promise<void> {
  await expectOk(
    input.supabase.from("content_reviews").insert({
      workspace_id: input.workspaceId,
      content_run_id: input.runId,
      review_type: input.reviewType,
      reviewer_type: input.reviewerType,
      score: input.score ?? null,
      status: input.status,
      issues_json: input.issues ?? [],
      required_changes_json: input.requiredChanges ?? [],
    }),
  );
}

export async function listPromptSets(supabase: ContentRepositoryClient): Promise<PromptSetRow[]> {
  return queryRows<PromptSetRow>(
    supabase.from("prompt_sets").select("id,name,description,status").order("name", { ascending: true }),
  );
}

export async function listPromptTemplates(supabase: ContentRepositoryClient): Promise<PromptTemplateRow[]> {
  return queryRows<PromptTemplateRow>(
    supabase
      .from("prompt_templates")
      .select("id,key,name,skill_name,description,template_body,status,version,created_at,updated_at")
      .order("skill_name", { ascending: true })
      .order("version", { ascending: false }),
  );
}

export async function savePromptTemplateVersion(input: {
  supabase: ContentRepositoryClient;
  templateId: string;
  body: string;
  createdBy: string;
}): Promise<PromptTemplateRow> {
  const current = await querySingle<PromptTemplateRow>(
    input.supabase
      .from("prompt_templates")
      .select("key,name,skill_name,description,input_schema_json,output_schema_json,version")
      .eq("id", input.templateId)
      .single(),
  );

  return querySingle<PromptTemplateRow>(
    input.supabase
      .from("prompt_templates")
      .insert({
        key: current.key,
        name: current.name,
        skill_name: current.skill_name,
        description: current.description,
        template_body: input.body,
        input_schema_json: (current as Record<string, unknown>).input_schema_json ?? {},
        output_schema_json: (current as Record<string, unknown>).output_schema_json ?? {},
        status: "draft",
        version: Number(current.version) + 1,
        created_by: input.createdBy,
      })
      .select("id,key,name,skill_name,description,template_body,status,version,created_at,updated_at")
      .single(),
  );
}

export async function setPromptTemplateStatus(input: {
  supabase: ContentRepositoryClient;
  templateId: string;
  status: "active" | "locked" | "archived" | "draft";
}): Promise<void> {
  const updatedAt = new Date().toISOString();

  await expectOk(
    input.supabase
      .from("prompt_templates")
      .update({ status: input.status, updated_at: updatedAt })
      .eq("id", input.templateId),
  );

  if (input.status !== "active") return;

  const template = await querySingle<Pick<PromptTemplateRow, "id" | "skill_name" | "version">>(
    input.supabase.from("prompt_templates").select("id,skill_name,version").eq("id", input.templateId).single(),
  );

  await expectOk(
    input.supabase
      .from("prompt_set_items")
      .update({
        prompt_template_id: template.id,
        prompt_version: template.version,
        updated_at: updatedAt,
      })
      .eq("skill_name", template.skill_name),
  );
}

export async function upsertOperatorApproval(input: {
  supabase: ContentRepositoryClient;
  workspaceId: string;
  runId: string;
  artifactType: string;
  status: "approved" | "rejected" | "cancelled";
  approvedBy: string;
  notes?: string;
}): Promise<void> {
  await expectOk(
    input.supabase.from("operator_approvals").upsert(
      {
        workspace_id: input.workspaceId,
        content_run_id: input.runId,
        artifact_type: input.artifactType,
        approval_status: input.status,
        approved_by: input.status === "approved" ? input.approvedBy : null,
        notes: input.notes ?? null,
        approved_at: input.status === "approved" ? new Date().toISOString() : null,
      },
      { onConflict: "content_run_id,artifact_type" },
    ),
  );
}

async function querySingle<T>(query: unknown): Promise<T> {
  const { data, error } = await query as QueryResult<T>;
  if (error || !data) throw new Error(error?.message ?? "Expected one row.");
  return data;
}

async function queryMaybeSingle<T>(query: unknown): Promise<T | null> {
  const { data, error } = await query as QueryResult<T>;
  if (error) throw new Error(error.message);
  return data;
}

async function queryRows<T>(query: unknown): Promise<T[]> {
  const { data, error } = await query as QueryRows<T>;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function expectOk(query: unknown): Promise<void> {
  const { error } = await query as { error: { message: string } | null };
  if (error) throw new Error(error.message);
}
