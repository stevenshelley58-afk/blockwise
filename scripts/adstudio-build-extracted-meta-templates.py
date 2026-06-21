#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
import random
import sys
from collections import deque
from pathlib import Path
from typing import Any

from PIL import Image, ImageStat


ROOT = Path(__file__).resolve().parents[1]
META_DIR = ROOT / "meta_ad_candidates"
META_CSV = META_DIR / "_meta_ad_candidates.csv"
OUT = ROOT / "src" / "lib" / "adstudio" / "extracted-meta-templates.generated.ts"
TOTAL_CANDIDATES = 330

FORMAT_BY_BUCKET = {
    "portrait_9x16": "9:16",
    "portrait_4x5": "4:5",
    "square_1x1": "1:1",
    "landscape_16x9": "1.91:1",
    "landscape_4x3": "1.91:1",
    "banner_wide": "1.91:1",
}

SEQUENCES_BY_BUCKET = {
    "portrait_9x16": ["listing", "appraisal", "open_home", "agent", "market", "sold", "guide", "buyer"],
    "portrait_4x5": ["appraisal", "listing", "market", "open_home", "sold", "guide", "agent", "buyer", "investor"],
    "square_1x1": ["listing", "development", "agent", "sold", "market", "appraisal", "guide"],
    "landscape_16x9": ["listing", "agent", "market", "development", "sold", "appraisal", "investor"],
    "landscape_4x3": ["listing", "open_home", "market", "guide", "sold", "appraisal", "agent"],
    "banner_wide": ["listing", "agent", "market", "appraisal"],
}

