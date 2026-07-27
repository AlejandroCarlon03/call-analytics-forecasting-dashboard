#!/usr/bin/env python3
"""
call_forecast.dashboard
=======================
Render the run into one self-contained, interactive HTML dashboard.

The output is a single file with Plotly inlined — no server, no CDN, no network
access. Open it, mail it, drop it on a share; it works offline.

Design notes
------------
Colours come from a validated categorical palette (blue / orange / aqua), with a
single-hue blue ramp for the heatmap and a reserved four-colour status palette
for alerts. Status is never carried by colour alone: every alert ships an icon
and a text label. Every chart has a table-view twin behind a disclosure
triangle, so no value is reachable only by hovering, and the light-mode
contrast relief rule is satisfied.

Both light and dark themes are selected rather than auto-inverted: the page
follows the OS preference, and the toggle in the header overrides it. Plotly
figures are re-styled on toggle from a per-figure role map, so the marks change
with the theme instead of staying baked at their light values.
"""

from __future__ import annotations

import html
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd

from .config import AppConfig

log = logging.getLogger(__name__)

__all__ = ["THEME", "build_dashboard"]


# --------------------------------------------------------------------------- #
#  Palette                                                                     #
# --------------------------------------------------------------------------- #
#: Validated palette. Light and dark are separately-stepped instances of the
#: same hues, not an automatic inversion.
THEME: dict[str, dict[str, str]] = {
    "light": {
        "surface": "#fcfcfb",
        "page": "#f9f9f7",
        "ink": "#0b0b0b",
        "ink2": "#52514e",
        "muted": "#898781",
        "grid": "#e1e0d9",
        "axis": "#c3c2b7",
        "border": "rgba(11,11,11,0.10)",
        "series1": "#2a78d6",
        "series2": "#eb6834",
        "series3": "#1baf7a",
        "band": "rgba(42,120,214,0.16)",
        "good": "#0ca30c",
        "warning": "#fab219",
        "serious": "#ec835a",
        "critical": "#d03b3b",
        "seq": ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
    },
    "dark": {
        "surface": "#1a1a19",
        "page": "#0d0d0d",
        "ink": "#ffffff",
        "ink2": "#c3c2b7",
        "muted": "#898781",
        "grid": "#2c2c2a",
        "axis": "#383835",
        "border": "rgba(255,255,255,0.10)",
        "series1": "#3987e5",
        "series2": "#d95926",
        "series3": "#199e70",
        "band": "rgba(57,135,229,0.20)",
        "good": "#0ca30c",
        "warning": "#fab219",
        "serious": "#ec835a",
        "critical": "#d03b3b",
        "seq": ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
    },
}

#: Icon + label pairing, so a status is never conveyed by colour alone.
SEVERITY_ICON = {"critical": "▲", "warning": "◆", "info": "●"}

TARGET_LABELS = {
    "call_volume": "Daily call volume",
    "avg_duration_sec": "Average call duration",
    "total_cost": "Daily cost",
}
TARGET_UNITS = {"call_volume": "calls", "avg_duration_sec": "seconds", "total_cost": "$"}


def _fmt(value: float, target: str) -> str:
    """Format a value in the units of its target."""
    if value is None or not np.isfinite(value):
        return "—"
    if target == "total_cost":
        return f"${value:,.2f}"
    if target == "avg_duration_sec":
        return f"{value:,.0f}s"
    return f"{value:,.1f}"


# --------------------------------------------------------------------------- #
#  Figure helpers                                                              #
# --------------------------------------------------------------------------- #
@dataclass
class Figure:
    """A Plotly figure plus the theme roles needed to restyle it on toggle."""

    id: str
    fig: Any
    #: trace index -> {plotly property: theme role}, e.g. {0: {"line.color": "series1"}}
    roles: dict[int, dict[str, str]]


def _base_layout(cfg_height: int = 340) -> dict:
    """Layout defaults shared by every figure: transparent, hairline, roomy."""
    return {
        "height": cfg_height,
        "margin": {"l": 56, "r": 20, "t": 16, "b": 44},
        "paper_bgcolor": "rgba(0,0,0,0)",
        "plot_bgcolor": "rgba(0,0,0,0)",
        "font": {
            "family": 'system-ui, -apple-system, "Segoe UI", sans-serif',
            "size": 12,
            "color": THEME["light"]["ink2"],
        },
        "hovermode": "x unified",
        "hoverlabel": {"font": {"size": 12}},
        "legend": {
            "orientation": "h",
            "yanchor": "bottom",
            "y": 1.0,
            "xanchor": "left",
            "x": 0,
            "bgcolor": "rgba(0,0,0,0)",
        },
        "xaxis": {
            "gridcolor": THEME["light"]["grid"],
            "linecolor": THEME["light"]["axis"],
            "zeroline": False,
            "showgrid": False,
            "ticks": "outside",
            "tickcolor": THEME["light"]["axis"],
        },
        "yaxis": {
            "gridcolor": THEME["light"]["grid"],
            "linecolor": THEME["light"]["axis"],
            "zeroline": False,
            "griddash": "solid",
        },
    }


