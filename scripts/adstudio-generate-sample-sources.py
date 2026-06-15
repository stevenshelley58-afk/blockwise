#!/usr/bin/env python3
"""Generate one unique source photo per Ad Studio template via OpenAI images.

Reads the curated prompts from ad-template-library/sample-styles.json and writes
a unique PNG per template_key to ad-template-library/images/sample-sources/.

Idempotent: skips keys that already have a saved image, so it can be called
repeatedly (a few per run) to stay inside short shell timeouts. Generations run
in parallel threads.

Usage:
  OPENAI_API_KEY=... python3 adstudio-generate-sample-sources.py --limit 6
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
STYLES = ROOT / "ad-template-library" / "sample-styles.json"
OUT_DIR = ROOT / "ad-template-library" / "images" / "sample-sources"
API_URL = "https://api.openai.com/v1/images/generations"
MODEL = os.environ.get("BLOCKWISE_OPENAI_IMAGE_MODEL", "gpt-image-2")
SIZE = "1024x1536"  # 2:3, close to the 1080x1350 card media region


def api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY", "").strip().lstrip("﻿")
    if not key:
        raise SystemExit("OPENAI_API_KEY is not set.")
    return key


def generate_one(key: str, prompt: str, neg: str, token: str) -> tuple[str, bool, str]:
    body = json.dumps({
        "model": MODEL,
        "prompt": f"{prompt}. Avoid: {neg}.",
        "size": SIZE,
        "quality": "low",
        "n": 1,
    }).encode("utf-8")
    request = Request(API_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    try:
        with urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - surface any network/API failure
        return key, False, f"request failed: {exc}"

    if payload.get("error"):
        return key, False, str(payload["error"].get("message", payload["error"]))
    data = (payload.get("data") or [{}])[0]
    b64 = data.get("b64_json")
    if not b64:
        return key, False, "no image bytes returned"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"{key}.png").write_bytes(base64.b64decode(b64))
    return key, True, "ok"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=6, help="max images this run")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--only", type=str, default="", help="comma-separated keys to (re)generate")
    args = parser.parse_args()

    styles = json.loads(STYLES.read_text(encoding="utf-8"))
    token = api_key()

    only = {k.strip() for k in args.only.split(",") if k.strip()}
    pending: list[tuple[str, str, str]] = []
    for key, style in styles.items():
        if only and key not in only:
            continue
        if not only and (OUT_DIR / f"{key}.png").exists():
            continue
        pending.append((key, style["prompt"], style.get("negativePrompt", "")))

    batch = pending[: args.limit]
    if not batch:
        done = sum(1 for k in styles if (OUT_DIR / f"{k}.png").exists())
        print(f"Nothing to do. {done}/{len(styles)} images already present.")
        return

    print(f"Generating {len(batch)} image(s): {', '.join(k for k, _, _ in batch)}")
    ok, fail = 0, 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(generate_one, k, p, n, token) for k, p, n in batch]
        for future in as_completed(futures):
            key, success, msg = future.result()
            print(f"  {'OK ' if success else 'FAIL'} {key}: {msg}")
            ok += int(success)
            fail += int(not success)

    total_done = sum(1 for k in styles if (OUT_DIR / f"{k}.png").exists())
    print(f"Run complete: {ok} ok, {fail} failed. Total {total_done}/{len(styles)} present.")
    if fail and ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
