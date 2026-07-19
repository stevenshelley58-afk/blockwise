import type { RealEstateGate } from "./types.ts";

export type QueuePlan = {
  queue_name: "research";
  job_type: string;
  dedupe_key: string;
  priority: number;
  payload: Record<string, unknown>;
  status: "pending";
  max_attempts: number;
};

export class ResearchSupervisor {
  planPostcodeRosterRefresh(input: { postcode: string; state: string; buildRunId?: string }): QueuePlan {
    return {
      queue_name: "research",
      job_type: "blockwise-agent-census",
      dedupe_key: `census:${input.state}:${input.postcode}`,
      priority: 10,
      payload: {
        postcode: input.postcode,
        state: input.state,
        build_run_id: input.buildRunId,
        verified_roster_first: true,
        location_search_allowed: false,
        legacy_discovery_allowed: false,
      },
      status: "pending",
      max_attempts: 3,
    };
  }

  planPageResolution(input: {
    subjectKind: "agent" | "agency";
    subjectId: string;
    censusDecisionId: string;
    sourceDocumentIds: string[];
  }): QueuePlan {
    return {
      queue_name: "research",
      job_type: "blockwise-page-resolver",
      dedupe_key: `page-resolver:${input.subjectKind}:${input.subjectId}`,
      priority: 20,
      payload: {
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        censusDecisionId: input.censusDecisionId,
        sourceDocumentIds: input.sourceDocumentIds,
        location_search_allowed: false,
      },
      status: "pending",
      max_attempts: 3,
    };
  }

  planResolvedAdvertiserCapture(input: {
    advertiserPageId: string;
    metaPageId: string;
    resolverDecisionId: string;
    realEstateGate: RealEstateGate;
  }): QueuePlan {
    return {
      queue_name: "research",
      job_type: "blockwise-ad-collector",
      dedupe_key: `ad-collector:${input.advertiserPageId}`,
      priority: 30,
      payload: input,
      status: "pending",
      max_attempts: 3,
    };
  }

  planMediaCapture(input: { adCreativeId: string; observedAdId: string; sourceUrls: string[] }): QueuePlan {
    return {
      queue_name: "research",
      job_type: "blockwise-media-collector",
      dedupe_key: `media:${input.adCreativeId}`,
      priority: 35,
      payload: input,
      status: "pending",
      max_attempts: 3,
    };
  }

  planCreativeClassification(input: { adCreativeId: string; sourceDocumentId?: string; force?: boolean }): QueuePlan {
    return {
      queue_name: "research",
      job_type: "blockwise-ad-classifier",
      dedupe_key: `classifier:${input.adCreativeId}`,
      priority: 40,
      payload: input,
      status: "pending",
      max_attempts: 3,
    };
  }

  planContentRun(input: { workspaceId: string; contentRunId: string; fromStep?: string | null }): QueuePlan {
    return {
      queue_name: "research",
      job_type: "blockwise-content-run-orchestrator",
      dedupe_key: `content-run:${input.workspaceId}:${input.contentRunId}`,
      // Interactive content runs must not sit behind the research backlog.
      priority: 1,
      payload: {
        workspaceId: input.workspaceId,
        contentRunId: input.contentRunId,
        fromStep: input.fromStep ?? null,
      },
      status: "pending",
      max_attempts: 1,
    };
  }
}
