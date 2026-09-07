import type { EmailMessage } from "./fixtures";

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
const line = (top = false) => `border-${top ? "top:" : ""}1px solid #e9ebef;`;
const logoCell = (filled: boolean) => `<td width="8" height="8" class="${filled ? "mark" : ""}"${style(`width:8px;height:8px;background:${filled ? "#16181d" : "transparent"};font-size:0;line-height:0;`)}>&nbsp;</td>`;
const logo = () => `<table role="presentation" cellpadding="0" cellspacing="2" border="0" aria-label="blockwise"${style("border-collapse:separate;display:inline-table;vertical-align:middle")}><tr>${logoCell(false)}${logoCell(false)}${logoCell(true)}</tr><tr>${logoCell(false)}${logoCell(true)}${logoCell(true)}</tr><tr>${logoCell(true)}${logoCell(true)}${logoCell(true)}</tr></table><span class="ink"${style("display:inline-block;margin-left:10px;font:700 20px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.7px;color:#16181d;vertical-align:middle")}>blockwise</span>`;

function details(message: EmailMessage) {
  if (!message.details?.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="detail-card"${style("width:100%;border:1px solid #e9ebef;border-radius:12px;background:#f6f7f9;overflow:hidden")}><tbody>${message.details.map((item, index) => `<tr><td${style(`padding:${index ? "12px 16px" : "14px 16px 12px"};font:600 10px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#545a66;text-transform:uppercase;${index ? line(true) : ""}`)}>${escapeHtml(item.label)}</td><td align="right"${style(`padding:${index ? "12px 16px" : "14px 16px 12px"};font:600 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d;${index ? line(true) : ""}`)}>${escapeHtml(item.value)}</td></tr>`).join("")}</tbody></table>`;
}

function footer(message: EmailMessage) {
  const content = message.transactional
    ? "This is a service email about your Blockwise account."
    : `You are receiving this because you have a Blockwise account. <a href="#"${style("color:#545a66;text-decoration:underline")}>Manage preferences</a> or <a href="#"${style("color:#545a66;text-decoration:underline")}>unsubscribe</a>.`;
  return `<tr><td${style("padding:24px 8px 0;font:400 11px/17px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66;text-align:center")}>${content}<br><span${style("color:#9aa0ad")}>Blockwise · Perth, Australia</span></td></tr>`;
}

const contentCopy = (message: EmailMessage) => `<strong class="ink"${style(`font-weight:600;color:#16181d`)}>${escapeHtml(message.greeting)}</strong><br>${escapeHtml(message.intro)}`;

function quietCard(message: EmailMessage) {
  return `<tr><td align="center"${style("padding:34px 20px 18px")}>${logo()}</td></tr><tr><td${style("padding:0 20px")}><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card"${style("width:100%;border:1px solid #e9ebef;border-radius:20px;background:#ffffff")}><tbody><tr><td${style("padding:28px 28px 12px;font:600 10px/14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:#545a66")}>${escapeHtml(message.eyebrow)}</td></tr><tr><td${style("padding:0 28px;font:700 27px/32px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.5px;color:#16181d")}>${escapeHtml(message.heading)}</td></tr><tr><td${style("padding:16px 28px 0;font:400 15px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66")}>${contentCopy(message)}</td></tr><tr><td${style("padding:22px 28px 0")}>${details(message)}</td></tr><tr><td${style("padding:22px 28px 0")}>${cta(message, "inline")}</td></tr>${note(message, "padding:18px 28px 0")}${signOff(message, "padding:20px 28px 30px")}</tbody></table></td></tr>`;
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
    : `display:${type === "full" ? "block" : "inline-block"};min-height:44px;box-sizing:border-box;padding:12px 18px;background:#16181d;border-radius:999px;color:#ffffff;font:700 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-decoration:none;${type === "full" ? "text-align:center" : ""}`;
  const code = message.oneTimeCode ? `<p class="muted" style="margin:22px 0 6px;font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66">Or enter this one-time code</p><p class="ink code" style="margin:0;font:700 28px/36px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:5px;color:#16181d">${escapeHtml(message.oneTimeCode)}</p>` : "";
  return `<a href="${escapeHtml(safeHref(message.action.href))}" class="action ${type === "letter" ? "letter-action" : ""}"${style(styles)}>${escapeHtml(message.action.label)}${type === "letter" ? " &nbsp;→" : ""}</a>${code}`;
}
function note(message: EmailMessage, padding: string) {
  return message.note ? `<tr><td${style(`${padding};font:400 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#545a66`)}>${escapeHtml(message.note)}</td></tr>` : "";
}
function signOff(message: EmailMessage, padding: string) {
  return `<tr><td${style(`${padding};font:400 14px/21px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16181d`)}>${escapeHtml(message.signOff ?? "The Blockwise team")}</td></tr>`;
}

export function renderEmail(message: EmailMessage, design: EmailDesign, colorMode: EmailColorMode = "system"): RenderedEmail {
  const body = design === "quiet-card" ? quietCard(message) : design === "personal-letter" ? personalLetter(message) : operationsBrief(message);
  const forcedClass = colorMode === "system" ? "" : ` email-force-${colorMode}`;
  const html = `<!doctype html><html lang="en" class="${forcedClass.trim()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>body{margin:0!important;padding:0!important;background:#f6f7f9;color:#16181d}.email-bg{background:#f6f7f9}@media only screen and (max-width:600px){.outer{width:100%!important}.mobile-pad{padding-left:4px!important;padding-right:4px!important}.card{border-radius:16px!important}}@media only screen and (max-width:400px){.outer{table-layout:fixed!important}.detail-card{table-layout:fixed!important}.detail-card td{display:block!important;width:auto!important;text-align:left!important;padding:8px 12px!important;border-top:0!important;word-wrap:break-word!important}.brand-row>tbody>tr>td{display:block!important;width:100%!important;text-align:left!important}.brand-row>tbody>tr>td+td{padding-top:12px!important}.code{font-size:26px!important;letter-spacing:3px!important}}@media (prefers-color-scheme:dark){body,.email-bg{background:#121418!important}.card{background:#1b1e24!important;border-color:#3a3f49!important}.detail-card{background:#242831!important;border-color:#3a3f49!important}.detail-card td{border-color:#3a3f49!important}td,span{color:#f5f6f8!important}td[style*='color:#545a66'],td[style*='color:#9aa0ad']{color:#b9bec8!important}.action{background:#f5f6f8!important;color:#16181d!important}.letter-action{background:transparent!important;color:#f5f6f8!important;border-color:#f5f6f8!important}}.email-force-dark body,.email-force-dark .email-bg{background:#121418!important}.email-force-dark .card{background:#1b1e24!important;border-color:#3a3f49!important}.email-force-dark .detail-card{background:#242831!important;border-color:#3a3f49!important}.email-force-dark .detail-card td{border-color:#3a3f49!important}.email-force-dark td,.email-force-dark span{color:#f5f6f8!important}.email-force-dark td[style*='color:#545a66'],.email-force-dark td[style*='color:#9aa0ad']{color:#b9bec8!important}.email-force-dark .action{background:#f5f6f8!important;color:#16181d!important}.email-force-dark .letter-action{background:transparent!important;color:#f5f6f8!important;border-color:#f5f6f8!important}.email-force-dark body,.email-force-dark .email-bg{background:#121418!important}.email-force-dark .card{background:#1b1e24!important;border-color:#3a3f49!important}.email-force-dark .detail-card{background:#242831!important;border-color:#3a3f49!important}.email-force-dark .detail-card td{border-color:#3a3f49!important}.email-force-dark .ink,.email-force-dark .ink *{color:#f5f6f8!important}.email-force-dark .muted,.email-force-dark .muted *{color:#b9bec8!important}.email-force-dark .mark,.email-force-dark .rule{background:#f5f6f8!important}.email-force-dark .action{background:#f5f6f8!important;color:#16181d!important}.email-force-dark .letter-action{background:transparent!important;color:#f5f6f8!important;border-color:#f5f6f8!important}.email-force-light body,.email-force-light .email-bg{background:#f6f7f9!important}.email-force-light .card{background:#ffffff!important;border-color:#e9ebef!important}.email-force-light .detail-card{background:#f6f7f9!important;border-color:#e9ebef!important}.email-force-light .detail-card td{border-color:#e9ebef!important}.email-force-light td,.email-force-light span{color:#16181d!important}.email-force-light .muted,.email-force-light .muted *{color:#545a66!important}.email-force-light .ink,.email-force-light .ink *{color:#16181d!important}.email-force-light .mark,.email-force-light .rule{background:#16181d!important}.email-force-light .action{background:#16181d!important;color:#ffffff!important}.email-force-light .letter-action{background:transparent!important;color:#16181d!important;border-color:#16181d!important}</style></head><body><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(message.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="width:100%;background:#f6f7f9"><tbody><tr><td align="center" class="mobile-pad" style="padding:0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="outer" style="width:100%;max-width:600px"><tbody>${body}${footer(message)}</tbody></table></td></tr></tbody></table></body></html>`;
  const detailText = message.details?.map((item) => `${item.label}: ${item.value}`).join("\n") ?? "";
  const text = [message.subject, "", message.greeting, message.heading, message.intro, detailText, "", `${message.action.label}: ${safeHref(message.action.href)}`, message.oneTimeCode ? `One-time code: ${message.oneTimeCode}` : "", message.note ?? "", message.signOff ?? "Blockwise"].filter(Boolean).join("\n");
  return { html, text, subject: message.subject };
}
