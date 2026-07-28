"""
Tests for the React dashboard renderer (``call_forecast.dashboard.build_dashboard_react``).

The Python renderer (``build_dashboard``) is checked for self-containment with
a regex over the raw HTML — see
``test_anomalies_scenarios.py::test_dashboard_is_self_contained``. That
approach is unsafe here: the React output is 1.6+ MB of *minified JS* inlined
in a single ``<script>`` tag, and that JS is full of string literals that look
like markup (``src=``, ``href=``, ``<script>``, SVG namespace URLs, GitHub doc
links pulled in by dependencies). A substring or regex scan over the whole
document would flag all of that as an external reference on a page that has
none. So every structural assertion below goes through
``html.parser.HTMLParser``, which treats ``<script>``/``<style>`` bodies as
CDATA and only ever looks at real tags — the same approach
``scripts/sync_template.py``'s ``_ExternalRefs`` uses. The scanner is written
out again here rather than imported from that script: the two check different
things (this one pins the whole tag set, that one only reports fetching
attributes), and a test that imported its own oracle from the build tooling
would pass by agreeing with it.

The second reason this suite exists is the payload injection path. The
payload is JSON, inlined into an HTML document, so anything in it that can
close the enclosing ``<script>`` tag is a stored-XSS vector the moment it
carries an attacker-controlled string — and an anomaly's free-text ``message``
column is exactly that: attacker-adjacent text that flows untouched from
``anomalies.py`` into the dashboard. ``TestPayloadInjection`` drives a hostile
string through that real column, not a hand-built payload, and checks it
degrades to an inert, round-trippable JSON string rather than either breaking
the page or being silently mangled.
"""

from __future__ import annotations

import dataclasses
import inspect
import json
from html.parser import HTMLParser
from pathlib import Path

import numpy as np
import pytest

from call_forecast.config import AppConfig, CVConfig, PathsConfig
from call_forecast.dashboard import (
    PAYLOAD_MARKER,
    TEMPLATE_RESOURCE,
    build_dashboard,
    build_dashboard_react,
)


# --------------------------------------------------------------------------- #
#  A parsed-tag scanner, safe against a minified JS bundle                    #
# --------------------------------------------------------------------------- #
class _TagScanner(HTMLParser):
    """
    Collect every start tag as ``(name, {attr: value})``.

    Unlike a regex over the raw document, this only ever sees real markup:
    ``<script>``/``<style>`` contents are CDATA to ``HTMLParser`` and are never
    re-parsed as tags, so a JS string literal like ``"<script>"`` cannot be
    mistaken for a second script element, and ``src="..."`` inside a minified
    bundle cannot be mistaken for a fetching attribute.
    """

    #: Attributes that would make the browser fetch something.
    FETCHING = {"script": "src", "link": "href", "img": "src", "iframe": "src"}

    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict[str, str | None]]] = []
        self.external_refs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_dict = dict(attrs)
        self.tags.append((tag, attr_dict))
        attribute = self.FETCHING.get(tag)
        if attribute is not None and attr_dict.get(attribute):
            self.external_refs.append(f"<{tag} {attribute}=\"{attr_dict[attribute]}\">")

    # HTMLParser treats <script>/<style> bodies as CDATA and hands them to
    # handle_data, not handle_starttag — nothing to override here, and that is
    # the whole point.


def _parse(html: str) -> _TagScanner:
    scanner = _TagScanner()
    scanner.feed(html)
    return scanner


