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
    ``test_generated_dashboard_stays_under_budget`` asserts 2,000,000 bytes
    against a really-rendered dashboard. If the script's budget were raised
    independently, CI would go green on a page the test suite still rejects —
    two gates disagreeing about the same fact, which is worse than one gate.
    """
    assert script.DASHBOARD_BUDGET_BYTES == 2_000_000


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


def test_projection_is_close_to_the_real_generated_size(script):
    """
    The claim the script rests on: template + payload + wrapper predicts what
    ``build_dashboard_react`` writes. PR 6 measured 1,946,364 bytes on the
    210-day sample and this projects 1,949,710 — the gap is the committed
    fixture not being byte-identical to ``serialize.dumps()`` output for that
    run. A 1% tolerance keeps the test about the *method* being sound rather
    than about either file's exact current size.
    """
    assert script.main([]) == 0, "the committed template should be within budget"

    template = ROOT / script.COMMITTED_TEMPLATE
    payload = ROOT / script.SAMPLE_PAYLOAD
    projected = (
        template.stat().st_size
        + payload.stat().st_size
        + len(script.SCRIPT_OPEN)
        + len(script.SCRIPT_CLOSE)
        - len(script.MARKER)
    )
    assert projected == pytest.approx(1_946_364, rel=0.01)


def test_exceeding_the_budget_exits_nonzero(script, capsys):
    """
    The failing path, driven through the real entry point. ``--budget`` is what
    makes this assertable without writing a 2 MB file: the comparison is the
    same one CI performs.
    """
    assert script.main(["--budget", "1000"]) == 1


def test_failure_message_states_size_limit_and_a_cause(script, capsys):
    """
    'Do not silently fail' means more than a non-zero exit. Someone reading a
    red CI log needs the three facts that let them act: what it is now, what it
    is allowed to be, and what usually causes it.
    """
    script.main(["--budget", "1000"])
    out = capsys.readouterr().out

    assert "exceeds" in out
    assert "current size:" in out and "allowed size:" in out
    assert "1,000 bytes" in out
    assert "Plotly" in out, "the message should name the dominant cause"


def test_measuring_a_missing_file_fails_rather_than_passing(script, capsys):
    """
    The dangerous failure for a size gate is a *skip* that reads as a pass. A
    path that does not exist has to be an error, not 0 bytes of a 2 MB budget.
    """
    assert script.main(["reports/does_not_exist.html"]) == 1
    assert "does not exist" in capsys.readouterr().out
