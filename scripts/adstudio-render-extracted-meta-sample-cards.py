#!/usr/bin/env python3
"""Render source-faithful gallery cards for the extracted Ad Studio templates.

The gallery sample should show the extracted ad creative the template came from.
It should not wrap that creative in another Facebook/Instagram frame, and it
should not rebuild it from coarse rectangle metadata. The editable template
still uses TemplateDesign layers; these public PNGs are just picker thumbnails.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DESCRIPTORS_PATH = ROOT / "src" / "lib" / "adstudio" / "extracted-meta-templates.generated.ts"
SOURCE_ROOT = ROOT / "meta_ad_candidates"
OUT_DIR = ROOT / "public" / "adstudio-samples" / "extracted-meta"


def load_descriptors() -> list[dict[str, Any]]:
    text = DESCRIPTORS_PATH.read_text(encoding="utf-8")
    start = text.index("[", text.index("EXTRACTED_META_TEMPLATE_DESCRIPTORS"))
    end = text.index("\n] as const;", start) + 2
    return json.loads(text[start:end])


def render_card(descriptor: dict[str, Any], out_dir: Path) -> Path:
    source = SOURCE_ROOT / descriptor["sourceFile"]
    if not source.exists():
        raise SystemExit(f"Missing extracted source image: {source}")

    image = Image.open(source).convert("RGB")
    expected = descriptor["imageSize"]
    if image.size != (expected["w"], expected["h"]):
        raise SystemExit(f"{source} is {image.size}, expected {(expected['w'], expected['h'])}")

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{descriptor['id']}.png"
    image.save(out, "PNG", optimize=True)
    return out


def verify(out_dir: Path, descriptors: list[dict[str, Any]]) -> None:
    missing: list[str] = []
    bad: list[str] = []

    for descriptor in descriptors:
        path = out_dir / f"{descriptor['id']}.png"
        if not path.exists():
            missing.append(str(path))
            continue

        with Image.open(path) as image:
            expected = descriptor["imageSize"]
            expected_size = (expected["w"], expected["h"])
            if image.size != expected_size:
                bad.append(f"{path}: {image.size}, expected {expected_size}")

    if missing or bad:
        problems = []
        if missing:
            problems += ["Missing:"] + missing
        if bad:
            problems += ["Bad size:"] + bad
        raise SystemExit("\n".join(problems))

    print(f"Verified {len(descriptors)} source-faithful extracted Meta gallery cards in {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    descriptors = load_descriptors()
    if not args.verify_only:
        for descriptor in descriptors:
            render_card(descriptor, args.out_dir)
    verify(args.out_dir, descriptors)


if __name__ == "__main__":
    main()