def _dashboard_data_text(html: str) -> str:
    """Extract the literal text content of #dashboard-data via HTMLParser."""

    class _Extractor(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.capturing = False
            self.chunks: list[str] = []

        def handle_starttag(self, tag, attrs):
            if tag == "script" and dict(attrs).get("id") == "dashboard-data":
                self.capturing = True

        def handle_endtag(self, tag):
            if tag == "script":
                self.capturing = False

        def handle_data(self, data):
            if self.capturing:
                self.chunks.append(data)

    extractor = _Extractor()
    extractor.feed(html)
    return "".join(extractor.chunks)


# --------------------------------------------------------------------------- #
#  Shared fixture — one trimmed pipeline run                                  #
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def run(tmp_path_factory):
    """
    One pipeline run, shared by every test below.

    Trimmed the same way as ``tests/test_serialize.py::run``: two models and
    200 simulation paths, enough to exercise every dashboard section without
    the ~5-minute cost of an untrimmed run. ``build_report=False`` — this
    module calls ``build_dashboard_react`` directly, the same way
    ``test_serialize.py`` calls ``build_payload`` directly, so the pipeline
    does not need to render either dashboard itself.
    """
    from call_forecast.pipeline import run_pipeline
    from conftest import _synthetic_calls

    root = tmp_path_factory.mktemp("react_dashboard")
    data_dir = root / "data"
    data_dir.mkdir()
    _synthetic_calls(np.random.default_rng(11), days=200).to_csv(
        data_dir / "export.csv", index=False
    )

    base = AppConfig.default()
    cfg = dataclasses.replace(
        base,
        paths=PathsConfig(root=root),
        models=dataclasses.replace(
            base.models, enabled=("seasonal_naive", "random_forest")
        ),
        cv=CVConfig(initial_train_days=150, horizon=7, step=21, min_folds=2),
        forecast=dataclasses.replace(base.forecast, n_simulations=200),
    )
    return run_pipeline(cfg, force=True, build_report=False), cfg


@pytest.fixture(scope="module")
def dashboard_html(run, tmp_path_factory):
    """The rendered dashboard.html from an unmodified run."""
    result, cfg = run
    output_path = tmp_path_factory.mktemp("react_dashboard_out") / "dashboard.html"
    build_dashboard_react(
        output_path,
        calls=result.calls.frame,
        daily=result.daily,
        evaluations=result.evaluations,
        forecasts=result.forecasts,
        anomaly_report=result.anomalies,
        explanations=result.explanations,
        scenario_table=result.scenarios,
        scenario_notes=result.scenario_notes,
        ingestion_report=result.report,
        cfg=cfg,
    )
    return output_path, output_path.read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
#  1. Self-contained output                                                   #
# --------------------------------------------------------------------------- #
class TestSelfContained:
    """Guards the single-file, offline, mailable property of the output."""

    def test_file_is_written_and_non_empty(self, dashboard_html):
        path, html = dashboard_html
        assert path.exists()
        assert len(html) > 0

    def test_no_tag_fetches_an_external_resource(self, dashboard_html):
        """
        No ``script[src]``, ``link[href]``, ``img[src]`` or ``iframe[src]``.

        This is the assertion the raw-HTML regex approach cannot make safely
        against a 1.6 MB minified bundle full of string literals that look
        like markup — see the module docstring. Parsing means only real tags
        are ever inspected.
        """
        _, html = dashboard_html
        scanner = _parse(html)
        assert scanner.external_refs == []

    def test_exactly_one_dashboard_data_script(self, dashboard_html):
        _, html = dashboard_html
        scanner = _parse(html)
        matches = [
            tag for tag, attrs in scanner.tags
            if tag == "script" and attrs.get("id") == "dashboard-data"
            and attrs.get("type") == "application/json"
        ]
        assert len(matches) == 1

    def test_payload_marker_does_not_survive(self, dashboard_html):
        _, html = dashboard_html
        assert PAYLOAD_MARKER not in html

    def test_title_is_unchanged(self, dashboard_html):
        _, html = dashboard_html
        assert "<title>Call Analytics Forecast</title>" in html

    def test_tag_set_matches_the_documented_shape(self, dashboard_html):
        """
        For reference, the generated dashboard parses to exactly three
        relevant tags: the module script, the inlined stylesheet, and the
        JSON payload script. Pinning the count here means a future build that
        starts emitting a second bundle chunk (and so a second <script src=...>
        or a non-inlined <link>) fails loudly instead of only being caught by
        the (also-present) external-refs check.
        """
        _, html = dashboard_html
        scanner = _parse(html)
        scripts = [attrs for tag, attrs in scanner.tags if tag == "script"]
        styles = [attrs for tag, attrs in scanner.tags if tag == "style"]
        assert len(scripts) == 2, scripts
        assert len(styles) == 1, styles


# --------------------------------------------------------------------------- #
#  2. Payload injection and escaping — the hostile fixture                    #
# --------------------------------------------------------------------------- #
HOSTILE_MESSAGE = "</script><script>alert('xss')</script>"
HOSTILE_IMG = "<img src=x onerror=alert(1)>"
HOSTILE_AMP = "Cost & duration both spiked & user said \"help\""


def _hostile_anomaly_report(result):
    """
    Splice a hostile message into a copy of the run's real anomaly report.

    Driven through the real path rather than a hand-built payload dict: the
    anomaly frame's free-text ``message`` column (``call_forecast/anomalies.py``
    ``Anomaly.message``) is what a real detector rule writes, and it is what
    ``serialize._anomaly_section`` reads via ``anomaly_report.to_frame()``. A
    copy is built with ``dataclasses.replace`` rather than mutating
    ``result.anomalies`` in place, because that object is shared by the
    module-scoped ``run`` fixture across every other test in this file.
    """
    report = result.anomalies
    assert report is not None and report.anomalies, (
        "expected at least one anomaly from the planted day-100 spike; "
        "the hostile string needs a real row to ride in on"
    )
    anomalies = list(report.anomalies)
    hostile_text = f"{HOSTILE_MESSAGE} {HOSTILE_IMG} {HOSTILE_AMP}"
    anomalies[0] = dataclasses.replace(anomalies[0], message=hostile_text)
    return dataclasses.replace(report, anomalies=anomalies), hostile_text


@pytest.fixture(scope="module")
def hostile_render(run, tmp_path_factory):
    """Same run as ``dashboard_html``, but with a hostile anomaly message spliced in."""
    result, cfg = run
    hostile_report, hostile_text = _hostile_anomaly_report(result)

    output_path = tmp_path_factory.mktemp("react_dashboard_hostile") / "dashboard.html"
    build_dashboard_react(
        output_path,
        calls=result.calls.frame,
        daily=result.daily,
        evaluations=result.evaluations,
        forecasts=result.forecasts,
        anomaly_report=hostile_report,
        explanations=result.explanations,
        scenario_table=result.scenarios,
        scenario_notes=result.scenario_notes,
        ingestion_report=result.report,
        cfg=cfg,
    )
    html = output_path.read_text(encoding="utf-8")
    return html, hostile_text


class TestPayloadInjection:
    """The load-bearing class here: proves escaping, not stripping."""

    def test_no_extra_script_tag_appears(self, hostile_render):
        """
        The headline failure mode: a naively-inlined ``</script>`` in the
        payload closes the real script tag early, and everything after it
        — including the attacker's own ``<script>alert('xss')</script>`` —
        becomes live markup. If escaping ever regresses, this test sees a
        fourth or fifth tag show up here instead of the same three.
        """
        html, _ = hostile_render
        baseline_scanner = _parse(html)
        scripts = [attrs for tag, attrs in baseline_scanner.tags if tag == "script"]
        styles = [attrs for tag, attrs in baseline_scanner.tags if tag == "style"]
        imgs = [attrs for tag, attrs in baseline_scanner.tags if tag == "img"]
        assert len(scripts) == 2, scripts
        assert len(styles) == 1, styles
        assert imgs == [], "the hostile <img onerror=...> must not parse as a real tag"
        assert baseline_scanner.external_refs == []

    def test_payload_extracts_and_parses_as_json(self, hostile_render):
        html, _ = hostile_render
        text = _dashboard_data_text(html)
        assert text, "could not locate #dashboard-data content"
        json.loads(text)  # must not raise

    def test_hostile_string_round_trips_byte_identical(self, hostile_render):
        """
        The point of this whole class: the hostile string is escaped, not
        stripped or mangled. It must come back out of JSON exactly as it went
        in, byte for byte, having done nothing but sit inertly in a JSON
        string the whole way through.
        """
        html, hostile_text = hostile_render
        text = _dashboard_data_text(html)
        payload = json.loads(text)
        items = payload["anomalies"]["items"]
        messages = [item["message"] for item in items]
        assert hostile_text in messages

    def test_extracted_payload_text_has_no_raw_angle_brackets(self, hostile_render):
        html, _ = hostile_render
        text = _dashboard_data_text(html)
        assert "<" not in text
        assert ">" not in text

    def test_build_dashboard_react_guards_against_a_raw_angle_bracket(
        self, run, tmp_path, monkeypatch
    ):
        """
        Direct test of the belt-and-braces guard in ``build_dashboard_react``.

        ``serialize.dumps`` already escapes ``<``/``>``, so provoking the
        guard means bypassing that escaping — hence patching
        ``call_forecast.serialize.dumps`` (imported *inside*
        ``build_dashboard_react``, so patching
        ``call_forecast.dashboard.dumps`` would have no effect; the function
        looks the name up in ``call_forecast.serialize`` at call time).
        """
        import call_forecast.serialize as serialize_module

        result, cfg = run
        monkeypatch.setattr(serialize_module, "dumps", lambda payload: '{"x": "<script>"}')

        with pytest.raises(ValueError, match="script tag"):
            build_dashboard_react(
                tmp_path / "dashboard.html",
                calls=result.calls.frame,
                daily=result.daily,
                evaluations=result.evaluations,
                forecasts=result.forecasts,
                anomaly_report=result.anomalies,
                explanations=result.explanations,
                scenario_table=result.scenarios,
                scenario_notes=result.scenario_notes,
                ingestion_report=result.report,
                cfg=cfg,
            )


# --------------------------------------------------------------------------- #
#  3. Bundle size                                                             #
# --------------------------------------------------------------------------- #
class TestBundleSize:
    def test_generated_dashboard_stays_under_budget(self, dashboard_html):
        """
        The whole point of PR 6: the old Python dashboard was 5.08 MB, mostly
        inlined Plotly. The React build plus payload is currently ~1.95 MB —
        close enough to the 2 MB target that a regression should fail here,
        with the actual size reported so the budget's tightness is visible in
        the failure rather than just a bare assert.
        """
        path, html = dashboard_html
        size = len(html.encode("utf-8"))
        assert size <= 2_000_000, (
            f"generated dashboard.html is {size:,} bytes "
            f"({size / 1e6:.2f} MB), over the 2,000,000-byte (2 MB) budget"
        )

    def test_committed_template_alone_stays_under_its_budget(self):
        """
        The template budget is tighter than the generated-file budget because
        the payload (~hundreds of KB) is added on top at render time. Imports
        the constant from ``scripts/sync_template`` rather than restating the
        number, so the two stay in lockstep by construction.
        """
        import sys

        root = Path(__file__).resolve().parent.parent
        scripts_dir = str(root / "scripts")
        added = scripts_dir not in sys.path
        if added:
            sys.path.insert(0, scripts_dir)
        try:
            import sync_template
        finally:
            if added:
                sys.path.remove(scripts_dir)

        template_path = root / "call_forecast" / "assets" / "dashboard_template.html"
        size = template_path.stat().st_size
        assert size <= sync_template.TEMPLATE_BUDGET_BYTES, (
            f"committed template is {size:,} bytes, over the "
            f"{sync_template.TEMPLATE_BUDGET_BYTES:,}-byte budget "
            f"(sync_template.TEMPLATE_BUDGET_BYTES)"
        )


# --------------------------------------------------------------------------- #
#  4. Template packaging                                                      #
# --------------------------------------------------------------------------- #
class TestTemplatePackaging:
    def test_template_is_readable_via_importlib_resources(self):
        """
        Proves the artefact survives into an installed wheel, not only a
        source checkout: ``importlib.resources`` is the wheel-safe accessor,
        unlike a ``__file__``-relative path which would break once the
        package is zipped or installed to site-packages.
        """
        from importlib import resources

        text = (
            resources.files("call_forecast")
            .joinpath(TEMPLATE_RESOURCE)
            .read_text(encoding="utf-8")
        )
        assert text

    def test_template_carries_exactly_one_marker(self):
        from importlib import resources

        text = (
            resources.files("call_forecast")
            .joinpath(TEMPLATE_RESOURCE)
            .read_text(encoding="utf-8")
        )
        assert text.count(PAYLOAD_MARKER) == 1


# --------------------------------------------------------------------------- #
#  5. Renderer error paths                                                    #
# --------------------------------------------------------------------------- #
class TestRendererErrorPaths:
    def _call(self, run, tmp_path):
        result, cfg = run
        return dict(
            output_path=tmp_path / "dashboard.html",
            calls=result.calls.frame,
            daily=result.daily,
            evaluations=result.evaluations,
            forecasts=result.forecasts,
            anomaly_report=result.anomalies,
            explanations=result.explanations,
            scenario_table=result.scenarios,
            scenario_notes=result.scenario_notes,
            ingestion_report=result.report,
            cfg=cfg,
        )

    def test_zero_markers_raises_naming_the_marker_and_sync_script(
        self, run, tmp_path, monkeypatch
    ):
        import call_forecast.dashboard as dashboard_module

        monkeypatch.setattr(dashboard_module, "_read_template", lambda: "<html>no marker here</html>")
        kwargs = self._call(run, tmp_path)
        with pytest.raises(ValueError, match="sync_template") as excinfo:
            build_dashboard_react(**kwargs)
        assert PAYLOAD_MARKER in str(excinfo.value)

    def test_two_markers_raises(self, run, tmp_path, monkeypatch):
        import call_forecast.dashboard as dashboard_module

        two_markers = f"<html>{PAYLOAD_MARKER}{PAYLOAD_MARKER}</html>"
        monkeypatch.setattr(dashboard_module, "_read_template", lambda: two_markers)
        kwargs = self._call(run, tmp_path)
        with pytest.raises(ValueError):
            build_dashboard_react(**kwargs)

    def test_read_template_raises_file_not_found_with_rebuild_instructions(self, monkeypatch):
        """
        Simulates a checkout or wheel where the build artefact never landed —
        e.g. someone skipped the ``npm run build`` + ``sync_template.py`` step.
        This must not degrade to a blank page; it must fail loudly and tell
        the operator exactly what to run.
        """
        import call_forecast.dashboard as dashboard_module
        from importlib import resources

        class _MissingTraversable:
            def joinpath(self, *_args, **_kwargs):
                return self

            def read_text(self, *_args, **_kwargs):
                raise FileNotFoundError("no such resource")

        monkeypatch.setattr(resources, "files", lambda *_a, **_k: _MissingTraversable())

        with pytest.raises(FileNotFoundError) as excinfo:
            dashboard_module._read_template()
        message = str(excinfo.value)
        assert "npm run build" in message
        assert "sync_template.py" in message


# --------------------------------------------------------------------------- #
#  6. Wiring                                                                  #
# --------------------------------------------------------------------------- #
class TestWiring:
    def test_run_react_dashboard_defaults_false(self):
        from call_forecast.cli import build_parser

        args = build_parser().parse_args(["run"])
        assert args.react_dashboard is False

    def test_run_react_dashboard_flag_sets_true(self):
        from call_forecast.cli import build_parser

        args = build_parser().parse_args(["run", "--react-dashboard"])
        assert args.react_dashboard is True

    def test_watch_react_dashboard_defaults_false(self):
        from call_forecast.cli import build_parser

        args = build_parser().parse_args(["watch"])
        assert args.react_dashboard is False

    def test_watch_react_dashboard_flag_sets_true(self):
        from call_forecast.cli import build_parser

        args = build_parser().parse_args(["watch", "--react-dashboard"])
        assert args.react_dashboard is True

    def test_run_pipeline_react_dashboard_defaults_false(self):
        """
        PR 6 explicitly must not flip the default renderer — the legacy
        ``build_dashboard`` stays what a plain ``run_pipeline(cfg)`` call
        produces until a later PR opts in.
        """
        from call_forecast.pipeline import run_pipeline

        default = inspect.signature(run_pipeline).parameters["react_dashboard"].default
        assert default is False

    def test_legacy_build_dashboard_is_still_exported(self):
        """The legacy renderer must not have been removed by this migration."""
        import call_forecast.dashboard as dashboard_module

        assert "build_dashboard" in dashboard_module.__all__
        assert dashboard_module.build_dashboard is build_dashboard
