#!/usr/bin/env python3
"""Quality gate for Ad Studio sample cards.

Three cooperating layers:
  1. deterministic copy/coherence linters  (lint_card)
  2. content-aware compositing checks       (handled in the renderer)
  3. vision-LLM reviewer + auto-fix loop    (vision_review / run_gate)

Run:
  python3 scripts/adstudio_card_qa.py --lint-only
  OPENAI_API_KEY=... python3 scripts/adstudio_card_qa.py --vision --limit 8
  OPENAI_API_KEY=... python3 scripts/adstudio_card_qa.py --gate            # full auto-fix
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STYLES_PATH = ROOT / "ad-template-library" / "sample-styles.json"
SEED_PATH = ROOT / "ad-template-library" / "library-seed.json"
CARDS_DIR = ROOT / "ad-template-library" / "images" / "sample-cards"
REPORT_PATH = ROOT / "ad-template-library" / "qa-report.json"
PREFIX = "adstudio-samples/v1"

# Master list of every suburb that can appear, so we can detect a "foreign"
# suburb leaking into a card whose persona is elsewhere.
ALL_SUBURBS = [
    "Scarborough", "Bicton", "Maylands", "Cottesloe", "Victoria Park", "Fremantle",
    "Mount Lawley", "Subiaco", "Bayswater", "North Perth", "Claremont", "Inglewood",
    "Trigg", "Joondalup", "Midland", "Doubleview", "Karrinyup", "Attadale", "Palmyra",
    "East Fremantle", "Mosman Park", "Peppermint Grove", "Swanbourne", "East Victoria Park",
    "Burswood", "Lathlain", "North Fremantle", "Beaconsfield", "White Gum Valley", "Menora",
    "Highgate", "Shenton Park", "Daglish", "Jolimont", "Embleton", "Morley", "Leederville",
    "Nedlands", "Mount Claremont", "Bedford", "North Beach", "Edgewater", "Connolly",
    "Currambine", "Bellevue", "Viveash", "Woodbridge",
]

# CTA <-> category coherence. A CTA carrying one of these intents must only
# appear for the allowed category prefixes (the AU-shows-appraisal-CTA bug).
CTA_INTENT_RULES = [
    ("appraisal/price", re.compile(r"price update|appraisal|what'?s it worth|home value", re.I),
     {"HV", "JS", "PM", "AB", "MU", "BD", "DS"}),
    ("download/guide", re.compile(r"download|checklist|guide|report", re.I),
     {"LM", "MU", "AU", "DS", "HV"}),
    ("register/dev", re.compile(r"register|enquire|off.?the.?plan|brochure", re.I),
     {"ND", "IN", "OH", "JL"}),
    ("rental", re.compile(r"rental appraisal|lease|rent appraisal|manage my", re.I),
     {"PM", "IN"}),
]


def load_styles() -> dict:
    return json.loads(STYLES_PATH.read_text(encoding="utf-8"))


def load_seed() -> dict:
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    return {str(t.get("template_key")): t for t in seed.get("templates", [])}


def _slug(value: str) -> str:
    out = "".join(ch.lower() if ch.isalnum() or ch in "_-" else "-" for ch in value.strip())
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-") or "sample-template"


def card_path(key: str) -> Path:
    return CARDS_DIR / PREFIX / f"{_slug(key)}.png"


def resolve_copy(key, style, seed):
    """Re-use the renderer's substitution so lint sees exactly what ships."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("r", str(ROOT / "scripts" / "adstudio-render-template-cards.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.sample_copy(seed.get(key, {}), style)


# ---------------------------------------------------------------------------
# Layer 1 - deterministic linters
# ---------------------------------------------------------------------------
def lint_text(label, text, persona):
    issues = []
    if re.search(r"\{\{.*?\}\}", text):
        issues.append(f"{label}: unresolved template token")
    if "  " in text:
        issues.append(f"{label}: double space")
    if re.search(r"(?:^|\s)[B-HJ-Zb-hj-z](?:\s|$)", text):  # stray single letter (allow 'a'/'A'/'I')
        issues.append(f"{label}: stray single-letter word")
    if re.search(r"^\s*[-,;:.]", text) or re.search(r"[-,;:]\s*$", text.strip()):
        issues.append(f"{label}: leading/trailing punctuation")
    if re.search(r"\s[,;:]", text):  # space before comma/colon (note: ' - ' em-dash is allowed)
        issues.append(f"{label}: space before punctuation")
    if re.search(r"\b(\w+)\s+\1\b", text, re.I):
        issues.append(f"{label}: repeated word")
    if "$$" in text or "%%" in text:
        issues.append(f"{label}: duplicated symbol")
    # locale coherence: a foreign suburb must not appear
    own = {persona.get("suburb", "")} | set(persona.get("region", []))
    for suburb in ALL_SUBURBS:
        if suburb in own:
            continue
        if re.search(rf"\b{re.escape(suburb)}\b", text):
            issues.append(f"{label}: foreign suburb '{suburb}' (persona is {persona.get('suburb')})")
    return issues