PROFILE = {
    "listing": {
        "label": "Listing Hero",
        "goal": "seller_leads",
        "offerId": "recent_sales_report",
        "imageBriefId": "IMG-JUST-LISTED",
        "headline": "Just listed in {suburb}",
        "primaryText": "A {property} with the details local owners watch: price guide, features, and buyer interest in {suburb}.",
        "description": "Fresh listing context for local owners.",
        "cta": "See recent sales",
        "prompt": "Rebuild the source listing ad as editable property-photo slots, headline, feature chips, price or address row, and a clear CTA.",
    },
    "appraisal": {
        "label": "Appraisal Offer",
        "goal": "appraisal_bookings",
        "offerId": "home_value_update",
        "imageBriefId": "IMG-HOMEVALUE-Q",
        "headline": "What could your {suburb} home be worth?",
        "primaryText": "Get a practical local price update before you renovate, hold, or list.",
        "description": "A clear next step for owners.",
        "cta": "Request price update",
        "prompt": "Rebuild the source home-value ad with editable owner-focused headline, value panel, photo slot, and appraisal CTA.",
    },
    "open_home": {
        "label": "Open Home",
        "goal": "open_home_followup",
        "offerId": "open_home_followup",
        "imageBriefId": "IMG-OPEN-HOME",
        "headline": "Open this Saturday in {suburb}",
        "primaryText": "See the key details, save the inspection time, and bring better questions to the walkthrough.",
        "description": "Inspection details with a simple follow-up path.",
        "cta": "Plan your visit",
        "prompt": "Rebuild the source open-home ad with date/time, property photo, address strip, and inspection CTA as editable layers.",
    },
    "agent": {
        "label": "Agent Lead Gen",
        "goal": "seller_leads",
        "offerId": "prelisting_timeline",
        "imageBriefId": "IMG-AGENT-INTRO",
        "headline": "Local property help from {agent}",
        "primaryText": "Thinking about your next move in {suburb}? Start with a calm plan, current context, and practical next steps.",
        "description": "Agent-led local seller guidance.",
        "cta": "Start planning",
        "prompt": "Rebuild the source agent-led ad with a portrait slot, service bullets, signature/name block, and compact contact CTA.",
    },
    "market": {
        "label": "Market Update",
        "goal": "market_update_leads",
        "offerId": "suburb_market_report",
        "imageBriefId": "IMG-STAT-CARD",
        "headline": "{suburb} market snapshot",
        "primaryText": "See median value, buyer activity, and recent movement in one plain-English local report.",
        "description": "A data-led report for local owners.",
        "cta": "Get market update",
        "prompt": "Rebuild the source market ad with one hero stat, supporting data rows, suburb label, image slot, and report CTA.",
    },
    "sold": {
        "label": "Sold Proof",
        "goal": "seller_leads",
        "offerId": "recent_sales_report",
        "imageBriefId": "IMG-JUST-SOLD",
        "headline": "Just sold near {suburb}",
        "primaryText": "A recent result can help owners understand current buyer response without guessing.",
        "description": "Recent sale context without over-claiming.",
        "cta": "Get local context",
        "prompt": "Rebuild the source sold-result ad with sold badge, property slot, result strip, and compliant local context CTA.",
    },
    "guide": {
        "label": "Seller Guide",
        "goal": "seller_leads",
        "offerId": "seller_prep_checklist",
        "imageBriefId": "IMG-GUIDE-COVER",
        "headline": "Seller checklist for {suburb} owners",
        "primaryText": "Sort the small jobs, timing questions, and photo-readiness steps before your campaign starts.",
        "description": "Practical preparation before listing.",
        "cta": "Download checklist",
        "prompt": "Rebuild the source guide ad as editable cover/card layers with checklist rows, image slot, and download CTA.",
    },
    "buyer": {
        "label": "Buyer Demand",
        "goal": "seller_leads",
        "offerId": "home_value_update",
        "imageBriefId": "IMG-BUYER-DEMAND",
        "headline": "Buyer demand around {suburb}",
        "primaryText": "See what local enquiry and recent sales can tell you before you decide your next property step.",
        "description": "Local buyer context for owners.",
        "cta": "Check demand",
        "prompt": "Rebuild the source buyer-demand ad with proof panel, image slot, stat chips, and careful appraisal CTA.",
    },
    "investor": {
        "label": "Investor Snapshot",
        "goal": "investor_leads",
        "offerId": "investor_suburb_snapshot",
        "imageBriefId": "IMG-INVESTOR-SNAPSHOT",
        "headline": "{suburb} investor snapshot",
        "primaryText": "Review yield movement, recent rent context, and the local signals worth checking before you act.",
        "description": "A suburb snapshot for property investors.",
        "cta": "Get snapshot",
        "prompt": "Rebuild the source investor ad with data cards, property image slot, yield/rent rows, and snapshot CTA.",
    },
    "development": {
        "label": "Development Release",
        "goal": "seller_leads",
        "offerId": "recent_sales_report",
        "imageBriefId": "IMG-DEV-HERO",
        "headline": "New property release in {suburb}",
        "primaryText": "Showcase the hero image, key inclusions, and availability details with a clear enquiry path.",
        "description": "New-release property promotion.",
        "cta": "View details",
        "prompt": "Rebuild the source development ad with architectural image slots, feature chips, release badge, and enquiry CTA.",
    },
}

