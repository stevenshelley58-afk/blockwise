#!/usr/bin/env python3
"""Self-hosted Meta Ad Library collector for Blockwise."""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from playwright.async_api import async_playwright


HOST = os.getenv("META_COLLECTOR_HOST", "0.0.0.0")
PORT = int(os.getenv("META_COLLECTOR_PORT", "9100"))
DEFAULT_TIMEOUT_MS = int(os.getenv("META_COLLECTOR_TIMEOUT_MS", "45000"))
DEFAULT_WAIT_MS = int(os.getenv("META_COLLECTOR_WAIT_MS", "9000"))
PROFILE_DIR = os.getenv("META_COLLECTOR_PROFILE_DIR", "").strip()


class CollectorHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/health":
            self._json({"ok": True})
            return
        if self.path == "/session/status":
            self._json(run_async(session_status()))
            return
        self._json({"error": "not found"}, status=404)

    def do_POST(self) -> None:
        try:
            body = self._read_json()
            if self.path == "/status-check":
                result = run_async(collect_page_ads(body))
            elif self.path == "/full-capture":
                result = run_async(collect_single_ad(body))
            else:
                self._json({"error": "not found"}, status=404)
                return
            self._json(result)
        except Exception as exc:  # noqa: BLE001
            self._json({"ok": False, "error": str(exc)}, status=500)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[meta-collector] {self.address_string()} {fmt % args}")

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _json(self, payload: dict[str, Any], status: int = 200) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


async def collect_page_ads(body: dict[str, Any]) -> dict[str, Any]:
    page_id = required_str(body, "pageId")
    country = str(body.get("country") or "AU")
    limit = int(body.get("limit") or 50)
    active_status = str(body.get("activeStatus") or "active")
    url = (
        "https://www.facebook.com/ads/library/"
        f"?active_status={active_status}&ad_type=all&country={country}"
        f"&is_targeted_country=false&media_type=all&search_type=page"
        f"&view_all_page_id={page_id}"
    )
    payloads, html = await browse_and_capture(url)
    ads = normalise_ads_from_payloads(payloads, page_id=page_id, limit=limit)
    if not ads:
        ads = normalise_ads_from_html(html, page_id=page_id, limit=limit)
    if not ads and not has_explicit_no_results(html):
        raise RuntimeError("Meta Ad Library returned no ad payload and no explicit no-results marker")
    return {"ok": True, "runId": f"self-page-{page_id}-{int(time.time())}", "sourceUrl": url, "items": ads[:limit], "itemCount": len(ads[:limit])}


async def collect_single_ad(body: dict[str, Any]) -> dict[str, Any]:
    ad_id = required_str(body, "adArchiveId")
    country = str(body.get("country") or "AU")
    url = f"https://www.facebook.com/ads/library/?id={ad_id}&country={country}"
    payloads, html = await browse_and_capture(url)
    ads = normalise_ads_from_payloads(payloads, page_id=None, limit=5)
    if not ads:
        ads = normalise_ads_from_html(html, page_id=None, limit=5)
    matched = [ad for ad in ads if str(ad.get("adArchiveID") or ad.get("id")) == ad_id]
    if not matched:
        raise RuntimeError(f"Meta Ad Library did not return requested ad_archive_id {ad_id}")
    item = matched[0]
    item["inputUrl"] = url
    return {"ok": True, "runId": f"self-ad-{ad_id}-{int(time.time())}", "sourceUrl": url, "items": [item], "itemCount": 1}


