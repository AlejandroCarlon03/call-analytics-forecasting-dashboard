#!/usr/bin/env python3
"""
call_forecast.ingest
====================
Load raw call-analytics exports into one clean, canonical call-level frame.

The loader is deliberately forgiving about *shape* and strict about *values*:
column names are matched fuzzily (so ``Call Duration``, ``duration``, and
``call_duration`` all work), while every parsed value is range-checked and
anything implausible is dropped with a counted, reported reason.

Canonical output columns
------------------------
=====================  =========================================================
``ts``                 timezone-naive local timestamp of the call
``duration_sec``       call length in seconds (NaN when the export left it blank)
``cost``               call cost in dollars
``disconnection_reason``  e.g. ``user_hangup``, ``agent_hangup``, ``inactivity``
``call_status``        e.g. ``ended``, ``not_connected``
``sentiment``          ``Positive`` / ``Neutral`` / ``Negative`` / ``Unknown``
``successful``         bool, from the export's own success flag
``latency_ms``         end-to-end latency in milliseconds (often blank)
``direction``          ``inbound`` / ``outbound`` / ``unknown``
``connected``          bool: reached a human/agent and lasted > 0s
``missed``             bool: the inverse of ``connected``
``source_file``        filename the row came from
=====================  =========================================================

Typical use
-----------
>>> from call_forecast.config import AppConfig
>>> from call_forecast.ingest import load_calls
>>> cfg = AppConfig.default()
>>> calls = load_calls(cfg)                      # doctest: +SKIP
>>> calls.frame.head()                           # doctest: +SKIP
>>> print(calls.report.summary())                # doctest: +SKIP
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from .config import AppConfig

log = logging.getLogger(__name__)

__all__ = [
    "ValidationReport",
    "CallRecords",
    "discover_files",
    "load_calls",
    "load_call_files",
    "parse_duration_to_seconds",
    "parse_currency",
    "fingerprint_files",
]


# --------------------------------------------------------------------------- #
#  Column aliases                                                              #
# --------------------------------------------------------------------------- #
#: canonical name -> accepted source spellings (compared after normalisation)
_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "ts": ("time", "timestamp", "starttime", "startedat", "date", "datetime",
           "calltime", "startTimestamp", "starttimestamp"),
    "duration_sec": ("callduration", "duration", "durationsec", "durationseconds",
                     "talktime", "length"),
    "cost": ("cost", "callcost", "totalcost", "combinedcost", "price", "amount"),
    "disconnection_reason": ("disconnectionreason", "disconnectreason",
                             "endreason", "hangupcause", "reason"),
    "call_status": ("callstatus", "status", "state"),
    "sentiment": ("usersentiment", "sentiment", "callersentiment"),
    "successful": ("callsuccessful", "successful", "success", "issuccessful",
                   "calloutcome", "outcome"),
    "latency_ms": ("endtoendlatency", "latency", "latencyms", "e2elatency",
                   "endtoendlatencyms"),
    "direction": ("direction", "calldirection", "calltype", "type",
                  "inboundoutbound", "phonecalldirection"),
    "call_id": ("callid", "id", "conversationid", "sessionid"),
    "from_number": ("from", "fromnumber", "caller", "fromphonenumber"),
    "to_number": ("to", "tonumber", "callee", "tophonenumber"),
    "agent": ("agent", "agentname", "agentid"),
}

#: Values in a `successful`-style column that mean "yes".
_TRUTHY = {"successful", "success", "true", "yes", "y", "1", "completed", "t"}
_FALSY = {"unsuccessful", "failure", "failed", "false", "no", "n", "0", "f"}


def _normalise(name: str) -> str:
    """Lowercase a column name and strip everything that isn't a letter/digit."""
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


