import { createHash, randomUUID } from "node:crypto";

import { recordCustomerActivationMilestone } from "../activation/customer-activation.ts";
import { recordWorkspaceFunnelEventBestEffort } from "../analytics/progressive-funnel.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import {
  buildHostedBookingUrl,
  normalizeBookingMarket,
  parseCalcomWebhook,
  verifyBookingInvitationToken,
  type BookingMarket,
  type BookingState,
  type ProviderBookingEvent,
} from "./provider.ts";

type BookingServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type OnboardingBooking = {
  id: string;
  workspaceId: string;
  provider: string;
  providerBookingId: string | null;
  market: BookingMarket;
  status: BookingState;
  hostedBookingUrl: string;
  rescheduleUrl: string | null;
  customerEmail: string | null;
  customerName: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  bookedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  reminder24hDueAt: string | null;
  reminder24hSentAt: string | null;
  reminderPreSessionDueAt: string | null;
  reminderPreSessionSentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type BookingRow = {
  id: string;
  workspace_id: string;
  provider: string;
  provider_booking_id: string | null;
  market: string;
  status: BookingState;
  hosted_booking_url: string;
  reschedule_url: string | null;
  customer_email: string | null;
  customer_name: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  booked_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  reminder_24h_due_at: string | null;
  reminder_24h_sent_at: string | null;
  reminder_pre_session_due_at: string | null;
  reminder_pre_session_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function createBookingInvitation(input: {
  workspaceId: string;
  market: BookingMarket;
  customerEmail?: string | null;
  customerName?: string | null;
  mutationKey: string;
  serviceSupabase?: BookingServiceClient;
}): Promise<OnboardingBooking> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const normalizedMutationKey = input.mutationKey.trim();
  if (!normalizedMutationKey) throw new Error("Booking invitation mutation key is required.");
  const { data: existing, error: existingError } = await service
    .from("workspace_onboarding_bookings")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("mutation_key", normalizedMutationKey)
    .maybeSingle();
  if (existingError) throw new Error(`Booking invitation could not be checked: ${existingError.message}`);
  if (existing) return normalizeBooking(existing as BookingRow);
  const invitationId = randomUUID();
  const hostedBookingUrl = buildHostedBookingUrl({
    market: input.market,
    invitationId,
  });
  const { data, error } = await service
    .from("workspace_onboarding_bookings")
    .insert({
      id: invitationId,
      workspace_id: input.workspaceId,
      provider: "calcom",
      market: input.market,
      status: "link_sent",
      mutation_key: normalizedMutationKey,
      hosted_booking_url: hostedBookingUrl,
      customer_email: input.customerEmail?.trim().toLowerCase() || null,
      customer_name: input.customerName?.trim() || null,
      metadata: { source: "blockwise_booking_route" },
    })
    .select("*")
    .single();
  if (error?.code === "23505") {
    const replay = await service
      .from("workspace_onboarding_bookings")
      .select("*")
      .eq("workspace_id", input.workspaceId)
      .eq("mutation_key", normalizedMutationKey)
      .single();
    if (!replay.error && replay.data) return normalizeBooking(replay.data as BookingRow);
  }
  if (error) throw new Error(`Booking invitation could not be recorded: ${error.message}`);
  return normalizeBooking(data as BookingRow);
}

export async function getLatestOnboardingBooking(input: {
  workspaceId: string;
  serviceSupabase?: BookingServiceClient;
}): Promise<OnboardingBooking | null> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data, error } = await service
    .from("workspace_onboarding_bookings")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code ?? "")) return null;
    throw new Error(`Booking state could not be loaded: ${error.message}`);
  }
  return data ? normalizeBooking(data as BookingRow) : null;
}

export function bookingEventId(rawBody: string, headerEventId?: string | null): string {
  return headerEventId?.trim() || createHash("sha256").update(rawBody).digest("hex");
}

export async function applyBookingWebhook(input: {
  raw: Record<string, unknown>;
  providerEventId: string;
  serviceSupabase?: BookingServiceClient;
}): Promise<{ duplicate: boolean; booking: OnboardingBooking | null }> {
  const event = parseCalcomWebhook({ raw: input.raw, providerEventId: input.providerEventId });
  return applyProviderBookingEvent({ event, serviceSupabase: input.serviceSupabase });
}

