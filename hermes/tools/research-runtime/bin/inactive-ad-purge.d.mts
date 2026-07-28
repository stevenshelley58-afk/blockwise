type ResearchRest = (
  schema: string,
  path: string,
  init?: RequestInit,
) => Promise<Array<Record<string, unknown>> | null>;

export function runInactiveAdPurge(input: {
  researchRest: ResearchRest;
  intervalHours?: number;
}): Promise<{
  skipped: boolean;
  reason: string | null;
  confirmedInactive: number;
  activeMissingMedia: number;
  deleted: number;
}>;