SLICE_OVERRIDES: dict[int, dict[str, Any]] = {
    2: {
        "kind": "agent",
        "name": "Feed 002 - Buying or Selling Agent Ad",
        "photoRects": [
            {"x": 0.02, "y": 0.02, "w": 0.96, "h": 0.39},
            {"x": 0.69, "y": 0.66, "w": 0.24, "h": 0.27},
        ],
        "panelRect": {"x": 0.08, "y": 0.47, "w": 0.84, "h": 0.30},
        "sampleCopy": {
            "headline": "Buying or selling in {suburb}?",
            "primaryText": "Work with {agent} for clear local advice before your next move.",
            "description": "Agent-led property help for local owners.",
            "cta": "Start planning",
        },
    },
    21: {
        "kind": "listing",
        "name": "Feed 021 - New On The Market Collage",
        "photoRects": [
            {"x": 0.43, "y": 0.58, "w": 0.45, "h": 0.32},
            {"x": 0.12, "y": 0.58, "w": 0.26, "h": 0.32},
            {"x": 0.34, "y": 0.66, "w": 0.19, "h": 0.18},
        ],
        "panelRect": {"x": 0.08, "y": 0.12, "w": 0.84, "h": 0.42},
        "sampleCopy": {
            "headline": "New on the market in {suburb}",
            "primaryText": "A fresh local listing with the features owners and buyers are watching.",
            "description": "Fresh listing context for local owners.",
            "cta": "View listing",
        },
    },
    40: {
        "kind": "development",
        "name": "Square 040 - Luxury Apartments",
        "photoRects": [
            {"x": 0.05, "y": 0.42, "w": 0.90, "h": 0.39},
        ],
        "panelRect": {"x": 0.07, "y": 0.07, "w": 0.86, "h": 0.35},
        "sampleCopy": {
            "headline": "Luxury apartments in {suburb}",
            "primaryText": "Showcase premium amenities, hero imagery, and a direct enquiry path.",
            "description": "Premium apartment campaign creative.",
            "cta": "View release",
        },
    },
    44: {
        "kind": "open_home",
        "name": "Feed 044 - Open House Detail Card",
        "photoRects": [
            {"x": 0.02, "y": 0.02, "w": 0.96, "h": 0.50},
            {"x": 0.45, "y": 0.55, "w": 0.47, "h": 0.25},
        ],
        "panelRect": {"x": 0.08, "y": 0.56, "w": 0.34, "h": 0.26},
        "sampleCopy": {
            "headline": "Open house this Saturday",
            "primaryText": "Inspect the property, see the key spaces, and plan your follow-up questions.",
            "description": "Open-home details with a clear CTA.",
            "cta": "Plan your visit",
        },
    },
    55: {
        "kind": "sold",
        "name": "Feed 055 - Editorial Just Sold",
        "photoRects": [
            {"x": 0.05, "y": 0.27, "w": 0.90, "h": 0.39},
            {"x": 0.17, "y": 0.59, "w": 0.18, "h": 0.18},
        ],
        "panelRect": {"x": 0.08, "y": 0.07, "w": 0.84, "h": 0.20},
        "sampleCopy": {
            "headline": "Just sold in {suburb}",
            "primaryText": "Use the latest local sale as context before you decide your next property step.",
            "description": "Recent sale context without over-claiming.",
            "cta": "Get local context",
        },
    },
    94: {
        "kind": "listing",
        "name": "Square 094 - Modern Home For Sale",
        "photoRects": [
            {"x": 0.00, "y": 0.31, "w": 1.00, "h": 0.34},
        ],
        "panelRect": {"x": 0.08, "y": 0.07, "w": 0.84, "h": 0.24},
        "sampleCopy": {
            "headline": "Modern home for sale",
            "primaryText": "Lead with the hero property photo, price guide, and a simple enquiry CTA.",
            "description": "Square feed listing ad.",
            "cta": "View details",
        },
    },
    142: {
        "kind": "sold",
        "name": "Square 142 - Agent Just Sold",
        "photoRects": [
            {"x": 0.00, "y": 0.19, "w": 1.00, "h": 0.62},
            {"x": 0.00, "y": 0.52, "w": 0.31, "h": 0.40},
        ],
        "panelRect": {"x": 0.07, "y": 0.05, "w": 0.86, "h": 0.15},
        "sampleCopy": {
            "headline": "Just sold near {suburb}",
            "primaryText": "A recent local result can help owners read current buyer response.",
            "description": "Agent-led sold proof for Meta feed.",
            "cta": "See recent sales",
        },
    },
    245: {
        "kind": "agent",
        "name": "Story 245 - Looking For An Agent",
        "photoRects": [
            {"x": 0.43, "y": 0.25, "w": 0.47, "h": 0.58},
        ],
        "panelRect": {"x": 0.08, "y": 0.11, "w": 0.84, "h": 0.22},
        "sampleCopy": {
            "headline": "Looking for a real estate agent?",
            "primaryText": "{agent} can help you plan the next property step in {suburb}.",
            "description": "Vertical agent lead ad.",
            "cta": "Schedule a call",
        },
    },
    259: {
        "kind": "listing",
        "name": "Story 259 - New Listing Stack",
        "photoRects": [
            {"x": 0.00, "y": 0.29, "w": 1.00, "h": 0.27},
            {"x": 0.00, "y": 0.56, "w": 1.00, "h": 0.31},
            {"x": 0.72, "y": 0.77, "w": 0.24, "h": 0.18},
        ],
        "panelRect": {"x": 0.08, "y": 0.05, "w": 0.84, "h": 0.23},
        "sampleCopy": {
            "headline": "New listing in {suburb}",
            "primaryText": "Stack hero photos, price, specs, and contact details for a fast story ad.",
            "description": "Story-format listing ad.",
            "cta": "View listing",
        },
    },
    317: {
        "kind": "open_home",
        "name": "Story 317 - Open House For Sale",
        "photoRects": [
            {"x": 0.36, "y": 0.20, "w": 0.64, "h": 0.58},
            {"x": 0.16, "y": 0.29, "w": 0.25, "h": 0.16},
            {"x": 0.16, "y": 0.50, "w": 0.25, "h": 0.16},
            {"x": 0.28, "y": 0.67, "w": 0.25, "h": 0.16},
        ],
        "panelRect": {"x": 0.07, "y": 0.07, "w": 0.86, "h": 0.16},
        "sampleCopy": {
            "headline": "Open house for sale",
            "primaryText": "Promote the inspection with supporting room previews and key details.",
            "description": "Vertical open-home story ad.",
            "cta": "Plan your visit",
        },
    },
}

