import { DeterministicResearchQueue, type EnqueueResult } from "./queue.ts";
import type { RealEstateGate, ResearchJobInput } from "./types.ts";

export class ResearchSupervisor {
  constructor(private readonly queue: DeterministicResearchQueue) {}

  planPostcodeRosterRefresh(input: {
    postcode: string;
    state: string;
    forceRefresh?: boolean;
    maxAgeDays?: number;
    reason?: string;
  }): EnqueueResult {
    return this.queue.enqueue({
      kind: "blockwise-agent-census",
      priority: 10,
      reason: input.reason ?? "postcode roster refresh",
      payload: {
        postcode: input.postcode,
        state: input.state,
        forceRefresh: input.forceRefresh ?? false,
        maxAgeDays: input.maxAgeDays ?? 7,
      },
    });
  }

  planPageResolution(input: {
    subjectKind: "agent" | "agency";
    subjectId: string;
    censusDecisionId: string;
    sourceDocumentIds: string[];
    forceRevisit?: boolean;
  }): EnqueueResult {
    return this.queue.enqueue({
      kind: "blockwise-page-resolver",
      priority: 20,
      reason: "resolve verified real-estate subject to Meta advertiser page",
      payload: input,
    });
  }

  planResolvedAdvertiserCapture(input: {
    advertiserPageId: string;
    metaPageId: string;
    resolverDecisionId: string;
    realEstateGate: RealEstateGate;
    country?: string;
    activeStatus?: "active" | "inactive" | "all";
    resultsLimit?: number;
  }): EnqueueResult {
    return this.queue.enqueue({
      kind: "blockwise-ad-collector",
      priority: 30,
      reason: "collect ads for resolved real-estate advertiser page",
      payload: input,
    });
  }

  planCreativeClassification(input: {
    adCreativeId: string;
    sourceDocumentId: string;
    force?: boolean;
  }): EnqueueResult {
    return this.queue.enqueue({
      kind: "blockwise-ad-classifier",
      priority: 40,
      reason: "classify captured real-estate creative",
      payload: input,
    });
  }

  planCoverageAudit(input: {
    postcode: string;
    state: string;
    method?: "resolved_roster_sample" | "operator_defect_replay";
    sampleSize?: number;
  }): EnqueueResult {
    return this.queue.enqueue({
      kind: "blockwise-coverage-auditor",
      priority: 60,
      reason: "audit known roster coverage and open defects for gaps",
      payload: input,
    });
  }

  planDefectInvestigation(input: {
    coverageDefectId: string;
    operatorDecisionId?: string;
  }): EnqueueResult {
    return this.queue.enqueue({
      kind: "blockwise-defect-investigator",
      priority: 5,
      reason: "operator requested coverage defect investigation",
      payload: input,
    });
  }

  planFollowUps(inputs: ResearchJobInput[]): EnqueueResult[] {
    return inputs.map((input) => this.queue.enqueue(input));
  }
}