def _forecast_figure(
    daily: pd.DataFrame, result, target: str, index: int
) -> Figure:
    """History + forecast with an interval band, on a single shared axis."""
    import plotly.graph_objects as go

    light = THEME["light"]
    history = daily[target].astype(float)
    fc = result.daily

    fig = go.Figure()

    # Interval band first, so the lines draw over it.
    fig.add_trace(
        go.Scatter(
            x=list(fc.index) + list(fc.index[::-1]),
            y=list(fc["yhat_upper"]) + list(fc["yhat_lower"][::-1]),
            fill="toself",
            fillcolor=light["band"],
            line={"width": 0},
            hoverinfo="skip",
            name=f"{int(result.interval_level * 100)}% interval",
            showlegend=True,
        )
    )
    fig.add_trace(
        go.Scatter(
            x=history.index,
            y=history.to_numpy(),
            mode="lines",
            name="Actual",
            line={"color": light["series1"], "width": 2},
            hovertemplate="%{x|%a %d %b}<br>Actual: %{y:.2f}<extra></extra>",
        )
    )
    fig.add_trace(
        go.Scatter(
            x=fc.index,
            y=fc["yhat"].to_numpy(),
            mode="lines",
            name=f"Forecast ({result.model_label})",
            line={"color": light["series2"], "width": 2},
            hovertemplate="%{x|%a %d %b}<br>Forecast: %{y:.2f}<extra></extra>",
        )
    )

    layout = _base_layout(360)
    layout["yaxis"]["title"] = {"text": TARGET_UNITS.get(target, "")}
    fig.update_layout(**layout)

    # Mark where history ends and extrapolation begins.
    if len(history):
        fig.add_vline(
            x=history.index.max(),
            line={"color": light["muted"], "width": 1},
            annotation_text="today",
            annotation_position="top left",
            annotation_font={"size": 11, "color": light["muted"]},
        )

    return Figure(
        id=f"fig-forecast-{index}",
        fig=fig,
        roles={
            0: {"fillcolor": "band"},
            1: {"line.color": "series1"},
            2: {"line.color": "series2"},
        },
    )


def _monthly_cost_figure(result) -> Figure:
    """Monthly cost projection as bars with simulated interval whiskers."""
    import plotly.graph_objects as go

    light = THEME["light"]
    monthly = result.monthly.copy()
    labels = [
        f"{m}{' (partial)' if p else ''}"
        for m, p in zip(monthly["month"], monthly["partial_month"])
    ]

    fig = go.Figure(
        go.Bar(
            x=labels,
            y=monthly["yhat"],
            marker={"color": light["series1"], "line": {"width": 0}},
            error_y={
                "type": "data",
                "symmetric": False,
                "array": (monthly["yhat_upper"] - monthly["yhat"]).clip(lower=0),
                "arrayminus": (monthly["yhat"] - monthly["yhat_lower"]).clip(lower=0),
                "color": light["muted"],
                "thickness": 1.5,
                "width": 6,
            },
            text=[f"${v:,.2f}" for v in monthly["yhat"]],
            textposition="outside",
            cliponaxis=False,
            # Plotly constrains outside text to the bar's own width by default,
            # which truncates "$3.90" to "$" on a narrow bar. The label must
            # stay legible; it is the direct label the axis would otherwise
            # make the reader estimate.
            constraintext="none",
            textfont={"size": 12},
            textangle=0,
            hovertemplate="%{x}<br>Projected: $%{y:.2f}<extra></extra>",
            showlegend=False,
        )
    )
    layout = _base_layout(340)
    layout["hovermode"] = "closest"
    layout["yaxis"]["title"] = {"text": "$"}
    layout["margin"]["t"] = 34
    # These labels are month names, not timestamps. Left to autodetect, Plotly
    # parses "2026-08" as a date, switches the axis to a date scale, and then
    # silently drops the "(partial)" bars it cannot parse.
    layout["xaxis"]["type"] = "category"
    # Headroom so labels and the upper error whisker clear the plot edge.
    headroom = float(monthly["yhat_upper"].max()) * 1.18
    if np.isfinite(headroom) and headroom > 0:
        layout["yaxis"]["range"] = [0, headroom]
    fig.update_layout(**layout)
    return Figure(id="fig-monthly-cost", fig=fig, roles={0: {"marker.color": "series1"}})


def _heatmap_figure(calls: pd.DataFrame) -> Figure:
    """Call volume by weekday x hour — where the traffic actually lands."""
    import plotly.graph_objects as go

    light = THEME["light"]
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    grid = np.zeros((7, 24), dtype=float)
    for ts in calls["ts"]:
        grid[ts.dayofweek, ts.hour] += 1

    fig = go.Figure(
        go.Heatmap(
            z=grid,
            x=[f"{h:02d}" for h in range(24)],
            y=days,
            colorscale=[[i / (len(light["seq"]) - 1), c] for i, c in enumerate(light["seq"])],
            zmin=0,
            hovertemplate="%{y} %{x}:00<br>%{z:.0f} calls<extra></extra>",
            colorbar={
                "title": {"text": "calls", "font": {"size": 11}},
                "thickness": 10,
                "len": 0.8,
                "outlinewidth": 0,
                "tickfont": {"size": 11},
            },
            xgap=2,
            ygap=2,
        )
    )
    layout = _base_layout(300)
    layout["hovermode"] = "closest"
    layout["yaxis"]["autorange"] = "reversed"
    layout["yaxis"]["showgrid"] = False
    layout["yaxis"]["type"] = "category"
    layout["xaxis"]["title"] = {"text": "hour of day"}
    # Hour labels are zero-padded strings ("00".."23"); pin the axis to
    # categories so they are not coerced onto a numeric scale.
    layout["xaxis"]["type"] = "category"
    fig.update_layout(**layout)
    return Figure(id="fig-heatmap", fig=fig, roles={})