SUBURBS = [
    "Scarborough",
    "Bicton",
    "Maylands",
    "Cottesloe",
    "Victoria Park",
    "Fremantle",
    "Mount Lawley",
    "Subiaco",
    "Bayswater",
    "North Perth",
    "Claremont",
    "Inglewood",
    "Trigg",
    "Joondalup",
    "Midland",
]

AGENCIES = [
    "Coastal & Co Realty",
    "Harbour Lane Property",
    "Maison West",
    "Northbank Realty",
    "Civic Estate Agents",
    "Jarrah Property",
    "Bluestone Residential",
    "Foreshore & Park",
]

AGENTS = [
    "Sarah Chen",
    "Elliot Marsh",
    "Mia Hart",
    "Daniel Price",
    "Priya Nair",
    "Tom Walker",
    "Grace Okafor",
    "Leo Romano",
]

PROPERTIES = [
    "renovated family home",
    "low-maintenance villa",
    "coastal apartment",
    "character home",
    "new townhouse",
    "architect-designed residence",
    "investment apartment",
    "modern family home",
]

PROPERTY_AGE = ["renovated_character", "apartment_townhouse", "new_build", "older_affordable", "luxury_architectural"]
PRICE_FEEL = ["mid_market_family", "premium_coastal", "affordable_entry", "investor_rental", "luxury_architectural"]
VISUAL_STYLE = ["polished_meta_ad", "property_photo_first", "data_card", "guide_or_report_mockup", "organic_agent_post"]
PEOPLE = ["none", "agent_portrait", "none", "agent_in_scene", "owner_lifestyle", "buyer_activity"]
COPY_DENSITY = ["headline_overlay", "small_badge", "stat_heavy", "minimal_no_overlay", "full_sales_poster"]
TONE = ["practical_local", "urgent_listing", "simple_super_premium", "soft_organic", "quiet_editorial"]


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#%02X%02X%02X" % rgb


def luminance(rgb: tuple[int, int, int]) -> float:
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def saturation(rgb: tuple[int, int, int]) -> float:
    hi = max(rgb)
    lo = min(rgb)
    return 0 if hi == 0 else (hi - lo) / hi


def clamp(value: float, min_value: float = 0.0, max_value: float = 1.0) -> float:
    return max(min_value, min(max_value, value))