# --------------------------------------------------------------------------- #
#  Value parsers                                                               #
# --------------------------------------------------------------------------- #
def parse_duration_to_seconds(val) -> float:
    """
    Convert a call-duration cell to seconds.

    Handles the several shapes these exports arrive in:

    * ``"1:48"``      -> 108.0   (MM:SS, the RetellAI CSV format)
    * ``"1:02:03"``   -> 3723.0  (HH:MM:SS)
    * ``"95"`` / 95   -> 95.0    (already seconds)
    * ``datetime.time(1, 48)``     -> 108.0  (Excel widens MM:SS into a time
      value, pushing minutes into ``hour`` and seconds into ``minute``)
    * ``timedelta``   -> ``total_seconds()``
    * blank / NaN     -> ``nan``

    >>> parse_duration_to_seconds("1:48")
    108.0
    >>> parse_duration_to_seconds("1:02:03")
    3723.0
    >>> parse_duration_to_seconds("")
    nan
    """
    if val is None:
        return np.nan
    if isinstance(val, float) and np.isnan(val):
        return np.nan
    if isinstance(val, _dt.timedelta):
        return float(val.total_seconds())
    if isinstance(val, _dt.time):
        # Excel/openpyxl reads "MM:SS" as a time -> hour holds minutes.
        return float(val.hour * 60 + val.minute + val.second / 60.0)
    if isinstance(val, (int, float, np.integer, np.floating)):
        return float(val)

    text = str(val).strip()
    if not text or text.lower() in {"nan", "none", "null", "-"}:
        return np.nan

    if ":" in text:
        parts = text.split(":")
        try:
            nums = [float(p) for p in parts]
        except ValueError:
            return np.nan
        if len(parts) == 2:                       # MM:SS
            return nums[0] * 60.0 + nums[1]
        if len(parts) == 3:                       # HH:MM:SS
            return nums[0] * 3600.0 + nums[1] * 60.0 + nums[2]
        return np.nan

    try:
        return float(text)
    except ValueError:
        return np.nan


def parse_currency(val) -> float:
    """
    Convert a currency cell to a float.

    >>> parse_currency("$0.039")
    0.039
    >>> parse_currency("1,234.50")
    1234.5
    >>> parse_currency("")
    nan
    """
    if val is None:
        return np.nan
    if isinstance(val, (int, float, np.integer, np.floating)):
        return np.nan if (isinstance(val, float) and np.isnan(val)) else float(val)

    text = re.sub(r"[^0-9.\-]", "", str(val).strip())
    if not text or text in {"-", ".", "-."}:
        return np.nan
    try:
        return float(text)
    except ValueError:
        return np.nan


def _parse_bool_series(s: pd.Series) -> pd.Series:
    """Map a success/failure-ish column onto nullable booleans."""
    def one(v):
        if isinstance(v, (bool, np.bool_)):
            return bool(v)
        t = _normalise(v)
        if t in _TRUTHY:
            return True
        if t in _FALSY:
            return False
        return pd.NA

    return s.map(one).astype("boolean")


def _parse_direction(s: pd.Series) -> pd.Series:
    """Normalise a direction column to inbound/outbound/unknown."""
    def one(v):
        t = _normalise(v)
        if not t:
            return "unknown"
        if "inbound" in t or t in {"in", "incoming", "received"}:
            return "inbound"
        if "outbound" in t or t in {"out", "outgoing", "dialed", "placed"}:
            return "outbound"
        return "unknown"

    return s.map(one).astype("string")


# --------------------------------------------------------------------------- #
#  Validation report                                                           #
# --------------------------------------------------------------------------- #
@dataclass
class ValidationReport:
    """Counts and warnings describing what ingestion did to the raw data."""

    files: list[str] = field(default_factory=list)
    rows_read: int = 0
    rows_kept: int = 0
    dropped: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    missing_columns: list[str] = field(default_factory=list)
    date_min: pd.Timestamp | None = None
    date_max: pd.Timestamp | None = None
    active_days: int = 0
    calendar_days: int = 0

    def drop(self, reason: str, n: int) -> None:
        """Record ``n`` rows dropped for ``reason`` (no-op when ``n == 0``)."""
        if n:
            self.dropped[reason] = self.dropped.get(reason, 0) + int(n)

    def warn(self, message: str) -> None:
        """Record a non-fatal data-quality warning and log it."""
        self.warnings.append(message)
        log.warning(message)

    @property
    def coverage_pct(self) -> float:
        """Share of calendar days in range that actually contain calls."""
        if not self.calendar_days:
            return 0.0
        return 100.0 * self.active_days / self.calendar_days

    def summary(self) -> str:
        """Human-readable multi-line summary, used in logs and the report."""
        lines = [
            "Ingestion summary",
            "-----------------",
            f"  files            : {len(self.files)}",
            f"  rows read        : {self.rows_read}",
            f"  rows kept        : {self.rows_kept}",
        ]
        if self.dropped:
            lines.append("  rows dropped     :")
            for reason, n in sorted(self.dropped.items(), key=lambda kv: -kv[1]):
                lines.append(f"      {n:>6}  {reason}")
        if self.date_min is not None:
            lines += [
                f"  date range       : {self.date_min:%Y-%m-%d} .. {self.date_max:%Y-%m-%d}",
                f"  calendar days    : {self.calendar_days}",
                f"  days with calls  : {self.active_days} ({self.coverage_pct:.0f}% coverage)",
            ]
        if self.missing_columns:
            lines.append(f"  columns absent   : {', '.join(self.missing_columns)}")
        if self.warnings:
            lines.append("  warnings         :")
            lines += [f"      - {w}" for w in self.warnings]
        return "\n".join(lines)

    def to_dict(self) -> dict:
        """JSON-serialisable view of the report."""
        return {
            "files": self.files,
            "rows_read": self.rows_read,
            "rows_kept": self.rows_kept,
            "dropped": dict(self.dropped),
            "warnings": list(self.warnings),
            "missing_columns": list(self.missing_columns),
            "date_min": None if self.date_min is None else str(self.date_min.date()),
            "date_max": None if self.date_max is None else str(self.date_max.date()),
            "active_days": self.active_days,
            "calendar_days": self.calendar_days,
            "coverage_pct": round(self.coverage_pct, 2),
        }


