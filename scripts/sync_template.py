#!/usr/bin/env python3
"""
Copy the built React dashboard into the Python package.

Why the build artefact is committed
-----------------------------------
End users ``pip install`` this package and run the CLI. They do not have Node,
and the wheel does not carry the frontend source, so the single-file React
build has to be in the package already. That makes
``call_forecast/assets/dashboard_template.html`` a generated file that lives in
version control - the one arrangement that reliably goes stale.

The failure mode is specific and quiet: someone changes a component, runs the
dev server, sees it work, and commits without rebuilding. Every later
``--react-dashboard`` run then renders the *previous* frontend, and nothing
anywhere reports a problem. This project has been bitten by exactly this
before, in a different repository, with a deployment package that was months
behind its source.

So this script is the only writer of the template, and ``--check`` verifies the
committed copy matches what the current ``frontend/dist`` would produce. The
arrangement deliberately mirrors ``scripts/gen_tokens.py``, which solves the
same problem for ``tokens.css``: one generator, one ``--check``, one test.

Usage
-----
    cd frontend && npm ci && npm run build     # produces frontend/dist/index.html
    python scripts/sync_template.py            # copy it into the package
    python scripts/sync_template.py --check    # exit 1 if the copy is stale

CI (PR 9) runs the build and then ``--check``. Pin the Node version there:
byte-for-byte reproducibility holds for a fixed lockfile and Node major, and is
not guaranteed across them. A diff on a Node upgrade is a signal to re-run the
sync and commit, not a bug in the frontend.
"""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
from pathlib import Path

#: Vite's single-file output, relative to the repository root.
SOURCE = Path("frontend") / "dist" / "index.html"

#: Where the package expects it. Kept in step with
#: ``call_forecast.dashboard.TEMPLATE_RESOURCE``.
TARGET = Path("call_forecast") / "assets" / "dashboard_template.html"

#: The frontend build must carry this through for the renderer to have
#: somewhere to put the payload. Checked here so a build configuration that
#: silently strips HTML comments is caught at sync time rather than on the
#: first run of a released package.
MARKER = "<!--dashboard-data-->"

#: Headroom check, in two tiers — see ``check_bundle_size`` for the reasoning,
#: which applies here identically. The generated dashboard carries the run
#: payload (~270 KB on the 210-day sample) on top of whatever this is.
#:
#: The advisory tracks what the template costs today. It is the number that
#: moves as the frontend grows, and moving it is a normal part of a PR that
#: adds a feature. The limit is where the template alone would leave no room
#: for a payload under the generated file's own hard limit, and crossing it is
#: a real problem rather than ordinary growth.
#:
#: Raised from 1,750,000 by PR 14 (documentation), which took the template from
#: 1,716,276 to 1,770,745 — about 54 KB for six pages of prose, ten block
#: renderers and the docs nav, with no new dependency.
TEMPLATE_ADVISORY_BYTES = 1_800_000
TEMPLATE_LIMIT_BYTES = 2_600_000


def _read(path: Path) -> str:
    """
    Read a build artefact as text with newlines left alone.

    ``newline=""`` disables universal-newline translation, so the comparison in
    ``--check`` is against what is actually on disk. Everything is written back
    with ``\\n`` regardless of platform.

    Spelled with ``open()`` because ``Path.read_text`` only grew a ``newline``
    argument in 3.13 and this package supports 3.10.
    """
    with path.open(encoding="utf-8", newline="") as handle:
        return handle.read()


class _ExternalRefs(HTMLParser):
    """
    Collect tags that would make the page fetch something.

    Parsed rather than grepped. A minified bundle is full of strings that look
    like markup - React's attribute-diffing code contains ``src=``, d3-format
    carries documentation links with ``href=``, and Plotly is full of
    ``http://www.w3.org/2000/svg`` - so a substring search reports an external
    dependency on a page that has none. ``HTMLParser`` treats ``<script>`` and
    ``<style>`` content as CDATA, which is exactly the distinction that matters
    here: only real tags are inspected.
    """

    #: Attributes that cause a fetch, per tag.
    FETCHING = {
        "script": "src",
        "link": "href",
        "img": "src",
        "iframe": "src",
        "source": "src",
        "embed": "src",
        "video": "src",
        "audio": "src",
    }

    def __init__(self) -> None:
        super().__init__()
        self.refs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attribute = self.FETCHING.get(tag)
        if attribute is None:
            return
        for name, value in attrs:
            if name == attribute and value:
                self.refs.append(f"<{tag} {name}=\"{value}\">")


def _validate(text: str, source: Path) -> list[str]:
    """Return the reasons this build is not fit to be a template, if any."""
    problems = []

    found = text.count(MARKER)
    if found != 1:
        problems.append(
            f"expected exactly one {MARKER} marker, found {found} - the build "
            f"is stripping HTML comments, or index.html no longer carries it"
        )

    size = len(text.encode("utf-8"))
    if size > TEMPLATE_LIMIT_BYTES:
        problems.append(
            f"{size:,} bytes exceeds the {TEMPLATE_LIMIT_BYTES:,}-byte limit "
            f"- the generated dashboard adds the run payload on top of this, "
            f"so there is no longer room for one"
        )
    elif size > TEMPLATE_ADVISORY_BYTES:
        # Reported, not refused. A template that has outgrown its advisory is
        # worth knowing about; it is not a reason to reject a good build.
        print(
            f"NOTE: the template is {size:,} bytes, over the "
            f"{TEMPLATE_ADVISORY_BYTES:,}-byte advisory by "
            f"{size - TEMPLATE_ADVISORY_BYTES:,}. Not a failure - the limit is "
            f"{TEMPLATE_LIMIT_BYTES:,}. Consider raising the advisory in "
            f"scripts/sync_template.py once this size is the normal one."
        )

    # A single-file build has nothing left to fetch. A surviving reference
    # would break the offline, mailable property the whole report rests on.
    parser = _ExternalRefs()
    parser.feed(text)
    for ref in parser.refs:
        problems.append(
            f"{source} still fetches an external asset: {ref} - the "
            f"single-file build did not inline everything"
        )

    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true",
        help="verify the committed template is current instead of writing it",
    )
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parent.parent
    source, target = root / SOURCE, root / TARGET

    if not source.exists():
        print(f"{SOURCE} is missing; run: cd frontend && npm ci && npm run build")
        return 1

    built = _read(source)
    problems = _validate(built, SOURCE)
    if problems:
        print(f"{SOURCE} is not usable as a template:")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    # Normalise on the way in. .gitattributes checks this repository out with
    # LF, and a CRLF template would be a whole-file diff on every sync from a
    # Windows machine.
    built = built.replace("\r\n", "\n")

    if args.check:
        if not target.exists():
            print(f"{TARGET} is missing; run python scripts/sync_template.py")
            return 1
        if _read(target) != built:
            print(
                f"{TARGET} is out of date - the committed template does not "
                f"match the current frontend build.\n"
                f"Run: python scripts/sync_template.py, and commit the result."
            )
            return 1
        print(f"{TARGET} is up to date.")
        return 0

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(built, encoding="utf-8", newline="\n")
    print(f"Wrote {TARGET} ({len(built.encode('utf-8')):,} bytes).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
