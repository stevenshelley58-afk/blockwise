export type ResearchChatCoverageRow = {
  postcode: string;
  state: string;
  last_audit_score?: number | null;
  last_refreshed_at?: string | null;
  live_active_ads?: number | null;
  live_advertiser_pages?: number | null;
  health: string;
};

export type ResearchChatCounts = {
  coverageRows: number;
  activeJobs: number;
  failedJobs: number;
  staleJobs: number;
  defects: number;
  skillFiles: number;
  spend24h: number;
};

export type ResearchChatCoverageSummary = {
  postcode: string;
  state: string;
  score: number;
  activeAds: number;
  advertiserPages: number;
  health: string;
};

export function buildResearchChatAnswer(counts: ResearchChatCounts): string {
  return [
    `${counts.coverageRows} coverage rows available from research.v_coverage_status.`,
    `${counts.activeJobs} active jobs, ${counts.failedJobs} failed or blocked jobs, ${counts.staleJobs} stale claims.`,
    `${counts.defects} coverage defects are visible to the operator view.`,
    `${counts.skillFiles} Hermes skill files are available from hermes/skills.`,
    `24h collector spend is $${counts.spend24h.toFixed(2)}.`,
  ].join(" ");
}

export function summarizeCoverageRows(rows: ResearchChatCoverageRow[], limit = 4): ResearchChatCoverageSummary[] {
  return rows
    .map(toCoverageSummary)
    .sort((left, right) => left.score - right.score)
    .slice(0, limit);
}

function toCoverageSummary(row: ResearchChatCoverageRow): ResearchChatCoverageSummary {
  return {
    postcode: row.postcode,
    state: row.state,
    score: coverageScore(row),
    activeAds: row.live_active_ads ?? 0,
    advertiserPages: row.live_advertiser_pages ?? 0,
    health: row.health,
  };
}

function coverageScore(row: ResearchChatCoverageRow): number {
  if (typeof row.last_audit_score === "number") {
    return clamp(Math.round(row.last_audit_score), 0, 100);
  }
  if ((row.live_active_ads ?? 0) > 0) {
    return clamp(55 + (row.live_active_ads ?? 0) * 8, 55, 100);
  }
  if (row.health === "healthy") {
    return 100;
  }
  if (row.health === "gap_known") {
    return 15;
  }
  if (row.health === "audit_overdue" || row.health === "refresh_overdue") {
    return 25;
  }
  if (row.last_refreshed_at) {
    return 35;
  }
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