def _leaderboard_figure(leaderboard: pd.DataFrame, target: str) -> Figure | None:
    """Model accuracy comparison — one series, so one colour, no legend."""
    import plotly.graph_objects as go

    light = THEME["light"]
    board = leaderboard.loc[leaderboard["status"] == "ok"].copy()
    if board.empty:
        return None
    board = board.sort_values("mae", ascending=False)

    fig = go.Figure(
        go.Bar(
            x=board["mae"],
            y=board["label"],
            orientation="h",
            marker={"color": light["series1"], "line": {"width": 0}},
            text=[f"{v:.2f}" for v in board["mae"]],
            textposition="outside",
            cliponaxis=False,
            constraintext="none",
            textfont={"size": 12},
            hovertemplate="%{y}<br>MAE: %{x:.3f}<extra></extra>",
            showlegend=False,
        )
    )
    layout = _base_layout(max(220, 46 * len(board)))
    layout["hovermode"] = "closest"
    layout["margin"]["l"] = 170
    layout["margin"]["r"] = 72
    layout["xaxis"]["title"] = {"text": f"Mean absolute error ({TARGET_UNITS.get(target, '')})"}
    layout["xaxis"]["showgrid"] = True
    layout["yaxis"]["showgrid"] = False
    layout["yaxis"]["type"] = "category"
    fig.update_layout(**layout)
    return Figure(
        id=f"fig-leaderboard-{target}", fig=fig, roles={0: {"marker.color": "series1"}}
    )


def _importance_figure(explanation, target: str) -> Figure | None:
    """Top drivers of the forecast, ranked across available methods."""
    import plotly.graph_objects as go

    light = THEME["light"]
    top = explanation.top_features(10)
    if top.empty:
        return None

    column = "shap" if "shap" in top.columns else (
        "permutation" if "permutation" in top.columns else "native"
    )
    data = top.sort_values(column)

    fig = go.Figure(
        go.Bar(
            x=data[column],
            y=data["feature"],
            orientation="h",
            marker={"color": light["series1"], "line": {"width": 0}},
            hovertemplate="%{y}<br>relative importance: %{x:.3f}<extra></extra>",
            showlegend=False,
        )
    )
    layout = _base_layout(max(260, 30 * len(data)))
    layout["hovermode"] = "closest"
    layout["margin"]["l"] = 220
    layout["xaxis"]["title"] = {"text": f"relative importance ({column})"}
    layout["xaxis"]["showgrid"] = True
    layout["yaxis"]["showgrid"] = False
    layout["yaxis"]["type"] = "category"
    fig.update_layout(**layout)
    return Figure(
        id=f"fig-importance-{target}", fig=fig, roles={0: {"marker.color": "series1"}}
    )


def _anomaly_figure(daily: pd.DataFrame, anomalies: pd.DataFrame) -> Figure:
    """Volume history with flagged days marked by severity."""
    import plotly.graph_objects as go

    light = THEME["light"]
    volume = daily["call_volume"].astype(float)

    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=volume.index,
            y=volume.to_numpy(),
            mode="lines",
            name="Daily calls",
            line={"color": light["series1"], "width": 2},
            hovertemplate="%{x|%a %d %b}<br>%{y:.0f} calls<extra></extra>",
        )
    )

    roles: dict[int, dict[str, str]] = {0: {"line.color": "series1"}}
    for i, severity in enumerate(("critical", "warning"), start=1):
        subset = anomalies.loc[anomalies["severity"] == severity]
        if subset.empty:
            continue
        dates = pd.DatetimeIndex(subset["date"].unique())
        values = volume.reindex(dates)
        fig.add_trace(
            go.Scatter(
                x=dates,
                y=values.to_numpy(),
                mode="markers",
                name=f"{SEVERITY_ICON[severity]} {severity.title()}",
                marker={
                    "size": 11,
                    "color": light[severity],
                    "symbol": "diamond" if severity == "warning" else "triangle-up",
                    "line": {"width": 2, "color": light["surface"]},
                },
                hovertemplate="%{x|%a %d %b}<br>" + severity + " alert<extra></extra>",
            )
        )
        roles[len(fig.data) - 1] = {"marker.line.color": "surface"}

    layout = _base_layout(320)
    layout["yaxis"]["title"] = {"text": "calls"}
    fig.update_layout(**layout)
    return Figure(id="fig-anomalies", fig=fig, roles=roles)


# --------------------------------------------------------------------------- #
#  HTML building blocks                                                        #
# --------------------------------------------------------------------------- #
def _esc(text: Any) -> str:
    """HTML-escape a value for safe interpolation."""
    return html.escape(str(text), quote=True)


def _plotly_bundle() -> str:
    """
    Return the Plotly JavaScript bundle to inline.

    The accessor has moved between Plotly majors — it lives in
    ``plotly.offline`` on 6.x and was exposed on ``plotly.io`` on 5.x — so both
    locations are tried before giving up. Inlining is what makes the dashboard
    work with no network access; a CDN tag would leave it blank offline.
    """
    try:
        from plotly.offline import get_plotlyjs

        return get_plotlyjs()
    except (ImportError, AttributeError):
        pass
    try:
        import plotly.io as pio

        return pio.get_plotlyjs()          # type: ignore[attr-defined]
    except (ImportError, AttributeError) as exc:  # pragma: no cover
        raise RuntimeError(
            "Could not locate the Plotly JavaScript bundle. Install a supported "
            "release with `pip install 'plotly>=5,<7'`."
        ) from exc


