"""The nine Blockwise flow emails, rendered in the approved design.

Every email is one spec (below) pushed through render(), which reuses the
markup and the light/dark CSS from docs/email/design-reference/demo-*.html.
Mautic fills the {contactfield=...} tokens from the contact's fields at send
time; Blockwise writes those fields when the event happens (see provision.py
for the field list). Nothing here sends mail.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REFERENCE = REPO / "docs/email/design-reference/demo-welcome.html"
SITE = "https://blockwise.sale"
FIRST = "{contactfield=firstname|there}"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"


def css() -> str:
    match = re.search(r"<style>(.*?)</style>", REFERENCE.read_text(), re.S)
    if not match:
        raise RuntimeError(f"no <style> block in {REFERENCE}")
    return match.group(1)


def e(value: str) -> str:
    """Escape copy but leave Mautic tokens untouched."""
    parts = re.split(r"(\{[a-z_]+=[^}]*\}|\{[a-z_]+\})", value)
    return "".join(p if p.startswith("{") else html.escape(p, quote=False) for p in parts)


LOGO = (
    '<table role="presentation" cellpadding="0" cellspacing="2" border="0" aria-label="blockwise" '
    'style="border-collapse:separate;display:inline-table;vertical-align:middle">'
    + "".join(
        "<tr>" + "".join(
            f'<td width="8" height="8" class="{"header-mark" if on else ""}" style="width:8px;height:8px;'
            f'background:{"#ffffff" if on else "transparent"};font-size:0;line-height:0;">&nbsp;</td>'
            for on in row) + "</tr>"
        for row in ((0, 0, 1), (0, 1, 1), (1, 1, 1)))
    + "</table>"
    f'<span class="header-ink" style="display:inline-block;margin-left:10px;font:700 20px/1 {FONT};'
    'letter-spacing:-.7px;color:#ffffff;vertical-align:middle">blockwise</span>'
)


def details_block(rows: list[tuple[str, str]]) -> str:
    body = "".join(
        f'<tr><td class="lead-label muted" width="150" valign="top" style="padding:0 16px 14px 0;font:400 14px/22px {FONT};color:#545a66">{e(k)}</td>'
        f'<td class="lead-value ink" valign="top" style="padding:0 0 14px;font:400 15px/22px {FONT};color:#16181d;overflow-wrap:anywhere;white-space:pre-line">{e(v)}</td></tr>'
        for k, v in rows)
    return (
        '<tr><td class="body-cell" style="padding:22px 28px 0">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="detail-card summary-metrics" style="width:100%;border-top:1px solid #e9ebef"><tbody>'
        '<tr><td colspan="2" height="22"></td></tr>' + body + "</tbody></table></td></tr>"
    )


def bullets_block(heading: str, items: list[str]) -> str:
    lis = "".join(f'<li style="padding:0 0 5px">{e(i)}</li>' for i in items)
    return (
        '<tr><td class="body-cell" style="padding:22px 28px 0">'
        f'<h2 class="ink" style="margin:0 0 8px;font:700 17px/23px {FONT};letter-spacing:-.2px;color:#16181d">{e(heading)}</h2>'
        f'<ul class="muted" style="padding:0 0 0 20px;margin:10px 0 0;font:400 15px/23px {FONT};color:#545a66">{lis}</ul></td></tr>'
    )


def render(spec: dict) -> str:
    hero = ""
    if spec.get("hero"):
        hero = ('<tr><td style="padding:0;font-size:0;line-height:0">'
                f'<img src="{spec["hero"]}" alt="" width="600" height="300" style="display:block;width:100%;max-width:100%;height:auto;border:0"></td></tr>')
    middle = ""
    if spec.get("bullets"):
        middle += bullets_block(*spec["bullets"])
    if spec.get("details"):
        middle += details_block(spec["details"])
    note = ""
    if spec.get("note"):
        note = f'<tr><td class="body-cell muted" style="padding:18px 28px 0;font:400 13px/19px {FONT};color:#545a66">{e(spec["note"])}</td></tr>'
    cta_label, cta_href = spec["cta"]
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>{e(spec["subject"])}</title><style>{css()}</style></head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">{e(spec["preheader"])}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="width:100%;background:#f6f7f9"><tbody><tr><td align="center" class="mobile-pad" style="padding:0 16px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="outer" style="width:100%;max-width:600px"><tbody><tr><td style="padding:24px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card" style="width:100%;border:1px solid #e9ebef;border-radius:16px;background:#ffffff"><tbody>
<tr><td class="email-header body-cell" style="padding:24px 28px;background:#16181d;border-radius:15px 15px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="header-ink">{LOGO}</td><td class="header-ink header-label" align="right" style="padding-left:16px;color:#ffffff;font:400 12px/18px {FONT}">{e(spec["eyebrow"])}</td></tr></table></td></tr>
{hero}
<tr><td class="body-cell" style="padding:28px 28px 0"><h1 class="ink" style="margin:0;font:700 27px/32px {FONT};letter-spacing:-.5px;color:#16181d">{e(spec["heading"])}</h1></td></tr>
<tr><td class="body-cell muted" style="padding:16px 28px 0;white-space:pre-line;font:400 15px/23px {FONT};color:#545a66"><strong class="ink" style="font-weight:600;color:#16181d">Hi {FIRST},</strong><br>{e(spec["intro"])}</td></tr>
{middle}
<tr><td class="body-cell" style="padding:22px 28px 0"><a href="{cta_href}" class="action" style="display:inline-block;min-height:44px;max-width:100%;box-sizing:border-box;padding:0;border:12px solid #16181d;border-left-width:20px;border-right-width:20px;mso-padding-alt:0;background:#16181d;border-radius:999px;color:#ffffff;font:600 14px/20px {FONT};text-decoration:none;text-align:center">{e(cta_label)}</a></td></tr>
{note}
<tr><td class="body-cell" style="padding:20px 28px 30px;font:400 14px/21px {FONT};color:#16181d">The Blockwise team</td></tr>
<tr><td class="muted email-footer body-cell" style="padding:24px 28px;font:400 12px/18px {FONT};color:#545a66;text-align:left;background:#f1f2f4;border-top:1px solid #e9ebef;border-radius:0 0 15px 15px;"><p class="ink" style="margin:0 0 8px;font:700 16px/22px {FONT};letter-spacing:-.4px;color:#16181d">blockwise</p>This is a service email about your Blockwise account.<br><a class="muted" href="{SITE}/help" style="display:inline-block;min-height:44px;box-sizing:border-box;padding:12px 4px;color:#545a66;text-decoration:underline">Help and support</a> &nbsp; <a class="muted" href="{{unsubscribe_url}}" style="display:inline-block;min-height:44px;box-sizing:border-box;padding:12px 4px;color:#545a66;text-decoration:underline">Email preferences</a><br>Blockwise · Perth, Western Australia</td></tr>
</tbody></table>
</td></tr></tbody></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></tbody></table>
</body></html>"""