async def browse_and_capture(url: str) -> tuple[list[Any], str]:
    captured: list[Any] = []
    response_tasks: list[asyncio.Task[Any]] = []
    cookies = load_cookie_json()
    async with async_playwright() as p:
        browser, context = await new_context(p)
        if cookies:
            await context.add_cookies(cookies)
        page = await context.new_page()

        async def on_response(response: Any) -> None:
            response_url = response.url
            if "ads/library" not in response_url and "graphql" not in response_url and "api/graphql" not in response_url:
                return
            content_type = response.headers.get("content-type", "")
            if "json" not in content_type and "javascript" not in content_type and "text" not in content_type:
                return
            try:
                text = await response.text()
            except Exception:
                return
            for payload in extract_json_blobs(text):
                if payload_mentions_ads(payload):
                    captured.append(payload)

        page.on("response", lambda response: response_tasks.append(asyncio.create_task(on_response(response))))
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=DEFAULT_TIMEOUT_MS)
            await page.wait_for_timeout(DEFAULT_WAIT_MS)
            if response_tasks:
                await asyncio.gather(*response_tasks, return_exceptions=True)
            html = await page.content()
            page_state = classify_page_state(html)
            blocked = page_state["blocked"] and not captured
        finally:
            await context.close()
            if browser:
                await browser.close()
        if blocked:
            raise RuntimeError(f"Meta Ad Library returned {page_state['state']}: {page_state['reason']}")
    return captured, html


async def session_status() -> dict[str, Any]:
    url = "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=AU"
    cookies = load_cookie_json()
    async with async_playwright() as p:
        browser, context = await new_context(p)
        if cookies:
            await context.add_cookies(cookies)
        page = await context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=DEFAULT_TIMEOUT_MS)
            await page.wait_for_timeout(2500)
            html = await page.content()
            page_state = classify_page_state(html)
            context_cookies = await context.cookies()
        finally:
            await context.close()
            if browser:
                await browser.close()
    return {
        "ok": True,
        "state": page_state["state"],
        "blocked": page_state["blocked"],
        "reason": page_state["reason"],
        "cookiesConfigured": bool(cookies),
        "cookieCount": len(context_cookies),
        "profileDirConfigured": bool(PROFILE_DIR),
        "profileDir": PROFILE_DIR or None,
    }


async def new_context(playwright: Any) -> tuple[Any | None, Any]:
    args = ["--no-sandbox", "--disable-dev-shm-usage"]
    if PROFILE_DIR:
        Path(PROFILE_DIR).mkdir(parents=True, exist_ok=True)
        context = await playwright.chromium.launch_persistent_context(
            PROFILE_DIR,
            headless=True,
            args=args,
            locale="en-AU",
            timezone_id="Australia/Perth",
            viewport={"width": 1440, "height": 1400},
        )
        return None, context
    browser = await playwright.chromium.launch(headless=True, args=args)
    context = await browser.new_context(
        locale="en-AU",
        timezone_id="Australia/Perth",
        viewport={"width": 1440, "height": 1400},
    )
    return browser, context


