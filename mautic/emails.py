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
    ps = ""
    if spec.get("ps"):
        ps = f'<tr><td class="body-cell" style="padding:0 28px 30px;font:400 14px/21px {FONT};color:#16181d"><strong style="font-weight:600">P.S.</strong> {e(spec["ps"])}</td></tr>'
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
<tr><td class="body-cell" style="padding:20px 28px {"12px" if spec.get("ps") else "30px"};font:400 14px/21px {FONT};color:#16181d">The Blockwise team</td></tr>
{ps}
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
    lines += ["The Blockwise team", ""]
    if spec.get("ps"):
        lines += [f"P.S. {spec['ps']}", ""]
    lines += [f"Help and support: {SITE}/help", "Email preferences: {unsubscribe_url}"]
    return "\n".join(lines)


F = lambda alias: "{contactfield=" + alias + "}"  # noqa: E731

EMAILS: dict[str, dict] = {
    # Facts checked against the product on 15 Sep 2026: Ad studio A$249/month
    # incl. GST, 7-day Stripe trial that starts at Publish with a card saved and
    # nothing charged until it ends, creating/editing/downloading free, 50 Feed +
    # Story ad packs a month, cancel in the billing portal under Settings, Meta
    # spend always paid to Meta, budget alert at 80% of the 7-day budget.
    "welcome": dict(
        name="Blockwise | Welcome", eyebrow="WELCOME",
        subject=f"Your first ad is about 10 minutes away, {FIRST}",
        preheader="Pick a template, add your brand, write three lines. Free until you press Publish.",
        heading="Your first ad is about 10 minutes away",
        intro="You're in. No Ads Manager, no agency, no waiting. Build a seller-lead ad for your patch and see it before anyone else does.",
        bullets=("Three steps, no card needed", [
            "Pick a template built for seller leads.",
            "Add your brand pack: logo, colours, photo.",
            "Write your three lines and preview the Feed and Story versions.",
        ]),
        cta=("Build my first ad", f"{SITE}/ad-builder"),
        note="Creating, editing and downloading are free. Publishing starts a 7-day trial: your card is saved, nothing is charged until the trial ends, and you can cancel any time in Settings.",
        ps="Stuck on what to say? Reply to this email with your suburb and we'll send you an angle that's working there.",
    ),
    "trial_ending": dict(
        name="Blockwise | Trial ending", eyebrow="TRIAL ENDING",
        subject=f"Your trial ends {F('blockwise_period_end')}. Keep your ad running?",
        preheader=f"On {F('blockwise_period_end')} your card is charged {F('blockwise_amount')} and your ad keeps going. Cancel before then and it stops.",
        heading="Your ad keeps running if you do nothing",
        intro=f"Your 7-day trial ends on {F('blockwise_period_end')}. On that day your saved card is charged {F('blockwise_amount')} and your ad, your leads and your reporting carry on without a gap. If you'd rather stop, cancel in Settings before then and nothing is charged.",
        details=[("Trial ends", F("blockwise_period_end")), ("Plan", F("blockwise_plan")), ("Then", F("blockwise_amount"))],
        cta=("See what my ad did this week", f"{SITE}/performance"),
        note="Meta ad spend is separate and is paid to Meta from your own ad account, including during the trial.",
        ps="A quiet first week is normal. Meta spends the first few days learning who to show your ad to. Week two is where the leads usually land.",
    ),
    "trial_ended": dict(
        name="Blockwise | Trial ended", eyebrow="TRIAL ENDED",
        subject="Your ad has stopped. Everything is saved.",
        preheader="Your trial ended without a subscription. Your ads and leads are still in your workspace.",
        heading="Your ad has stopped, your work hasn't gone anywhere",
        intro=f"Your trial ended on {F('blockwise_period_end')} without a subscription, so Meta has stopped showing your ad. Your ads, brand pack and every lead are still in your workspace. Subscribe and the same ad is back in front of sellers today.",
        details=[("Trial ended", F("blockwise_period_end")), ("To restart", F("blockwise_amount"))],
        cta=("Restart my ad", f"{SITE}/settings#billing"),
        note="Nothing is charged until you subscribe. Meta ad spend stays separate.",
        ps="Not the right time? Reply and tell us why. It helps, and we won't chase you.",
    ),
    "paid": dict(
        name="Blockwise | Paid access active", eyebrow="YOU'RE ON",
        subject="You're on. Here's what to do with 50 ad packs a month",
        preheader=f"Your {F('blockwise_plan')} plan is active. Publishing, reporting and lead delivery are on.",
        heading="You're on",
        intro=f"Your {F('blockwise_plan')} plan is active. Publishing, reporting and lead delivery are all switched on. You've got 50 Feed + Story ad packs a month, so the trick now is to run more than one.",
        bullets=("What agents on this plan do next", [
            "Run a second ad in a neighbouring suburb and let them compete.",
            "Refresh creative every few weeks; Meta rewards new photos.",
            "Reply to leads within the hour. Speed wins listings.",
        ]),
        details=[("Plan", F("blockwise_plan")), ("Renews", F("blockwise_period_end")), ("Amount", F("blockwise_amount"))],
        cta=("Build my next ad", f"{SITE}/ad-builder"),
        note="Invoices and card details live in Settings under billing. Meta ad spend is separate and paid directly to Meta.",
    ),
    "payment_failed": dict(
        name="Blockwise | Payment failed", eyebrow="PAYMENT",
        subject="Your card didn't go through. Ads still running for now",
        preheader="Update your card in a minute and nothing changes. Leave it and your ad will stop.",
        heading="Your card didn't go through",
        intro=f"We tried to charge {F('blockwise_amount')} for your {F('blockwise_plan')} plan and the bank said no. Usually it's an expired card or a limit. Your ad is still running for now. Update the card and everything carries on as normal.",
        details=[("Plan", F("blockwise_plan")), ("Amount", F("blockwise_amount")), ("Access until", F("blockwise_period_end"))],
        cta=("Update my card", f"{SITE}/settings#billing"),
        note="We'll retry the card automatically. If it keeps failing your ad stops and your leads pause until it's sorted. Meta ad spend is separate and paid to Meta.",
    ),
    "cancelled": dict(
        name="Blockwise | Cancellation recorded", eyebrow="CANCELLATION",
        subject=f"Cancelled. Your ad runs until {F('blockwise_period_end')}",
        preheader=f"No more charges. Access and your ad continue until {F('blockwise_period_end')}.",
        heading="Cancelled, no more charges",
        intro=f"Your {F('blockwise_plan')} plan won't renew. Your ad, leads and reporting keep going until {F('blockwise_period_end')}, then the ad stops. Everything you built stays saved after that.",
        cta=("Changed your mind? Resume in Settings", f"{SITE}/settings#billing"),
        note=f"You can resume any time before {F('blockwise_period_end')} from billing in Settings and nothing is interrupted.",
        ps="If something didn't work, reply and tell us. One line is enough.",
    ),
    "campaign_live": dict(
        name="Blockwise | Campaign live", eyebrow="LIVE",
        subject=f"{F('blockwise_campaign_name')} is live on Meta",
        preheader="Meta is showing your ad. First leads usually land within a few days.",
        heading="Your ad is live",
        intro=f"{F('blockwise_campaign_name')} is now running on Facebook and Instagram. Every lead lands in your workspace with their name, suburb and number, and you'll get an email when they do.",
        details=[("Campaign", F("blockwise_campaign_name")), ("Budget", F("blockwise_budget"))],
        cta=("Watch it run", F("blockwise_campaign_url")),
        note="Meta spends the first few days working out who to show it to, so early numbers jump around. Judge it after a week, not a day.",
    ),
    "budget_alert": dict(
        name="Blockwise | Budget alert", eyebrow="BUDGET",
        subject=f"{F('blockwise_campaign_name')} has used 80% of this week's budget",
        preheader=f"{F('blockwise_spend')} of {F('blockwise_budget')} spent. Nothing to do unless you want to change it.",
        heading="80% of this week's budget is spent",
        intro=f"{F('blockwise_campaign_name')} has spent {F('blockwise_spend')} of its {F('blockwise_budget')}. That's the pace you set, so nothing is wrong. This is your heads-up in case you want to top up, pause or leave it.",
        details=[("Campaign", F("blockwise_campaign_name")), ("Spent so far", F("blockwise_spend")), ("Weekly budget", F("blockwise_budget"))],
        cta=("Check the leads it bought", F("blockwise_campaign_url")),
        note="Spend is reported by Meta and can lag by a few hours. This is a heads-up, not a change to your budget.",
    ),
    "new_leads": dict(
        name="Blockwise | New leads", eyebrow="NEW LEADS",
        subject=f"{F('blockwise_leads_count')} new seller leads from {F('blockwise_campaign_name')}",
        preheader="Call them today while they're warm. Speed wins listings.",
        heading="You have new leads. Call them today.",
        intro=f"{F('blockwise_leads_count')} new leads came in from {F('blockwise_campaign_name')}. They put their hand up in the last few hours, so they're warm right now and cold by the weekend.",
        details=[("Leads", F("blockwise_leads_summary"))],
        cta=("Open my leads", f"{SITE}/leads"),
        ps="First call: don't pitch. Ask what's prompting them to think about selling. Then book the appraisal.",
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
