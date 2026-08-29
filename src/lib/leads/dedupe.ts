export type LeadIdentity = {
  id?: string;
  email?: string | null;
  phone?: string | null;
};

function normalizeEmail(email?: string | null): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizePhone(phone?: string | null): string | null {
  const normalized = phone?.replace(/\D/g, "");
  return normalized ? normalized : null;
}

export function buildLeadDedupeKey(lead: LeadIdentity): string {
  const parts: string[] = [];
  const email = normalizeEmail(lead.email);
  const phone = normalizePhone(lead.phone);

  if (email) {
    parts.push(`email:${email}`);
  }

  if (phone) {
    parts.push(`phone:${phone}`);
  }

  return parts.join("|");
}

export function findDuplicateLeadIds(existingLeads: LeadIdentity[], incomingLead: LeadIdentity): string[] {
  const incomingKey = buildLeadDedupeKey(incomingLead);

  if (!incomingKey) {
    return [];
  }

  return existingLeads
    .filter((lead) => lead.id && buildLeadDedupeKey(lead) === incomingKey)
    .map((lead) => lead.id as string);
}