def _table(frame: pd.DataFrame, max_rows: int = 400, numeric_format: str = "{:,.3f}") -> str:
    """Render a DataFrame as an accessible HTML table."""
    if frame is None or frame.empty:
        return '<p class="empty">No rows.</p>'

    view = frame.head(max_rows)
    head = "".join(f"<th scope='col'>{_esc(c)}</th>" for c in view.columns)

    rows = []
    for _, row in view.iterrows():
        cells = []
        for value in row:
            if isinstance(value, (int, np.integer)):
                cells.append(f"<td class='num'>{value:,}</td>")
            elif isinstance(value, (float, np.floating)):
                cells.append(
                    "<td class='num'>—</td>" if not np.isfinite(value)
                    else f"<td class='num'>{numeric_format.format(value)}</td>"
                )
            elif isinstance(value, (pd.Timestamp, datetime)):
                cells.append(f"<td>{value:%Y-%m-%d}</td>")
            else:
                cells.append(f"<td>{_esc(value)}</td>")
        rows.append("<tr>" + "".join(cells) + "</tr>")

    note = (
        f"<p class='empty'>Showing first {max_rows} of {len(frame)} rows.</p>"
        if len(frame) > max_rows else ""
    )
    return (
        f"<div class='table-wrap'><table><thead><tr>{head}</tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table></div>{note}"
    )


def _table_view(frame: pd.DataFrame, label: str = "View as table", **kwargs) -> str:
    """A chart's table-view twin, behind a disclosure triangle."""
    return (
        f"<details class='tableview'><summary>{_esc(label)}</summary>"
        f"{_table(frame, **kwargs)}</details>"
    )


def _stat_tile(label: str, value: str, sub: str = "", tone: str = "") -> str:
    """A single headline number. The number is the chart."""
    tone_class = f" tone-{tone}" if tone else ""
    sub_html = f"<div class='tile-sub'>{_esc(sub)}</div>" if sub else ""
    return (
        f"<div class='tile{tone_class}'><div class='tile-label'>{_esc(label)}</div>"
        f"<div class='tile-value'>{_esc(value)}</div>{sub_html}</div>"
    )


def _callout(text: str, tone: str = "info", icon: str = "●") -> str:
    """A status message carrying an icon and a label, never colour alone."""
    return (
        f"<div class='callout tone-{_esc(tone)}'>"
        f"<span class='callout-icon' aria-hidden='true'>{icon}</span>"
        f"<span class='callout-label'>{_esc(tone.title())}</span>"
        f"<span class='callout-text'>{_esc(text)}</span></div>"
    )


def _sidenav(tabs: Sequence[tuple[str, str]]) -> str:
    """
    The left-hand model rail.

    ``tabs`` is ``(anchor id, label)`` in the order the forecast cards appear.
    The rail is presentational for now — selecting a tab marks it current and
    scrolls to its card; it does not yet filter the page down to one model.
    """
    if not tabs:
        return ""
    buttons = "".join(
        "<button type='button' class='navtab' "
        f"data-target='{_esc(anchor)}'{current}>{_esc(label)}</button>"
        for current, (anchor, label) in (
            (" aria-current='true'" if i == 0 else "", tab)
            for i, tab in enumerate(tabs)
        )
    )
    return (
        "<nav class='sidenav' aria-label='Models'>"
        "<div class='sidenav-title'>Models</div>"
        f"<div class='navtabs'>{buttons}</div>"
        "</nav>"
    )


def _section(title: str, body: str, blurb: str = "") -> str:
    """A titled dashboard section."""
    blurb_html = f"<p class='blurb'>{_esc(blurb)}</p>" if blurb else ""
    return (
        f"<section><h2>{_esc(title)}</h2>{blurb_html}{body}</section>"
    )


def _card(body: str, title: str = "", anchor: str = "") -> str:
    """A surface card wrapping a chart and its table view."""
    title_html = f"<h3>{_esc(title)}</h3>" if title else ""
    id_html = f" id='{_esc(anchor)}'" if anchor else ""
    return f"<div class='card'{id_html}>{title_html}{body}</div>"