@dataclass
class CallRecords:
    """Canonical call-level frame plus the report describing how it was built."""

    frame: pd.DataFrame
    report: ValidationReport

    def __len__(self) -> int:
        return len(self.frame)


# --------------------------------------------------------------------------- #
#  File discovery / fingerprinting                                             #
# --------------------------------------------------------------------------- #
def discover_files(cfg: AppConfig) -> list[Path]:
    """
    Return every raw export matching ``cfg.data.patterns`` under the data dir.

    Results are sorted for deterministic ingestion order and de-duplicated in
    case two patterns match the same file.
    """
    data_dir = cfg.paths.resolved().data_dir
    found: list[Path] = []
    for pattern in cfg.data.patterns:
        found.extend(sorted(data_dir.glob(pattern)))
    seen: set[Path] = set()
    unique: list[Path] = []
    for p in found:
        rp = p.resolve()
        if rp not in seen and p.is_file():
            seen.add(rp)
            unique.append(p)
    return unique


def fingerprint_files(paths: Sequence[Path]) -> str:
    """
    Stable SHA-256 over the *contents* of every input file.

    The pipeline stores this in its manifest so it can tell whether new data
    has arrived and a retrain is warranted.

    The hash depends only on file contents — not on names, paths, modification
    times or ordering. Each is deliberate:

    * **Not mtime**, because OneDrive, Dropbox and ``git checkout`` all rewrite
      timestamps on files whose bytes never changed, and an mtime-based check
      would retrain on every sync.
    * **Not filenames**, because renaming an export does not change the
      analysis; ingestion de-duplicates on content, so a rename is a no-op.
    * **Order-independent**, achieved by hashing each file separately and then
      hashing the *sorted* digests, so glob ordering cannot affect the result.

    Adding a genuinely new file still changes the fingerprint, because its
    digest joins the list.
    """
    digests: list[str] = []
    for path in paths:
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        digests.append(h.hexdigest())

    combined = hashlib.sha256()
    for digest in sorted(digests):
        combined.update(digest.encode("ascii"))
    return combined.hexdigest()


# --------------------------------------------------------------------------- #
#  Loading                                                                     #
# --------------------------------------------------------------------------- #
def _read_one(path: Path) -> pd.DataFrame:
    """Read a single CSV/Excel export with everything as raw strings/objects."""
    suffix = path.suffix.lower()
    if suffix in {".csv", ".txt", ".tsv"}:
        sep = "\t" if suffix == ".tsv" else ","
        df = pd.read_csv(path, sep=sep, dtype=str, keep_default_na=True)
    elif suffix in {".xlsx", ".xlsm", ".xls"}:
        df = pd.read_excel(path, dtype=object)
    else:
        raise ValueError(f"Unsupported export format: {path.name}")
    df["__source_file__"] = path.name
    return df


