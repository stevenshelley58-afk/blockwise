#!/usr/bin/env python3
"""Render varied, Meta-style sample cards for Ad Studio templates.

Each card composites a unique model-generated source image (one per template, in
ad-template-library/images/sample-sources/) into one of twelve distinct layout
archetypes, with sample copy drawn from the template seed. The curated style +
layout assignment lives in ad-template-library/sample-styles.json, the single
source of truth shared with the TypeScript runtime mapper.

All houses, people, names, addresses and copy are original samples; the renderer
never reads or embeds observed competitor media.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

try:
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
except ModuleNotFoundError as exc:
    Image = ImageDraw = ImageEnhance = ImageFilter = ImageFont = None
    _PIL_IMPORT_ERROR = exc
else:
    _PIL_IMPORT_ERROR = None

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SEED = ROOT / "ad-template-library" / "library-seed.json"
STYLES_PATH = ROOT / "ad-template-library" / "sample-styles.json"
SOURCES_DIR = ROOT / "ad-template-library" / "images" / "sample-sources"
DEFAULT_OUT = ROOT / "ad-template-library" / "images" / "sample-cards"
BUCKET = "template-cards"
PREFIX = "adstudio-samples/v1"
W, H = 1080, 1350

_SANS = ["/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"]
_SANS_BOLD = ["/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"]
_SERIF = ["/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
          "C:/Windows/Fonts/georgia.ttf", "C:/Windows/Fonts/times.ttf"]
_SERIF_BOLD = ["/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
               "C:/Windows/Fonts/georgiab.ttf", "C:/Windows/Fonts/timesbd.ttf"]
_FONT_CACHE: dict[tuple, Any] = {}


def require_pillow():
    if _PIL_IMPORT_ERROR is not None:
        raise RuntimeError("Pillow is required to render or verify sample cards.") from _PIL_IMPORT_ERROR


def font(size: int, bold: bool = False, serif: bool = False):
    require_pillow()
    key = (size, bold, serif)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    candidates = (_SERIF_BOLD if bold else _SERIF) if serif else (_SANS_BOLD if bold else _SANS)
    for candidate in candidates:
        if os.path.exists(candidate):
            _FONT_CACHE[key] = ImageFont.truetype(candidate, size)
            return _FONT_CACHE[key]
    _FONT_CACHE[key] = ImageFont.load_default()
    return _FONT_CACHE[key]


PALETTES = [
    {"accent": (12, 74, 110), "accent2": (212, 160, 23), "ink": (20, 28, 38)},
    {"accent": (27, 67, 50), "accent2": (216, 168, 74), "ink": (22, 34, 28)},
    {"accent": (124, 45, 18), "accent2": (234, 179, 8), "ink": (38, 22, 16)},
    {"accent": (30, 30, 36), "accent2": (201, 162, 39), "ink": (18, 18, 22)},
    {"accent": (76, 29, 79), "accent2": (236, 190, 92), "ink": (30, 20, 34)},
    {"accent": (15, 76, 92), "accent2": (240, 171, 76), "ink": (16, 32, 38)},
    {"accent": (51, 65, 85), "accent2": (203, 213, 225), "ink": (24, 30, 40)},
    {"accent": (120, 53, 15), "accent2": (245, 158, 11), "ink": (40, 24, 12)},
]
BLUE_CTA = (24, 119, 242)


def palette_for(index: int) -> dict:
    return PALETTES[index % len(PALETTES)]


VARIABLES = {
    "bedrooms": "3", "beds": "3", "baths": "2", "cars": "2", "land": "512 m2",
    "time": "10:30am", "day": "Saturday", "date": "Sat 21 June", "period": "Q2 2026",
    "metric": "median days on market", "median_value": "$892k", "active_buyers": "42",
    "bidders": "5", "growth": "6.4%", "growth_12m": "6.4%", "growth_5y": "31%",
    "rent_before": "$620/wk", "rent_after": "$1,520/wk", "project_name": "The Grove",
    "project_or_address": "The Grove", "deposit_pct": "5%", "price": "$690k",
    "landmark": "the river", "property_desc": "renovated family home",
    "sale_result": "sold in 18 days", "buyer_type": "family buyers",
    "property_type": "house", "quote": "They made the whole sale feel calm and clear",
    "client_name": "Alex", "suburb_list": "Scarborough, Trigg and Wembley Downs",
    "launch_timing": "next week", "local_area": "your street", "timeline": "next 90 days",
}


def slug(value: str) -> str:
    out = "".join(ch.lower() if ch.isalnum() or ch in "_-" else "-" for ch in value.strip())
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-") or "sample-template"


def sample_path(template_key: str) -> str:
    return f"{PREFIX}/{slug(template_key)}.png"


def persona_replacements(style: dict) -> dict:
    """All template variables resolved from one coherent persona."""
    persona = style.get("persona") or {}
    stats = persona.get("stats") or {}
    repl = dict(VARIABLES)
    repl.update({
        "suburb": persona.get("suburb", style.get("sampleSuburb", "")),
        "state": persona.get("state", style.get("sampleState", "WA")),
        "business_name": persona.get("agency", style.get("agencyName", "")),
        "agent_name": persona.get("agent", style.get("agentName", "")),
        "address": persona.get("address", style.get("address", "")),
        "suburb_list": persona.get("regionList", VARIABLES["suburb_list"]),
        "local_area": persona.get("suburb", VARIABLES["local_area"]),
        "project_name": persona.get("project", VARIABLES["project_name"]),
        "project_or_address": persona.get("project", VARIABLES["project_or_address"]),
        "median_value": stats.get("median", VARIABLES["median_value"]),
        "active_buyers": stats.get("buyers", VARIABLES["active_buyers"]),
        "growth": stats.get("growth_12m", VARIABLES["growth"]),
        "growth_12m": stats.get("growth_12m", VARIABLES["growth_12m"]),
        "growth_5y": stats.get("growth_5y", VARIABLES["growth_5y"]),
        "rent_before": stats.get("rent_before", VARIABLES["rent_before"]),
        "rent_after": stats.get("rent_after", VARIABLES["rent_after"]),
        "property_type": VARIABLES["property_type"],
    })
    return repl


def substitute(value: Any, style: dict) -> str:
    text = str(value or "")
    repl = persona_replacements(style)
    for k, r in repl.items():
        text = text.replace("{{" + k + "}}", r).replace("{{ " + k + " }}", r)
    return " ".join(text.split()).strip()


def sample_copy(template: dict, style: dict) -> dict:
    return {
        "headline": substitute(template.get("headline"), style) or "Sample real estate ad",
        "primary": substitute(template.get("primary_text"), style)
        or "A local, housing-safe sample ad written for this template.",
        "description": substitute(template.get("description"), style) or "Sample campaign preview",
        "cta": substitute(template.get("cta"), style) or "Learn more",
    }


def text_w(draw, text, fnt) -> int:
    b = draw.textbbox((0, 0), text, font=fnt)
    return b[2] - b[0]


def wrap(draw, text, fnt, max_width, max_lines) -> list:
    words = text.split()
    lines, current = [], ""
    for word in words:
        cand = f"{current} {word}".strip()
        if text_w(draw, cand, fnt) <= max_width:
            current = cand
        else:
            if current:
                lines.append(current)
            current = word
        if len(lines) == max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    lines = lines[:max_lines]
    if " ".join(lines).split() != words and lines:
        while text_w(draw, lines[-1] + "...", fnt) > max_width and " " in lines[-1]:
            lines[-1] = lines[-1].rsplit(" ", 1)[0]
        lines[-1] = lines[-1].rstrip(".,;:") + "..."
    return lines


def crop_fill(image, size):
    image = image.convert("RGB")
    sw, sh = image.size
    tw, th = size
    if sw / sh > tw / th:
        nw = int(sh * tw / th)
        left = (sw - nw) // 2
        image = image.crop((left, 0, left + nw, sh))
    else:
        nh = int(sw * th / tw)
        top = (sh - nh) // 2
        image = image.crop((0, top, sw, top + nh))
    return image.resize(size, Image.Resampling.LANCZOS)


def grade(photo, style):
    if style["priceFeel"] in ("affordable_entry", "cheap_and_cheerful"):
        photo = ImageEnhance.Color(photo).enhance(0.9)
    elif style["priceFeel"] in ("luxury_architectural", "premium_coastal"):
        photo = ImageEnhance.Contrast(photo).enhance(1.06)
        photo = ImageEnhance.Sharpness(photo).enhance(1.08)
    if style["visualStyle"] == "organic_agent_post":
        photo = ImageEnhance.Color(photo).enhance(0.97)
    return photo


def bottom_gradient(canvas, top_y, height, strength=205):
    grad = Image.new("RGBA", (W, height), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(height):
        gd.line([(0, y), (W, y)], fill=(0, 0, 0, int(strength * (y / height) ** 1.4)))
    canvas.paste(grad, (0, top_y), grad)


def draw_stars(d, x, y, size, colour, count=5):
    for s in range(count):
        cx = x + s * (size + 8) + size / 2
        cy = y + size / 2
        pts = []
        for i in range(10):
            r = size / 2 if i % 2 == 0 else size / 4.6
            a = -math.pi / 2 + i * math.pi / 5
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        d.polygon(pts, fill=colour)


_FACE_CACHE = {}


def detect_faces(image):
    """Return face boxes [(x, y, w, h)] in image coords using OpenCV Haar."""
    try:
        import cv2
        import numpy as np
    except Exception:
        return []
    rgb = image.convert("RGB")
    gray = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2GRAY)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6,
                                     minSize=(max(40, gray.shape[1] // 14), max(40, gray.shape[0] // 14)))
    return [tuple(int(v) for v in f) for f in faces]


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def smart_crop_with_faces(image, size, faces):
    """Crop to size while keeping detected faces fully in frame with headroom.

    Returns (cropped_image, faces_in_target_coords).
    """
    image = image.convert("RGB")
    sw, sh = image.size
    tw, th = size
    target = tw / th
    if not faces:
        return crop_fill(image, size), []

    fx0 = min(f[0] for f in faces)
    fy0 = min(f[1] for f in faces)
    fx1 = max(f[0] + f[2] for f in faces)
    fy1 = max(f[1] + f[3] for f in faces)
    fh = fy1 - fy0
    # headroom so the top of the head is never clipped
    fy0 = max(0, fy0 - int(fh * 0.7))
    fy1 = min(sh, fy1 + int(fh * 0.55))
    fcx = (fx0 + fx1) / 2
    fcy = (fy0 + fy1) / 2

    if sw / sh > target:
        nw, nh = int(sh * target), sh
    else:
        nw, nh = sw, int(sw / target)

    left = int(_clamp(fcx - nw / 2, 0, sw - nw))
    top = int(_clamp(fcy - nh / 2, 0, sh - nh))
    # guarantee the face band sits inside the crop window
    if fy0 < top:
        top = int(_clamp(fy0, 0, sh - nh))
    if fy1 > top + nh:
        top = int(_clamp(fy1 - nh, 0, sh - nh))
    if fx0 < left:
        left = int(_clamp(fx0, 0, sw - nw))
    if fx1 > left + nw:
        left = int(_clamp(fx1 - nw, 0, sw - nw))

    crop = image.crop((left, top, left + nw, top + nh)).resize(size, Image.Resampling.LANCZOS)
    sx, sy = tw / nw, th / nh
    mapped = [(int((x - left) * sx), int((y - top) * sy), int(w * sx), int(h * sy)) for (x, y, w, h) in faces]
    mapped = [f for f in mapped if f[0] + f[2] > 0 and f[1] + f[3] > 0 and f[0] < tw and f[1] < th]
    return crop, mapped


def load_source_with_faces(key, style, size):
    path = SOURCES_DIR / f"{key}.png"
    if not path.exists():
        return Image.new("RGB", size, palette_for(0)["accent"]), []
    src = Image.open(path)
    cache_key = (key, size)
    faces_src = _FACE_CACHE.get(key)
    if faces_src is None:
        faces_src = detect_faces(src)
        _FACE_CACHE[key] = faces_src
    cropped, faces_dst = smart_crop_with_faces(src, size, faces_src)
    return grade(cropped, style), faces_dst


def load_source(key, style, size):
    image, _ = load_source_with_faces(key, style, size)
    return image


def face_overlap(box, faces):
    """Fraction of a candidate box area that intersects any face box."""
    bx, by, bw, bh = box
    area = max(1, bw * bh)
    covered = 0
    for (fx, fy, fw, fh) in faces:
        ix0, iy0 = max(bx, fx), max(by, fy)
        ix1, iy1 = min(bx + bw, fx + fw), min(by + bh, fy + fh)
        if ix1 > ix0 and iy1 > iy0:
            covered += (ix1 - ix0) * (iy1 - iy0)
    return covered / area


def best_badge_center(faces, candidates, r):
    """Pick the candidate centre whose badge disc least overlaps faces."""
    best, best_score = candidates[0], 1e9
    for (cx, cy) in candidates:
        score = face_overlap((cx - r, cy - r, 2 * r, 2 * r), faces)
        if score < best_score:
            best, best_score = (cx, cy), score
    return best


def initials(name) -> str:
    return "".join(part[:1] for part in name.split()[:2]).upper() or "RE"


def _seed(key):
    h = 0
    for c in key:
        h = (h * 31 + ord(c)) & 0xffffffff
    return h


def stats_for(key):
    h = _seed(key)
    growth = ["+4.2%", "+5.1%", "+6.4%", "+7.8%", "+3.6%", "+8.9%"][h % 6]
    days = ["12", "18", "21", "9", "27", "15"][(h >> 3) % 6]
    buyers = ["28", "42", "36", "54", "19", "61"][(h >> 6) % 6]
    median = ["$612k", "$740k", "$892k", "$1.05m", "$560k", "$1.22m"][(h >> 9) % 6]
    return [(growth, "median value, 12 mo"), (days, "median days on market"),
            (buyers, "active buyers this month"), (median, "suburb median price")]


def pill(d, x, y, text, fnt, fg, bg, pad=18, radius=12) -> int:
    tw = text_w(d, text, fnt)
    d.rounded_rectangle([x, y, x + tw + pad * 2, y + fnt.size + pad], radius=radius, fill=bg)
    d.text((x + pad, y + pad // 2), text, font=fnt, fill=fg)
    return tw + pad * 2


# --- Meta feed chrome -------------------------------------------------------
FEED_HEADER_H = 132
FEED_CAPTION_H = 250
FEED_CTA_H = 96
FEED_FOOTER_H = 92


def feed_media_box():
    return FEED_HEADER_H, H - FEED_HEADER_H - FEED_CAPTION_H - FEED_CTA_H - FEED_FOOTER_H


def draw_feed_header(canvas, style, pal):
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, W, FEED_HEADER_H], fill=(255, 255, 255))
    d.ellipse([32, 28, 100, 96], fill=pal["accent"])
    f = font(24, True)
    ini = initials(style["agencyName"])
    b = d.textbbox((0, 0), ini, font=f)
    d.text((66 - (b[2] - b[0]) / 2, 62 - (b[3] - b[1]) / 2 - b[1]), ini, font=f, fill="white")
    d.text((120, 30), style["agencyName"], font=font(30, True), fill=(22, 26, 32))
    d.text((120, 72), f"Sponsored · {style['sampleSuburb']}, WA", font=font(22), fill=(110, 116, 124))
    d.text((1004, 26), "···", font=font(30, True), fill=(120, 126, 134))


def draw_feed_caption(canvas, style, copy, pal):
    d = ImageDraw.Draw(canvas)
    top = H - FEED_CAPTION_H - FEED_CTA_H - FEED_FOOTER_H
    d.rectangle([0, top, W, top + FEED_CAPTION_H], fill=(255, 255, 255))
    bf = font(25)
    y = top + 26
    for line in wrap(d, copy["primary"], bf, 1000, 4):
        d.text((40, y), line, font=bf, fill=(28, 32, 38))
        y += 36
    d.text((40, top + FEED_CAPTION_H - 40), "...See more", font=font(23), fill=(120, 126, 134))


def draw_feed_cta(canvas, style, copy, pal):
    d = ImageDraw.Draw(canvas)
    top = H - FEED_CTA_H - FEED_FOOTER_H
    d.rectangle([0, top, W, top + FEED_CTA_H], fill=(245, 246, 248))
    d.text((40, top + 20), style["agencyName"].upper()[:28], font=font(18, True), fill=(130, 136, 144))
    d.text((40, top + 46), copy["description"][:40], font=font(25, True), fill=(28, 32, 38))
    cta = copy["cta"][:22]
    f = font(23, True)
    bw = max(190, text_w(d, cta, f) + 60)
    d.rounded_rectangle([W - bw - 36, top + 24, W - 36, top + 72], radius=8, fill=BLUE_CTA)
    d.text((W - bw - 36 + (bw - text_w(d, cta, f)) / 2, top + 36), cta, font=f, fill="white")


def draw_feed_footer(canvas):
    d = ImageDraw.Draw(canvas)
    top = H - FEED_FOOTER_H
    d.rectangle([0, top, W, H], fill=(255, 255, 255))
    d.line([0, top, W, top], fill=(226, 229, 233), width=2)
    for x, label in [(150, "Like"), (520, "Comment"), (880, "Share")]:
        d.text((x, top + 32), label, font=font(23), fill=(120, 126, 134))


def feed_base(canvas, style, copy, pal):
    draw_feed_header(canvas, style, pal)
    draw_feed_caption(canvas, style, copy, pal)
    draw_feed_cta(canvas, style, copy, pal)
    draw_feed_footer(canvas)
    return feed_media_box()


def draw_agent_badge(canvas, style, x, y, pal):
    d = ImageDraw.Draw(canvas, "RGBA")
    w = 300
    d.rounded_rectangle([x, y, x + w, y + 92], radius=46, fill=(255, 255, 255, 240))
    d.ellipse([x + 12, y + 12, x + 80, y + 80], fill=pal["accent"])
    d.ellipse([x + 33, y + 26, x + 59, y + 52], fill=(231, 200, 170))
    d.pieslice([x + 22, y + 44, x + 70, y + 96], 180, 360, fill=(235, 238, 242))
    d.text((x + 96, y + 20), style["agentName"], font=font(23, True), fill=(26, 30, 36))
    d.text((x + 96, y + 52), "Local agent", font=font(19), fill=(120, 126, 134))


# --- Short corner tag derived from the template -----------------------------
def corner_tag(key, style):
    cat = key[:2]
    return {
        "JL": "JUST LISTED", "JS": "JUST SOLD", "OH": "OPEN SAT 10:30",
        "AU": "AUCTION", "ND": "NOW SELLING", "HV": "FREE APPRAISAL",
        "MU": "MARKET UPDATE", "BD": "IN DEMAND", "PM": "FOR LEASE",
        "IN": "INVESTOR", "AB": "MEET THE TEAM", "TS": "5-STAR REVIEW",
        "LM": "FREE GUIDE", "DS": "DOWNSIZE",
    }.get(cat, "FEATURED")


# === FEED-FAMILY LAYOUTS ====================================================
def lay_feed_minimal(canvas, key, style, copy, pal, idx):
    top, mh = feed_base(canvas, style, copy, pal)
    canvas.paste(load_source(key, style, (W, mh)), (0, top))
    d = ImageDraw.Draw(canvas, "RGBA")
    tag = corner_tag(key, style)
    f = font(26, True)
    tw = text_w(d, tag, f)
    d.rounded_rectangle([36, top + 30, 36 + tw + 44, top + 30 + 56], radius=10, fill=(0, 0, 0, 180))
    d.text((58, top + 44), tag, font=f, fill="white")


def lay_feed_headline(canvas, key, style, copy, pal, idx):
    top, mh = feed_base(canvas, style, copy, pal)
    canvas.paste(load_source(key, style, (W, mh)), (0, top))
    bottom_gradient(canvas, top + mh - 360, 360, 220)
    d = ImageDraw.Draw(canvas, "RGBA")
    hf = font(60, True)
    lines = wrap(d, copy["headline"], hf, 960, 3)
    y = top + mh - 70 - len(lines) * 66
    d.rectangle([40, y - 18, 40 + 8, y + len(lines) * 66 - 6], fill=pal["accent2"])
    for line in lines:
        d.text((66, y), line, font=hf, fill="white")
        y += 66


def lay_badge_overlay(canvas, key, style, copy, pal, idx):
    top, mh = feed_base(canvas, style, copy, pal)
    media, faces = load_source_with_faces(key, style, (W, mh))
    canvas.paste(media, (0, top))
    d = ImageDraw.Draw(canvas, "RGBA")
    word = "SOLD" if key.startswith("JS") else ("AUCTION" if key.startswith("AU") else "SOLD")
    r = 130
    faces_card = [(x, y + top, w, h) for (x, y, w, h) in faces]
    candidates = [(W - 210, top + 200), (250, top + 200), (W - 210, top + mh - 220), (250, top + mh - 220)]
    cx, cy = best_badge_center(faces_card, candidates, r)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*pal["accent"], 235), outline=pal["accent2"], width=6)
    f = font(48 if word == "SOLD" else 32, True)
    d.text((cx - text_w(d, word, f) / 2, cy - f.size / 2 - 14), word, font=f, fill="white")
    sf = font(20, True)
    sub = style["sampleSuburb"].upper()
    d.text((cx - text_w(d, sub, sf) / 2, cy + 20), sub, font=sf, fill=pal["accent2"])


def lay_agent_strip(canvas, key, style, copy, pal, idx):
    top, mh = feed_base(canvas, style, copy, pal)
    canvas.paste(load_source(key, style, (W, mh)), (0, top))
    d = ImageDraw.Draw(canvas, "RGBA")
    band_h = 150
    by = top + mh - band_h
    panel = Image.new("RGBA", (W, band_h), (*pal["accent"], 232))
    canvas.paste(panel, (0, by), panel)
    d.rectangle([0, by, W, by + 6], fill=pal["accent2"])
    d.text((48, by + 28), style["agentName"], font=font(42, True), fill="white")
    d.text((48, by + 86), f"{style['agencyName']} · {style['sampleSuburb']}", font=font(24), fill=(225, 230, 236))


def lay_framed_polaroid(canvas, key, style, copy, pal, idx):
    top, mh = feed_base(canvas, style, copy, pal)
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, top, W, top + mh], fill=(244, 241, 235))
    m = 70
    pw, ph = W - m * 2, mh - m * 2 - 70
    canvas.paste(load_source(key, style, (pw, ph)), (m, top + m - 20))
    d.rectangle([m - 6, top + m - 26, m + pw + 6, top + m - 20 + ph + 6], outline=(255, 255, 255), width=12)
    cf = font(34, True, serif=True)
    cap = wrap(d, copy["headline"], cf, pw, 1)[0]
    d.text((m, top + m - 20 + ph + 22), cap, font=cf, fill=(60, 54, 48))


def lay_testimonial(canvas, key, style, copy, pal, idx):
    top, mh = feed_base(canvas, style, copy, pal)
    media, faces = load_source_with_faces(key, style, (W, mh))
    canvas.paste(media, (0, top))
    shade = Image.new("RGBA", (W, mh), (10, 14, 22, 160))
    canvas.paste(shade, (0, top), shade)
    d = ImageDraw.Draw(canvas, "RGBA")
    cardw, cardh = 880, 360
    cx = (W - cardw) // 2
    # place the quote card in whichever vertical band has the fewest faces
    gap = 40
    slots = [top + gap, top + (mh - cardh) // 2, top + mh - cardh - gap]
    cyy = min(slots, key=lambda sy: face_overlap((cx, sy, cardw, cardh),
              [(x, y + top, w, h) for (x, y, w, h) in faces]))
    d.rounded_rectangle([cx, cyy, cx + cardw, cyy + cardh], radius=22, fill=(255, 255, 255, 248))
    draw_stars(d, cx + 50, cyy + 44, 38, pal["accent2"])
    qf = font(36, True, serif=True)
    quote = '"' + (copy["headline"] if len(copy["headline"]) < 70 else copy["description"]) + '"'
    y = cyy + 120
    for line in wrap(d, quote, qf, cardw - 100, 4):
        d.text((cx + 50, y), line, font=qf, fill=(30, 34, 42))
        y += 50
    d.text((cx + 50, cyy + cardh - 64), f"— A {style['sampleSuburb']} seller", font=font(26), fill=pal["accent"])


# === CREATIVE-FAMILY LAYOUTS (full 1080x1350) ===============================
def lay_poster_band(canvas, key, style, copy, pal, idx):
    photo_h = 820
    canvas.paste(load_source(key, style, (W, photo_h)), (0, 0))
    d = ImageDraw.Draw(canvas, "RGBA")
    accent = (200, 40, 48) if style["tone"] == "over_the_top_direct_response" or style["copyDensity"] == "full_sales_poster" and idx % 2 == 0 else pal["accent"]
    d.rectangle([0, photo_h, W, H], fill=accent)
    bottom_gradient(canvas, photo_h - 160, 160, 150)
    pill(d, 60, photo_h + 56, corner_tag(key, style), font(24, True), accent, pal["accent2"])
    hf = font(66, True)
    y = photo_h + 130
    for line in wrap(d, copy["headline"], hf, W - 120, 2):
        d.text((60, y), line, font=hf, fill="white")
        y += 72
    cf = font(28, True)
    cta = copy["cta"][:24]
    bw = text_w(d, cta, cf) + 80
    d.rounded_rectangle([60, H - 110, 60 + bw, H - 44], radius=12, fill="white")
    d.text((60 + 40, H - 96), cta, font=cf, fill=accent)


def lay_data_card(canvas, key, style, copy, pal, idx):
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, W, H], fill=pal["ink"])
    photo_h = 470
    canvas.paste(load_source(key, style, (W, photo_h)), (0, 0))
    bottom_gradient(canvas, photo_h - 200, 200, 200)
    d = ImageDraw.Draw(canvas, "RGBA")
    d.text((52, photo_h - 96), corner_tag(key, style), font=font(26, True), fill=pal["accent2"])
    d.text((52, photo_h - 58), f"{style['sampleSuburb']}, WA", font=font(40, True), fill="white")
    st = (style.get("persona") or {}).get("stats") or {}
    stats = [(st.get("growth_12m", "+6.4%") if str(st.get("growth_12m", "")).startswith("+") else "+" + st.get("growth_12m", "6.4%"), "median value, 12 mo"),
             (st.get("days", "18"), "median days on market"),
             (st.get("buyers", "42"), "active buyers this month"),
             (st.get("median", "$892k"), "suburb median price")] if st else stats_for(key)
    sy = photo_h + 56
    for i, (big, label) in enumerate(stats):
        col = 60 if i % 2 == 0 else 580
        row = sy + (i // 2) * 220
        d.text((col, row), big, font=font(92, True), fill="white")
        d.line([(col, row + 116), (col + 360, row + 116)], fill=pal["accent2"], width=3)
        d.text((col, row + 128), label, font=font(25), fill=(206, 214, 224))
    d.text((60, H - 70), copy["cta"][:40].upper(), font=font(26, True), fill=pal["accent2"])


def lay_magazine_split(canvas, key, style, copy, pal, idx):
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, W, H], fill=(246, 243, 238))
    pw = 560
    canvas.paste(load_source(key, style, (pw, H)), (W - pw, 0))
    d = ImageDraw.Draw(canvas, "RGBA")
    d.rectangle([0, 0, 70, H], fill=pal["accent"])
    tx = 110
    d.text((tx, 150), corner_tag(key, style), font=font(24, True), fill=pal["accent"])
    d.line([(tx, 196), (tx + 60, 196)], fill=pal["accent2"], width=4)
    hf = font(58, True, serif=True)
    y = 240
    for line in wrap(d, copy["headline"], hf, W - pw - tx - 50, 4):
        d.text((tx, y), line, font=hf, fill=pal["ink"])
        y += 70
    bf = font(25, serif=True)
    y += 20
    for line in wrap(d, copy["primary"], bf, W - pw - tx - 50, 6):
        d.text((tx, y), line, font=bf, fill=(70, 66, 60))
        y += 38
    cta = copy["cta"][:24]
    cf = font(25, True)
    d.rounded_rectangle([tx, H - 150, tx + text_w(d, cta, cf) + 70, H - 96], radius=10, fill=pal["accent"])
    d.text((tx + 35, H - 138), cta, font=cf, fill="white")


def lay_report_cover(canvas, key, style, copy, pal, idx):
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, W, H], fill=pal["ink"])
    d.text((60, 80), style["agencyName"].upper(), font=font(26, True), fill=pal["accent2"])
    hf = font(70, True, serif=True)
    y = 150
    title = copy["description"] if len(copy["description"]) > 8 else copy["headline"]
    for line in wrap(d, title, hf, W - 120, 3):
        d.text((60, y), line, font=hf, fill="white")
        y += 80
    py = y + 30
    ph = H - py - 200
    canvas.paste(load_source(key, style, (W - 120, ph)), (60, py))
    d = ImageDraw.Draw(canvas, "RGBA")
    d.rectangle([60, H - 150, W - 60, H - 70], fill=pal["accent"])
    d.text((84, H - 134), f"{style['sampleSuburb']} · Q2 2026 market report", font=font(28, True), fill="white")


def lay_guide_mockup(canvas, key, style, copy, pal, idx):
    bg = load_source(key, style, (W, H)).filter(ImageFilter.GaussianBlur(14))
    canvas.paste(bg, (0, 0))
    shade = Image.new("RGBA", (W, H), (*pal["ink"], 150))
    canvas.paste(shade, (0, 0), shade)
    d = ImageDraw.Draw(canvas, "RGBA")
    bw, bh = 540, 760
    bx, by = (W - bw) // 2, 210
    d.rectangle([bx + 18, by + 22, bx + bw + 18, by + bh + 22], fill=(0, 0, 0, 90))
    d.rectangle([bx, by, bx + bw, by + bh], fill="white")
    # headline band sized to fit the wrapped title (no clipping)
    hf = font(33, True, serif=True)
    lines = wrap(d, copy["headline"], hf, bw - 72, 3)
    band_h = 70 + len(lines) * 42 + 14
    d.rectangle([bx, by, bx + bw, by + band_h], fill=pal["accent"])
    d.text((bx + 36, by + 26), "FREE GUIDE", font=font(22, True), fill=pal["accent2"])
    yy = by + 64
    for line in lines:
        d.text((bx + 36, yy), line, font=hf, fill="white")
        yy += 42
    cover_y = by + band_h + 16
    cover_h = 274
    canvas.paste(load_source(key, style, (bw - 72, cover_h)), (bx + 36, cover_y))
    ly = cover_y + cover_h + 22
    for item in ["Local pricing checklist", "Timing & presentation tips", "What buyers want now"]:
        d.ellipse([bx + 36, ly + 6, bx + 56, ly + 26], outline=pal["accent"], width=3)
        d.text((bx + 70, ly), item, font=font(23), fill=(40, 44, 52))
        ly += 44
    d.text((bx + 36, by + bh - 52), copy["cta"][:30].upper(), font=font(23, True), fill=pal["accent"])


def lay_full_bleed_clean(canvas, key, style, copy, pal, idx):
    canvas.paste(load_source(key, style, (W, H)), (0, 0))
    d = ImageDraw.Draw(canvas, "RGBA")
    bottom_gradient(canvas, H - 220, 220, 150)
    d.ellipse([48, 48, 104, 104], outline="white", width=3)
    f = font(22, True)
    ini = initials(style["agencyName"])
    b = d.textbbox((0, 0), ini, font=f)
    d.text((76 - (b[2] - b[0]) / 2, 76 - (b[3] - b[1]) / 2 - b[1]), ini, font=f, fill="white")
    d.text((120, 60), style["agencyName"].upper(), font=font(26, True), fill="white")
    d.text((48, H - 90), corner_tag(key, style), font=font(28, True), fill="white")


LAYOUTS = {
    "feed_minimal": lay_feed_minimal, "feed_headline": lay_feed_headline,
    "badge_overlay": lay_badge_overlay, "agent_strip": lay_agent_strip,
    "framed_polaroid": lay_framed_polaroid, "testimonial": lay_testimonial,
    "poster_band": lay_poster_band, "data_card": lay_data_card,
    "magazine_split": lay_magazine_split, "report_cover": lay_report_cover,
    "guide_mockup": lay_guide_mockup, "full_bleed_clean": lay_full_bleed_clean,
}


# --- Orchestration ----------------------------------------------------------
def render_card(key, template, style, index, out_dir):
    copy = sample_copy(template, style)
    pal = palette_for(index)
    canvas = Image.new("RGB", (W, H), (255, 255, 255))
    layout = style.get("layout", "feed_headline")
    LAYOUTS.get(layout, lay_feed_headline)(canvas, key, style, copy, pal, index)
    out_path = out_dir / sample_path(key)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG", optimize=True)
    return out_path


def load_seed(seed_path):
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    templates = seed.get("templates")
    if not isinstance(templates, list):
        raise SystemExit("Seed file must contain templates[].")
    return {str(t.get("template_key")): t for t in templates}


def load_styles():
    return json.loads(STYLES_PATH.read_text(encoding="utf-8"))


def render_all(out_dir):
    require_pillow()
    styles = load_styles()
    templates = load_seed(DEFAULT_SEED)
    for index, (key, style) in enumerate(styles.items()):
        template = templates.get(key, {})
        render_card(key, template, style, index, out_dir)
    return styles


def verify_outputs(out_dir):
    require_pillow()
    styles = load_styles()
    templates = load_seed(DEFAULT_SEED)
    missing, bad, unresolved = [], [], []
    for key, style in styles.items():
        copy = sample_copy(templates.get(key, {}), style)
        if any("{{" in v or "}}" in v for v in copy.values()):
            unresolved.append(key)
        path = out_dir / sample_path(key)
        if not path.exists():
            missing.append(str(path))
            continue
        with Image.open(path) as image:
            if image.size != (W, H):
                bad.append(f"{path}: {image.size}")
    problems = []
    if missing:
        problems += ["Missing:"] + missing
    if bad:
        problems += ["Bad size:"] + bad
    if unresolved:
        problems += ["Unresolved variables:"] + unresolved
    if problems:
        raise SystemExit("\n".join(problems))
    # distinct layouts must be used
    layouts = {style.get("layout") for style in styles.values()}
    if len(layouts) < 8:
        raise SystemExit(f"Only {len(layouts)} distinct layouts used.")
    print(f"Verified {len(styles)} cards, {len(layouts)} distinct layouts: {sorted(layouts)}")


def upload_outputs(out_dir):
    base = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip().lstrip("﻿").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if key:
        key = key.strip().lstrip("﻿")
    if not base or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to upload.")
    styles = load_styles()
    for key_name in styles:
        object_path = sample_path(key_name)
        local = out_dir / object_path
        url = f"{base}/storage/v1/object/{BUCKET}/{'/'.join(quote(p) for p in object_path.split('/'))}"
        req = Request(url, data=local.read_bytes(), method="POST", headers={
            "Authorization": f"Bearer {key}", "apikey": key,
            "Content-Type": "image/png", "x-upsert": "true"})
        with urlopen(req, timeout=60) as resp:
            if resp.status >= 300:
                raise SystemExit(f"Upload failed for {object_path}: HTTP {resp.status}")
    print(f"Uploaded {len(styles)} cards to {BUCKET}/{PREFIX}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args()
    if not args.verify_only:
        render_all(args.out_dir)
    verify_outputs(args.out_dir)
    if args.upload:
        upload_outputs(args.out_dir)
    print(json.dumps({"outDir": str(args.out_dir), "verified": True}))


if __name__ == "__main__":
    main()
