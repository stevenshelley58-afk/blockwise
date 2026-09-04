/**
 * Versioned, provider-neutral wire contract consumed by Frank/Hermes.
 * Blockwise owns the envelope and source ordering; adapters own only the
 * provider field mapping. No provider SDK or network client belongs here.
 */
export const BLOCKWISE_PROJECTION_CONTRACT_VERSION = "blockwise.ops.projection.v1" as const;

export type ProjectionProvider = "mautic" | "chatwoot";
export type ProjectionAggregate = "contact" | "lifecycle" | "enquiry" | "support";

export type BlockwiseProjectionEnvelope = {
  contractVersion: typeof BLOCKWISE_PROJECTION_CONTRACT_VERSION;
  workspaceId: string;
  provider: ProjectionProvider;
  aggregate: { type: ProjectionAggregate; id: string };
  operation: "upsert";
  source: { eventId: string; version: number };
  payload: Record<string, string | number | boolean | null>;
};

export type AdapterMapping =
  | { provider: "mautic"; resource: "contact"; fields: { externalId: string; email?: string; name?: string; lifecycle?: string; activationStage?: string; bookingStatus?: string; bookingSubject?: string } }
  | { provider: "mautic"; resource: "lifecycle"; fields: { externalId: string; stage?: string; changedAt?: string } }
  | { provider: "chatwoot"; resource: "enquiry" | "support"; fields: { externalId: string; subject?: string; status?: string; contactId?: string } };

const MAX_ID = 256;
const MAX_FIELD = 512;

const PROVIDER_AGGREGATES: Record<ProjectionProvider, readonly ProjectionAggregate[]> = {
  mautic: ["contact", "lifecycle"],
  chatwoot: ["enquiry", "support"],
};

function providerAggregateAllowed(provider: unknown, aggregateType: unknown): provider is ProjectionProvider {
  return (provider === "mautic" || provider === "chatwoot")
    && typeof aggregateType === "string"
    && PROVIDER_AGGREGATES[provider].includes(aggregateType as ProjectionAggregate);
}

export function buildProjectionEnvelope(input: Omit<BlockwiseProjectionEnvelope, "contractVersion">): BlockwiseProjectionEnvelope {
  if (!providerAggregateAllowed(input.provider, input.aggregate.type)) {
    throw new Error("provider and aggregate type are incompatible");
  }
  const workspaceId = bounded(input.workspaceId, MAX_ID, "workspaceId");
  const aggregateId = bounded(input.aggregate.id, MAX_ID, "aggregate.id");
  const eventId = bounded(input.source.eventId, MAX_ID, "source.eventId");
  if (!Number.isSafeInteger(input.source.version) || input.source.version < 1) throw new Error("projection source version must be positive");
  const payload: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input.payload)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || /token|secret|password|authorization|cookie|raw/i.test(key)) continue;
    if (typeof value === "string") payload[key] = value.slice(0, MAX_FIELD);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) payload[key] = value;
  }
  payload.workspaceId = workspaceId;
  return { contractVersion: BLOCKWISE_PROJECTION_CONTRACT_VERSION, workspaceId, provider: input.provider, aggregate: { type: input.aggregate.type, id: aggregateId }, operation: "upsert", source: { eventId, version: input.source.version }, payload };
}

export function mapProjectionForAdapter(envelope: BlockwiseProjectionEnvelope): AdapterMapping {
  if (!providerAggregateAllowed(envelope.provider, envelope.aggregate.type)) {
    throw new Error("provider and aggregate type are incompatible");
  }
  const externalId = `${envelope.workspaceId}:${envelope.aggregate.id}`.slice(0, MAX_ID);
  if (envelope.provider === "mautic" && envelope.aggregate.type === "contact") {
    return { provider: "mautic", resource: "contact", fields: { externalId, email: stringField(envelope.payload.email), name: stringField(envelope.payload.name), lifecycle: stringField(envelope.payload.lifecycle) ?? stringField(envelope.payload.stage), activationStage: stringField(envelope.payload.activationStage) ?? stringField(envelope.payload.stage), bookingStatus: stringField(envelope.payload.bookingStatus), bookingSubject: stringField(envelope.payload.bookingSubject) } };
  }
  if (envelope.provider === "mautic" && envelope.aggregate.type === "lifecycle") {
    return { provider: "mautic", resource: "lifecycle", fields: { externalId, stage: stringField(envelope.payload.stage), changedAt: stringField(envelope.payload.changedAt) } };
  }
  if (envelope.provider === "chatwoot" && (envelope.aggregate.type === "enquiry" || envelope.aggregate.type === "support")) {
    return { provider: "chatwoot", resource: envelope.aggregate.type, fields: { externalId, subject: stringField(envelope.payload.subject), status: stringField(envelope.payload.status), contactId: stringField(envelope.payload.contactId) } };
  }
  throw new Error("provider and aggregate type are incompatible");
}

function bounded(value: string, max: number, label: string): string { const result = value.trim(); if (!result || result.length > max) throw new Error(`${label} is invalid`); return result; }
function stringField(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? value.slice(0, MAX_FIELD) : undefined; }