def _map_columns(df: pd.DataFrame, report: ValidationReport) -> dict[str, str]:
    """
    Match source columns onto canonical names.

    Returns ``{canonical: source_column}``. Unmatched canonical names are
    recorded on the report rather than raising, so a slimmer export still works.
    """
    normalised = {_normalise(c): c for c in df.columns}
    mapping: dict[str, str] = {}
    for canonical, aliases in _COLUMN_ALIASES.items():
        for alias in aliases:
            src = normalised.get(_normalise(alias))
            if src is not None:
                mapping[canonical] = src
                break
    absent = [c for c in ("ts", "duration_sec", "cost") if c not in mapping]
    report.missing_columns = [
        c for c in _COLUMN_ALIASES if c not in mapping
    ]
    if "ts" not in mapping:
        raise ValueError(
            "No timestamp column found. Expected one of: "
            + ", ".join(_COLUMN_ALIASES['ts'])
            + f". Got: {list(df.columns)}"
        )
    if absent:
        report.warn(
            f"Export is missing expected column(s) {absent}; "
            "dependent features will be skipped."
        )
    return mapping


def load_call_files(
    paths: Iterable[Path],
    cfg: AppConfig | None = None,
) -> CallRecords:
    """
    Load, clean, validate and de-duplicate one or more raw exports.

    Parameters
    ----------
    paths:
        Raw ``.csv``/``.xlsx`` exports. Overlapping exports are fine — rows are
        de-duplicated on call id when present, otherwise on the
        (timestamp, duration, cost) triple.
    cfg:
        Configuration; defaults are used when omitted.

    Returns
    -------
    CallRecords
        ``.frame`` is the canonical call-level table sorted by timestamp;
        ``.report`` describes every drop and warning.

    Raises
    ------
    ValueError
        If no files are supplied, no timestamp column exists, or more than
        ``cfg.data.max_bad_timestamp_share`` of rows have unparseable
        timestamps (which usually means the wrong file was picked up).
    """
    cfg = cfg or AppConfig.default()
    paths = [Path(p) for p in paths]
    report = ValidationReport(files=[p.name for p in paths])

    if not paths:
        raise ValueError(
            "No input files supplied. Drop a call export (.csv or .xlsx) into "
            f"{cfg.paths.resolved().data_dir}"
        )

    raw = pd.concat([_read_one(p) for p in paths], ignore_index=True)
    report.rows_read = len(raw)
    mapping = _map_columns(raw, report)

    out = pd.DataFrame(index=raw.index)

    # -- timestamp ---------------------------------------------------------- #
    ts = pd.to_datetime(raw[mapping["ts"]], errors="coerce", format="mixed")
    bad_ts = int(ts.isna().sum())
    if bad_ts:
        share = bad_ts / max(len(raw), 1)
        if share > cfg.data.max_bad_timestamp_share:
            raise ValueError(
                f"{bad_ts}/{len(raw)} rows ({share:.1%}) have an unparseable "
                f"timestamp, above the {cfg.data.max_bad_timestamp_share:.0%} "
                "limit. Check that the correct column/file is being loaded."
            )
        report.drop("unparseable timestamp", bad_ts)
    out["ts"] = ts

    # -- numeric fields ----------------------------------------------------- #
    if "duration_sec" in mapping:
        out["duration_sec"] = raw[mapping["duration_sec"]].map(parse_duration_to_seconds)
    else:
        out["duration_sec"] = np.nan

    if "cost" in mapping:
        out["cost"] = raw[mapping["cost"]].map(parse_currency)
    else:
        out["cost"] = np.nan

    if "latency_ms" in mapping:
        out["latency_ms"] = pd.to_numeric(raw[mapping["latency_ms"]], errors="coerce")
    else:
        out["latency_ms"] = np.nan

    # -- categorical fields ------------------------------------------------- #
    for canonical, default in (
        ("disconnection_reason", "unknown"),
        ("call_status", "unknown"),
        ("sentiment", "Unknown"),
    ):
        if canonical in mapping:
            out[canonical] = (
                raw[mapping[canonical]].astype("string").fillna(default).str.strip()
            )
        else:
            out[canonical] = pd.Series(default, index=raw.index, dtype="string")

    out["successful"] = (
        _parse_bool_series(raw[mapping["successful"]])
        if "successful" in mapping
        else pd.Series(pd.NA, index=raw.index, dtype="boolean")
    )

    out["direction"] = (
        _parse_direction(raw[mapping["direction"]])
        if "direction" in mapping
        else pd.Series("unknown", index=raw.index, dtype="string")
    )

    out["call_id"] = (
        raw[mapping["call_id"]].astype("string")
        if "call_id" in mapping
        else pd.Series(pd.NA, index=raw.index, dtype="string")
    )
    out["source_file"] = raw["__source_file__"].astype("string")

    # -- range checks ------------------------------------------------------- #
    too_long = out["duration_sec"] > cfg.data.max_plausible_duration_sec
    report.drop("implausible duration", int(too_long.sum()))
    out.loc[too_long, "duration_sec"] = np.nan

    negative_dur = out["duration_sec"] < 0
    report.drop("negative duration", int(negative_dur.sum()))
    out.loc[negative_dur, "duration_sec"] = np.nan

    too_costly = out["cost"] > cfg.data.max_plausible_cost
    report.drop("implausible cost", int(too_costly.sum()))
    out.loc[too_costly, "cost"] = np.nan

    negative_cost = out["cost"] < 0
    report.drop("negative cost", int(negative_cost.sum()))
    out.loc[negative_cost, "cost"] = np.nan

    # A blank cost on a real export means "no charge", not "unknown".
    out["cost"] = out["cost"].fillna(0.0)

    # -- derived flags ------------------------------------------------------ #
    # "Connected" == the platform reports the call ended normally *and* it
    # lasted a non-zero amount of time. A 0-second "ended" row is a caller who
    # hung up during pickup, which the business counts as missed.
    status_norm = out["call_status"].map(_normalise).fillna("")
    out["connected"] = (status_norm == "ended") & (out["duration_sec"].fillna(0.0) > 0)
    out["missed"] = ~out["connected"]

    # -- drop unusable rows ------------------------------------------------- #
    out = out.loc[out["ts"].notna()].copy()

    # -- de-duplicate ------------------------------------------------------- #
    # The goal is to remove rows repeated because two exports overlap in time,
    # without collapsing genuinely distinct calls. That distinction matters
    # here: these timestamps have minute resolution, so two separate failed
    # attempts in the same minute look identical on (ts, duration, cost).
    #
    # A single export never repeats its own rows, so within-file position is
    # part of the identity: the Nth occurrence of a given (ts, duration, cost)
    # in file A is the same call as the Nth occurrence in file B, but the 1st
    # and 2nd occurrences within file A are two different calls.
    before = len(out)
    if out["call_id"].notna().any():
        out = out.drop_duplicates(subset=["call_id"], keep="first")
    else:
        key = ["ts", "duration_sec", "cost"]
        out["_occurrence"] = out.groupby(
            ["source_file"] + key, dropna=False
        ).cumcount()
        out = out.drop_duplicates(subset=key + ["_occurrence"], keep="first")
        out = out.drop(columns="_occurrence")
    report.drop("duplicate rows (overlapping exports)", before - len(out))

    out = out.sort_values("ts").reset_index(drop=True)
    report.rows_kept = len(out)

    if out.empty:
        raise ValueError("No usable rows survived ingestion; check the export format.")

    # -- coverage stats & warnings ------------------------------------------ #
    report.date_min = out["ts"].min()
    report.date_max = out["ts"].max()
    days = out["ts"].dt.normalize()
    report.active_days = int(days.nunique())
    report.calendar_days = int((report.date_max.normalize() - report.date_min.normalize()).days) + 1

    if report.coverage_pct < 60:
        report.warn(
            f"Only {report.active_days} of {report.calendar_days} calendar days "
            f"({report.coverage_pct:.0f}%) contain calls. The series is "
            "intermittent; MAPE will be unreliable and MASE is used for model "
            "selection instead."
        )
    if out["direction"].eq("unknown").all():
        report.warn(
            "No call-direction column in the export - the inbound/outbound "
            "ratio feature cannot be computed and will be dropped."
        )
    blank_dur = int(out["duration_sec"].isna().sum())
    if blank_dur:
        report.warn(
            f"{blank_dur} row(s) have a blank duration (typically "
            "not-connected calls); they count toward volume and missed-call "
            "rate but are excluded from duration averages."
        )

    log.info("\n%s", report.summary())
    return CallRecords(frame=out, report=report)


def load_calls(cfg: AppConfig | None = None) -> CallRecords:
    """
    Discover every export under the configured data directory and load them.

    Convenience wrapper over :func:`discover_files` + :func:`load_call_files`.
    """
    cfg = cfg or AppConfig.default()
    paths = discover_files(cfg)
    if not paths:
        raise ValueError(
            "No exports found matching "
            f"{list(cfg.data.patterns)} in {cfg.paths.resolved().data_dir}"
        )
    return load_call_files(paths, cfg)
