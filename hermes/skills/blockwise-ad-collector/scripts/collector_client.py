#!/usr/bin/env python3
"""Hermes-side client for the VPS Meta Ad Library collector."""

from __future__ import annotations

import argparse
import json
import os
import sys
from urllib import error, request


BASE_URL = os.getenv("META_AD_LIBRARY_COLLECTOR_URL") or os.getenv("SELF_HOSTED_META_COLLECTOR_URL") or "http://meta-ad-library-collector:9100"


def get(path: str) -> dict[str, object]:
    try:
        with request.urlopen(f"{BASE_URL.rstrip('/')}{path}", timeout=15) as res:
            return json.loads(res.read().decode("utf-8"))
    except error.HTTPError as exc:
        return decode_http_error(exc)


def post(path: str, payload: dict[str, object]) -> dict[str, object]:
    req = request.Request(
        f"{BASE_URL.rstrip('/')}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=90) as res:
            return json.loads(res.read().decode("utf-8"))
    except error.HTTPError as exc:
        return decode_http_error(exc)


def decode_http_error(exc: error.HTTPError) -> dict[str, object]:
    body = exc.read().decode("utf-8", "replace")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        payload = {"error": body}
    if isinstance(payload, dict):
        payload.setdefault("ok", False)
        payload.setdefault("status", exc.code)
        return payload
    return {"ok": False, "status": exc.code, "error": payload}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("health")
    sub.add_parser("session-status")
    status = sub.add_parser("status-check")
    status.add_argument("--page-id", required=True)
    status.add_argument("--country", default="AU")
    status.add_argument("--limit", type=int, default=10)
    status.add_argument("--active-status", default="active", choices=["active", "inactive", "all"])
    capture = sub.add_parser("full-capture")
    capture.add_argument("--ad-archive-id", required=True)
    capture.add_argument("--country", default="AU")
    args = parser.parse_args()

    if args.command == "health":
        result = get("/health")
    elif args.command == "session-status":
        result = get("/session/status")
    elif args.command == "status-check":
        result = post("/status-check", {
            "pageId": args.page_id,
            "country": args.country,
            "limit": args.limit,
            "activeStatus": args.active_status,
        })
    else:
        result = post("/full-capture", {"adArchiveId": args.ad_archive_id, "country": args.country})
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())
