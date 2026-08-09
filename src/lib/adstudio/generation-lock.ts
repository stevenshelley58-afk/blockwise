export type GenerationOwnerStatus = "queued" | "running" | "done" | "failed" | null;

/** Only terminal/missing job ownership or a stale unbound setup lock is reclaimable. */
export function generationLockCanBeReclaimed(input: {
  ownerJobId: string | null;
  ownerStatus: GenerationOwnerStatus;
  ownerLookupFailed: boolean;
  createdAtMs: number;
  nowMs: number;
  unboundTtlMs: number;
}): boolean {
  if (input.ownerJobId) {
    if (input.ownerLookupFailed) return false;
    return input.ownerStatus !== "queued" && input.ownerStatus !== "running";
  }
  return input.nowMs - input.createdAtMs >= input.unboundTtlMs;
}
