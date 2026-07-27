"""
The generated CSS token file must not drift from the Python palette.

``THEME`` in ``dashboard.py`` is an audited palette — the hues were checked for
contrast in both light and dark, and the project rules require re-validating if
they change. Once the React frontend reads its colours from a stylesheet, that
stylesheet becomes a second place the palette can live and a silent way for the
two renderers to disagree.

Generating it and asserting here that the checked-in copy is current keeps one
source of truth: change ``THEME``, re-run ``scripts/gen_tokens.py``, commit
both, or this fails.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from call_forecast.dashboard import THEME  # noqa: E402

gen_tokens = pytest.importorskip("gen_tokens")


@pytest.fixture(scope="module")
def tokens_path() -> Path:
    return ROOT / gen_tokens.TARGET


@pytest.fixture(scope="module")
def tokens_css(tokens_path: Path) -> str:
    if not tokens_path.exists():
        pytest.fail(
            f"{gen_tokens.TARGET} is missing. Run: python scripts/gen_tokens.py"
        )
    return tokens_path.read_text(encoding="utf-8")


class TestTokensAreCurrent:
    def test_checked_in_file_matches_the_generator(self, tokens_css: str):
        assert tokens_css == gen_tokens.render(), (
            "frontend/src/theme/tokens.css is out of date with "
            "call_forecast.dashboard.THEME. Run: python scripts/gen_tokens.py"
        )

    def test_check_mode_agrees(self):
        assert gen_tokens.main(["--check"]) == 0


class TestPaletteIsFullyCarried:
    def test_every_light_colour_is_a_custom_property(self, tokens_css: str):
        for key, value in THEME["light"].items():
            if isinstance(value, str):
                assert f"--{key}: {value};" in tokens_css, f"missing light --{key}"

    def test_every_dark_colour_is_a_custom_property(self, tokens_css: str):
        for key, value in THEME["dark"].items():
            if isinstance(value, str):
                assert f"--{key}: {value};" in tokens_css, f"missing dark --{key}"

    def test_sequential_ramp_is_expanded(self, tokens_css: str):
        ramp = THEME["light"]["seq"]
        for i, colour in enumerate(ramp):
            assert f"--seq-{i}: {colour};" in tokens_css
        assert f"--seq-{len(ramp)}:" not in tokens_css

    def test_layout_constants_match_the_python_stylesheet(self, tokens_css: str):
        from call_forecast.dashboard import _stylesheet

        css = _stylesheet()
        for key, value in gen_tokens.LAYOUT_TOKENS.items():
            assert f"--{key}: {value};" in tokens_css
            # The same constant must still be what the Python dashboard uses.
            assert f"--{key}: {value};" in css, f"--{key} disagrees with dashboard.py"


class TestCascade:
    """
    The three-rule cascade is what lets the OS preference work without any
    JavaScript, so the page never flashes the wrong palette before React mounts.
    """

    def test_light_is_the_base(self, tokens_css: str):
        assert ":root {" in tokens_css
        assert "color-scheme: light;" in tokens_css

    def test_os_dark_applies_only_when_light_is_not_pinned(self, tokens_css: str):
        assert "@media (prefers-color-scheme: dark)" in tokens_css
        assert ':root:not([data-theme="light"])' in tokens_css

    def test_explicit_dark_overrides(self, tokens_css: str):
        assert ':root[data-theme="dark"]' in tokens_css
        # The explicit rule must come after the media query, or it cannot win.
        assert tokens_css.index(':root[data-theme="dark"] {') > tokens_css.index(
            "@media (prefers-color-scheme: dark)"
        )

    def test_file_is_marked_generated(self, tokens_css: str):
        assert "GENERATED FILE" in tokens_css
        assert "scripts/gen_tokens.py" in tokens_css
