import type { PromptBundle, PromptKey } from "./prompt-registry.ts";
import { assertPromptKey, getActivePromptBundle, listPromptVersions } from "./prompt-registry.ts";
import { assembleBackgroundPrompt, assembleImagePrompt, assembleMetaCopyPrompt } from "./assemble-prompt.ts";
import type { AssembledPrompt } from "./assemble-prompt.ts";
import { buildRedactedProviderRunInput } from "./redact-prompt-run.ts";
import { getPromptTestFixture, PROMPT_TEST_FIXTURES } from "./test-fixtures.ts";
import type { PromptTestFixture, PromptTestFixtureTask } from "./test-fixtures.ts";

type PromptSupabaseClient = Parameters<typeof getActivePromptBundle>[2];

export type PromptTestRunInput = {
  key: string;
  fixtureId: string;
  version?: number;
  runProvider?: boolean;
  client?: PromptSupabaseClient;
};

export type PromptTestRunResult = {
  fixture: PromptTestFixture;
  task: PromptTestFixtureTask;
  promptKey: PromptKey;
  testedVersion: number | null;
  assembledPrompt: AssembledPrompt;
  redactionPreview: Record<string, unknown>;
  status: "assembled";
};

const COPY_KEYS: PromptKey[] = [
  "adstudio.copy.system",
  "adstudio.copy.input_template",
  "adstudio.copy.output_schema",
  "adstudio.copy.compliance_rules",
];
const IMAGE_KEYS: PromptKey[] = [
  "adstudio.image.system",
  "adstudio.image.input_template",
  "adstudio.image.brand_rules",
  "adstudio.image.negative_prompt",
  "adstudio.image.aspect_ratio_rules",
];
const BACKGROUND_KEYS: PromptKey[] = [
  "adstudio.background.system",
  "adstudio.background.input_template",
  "adstudio.background.negative_prompt",
];

export function listPromptTestFixtures() {
  return PROMPT_TEST_FIXTURES.map(({ id, label, task, description }) => ({ id, label, task, description }));
}

export async function runPromptTest(input: PromptTestRunInput): Promise<PromptTestRunResult> {
  if (input.runProvider) {
    throw new Error("Provider execution is disabled for prompt previews. Live comparison runs through content run generation.");
  }

  const promptKey = assertPromptKey(input.key);
  const fixture = getPromptTestFixture(input.fixtureId);

  if (!fixture) {
    throw new Error(`Unknown prompt test fixture: ${input.fixtureId}`);
  }

  const bundle = await loadBundleForFixture(fixture.task, promptKey, input.version, input.client);
  const assembledPrompt = assembleFixturePrompt(fixture, bundle);
  const redactionPreview = buildRedactedProviderRunInput({
    taskType: taskTypeForFixture(fixture.task),
    modelProfile: fixture.task === "copy" ? "structured_json" : "image_draft",
    prompt: assembledPrompt,
    input: fixture.payload,
  });

  return {
    fixture,
    task: fixture.task,
    promptKey,
    testedVersion: input.version ?? null,
    assembledPrompt,
    redactionPreview,
    status: "assembled",
  };
}

async function loadBundleForFixture(
  task: PromptTestFixtureTask,
  promptKey: PromptKey,
  version: number | undefined,
  client: PromptSupabaseClient,
): Promise<PromptBundle> {
  const keys = task === "copy" ? COPY_KEYS : task === "image" ? IMAGE_KEYS : BACKGROUND_KEYS;
  const bundle = await getActivePromptBundle(keys, undefined, client);

  if (version === undefined) {
    return bundle;
  }

  const versions = await listPromptVersions(promptKey, client ?? undefined);
  const selected = versions.find((candidate) => candidate.version === version);

  if (!selected) {
    throw new Error(`Prompt version ${promptKey}.${version} was not found.`);
  }

  return {
    ...bundle,
    [promptKey]: selected,
  };
}

function assembleFixturePrompt(fixture: PromptTestFixture, bundle: PromptBundle): AssembledPrompt {
  if (fixture.task === "copy") {
    const payload = fixture.payload as Record<string, any>;
    return assembleMetaCopyPrompt({
      bundle,
      mode: payload.mode ?? "generate",
      context: payload.context ?? {},
      brandKit: payload.brandKit,
      brief: payload.brief,
      currentCopy: payload.currentCopy,
      assistAction: payload.assistAction,
      runtime: false,
    });
  }

  if (fixture.task === "image") {
    const payload = fixture.payload as Record<string, any>;
    return assembleImagePrompt({
      bundle,
      prompt: payload.prompt ?? "",
      brand: payload.brand,
      brandKit: payload.brandKit,
      aspectRatio: payload.aspectRatio ?? "1:1",
      stylePreset: payload.stylePreset ?? "real_estate_photography",
      referenceAssets: payload.referenceAssets ?? [],
      runtime: false,
    });
  }

  const payload = fixture.payload as Record<string, any>;
  return assembleBackgroundPrompt({
    bundle,
    creativeId: payload.creativeId ?? "creative_fixture",
    format: payload.format,
    campaign: payload.campaign,
    brand: payload.brand,
    brandKit: payload.brandKit,
    runtime: false,
  });
}

function taskTypeForFixture(task: PromptTestFixtureTask): "adstudio.copy" | "adstudio.image" | "adstudio.background" {
  if (task === "copy") return "adstudio.copy";
  if (task === "image") return "adstudio.image";
  return "adstudio.background";
}