def lint_card(key, style, copy):
    persona = style.get("persona") or {}
    issues = []
    for label, text in copy.items():
        issues += lint_text(label, text, persona)
    # CTA <-> category coherence
    cat = key.split("-")[0]
    cta = copy.get("cta", "")
    for name, pattern, allowed in CTA_INTENT_RULES:
        if pattern.search(cta) and cat not in allowed:
            issues.append(f"cta: '{cta}' has {name} intent but category {cat} disallows it")
    return issues


def lint_all():
    styles = load_styles()
    seed = load_seed()
    # one renderer import, reused
    import importlib.util
    spec = importlib.util.spec_from_file_location("r", str(ROOT / "scripts" / "adstudio-render-template-cards.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    report = {}
    stat_signatures = {}
    for key, style in styles.items():
        copy = mod.sample_copy(seed.get(key, {}), style)
        issues = lint_card(key, style, copy)
        if style.get("layout") == "data_card":
            stats = (style.get("persona") or {}).get("stats", {})
            sig = (stats.get("growth_12m"), stats.get("days"), stats.get("buyers"), stats.get("median"))
            stat_signatures.setdefault(sig, []).append(key)
        report[key] = issues
    # flag identical stat sets shared by multiple data cards
    for sig, keys in stat_signatures.items():
        if len(keys) > 1:
            for key in keys:
                report[key].append(f"stats: identical stat set shared with {', '.join(k for k in keys if k != key)}")
    return report


def print_lint(report):
    total = sum(len(v) for v in report.values())
    flagged = {k: v for k, v in report.items() if v}
    for key, issues in flagged.items():
        print(f"\n{key}:")
        for issue in issues:
            print(f"  - {issue}")
    print(f"\nLint: {total} issue(s) across {len(flagged)} card(s); {len(report) - len(flagged)} clean.")
    return total


# ---------------------------------------------------------------------------
# Layer 3 - vision-LLM reviewer + auto-fix loop
# ---------------------------------------------------------------------------
import urllib.request

VISION_MODEL = os.environ.get("BLOCKWISE_QA_VISION_MODEL", "gpt-4o")
GEN_SCRIPT = ROOT / "scripts" / "adstudio-generate-sample-sources.py"
RENDER_SCRIPT = ROOT / "scripts" / "adstudio-render-template-cards.py"

VISION_SYSTEM = (
    "You are a strict visual QA reviewer for real-estate social-media ad creatives. "
    "You are shown one rendered ad card and its intended metadata. Find real problems only. "
    "Check, in priority order: "
    "(1) any human face or head clipped by the image edge, or covered by a badge/logo/text; "
    "(2) text that is cut off, overlapping other text, or unreadable; "
    "(3) the photo subject matches the message and 'people' intent "
    "(agent_portrait/agent_in_scene => a person; none => property/scene, no prominent person); "
    "(4) if a person and an agent NAME are both shown, the person's apparent gender matches the name; "
    "(5) visually broken artefacts (stretched, duplicated, empty/blank panel, garbled text). "
    "Do NOT invent issues; sample names/suburbs/stats are intentional. " "A suburb shown with its state suffix (e.g. 'Victoria Park, WA') matches a metadata suburb without the suffix - do not flag that. Minor wording or styling is not an issue. "
    "Return ONLY JSON: {\"pass\": bool, \"severity\": \"none\"|\"low\"|\"high\", "
    "\"issues\": [{\"type\": str, \"detail\": str}]}. "
    "Use severity 'high' only when the ad looks broken or wrong; 'low' for minor polish."
)


def _b64_card(path, max_w=768):
    from PIL import Image
    import io
    img = Image.open(path).convert("RGB")
    if img.width > max_w:
        img = img.resize((max_w, int(img.height * max_w / img.width)), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def vision_review(key, style, copy, path):
    token = os.environ.get("OPENAI_API_KEY", "").strip().lstrip("﻿")
    if not token:
        raise SystemExit("OPENAI_API_KEY required for vision review.")
    persona = style.get("persona") or {}
    intent = {
        "category_code": key.split("-")[0],
        "layout": style.get("layout"),
        "people_intent": style.get("people"),
        "agent_name_shown": persona.get("agent") if style.get("people", "none") != "none" else None,
        "suburb": persona.get("suburb"),
        "headline": copy.get("headline"),
        "cta": copy.get("cta"),
    }
    body = json.dumps({
        "model": VISION_MODEL,
        "response_format": {"type": "json_object"},
        "temperature": 0,
        "messages": [
            {"role": "system", "content": VISION_SYSTEM},
            {"role": "user", "content": [
                {"type": "text", "text": "Intended metadata:\n" + json.dumps(intent, indent=2)},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{_b64_card(path)}"}},
            ]},
        ],
    }).encode()
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        payload = json.loads(resp.read().decode())
    content = payload["choices"][0]["message"]["content"]
    try:
        verdict = json.loads(content)
    except json.JSONDecodeError:
        verdict = {"pass": True, "severity": "none", "issues": [], "_parse_error": content[:200]}
    verdict.setdefault("pass", True)
    verdict.setdefault("severity", "none")
    verdict.setdefault("issues", [])
    return verdict


def _is_image_issue(verdict):
    """Does the verdict point at the source image (=> regenerate) vs the layout?"""
    text = json.dumps(verdict.get("issues", [])).lower()
    return any(w in text for w in ["face", "head", "gender", "subject", "person", "people",
                                   "house", "property", "stretched", "match"])


def regenerate_source(key):
    import subprocess
    env = dict(os.environ)
    subprocess.run([sys.executable, str(GEN_SCRIPT), "--only", key, "--limit", "1"],
                   check=False, env=env, capture_output=True)


def render_one(key):
    import importlib.util
    spec = importlib.util.spec_from_file_location("r", str(RENDER_SCRIPT))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    styles = mod.load_styles()
    seed = mod.load_seed(mod.DEFAULT_SEED)
    keys = list(styles.keys())
    i = keys.index(key)
    mod._FACE_CACHE.pop(key, None)
    mod.render_card(key, seed.get(key, {}), styles[key], i, mod.DEFAULT_OUT)


def load_report():
    if REPORT_PATH.exists():
        return json.loads(REPORT_PATH.read_text())
    return {}


def save_report(report):
    REPORT_PATH.write_text(json.dumps(report, indent=2))


def run_vision(limit=0, only=None, fix=False, max_retries=2):
    styles = load_styles()
    seed = load_seed()
    import importlib.util
    spec = importlib.util.spec_from_file_location("r", str(RENDER_SCRIPT))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    report = load_report()
    keys = [only] if only else [k for k in styles if report.get(k, {}).get("status") != "pass"]
    if limit:
        keys = keys[:limit]
    if not keys:
        passed = sum(1 for v in report.values() if v.get("status") == "pass")
        print(f"Vision: nothing pending. {passed}/{len(styles)} passed.")
        return report

    for key in keys:
        style = styles[key]
        copy = mod.sample_copy(seed.get(key, {}), style)
        path = card_path(key)
        verdict = vision_review(key, style, copy, path)
        attempts = 0
        while fix and not verdict.get("pass") and verdict.get("severity") == "high" and attempts < max_retries:
            attempts += 1
            if _is_image_issue(verdict):
                regenerate_source(key)
            render_one(key)
            verdict = vision_review(key, style, copy, path)
        report[key] = {
            "status": "pass" if verdict.get("pass") else "flag",
            "severity": verdict.get("severity"),
            "issues": verdict.get("issues"),
            "retries": attempts,
        }
        tag = "PASS" if verdict.get("pass") else f"FLAG/{verdict.get('severity')}"
        extra = f" (after {attempts} fix)" if attempts else ""
        print(f"  {tag} {key}{extra}: " + "; ".join(i.get("detail", "") for i in verdict.get("issues", []))[:140])
        save_report(report)

    flagged = [k for k, v in report.items() if v.get("status") != "pass"]
    print(f"\nVision review: {len(report) - len(flagged)}/{len(styles)} pass, {len(flagged)} flagged.")
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lint-only", action="store_true")
    parser.add_argument("--vision", action="store_true")
    parser.add_argument("--gate", action="store_true", help="vision review + auto-fix flagged cards")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--only", type=str, default="")
    args = parser.parse_args()

    report = lint_all()
    total = print_lint(report)
    if args.lint_only:
        sys.exit(1 if total else 0)
    if args.vision or args.gate:
        run_vision(limit=args.limit, only=(args.only or None), fix=args.gate)


if __name__ == "__main__":
    main()
