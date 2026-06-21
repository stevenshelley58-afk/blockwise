export const PROPERTY_CHECK_CLIENT_SITUATIONS = [
  "seller_appraisal",
  "buyer_question",
  "investor_subdivision",
  "renovation_extension",
  "general",
] as const;

export type PropertyCheckClientSituation = (typeof PROPERTY_CHECK_CLIENT_SITUATIONS)[number];

export const PROPERTY_CHECK_CLIENT_SITUATION_LABELS: Record<PropertyCheckClientSituation, string> = {
  seller_appraisal: "Seller appraisal",
  buyer_question: "Buyer question",
  investor_subdivision: "Investor / subdivision",
  renovation_extension: "Renovation / extension",
  general: "General",
};

export const PROPERTY_CHECK_DISCLAIMER =
  "Preliminary planning signals only. Review source links and relevant authority guidance before relying on results.";

export const PROPERTY_CHECK_NO_SOURCE_MESSAGE =
  "Property Check could not return a reliable source-cited result for this address. No planning conclusion has been generated.";

export const PROPERTY_CHECK_UNAVAILABLE_MESSAGE =
  "Property Check is unavailable right now. No planning result has been generated.";

export type CitationSourceType =
  | "planning_scheme"
  | "local_policy"
  | "rcode"
  | "overlay"
  | "council_page"
  | "other";

export type PropertyCheckConfidence = "low" | "medium" | "high";

export type PropertyCheckEngineContractStatus = "success" | "no_source" | "unsupported" | "error";

export type PropertyCheckEngineStatus =
  | PropertyCheckEngineContractStatus
  | "missing_config"
  | "timeout"
  | "network_error"
  | "invalid_response"
  | "missing_citations"
  | "low_confidence"
  | "invalid_citations";

export type PropertyCheckStatus = "success" | "no_source" | "unsupported" | "engine_unavailable";

export type DraftCheckRequest = {
  workspaceId: string;
  userId: string;
  address: string;
  clientSituation: PropertyCheckClientSituation;
  notes?: string;
};

export type PropertyCitation = {
  id: string;
  title: string;
  sourceType: CitationSourceType;
  url?: string;
  excerpt?: string;
  retrievedAt?: string;
};

export type PropertySignal = {
  id: string;
  title: string;
  summary: string;
  citationIds: string[];
  severity?: "info" | "watch" | "important";
};

export type PropertyConstraint = {
  id: string;
  title: string;
  summary: string;
  citationIds: string[];
  severity?: "info" | "watch" | "important";
};

export type DraftCheckResult = {
  status: PropertyCheckEngineContractStatus;
  normalizedFacts?: Record<string, unknown>;
  signals?: PropertySignal[];
  likelyConstraints?: PropertyConstraint[];
  talkingPoints?: string[];
  citations?: PropertyCitation[];
  disclaimer: string;
  confidence?: PropertyCheckConfidence;
  engineRequestId?: string;
};

export type PropertyCheckResult = {
  status: PropertyCheckStatus;
  engineStatus: PropertyCheckEngineStatus;
  normalizedFacts: Record<string, unknown>;
  signals: PropertySignal[];
  likelyConstraints: PropertyConstraint[];
  talkingPoints: string[];
  citations: PropertyCitation[];
  disclaimer: string;
  message?: string;
  confidence?: PropertyCheckConfidence;
  generatedAt: string;
  engineRequestId?: string;
};

export type PropertyCheckRecord = {
  id: string;
  workspaceId: string;
  createdBy: string | null;
  address: string;
  clientSituation: PropertyCheckClientSituation;
  status: PropertyCheckStatus;
  normalizedFacts: Record<string, unknown>;
  signals: PropertySignal[];
  likelyConstraints: PropertyConstraint[];
  talkingPoints: string[];
  citations: PropertyCitation[];
  disclaimer: string;
  engineRequestId: string | null;
  engineStatus: PropertyCheckEngineStatus;
  createdAt: string;
  updatedAt: string;
};
