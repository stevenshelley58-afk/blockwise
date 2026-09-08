import type { EmailMessage, EmailChart, EmailAdPreview } from "./types.ts";

export const EMAIL_DESIGNS = ["quiet-card", "personal-letter", "operations-brief"] as const;
export type EmailDesign = (typeof EMAIL_DESIGNS)[number];
export type EmailColorMode = "system" | "light" | "dark";
export type RenderedEmail = { html: string; text: string; subject: string };

export const EMAIL_DESIGN_LABELS: Record<EmailDesign, { number: string; name: string; description: string }> = {
  "quiet-card": { number: "01", name: "Quiet card", description: "Centered, modular, and calm." },
  "personal-letter": { number: "02", name: "Personal letter", description: "Editorial, text-first, and direct." },
  "operations-brief": { number: "03", name: "Operations brief", description: "Compact context and scannable detail." },
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

export function safeHref(value: string): string {
  if (/^tel:\+[1-9]\d{7,14}$/.test(value)) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? value : "#";
  } catch {
    return "#";
  }
}

const FONT_HEAD = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
const FONT_BODY = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
const DATA_BLUE = "#2a78d6";
const DATA_TRACK = "#e1ebf8";
const INK = "#16181d";
const MUTED = "#545a66";
const LINE = "#e9ebef";
const AD_WIDTH = 640;
const AD_HEIGHT = 1138;
// Hallmark / Impeccable: inherited Quiet Card, title-first performance brief.
// Emil: tight information groups, balanced columns, immediate email-safe actions.
// Brand tokens compile to literal CSS for email-client compatibility.

const style = (value: string) => ` style="${value}"`;
const line = () => "border-top:1px solid #e9ebef;";
const logoCell = (filled: boolean) => `<td width="8" height="8" class="${filled ? "mark" : ""}"${style(`width:8px;height:8px;background:${filled ? "#16181d" : "transparent"};font-size:0;line-height:0;`)}>&nbsp;</td>`;
const logo = () => `<table role="presentation" cellpadding="0" cellspacing="2" border="0" aria-label="blockwise"${style("border-collapse:separate;display:inline-table;vertical-align:middle")}><tr>${logoCell(false)}${logoCell(false)}${logoCell(true)}</tr><tr>${logoCell(false)}${logoCell(true)}${logoCell(true)}</tr><tr>${logoCell(true)}${logoCell(true)}${logoCell(true)}</tr></table><span class="ink"${style("display:inline-block;margin-left:10px;font:700 20px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.7px;color:#16181d;vertical-align:middle")}>blockwise</span>`;

