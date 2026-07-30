"""
Tests for ``scripts/check_bundle_size.py``, the CI size gate added in PR 9.

A gate that cannot fail is worse than no gate: it reports green forever and
nobody looks at it again. These tests are the counterweight — they drive the
script's failing path explicitly, and they pin its budget to the number the
pipeline-rendered assertion in ``test_react_dashboard.py`` already uses, so the
cheap CI check and the honest pytest check cannot drift apart.

Everything here is stdlib and file sizes; nothing fits a model or renders a
dashboard. The script itself is stdlib-only for the same reason — the CI job
that runs it installs no dependencies.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def _load_script():
    """
    Import ``scripts/check_bundle_size.py`` as a module.

    ``scripts/`` is not a package, so it goes on ``sys.path`` for the import
    and comes back off again — the same approach
    ``test_react_dashboard.py::test_committed_template_alone_stays_under_its_budget``
    uses for ``sync_template``.
    """
    scripts_dir = str(ROOT / "scripts")
    added = scripts_dir not in sys.path
    if added:
        sys.path.insert(0, scripts_dir)
    try:
        import check_bundle_size

        return check_bundle_size
    finally:
        if added:
            sys.path.remove(scripts_dir)


@pytest.fixture(scope="module")
def script():
    return _load_script()


def test_budget_matches_the_number_the_render_test_asserts(script):
    """
    ``test_generated_dashboard_stays_under_budget`` asserts the same hard limit
    against a really-rendered dashboard. If the script's limit were raised
    independently, CI would go green on a page the test suite still rejects —
    two gates disagreeing about the same fact, which is worse than one gate.

    Only the *limit* has to agree. The advisory is allowed to differ from
    anything, because nothing fails on it.
    """
    assert script.DASHBOARD_LIMIT_BYTES == 3_000_000


def test_the_advisory_sits_below_the_limit(script):
    """
    An advisory at or above the limit would be unreachable: every size that
    tripped it would already have failed, and the warning tier — the entire
    point of having two numbers — would never print.
    """
    assert script.DASHBOARD_ADVISORY_BYTES < script.DASHBOARD_LIMIT_BYTES


def test_marker_and_wrapper_match_the_renderer(script):
    """
    The projection is only arithmetic if the substitution it models is the one
    the renderer performs. Pinned against ``dashboard`` itself rather than
    restated, so a change to the marker or the script tag breaks here instead
    of silently skewing every future size report.
    """
    from call_forecast.dashboard import PAYLOAD_MARKER

    assert script.MARKER == PAYLOAD_MARKER
    assert script.SCRIPT_OPEN.startswith('<script id="dashboard-data"')
    assert script.SCRIPT_CLOSE == "</script>"


def test_projection_equals_the_substitution_it_models(script):
    """
    The claim the script rests on: template + payload + wrapper predicts what
    ``build_dashboard_react`` writes.

    ***This used to be pinned to 1,946,364 bytes with a 1% tolerance, and that
    was the wrong shape for the assertion.*** It made a statement about how big
    the bundle happened to be in PR 6, so every PR that legitimately grew the
    dashboard broke a test about *arithmetic* — and the only available fixes
    were to edit the constant (noise, forever) or widen the tolerance (which
    would quietly stop the test from checking anything).

    The projection is a model of one specific substitution, so the honest
    comparison is against that substitution actually performed. Doing it here
    costs one string replace on files that are already committed, needs no
    pipeline run, and is exact rather than approximate — no tolerance, no
    constant, and nothing to bump when the bundle grows. It fails only if the
    script's arithmetic and the renderer's substitution stop agreeing, which is
    the single thing it was ever meant to catch.
    """
    assert script.main([]) == 0, "the committed template should be within limits"

    template_bytes = (ROOT / script.COMMITTED_TEMPLATE).read_bytes()
    payload_bytes = (ROOT / script.SAMPLE_PAYLOAD).read_bytes()

    projected = (
        len(template_bytes)
        + len(payload_bytes)
        + len(script.SCRIPT_OPEN)
        + len(script.SCRIPT_CLOSE)
        - len(script.MARKER)
    )

    # The substitution `build_dashboard_react` performs, byte for byte.
    rendered = template_bytes.replace(
        script.MARKER.encode(),
        script.SCRIPT_OPEN.encode() + payload_bytes + script.SCRIPT_CLOSE.encode(),
    )

    assert projected == len(rendered)


def test_exceeding_the_budget_exits_nonzero(script, capsys):
    """
    The failing path, driven through the real entry point. ``--budget`` is what
    makes this assertable without writing a 2 MB file: the comparison is the
    same one CI performs.
    """
    assert script.main(["--budget", "1000", "--max", "2000"]) == 1


def test_exceeding_only_the_advisory_warns_and_passes(script, capsys):
    """
    The tier that exists so ordinary growth does not turn CI red.

    Driven through the real entry point with an advisory the committed bundle
    already exceeds. A gate whose warning path is untested is one refactor away
    from being a hard failure again, or from printing nothing at all — and
    silence here reads exactly like "comfortably under budget".
    """
    assert script.main(["--budget", "1000"]) == 0

    out = capsys.readouterr().out
    assert "NOTE" in out
    assert "does not fail the build" in out
    assert "advisory" in out
    assert f"{script.DASHBOARD_LIMIT_BYTES:,}" in out, "say how far the real limit is"


def test_failure_message_states_size_limit_and_a_cause(script, capsys):
    """
    'Do not silently fail' means more than a non-zero exit. Someone reading a
    red CI log needs the three facts that let them act: what it is now, what it
    is allowed to be, and what usually causes it.
    """
    script.main(["--budget", "1000", "--max", "2000"])
    out = capsys.readouterr().out

    assert "exceeds" in out
    assert "current size:" in out and "allowed size:" in out
    assert "2,000 bytes" in out
    assert "Plotly" in out, "the message should name the dominant cause"


def test_measuring_a_missing_file_fails_rather_than_passing(script, capsys):
    """
    The dangerous failure for a size gate is a *skip* that reads as a pass. A
    path that does not exist has to be an error, not 0 bytes of a 2 MB budget.
    """
    assert script.main(["reports/does_not_exist.html"]) == 1
    assert "does not exist" in capsys.readouterr().out
