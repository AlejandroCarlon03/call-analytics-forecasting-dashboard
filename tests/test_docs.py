"""
Tests for ``README.md`` itself.

PR 8 flipped the default dashboard renderer from the Python-assembled page to
the pre-built React bundle. That's a behaviour change with no type system and
no import to check it against — the only artefact a user reads before running
anything is the README, so it is the thing most likely to silently drift out
of sync with `cli.py` and `dashboard.py`. These tests read the README as plain
text (no `call_forecast` import, no pipeline run) so they stay fast and cannot
be broken by unrelated code changes elsewhere in the package.
"""

from __future__ import annotations

from pathlib import Path

import pytest

README_PATH = Path(__file__).resolve().parents[1] / "README.md"


@pytest.fixture(scope="module")
def readme_text() -> str:
    """Load README.md once per test run; every test below reads from this."""
    return README_PATH.read_text(encoding="utf-8")


def test_readme_exists():
    """Guards against the file being renamed or moved without updating this suite."""
    assert README_PATH.is_file()


def test_readme_documents_legacy_dashboard_flag(readme_text):
    """
    ``--legacy-dashboard`` is the flag that recovers the old renderer. If the
    README stops mentioning it, a user has no documented way to find out the
    flag exists, since `--help` output is not consulted for this migration.
    """
    assert "--legacy-dashboard" in readme_text


def test_readme_states_react_is_the_default_renderer(readme_text):
    """
    PR 8's entire point is that the renderer flipped. This asserts on the
    substance of that claim (React + default), case-insensitively, rather than
    pinning exact wording, so a rephrase doesn't spuriously break the test —
    but silently reverting to "legacy is the default" would.
    """
    lowered = readme_text.lower()
    assert "react" in lowered and "default" in lowered
    assert "react dashboard by default" in lowered or "react dashboard renders by default" in lowered \
        or "writes a **react** dashboard by default" in lowered or "react by default" in lowered


def test_readme_tells_end_users_node_is_not_required(readme_text):
    """
    The single most likely wrong conclusion from "the dashboard is now React"
    is "I need to install Node." This catches that regression: if the
    explicit "Node is not required for end users" statement disappears, a
    contributor could plausibly reintroduce it without anyone noticing until
    a confused user files an issue.
    """
    lowered = readme_text.lower()
    assert "no node.js or npm install is needed" in lowered or "node.js — do you need it" in lowered
    assert "no, not to use the tool" in lowered


def test_readme_explains_node_is_needed_to_rebuild_the_frontend(readme_text):
    """
    Node is required for exactly one audience: contributors rebuilding the
    frontend bundle. If this guidance is lost, contributors have no
    documented path from editing `frontend/` to a working
    `dashboard_template.html`, and might ship a stale template (the failure
    mode PR 6/PR 8 built `scripts/sync_template.py` specifically to prevent).
    """
    lowered = readme_text.lower()
    assert "npm ci" in lowered
    assert "npm run build" in lowered
    assert "sync_template.py" in lowered


def test_readme_still_documents_dashboard_output_path(readme_text):
    """
    Both renderers write to the same path. If a future edit accidentally
    scrubs `reports/dashboard.html` from the docs while reworking the
    Dashboard section, users lose the one fact that hasn't changed across the
    whole migration.
    """
    assert "reports/dashboard.html" in readme_text