# --------------------------------------------------------------------------- #
#  CSS / JS                                                                    #
# --------------------------------------------------------------------------- #
def _stylesheet() -> str:
    """Theme-aware stylesheet, with both modes explicitly selected."""
    light, dark = THEME["light"], THEME["dark"]

    def variables(theme: Mapping[str, Any]) -> str:
        return "\n".join(
            f"      --{key}: {value};"
            for key, value in theme.items()
            if isinstance(value, str)
        )

    return f"""
:root {{
  color-scheme: light;
{variables(light)}
  --radius: 10px;
  --maxw: 1420px;
  --rail: 248px;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    color-scheme: dark;
{variables(dark)}
  }}
}}
:root[data-theme="dark"] {{
  color-scheme: dark;
{variables(dark)}
}}

* {{ box-sizing: border-box; }}
body {{
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.55;
}}
.wrap {{ max-width: var(--maxw); margin: 0 auto; padding: 28px 20px 72px; }}

header.top {{
  display: flex; flex-wrap: wrap; gap: 16px;
  align-items: baseline; justify-content: space-between;
  border-bottom: 1px solid var(--border); padding-bottom: 18px; margin-bottom: 26px;
}}
header.top h1 {{ font-size: 26px; margin: 0; letter-spacing: -0.01em; }}
header.top .meta {{ color: var(--muted); font-size: 13px; }}

#theme-toggle {{
  background: var(--surface); color: var(--ink2);
  border: 1px solid var(--border); border-radius: 999px;
  padding: 6px 14px; font: inherit; font-size: 13px; cursor: pointer;
}}
#theme-toggle:hover {{ color: var(--ink); }}

/* Two-column shell: a sticky model rail, then the report itself. The content
   column is minmax(0, 1fr) rather than 1fr so a wide table or Plotly figure
   cannot force the grid — and with it the page — into horizontal overflow. */
.layout {{
  display: grid;
  grid-template-columns: var(--rail) minmax(0, 1fr);
  gap: 34px;
  align-items: start;
}}
main {{ min-width: 0; }}

.sidenav {{ position: sticky; top: 24px; }}
.sidenav-title {{
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); font-weight: 600; margin: 0 0 10px 12px;
}}
.navtabs {{ display: flex; flex-direction: column; gap: 4px; }}

.navtab {{
  appearance: none;
  display: block; width: 100%; text-align: left;
  background: transparent; color: var(--ink2);
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 9px 12px;
  font: inherit; font-size: 13.5px; line-height: 1.35;
  cursor: pointer;
}}
.navtab:hover {{ background: var(--surface); color: var(--ink); }}
.navtab:focus-visible {{ outline: 2px solid var(--series1); outline-offset: 2px; }}
/* Selection is carried by the weight, the surface and the left bar together —
   never by hue alone. */
.navtab[aria-current="true"] {{
  background: var(--surface);
  border-color: var(--border);
  border-left: 3px solid var(--series1);
  padding-left: 10px;
  color: var(--ink);
  font-weight: 600;
}}

section {{ margin: 36px 0; }}
section:first-child {{ margin-top: 0; }}
section > h2 {{
  font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); font-weight: 600; margin: 0 0 6px;
}}
.blurb {{ color: var(--ink2); margin: 0 0 16px; max-width: 78ch; font-size: 14px; }}

.card {{
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 18px 18px 12px; margin-bottom: 16px;
}}
.card h3 {{ font-size: 15px; margin: 0 0 12px; font-weight: 600; }}

.grid {{ display: grid; gap: 14px; }}
.grid-2 {{ grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }}
.tiles {{ display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }}

.tile {{
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px 18px;
}}
.tile-label {{ color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }}
.tile-value {{ font-size: 30px; font-weight: 600; letter-spacing: -0.02em; margin-top: 4px; }}
.tile-sub {{ color: var(--ink2); font-size: 13px; margin-top: 2px; }}
.tile.tone-critical .tile-value {{ color: var(--critical); }}
.tile.tone-good .tile-value {{ color: var(--good); }}

.callout {{
  display: flex; gap: 10px; align-items: baseline;
  border: 1px solid var(--border); border-left-width: 3px;
  border-radius: 8px; padding: 10px 14px; margin: 8px 0;
  background: var(--surface); font-size: 14px;
}}
.callout-icon {{ font-size: 12px; }}
.callout-label {{ font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }}
.callout-text {{ color: var(--ink2); }}
.callout.tone-critical {{ border-left-color: var(--critical); }}
.callout.tone-critical .callout-icon, .callout.tone-critical .callout-label {{ color: var(--critical); }}
.callout.tone-warning {{ border-left-color: var(--warning); }}
.callout.tone-warning .callout-icon, .callout.tone-warning .callout-label {{ color: var(--serious); }}
.callout.tone-good {{ border-left-color: var(--good); }}
.callout.tone-good .callout-icon, .callout.tone-good .callout-label {{ color: var(--good); }}
.callout.tone-info {{ border-left-color: var(--series1); }}
.callout.tone-info .callout-icon, .callout.tone-info .callout-label {{ color: var(--series1); }}

details.tableview {{ margin-top: 8px; border-top: 1px solid var(--border); padding-top: 8px; }}
details.tableview summary {{
  cursor: pointer; color: var(--muted); font-size: 13px; list-style: revert;
}}
details.tableview summary:hover {{ color: var(--ink2); }}

.table-wrap {{ overflow-x: auto; margin-top: 10px; }}
table {{ border-collapse: collapse; width: 100%; font-size: 13px; }}
th, td {{
  text-align: left; padding: 7px 12px 7px 0;
  border-bottom: 1px solid var(--border); white-space: nowrap;
}}
th {{ color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }}
td.num {{ text-align: right; font-variant-numeric: tabular-nums; padding-right: 18px; }}
th:last-child, td:last-child {{ padding-right: 0; }}
.empty {{ color: var(--muted); font-size: 13px; font-style: italic; }}

footer {{
  margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--border);
  color: var(--muted); font-size: 12.5px;
}}
footer ul {{ margin: 8px 0; padding-left: 20px; }}
footer li {{ margin: 4px 0; }}

/* Below the two-column threshold the rail becomes a scrolling strip above the
   report rather than a squeezed column. */
@media (max-width: 900px) {{
  .layout {{ grid-template-columns: minmax(0, 1fr); gap: 20px; }}
  .sidenav {{ position: static; }}
  .navtabs {{
    flex-direction: row; overflow-x: auto;
    gap: 8px; padding-bottom: 6px;
  }}
  .navtab {{
    width: auto; flex: 0 0 auto; white-space: nowrap;
    border-color: var(--border); background: var(--surface);
  }}
  .navtab[aria-current="true"] {{ border-left-width: 3px; }}
}}

@media (max-width: 640px) {{
  .tile-value {{ font-size: 25px; }}
  header.top h1 {{ font-size: 21px; }}
}}
"""