/**
 * Apply a provider-neutral booking event. Used by the Cal.com webhook and
 * the SnagTime webhook; both converge here so dedupe, invitation resolution
 * and booking persistence behave identically across providers.
 */
export async function applyProviderBookingEvent(input: {
  event: ProviderBookingEvent;
  serviceSupabase?: BookingServiceClient;
}): Promise<{ duplicate: boolean; booking: OnboardingBooking | null }> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const event = input.event;
  const leaseToken = randomUUID();
  const claimed = await claimWebhookEvent(service, event, leaseToken);
  if (!claimed) return { duplicate: true, booking: null };

  try {
    const invitation = await resolveBookingInvitation(service, event);
    const booking = await persistProviderBooking(
      service,
      invitation.workspaceId,
      invitation.invitationId,
      event,
    );
    if (event.state === "booked" || event.state === "rescheduled") {
      await recordCustomerActivationMilestone({
        workspaceId: invitation.workspaceId,
        milestone: "onboarding_booked",
        occurredAt: booking.bookedAt ?? event.occurredAt,
        serviceSupabase: service,
      });
      await recordWorkspaceFunnelEventBestEffort(service, {
        eventName: "onboarding_booked",
        workspaceId: invitation.workspaceId,
        idempotencyKey: `booking:${invitation.workspaceId}:onboarding-booked`,
        occurredAt: new Date(booking.bookedAt ?? event.occurredAt),
        properties: {
          provider: event.provider,
          provider_event_id: event.providerEventId,
        },
      });
    } else if (event.state === "completed") {
      await recordCustomerActivationMilestone({
        workspaceId: invitation.workspaceId,
        milestone: "onboarding_completed",
        occurredAt: event.occurredAt,
        serviceSupabase: service,
      });
      await recordWorkspaceFunnelEventBestEffort(service, {
        eventName: "onboarding_completed",
        workspaceId: invitation.workspaceId,
        idempotencyKey: `booking:${invitation.workspaceId}:onboarding-completed`,
        occurredAt: new Date(event.occurredAt),
        properties: {
          provider: event.provider,
          provider_event_id: event.providerEventId,
        },
      });
    }
    await finishWebhookEvent(service, event.provider, event.providerEventId, leaseToken, "processed");
    return { duplicate: false, booking };
  } catch (error) {
    await finishWebhookEvent(
      service,
      event.provider,
      event.providerEventId,
      leaseToken,
      "failed",
      error instanceof Error ? error.message : "Booking webhook failed.",
    );
    throw error;
  }
}

async function claimWebhookEvent(
  service: BookingServiceClient,
  event: ProviderBookingEvent,
  leaseToken: string,
): Promise<boolean> {
  const { data, error } = await service.rpc("claim_booking_webhook_event", {
    p_provider: event.provider,
    p_event_id: event.providerEventId,
    p_event_type: event.trigger,
    p_payload: event.raw,
    p_lease_token: leaseToken,
  });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return Boolean(row?.claimed);
  }
  throw new Error(`Booking webhook could not be claimed: ${error.message}`);
}

async function finishWebhookEvent(
  service: BookingServiceClient,
  provider: string,
  eventId: string,
  leaseToken: string,
  status: "processed" | "failed",
  errorMessage?: string,
): Promise<void> {
  const { data, error } = await service.rpc("finish_booking_webhook_event", {
    p_provider: provider,
    p_event_id: eventId,
    p_lease_token: leaseToken,
    p_status: status,
    p_error_message: errorMessage ?? null,
  });
  if (error) throw new Error(`Booking webhook receipt could not be finished: ${error.message}`);
  if (data !== true) throw new Error("Booking webhook receipt lease is no longer owned by this attempt.");
}

