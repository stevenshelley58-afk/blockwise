"""Provision the nine Blockwise flows in Mautic, idempotently.

    MAUTIC_URL=http://127.0.0.1:18106 MAUTIC_USER=owner MAUTIC_PASSWORD=... python3 mautic/provision.py

Model, kept deliberately small:

  Blockwise writes contact fields  ->  a segment filter matches  ->  a one-step
  campaign sends the email. Every flow ends by clearing its trigger field so
  the contact leaves the segment before Blockwise writes the next transition.
  Campaigns allow restart; the app's durable subject receipts prevent replay.

Everything is matched by name, so re-running updates in place. Nothing sends.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from emails import EMAILS, render, text  # noqa: E402

BASE = os.environ.get("MAUTIC_URL", "http://127.0.0.1:18106").rstrip("/")
AUTH = base64.b64encode(f"{os.environ['MAUTIC_USER']}:{os.environ['MAUTIC_PASSWORD']}".encode()).decode()
FROM_NAME, FROM_EMAIL, REPLY_TO = "Blockwise", "hello@blockwise.sale", "support@blockwise.sale"

FIELDS = [
    ("blockwise_workspace_id", "Blockwise workspace ID", "text"),
    ("blockwise_profile_id", "Blockwise profile ID", "text"),
    ("blockwise_stage", "Blockwise stage", "text"),
    ("blockwise_stage_at", "Blockwise stage changed at", "datetime"),
    ("blockwise_event", "Blockwise event", "text"),
    ("blockwise_event_at", "Blockwise event at", "datetime"),
    ("blockwise_period_end", "Blockwise period end (formatted)", "text"),
    ("blockwise_plan", "Blockwise plan", "text"),
    ("blockwise_amount", "Blockwise renewal amount", "text"),
    ("blockwise_campaign_name", "Blockwise campaign name", "text"),
    ("blockwise_campaign_url", "Blockwise campaign URL", "url"),
    ("blockwise_spend", "Blockwise reported spend", "text"),
    ("blockwise_budget", "Blockwise budget", "text"),
    ("blockwise_threshold", "Blockwise alert threshold", "text"),
    ("blockwise_leads_count", "Blockwise new leads count", "number"),
    ("blockwise_leads_summary", "Blockwise new leads summary", "textarea"),
]

# key -> (kind, value). Kind decides the trigger field and email type.
FLOWS = {
    "welcome": ("stage", "signed_up"),
    "trial_ending": ("stage", "trial_ending"),
    "trial_ended": ("stage", "trial_ended"),
    "paid": ("stage", "paid"),
    "payment_failed": ("stage", "payment_failed"),
    "cancelled": ("stage", "cancelled"),
    "campaign_live": ("event", "campaign_live"),
    "budget_alert": ("event", "budget_alert"),
    "new_leads": ("event", "new_leads"),
}
OLD_PREFIX = "Owner CRM |"


def api(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(f"{BASE}/api/{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Basic {AUTH}", "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as err:
        raise SystemExit(f"{method} {path} -> {err.code}: {err.read()[:600]!r}")


def listing(path: str, key: str) -> list[dict]:
    items, start = [], 0
    while True:
        page = api("GET", f"{path}?limit=100&start={start}")
        chunk = page.get(key) or {}
        chunk = list(chunk.values()) if isinstance(chunk, dict) else chunk
        items += chunk
        if len(chunk) < 100:
            return items
        start += 100


def by_name(items: list[dict], name: str) -> dict | None:
    return next((i for i in items if i.get("name") == name), None)


def ensure_fields() -> None:
    have = {f["alias"] for f in listing("fields/contact", "fields")}
    for alias, label, ftype in FIELDS:
        if alias in have:
            continue
        api("POST", "fields/contact/new", {"alias": alias, "label": label, "type": ftype, "object": "lead",
                                           "group": "core", "isPubliclyUpdatable": False, "isPublished": True})
        print("field +", alias)


def retire_scaffold() -> None:
    for path, key, label in (("campaigns", "campaigns", "campaign"), ("emails", "emails", "email"), ("segments", "lists", "segment")):
        for item in listing(path, key):
            if item["name"].startswith(OLD_PREFIX):
                api("DELETE", f"{path}/{item['id']}/delete")
                print(f"{label} -", item["name"])


def ensure_emails() -> dict[str, int]:
    have = listing("emails", "emails")
    ids = {}
    for key, spec in EMAILS.items():
        body = {"name": spec["name"], "subject": spec["subject"], "customHtml": render(spec), "plainText": text(spec),
                "emailType": "template", "isPublished": True, "fromName": FROM_NAME, "fromAddress": FROM_EMAIL,
                "replyToAddress": REPLY_TO, "language": "en", "template": "blank"}
        found = by_name(have, spec["name"])
        if found:
            api("PATCH", f"emails/{found['id']}/edit", body)
            ids[key] = found["id"]; print("email =", spec["name"])
        else:
            ids[key] = api("POST", "emails/new", body)["email"]["id"]; print("email +", spec["name"])
    return ids


def ensure_segments() -> dict[str, int]:
    have = listing("segments", "lists")
    ids = {}
    for key, (kind, value) in FLOWS.items():
        name = EMAILS[key]["name"]
        field = "blockwise_stage" if kind == "stage" else "blockwise_event"
        body = {"name": name, "alias": f"blockwise-{key.replace('_', '-')}", "isPublished": True,
                "description": f"Contacts whose {field} is {value}. Blockwise sets it; the campaign of the same name sends.",
                "filters": [{"glue": "and", "field": field, "object": "lead", "type": "text", "operator": "=", "filter": value}]}
        found = by_name(have, name)
        if found:
            api("PATCH", f"segments/{found['id']}/edit", body); ids[key] = found["id"]; print("segment =", name)
        else:
            ids[key] = api("POST", "segments/new", body)["list"]["id"]; print("segment +", name)
    return ids


def ensure_campaigns(email_ids: dict[str, int], segment_ids: dict[str, int]) -> None:
    have = listing("campaigns", "campaigns")
    for key, (kind, value) in FLOWS.items():
        name = EMAILS[key]["name"]
        send = {"id": "new_send", "name": f"Send: {name}", "type": "email.send", "eventType": "action", "order": 1,
                "triggerMode": "immediate", "properties": {"email": email_ids[key], "email_type": "transactional" if kind == "event" else "marketing"}}
        events = [send]
        connections = [{"sourceId": "lists", "targetId": "new_send", "anchors": {"source": "leadsource", "target": "top"}}]
        nodes = [{"id": "lists", "positionX": "400", "positionY": "65"}, {"id": "new_send", "positionX": "400", "positionY": "200"}]
        field = "blockwise_stage" if kind == "stage" else "blockwise_event"
        events.append({"id": "new_clear", "name": "Clear trigger for the next flow", "type": "lead.updatelead", "eventType": "action",
                       "order": 2, "triggerMode": "immediate", "parent": {"id": "new_send"}, "decisionPath": None,
                       "properties": {field: "done"}})
        connections.append({"sourceId": "new_send", "targetId": "new_clear", "anchors": {"source": "bottom", "target": "top"}})
        nodes.append({"id": "new_clear", "positionX": "400", "positionY": "335"})
        body = {"name": name, "isPublished": True, "allowRestart": True,
                "description": f"Sends '{name}' once blockwise_{kind} = {value}. Defined in mautic/provision.py.",
                "lists": [{"id": segment_ids[key]}], "events": events,
                "canvasSettings": {"nodes": nodes, "connections": connections}}
        found = by_name(have, name)
        if found:
            # Replace events wholesale: delete the old campaign's events by recreating it is simpler and safe here
            # because the scaffold has no live contacts; PATCH keeps ids stable for anything already published.
            api("PATCH", f"campaigns/{found['id']}/edit", body); print("campaign =", name)
        else:
            api("POST", "campaigns/new", body); print("campaign +", name)


if __name__ == "__main__":
    ensure_fields()
    if "--keep-scaffold" not in sys.argv:
        retire_scaffold()
    emails = ensure_emails()
    segments = ensure_segments()
    ensure_campaigns(emails, segments)
    print("done")
