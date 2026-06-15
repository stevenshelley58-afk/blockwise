#!/usr/bin/env python3
"""Author a creative_skeleton per template and write it into library-seed.json.

The creative_skeleton is what actually drives the *real* generated ad (layout
geometry via copy_safe_zones, image mood via shot, headline via headline_pattern,
badge/ribbon via text_system). Authoring one per template makes the preview card
and the real ad converge: the archetype here matches the archetype the preview
layout was mapped to in sample-styles.json.

Output is validated field-by-field against the schema in
src/lib/ad-template-library/skeleton.ts (see adstudio-validate-skeletons via node).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "ad-template-library" / "library-seed.json"
STYLES = ROOT / "ad-template-library" / "sample-styles.json"

# Mirror of PALETTES in adstudio-build-sample-styles.py (same index per template).
PALETTES = [
    ((12, 74, 110), (212, 160, 23), (20, 28, 38)),
    ((27, 67, 50), (216, 168, 74), (22, 34, 28)),
    ((124, 45, 18), (234, 179, 8), (38, 22, 16)),
    ((30, 30, 36), (201, 162, 39), (18, 18, 22)),
    ((76, 29, 79), (236, 190, 92), (30, 20, 34)),
    ((15, 76, 92), (240, 171, 76), (16, 32, 38)),
    ((51, 65, 85), (203, 213, 225), (24, 30, 40)),
    ((120, 53, 15), (245, 158, 11), (40, 24, 12)),
]

# Variables the real headline normalizer understands (single-brace). Anything
# else must be stripped from headline_pattern so it never renders literally.
SUPPORTED_VARS = {
    "suburb", "property_type", "bedrooms", "street", "launch_timing", "day",
    "time", "address", "sale_result", "period", "metric", "buyer_type", "timeline",
}

# Per-archetype layout/shot blueprint. copy_safe_zones are normalized 0..1 and
# satisfy x+width<=1, y+height<=1.
BLUEPRINT = {
    "listing_hero": {
        "shot": {"type": "exterior hero", "lighting": "golden hour", "mood": "aspirational, warm"},
        "focal_point": "the home facade", "horizon": "low",
        "zones": [
            {"id": "headline", "x": 0.06, "y": 0.66, "width": 0.88, "height": 0.2, "priority": "primary"},
            {"id": "cta", "x": 0.06, "y": 0.88, "width": 0.45, "height": 0.08, "priority": "cta"},
        ],
        "overlay": "bottom dark gradient", "contrast": "high",
        "headline_zone": "lower third", "badge": "new listing pill", "cta_style": "solid pill",
    },
    "just_sold": {
        "shot": {"type": "exterior with sold signage", "lighting": "bright daylight", "mood": "celebratory, credible"},
        "focal_point": "the sold home", "horizon": "low",
        "zones": [
            {"id": "badge", "x": 0.62, "y": 0.06, "width": 0.32, "height": 0.2, "priority": "secondary"},
            {"id": "headline", "x": 0.06, "y": 0.68, "width": 0.88, "height": 0.18, "priority": "primary"},
            {"id": "cta", "x": 0.06, "y": 0.88, "width": 0.45, "height": 0.08, "priority": "cta"},
        ],
        "overlay": "bottom dark gradient", "contrast": "high",
        "headline_zone": "lower third", "badge": "sold ribbon", "cta_style": "solid pill",
    },
    "market_stat": {
        "shot": {"type": "aerial or streetscape", "lighting": "clear midday", "mood": "informative, trustworthy"},
        "focal_point": "the suburb context", "horizon": "high",
        "zones": [
            {"id": "stats", "x": 0.06, "y": 0.5, "width": 0.88, "height": 0.34, "priority": "primary"},
            {"id": "headline", "x": 0.06, "y": 0.08, "width": 0.88, "height": 0.16, "priority": "secondary"},
            {"id": "cta", "x": 0.06, "y": 0.88, "width": 0.45, "height": 0.08, "priority": "cta"},
        ],
        "overlay": "solid lower panel", "contrast": "high",
        "headline_zone": "upper third", "badge": "data pill", "cta_style": "solid pill",
    },
    "appraisal": {
        "shot": {"type": "inviting home exterior", "lighting": "soft afternoon", "mood": "reassuring, local"},
        "focal_point": "the home", "horizon": "low",
        "zones": [
            {"id": "headline", "x": 0.06, "y": 0.64, "width": 0.88, "height": 0.22, "priority": "primary"},
            {"id": "cta", "x": 0.06, "y": 0.88, "width": 0.5, "height": 0.08, "priority": "cta"},
        ],
        "overlay": "bottom dark gradient", "contrast": "medium",
        "headline_zone": "lower third", "badge": "free appraisal pill", "cta_style": "solid pill",
    },
    "open_home": {
        "shot": {"type": "welcoming entrance or interior", "lighting": "bright natural", "mood": "friendly, open"},
        "focal_point": "the entrance", "horizon": "middle",
        "zones": [
            {"id": "badge", "x": 0.06, "y": 0.06, "width": 0.4, "height": 0.12, "priority": "secondary"},
            {"id": "details", "x": 0.06, "y": 0.68, "width": 0.88, "height": 0.2, "priority": "primary"},
            {"id": "cta", "x": 0.06, "y": 0.88, "width": 0.45, "height": 0.08, "priority": "cta"},
        ],
        "overlay": "bottom gradient", "contrast": "medium",
        "headline_zone": "lower third", "badge": "open home pill", "cta_style": "outline pill",
    },
    "seller_guide": {
        "shot": {"type": "calm styled interior", "lighting": "soft natural", "mood": "helpful, premium"},
        "focal_point": "the guide subject", "horizon": "middle",
        "zones": [
            {"id": "title", "x": 0.1, "y": 0.12, "width": 0.8, "height": 0.3, "priority": "primary"},
            {"id": "list", "x": 0.1, "y": 0.5, "width": 0.8, "height": 0.3, "priority": "secondary"},
            {"id": "cta", "x": 0.1, "y": 0.86, "width": 0.5, "height": 0.08, "priority": "cta"},
        ],
        "overlay": "soft scrim", "contrast": "medium",
        "headline_zone": "upper third", "badge": "free guide pill", "cta_style": "solid pill",
    },
    "social_proof": {
        "shot": {"type": "happy clients or home", "lighting": "warm natural", "mood": "authentic, positive"},
        "focal_point": "the people", "horizon": "middle",
        "zones": [
            {"id": "quote", "x": 0.08, "y": 0.34, "width": 0.84, "height": 0.36, "priority": "primary"},
            {"id": "attribution", "x": 0.08, "y": 0.72, "width": 0.6, "height": 0.1, "priority": "secondary"},
            {"id": "cta", "x": 0.08, "y": 0.86, "width": 0.5, "height": 0.08, "priority": "cta"},
        ],
        "overlay": "dim image scrim", "contrast": "high",
        "headline_zone": "center", "badge": "five-star pill", "cta_style": "solid pill",
    },
    "coming_soon": {
        "shot": {"type": "teaser exterior", "lighting": "dusk", "mood": "anticipation"},
        "focal_point": "the home", "horizon": "low",
        "zones": [
            {"id": "headline", "x": 0.06, "y": 0.7, "width": 0.88, "height": 0.18, "priority": "primary"},
            {"id": "cta", "x": 0.06, "y": 0.88, "width": 0.45, "height": 0.08, "priority": "cta"},
        ],
        "overlay": "bottom gradient", "contrast": "high",
        "headline_zone": "lower third", "badge": "coming soon ribbon", "cta_style": "outline pill",
    },
}


def hexc(rgb):
    return "#%02X%02X%02X" % rgb


def headline_pattern(raw):
    """Single-brace, only supported variables; everything else stripped clean."""
    text = str(raw or "")

    def repl(m):
        var = m.group(1).strip().lower()
        return "{" + var + "}" if var in SUPPORTED_VARS else ""

    text = re.sub(r"\{\{\s*([a-z0-9_]+)\s*\}\}", repl, text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([?!.,])", r"\1", text)
    text = text.strip(" -–—:")
    return (text or "A local update worth a look")[:160]


def variables_in(*texts):
    found = []
    for t in texts:
        for m in re.findall(r"\{\{\s*([a-z0-9_]+)\s*\}\}", str(t or ""), flags=re.I):
            v = m.lower()
            if v not in found:
                found.append(v)
    return found[:20]


def build_skeleton(index, key, template, style):
    arch = style["archetype"]
    bp = BLUEPRINT[arch]
    accent, accent2, ink = PALETTES[index % len(PALETTES)]
    hook = (str(template.get("hook_style") or style.get("tone") or "local, plain-spoken")).strip()[:120]
    return {
        "version": 1,
        "archetype": arch,
        "shot": dict(bp["shot"]),
        "composition": {
            "focal_point": bp["focal_point"],
            "horizon": bp["horizon"],
            "copy_safe_zones": [dict(z) for z in bp["zones"]],
        },
        "color": {
            "palette": [hexc(accent), hexc(accent2), hexc(ink), "#FFFFFF"],
            "overlay": bp["overlay"],
            "contrast": bp["contrast"],
        },
        "text_system": {
            "headline_zone": bp["headline_zone"],
            "badge": bp["badge"],
            "cta_style": bp["cta_style"],
        },
        "copy": {
            "hook_style": hook,
            "headline_pattern": headline_pattern(template.get("headline")),
            "cta": (str(template.get("cta") or "Learn more")).strip()[:80],
        },
        "variables": variables_in(template.get("headline"), template.get("primary_text"), template.get("cta")),
        "confidence": 78,
    }


def main():
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    styles = json.loads(STYLES.read_text(encoding="utf-8"))
    templates = seed.get("templates", [])
    written = 0
    for index, template in enumerate(templates):
        key = str(template.get("template_key"))
        style = styles.get(key)
        if not style:
            raise SystemExit(f"No sample-style for {key}; run adstudio-build-sample-styles.py first.")
        template["creative_skeleton"] = build_skeleton(index, key, template, style)
        written += 1
    SEED.write_text(json.dumps(seed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote creative_skeleton for {written} templates -> {SEED}")


if __name__ == "__main__":
    main()
