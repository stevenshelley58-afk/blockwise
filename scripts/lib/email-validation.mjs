// Shared email validation for agent enrichment.
// Ensures captured emails are well-formed and attributable to an Australian agent.

export const FOREIGN_CCTLD = [
  ".ca", ".us", ".uk", ".nz", ".za", ".in", ".sg", ".ie", ".ae", ".hk",
  ".cn", ".jp", ".de", ".fr", ".nl", ".es", ".it", ".br", ".mx", ".ph",
  ".my", ".th", ".id", ".vn", ".pk", ".bd", ".lk", ".ru", ".se", ".no",
];

// Major Australian real-estate brands that use a .com (not .com.au) domain.
export const AU_BRAND_DOMAINS = new Set([
  "raywhite.com",
  "harcourts.net",
  "harcourts.com",
  "eldersrealestate.com",
  "belleproperty.com",
  "acton.com",
]);

// Strip leading capture artifacts like "email" / "mailto:" that the regex glues
// onto the local-part (e.g. "emailbenjamin.bettison@..." -> "benjamin.bettison@...").
export function stripEmailPrefix(local) {
  let value = String(local ?? "");
  if (/^mailto:/i.test(value)) value = value.slice(7);
  if (/^email/i.test(value) && value.length > 5 && /[a-z]/i.test(value[5])) value = value.slice(5);
  return value;
}

export function normalizeEmail(email) {
  const raw = String(email ?? "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return null;
  const local = stripEmailPrefix(raw.slice(0, at));
  const domain = raw.slice(at + 1);
  if (!local || !domain) return null;
  return `${local}@${domain}`;
}

const VALID_TLD_RE = /^[a-z]{2,6}$/;

export function isWellFormedEmail(email) {
  const norm = normalizeEmail(email);
  if (!norm) return false;
  const [local, domain] = norm.split("@");
  if (!local || !domain) return false;
  if (local.includes("..") || domain.includes("..")) return false;
  if (!/^[a-z0-9]/.test(local) || !/^[a-z0-9]/.test(domain)) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (labels.some((label) => label.length === 0)) return false;
  const tld = labels[labels.length - 1];
  // Rejects glued text like "...com.auemail" (tld length 7) and numeric TLDs.
  if (!VALID_TLD_RE.test(tld)) return false;
  return true;
}

export function emailDomain(email) {
  return String(email ?? "").split("@")[1] ?? "";
}

export function isAuEmailDomain(email) {
  return emailDomain(email).endsWith(".au");
}

export function isForeignCctld(email) {
  const domain = emailDomain(email);
  return FOREIGN_CCTLD.some((tld) => domain.endsWith(tld));
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isAuSource(url) {
  return hostOf(url).endsWith(".au");
}

// Some global directories scope pages by country path (e.g. interexo.com/australia/...).
export function isAuPath(url) {
  try {
    return new URL(url).pathname.toLowerCase().includes("/australia/");
  } catch {
    return false;
  }
}

export function isAuBrand(email, sourceUrl) {
  const domain = emailDomain(email);
  const host = hostOf(sourceUrl);
  for (const brand of AU_BRAND_DOMAINS) {
    if (domain === brand || domain.endsWith(`.${brand}`)) return true;
    if (host === brand || host.endsWith(`.${brand}`)) return true;
  }
  return false;
}

// An email is accepted only when we can attribute it to an Australian agent.
export function hasAuAttribution(email, sourceUrl, reasons) {
  return (
    isAuEmailDomain(email) ||
    (Array.isArray(reasons) && reasons.includes("domain_matches_agency")) ||
    isAuSource(sourceUrl) ||
    isAuPath(sourceUrl) ||
    isAuBrand(email, sourceUrl)
  );
}