def normalise_ads_from_payloads(payloads: list[Any], page_id: str | None, limit: int) -> list[dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for payload in payloads:
        for node in walk_dicts(payload):
            ad_id = pick(node, "adArchiveID", "adArchiveId", "ad_archive_id", "adArchiveIDString", "id")
            if not looks_like_ad_id(ad_id):
                continue
            snapshot = pick_snapshot(node)
            page_info = pick(node, "page", "pageInfo", "page_info") or {}
            normalised = {
                "adArchiveID": str(ad_id),
                "id": str(ad_id),
                "pageID": str(pick(node, "pageID", "pageId", "page_id") or page_id or pick(page_info, "id") or ""),
                "pageName": pick(node, "pageName", "page_name") or pick(page_info, "name"),
                "isActive": bool(pick(node, "isActive", "is_active") if pick(node, "isActive", "is_active") is not None else True),
                "startDate": pick(node, "startDate", "start_date", "adDeliveryStartTime", "startDateFormatted"),
                "endDate": pick(node, "endDate", "end_date", "adDeliveryStopTime", "endDateFormatted"),
                "publisherPlatform": normalise_platforms(pick(node, "publisherPlatform", "publisher_platform", "publisherPlatforms", "platforms")),
                "snapshot": snapshot,
                "inputUrl": f"https://www.facebook.com/ads/library/?id={ad_id}",
                "rawSelfHosted": node,
            }
            out[str(ad_id)] = merge_ad(out.get(str(ad_id)), normalised)
            if len(out) >= limit:
                return list(out.values())
    return list(out.values())


def normalise_ads_from_html(html: str, page_id: str | None, limit: int) -> list[dict[str, Any]]:
    ids = []
    for match in re.finditer(r"(?:ad_archive_id|adArchiveID|library/\?id=|[?&]id=)(\d{8,})", html):
        ids.append(match.group(1))
    return [{
        "adArchiveID": ad_id,
        "id": ad_id,
        "pageID": page_id,
        "isActive": True,
        "publisherPlatform": ["facebook"],
        "snapshot": {},
        "inputUrl": f"https://www.facebook.com/ads/library/?id={ad_id}",
        "rawSelfHosted": {"htmlFallback": True},
    } for ad_id in list(dict.fromkeys(ids))[:limit]]


def pick_snapshot(node: dict[str, Any]) -> dict[str, Any]:
    snapshot = pick(node, "snapshot", "ad_snapshot", "creative", "adCreative") or {}
    return {
        "title": pick(snapshot, "title") or pick(node, "title"),
        "body": pick(snapshot, "body") or pick(node, "body"),
        "caption": pick(snapshot, "caption"),
        "cards": normalise_cards(pick(snapshot, "cards", "cardsList") or pick(node, "cards") or []),
        "images": normalise_images(pick(snapshot, "images") or pick(node, "images") or []),
        "videos": normalise_videos(pick(snapshot, "videos") or pick(node, "videos") or []),
        "ctaText": pick(snapshot, "ctaText", "cta_text") or pick(node, "ctaText", "cta_text"),
        "ctaType": pick(snapshot, "ctaType", "cta_type") or pick(node, "ctaType", "cta_type"),
        "linkUrl": pick(snapshot, "linkUrl", "link_url") or pick(node, "linkUrl", "link_url"),
        "displayFormat": pick(snapshot, "displayFormat", "display_format"),
        "pageName": pick(snapshot, "pageName", "page_name") or pick(node, "pageName", "page_name"),
        "pageId": pick(snapshot, "pageId", "page_id") or pick(node, "pageId", "page_id"),
    }


def normalise_cards(cards: Any) -> list[dict[str, Any]]:
    if not isinstance(cards, list):
        return []
    out = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        out.append({
            "title": pick(card, "title", "headline"),
            "body": pick(card, "body", "text"),
            "caption": pick(card, "caption"),
            "ctaText": pick(card, "ctaText", "cta_text", "cta"),
            "ctaType": pick(card, "ctaType", "cta_type"),
            "linkUrl": pick(card, "linkUrl", "link_url", "url", "destinationUrl", "destination_url"),
            "imageUrl": pick(card, "imageUrl", "image_url", "originalImageUrl", "original_image_url", "url", "uri"),
            "videoHdUrl": pick(card, "videoHdUrl", "video_hd_url", "hdUrl", "hd_url"),
            "videoSdUrl": pick(card, "videoSdUrl", "video_sd_url", "sdUrl", "sd_url"),
            "videoPreviewImageUrl": pick(card, "videoPreviewImageUrl", "video_preview_image_url", "thumbnailUrl", "thumbnail_url"),
        })
    return out


def normalise_images(images: Any) -> list[dict[str, Any]]:
    if isinstance(images, dict):
        images = [images]
    if not isinstance(images, list):
        return []
    out = []
    for image in images:
        if isinstance(image, str):
            out.append({"originalImageUrl": image})
        elif isinstance(image, dict):
            out.append({"originalImageUrl": pick(image, "originalImageUrl", "original_image_url", "url", "uri", "src"), "resizedImageUrl": pick(image, "resizedImageUrl", "resized_image_url", "thumbnailUrl", "thumbnail_url")})
    return out


def normalise_videos(videos: Any) -> list[dict[str, Any]]:
    if isinstance(videos, dict):
        videos = [videos]
    if not isinstance(videos, list):
        return []
    out = []
    for video in videos:
        if isinstance(video, str):
            out.append({"videoHdUrl": video})
        elif isinstance(video, dict):
            out.append({"videoHdUrl": pick(video, "videoHdUrl", "video_hd_url", "hdUrl", "hd_url", "url", "uri"), "videoSdUrl": pick(video, "videoSdUrl", "video_sd_url", "sdUrl", "sd_url"), "videoPreviewImageUrl": pick(video, "videoPreviewImageUrl", "video_preview_image_url", "thumbnailUrl", "thumbnail_url")})
    return out


def extract_json_blobs(text: str) -> list[Any]:
    stripped = text.strip()
    if not stripped:
        return []
    candidates = [stripped]
    if stripped.startswith("for (;;);"):
        candidates.append(stripped.removeprefix("for (;;);"))
    blobs: list[Any] = []
    for candidate in candidates:
        try:
            blobs.append(json.loads(candidate))
            continue
        except Exception:
            pass
        for line in candidate.splitlines():
            line = line.strip()
            if line and line[0] in "[{":
                try:
                    blobs.append(json.loads(line))
                except Exception:
                    pass
    return blobs


def walk_dicts(value: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if isinstance(value, dict):
        out.append(value)
        for child in value.values():
            out.extend(walk_dicts(child))
    elif isinstance(value, list):
        for child in value:
            out.extend(walk_dicts(child))
    return out


def payload_mentions_ads(value: Any) -> bool:
    text = json.dumps(value, separators=(",", ":"), default=str)[:250_000]
    return any(token in text for token in ("adArchive", "ad_archive", "AdLibrary", "snapshot"))


def is_login_or_blocked(html: str) -> bool:
    return bool(classify_page_state(html)["blocked"])


def classify_page_state(html: str) -> dict[str, Any]:
    lower = html.lower()
    markers = {
        "checkpoint": ("checkpoint", "security check"),
        "captcha": ("captcha",),
        "temporarily_blocked": ("temporarily blocked", "try again later"),
        "login_required": ("login_form", "you must log in", "log into facebook"),
    }
    ad_markers = ("adarchiveid", "ad_archive_id", "ads/library/?id=", "__bbox")
    has_ad_markers = any(marker in lower for marker in ad_markers)
    for state, state_markers in markers.items():
        if any(marker in lower for marker in state_markers) and not has_ad_markers:
            return {"state": state, "blocked": True, "reason": state.replace("_", " ")}
    return {"state": "ready", "blocked": False, "reason": "page loaded"}


def has_explicit_no_results(html: str) -> bool:
    lower = html.lower()
    markers = (
        "no ads match",
        "no ads found",
        "no results found",
        "there are no ads",
        "we didn't find any ads",
    )
    return any(marker in lower for marker in markers)


def pick(source: Any, *keys: str) -> Any:
    if not isinstance(source, dict):
        return None
    for key in keys:
        if key in source and source[key] not in (None, ""):
            return source[key]
    return None


def looks_like_ad_id(value: Any) -> bool:
    return isinstance(value, (str, int)) and re.fullmatch(r"\d{8,}", str(value)) is not None


def normalise_platforms(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v).lower() for v in value if v]
    if isinstance(value, str) and value:
        return [value.lower()]
    return ["facebook"]


def merge_ad(existing: dict[str, Any] | None, incoming: dict[str, Any]) -> dict[str, Any]:
    if not existing:
        return incoming
    merged = {**existing}
    for key, value in incoming.items():
        if value not in (None, "", [], {}):
            merged[key] = value
    return merged


def load_cookie_json() -> list[dict[str, Any]] | None:
    raw = os.getenv("META_COLLECTOR_COOKIE_JSON")
    if not raw:
        return None
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise ValueError("META_COLLECTOR_COOKIE_JSON must be a JSON array")
    return parsed


def required_str(body: dict[str, Any], key: str) -> str:
    value = body.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} is required")
    return value


def run_async(coro: Any) -> Any:
    return asyncio.run(coro)


def main() -> None:
    print(f"[meta-collector] listening on {HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), CollectorHandler).serve_forever()


if __name__ == "__main__":
    main()
