import data from "./catalog-data.json" with { type: "json" };
import { renderEmail, type EmailColorMode } from "./renderer.ts";
import type { EmailMessage, EmailSection } from "./types.ts";

export type Delivery = "transactional" | "optional-service" | "marketing";
export type TemplateDefinition = {
  id: string; category: string; label: string; delivery: Delivery; trigger: string;
  message: Omit<EmailMessage, "sections"> & { sections?: readonly (EmailSection | { repeat: string })[] };
};
export type TemplateValues = Record<string, string | readonly EmailSection[]>;
export const EMAIL_LIBRARY_VERSION = data.version;
export const EMAIL_TEMPLATES = data.templates as readonly TemplateDefinition[];
export const EMAIL_CATEGORIES = [...new Set(EMAIL_TEMPLATES.map(item => item.category))];
const tokenPattern = /\{\{([a-z_]+)\}\}/g;

export function getTemplate(id: string): TemplateDefinition {
  const template = EMAIL_TEMPLATES.find(item => item.id === id);
  if (!template) throw new Error(`Unknown email template: ${id}`);
  return template;
}

export function requiredVariables(id: string): string[] {
  const template = getTemplate(id);
  const fields = new Set([...JSON.stringify(template.message).matchAll(tokenPattern)].map(match => match[1]));
  for (const section of template.message.sections ?? []) if ("repeat" in section) fields.add(section.repeat);
  fields.add("business_identity"); fields.add("support_url");
  if (template.delivery !== "transactional") { fields.add("preferences_url"); fields.add("unsubscribe_url"); }
  return [...fields].sort();
}

function validateText(value: unknown, key: string, max = 2400): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    throw new Error(`Invalid or missing ${key}`);
  }
  if (/\{\{.*?\}\}/.test(value)) throw new Error(`Unresolved placeholder in ${key}`);
}

function validateUrl(value: string, key: string, production: boolean) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid URL for ${key}`); }
  if (url.protocol !== "https:" || url.username || url.password || /\s/.test(value)) throw new Error(`Use an absolute HTTPS URL for ${key}`);
  const host = url.hostname.toLowerCase();
  if (production && (/(^|\.)(example\.(com|net|org)|localhost)$/.test(host) || /\.(example|invalid|test|localhost)$/.test(host))) {
    throw new Error(`Replace the sample URL for ${key}`);
  }
}

function validateStories(value: unknown, production: boolean): asserts value is readonly EmailSection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) throw new Error("Provide 1 to 5 newsletter stories");
  for (const story of value) {
    if (!story || typeof story !== "object") throw new Error("Invalid newsletter story");
    validateText(story.heading, "story heading", 120);
    validateText(story.body, "story body", 1200);
    if (story.bullets !== undefined) {
      if (!Array.isArray(story.bullets) || story.bullets.length > 5) throw new Error("At most 5 bullets per story");
      for (const bullet of story.bullets) validateText(bullet, "story bullet", 300);
    }
    if (story.link !== undefined) {
      validateText(story.link?.label, "story link label", 100);
      validateText(story.link?.href, "story URL");
      validateUrl(story.link.href, "story URL", production);
    }
  }
}

/** Pure rendering only. No provider, scheduling, tracking or network access. */
export function buildTemplate(id: string, values: TemplateValues, options: { mode?: "production" | "preview"; colorMode?: EmailColorMode } = {}) {
  const template = getTemplate(id);
  const production = options.mode !== "preview";
  const colorMode = options.colorMode ?? "system";
  if (production && colorMode !== "system") throw new Error("Production emails must use adaptive system colours");
  for (const key of requiredVariables(id)) {
    const value = values[key];
    if (key === "stories") { validateStories(value, production); continue; }
    validateText(value, key);
    if (key.endsWith("_url")) validateUrl(value, key, production);
  }
  if (production && /sample|replace before sending/i.test(String(values.business_identity))) {
    throw new Error("Provide the real sending business identity and address");
  }
  const interpolate = (value: string): string => value.replace(tokenPattern, (_, key: string) => String(values[key]));
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return interpolate(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    return value;
  };
  const message = walk(template.message) as EmailMessage;
  message.sections = (template.message.sections ?? []).flatMap(section => "repeat" in section
    ? structuredClone(values[section.repeat] as readonly EmailSection[])
    : [walk(section) as EmailSection]);
  if (/[\r\n]/.test(message.subject) || message.subject.length > 200) throw new Error("Invalid email subject");
  message.footer = {
    reason: template.delivery === "transactional" ? "This is a service email about your Blockwise account."
      : template.delivery === "optional-service" ? "You enabled this Blockwise report. You can change your email preferences below."
      : "You subscribed to Blockwise updates. You can unsubscribe at any time.",
    businessIdentity: String(values.business_identity), supportUrl: String(values.support_url),
    ...(template.delivery !== "transactional" ? { preferencesUrl: String(values.preferences_url), unsubscribeUrl: String(values.unsubscribe_url) } : {}),
  };
  const rendered = renderEmail(message, "quiet-card", colorMode);
  const bytes = new TextEncoder().encode(rendered.html).length;
  if (bytes > 32_000) throw new Error("Email exceeds the 32 KB HTML budget; shorten the content");
  return { ...rendered, bytes, templateId: id, version: EMAIL_LIBRARY_VERSION, delivery: template.delivery };
}