async function resolveBookingInvitation(
  service: BookingServiceClient,
  event: ProviderBookingEvent,
): Promise<{ invitationId: string; workspaceId: string }> {
  const invitationId = verifyBookingInvitationToken(event.invitationToken);
  if (!invitationId) throw new Error("Booking webhook invitation is missing or invalid.");
  const { data, error } = await service
    .from("workspace_onboarding_bookings")
    .select("id,workspace_id")
    .eq("id", invitationId)
    .eq("provider", event.provider)
    .maybeSingle();
  if (error) throw new Error(`Booking invitation could not be resolved: ${error.message}`);
  if (!data?.id || typeof data.workspace_id !== "string") {
    throw new Error("Booking webhook invitation does not exist.");
  }
  return { invitationId: data.id, workspaceId: data.workspace_id };
}

async function persistProviderBooking(
  service: BookingServiceClient,
  workspaceId: string,
  invitationId: string,
  event: ProviderBookingEvent,
): Promise<OnboardingBooking> {
  const now = event.occurredAt;
  const reminder24hDueAt = addMilliseconds(now, 24 * 60 * 60 * 1000);
  const reminderPreSessionDueAt = event.scheduledStartAt
    ? addMilliseconds(event.scheduledStartAt, -24 * 60 * 60 * 1000)
    : null;
  const patch = {
    provider: event.provider,
    provider_booking_id: event.providerBookingId,
    provider_event_type_id: event.providerEventTypeId,
    status: event.state,
    reschedule_url: event.rescheduleUrl,
    customer_email: event.customerEmail,
    customer_name: event.customerName,
    scheduled_start_at: event.scheduledStartAt,
    scheduled_end_at: event.scheduledEndAt,
    booked_at: ["booked", "rescheduled"].includes(event.state) ? now : undefined,
    cancelled_at: event.state === "cancelled" ? now : null,
    completed_at: event.state === "completed" ? now : null,
    reminder_24h_due_at: ["booked", "rescheduled"].includes(event.state) ? reminder24hDueAt : null,
    reminder_pre_session_due_at: ["booked", "rescheduled"].includes(event.state) ? reminderPreSessionDueAt : null,
    last_provider_event_id: event.providerEventId,
  };

  const { data: existing } = await service
    .from("workspace_onboarding_bookings")
    .select("id,workspace_id,market,hosted_booking_url")
    .eq("provider", event.provider)
    .eq("provider_booking_id", event.providerBookingId)
    .maybeSingle();
  let result;
  if (existing?.id) {
    assertBookingWorkspaceBinding(existing.workspace_id, workspaceId);
    result = await service
      .from("workspace_onboarding_bookings")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();
  } else {
    const { data: invitation } = await service
      .from("workspace_onboarding_bookings")
      .select("id,workspace_id,market,hosted_booking_url")
      .eq("id", invitationId)
      .maybeSingle();
    if (!invitation?.id || invitation.workspace_id !== workspaceId) {
      throw new Error("Booking invitation workspace binding changed before webhook processing.");
    }
    result = await service
      .from("workspace_onboarding_bookings")
      .update(patch)
      .eq("id", invitation.id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
  }
  if (result.error) throw new Error(`Booking state could not be stored: ${result.error.message}`);
  return normalizeBooking(result.data as BookingRow);
}

export function assertBookingWorkspaceBinding(
  existingWorkspaceId: unknown,
  resolvedWorkspaceId: string,
): void {
  if (existingWorkspaceId !== resolvedWorkspaceId) {
    throw new Error("Booking provider ID is already bound to another workspace.");
  }
}

function normalizeBooking(row: BookingRow): OnboardingBooking {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    providerBookingId: row.provider_booking_id,
    market: normalizeBookingMarket(row.market),
    status: row.status,
    hostedBookingUrl: row.hosted_booking_url,
    rescheduleUrl: row.reschedule_url,
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    bookedAt: row.booked_at,
    cancelledAt: row.cancelled_at,
    completedAt: row.completed_at,
    reminder24hDueAt: row.reminder_24h_due_at,
    reminder24hSentAt: row.reminder_24h_sent_at,
    reminderPreSessionDueAt: row.reminder_pre_session_due_at,
    reminderPreSessionSentAt: row.reminder_pre_session_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function addMilliseconds(value: string, milliseconds: number): string | null {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp + milliseconds).toISOString() : null;
}
