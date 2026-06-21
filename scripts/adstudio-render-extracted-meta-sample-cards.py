#!/usr/bin/env python3
"""Render public Meta-style sample cards for the extracted Ad Studio templates."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DESCRIPTORS_PATH = ROOT / "src" / "lib" / "adstudio" / "extracted-meta-templates.generated.ts"
OUT_DIR = ROOT / "public" / "adstudio-samples" / "extracted-meta"
PHOTO_SOURCES = [
    ROOT / "public" / "ads" / "ad-coastline.jpg",
    ROOT / "public" / "ads" / "ad-hillco.jpg",
    ROOT / "public" / "ads" / "ad-hillview.jpg",
    ROOT / "public" / "ads" / "ad-northstar.jpg",
]

W, H = 1080, 1350
HEADER_H = 128
CAPTION_H = 164
MEDIA_H = 778
CTA_H = 112
FOOTER_H = H - HEADER_H - CAPTION_H - MEDIA_H - CTA_H

CANVAS_BY_FORMAT = {
    "4:5": (1080, 1350),
    "1:1": (1080, 1080),
    "9:16": (1080, 1920),
}

FONT_PATHS = {
    "regular": ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"],
    "bold": ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"],
}
FONT_CACHE: dict[tuple[int, bool], Any] = {}


def font(size: int, bold: bool = False):
    key = (size, bold)
    if key in FONT_CACHE:
        return FONT_CACHE[key]
    for path in FONT_PATHS["bold" if bold else "regular"]:
        if Path(path).exists():
            FONT_CACHE[key] = ImageFont.truetype(path, size)
            return FONT_CACHE[key]
    FONT_CACHE[key] = ImageFont.load_default()
    return FONT_CACHE[key]


def descriptors() -> list[dict[str, Any]]:
    text = DESCRIPTORS_PATH.read_text(encoding="utf-8")
    start = text.index("[", text.index("EXTRACTED_META_TEMPLATE_DESCRIPTORS"))
    end = text.index("\n] as const;", start) + 2
    return json.loads(text[start:end])


def hex_to_rgb(value: str, fallback: tuple[int, int, int] = (11, 23, 32)) -> tuple[int, int, int]:
    value = value.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", value):
        return fallback
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))


def text_width(draw: ImageDraw.ImageDraw, text: str, fnt: Any) -> int:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0]


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt: Any, max_width: int, max_lines: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if text_width(draw, candidate, fnt) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    if lines and " ".join(lines).split() != words:
        while text_width(draw, lines[-1] + "...", fnt) > max_width and " " in lines[-1]:
            lines[-1] = lines[-1].rsplit(" ", 1)[0]
        lines[-1] = lines[-1].rstrip(".,;:") + "..."
    return lines or [""]


def crop_fill(image: Image.Image, size: tuple[int, int]) -> Image.Image:
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


def photo(index: int, size: tuple[int, int]) -> Image.Image:
    path = PHOTO_SOURCES[index % len(PHOTO_SOURCES)]
    img = crop_fill(Image.open(path), size)
    img = ImageEnhance.Color(img).enhance(0.98)
    img = ImageEnhance.Contrast(img).enhance(1.04)
    return img


def initials(value: str) -> str:
    parts = [part[0] for part in value.split()[:2] if part]
    return "".join(parts).upper() or "BW"


def draw_header(card: Image.Image, descriptor: dict[str, Any], primary: tuple[int, int, int]) -> None:
    style = descriptor["sampleStyle"]
    draw = ImageDraw.Draw(card)
    draw.rectangle([0, 0, W, HEADER_H], fill=(255, 255, 255))
    draw.ellipse([34, 30, 98, 94], fill=primary)
    ini = initials(style["agencyName"])
    fnt = font(23, True)
    box = draw.textbbox((0, 0), ini, font=fnt)
    draw.text((66 - (box[2] - box[0]) / 2, 62 - (box[3] - box[1]) / 2 - box[1]), ini, font=fnt, fill="white")
    draw.text((120, 30), style["agencyName"], font=font(30, True), fill=(20, 24, 32))
    draw.text((120, 72), f"Sponsored / {style['sampleSuburb']}, WA", font=font(22), fill=(104, 112, 124))
    draw.text((1004, 25), "...", font=font(34, True), fill=(104, 112, 124))


def draw_caption(card: Image.Image, descriptor: dict[str, Any]) -> None:
    copy = descriptor["sampleCopy"]
    draw = ImageDraw.Draw(card)
    y0 = HEADER_H
    draw.rectangle([0, y0, W, y0 + CAPTION_H], fill=(255, 255, 255))
    y = y0 + 24
    for line in wrap(draw, copy["primaryText"], font(26), W - 80, 3):
        draw.text((40, y), line, font=font(26), fill=(28, 32, 38))
        y += 36
    draw.text((40, y0 + CAPTION_H - 36), "See more", font=font(22), fill=(92, 98, 112))


def draw_footer(card: Image.Image, descriptor: dict[str, Any]) -> None:
    copy = descriptor["sampleCopy"]
    style = descriptor["sampleStyle"]
    draw = ImageDraw.Draw(card)
    y0 = HEADER_H + CAPTION_H + MEDIA_H
    draw.rectangle([0, y0, W, y0 + CTA_H], fill=(244, 246, 248))
    draw.text((40, y0 + 21), style["agencyName"].upper()[:34], font=font(18, True), fill=(118, 126, 138))
    draw.text((40, y0 + 51), copy["description"][:48], font=font(25, True), fill=(28, 32, 38))
    cta = copy["cta"][:24]
    cta_f = font(23, True)
    bw = max(194, text_width(draw, cta, cta_f) + 58)
    draw.rounded_rectangle([W - bw - 36, y0 + 28, W - 36, y0 + 78], radius=8, fill=(24, 119, 242))
    draw.text((W - bw - 36 + (bw - text_width(draw, cta, cta_f)) / 2, y0 + 41), cta, font=cta_f, fill="white")

    fy = y0 + CTA_H
    draw.rectangle([0, fy, W, H], fill=(255, 255, 255))
    draw.line([0, fy, W, fy], fill=(226, 229, 233), width=2)
    for x, label in [(150, "Like"), (510, "Comment"), (870, "Share")]:
        draw.text((x, fy + 31), label, font=font(23), fill=(118, 126, 138))


def paste_creative(card: Image.Image, descriptor: dict[str, Any], index: int) -> None:
    native = descriptor["nativeFormat"]
    cw, ch = CANVAS_BY_FORMAT.get(native, CANVAS_BY_FORMAT["4:5"])
    palette = [hex_to_rgb(value) for value in descriptor["palette"]]
    primary = palette[0]
    accent = next((colour for colour in palette[1:] if colour != (255, 255, 255)), (231, 178, 75))
    creative = Image.new("RGB", (cw, ch), primary)
    draw = ImageDraw.Draw(creative, "RGBA")

    for photo_index, source_rect in enumerate(descriptor["photoRects"][:3]):
        x = int(source_rect["x"] * cw)
        y = int(source_rect["y"] * ch)
        w = max(1, int(source_rect["w"] * cw))
        h = max(1, int(source_rect["h"] * ch))
        creative.paste(photo(index + photo_index, (w, h)), (x, y))

    panel = descriptor["panelRect"]
    px = int(panel["x"] * cw)
    py = int(panel["y"] * ch)
    pw = int(panel["w"] * cw)
    ph = int(panel["h"] * ch)
    draw.rounded_rectangle([px, py, px + pw, py + ph], radius=max(18, int(cw * 0.026)), fill=(7, 17, 28, 224))

    style = descriptor["sampleStyle"]
    copy = descriptor["sampleCopy"]
    logo_f = font(max(22, int(cw * 0.025)), True)
    draw.text((int(cw * 0.06), int(ch * 0.045)), style["agencyName"].lower(), font=logo_f, fill=(255, 255, 255))

    inset = max(24, int(pw * 0.075))
    tx = px + inset
    tw = pw - inset * 2
    y = py + max(24, int(ph * 0.11))
    eye = f"{descriptor['id'].replace('_', ' ')} / {descriptor['kind'].replace('_', ' ')}".upper()
    draw.text((tx, y), eye, font=font(max(16, int(cw * 0.021)), True), fill=accent)
    y += max(38, int(ph * 0.16))
    headline_f = font(max(34, int(cw * (0.048 if native != "9:16" else 0.052))), True)
    for line in wrap(draw, copy["headline"], headline_f, tw, 2):
        draw.text((tx, y), line, font=headline_f, fill=(255, 255, 255))
        y += int(headline_f.size * 1.08)
    body_f = font(max(20, int(cw * 0.024)))
    for line in wrap(draw, copy["primaryText"], body_f, tw, 2):
        draw.text((tx, y + 6), line, font=body_f, fill=(215, 226, 234))
        y += int(body_f.size * 1.18)

    addr_f = font(max(18, int(cw * 0.021)), True)
    draw.text((tx, py + ph - max(54, int(ph * 0.18))), style["address"][:42], font=addr_f, fill=(244, 247, 250))
    cta = copy["cta"][:24]
    cta_f = font(max(17, int(cw * 0.02)), True)
    bw = min(int(tw * 0.42), max(int(cw * 0.18), text_width(draw, cta, cta_f) + int(cw * 0.05)))
    bx = px + pw - inset - bw
    by = py + ph - max(62, int(ph * 0.2))
    draw.rounded_rectangle([bx, by, bx + bw, by + max(40, int(ch * 0.03))], radius=999, fill=accent)
    draw.text((bx + (bw - text_width(draw, cta, cta_f)) / 2, by + max(9, int(ch * 0.006))), cta, font=cta_f, fill=(11, 23, 32))

    media_y = HEADER_H + CAPTION_H
    media = Image.new("RGB", (W, MEDIA_H), (238, 242, 247))
    scale = min((W - 56) / cw, (MEDIA_H - 32) / ch)
    rw = int(cw * scale)
    rh = int(ch * scale)
    resized = creative.resize((rw, rh), Image.Resampling.LANCZOS)
    media.paste(resized, ((W - rw) // 2, (MEDIA_H - rh) // 2))
    card.paste(media, (0, media_y))


def render_card(descriptor: dict[str, Any], index: int, out_dir: Path) -> Path:
    palette = [hex_to_rgb(value) for value in descriptor["palette"]]
    card = Image.new("RGB", (W, H), (255, 255, 255))
    draw_header(card, descriptor, palette[0])
    draw_caption(card, descriptor)
    paste_creative(card, descriptor, index)
    draw_footer(card, descriptor)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{descriptor['id']}.png"
    card.save(out, "PNG", optimize=True)
    return out


def verify(out_dir: Path, expected: list[dict[str, Any]]) -> None:
    missing: list[str] = []
    bad: list[str] = []
    for descriptor in expected:
        path = out_dir / f"{descriptor['id']}.png"
        if not path.exists():
            missing.append(str(path))
            continue
        with Image.open(path) as image:
            if image.size != (W, H):
                bad.append(f"{path}: {image.size}")
    if missing or bad:
        raise SystemExit("\n".join(["Missing:", *missing, "Bad size:", *bad]))
    print(f"Verified {len(expected)} extracted Meta sample cards in {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    items = descriptors()
    if not args.verify_only:
        for index, descriptor in enumerate(items):
            render_card(descriptor, index, args.out_dir)
    verify(args.out_dir, items)


if __name__ == "__main__":
    main()