def rect(x: float, y: float, w: float, h: float) -> dict[str, float]:
    x = clamp(x)
    y = clamp(y)
    w = clamp(w, 0.03, 1 - x)
    h = clamp(h, 0.03, 1 - y)
    return {
        "x": round(x, 4),
        "y": round(y, 4),
        "w": round(w, 4),
        "h": round(h, 4),
    }


def palette_for(image: Image.Image) -> list[str]:
    small = image.convert("RGB")
    small.thumbnail((160, 160))
    try:
        quantized = small.quantize(colors=10, method=Image.Quantize.MEDIANCUT)
    except Exception:
        quantized = small.quantize(colors=10)
    raw_palette = quantized.getpalette() or []
    colors = quantized.getcolors(maxcolors=1000000) or []
    ranked: list[tuple[int, int, int]] = []
    for _count, index in sorted(colors, reverse=True):
        offset = index * 3
        if offset + 2 < len(raw_palette):
            ranked.append(tuple(raw_palette[offset : offset + 3]))

    primary = next((c for c in ranked if 35 <= luminance(c) <= 225 and saturation(c) > 0.08), ranked[0] if ranked else (20, 49, 79))
    accent = next((c for c in sorted(ranked, key=saturation, reverse=True) if saturation(c) > 0.18 and 40 <= luminance(c) <= 235), (231, 178, 75))
    surface = (255, 255, 255) if luminance(primary) < 148 else (11, 23, 32)
    text = (11, 23, 32) if luminance(surface) > 180 else (255, 255, 255)
    values = [rgb_to_hex(c) for c in [primary, surface, accent, text, *ranked[:4]]]
    unique: list[str] = []
    for value in values:
        if value not in unique:
            unique.append(value)
    return unique[:8]


def grid_size(bucket: str) -> tuple[int, int]:
    if bucket == "portrait_9x16":
        return 6, 12
    if bucket in ("landscape_16x9", "banner_wide"):
        return 12, 6
    if bucket == "landscape_4x3":
        return 10, 7
    if bucket == "portrait_4x5":
        return 7, 9
    return 8, 8


def cell_score(image: Image.Image, x0: int, y0: int, x1: int, y1: int) -> float:
    crop = image.crop((x0, y0, x1, y1)).convert("RGB")
    stat = ImageStat.Stat(crop)
    variance = sum(stat.var) / 3
    std = math.sqrt(max(0.0, variance))
    chroma = max(stat.mean) - min(stat.mean)
    return std + chroma * 0.25