def _script(figures: Sequence[Figure]) -> str:
    """Theme toggle that restyles every Plotly figure from its role map."""
    role_map = {f.id: {str(k): v for k, v in f.roles.items()} for f in figures}
    return f"""
const THEME = {json.dumps({k: v for k, v in THEME.items()})};
const FIGURE_ROLES = {json.dumps(role_map)};

function currentMode() {{
  const stamped = document.documentElement.getAttribute('data-theme');
  if (stamped) return stamped;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}}

function styleFigures(mode) {{
  const t = THEME[mode];
  Object.entries(FIGURE_ROLES).forEach(([id, roles]) => {{
    const el = document.getElementById(id);
    if (!el || !el.data) return;

    Plotly.relayout(el, {{
      'font.color': t.ink2,
      'xaxis.gridcolor': t.grid, 'xaxis.linecolor': t.axis, 'xaxis.tickcolor': t.axis,
      'yaxis.gridcolor': t.grid, 'yaxis.linecolor': t.axis, 'yaxis.tickcolor': t.axis,
    }});

    Object.entries(roles).forEach(([traceIndex, props]) => {{
      Object.entries(props).forEach(([prop, role]) => {{
        Plotly.restyle(el, {{ [prop]: t[role] }}, [parseInt(traceIndex, 10)]);
      }});
    }});
  }});
}}

function applyTheme(mode) {{
  document.documentElement.setAttribute('data-theme', mode);
  const button = document.getElementById('theme-toggle');
  if (button) button.textContent = mode === 'dark' ? 'Light mode' : 'Dark mode';
  styleFigures(mode);
}}

// Model rail. Presentational for now: selecting a tab marks it current and
// brings its card into view. Nothing is filtered or hidden yet.
function wireModelTabs() {{
  const tabs = Array.from(document.querySelectorAll('.navtab'));
  tabs.forEach((tab) => {{
    tab.addEventListener('click', () => {{
      tabs.forEach((other) => other.removeAttribute('aria-current'));
      tab.setAttribute('aria-current', 'true');
      const card = document.getElementById(tab.dataset.target || '');
      if (card) card.scrollIntoView({{ behavior: 'smooth', block: 'start' }});
    }});
  }});
}}

document.addEventListener('DOMContentLoaded', () => {{
  wireModelTabs();
  const button = document.getElementById('theme-toggle');
  if (button) {{
    button.addEventListener('click', () => {{
      applyTheme(currentMode() === 'dark' ? 'light' : 'dark');
    }});
  }}
  // Follow the OS until the viewer expresses a preference of their own.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {{
    if (!document.documentElement.hasAttribute('data-theme')) {{
      styleFigures(e.matches ? 'dark' : 'light');
    }}
  }});
  styleFigures(currentMode());
  if (button) button.textContent = currentMode() === 'dark' ? 'Light mode' : 'Dark mode';
}});
"""


