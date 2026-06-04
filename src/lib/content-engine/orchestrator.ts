import { CONTENT_STEPS, type ContentSkillName, createContentRunInputSchema, type CreateContentRunInput } from "./contracts.ts";
import { artifactsForSkill, artifactVariables, buildLatestArtifactMap } from "./artifacts.ts";
import { routeContentModel } from "./model-router.ts";
import { createLiveContentProvider, type ContentGenerationProvider } from "./provider.ts";
import { resolvePromptForSkill } from "./prompts.ts";
import {
  insertContentArtifact,
  insertContentReview,
  insertPromptRun,
  loadContentRunBundle,
  updateContentRunStatus,
  type ContentRepositoryClient,
} from "./repository.ts";

export type RunContentRunResult = {
  runId: string;
  status: "waiting_operator_approval" | "failed";
  failedStep?: ContentSkillName;
  error?: string;
};

export async function runContentRun(input: {
  supabase: ContentRepositoryClient;
  runId: string;
  fromStep?: ContentSkillName;
  provider?: ContentGenerationProvider;
}): Promise<RunContentRunResult> {
  const provider = input.provider ?? createLiveContentProvider();
  const bundle = await loadContentRunBundle(input.supabase, input.runId);
  const runInput = createContentRunInputSchema.parse(bundle.run.input_json);
  const startIndex = input.fromStep ? CONTENT_STEPS.findIndex((step) => step.skillName === input.fromStep) : 0;

  if (startIndex < 0) {
    throw new Error(`Unknown content step: ${input.fromStep}`);
  }

  let artifacts = buildLatestArtifactMap(bundle.artifacts);

  for (const step of CONTENT_STEPS.slice(startIndex)) {
    try {
      await updateContentRunStatus({
        supabase: input.supabase,
        runId: input.runId,
        status: step.status,
        currentStep: step.skillName,
      });

      const variables = buildPromptVariables({
        runId: input.runId,
        runInput,
        artifacts,
      });
      const prompt = await resolvePromptForSkill({
        supabase: input.supabase as never,
        promptSetId: bundle.run.prompt_set_id ?? "",
        skillName: step.skillName,
        variables,
        defaultModelPolicy: step.defaultModelPolicy,
      });
      const routedModel = await routeContentModel(input.supabase as never, prompt.modelPolicy);
      const output = await provider.generate({
        skillName: step.skillName,
        prompt: prompt.body,
        model: routedModel.candidate,
        run: { ...runInput, id: input.runId },
        artifacts,
      });
      const modelUsed = `${routedModel.candidate.provider}/${routedModel.candidate.model}`;

      await insertPromptRun({
        supabase: input.supabase,
        workspaceId: bundle.run.workspace_id,
        runId: input.runId,
        promptTemplateId: prompt.templateId,
        promptVersion: prompt.version,
        skillName: step.skillName,
        promptHash: prompt.hash,
        provider: routedModel.candidate.provider,
        modelUsed,
        modelPolicyId: prompt.modelPolicy,
        inputJson: variables,
        outputJson: output,
      });

      for (const artifact of artifactsForSkill(step.skillName, output)) {
        await insertContentArtifact({
          supabase: input.supabase,
          workspaceId: bundle.run.workspace_id,
          runId: input.runId,
          artifactType: artifact.artifactType,
          title: artifact.title,
          data: artifact.data,
          modelUsed,
          promptTemplateId: prompt.templateId,
          promptVersion: prompt.version,
        });
        artifacts = {
          ...artifacts,
          [artifact.artifactType]: artifact.data,
        };
      }

      await maybeInsertReview({
        supabase: input.supabase,
        workspaceId: bundle.run.workspace_id,
        runId: input.runId,
        skillName: step.skillName,
        output,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Content step failed.";
      await updateContentRunStatus({
        supabase: input.supabase,
        runId: input.runId,
        status: "failed",
        currentStep: step.skillName,
        errorMessage: message,
      });

      return {
        runId: input.runId,
        status: "failed",
        failedStep: step.skillName,
        error: message,
      };
    }
  }

  await updateContentRunStatus({
    supabase: input.supabase,
    runId: input.runId,
    status: "waiting_operator_approval",
    currentStep: null,
    completed: true,
  });

  return {
    runId: input.runId,
    status: "waiting_operator_approval",
  };
}

function buildPromptVariables(input: {
  runId: string;
  runInput: CreateContentRunInput;
  artifacts: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...input.runInput,
    content_run_id: input.runId,
    cta: input.runInput.primary_cta,
    brand_voice: input.runInput.tone_profile ?? "direct, expert, no hype",
    image_style: input.runInput.image_style ?? "premium SaaS, minimal, navy/off-white, no AI slop",
    do_not_say: ["guaranteed leads", "guaranteed listings", "secret hack", "fake case study"],
    must_include: ["value-first content", "qualified lead signal", "retargeting", "CRM outcome feedback"],
    operator_notes: input.runInput.operator_notes ?? "",
    ...artifactVariables(input.artifacts),
  };
}

async function maybeInsertReview(input: {
  supabase: ContentRepositoryClient;
  workspaceId: string;
  runId: string;
  skillName: ContentSkillName;
  output: Record<string, unknown>;
}): Promise<void> {
  if (input.skillName === "blockwise-compliance-reviewer") {
    await insertContentReview({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      runId: input.runId,
      reviewType: "compliance",
      reviewerType: "ai",
      score: null,
      status: String(input.output.status ?? "needs_human"),
      issues: asArray(input.output.issues),
      requiredChanges: asArray(input.output.required_changes),
    });
  }

  if (input.skillName === "blockwise-agent-reviewer") {
    await insertContentReview({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      runId: input.runId,
      reviewType: "final_agent",
      reviewerType: "ai",
      score: Number(input.output.overall_score ?? 0),
      status: String(input.output.recommendation ?? "revise"),
      issues: asArray(input.output.weak_assets),
      requiredChanges: asArray(input.output.required_edits),
    });
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

