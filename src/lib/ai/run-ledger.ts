import type { ModelProfileKey, UsageEstimate } from "./model-registry.ts";
import {
  estimateRunCostUsd,
  resolveModelProfile,
  shouldBlockForCostPolicy,
} from "./model-registry.ts";

export type AiLedgerEntry = {
  id: string;
  workspaceId: string;
  userId: string;
  profileKey: ModelProfileKey;
  provider: string;
  model: string;
  task: string;
  outputType: string;
  status: "completed" | "blocked";
  inputTokens: number;
  outputTokens: number;
  imageUnits: number;
  estimatedCostUsd: number;
  blockReason?: string;
};

export type CreateAiRunLedgerEntryInput = {
  workspaceId: string;
  userId: string;
  profileKey: ModelProfileKey;
  task: string;
  outputType: string;
  usage: UsageEstimate;
};

export function createAiRunLedgerEntry(input: CreateAiRunLedgerEntryInput): AiLedgerEntry {
  const resolved = resolveModelProfile(input.profileKey);
  const estimatedCostUsd = estimateRunCostUsd(resolved.primary, input.usage);
  const policy = shouldBlockForCostPolicy(input.profileKey, { estimatedCostUsd });

  return {
    id: `ai_run_${input.workspaceId}_${input.task}_${input.profileKey}`,
    workspaceId: input.workspaceId,
    userId: input.userId,
    profileKey: input.profileKey,
    provider: resolved.primary.provider,
    model: resolved.primary.model,
    task: input.task,
    outputType: input.outputType,
    status: policy.blocked ? "blocked" : "completed",
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    imageUnits: input.usage.imageUnits ?? 0,
    estimatedCostUsd,
    blockReason: policy.reason,
  };
}