def text(spec: dict) -> str:
    lines = [f"Hi {FIRST},", "", spec["intro"], ""]
    if spec.get("bullets"):
        h, items = spec["bullets"]
        lines += [h] + [f"- {i}" for i in items] + [""]
    if spec.get("details"):
        lines += [f"{k}: {v}" for k, v in spec["details"]] + [""]
    lines += [f"{spec['cta'][0]}: {spec['cta'][1]}", ""]
    if spec.get("note"):
        lines += [spec["note"], ""]
    lines += ["The Blockwise team", "", f"Help and support: {SITE}/help", "Email preferences: {unsubscribe_url}"]
    return "\n".join(lines)


F = lambda alias: "{contactfield=" + alias + "}"  # noqa: E731

EMAILS: dict[str, dict] = {
    "welcome": dict(
        name="Blockwise | Welcome", eyebrow="WELCOME",
        subject=f"Welcome to Blockwise, {FIRST}",
        preheader="Your workspace is ready. Prepare your first ad, then review it before anything goes live.",
        heading="Your workspace is ready",
        intro="Welcome to Blockwise. Prepare your first ad, then review it before anything goes live.",
        hero="https://preview.frank.fail/emailtest-20260915/demo-hero.jpg",
        bullets=("A clear place to start", [
            "Choose the outcome you want from your ad.",
            "Add your brand details and creative.",
            "Review the copy, budget and destination before approval.",
        ]),
        cta=("Open your workspace", f"{SITE}/home"),
    ),
    "trial_ending": dict(
        name="Blockwise | Trial ending", eyebrow="TRIAL ENDING",
        subject=f"Your Blockwise trial ends on {F('blockwise_period_end')}",
        preheader=f"Your trial ends on {F('blockwise_period_end')}. Review your work and decide whether to continue.",
        heading="Your trial is ending",
        intro=f"Your trial ends on {F('blockwise_period_end')}. Review your work and decide whether to continue with a paid plan.",
        details=[("Trial ends", F("blockwise_period_end")), ("Plan", F("blockwise_plan")), ("Renewal", F("blockwise_amount"))],
        cta=("Review your options", f"{SITE}/settings#billing"),
        note="This is a reminder, not a payment receipt. Subscription and ad spend approvals remain separate.",
    ),
    "trial_ended": dict(
        name="Blockwise | Trial ended", eyebrow="TRIAL ENDED",
        subject="Your Blockwise trial has ended",
        preheader="Your work is saved. Choose a plan to keep publishing.",
        heading="Your trial has ended",
        intro=f"Your trial ended on {F('blockwise_period_end')}. Everything you built is saved. Choose a plan to keep publishing and receiving leads.",
        cta=("Choose a plan", f"{SITE}/settings#billing"),
        note="Nothing is charged until you choose a plan.",
    ),
    "paid": dict(
        name="Blockwise | Paid access active", eyebrow="ACCESS ACTIVE",
        subject="Your Blockwise paid access is active",
        preheader="Publishing, reporting and lead delivery are switched on.",
        heading="Your paid access is active",
        intro=f"Your {F('blockwise_plan')} plan is active. Publishing, reporting and lead delivery are all switched on.",
        details=[("Plan", F("blockwise_plan")), ("Renews", F("blockwise_period_end")), ("Amount", F("blockwise_amount"))],
        cta=("Open your workspace", f"{SITE}/home"),
        note="Receipts come from Stripe. Meta ad spend is billed separately by Meta.",
    ),
    "payment_failed": dict(
        name="Blockwise | Payment failed", eyebrow="PAYMENT",
        subject="We couldn't take your Blockwise payment",
        preheader="Update your card to keep your access.",
        heading="We couldn't take your payment",
        intro=f"The latest payment for your {F('blockwise_plan')} plan didn't go through. Update your card to keep your access.",
        details=[("Plan", F("blockwise_plan")), ("Amount", F("blockwise_amount")), ("Access until", F("blockwise_period_end"))],
        cta=("Update payment details", f"{SITE}/settings#billing"),
        note="Your ads keep running until the plan lapses. Meta ad spend is billed separately by Meta.",
    ),
    "cancelled": dict(
        name="Blockwise | Cancellation recorded", eyebrow="CANCELLATION",
        subject="Your Blockwise cancellation was recorded",
        preheader=f"Your access continues until {F('blockwise_period_end')}.",
        heading="Your cancellation is recorded",
        intro=f"Your {F('blockwise_plan')} plan will not renew. Your access continues until {F('blockwise_period_end')} and your work stays saved after that.",
        cta=("Manage your plan", f"{SITE}/settings#billing"),
        note="Changed your mind? Reactivate from Settings at any time before the end date.",
    ),
    "campaign_live": dict(
        name="Blockwise | Campaign live", eyebrow="CAMPAIGN LIVE",
        subject=f"{F('blockwise_campaign_name')} is live",
        preheader="Your campaign is running on Meta. Leads land in your workspace as they arrive.",
        heading="Your campaign is live",
        intro=f"{F('blockwise_campaign_name')} is now running on Meta. Leads land in your workspace as they arrive.",
        details=[("Campaign", F("blockwise_campaign_name")), ("Budget", F("blockwise_budget"))],
        cta=("View campaign", F("blockwise_campaign_url")),
        note="Meta usually takes a few hours to start delivering. Early numbers move around.",
    ),
    "budget_alert": dict(
        name="Blockwise | Budget alert", eyebrow="BUDGET ALERT",
        subject=f"Budget alert for {F('blockwise_campaign_name')}",
        preheader="Your alert threshold has been reached. Check the latest spend before making changes.",
        heading="Review your campaign budget",
        intro="Your alert threshold has been reached. Check the latest spend before making changes.",
        details=[("Campaign", F("blockwise_campaign_name")), ("Reported spend", F("blockwise_spend")), ("Budget", F("blockwise_budget")), ("Threshold", F("blockwise_threshold"))],
        cta=("Review spend", F("blockwise_campaign_url")),
        note="This is an alert, not a budget increase. Reporting may lag platform activity.",
    ),
    "new_leads": dict(
        name="Blockwise | New leads", eyebrow="NEW LEADS",
        subject=f"{F('blockwise_leads_count')} new leads from {F('blockwise_campaign_name')}",
        preheader="New leads are waiting in your workspace. Reply while they're warm.",
        heading="You have new leads",
        intro=f"{F('blockwise_leads_count')} new leads arrived from {F('blockwise_campaign_name')}. Reply while they're warm.",
        details=[("Leads", F("blockwise_leads_summary"))],
        cta=("Open leads", f"{SITE}/leads"),
    ),
}

if __name__ == "__main__":
    import sys
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "mautic/preview"
    out.mkdir(parents=True, exist_ok=True)
    for key, spec in EMAILS.items():
        (out / f"{key}.html").write_text(render(spec))
        (out / f"{key}.txt").write_text(text(spec))
    print(f"rendered {len(EMAILS)} emails to {out}")
