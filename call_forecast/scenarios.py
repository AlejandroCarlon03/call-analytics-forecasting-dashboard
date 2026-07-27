#!/usr/bin/env python3
"""
call_forecast.scenarios
=======================
What-if analysis: if call volume rises by X%, what happens to cost, wait time,
staffing, and missed calls?

Cost scales from the forecast. Wait time, staffing and missed calls do not —
they come from queueing theory, because they are **not linear in volume**. A
10% rise in calls does not produce a 10% longer wait; near capacity it can
double it. Scaling a wait time by 1.10 would give a comfortable, wrong answer,
so this module implements the standard models instead:

``Erlang C``
    Probability an arriving call has to wait at all, given N agents and an
    offered load. Yields the average speed of answer and the service level.
``Erlang A`` (Erlang C + patience)
    Adds caller impatience, so callers who wait too long hang up. This is what
    converts a longer wait into *additional missed calls* rather than an
    indefinitely growing queue.

Assumptions, stated plainly
---------------------------
These models assume Poisson arrivals, exponentially-distributed handling times,
and a fixed number of interchangeable agents over the modelled interval. Real
call traffic is burstier than Poisson, which makes these estimates mildly
optimistic. They are sizing tools — right for "do we need a second person on
the phones?", not for promising a specific service level in a contract.

The agent count, service-level target and patience parameters all live in
``cfg.scenarios``; the defaults are placeholders and should be set to match how
the line is actually staffed.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from .config import AppConfig
from .forecast import ForecastResult

log = logging.getLogger(__name__)

__all__ = [
    "erlang_b",
    "erlang_c",
    "average_speed_of_answer",
    "service_level",
    "abandonment_rate",
    "agents_required",
    "ScenarioOutcome",
    "run_scenarios",
]


# --------------------------------------------------------------------------- #
#  Queueing primitives                                                         #
# --------------------------------------------------------------------------- #
def erlang_b(load: float, agents: int) -> float:
    """
    Erlang B blocking probability, via the numerically stable recursion.

    ``load`` is the offered traffic in erlangs (arrival rate x mean handling
    time, in consistent units). The recursive form is used rather than the
    factorial closed form, which overflows for even modest agent counts.

    >>> round(erlang_b(2.0, 3), 4)
    0.2105
    """
    if agents <= 0:
        return 1.0
    if load <= 0:
        return 0.0
    inv = 1.0
    for n in range(1, int(agents) + 1):
        inv = 1.0 + inv * n / load
    return 1.0 / inv


def erlang_c(load: float, agents: int) -> float:
    """
    Erlang C: probability that an arriving call must queue.

    Returns 1.0 when the offered load meets or exceeds the agent count — an
    unstable queue, where the wait grows without bound and every caller waits.

    >>> round(erlang_c(2.0, 3), 4)
    0.4444
    """
    agents = int(agents)
    if agents <= 0:
        return 1.0
    if load <= 0:
        return 0.0
    if load >= agents:
        return 1.0

    b = erlang_b(load, agents)
    rho = load / agents
    denominator = 1.0 - rho * (1.0 - b)
    if denominator <= 0:
        return 1.0
    return min(1.0, b / denominator)


def average_speed_of_answer(load: float, agents: int, aht_seconds: float) -> float:
    """
    Mean wait before answer, in seconds, across all callers.

    Returns ``inf`` for an unstable queue (offered load at or above capacity),
    which is the honest answer: without abandonment the queue never clears.

    >>> round(average_speed_of_answer(2.0, 3, 180), 1)
    80.0
    """
    agents = int(agents)
    if agents <= 0 or aht_seconds <= 0:
        return math.inf
    if load >= agents:
        return math.inf
    c = erlang_c(load, agents)
    return c * aht_seconds / (agents - load)


def service_level(
    load: float, agents: int, aht_seconds: float, target_seconds: float
) -> float:
    """
    Share of calls answered within ``target_seconds``.

    >>> round(service_level(2.0, 3, 180, 30), 3)
    0.624
    """
    agents = int(agents)
    if agents <= 0 or aht_seconds <= 0:
        return 0.0
    if load >= agents:
        return 0.0
    c = erlang_c(load, agents)
    exponent = -(agents - load) * target_seconds / aht_seconds
    return float(max(0.0, min(1.0, 1.0 - c * math.exp(exponent))))


def abandonment_rate(
    load: float, agents: int, aht_seconds: float, patience_rate_per_second: float
) -> float:
    """
    Share of callers who hang up before being answered.

    Derived by integrating the Erlang C waiting-time distribution against an
    exponential patience distribution with hazard rate
    ``patience_rate_per_second``:

    .. math::
        P(\\text{abandon}) = C \\cdot
        \\frac{\\theta}{\\theta + (N - a)/\\text{AHT}}

    With an unstable queue every caller eventually abandons, so the result is
    1.0 — the model's way of saying the configuration cannot work.
    """
    agents = int(agents)
    theta = max(patience_rate_per_second, 0.0)
    if theta <= 0 or agents <= 0 or aht_seconds <= 0:
        return 0.0
    if load >= agents:
        return 1.0

    c = erlang_c(load, agents)
    drain = (agents - load) / aht_seconds
    return float(min(1.0, c * theta / (theta + drain)))


def agents_required(
    load: float,
    aht_seconds: float,
    target_seconds: float,
    target_service_level: float,
    max_agents: int = 500,
) -> int:
    """
    Smallest agent count meeting the service-level goal.

    Starts from the first count that makes the queue stable (strictly more
    agents than the offered load) and increases until the target is met.

    >>> agents_required(2.0, 180, 30, 0.80)
    4
    """
    if load <= 0:
        return 0
    start = max(1, int(math.floor(load)) + 1)
    for agents in range(start, max_agents + 1):
        if service_level(load, agents, aht_seconds, target_seconds) >= target_service_level:
            return agents
    return max_agents


# --------------------------------------------------------------------------- #
#  Scenario container                                                          #
# --------------------------------------------------------------------------- #
@dataclass
class ScenarioOutcome:
    """Projected operating conditions under one volume uplift."""

    label: str
    uplift_pct: float
    daily_calls: float
    monthly_calls: float
    monthly_cost: float
    monthly_cost_lower: float
    monthly_cost_upper: float
    avg_duration_sec: float
    offered_load_erlangs: float
    current_agents: int
    required_agents: int
    avg_wait_seconds: float
    service_level_pct: float
    expected_missed_calls_daily: float
    expected_missed_pct: float
    notes: list[str] = field(default_factory=list)

    def as_row(self) -> dict:
        """Flat dict for the scenario table/CSV."""
        return {
            "scenario": self.label,
            "volume_uplift_pct": round(self.uplift_pct * 100, 1),
            "daily_calls": round(self.daily_calls, 1),
            "monthly_calls": round(self.monthly_calls, 0),
            "monthly_cost": round(self.monthly_cost, 2),
            "monthly_cost_lower": round(self.monthly_cost_lower, 2),
            "monthly_cost_upper": round(self.monthly_cost_upper, 2),
            "avg_duration_sec": round(self.avg_duration_sec, 1),
            "offered_load_erlangs": round(self.offered_load_erlangs, 3),
            "current_agents": self.current_agents,
            "required_agents": self.required_agents,
            "avg_wait_seconds": (
                None if not math.isfinite(self.avg_wait_seconds)
                else round(self.avg_wait_seconds, 1)
            ),
            "service_level_pct": round(self.service_level_pct * 100, 1),
            "expected_missed_calls_daily": round(self.expected_missed_calls_daily, 2),
            "expected_missed_pct": round(self.expected_missed_pct * 100, 1),
        }


# --------------------------------------------------------------------------- #
#  Scenario engine                                                             #
# --------------------------------------------------------------------------- #
def _baseline_inputs(
    daily: pd.DataFrame,
    forecasts: dict[str, ForecastResult],
    cfg: AppConfig,
) -> tuple[dict[str, float], list[str]]:
    """
    Assemble the baseline the scenarios perturb.

    Volume, duration and cost come from the forecast where one exists, and from
    recent history otherwise. Every fallback is recorded so the scenario table
    can say which numbers are model-driven and which are historical averages.
    """
    notes: list[str] = []
    window = cfg.features.exog_carry_forward_days
    recent = daily.tail(window)

    # -- daily volume -------------------------------------------------------- #
    if "call_volume" in forecasts:
        daily_calls = float(forecasts["call_volume"].mean(30)["mean"])
    else:
        daily_calls = float(recent["call_volume"].mean())
        notes.append("Daily volume taken from recent history (no volume forecast).")

    # -- handling time ------------------------------------------------------- #
    if "avg_duration_sec" in forecasts:
        aht = float(forecasts["avg_duration_sec"].mean(30)["mean"])
    else:
        aht = float(recent["avg_duration_sec"].mean())
        notes.append("Handling time taken from recent history (no duration forecast).")
    if not np.isfinite(aht) or aht <= 0:
        aht = float(daily["avg_duration_sec"].mean())
        notes.append("Handling time fell back to the full-history average.")
    aht = float(np.nan_to_num(aht, nan=60.0)) or 60.0

    # -- cost per call ------------------------------------------------------- #
    observed_cost = float(recent["total_cost"].sum())
    observed_calls = float(recent["call_volume"].sum())
    cost_per_call = observed_cost / observed_calls if observed_calls > 0 else 0.0
    if cost_per_call <= 0:
        notes.append("Cost per call could not be derived from recent history.")

    # -- structural missed rate ---------------------------------------------- #
    missed = float(recent["missed_calls"].sum())
    missed_rate = missed / observed_calls if observed_calls > 0 else 0.0

    # -- business-hours concentration ---------------------------------------- #
    share = float(recent["business_hours_share"].mean())
    if not np.isfinite(share) or share <= 0:
        share = 1.0

    return (
        {
            "daily_calls": daily_calls,
            "aht_seconds": aht,
            "cost_per_call": cost_per_call,
            "missed_rate": missed_rate,
            "business_hours_share": share,
        },
        notes,
    )


def _evaluate(
    uplift: float,
    baseline: dict[str, float],
    forecasts: dict[str, ForecastResult],
    cfg: AppConfig,
    baseline_abandon: float | None,
) -> ScenarioOutcome:
    """Evaluate one uplift against the queueing and cost models."""
    sc = cfg.scenarios
    notes: list[str] = []

    daily_calls = baseline["daily_calls"] * (1.0 + uplift)
    aht = baseline["aht_seconds"]
    days_per_month = 30.44          # mean Gregorian month

    # -- cost ---------------------------------------------------------------- #
    # Prefer the simulated monthly cost distribution, scaled by the uplift,
    # over multiplying a point estimate: it carries the model's own uncertainty.
    monthly_calls = daily_calls * days_per_month
    if "total_cost" in forecasts:
        totals = forecasts["total_cost"].total(30)
        scale = (1.0 + uplift) * days_per_month / 30.0
        monthly_cost = totals["total"] * scale
        cost_lower = totals["lower"] * scale
        cost_upper = totals["upper"] * scale
    else:
        monthly_cost = monthly_calls * baseline["cost_per_call"]
        cost_lower = cost_upper = monthly_cost
        notes.append("Monthly cost estimated from cost-per-call (no cost forecast).")

    # -- offered load -------------------------------------------------------- #
    # Calls concentrated in the staffed window drive the queue, so scale by the
    # business-hours share rather than spreading volume across 24 hours.
    in_hours_calls = daily_calls * baseline["business_hours_share"]
    hours = max(sc.staffed_hours_per_day, 0.1)
    arrival_per_hour = in_hours_calls / hours
    load = arrival_per_hour * (aht / 3600.0)

    current = int(sc.current_agents)
    required = agents_required(load, aht, sc.target_answer_seconds, sc.service_level_pct)
    wait = average_speed_of_answer(load, current, aht)
    sl = service_level(load, current, aht, sc.target_answer_seconds)

    # -- missed calls -------------------------------------------------------- #
    # The historical missed rate already includes whatever abandonment happens
    # at today's load, so only the *incremental* queue abandonment is added.
    # Adding the full modelled abandonment on top would double-count it.
    abandon = abandonment_rate(load, current, aht, sc.abandon_rate_per_second)
    incremental = max(0.0, abandon - (baseline_abandon or 0.0))
    missed_rate = min(1.0, baseline["missed_rate"] + incremental)
    missed_calls = daily_calls * missed_rate

    if load >= current:
        notes.append(
            f"Offered load ({load:.2f} erlangs) meets or exceeds the "
            f"{current} configured agent(s): the queue is unstable, so wait "
            "time is unbounded and every caller eventually abandons."
        )

    label = "Baseline" if uplift == 0 else f"+{uplift * 100:.0f}% volume"
    return ScenarioOutcome(
        label=label,
        uplift_pct=uplift,
        daily_calls=daily_calls,
        monthly_calls=monthly_calls,
        monthly_cost=monthly_cost,
        monthly_cost_lower=cost_lower,
        monthly_cost_upper=cost_upper,
        avg_duration_sec=aht,
        offered_load_erlangs=load,
        current_agents=current,
        required_agents=required,
        avg_wait_seconds=wait,
        service_level_pct=sl,
        expected_missed_calls_daily=missed_calls,
        expected_missed_pct=missed_rate,
        notes=notes,
    )


def run_scenarios(
    daily: pd.DataFrame,
    forecasts: dict[str, ForecastResult],
    cfg: AppConfig | None = None,
    uplifts: Iterable[float] | None = None,
) -> tuple[pd.DataFrame, list[ScenarioOutcome], list[str]]:
    """
    Evaluate the baseline and each configured volume uplift.

    Parameters
    ----------
    daily:
        Historical daily frame, used for cost-per-call and missed-call rates.
    forecasts:
        ``{target: ForecastResult}`` from
        :func:`call_forecast.forecast.forecast_all_targets`.
    cfg:
        Configuration; defaults used when omitted.
    uplifts:
        Fractional volume increases. Defaults to ``cfg.scenarios.volume_uplifts``.
        A baseline (0.0) row is always included first.

    Returns
    -------
    (table, outcomes, notes)
        ``table`` is the comparison DataFrame, ``outcomes`` the rich objects,
        and ``notes`` the assumptions that applied to the whole run.
    """
    cfg = cfg or AppConfig.default()
    uplifts = list(uplifts) if uplifts is not None else list(cfg.scenarios.volume_uplifts)
    uplifts = [0.0] + [u for u in uplifts if u != 0.0]

    baseline, notes = _baseline_inputs(daily, forecasts, cfg)

    # Today's abandonment, so later scenarios only add what the extra load causes.
    sc = cfg.scenarios
    base_load = (
        baseline["daily_calls"] * baseline["business_hours_share"]
        / max(sc.staffed_hours_per_day, 0.1)
        * (baseline["aht_seconds"] / 3600.0)
    )
    baseline_abandon = abandonment_rate(
        base_load, int(sc.current_agents), baseline["aht_seconds"],
        sc.abandon_rate_per_second,
    )

    outcomes = [
        _evaluate(u, baseline, forecasts, cfg, baseline_abandon) for u in uplifts
    ]
    table = pd.DataFrame([o.as_row() for o in outcomes])

    notes.append(
        f"Queueing model assumes {sc.current_agents} agent(s) on the phones for "
        f"{sc.staffed_hours_per_day:.0f} hours a day, a target of answering "
        f"{sc.service_level_pct:.0%} of calls within {sc.target_answer_seconds:.0f}s, "
        f"and a mean caller patience of {1 / sc.abandon_rate_per_second:.0f}s. "
        "Set these in the `scenarios` config section to match how the line is "
        "actually staffed."
    )
    notes.append(
        f"Average handling time held at {baseline['aht_seconds']:.0f}s across "
        "scenarios: more calls are assumed to be similar calls, not longer ones."
    )

    log.info("Evaluated %d scenario(s) against a %.1f-erlang baseline load.",
             len(outcomes), base_load)
    return table, outcomes, notes
