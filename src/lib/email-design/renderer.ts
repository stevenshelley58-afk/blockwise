import type { EmailMessage } from "./types.ts";

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
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? value : "#";
  } catch {
    return "#";
  }
}

const style = (value: string) => ` style="${value}"`;
const line = () => "border-top:1px solid #e9ebef;";
const logoCell = (filled: boolean) => `<td width="8" height="8" class="${filled ? "mark" : ""}"${style(`width:8px;height:8px;background:${filled ? "#16181d" : "transparent"};font-size:0;line-height:0;`)}>&nbsp;</td>`;
const logo = () => `<table role="presentation" cellpadding="0" cellspacing="2" border="0" aria-label="blockwise"${style("border-collapse:separate;display:inline-table;vertical-align:middle")}><tr>${logoCell(false)}${logoCell(false)}${logoCell(true)}</tr><tr>${logoCell(false)}${logoCell(true)}${logoCell(true)}</tr><tr>${logoCell(true)}${logoCell(true)}${logoCell(true)}</tr></table><span class="ink"${style("display:inline-block;margin-left:10px;font:700 20px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.7px;color:#16181d;vertical-align:middle")}>blockwise</span>`;

function details(message: EmailMessage) {
  if (!message.details?.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="detail-card"${style("width:100%;border:1px solid #e9ebef;border-radius:12px;background:#f6f7f9;overflow:hidden")}><tbody>${message.details.map((item, index) => `<tr><td${style(`padding:${index ? "12px 16px" : "14px 16px 12px"};font:600 10px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#545a66;text-transform:uppercase;${index ? line() : ""}`)}>${escapeHtml(item.label)}</td><td align="right"${style(`padding:${index ? "12px 16px" : "14px 16px 12px"};font:600 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d;${index ? line() : ""}`)}>${escapeHtml(item.value)}</td></tr>`).join("")}</tbody></table>`;
}

function footer(message: EmailMessage) {
  const info = message.footer;
  const reason = info?.reason ?? (message.transactional ? "This is a service email about your Blockwise account." : "You are receiving this Blockwise update.");
  const link = (label: string, url: string) => `<a class="muted" href="${escapeHtml(safeHref(url))}" style="display:inline-block;padding:10px 4px;color:#545a66;text-decoration:underline">${label}</a>`;
  const preferences = message.transactional ? "" : `<br>${info?.preferencesUrl ? `${link("Manage preferences", info.preferencesUrl)} · ` : ""}${link("Unsubscribe", info?.unsubscribeUrl ?? "#")}`;
  const support = info?.supportUrl ? `<br>${link("Help and support", info.supportUrl)}` : "";
  return `<tr><td class="muted" style="padding:24px 8px 24px;font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66;text-align:center">${escapeHtml(reason)}${preferences}${support}<br>${escapeHtml(info?.businessIdentity ?? "Blockwise · Perth, Australia")}</td></tr>`;
}

const contentCopy = (message: EmailMessage) => `<strong class="ink"${style(`font-weight:600;color:#16181d`)}>${escapeHtml(message.greeting)}</strong><br>${escapeHtml(message.intro)}`;

function sectionContent(message: EmailMessage): string {
  return (message.sections ?? []).map(section => `<tr><td class="body-cell" style="padding:22px 28px 0">${section.image ? `<img src="${escapeHtml(safeHref(section.image.src))}" alt="${escapeHtml(section.image.alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border-radius:10px;margin:0 0 12px" />` : ""}${section.heading ? `<h2 class="ink" style="margin:0 0 8px;font:700 17px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.2px;color:#16181d">${escapeHtml(section.heading)}</h2>` : ""}${section.body ? `<p class="muted" style="margin:0;font:400 15px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66;white-space:pre-line">${escapeHtml(section.body)}</p>` : ""}${section.bullets?.length ? `<ul class="muted" style="padding:0 0 0 20px;margin:10px 0 0;font:400 15px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66">${section.bullets.map(item => `<li style="padding:0 0 5px">${escapeHtml(item)}</li>`).join("")}</ul>` : ""}${section.link ? `<a class="ink" href="${escapeHtml(safeHref(section.link.href))}" style="display:inline-block;padding:12px 0;font:600 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d;text-decoration:underline">${escapeHtml(section.link.label)}</a>` : ""}</td></tr>`).join("");
}

function quietCard(message: EmailMessage) {
  const optionalDetails = message.details?.length ? `<tr><td class="body-cell" style="padding:22px 28px 0">${details(message)}</td></tr>` : "";
  const optionalAction = message.action || message.oneTimeCode ? `<tr><td class="body-cell" style="padding:22px 28px 0">${cta(message, "inline")}</td></tr>` : "";
  const optionalActionNote = message.actionNote ? `<tr><td class="body-cell muted" style="padding:10px 28px 0;font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66">${escapeHtml(message.actionNote)}</td></tr>` : "";
  const optionalEyebrow = message.eyebrow ? `<tr><td class="body-cell muted" style="padding:28px 28px 12px;font:600 10px/14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:#545a66">${escapeHtml(message.eyebrow)}</td></tr>` : "";
  const headPadding = message.eyebrow ? "0 28px" : "26px 28px 0";
  return `<tr><td align="center" style="padding:34px 20px 18px">${logo()}</td></tr><tr><td style="padding:0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card" style="width:100%;border:1px solid #e9ebef;border-radius:20px;background:#ffffff"><tbody>${optionalEyebrow}<tr><td class="body-cell" style="padding:${headPadding}"><h1 class="ink" style="margin:0;font:700 27px/32px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.5px;color:#16181d">${escapeHtml(message.heading)}</h1></td></tr><tr><td class="body-cell muted" style="padding:16px 28px 0;font:400 15px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66">${contentCopy(message)}</td></tr>${optionalDetails}${sectionContent(message)}${optionalAction}${optionalActionNote}${note(message, "padding:18px 28px 0")}${signOff(message, "padding:20px 28px 30px")}</tbody></table></td></tr>`;
}

function personalLetter(message: EmailMessage) {
  return `<tr><td${style("padding:34px 28px 24px")}>${logo()}</td></tr><tr><td${style("padding:0 28px")}><div class="rule"${style("height:1px;background:#16181d;font-size:0;line-height:0")}>&nbsp;</div></td></tr>${message.eyebrow ? `<tr><td class="muted"${style("padding:18px 28px 0;font:600 10px/14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:#545a66")}>${escapeHtml(message.eyebrow)}</td></tr>` : ""}<tr><td class="ink"${style("padding:16px 28px 0;font:700 30px/35px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.4px;color:#16181d")}>${escapeHtml(message.heading)}</td></tr><tr><td class="ink"${style("padding:20px 28px 0;font:400 16px/25px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d")}>${contentCopy(message)}</td></tr>${message.details?.length ? `<tr><td${style("padding:22px 28px 0")}>${details(message)}</td></tr>` : ""}<tr><td${style("padding:24px 28px 0")}>${cta(message, "letter")}</td></tr>${note(message, "padding:18px 28px 0")}${signOff(message, "padding:28px 28px 30px")}`;
}

function operationsBrief(message: EmailMessage) {
  return `<tr><td${style("padding:26px 24px 20px")}><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="brand-row"><tr><td>${logo()}</td><td align="right" class="muted"${style("font:600 10px/14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#545a66")}>${escapeHtml(message.eyebrow ?? "")}</td></tr></table></td></tr><tr><td${style("padding:0 24px")}><div class="rule"${style("height:3px;background:#16181d;font-size:0;line-height:0")}>&nbsp;</div></td></tr><tr><td class="ink"${style("padding:24px 24px 0;font:700 25px/30px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.4px;color:#16181d")}>${escapeHtml(message.heading)}</td></tr><tr><td class="muted"${style("padding:12px 24px 0;font:400 14px/21px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66")}>${contentCopy(message)}</td></tr>${message.details?.length ? `<tr><td${style("padding:20px 24px 0")}>${details(message)}</td></tr>` : ""}<tr><td${style("padding:20px 24px 0")}>${cta(message, "full")}</td></tr>${note(message, "padding:16px 24px 0")}${signOff(message, "padding:24px 24px 28px")}`;
}

function cta(message: EmailMessage, type: "inline" | "letter" | "full") {
  const styles = type === "letter"
    ? "display:inline-block;min-height:44px;box-sizing:border-box;padding:11px 0;border-bottom:2px solid #16181d;color:#16181d;font:700 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-decoration:none"
    : `display:${type === "full" ? "block" : "inline-block"};min-height:44px;box-sizing:border-box;padding:0;border:12px solid #16181d;border-left-width:18px;border-right-width:18px;mso-padding-alt:0;background:#16181d;border-radius:999px;color:#ffffff;font:700 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-decoration:none;${type === "full" ? "text-align:center" : ""}`;
  const code = message.oneTimeCode ? `<p class="muted" style="margin:22px 0 6px;font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66">Or enter this one-time code</p><p class="ink code" style="margin:0;font:700 28px/36px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:5px;color:#16181d">${escapeHtml(message.oneTimeCode)}</p>` : "";
  if (!message.action) return code;
  return `<a href="${escapeHtml(safeHref(message.action.href))}" class="action ${type === "letter" ? "letter-action" : ""}"${style(styles)}>${escapeHtml(message.action.label)}${type === "letter" ? " &nbsp;→" : ""}</a>${code}`;
}
function note(message: EmailMessage, padding: string) {
  return message.note ? `<tr><td class="body-cell muted"${style(`${padding};font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66`)}>${escapeHtml(message.note)}</td></tr>` : "";
}
function signOff(message: EmailMessage, padding: string) {
  // A sign-off is written with line breaks ("Steven\nPerth"); without pre-line
  // the HTML part collapses it onto one line while the text part keeps it.
  return `<tr><td class="body-cell"${style(`${padding};font:400 14px/21px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d;white-space:pre-line`)}>${escapeHtml(message.signOff ?? "The Blockwise team")}</td></tr>`;
}

const BASE_CSS = `body{margin:0!important;padding:0!important;background:#f6f7f9;color:#16181d}table{mso-table-lspace:0pt;mso-table-rspace:0pt}td{word-wrap:break-word}.email-bg{background:#f6f7f9}@media only screen and (max-width:600px){.outer{width:100%!important}.mobile-pad{padding-left:4px!important;padding-right:4px!important}.card{border-radius:16px!important}}@media only screen and (max-width:400px){.outer,.detail-card{table-layout:fixed!important}.body-cell{padding-left:20px!important;padding-right:20px!important}.detail-card td{display:block!important;width:auto!important;text-align:left!important;padding:8px 12px!important;border-top:0!important;word-wrap:break-word!important}.brand-row>tbody>tr>td{display:block!important;width:100%!important;text-align:left!important}.brand-row>tbody>tr>td+td{padding-top:12px!important}.code{font-size:26px!important;letter-spacing:3px!important}}`;

function paletteCss(prefix: string, dark: boolean): string {
  const p = (selector: string) => selector.split(",").map(part => `${prefix}${part}`).join(",");
  const ink = dark ? "#f5f6f8" : "#16181d";
  const muted = dark ? "#b9bec8" : "#545a66";
  const line = dark ? "#3a3f49" : "#e9ebef";
  return `${p("body,.email-bg")}{background:${dark ? "#121418" : "#f6f7f9"}!important}${p(".card")}{background:${dark ? "#1b1e24" : "#ffffff"}!important;border-color:${line}!important}${p(".detail-card")}{background:${dark ? "#242831" : "#f6f7f9"}!important;border-color:${line}!important}${p(".detail-card td")}{border-color:${line}!important}${p("td,span,p,h1,h2,li,strong,.ink")}{color:${ink}!important}${p(".muted,.muted *,td[style*='color:#545a66']")}{color:${muted}!important}${p(".ink,.ink *")}{color:${ink}!important}${p(".mark,.rule")}{background:${ink}!important}${p(".action")}{background:${ink}!important;border-color:${ink}!important;color:${dark ? "#16181d" : "#ffffff"}!important}${p(".letter-action")}{background:transparent!important;color:${ink}!important;border-color:${ink}!important}`;
}

export function renderEmail(message: EmailMessage, design: EmailDesign = "quiet-card", colorMode: EmailColorMode = "system"): RenderedEmail {
  const body = design === "quiet-card" ? quietCard(message) : design === "personal-letter" ? personalLetter(message) : operationsBrief(message);
  const forcedClass = colorMode === "system" ? "" : `email-force-${colorMode}`;
  // The same rules power native dark mode and the preview. No recipient tracking.
  const themeCss = colorMode === "system" ? `@media (prefers-color-scheme:dark){${paletteCss("", true)}}${paletteCss("[data-ogsc] ", true)}` : paletteCss("", colorMode === "dark");
  const html = `<!doctype html><html lang="en" class="${forcedClass}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(message.subject)}</title><style>${BASE_CSS}${themeCss}</style></head><body><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(message.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="width:100%;background:#f6f7f9"><tbody><tr><td align="center" class="mobile-pad" style="padding:0 16px"><!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="outer" style="width:100%;max-width:600px"><tbody>${body}${footer(message)}</tbody></table><!--[if mso]></td></tr></table><![endif]--></td></tr></tbody></table></body></html>`;
  const detailText = message.details?.map(item => `${item.label}: ${item.value}`).join("\n") ?? "";
  const sectionText = message.sections?.map(section => [section.heading, section.body, section.bullets?.map(item => `- ${item}`).join("\n"), section.link ? `${section.link.label}: ${safeHref(section.link.href)}` : ""].filter(Boolean).join("\n")).join("\n\n") ?? "";
  const foot = message.footer;
  const text = [message.subject, "", message.greeting, message.heading, message.intro, detailText, sectionText, message.action ? `${message.action.label}: ${safeHref(message.action.href)}` : "",
    message.actionNote ?? "", message.oneTimeCode ? `One-time code: ${message.oneTimeCode}` : "", message.note, message.signOff ?? "The Blockwise team", foot?.reason, foot?.supportUrl ? `Help: ${safeHref(foot.supportUrl)}` : "", !message.transactional && foot?.preferencesUrl ? `Preferences: ${safeHref(foot.preferencesUrl)}` : "", !message.transactional && foot?.unsubscribeUrl ? `Unsubscribe: ${safeHref(foot.unsubscribeUrl)}` : "", foot?.businessIdentity].filter(Boolean).join("\n\n");
  return { html, text, subject: message.subject };
}