function details(message: EmailMessage) {
  if (!message.details?.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="detail-card summary-metrics" style="width:100%;border-top:1px solid #e9ebef"><tbody><tr><td colspan="2" height="22"></td></tr>${message.details.map(item => `<tr><td class="lead-label muted" width="150" valign="top" style="padding:0 16px 14px 0;font:400 14px/22px ${FONT_BODY};color:${MUTED}">${escapeHtml(item.label)}</td><td class="lead-value ink" valign="top" style="padding:0 0 14px;font:400 15px/22px ${FONT_BODY};color:${INK};overflow-wrap:anywhere">${escapeHtml(item.value)}</td></tr>`).join("")}</tbody></table>`;
}

function footer(message: EmailMessage, inset = false) {
  const info = message.footer;
  const reason = info?.reason ?? (message.transactional ? "This is a service email about your Blockwise account." : "You are receiving this Blockwise update.");
  const link = (label: string, url: string) => `<a class="muted" href="${escapeHtml(safeHref(url))}" style="display:inline-block;min-height:44px;box-sizing:border-box;padding:12px 4px;color:#545a66;text-decoration:underline">${escapeHtml(label)}</a>`;
  const preferences = message.transactional ? "" : `<br>${link("Manage preferences", info?.preferencesUrl ?? "#")} · ${link(info?.unsubscribeLabel ?? "Unsubscribe", info?.unsubscribeUrl ?? "#")}`;
  const support = info?.supportUrl ? `<br>${link("Help and support", info.supportUrl)}` : "";
  return `<tr><td class="muted ${inset ? "email-footer body-cell" : ""}" style="padding:${inset ? "24px 28px" : "24px 8px"};font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66;text-align:${inset ? "left" : "center"};${inset ? "background:#f1f2f4;border-top:1px solid #e9ebef;border-radius:0 0 15px 15px;" : ""}">${inset ? `<p class="ink" style="margin:0 0 8px;font:700 16px/22px ${FONT_BODY};letter-spacing:-.4px;color:${INK}">blockwise</p>` : ""}${escapeHtml(reason)}${preferences}${support}<br>${escapeHtml(info?.businessIdentity ?? "Blockwise · Perth, Australia")}</td></tr>`;
}

// Approved common masthead: fixed ink/white in both themes, not an inverted body surface.
function header(message: EmailMessage): string {
  const mark = logo().replaceAll('class="mark"', 'class="header-mark"').replaceAll('class="ink"', 'class="header-ink"').replaceAll('#16181d', '#ffffff');
  return `<tr><td class="email-header body-cell" style="padding:24px 28px;background:#16181d;border-radius:15px 15px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="header-ink">${mark}</td><td class="header-ink header-label" align="right" style="padding-left:16px;color:#ffffff;font:400 12px/18px ${FONT_BODY}">${escapeHtml(message.eyebrow)}</td></tr></table></td></tr>`;
}

const contentCopy = (message: EmailMessage) => `<strong class="ink"${style(`font-weight:600;color:#16181d`)}>${escapeHtml(message.greeting)}</strong><br>${escapeHtml(message.intro)}`;

function summary(message: EmailMessage): string {
  const data = message.summary;
  if (!data) return "";
  return `<tr><td class="body-cell" style="padding:24px 28px 0"><p class="muted" style="margin:0 0 5px;font:600 11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#545a66">${escapeHtml(data.label)}</p><p class="ink summary-value" style="margin:0;font:700 28px/33px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-2px;color:#16181d">${escapeHtml(data.value)}</p>${data.caption ? `<p class="muted" style="margin:5px 0 0;font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66">${escapeHtml(data.caption)}</p>` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="summary-metrics summary-stats" style="width:100%;table-layout:fixed;margin-top:20px;border-top:1px solid #e9ebef"><tr>${data.metrics.map(metric => `<td style="padding:15px 10px 0 0;vertical-align:top"><p class="muted" style="margin:0 0 5px;font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66">${escapeHtml(metric.label)}</p><p class="ink" style="margin:0;font:700 20px/26px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.4px;color:#16181d">${escapeHtml(metric.value)}</p></td>`).join("")}</tr></table></td></tr>`;
}

function sectionContent(message: EmailMessage): string {
  return (message.sections ?? []).map(section => section.layout === "list-item" ? `<tr><td class="body-cell" style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="summary-metrics" style="width:100%;border-bottom:1px solid #e9ebef"><tr><td style="padding-bottom:12px"><h2 class="ink" style="margin:0 0 4px;font:600 14px/20px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#16181d">${escapeHtml(section.heading ?? "")}</h2><p class="muted" style="margin:0;font:400 12px/18px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#545a66">${escapeHtml(section.body ?? "")}</p>${section.link ? `<a class="ink" href="${escapeHtml(safeHref(section.link.href))}" style="display:inline-block;padding:12px 0;color:#16181d;font-size:14px">${escapeHtml(section.link.label)}</a>` : ""}</td></tr></table></td></tr>` : `<tr><td class="body-cell" style="padding:22px 28px 0">${section.heading ? `<h2 class="ink" style="margin:0 0 8px;font:700 17px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.2px;color:#16181d">${escapeHtml(section.heading)}</h2>` : ""}${section.body ? `<p class="muted" style="margin:0;font:400 15px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66;white-space:pre-line">${escapeHtml(section.body)}</p>` : ""}${section.bullets?.length ? `<ul class="muted" style="padding:0 0 0 20px;margin:10px 0 0;font:400 15px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66">${section.bullets.map(item => `<li style="padding:0 0 5px">${escapeHtml(item)}</li>`).join("")}</ul>` : ""}${section.link ? `<a class="ink" href="${escapeHtml(safeHref(section.link.href))}" style="display:inline-block;padding:12px 0;font:600 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d;text-decoration:underline">${escapeHtml(section.link.label)}</a>` : ""}</td></tr>`).join("");
}

function chartMarkup(chart: EmailChart | undefined): string {
  if (!chart || chart.kind !== "line" || !chart.values.length) return "";
  const alt = `${chart.title}: ${chart.values.map(p => `${p.label} ${p.value}`).join(", ")}. ${chart.unit}.`;
  const image = chart.imageUrl ? `<img class="${chart.darkImageUrl ? "chart-light" : "chart-single"}" src="${escapeHtml(safeHref(chart.imageUrl))}" alt="${escapeHtml(alt)}" width="520" height="180" style="display:block;width:100%;height:auto;border:0">${chart.darkImageUrl ? `<!--[if !mso]><!--><img class="chart-dark" src="${escapeHtml(safeHref(chart.darkImageUrl))}" alt="${escapeHtml(alt)}" width="520" height="180" style="display:none;width:100%;height:auto;border:0;mso-hide:all"><!--<![endif]-->` : ""}` : "";
  const points = chart.values.map(p => `<td valign="top" style="padding:8px 2px;font:400 11px/16px ${FONT_BODY};text-align:center"><span class="muted" style="color:${MUTED}">${escapeHtml(p.label)}</span><br><strong class="ink" style="color:${INK}">${p.value}</strong></td>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="chart-table summary-metrics" style="width:100%;table-layout:fixed;border-top:1px solid ${LINE}"><tr><td colspan="${chart.values.length}" class="ink" style="padding:20px 0 12px;font:700 16px/22px ${FONT_HEAD};color:${INK}">${escapeHtml(chart.title)}</td></tr>${image ? `<tr><td colspan="${chart.values.length}">${image}</td></tr>` : ""}<tr>${points}</tr><tr><td colspan="${chart.values.length}" class="muted" style="font:400 12px/18px ${FONT_BODY};color:${MUTED}">${escapeHtml(chart.unit)}</td></tr></table>`;
}

function chartBlock(chart: EmailChart | undefined): string { const markup = chartMarkup(chart); return markup ? `<tr><td class="body-cell" style="padding:24px 28px 0">${markup}</td></tr>` : ""; }
function adMarkup(previews: ReadonlyArray<EmailAdPreview> | undefined, heading = "Creative context"): string {
  if (!previews?.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="creative-grid summary-metrics" style="width:100%;border-top:1px solid ${LINE}"><tr><td colspan="2" class="ink" style="padding:20px 0 12px;font:700 16px/22px ${FONT_HEAD};color:${INK}">${escapeHtml(heading)}</td></tr>${previews.slice(0,2).map(item => `<tr><td width="52" valign="middle" style="padding:0 14px 16px 0"><img src="${escapeHtml(safeHref(item.src))}" width="52" height="${Math.round(52*(item.height ?? AD_HEIGHT)/(item.width ?? AD_WIDTH))}" alt="${escapeHtml(item.alt)}" style="display:block;width:52px!important;max-width:52px!important;height:auto;border-radius:6px"></td><td valign="middle" style="padding-bottom:16px"><p class="ink" style="margin:0 0 3px;font:600 14px/20px ${FONT_BODY};color:${INK}">${escapeHtml(item.label)}</p>${item.detail ? `<p class="muted" style="margin:0;font:400 13px/19px ${FONT_BODY};color:${MUTED}">${escapeHtml(item.detail)}</p>` : ""}</td></tr>`).join("")}</table>`;
}

function adBlock(previews: ReadonlyArray<EmailAdPreview> | undefined): string { const markup = adMarkup(previews); return markup ? `<tr><td class="body-cell" style="padding:24px 28px 0">${markup}</td></tr>` : ""; }
function dailyActivity(message: EmailMessage): string {
  const rows = message.sections?.filter(section => section.layout === "list-item") ?? [];
  if (!rows.length) return "";
  const intro = message.sections?.[0];
  return `<div class="daily-activity"><h2 class="ink" style="margin:24px 0 6px;font:800 14px/20px ${FONT_HEAD};color:${INK}">${escapeHtml(intro?.heading ?? "Latest leads")}</h2>${intro?.body ? `<p class="muted" style="margin:0 0 6px;font:400 11px/16px ${FONT_BODY};color:${MUTED}">${escapeHtml(intro.body)}</p>` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(item => `<tr><td class="summary-metrics" style="padding:10px 0;border-bottom:1px solid ${LINE}"><p class="ink" style="margin:0 0 3px;font:700 12px/17px ${FONT_BODY};color:${INK}">${escapeHtml(item.heading ?? "")}</p><p class="muted" style="margin:0;font:400 11px/16px ${FONT_BODY};color:${MUTED}">${escapeHtml(item.body ?? "")}</p>${item.link ? `<a class="ink" style="display:inline-block;padding:12px 0;font:600 12px/18px ${FONT_BODY};color:${INK}" href="${escapeHtml(safeHref(item.link.href))}">${escapeHtml(item.link.label)}</a>` : ""}</td></tr>`).join("")}</table></div>`;
}
function dailyVisual(message: EmailMessage): string {
  const chart=chartMarkup(message.visual?.chart), ad=adMarkup(message.visual?.adPreviews?.slice(0,1), "Featured creative");
  return chart || ad ? `<tr><td class="body-cell" style="padding:24px 28px 0">${chart}${chart && ad ? dailyActivity(message) : ""}${ad ? `<div style="padding-top:24px">${ad}</div>` : ""}</td></tr>` : "";
}

function newLeadVisual(message: EmailMessage): string {
  const ad = adMarkup(message.visual?.adPreviews?.slice(0, 1), "Related creative"); const info = message.details?.length ? details(message) : "";
  if (!ad && !info) return "";
  return `<tr><td class="body-cell" style="padding:24px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="lead-visual" style="width:100%"><tr>${ad ? `<td class="visual-column creative-column" valign="top" style="width:55%;padding:0 18px 0 0;vertical-align:top">${ad}</td>` : ""}${info ? `<td class="visual-column" valign="top" style="width:45%;padding:0;vertical-align:top">${info}</td>` : ""}</tr></table></td></tr>`;
}
function notificationCard(message: EmailMessage): string {
  const isNewLead = message.kind === "new-lead";
  const visual = isNewLead ? newLeadVisual(message) : message.kind === "daily-digest" ? dailyVisual(message) : chartBlock(message.visual?.chart) + (message.visual?.adPreviews?.length ? `<tr><td class="body-cell" style="padding:24px 28px 0">${adMarkup(message.visual.adPreviews, message.sections?.[0]?.heading ?? "Creative results")}${message.sections?.[0]?.body ? `<p class="muted" style="margin:10px 0 0;font:400 12px/18px ${FONT_BODY};color:${MUTED}">${escapeHtml(message.sections[0].body)}</p>` : ""}</td></tr>` : "");
  const stats = message.summary ? [message.summary.value, ...message.summary.metrics.slice(0, 2).map(item => item.value)] : [];
  const labels = message.summary ? [message.summary.label, ...message.summary.metrics.slice(0, 2).map(item => item.label)] : [];
  const caption = message.summary?.caption ? `<p class="muted summary-caption" style="margin:8px 0 0;font:400 12px/18px ${FONT_BODY};color:${MUTED}">${escapeHtml(message.summary.caption)}</p>` : "";
  const strip = stats.length ? `<tr><td class="body-cell" style="padding:20px 28px 0">${caption}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="summary-metrics notification-stats" style="width:100%;table-layout:fixed;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE}"><tr>${stats.map((value, i) => `<td style="padding:13px 8px 14px 0;vertical-align:top"><p class="muted" style="margin:0 0 4px;font:600 11px/15px ${FONT_BODY};color:${MUTED}">${escapeHtml(labels[i] ?? "")}</p><p class="ink" style="margin:0;font:800 20px/24px ${FONT_HEAD};letter-spacing:-.3px;color:${INK}">${escapeHtml(value)}</p></td>`).join("")}</tr></table></td></tr>` : "";
  const intro = isNewLead ? `<strong class="ink" style="font-weight:600;color:${INK}">${escapeHtml(message.greeting)}</strong><br>${escapeHtml(message.intro)}` : escapeHtml(message.intro);
  const action = message.action || message.oneTimeCode ? `<tr><td class="body-cell" style="padding:22px 28px 0">${cta(message, "full")}</td></tr>` : "";
  const detailsRow = !isNewLead && message.details?.length ? `<tr><td class="body-cell" style="padding:22px 28px 0">${details(message)}</td></tr>` : "";
  const hasWeeklyCreatives = message.kind === "weekly-performance" && !!message.visual?.adPreviews?.length;
  const hasDailyActivity = message.kind === "daily-digest" && !!message.visual?.chart && !!message.visual?.adPreviews?.length && message.sections?.some(section => section.layout === "list-item");
  const sections = sectionContent((hasWeeklyCreatives || hasDailyActivity) ? { ...message, sections: message.sections?.filter((section, index) => index !== 0 && section.layout !== "list-item") } : message);
  return `<tr><td style="padding:24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card notification-card" style="width:100%;border:1px solid ${LINE};border-radius:16px;background:#ffffff"><tbody>${header(message)}<tr><td class="body-cell" style="padding:28px 28px 0"><h1 class="ink" style="margin:0;font:800 28px/32px ${FONT_HEAD};letter-spacing:-.6px;color:${INK}">${escapeHtml(message.heading)}</h1><p class="muted period-intro" style="margin:10px 0 0;font:400 13.5px/20px ${FONT_BODY};color:${MUTED}">${intro}</p></td></tr>${strip}${isNewLead ? action : ""}${visual}${isNewLead ? "" : detailsRow}${sections}${isNewLead ? "" : action}${note(message, "padding:18px 28px 0")}${signOff(message, "padding:20px 28px 30px")}${footer(message, true)}</tbody></table></td></tr>`;
}
function leadAlert(message: EmailMessage): string {
  const contact = message.leadContact!;
  const phone = /^\+[1-9]\d{7,14}$/.test(contact.phone) ? `tel:${contact.phone}` : "#";
  const email = /^[^\s@?&]+@[^\s@?&]+\.[^\s@?&]+$/.test(contact.email) ? `mailto:${contact.email}` : "#";
  const rows = (message.details ?? []).map(item => {
    const href = item.label === "Phone" ? phone : item.label === "Email" ? email : undefined;
    const value = href ? `<a class="ink" href="${escapeHtml(href)}" style="color:${INK};text-decoration:underline">${escapeHtml(item.value)}</a>` : escapeHtml(item.value);
    return `<tr><td class="lead-label muted" width="150" valign="top" style="padding:0 16px 14px 0;font:400 14px/22px ${FONT_BODY};color:${MUTED}">${escapeHtml(item.label)}</td><td class="lead-value ink" valign="top" style="padding:0 0 14px;font:400 15px/22px ${FONT_BODY};color:${INK};overflow-wrap:anywhere">${value}</td></tr>`;
  }).join("");
  const ad = message.visual?.adPreviews?.[0];
  const image = ad ? `<td width="52" valign="middle" style="padding-right:14px"><img src="${escapeHtml(safeHref(ad.src))}" width="52" height="${Math.round(52*(ad.height ?? AD_HEIGHT)/(ad.width ?? AD_WIDTH))}" alt="${escapeHtml(ad.alt)}" style="display:block;width:52px;height:auto;border-radius:6px"></td>` : "";
  const call = cta({ ...message, action: {label:`Call ${contact.firstName}`,href:phone}}, "inline");
  const view = message.action ? `<a class="lead-secondary ink" href="${escapeHtml(safeHref(message.action.href))}" style="display:inline-block;border:1px solid #d3d7df;border-radius:999px;padding:11px 20px;min-height:44px;box-sizing:border-box;color:${INK};font:600 14px/20px ${FONT_BODY};text-decoration:none">${escapeHtml(message.action.label)}</a>` : "";
  return `<tr><td style="padding:24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="background:#ffffff;border:1px solid ${LINE};border-radius:16px"><tbody>${header(message)}<tr><td class="body-cell" style="padding:32px 40px 0"><h1 class="ink" style="margin:0 0 8px;font:700 34px/40px ${FONT_HEAD};letter-spacing:-.7px;color:${INK}">${escapeHtml(message.heading)}</h1><p class="ink" style="margin:0 0 6px;font:400 18px/26px ${FONT_BODY};color:${INK}">${escapeHtml(message.intro)}</p><p class="muted" style="margin:0;font:400 14px/22px ${FONT_BODY};color:${MUTED}">Received ${escapeHtml(contact.received)} from your ${escapeHtml(contact.source)}.</p></td></tr><tr><td class="body-cell" style="padding:28px 40px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="summary-metrics" style="border-top:1px solid ${LINE}"><tr><td colspan="2" height="24"></td></tr>${rows}</table></td></tr><tr><td class="body-cell" style="padding:14px 40px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="summary-metrics" style="border-top:1px solid ${LINE}"><tr><td colspan="2" height="20"></td></tr><tr>${image}<td valign="middle"><p class="ink" style="margin:0 0 2px;font:600 14px/20px ${FONT_BODY};color:${INK}">${escapeHtml(contact.campaign)}</p><p class="muted" style="margin:0;font:400 13px/19px ${FONT_BODY};color:${MUTED}">${escapeHtml(contact.source)}</p></td></tr></table></td></tr><tr><td class="body-cell" style="padding:30px 40px 34px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="lead-action" style="padding-right:12px">${call}</td><td class="lead-action">${view}</td></tr></table></td></tr>${footer(message,true)}</tbody></table></td></tr>`;
}

function quietCard(message: EmailMessage) {
  if (message.kind === "new-lead" && message.leadContact) return leadAlert(message);
  if (message.kind === "daily-digest" || message.kind === "weekly-performance" || message.kind === "new-lead") return notificationCard(message);
  const optionalDetails = message.details?.length ? `<tr><td class="body-cell" style="padding:22px 28px 0">${details(message)}</td></tr>` : "";
  const optionalAction = message.action || message.oneTimeCode ? `<tr><td class="body-cell" style="padding:22px 28px 0">${cta(message, "inline")}</td></tr>` : "";
  return `<tr><td style="padding:24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card" style="width:100%;border:1px solid #e9ebef;border-radius:16px;background:#ffffff"><tbody>${header(message)}<tr><td class="body-cell" style="padding:28px 28px 0"><h1 class="ink" style="margin:0;font:700 27px/32px ${FONT_BODY};letter-spacing:-.5px;color:#16181d">${escapeHtml(message.heading)}</h1></td></tr><tr><td class="body-cell muted" style="padding:16px 28px 0;white-space:pre-line;font:400 15px/23px ${FONT_BODY};color:#545a66">${contentCopy(message)}</td></tr>${summary(message)}${optionalDetails}${sectionContent(message)}${optionalAction}${note(message, "padding:18px 28px 0")}${signOff(message, "padding:20px 28px 30px")}${footer(message, true)}</tbody></table></td></tr>`;
}

function personalLetter(message: EmailMessage) {
  return `<tr><td${style("padding:34px 28px 24px")}>${logo()}</td></tr><tr><td${style("padding:0 28px")}><div class="rule"${style("height:1px;background:#16181d;font-size:0;line-height:0")}>&nbsp;</div></td></tr><tr><td class="muted"${style("padding:18px 28px 0;font:600 10px/14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:#545a66")}>${escapeHtml(message.eyebrow)}</td></tr><tr><td class="ink"${style("padding:16px 28px 0;font:700 30px/35px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.4px;color:#16181d")}>${escapeHtml(message.heading)}</td></tr><tr><td class="ink"${style("padding:20px 28px 0;font:400 16px/25px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d")}>${contentCopy(message)}</td></tr>${message.details?.length ? `<tr><td${style("padding:22px 28px 0")}>${details(message)}</td></tr>` : ""}<tr><td${style("padding:24px 28px 0")}>${cta(message, "letter")}</td></tr>${note(message, "padding:18px 28px 0")}${signOff(message, "padding:28px 28px 30px")}`;
}

function operationsBrief(message: EmailMessage) {
  return `<tr><td${style("padding:26px 24px 20px")}><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="brand-row"><tr><td>${logo()}</td><td align="right" class="muted"${style("font:600 10px/14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#545a66")}>${escapeHtml(message.eyebrow)}</td></tr></table></td></tr><tr><td${style("padding:0 24px")}><div class="rule"${style("height:3px;background:#16181d;font-size:0;line-height:0")}>&nbsp;</div></td></tr><tr><td class="ink"${style("padding:24px 24px 0;font:700 25px/30px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.4px;color:#16181d")}>${escapeHtml(message.heading)}</td></tr><tr><td class="muted"${style("padding:12px 24px 0;font:400 14px/21px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66")}>${contentCopy(message)}</td></tr>${message.details?.length ? `<tr><td${style("padding:20px 24px 0")}>${details(message)}</td></tr>` : ""}<tr><td${style("padding:20px 24px 0")}>${cta(message, "full")}</td></tr>${note(message, "padding:16px 24px 0")}${signOff(message, "padding:24px 24px 28px")}`;
}

function cta(message: EmailMessage, type: "inline" | "letter" | "full") {
  const styles = type === "letter"
    ? "display:inline-block;min-height:44px;box-sizing:border-box;padding:11px 0;border-bottom:2px solid #16181d;color:#16181d;font:700 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-decoration:none"
    : "display:inline-block;min-height:44px;max-width:100%;box-sizing:border-box;padding:0;border:12px solid #16181d;border-left-width:20px;border-right-width:20px;mso-padding-alt:0;background:#16181d;border-radius:999px;color:#ffffff;font:600 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-decoration:none;text-align:center";
  const code = message.oneTimeCode ? `<p class="muted" style="margin:22px 0 6px;font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66">Or enter this one-time code</p><p class="ink code" style="margin:0;font:700 28px/36px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:5px;color:#16181d">${escapeHtml(message.oneTimeCode)}</p>` : "";
  if (!message.action) return code;
  return `<a href="${escapeHtml(safeHref(message.action.href))}" class="action ${type === "letter" ? "letter-action" : ""}"${style(styles)}>${escapeHtml(message.action.label)}${type === "letter" ? " &nbsp;→" : ""}</a>${code}`;
}
function note(message: EmailMessage, padding: string) {
  return message.note ? `<tr><td class="body-cell muted"${style(`${padding};font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66`)}>${escapeHtml(message.note)}</td></tr>` : "";
}
function signOff(message: EmailMessage, padding: string) {
  return `<tr><td class="body-cell"${style(`${padding};font:400 14px/21px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d`)}>${escapeHtml(message.signOff ?? "The Blockwise team")}</td></tr>`;
}

const BASE_CSS = `body{margin:0!important;padding:0!important;background:#f6f7f9;color:#16181d}table{mso-table-lspace:0pt;mso-table-rspace:0pt}td{word-wrap:break-word}.email-bg{background:#f6f7f9}.period-intro{white-space:pre-line}.body-cell{padding-left:40px!important;padding-right:40px!important}.email-header table{table-layout:auto}.email-header .header-label{max-width:180px;overflow-wrap:anywhere}a:focus-visible{outline:2px solid #545a66;outline-offset:3px}@media only screen and (max-width:600px){.lead-label,.lead-value{display:block!important;width:auto!important}.lead-label{padding-bottom:3px!important}.outer{width:100%!important}.mobile-pad{padding-left:4px!important;padding-right:4px!important}.card{border-radius:16px!important}.creative-grid img{max-width:220px!important}}@media only screen and (max-width:400px){.lead-action{display:block!important;padding:0 0 10px!important;width:auto!important}.outer,.detail-card{table-layout:fixed!important}.body-cell{padding-left:20px!important;padding-right:20px!important}.detail-card td{display:block!important;width:auto!important;text-align:left!important;padding:8px 12px!important;border-top:0!important;word-wrap:break-word!important}.brand-row>tbody>tr>td{display:block!important;width:100%!important;text-align:left!important}.brand-row>tbody>tr>td+td{padding-top:12px!important}.summary-value{font-size:40px!important;line-height:46px!important;letter-spacing:-1px!important}.summary-stats td{display:block!important;width:auto!important;padding:12px 0 0!important}.summary-stats td p{display:inline-block!important;width:48%!important;vertical-align:top!important}.summary-stats td p.ink{text-align:right!important;font-size:18px!important}.code{font-size:26px!important;letter-spacing:3px!important}.notification-card h1{font-size:24px!important;line-height:28px!important}.notification-stats td{display:block!important;width:100%!important;box-sizing:border-box!important;padding:8px 0!important}.notification-stats td p{display:inline-block!important;vertical-align:top!important;margin:0!important}.notification-stats td p.muted{width:45%!important}.notification-stats td p.ink{width:55%!important;font-size:16px!important;line-height:22px!important;text-align:right!important;overflow-wrap:anywhere!important}.daily-visual>tbody>tr>td,.lead-visual>tbody>tr>td{display:block!important;width:100%!important;padding:0!important}.daily-visual .creative-column{padding-top:22px!important}.lead-visual .creative-column{padding-top:0!important}.creative-grid>tbody>tr>td.creative-column{display:block!important;width:100%!important;padding:0 0 18px!important}.creative-grid img{width:100%!important;max-width:220px!important;height:auto!important}.chart-table{table-layout:fixed!important}.chart-label{font-size:10px!important;line-height:12px!important;overflow-wrap:anywhere!important}}`;

function paletteCss(prefix: string, dark: boolean): string {
  const p = (selector: string) => selector.split(",").map(part => `${prefix}${part}`).join(",");
  const ink = dark ? "#f5f6f8" : "#16181d";
  const muted = dark ? "#b9bec8" : "#545a66";
  const line = dark ? "#3a3f49" : "#e9ebef";
  return `${p("body,.email-bg")}{background:${dark ? "#121418" : "#f6f7f9"}!important}${p(".card")}{background:${dark ? "#1b1e24" : "#ffffff"}!important;border-color:${line}!important}${p(".detail-card")}{background:transparent!important;border-color:${line}!important}${p(".detail-card td,.summary-metrics")}{border-color:${line}!important}${p("td,span,p,h1,h2,li,strong,.ink")}{color:${ink}!important}${p(".muted,.muted *,td[style*='color:#545a66']")}{color:${muted}!important}${p(".ink,.ink *")}{color:${ink}!important}${p(".mark,.rule")}{background:${ink}!important}${p(".action")}{background:${ink}!important;border-color:${ink}!important;color:${dark ? "#16181d" : "#ffffff"}!important}${p(".letter-action")}{background:transparent!important;color:${ink}!important;border-color:${ink}!important}${p(".chart-track")}{background:${dark ? "#31415a" : DATA_TRACK}!important}${p(".chart-bar")}{background:${DATA_BLUE}!important}${p(".chart-table,.creative-grid,.notification-stats")}{border-color:${line}!important}${p(".email-footer")}{background:${dark ? "#242831" : "#f1f2f4"}!important;border-color:${line}!important}${p(".email-header")}{background:#16181d!important}${p(".email-header td,.email-header span,.header-ink")}{color:#ffffff!important}${p(".header-mark")}{background:#ffffff!important}${p(".chart-light")}{display:${dark ? "none" : "block"}!important}${p(".chart-dark")}{display:${dark ? "block" : "none"}!important}`;
}

export function renderEmail(message: EmailMessage, design: EmailDesign = "quiet-card", colorMode: EmailColorMode = "system"): RenderedEmail {
  const body = design === "quiet-card" ? quietCard(message) : design === "personal-letter" ? personalLetter(message) : operationsBrief(message);
  const forcedClass = colorMode === "system" ? "" : `email-force-${colorMode}`;
  // The same rules power native dark mode and the preview. No recipient tracking.
  const themeCss = colorMode === "system" ? `@media (prefers-color-scheme:dark){${paletteCss("", true)}}${paletteCss("[data-ogsc] ", true)}` : paletteCss("", colorMode === "dark");
  const html = `<!doctype html><html lang="en" class="${forcedClass}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(message.subject)}</title><style>${BASE_CSS}${themeCss}</style></head><body><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(message.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="width:100%;background:#f6f7f9"><tbody><tr><td align="center" class="mobile-pad" style="padding:0 16px"><!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="outer" style="width:100%;max-width:600px"><tbody>${body}${design === "quiet-card" ? "" : footer(message)}</tbody></table><!--[if mso]></td></tr></table><![endif]--></td></tr></tbody></table></body></html>`;
  const summaryText = message.summary ? [message.summary.label + ": " + message.summary.value, message.summary.caption, ...message.summary.metrics.map(item => `${item.label}: ${item.value}`)].filter(Boolean).join("\n") : "";
  const detailText = message.details?.map(item => `${item.label}: ${item.value}`).join("\n") ?? "";
  const sectionText = message.sections?.map(section => [section.heading, section.body, section.bullets?.map(item => `- ${item}`).join("\n"), section.link ? `${section.link.label}: ${safeHref(section.link.href)}` : ""].filter(Boolean).join("\n")).join("\n\n") ?? "";
  const foot = message.footer;
  const chartText = message.visual?.chart ? [`${message.visual.chart.title} (${message.visual.chart.unit})`, ...message.visual.chart.values.map(item => `${item.label}: ${item.value}`)].join("\n") : "";
  const adText = message.visual?.adPreviews?.map(item => [`${item.label} (${item.alt})`, item.detail].filter(Boolean).join(" - ")).join("\n") ?? "";
  const text = [message.leadContact ? `Call ${message.leadContact.firstName}: ${message.leadContact.phone}\nReceived ${message.leadContact.received}\n${message.leadContact.campaign} · ${message.leadContact.source}` : "", message.subject, "", message.greeting, message.heading, message.intro, summaryText, detailText, sectionText, message.action ? `${message.action.label}: ${safeHref(message.action.href)}` : "", message.oneTimeCode ? `One-time code: ${message.oneTimeCode}` : "", chartText, adText, message.note, message.signOff ?? "The Blockwise team", foot?.reason, foot?.supportUrl ? `Help: ${safeHref(foot.supportUrl)}` : "", !message.transactional && foot?.preferencesUrl ? `Preferences: ${safeHref(foot.preferencesUrl)}` : "", !message.transactional && foot?.unsubscribeUrl ? `Unsubscribe: ${safeHref(foot.unsubscribeUrl)}${foot.unsubscribeLabel ? ` (${foot.unsubscribeLabel})` : ""}` : "", foot?.businessIdentity].filter(Boolean).join("\n\n");
  return { html, text, subject: message.subject };
}
