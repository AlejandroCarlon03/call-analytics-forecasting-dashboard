#!/usr/bin/env python3
"""
Enforce the 2 MB budget on the generated React dashboard.

Why this exists separately from ``sync_template.py``
----------------------------------------------------
``sync_template.py`` guards the *template* — the compiled frontend, at
1,700,000 bytes. That is a proxy budget. The number that actually matters is
the size of ``reports/dashboard.html``, which is the template **plus the run
payload**, and which has to stay mailable and openable from ``file://``. The
budget is 2 MB, and the current headroom is thin: PR 6 measured 1.95 MB on the
210-day sample.

The honest way to measure that is to run the pipeline, and the test suite does
exactly that — ``tests/test_react_dashboard.py::
TestSizeBudget::test_generated_dashboard_stays_under_budget`` renders a real
dashboard from a trimmed run and asserts the file is under 2 MB. That check
costs minutes, because it fits models.

This script is the cheap counterpart, for the CI job that has a fresh frontend
build but no Python dependencies and no time to fit anything. Rendering is a
single string substitution (see ``dashboard.build_dashboard_react``), so the
generated size is *arithmetic*: template, minus the marker, plus the script
wrapper, plus the serialised payload. Substituting the committed 210-day sample
payload therefore projects the real number for the largest data set the project
has, without running anything.

The two checks are complementary, not redundant: this one runs on every PR in
seconds against the newly built bundle and catches a dependency that bloats
Plotly or React; the pytest one runs against a real payload and catches the
serialiser growing.

Usage
-----
    python scripts/check_bundle_size.py                  # project from the build
    python scripts/check_bundle_size.py reports/dashboard.html   # measure a real one
    python scripts/check_bundle_size.py --budget 2000000
"""

from __future__ import annotations

import argparse
from pathlib import Path

#: The hard limit on the generated dashboard, in bytes. Chosen in PR 6: it is
#: what keeps the report attachable to an email and quick to open from
#: ``file://``. ``sync_template.TEMPLATE_BUDGET_BYTES`` (1.7 MB) is the tighter
#: proxy on the template alone; the difference is the payload's room.
DASHBOARD_BUDGET_BYTES = 2_000_000

#: Preferred source for the projection: the artefact the frontend job just
#: built. Falls back to the committed template, so the script is also useful on
#: a checkout with no Node.
BUILT_BUNDLE = Path("frontend") / "dist" / "index.html"
COMMITTED_TEMPLATE = Path("call_forecast") / "assets" / "dashboard_template.html"

#: The largest payload the project has: the 210-day synthetic sample, committed
#: for the dev server. Using it means the projection is a worst case rather
#: than a flattering one — the real 71-day export serialises to about half.
SAMPLE_PAYLOAD = Path("frontend") / "src" / "data" / "fixtures" / "dashboard_data.json"

#: Kept in step with ``dashboard.PAYLOAD_MARKER`` and the wrapper
#: ``build_dashboard_react`` substitutes for it.
MARKER = "<!--dashboard-data-->"
SCRIPT_OPEN = '<script id="dashboard-data" type="application/json">'
SCRIPT_CLOSE = "</script>"


def _size(path: Path) -> int:
    """Byte length of a file's UTF-8 content, with newlines left alone."""
    return len(path.read_bytes())


def _report(label: str, size: int, budget: int, breakdown: list[str]) -> int:
    """Print the verdict. Returns the process exit code."""
    if size <= budget:
        headroom = budget - size
        print(f"{label}: {size:,} bytes of {budget:,} ({headroom:,} bytes of headroom).")
        for line in breakdown:
            print(f"    {line}")
        return 0

    # Never fail silently, and never fail with only a number: the person
    # reading this in a CI log needs to know what to do next.
    print(
        f"Dashboard bundle exceeds the {budget / 1e6:.2f} MB limit. "
        f"Review dependencies or Plotly bundle size.\n"
        f"\n"
        f"  {label}\n"
        f"  current size: {size:,} bytes ({size / 1e6:.2f} MB)\n"
        f"  allowed size: {budget:,} bytes ({budget / 1e6:.2f} MB)\n"
        f"  over by:      {size - budget:,} bytes\n"
    )
    for line in breakdown:
        print(f"  {line}")
    print(
        "\n"
        "Likely causes, most common first:\n"
        "  - a new frontend dependency was added, or an existing one grew;\n"
        "  - the Plotly bundle changed. It is ~85% of the template (1.42 MB of\n"
        "    1.67 MB). The lever here is a custom partial bundle\n"
        "    (plotly.js/lib/core + scatter/bar/heatmap, roughly half the size),\n"
        "    which also means revisiting src/types/plotly.d.ts;\n"
        "  - the payload grew. Trimming it is the wrong move - it is the\n"
        "    contract the frontend is written against. Shrink the bundle.\n"
        "\n"
        "See SESSION_CONTEXT.md section 8 for the size history and the budget's rationale."
    )
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "path", nargs="?", type=Path,
        help="a generated dashboard to measure directly (e.g. reports/dashboard.html). "
             "Omitted, the size is projected from the frontend build plus the "
             "committed sample payload.",
    )
    parser.add_argument(
        "--budget", type=int, default=DASHBOARD_BUDGET_BYTES,
        help=f"limit in bytes (default {DASHBOARD_BUDGET_BYTES:,})",
    )
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parent.parent

    if args.path is not None:
        path = args.path if args.path.is_absolute() else root / args.path
        if not path.exists():
            print(f"{args.path} does not exist. Generate it with: python -m call_forecast run")
            return 1
        return _report(str(args.path), _size(path), args.budget, [])

    template = root / BUILT_BUNDLE
    origin = BUILT_BUNDLE
    if not template.exists():
        template, origin = root / COMMITTED_TEMPLATE, COMMITTED_TEMPLATE
        if not template.exists():
            print(
                f"Neither {BUILT_BUNDLE} nor {COMMITTED_TEMPLATE} exists; "
                f"run: cd frontend && npm ci && npm run build"
            )
            return 1

    payload = root / SAMPLE_PAYLOAD
    if not payload.exists():
        print(f"{SAMPLE_PAYLOAD} is missing; it is committed and should be in the checkout.")
        return 1

    template_bytes, payload_bytes = _size(template), _size(payload)
    wrapper = len(SCRIPT_OPEN) + len(SCRIPT_CLOSE) - len(MARKER)
    projected = template_bytes + payload_bytes + wrapper

    breakdown = [
        f"template ({origin}): {template_bytes:,} bytes",
        f"payload  ({SAMPLE_PAYLOAD}): {payload_bytes:,} bytes",
        "projected by substitution, the way build_dashboard_react() renders.",
    ]
    return _report("projected reports/dashboard.html", projected, args.budget, breakdown)


if __name__ == "__main__":
    raise SystemExit(main())
