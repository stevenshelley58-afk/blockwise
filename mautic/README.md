# Blockwise flows in Mautic

Mautic (mail.blockwise.sale, admin at marketing.frank.fail) is the one place
automated customer email lives. Blockwise never builds an email; it writes a
few contact fields and Mautic does the rest.

    Blockwise writes fields -> segment matches -> one-step campaign sends

`emails.py` holds the nine emails (copy plus the approved light/dark design
from docs/email/design-reference). `provision.py` pushes fields, segments,
emails and campaigns into Mautic by name, so re-running it updates in place:

    MAUTIC_USER=owner MAUTIC_PASSWORD=... python3 mautic/provision.py

The nine flows and the field that fires each:

| Flow | Field | Value | Extra fields the email reads |
| --- | --- | --- | --- |
| Welcome | blockwise_stage | signed_up | |
| Trial ending | blockwise_stage | trial_ending | period_end, plan, amount |
| Trial ended | blockwise_stage | trial_ended | period_end |
| Paid access active | blockwise_stage | paid | plan, period_end, amount |
| Payment failed | blockwise_stage | payment_failed | plan, amount, period_end |
| Cancellation recorded | blockwise_stage | cancelled | plan, period_end |
| Campaign live | blockwise_event | campaign_live | campaign_name, campaign_url, budget |
| Budget alert | blockwise_event | budget_alert | campaign_name, campaign_url, spend, budget, threshold |
| New leads | blockwise_event | new_leads | campaign_name, leads_count, leads_summary |

Stage flows are marketing-type sends (once per contact), and event flows are
transactional sends. Every campaign clears its trigger field to `done` after
sending. The bridge waits for that acknowledgement before writing the next
stage or event, while durable subject receipts make producer retries safe.

Text fields carry pre-formatted values ("30 September 2026", "A$149 per
month") because Mautic prints tokens verbatim. All `blockwise_*` field aliases
are prefixed and Mautic truncates aliases at 25 characters, so keep new ones
short.

Cron: the `owner-marketing-cron` compose profile must be running for
campaigns to fire. Its crontab was tightened to every 3 minutes
(segments:update, campaigns:update, campaigns:trigger, staggered), which
lives in the container only until the Frank infra image carries it.

Known gaps: the welcome hero image is still served from
preview.frank.fail/emailtest-20260915; the footer address is "Perth, Western
Australia" pending the real business address; Mautic honours unsubscribe for
every email, service emails included.