def component_rects(mask: list[list[bool]], cols: int, rows: int) -> list[dict[str, float]]:
    seen = [[False for _ in range(cols)] for _ in range(rows)]
    found: list[dict[str, float]] = []
    for y in range(rows):
        for x in range(cols):
            if not mask[y][x] or seen[y][x]:
                continue
            q: deque[tuple[int, int]] = deque([(x, y)])
            seen[y][x] = True
            xs: list[int] = []
            ys: list[int] = []
            while q:
                cx, cy = q.popleft()
                xs.append(cx)
                ys.append(cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < cols and 0 <= ny < rows and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            min_x, max_x = min(xs), max(xs) + 1
            min_y, max_y = min(ys), max(ys) + 1
            width = (max_x - min_x) / cols
            height = (max_y - min_y) / rows
            area = width * height
            if area >= 0.055 and width >= 0.16 and height >= 0.12:
                found.append(rect(min_x / cols - 0.01, min_y / rows - 0.01, width + 0.02, height + 0.02))
    return sorted(found, key=lambda r: r["w"] * r["h"], reverse=True)


def default_photo_rect(bucket: str) -> dict[str, float]:
    if bucket == "portrait_9x16":
        return rect(0, 0, 1, 1)
    if bucket == "portrait_4x5":
        return rect(0.06, 0.06, 0.88, 0.58)
    if bucket == "square_1x1":
        return rect(0.06, 0.06, 0.88, 0.58)
    if bucket == "landscape_4x3":
        return rect(0.42, 0.08, 0.52, 0.72)
    return rect(0.44, 0.08, 0.5, 0.78)


def photo_rects_for(image: Image.Image, bucket: str) -> list[dict[str, float]]:
    cols, rows = grid_size(bucket)
    width, height = image.size
    scores: list[float] = []
    grid: list[list[float]] = []
    for gy in range(rows):
        row: list[float] = []
        for gx in range(cols):
            score = cell_score(
                image,
                int(width * gx / cols),
                int(height * gy / rows),
                int(width * (gx + 1) / cols),
                int(height * (gy + 1) / rows),
            )
            row.append(score)
            scores.append(score)
        grid.append(row)

    ranked = sorted(scores)
    median = ranked[len(ranked) // 2] if ranked else 0
    threshold = max(24.0, median * 1.22)
    mask = [[grid[y][x] >= threshold for x in range(cols)] for y in range(rows)]
    components = component_rects(mask, cols, rows)
    if components:
        return components[:4]
    return [default_photo_rect(bucket)]


def panel_rect_for(photo_rects: list[dict[str, float]], bucket: str) -> dict[str, float]:
    primary = photo_rects[0] if photo_rects else default_photo_rect(bucket)
    if primary["w"] > 0.78 and primary["h"] > 0.72:
        return rect(0.07, 0.58 if bucket == "portrait_9x16" else 0.62, 0.86, 0.28)
    if primary["y"] < 0.18 and primary["h"] < 0.66:
        y = min(0.72, primary["y"] + primary["h"] + 0.035)
        return rect(0.08, y, 0.84, min(0.28, 0.94 - y))
    if primary["x"] < 0.22 and primary["w"] < 0.64:
        return rect(min(0.58, primary["x"] + primary["w"] + 0.04), 0.16, 0.36, 0.62)
    if primary["x"] > 0.34:
        return rect(0.06, 0.18, min(0.36, primary["x"] - 0.09), 0.58)
    return rect(0.08, 0.62, 0.84, 0.26)


def profile_for(bucket: str, index: int) -> tuple[str, dict[str, str]]:
    seq = SEQUENCES_BY_BUCKET[bucket]
    key = seq[(index - 1) % len(seq)]
    return key, PROFILE[key]


def format_template(value: str, context: dict[str, str]) -> str:
    return value.format(**context)


def descriptor_for(row: dict[str, str]) -> dict[str, Any]:
    index = int(row["meta_index"])
    bucket = row["aspect_bucket"]
    override = SLICE_OVERRIDES.get(index, {})
    source_file = row["file"]
    image_path = META_DIR / source_file
    with Image.open(image_path) as image:
        rgb = image.convert("RGB")
        photo_rects = override.get("photoRects") or photo_rects_for(rgb, bucket)
        palette = palette_for(rgb)

    key = override.get("kind")
    if key:
        profile = PROFILE[key]
    else:
        key, profile = profile_for(bucket, index)
    suburb = SUBURBS[(index - 1) % len(SUBURBS)]
    agency = AGENCIES[(index + 1) % len(AGENCIES)]
    agent = AGENTS[(index + 2) % len(AGENTS)]
    property_desc = PROPERTIES[(index + 3) % len(PROPERTIES)]
    context = {
        "suburb": suburb,
        "agency": agency,
        "agent": agent,
        "property": property_desc,
    }
    copy_source = override.get("sampleCopy") or profile
    sample_copy = {
        "headline": format_template(copy_source["headline"], context),
        "primaryText": format_template(copy_source["primaryText"], context),
        "description": format_template(copy_source["description"], context),
        "cta": format_template(copy_source["cta"], context),
    }

    return {
        "id": f"meta_{index:03d}",
        "name": override.get("name") or f"Meta {index:03d} - {profile['label']}",
        "sourceFile": source_file,
        "originalFile": row["original_file"],
        "aspectBucket": bucket,
        "nativeFormat": FORMAT_BY_BUCKET[bucket],
        "placement": row["placement"],
        "useLevel": row["use_level"],
        "imageSize": {"w": int(row["image_width"]), "h": int(row["image_height"])},
        "palette": palette,
        "photoRects": photo_rects,
        "panelRect": override.get("panelRect") or panel_rect_for(photo_rects, bucket),
        "kind": key,
        "goal": profile["goal"],
        "offerId": profile["offerId"],
        "imageBriefId": profile["imageBriefId"],
        "promptHint": f"{profile['prompt']} Source image: {source_file}; original extraction: {row['original_file']}.",
        "sampleCopy": sample_copy,
        "sampleStyle": {
            "propertyAge": PROPERTY_AGE[(index - 1) % len(PROPERTY_AGE)],
            "priceFeel": PRICE_FEEL[(index + 1) % len(PRICE_FEEL)],
            "visualStyle": VISUAL_STYLE[(index + 2) % len(VISUAL_STYLE)],
            "people": PEOPLE[(index + 3) % len(PEOPLE)],
            "copyDensity": COPY_DENSITY[(index + 4) % len(COPY_DENSITY)],
            "tone": TONE[(index + 5) % len(TONE)],
            "sampleSuburb": suburb,
            "agencyName": agency,
            "agentName": agent,
            "address": f"{10 + index} {suburb} Road, {suburb}",
            "propertyDetail": property_desc,
            "resultDetail": "local context sample",
        },
        "evidenceScore": 70 + (index % 17),
    }


def arg_value(name: str) -> str | None:
    try:
        index = sys.argv.index(name)
    except ValueError:
        return None
    return sys.argv[index + 1] if index + 1 < len(sys.argv) else None


def ids_arg() -> set[int] | None:
    value = arg_value("--ids")
    if not value:
        return None
    ids = {int(part.strip()) for part in value.split(",") if part.strip()}
    if not ids:
        raise SystemExit("--ids must include at least one numeric meta index")
    return ids


def main() -> None:
    limit = int(arg_value("--limit") or TOTAL_CANDIDATES)
    sample_count_value = arg_value("--sample-count")
    seed = int(arg_value("--seed") or 20260621)
    explicit_ids = ids_arg()
    with META_CSV.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    if len(rows) != TOTAL_CANDIDATES:
        raise SystemExit(f"Expected {TOTAL_CANDIDATES} extracted template candidates, found {len(rows)}")
    if limit < 1 or limit > TOTAL_CANDIDATES:
        raise SystemExit(f"--limit must be between 1 and {TOTAL_CANDIDATES}")

    if explicit_ids is not None:
        by_id = {int(row["meta_index"]): row for row in rows}
        missing = sorted(explicit_ids - set(by_id))
        if missing:
            raise SystemExit(f"Unknown meta indexes: {missing}")
        selected_rows = [by_id[index] for index in sorted(explicit_ids)]
    else:
        selected_rows = rows[:limit]

    if explicit_ids is None and sample_count_value is not None:
        sample_count = int(sample_count_value)
        if sample_count < 1 or sample_count > len(selected_rows):
            raise SystemExit(f"--sample-count must be between 1 and {len(selected_rows)}")
        selected_rows = sorted(
            random.Random(seed).sample(selected_rows, sample_count),
            key=lambda row: int(row["meta_index"]),
        )

    descriptors = [descriptor_for(row) for row in selected_rows]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(descriptors, indent=2, ensure_ascii=True)
    OUT.write_text(
        "// AUTO-GENERATED by scripts/adstudio-build-extracted-meta-templates.py. Do not edit by hand.\n"
        f"// Slice contains {len(descriptors)} of {TOTAL_CANDIDATES} extracted Meta ad candidate images.\n\n"
        f"export const EXTRACTED_META_TEMPLATE_TOTAL = {TOTAL_CANDIDATES} as const;\n"
        f"export const EXTRACTED_META_TEMPLATE_SLICE_SIZE = {len(descriptors)} as const;\n\n"
        f"export const EXTRACTED_META_TEMPLATE_DESCRIPTORS = {body} as const;\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(descriptors)} descriptors to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
