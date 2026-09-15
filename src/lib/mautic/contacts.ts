import { isMauticSkipped, mauticRequest, type MauticSkipped } from "./client.ts";

export type MauticContactFields = Record<string, string | number | null>;

export type UpsertMauticContactInput = {
  email: string;
  firstName?: string;
  lastName?: string;
  workspaceId?: string;
  profileId?: string;
  fields: MauticContactFields;
};

type UpsertOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  flow?: string;
  signal?: AbortSignal;
};

type MauticContact = {
  id?: number | string;
  email?: string;
  fields?: Record<string, Record<string, unknown>>;
};

type ContactListing = { contacts?: Record<string, MauticContact> | MauticContact[] };
type ContactMutation = { contact?: MauticContact };

export async function upsertContact(
  input: UpsertMauticContactInput,
  options: UpsertOptions = {},
): Promise<MauticSkipped | { skipped: false; contactId: string }> {
  const email = input.email.trim();
  if (!email) throw new Error("Mautic contact email is required.");

  const context = {
    emailDomain: emailDomain(email),
    flow: options.flow,
  };
  const requestOptions = {
    env: options.env,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  };
  const listing = await mauticRequest<ContactListing>(
    "GET",
    `/api/contacts?search=email:${encodeURIComponent(email)}&limit=1`,
    { ...requestOptions, context },
  );
  if (isMauticSkipped(listing)) return listing;

  const matched = contactsFrom(listing).find((contact) => contactEmail(contact)?.toLowerCase() === email.toLowerCase());
  const transition = transitionFields(input.fields);
  if (matched && transition) {
    const currentValue = contactField(matched, transition.field);
    const currentChangedAt = contactField(matched, transition.changedAtField);
    if (
      currentValue === transition.value
      && currentChangedAt === transition.changedAt
      && matched.id != null
    ) {
      return { skipped: false, contactId: String(matched.id) };
    }
    if (currentValue && currentValue !== "done") {
      throw new Error("Mautic contact has a pending flow transition.");
    }
  }
  const body: MauticContactFields = {
    ...input.fields,
    email,
    ...(input.firstName?.trim() ? { firstname: input.firstName.trim() } : {}),
    ...(input.lastName?.trim() ? { lastname: input.lastName.trim() } : {}),
    ...(input.workspaceId ? { blockwise_workspace_id: input.workspaceId } : {}),
    ...(input.profileId ? { blockwise_profile_id: input.profileId } : {}),
  };

  if (matched?.id != null) {
    const contactId = String(matched.id);
    await mauticRequest<ContactMutation>("PATCH", `/api/contacts/${encodeURIComponent(contactId)}/edit`, {
      ...requestOptions,
      body,
      context: { ...context, contactId },
    });
    return { skipped: false, contactId };
  }

  const created = await mauticRequest<ContactMutation>("POST", "/api/contacts/new", {
    ...requestOptions,
    body,
    context,
  });
  if (isMauticSkipped(created)) return created;
  const contactId = created.contact?.id;
  if (contactId == null) throw new Error("Mautic contact create response did not include an ID.");
  return { skipped: false, contactId: String(contactId) };
}

function contactsFrom(listing: ContactListing): MauticContact[] {
  if (Array.isArray(listing.contacts)) return listing.contacts;
  return Object.values(listing.contacts ?? {});
}

function contactEmail(contact: MauticContact): string | null {
  const value = contact.email ?? contactField(contact, "email");
  return typeof value === "string" ? value.trim() : null;
}

function contactField(contact: MauticContact, alias: string): string | null {
  for (const group of Object.values(contact.fields ?? {})) {
    const field = group[alias];
    const value = field && typeof field === "object"
      ? (field as { value?: unknown }).value
      : field;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function stringField(value: string | number | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function transitionFields(fields: MauticContactFields): {
  field: "blockwise_stage" | "blockwise_event";
  changedAtField: "blockwise_stage_at" | "blockwise_event_at";
  value: string;
  changedAt: string | null;
} | null {
  const stage = stringField(fields.blockwise_stage);
  if (stage) {
    return {
      field: "blockwise_stage",
      changedAtField: "blockwise_stage_at",
      value: stage,
      changedAt: stringField(fields.blockwise_stage_at),
    };
  }
  const event = stringField(fields.blockwise_event);
  return event
    ? {
        field: "blockwise_event",
        changedAtField: "blockwise_event_at",
        value: event,
        changedAt: stringField(fields.blockwise_event_at),
      }
    : null;
}

function emailDomain(email: string): string | undefined {
  const separator = email.lastIndexOf("@");
  return separator >= 0 ? email.slice(separator + 1).toLowerCase() : undefined;
}