# --------------------------------------------------------------------------- #
#  Assembly                                                                    #
# --------------------------------------------------------------------------- #
def build_dashboard(
    output_path: Path,
    calls: pd.DataFrame,
    daily: pd.DataFrame,
    evaluations: Mapping[str, Any],
    forecasts: Mapping[str, Any],
    anomaly_report,
    explanations: Mapping[str, Any],
    scenario_table: pd.DataFrame,
    scenario_notes: Sequence[str],
    ingestion_report,
    cfg: AppConfig | None = None,
) -> Path:
    """
    Render every artefact of a pipeline run into one HTML file.

    Parameters mirror the pipeline's outputs; each section degrades gracefully
    when its input is missing, so a partial run still produces a readable page.

    Returns
    -------
    pathlib.Path
        The written file.
    """
    import plotly.graph_objects as go
    import plotly.io as pio

    cfg = cfg or AppConfig.default()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    figures: list[Figure] = []
    parts: list[str] = []
    #: (card anchor id, label) per forecast, in card order — drives the rail.
    tabs: list[tuple[str, str]] = []

    # -- header ------------------------------------------------------------- #
    generated = datetime.now().strftime("%d %b %Y, %H:%M")
    span = (
        f"{ingestion_report.date_min:%d %b %Y} – {ingestion_report.date_max:%d %b %Y}"
        if ingestion_report.date_min is not None else "unknown range"
    )
    header_html = (
        f"""<header class="top">
  <div>
    <h1>Call Analytics Forecast</h1>
    <div class="meta">{_esc(span)} · {ingestion_report.rows_kept:,} calls ·
      {ingestion_report.active_days} active of {ingestion_report.calendar_days} days
      ({ingestion_report.coverage_pct:.0f}% coverage) · generated {_esc(generated)}</div>
  </div>
  <button id="theme-toggle" type="button">Dark mode</button>
</header>"""
    )

    # -- data-quality banner ------------------------------------------------- #
    quality: list[str] = []
    if ingestion_report.coverage_pct < 60:
        quality.append(
            _callout(
                f"Only {ingestion_report.active_days} of "
                f"{ingestion_report.calendar_days} days contain calls. The series "
                "is intermittent, so percentage errors are unstable and models are "
                "ranked on MASE instead.",
                "warning", SEVERITY_ICON["warning"],
            )
        )
    if ingestion_report.calendar_days < 120:
        quality.append(
            _callout(
                f"{ingestion_report.calendar_days} days of history. Weekly patterns "
                "are estimable; seasonal and monthly patterns are not. Treat "
                "60- and 90-day figures as directional.",
                "warning", SEVERITY_ICON["warning"],
            )
        )
    for warning in ingestion_report.warnings[:4]:
        quality.append(_callout(warning, "info", SEVERITY_ICON["info"]))
    if quality:
        parts.append(_section("Data quality", "".join(quality)))

    # -- alert summary ------------------------------------------------------- #
    anomalies = anomaly_report.to_frame()
    by_rule = anomaly_report.by_rule()

    critical = int((anomalies["severity"] == "critical").sum()) if not anomalies.empty else 0
    warnings_n = int((anomalies["severity"] == "warning").sum()) if not anomalies.empty else 0

    tiles = [
        _stat_tile("Calls in period", f"{ingestion_report.rows_kept:,}",
                   f"{ingestion_report.rows_kept / max(ingestion_report.calendar_days, 1):.1f}/day average"),
    ]
    if "call_volume" in forecasts:
        result = forecasts["call_volume"]
        total = result.total(30)
        tiles.append(
            _stat_tile("Next 30 days", f"{total['total']:,.0f} calls",
                       f"{total['lower']:,.0f}–{total['upper']:,.0f} at "
                       f"{int(result.interval_level * 100)}%")
        )
    if "total_cost" in forecasts:
        result = forecasts["total_cost"]
        total = result.total(30)
        tiles.append(
            _stat_tile("30-day cost", f"${total['total']:,.2f}",
                       f"${total['lower']:,.2f}–${total['upper']:,.2f}")
        )
    if "avg_duration_sec" in forecasts:
        result = forecasts["avg_duration_sec"]
        avg = result.mean(30)
        tiles.append(_stat_tile("Avg duration", f"{avg['mean']:,.0f}s", "forecast, next 30 days"))

    tiles.append(
        _stat_tile("Alerts raised", f"{critical + warnings_n}",
                   f"{critical} critical · {warnings_n} warning",
                   "critical" if critical else "")
    )
    parts.append(_section("At a glance", f"<div class='tiles'>{''.join(tiles)}</div>"))

    # -- forecasts ----------------------------------------------------------- #
    if forecasts:
        blocks: list[str] = []
        for i, (target, result) in enumerate(forecasts.items()):
            figure = _forecast_figure(daily, result, target, i)
            figures.append(figure)

            table = result.daily[["yhat", "yhat_lower", "yhat_upper", "horizon_bucket"]].copy()
            table.insert(0, "date", table.index)
            table = table.reset_index(drop=True)

            horizon_rows = []
            for days in cfg.forecast.horizons:
                if target == "avg_duration_sec":
                    stats = result.mean(days)
                    horizon_rows.append(
                        {"horizon": f"{days} days", "measure": "daily average",
                         "forecast": stats["mean"], "lower": stats["lower"],
                         "upper": stats["upper"]}
                    )
                else:
                    stats = result.total(days)
                    horizon_rows.append(
                        {"horizon": f"{days} days", "measure": "total",
                         "forecast": stats["total"], "lower": stats["lower"],
                         "upper": stats["upper"]}
                    )

            notes_html = "".join(
                _callout(note, "info", SEVERITY_ICON["info"]) for note in result.notes
            )
            label = f"{TARGET_LABELS.get(target, target)} — {result.model_label}"
            anchor = f"model-{target}"
            tabs.append((anchor, label))
            blocks.append(
                _card(
                    f"<div id='{figure.id}' class='plot'></div>"
                    + _table(pd.DataFrame(horizon_rows))
                    + notes_html
                    + _table_view(table, "View full daily forecast as table"),
                    label,
                    anchor,
                )
            )
        parts.append(
            _section(
                "Forecasts",
                "".join(blocks),
                f"Each model was refitted on all history, then rolled forward "
                f"{max(cfg.forecast.horizons)} days. The shaded band is a "
                f"{int(cfg.forecast.interval_level * 100)}% interval calibrated on "
                "out-of-sample backtest error, so it widens with horizon.",
            )
        )

    # -- monthly cost -------------------------------------------------------- #
    if "total_cost" in forecasts:
        figure = _monthly_cost_figure(forecasts["total_cost"])
        figures.append(figure)
        monthly = forecasts["total_cost"].monthly
        parts.append(
            _section(
                "Monthly cost projection",
                _card(
                    f"<div id='{figure.id}' class='plot'></div>"
                    + _table_view(
                        monthly[["month", "days_forecast", "partial_month",
                                 "yhat", "yhat_lower", "yhat_upper"]],
                        "View monthly projection as table",
                    )
                ),
                "Monthly bounds come from simulated forecast trajectories rather "
                "than summing daily bounds, which would describe a month where "
                "every day independently hits its worst case. Partial months are "
                "labelled — they cover only part of the calendar month.",
            )
        )

    # -- historical pattern -------------------------------------------------- #
    figure = _heatmap_figure(calls)
    figures.append(figure)
    hourly = (
        calls.assign(weekday=calls["ts"].dt.day_name(), hour=calls["ts"].dt.hour)
        .groupby(["weekday", "hour"], as_index=False)
        .size()
        .rename(columns={"size": "calls"})
        .sort_values("calls", ascending=False)
    )
    parts.append(
        _section(
            "When calls arrive",
            _card(
                f"<div id='{figure.id}' class='plot'></div>"
                + _table_view(hourly, "View weekday x hour counts as table")
            ),
            "Every call in the dataset, bucketed by weekday and hour. This is what "
            "drives the after-hours features and the overnight-activity alert.",
        )
    )

    # -- model comparison ---------------------------------------------------- #
    if evaluations:
        blocks = []
        for target, evaluation in evaluations.items():
            if evaluation.leaderboard.empty:
                continue
            figure = _leaderboard_figure(evaluation.leaderboard, target)
            plot_html = ""
            if figure is not None:
                figures.append(figure)
                plot_html = f"<div id='{figure.id}' class='plot'></div>"

            columns = [
                c for c in ["label", "status", "n_folds", "mae", "rmse", "r2",
                            "mape", "mape_n", "smape", "mase", "bias",
                            "beats_baseline", "note"]
                if c in evaluation.leaderboard.columns
            ]
            note_html = "".join(
                _callout(note, "info", SEVERITY_ICON["info"]) for note in evaluation.notes
            )
            winner = (
                f"Selected: <strong>{_esc(evaluation.best_model or 'none')}</strong> "
                f"(lowest {_esc(evaluation.selection_metric.upper())} over "
                f"{evaluation.n_folds} folds of {evaluation.horizon} days)"
            )
            blocks.append(
                _card(
                    f"<p class='blurb'>{winner}</p>{plot_html}"
                    + _table(evaluation.leaderboard[columns])
                    + note_html,
                    TARGET_LABELS.get(target, target),
                )
            )
        parts.append(
            _section(
                "Model comparison",
                "".join(blocks),
                "Every model was scored by walk-forward validation: train to a "
                "cut-off, forecast forward, score against what actually happened, "
                "advance the cut-off. MASE below 1 beats a seasonal-naive forecast; "
                "at or above 1 it does not.",
            )
        )

    # -- explainability ------------------------------------------------------ #
    if explanations:
        blocks = []
        for target, explanation in explanations.items():
            figure = _importance_figure(explanation, target)
            plot_html = ""
            if figure is not None:
                figures.append(figure)
                plot_html = f"<div id='{figure.id}' class='plot'></div>"

            notes_html = "".join(
                _callout(note, "info", SEVERITY_ICON["info"])
                for note in explanation.notes[:4]
            )
            table_html = ""
            top = explanation.top_features(12)
            if not top.empty:
                table_html = _table_view(top, "View importance ranking as table")

            blocks.append(
                _card(
                    f"<p class='blurb'>{_esc(explanation.summary_text())}</p>"
                    + plot_html + table_html + notes_html,
                    f"{TARGET_LABELS.get(target, target)} — {explanation.model_label}",
                )
            )
        parts.append(
            _section(
                "What drives the forecast",
                "".join(blocks),
                "Rankings combine SHAP attribution, permutation importance and the "
                "model's native importance. SHAP is the one that explains an "
                "individual day rather than an average.",
            )
        )

    # -- anomalies ----------------------------------------------------------- #
    figure = _anomaly_figure(daily, anomalies)
    figures.append(figure)

    summary_html = ""
    if not by_rule.empty:
        summary_html = _table(by_rule, numeric_format="{:,.0f}")
    recent = anomalies.head(25) if not anomalies.empty else anomalies
    parts.append(
        _section(
            "Anomalies and alerts",
            _card(
                f"<div id='{figure.id}' class='plot'></div>"
                + summary_html
                + _table_view(recent, "View the 25 most recent alerts")
            ),
            f"Cost overruns above {cfg.anomalies.cost_overrun_pct:.0%}, duration and "
            f"missed-call spikes beyond {cfg.anomalies.duration_sigma:g} sigma, "
            "overnight activity, and robust-z outliers. Every baseline is trailing "
            "and weekday-aware, so no day contributes to its own expectation.",
        )
    )

    # -- scenarios ----------------------------------------------------------- #
    if scenario_table is not None and not scenario_table.empty:
        notes_html = "".join(
            _callout(note, "info", SEVERITY_ICON["info"]) for note in scenario_notes
        )
        parts.append(
            _section(
                "Scenario analysis",
                _card(_table(scenario_table, numeric_format="{:,.2f}") + notes_html),
                "Cost scales with volume; wait time, staffing and missed calls do "
                "not — they come from Erlang C and Erlang A queueing models, "
                "because near capacity a small volume rise produces a "
                "disproportionate jump in wait.",
            )
        )

    # -- footer -------------------------------------------------------------- #
    parts.append(
        f"""<footer>
  <p><strong>How to read this.</strong> Point forecasts are the model's best single
  guess; intervals show the range that backtest error suggests. Where history is
  short, the interval is the honest part of the answer.</p>
  <ul>
    <li>Interval level: {int(cfg.forecast.interval_level * 100)}% ·
        simulated from {cfg.forecast.n_simulations:,} bootstrap trajectories</li>
    <li>Validation: rolling origin, {cfg.cv.horizon}-day horizon,
        selection on {_esc(cfg.cv.selection_metric.upper())}</li>
    <li>Holiday calendar: {_esc(cfg.data.holiday_country)}
        {_esc(cfg.data.holiday_subdiv or '')}</li>
    <li>Business hours: {cfg.business_hours.start_hour:02d}:00–{cfg.business_hours.end_hour:02d}:00 ·
        overnight window {cfg.business_hours.overnight_start_hour:02d}:00–{cfg.business_hours.overnight_end_hour:02d}:00</li>
  </ul>
  <p>Generated by call_forecast · {_esc(generated)}</p>
</footer>"""
    )

    # -- render -------------------------------------------------------------- #
    # With no forecasts there is nothing to name a tab after, so the report
    # falls back to a single full-width column rather than an empty rail.
    rail = _sidenav(tabs)
    body_html = (
        f"<div class='layout'>{rail}<main>{''.join(parts)}</main></div>"
        if rail else f"<main>{''.join(parts)}</main>"
    )

    plotly_js = _plotly_bundle()
    figure_scripts = []
    for figure in figures:
        spec = json.loads(pio.to_json(figure.fig))
        figure_scripts.append(
            f"Plotly.newPlot({json.dumps(figure.id)}, "
            f"{json.dumps(spec['data'])}, {json.dumps(spec['layout'])}, "
            "{responsive: true, displayModeBar: false});"
        )

    document = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Call Analytics Forecast</title>
<style>{_stylesheet()}</style>
</head>
<body>
<div class="wrap">
{header_html}
{body_html}
</div>
<script>{plotly_js}</script>
<script>
{chr(10).join(figure_scripts)}
</script>
<script>{_script(figures)}</script>
</body>
</html>"""

    output_path.write_text(document, encoding="utf-8")
    log.info("Dashboard written to %s (%.1f MB)", output_path,
             output_path.stat().st_size / 1e6)
    return output_path
