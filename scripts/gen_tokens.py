#!/usr/bin/env python3
"""
Generate ``frontend/src/theme/tokens.css`` from the Python ``THEME`` palette.

Why generated rather than hand-written
--------------------------------------
The palette in :data:`call_forecast.dashboard.THEME` is audited: the hues were
checked for contrast in both modes, and the project rules say to re-validate if
any of them change. Hand-copying those values into a stylesheet would create a
second place for them to live and a silent way for the two renderers to drift
apart — the React dashboard would look *almost* like the Python one, which is
worse than looking obviously different.

So this script is the only writer of ``tokens.css``, and
``tests/test_tokens.py`` fails if the checked-in file no longer matches what
this would produce. Change a hue in ``THEME``, re-run this, commit both.

Usage
-----
    python scripts/gen_tokens.py           # write the file
    python scripts/gen_tokens.py --check   # exit 1 if it is out of date
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Mapping

# Importing the package rather than duplicating the palette is the whole point.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from call_forecast.dashboard import THEME  # noqa: E402

#: Where the generated stylesheet lands, relative to the repository root.
TARGET = Path("frontend") / "src" / "theme" / "tokens.css"

#: Layout constants that live alongside the colours. These are not part of the
#: audited palette, but they belong in the same ``:root`` block and are carried
#: over verbatim from the Python stylesheet so the two layouts agree.
LAYOUT_TOKENS = {
    "radius": "10px",
    "maxw": "1420px",
    "rail": "248px",
}

BANNER = (
    "/* GENERATED FILE - do not edit.\n"
    " * Written by scripts/gen_tokens.py from call_forecast.dashboard.THEME.\n"
    " * Edit the palette there and re-run the script; tests/test_tokens.py\n"
    " * fails if this file drifts out of sync.\n"
    " */"
)


def _variables(theme: Mapping[str, object], indent: str = "  ") -> str:
    """
    Render one theme dict as CSS custom properties.

    String entries become ``--name``. The ``seq`` ramp is a list, and is
    expanded to ``--seq-0`` .. ``--seq-6`` so the heatmap can index it directly
    from CSS rather than reaching back into JavaScript for its colours.
    """
    lines = []
    for key, value in theme.items():
        if isinstance(value, str):
            lines.append(f"{indent}--{key}: {value};")
    for key, value in theme.items():
        if isinstance(value, (list, tuple)):
            for i, step in enumerate(value):
                lines.append(f"{indent}--{key}-{i}: {step};")
    return "\n".join(lines)


def render() -> str:
    """Build the full stylesheet text."""
    light, dark = THEME["light"], THEME["dark"]
    layout = "\n".join(f"  --{k}: {v};" for k, v in LAYOUT_TOKENS.items())

    # The cascade mirrors the Python stylesheet exactly:
    #   1. :root carries light as the base.
    #   2. the media query flips to dark *only* when the viewer has not pinned
    #      light, so following the OS needs no JavaScript and no flash.
    #   3. an explicit [data-theme="dark"] wins over both.
    return f"""{BANNER}

:root {{
  color-scheme: light;
{_variables(light)}
{layout}
}}

@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    color-scheme: dark;
{_variables(dark, indent="    ")}
  }}
}}

:root[data-theme="dark"] {{
  color-scheme: dark;
{_variables(dark)}
}}
"""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true",
        help="verify the checked-in file is current instead of writing it",
    )
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parent.parent
    path = root / TARGET
    expected = render()

    if args.check:
        if not path.exists():
            print(f"{TARGET} is missing; run python scripts/gen_tokens.py")
            return 1
        if path.read_text(encoding="utf-8") != expected:
            print(f"{TARGET} is out of date; run python scripts/gen_tokens.py")
            return 1
        print(f"{TARGET} is up to date.")
        return 0

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(expected, encoding="utf-8")
    print(f"Wrote {TARGET} ({len(expected)} bytes).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
