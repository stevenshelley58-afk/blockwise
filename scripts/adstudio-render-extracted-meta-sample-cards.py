#!/usr/bin/env python3
"""Compatibility wrapper for the TemplateDesign gallery renderer.

The gallery samples must be produced by the same TemplateDesign renderer the
editor uses. Keep this Python entrypoint for older operator commands, but route
all work through the canonical Node renderer.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE_RENDERER = ROOT / "scripts" / "adstudio-render-extracted-meta-sample-cards.mjs"


def main() -> int:
    return subprocess.call(
        [
            "node",
            "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
            str(NODE_RENDERER),
            *sys.argv[1:],
        ],
        cwd=ROOT,
    )


if __name__ == "__main__":
    raise SystemExit(main())
