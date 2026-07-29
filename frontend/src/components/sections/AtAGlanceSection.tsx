import { useMemo } from 'react';
import type { DashboardPayload, HorizonRollup } from '../../data/types';
import { formatCount, formatCurrency } from '../../lib/format';
import { isTargetVisible } from '../../lib/selection';
import { headlineRollup, selectAnomalies } from '../../lib/selectionView';
import { Section, StatTile, TileGrid } from '../primitives';
import type { TileTone } from '../primitives';

/**
 * The horizon the tiles quote when the reader has not narrowed past it.
 *
 * Hard-coded to 30 in `dashboard.py`, and still the preference here: 30 days is
 * the figure this dashboard is read for. It is a *preference* rather than a
 * constant now, because the reader can trim the forecast cards to a shorter
 * period and a tile quoting 30 days beside cards showing fewer would be the
 * stale number in a different disguise. `headlineRollup` resolves the two, and
 * the label is written from the row it returns so the words and the number
 * cannot drift apart.
 */
const PREFERRED_DAYS = 30;

interface Tile {
  label: string;
  value: string;
  sub?: string;
  tone?: TileTone;
}

interface AtAGlanceSectionProps {
  payload: DashboardPayload;
  /** The rail's target, or `null` for "All". */
  selectedTarget: string | null;
  /** The forecast horizon in days; `Infinity` when the run configured none. */
  horizon: number;
}

/**
 * The at-a-glance tiles.
 *
 * Tile order is fixed — calls, volume, cost, duration, alerts — rather than
 * following `payload.targets`, matching the Python dashboard. A reader who
 * opens this every morning should find the cost tile in the same place each
 * time, even on a run where one target produced no forecast.
 *
 * **The tiles answer to the selection.** Each forecast tile belongs to a target
 * and is filtered with that target's cards, through the same `isTargetVisible`
 * every other section uses; the alert tile counts only the anomalies the
 * anomaly section is showing. What stays put is "Calls in period", which is an
 * ingestion fact — one dataset feeds every model, so it reads the same under
 * any selection rather than going stale under one.
 */
export function AtAGlanceSection({ payload, selectedTarget, horizon }: AtAGlanceSectionProps) {
  const { ingestion, anomalies, forecasts } = payload;

  const scopedAnomalies = useMemo(
    () => selectAnomalies(anomalies, selectedTarget),
    [anomalies, selectedTarget],
  );

  const tiles: Tile[] = [];

  const perDay = ingestion.rows_kept / Math.max(ingestion.calendar_days, 1);
  tiles.push({
    label: 'Calls in period',
    value: formatCount(ingestion.rows_kept),
    // `.1f` in Python, with no thousands separator. Faithfully reproduced.
    sub: `${perDay.toFixed(1)}/day average`,
  });

  /** A forecast tile is shown only when its target's cards are. */
  function rollupFor(target: string): HorizonRollup | undefined {
    if (!isTargetVisible(target, selectedTarget)) return undefined;
    return headlineRollup(forecasts[target], horizon, PREFERRED_DAYS);
  }

  const volume = forecasts['call_volume'];
  const volume30 = rollupFor('call_volume');
  if (volume && volume30) {
    // Python prints `int(interval_level * 100)`, which truncates. 0.9 * 100 is
    // 90.000000000000014 in binary floating point, so trunc and round agree
    // here — but at 0.95 they would not, and truncation is what ships today.
    const level = Math.trunc(volume.intervalLevel * 100);
    tiles.push({
      label: `Next ${volume30.days} days`,
      value: `${formatCount(volume30.forecast)} calls`,
      sub: `${formatCount(volume30.lower)}–${formatCount(volume30.upper)} at ${level}%`,
    });
  }

  const cost = forecasts['total_cost'];
  const cost30 = rollupFor('total_cost');
  if (cost && cost30) {
    tiles.push({
      label: `${cost30.days}-day cost`,
      value: formatCurrency(cost30.forecast),
      sub: `${formatCurrency(cost30.lower)}–${formatCurrency(cost30.upper)}`,
    });
  }

  const duration = forecasts['avg_duration_sec'];
  const duration30 = rollupFor('avg_duration_sec');
  if (duration && duration30) {
    tiles.push({
      label: 'Avg duration',
      value: `${formatCount(duration30.forecast)}s`,
      sub: `forecast, next ${duration30.days} days`,
    });
  }

  const { critical, warning } = scopedAnomalies.counts;
  tiles.push({
    label: 'Alerts raised',
    // No thousands separator in the Python original, and none added here.
    value: String(critical + warning),
    sub: `${critical} critical · ${warning} warning`,
    ...(critical > 0 ? { tone: 'critical' as const } : {}),
  });

  return (
    <Section title="At a glance">
      <TileGrid>
        {tiles.map((tile) => (
          <StatTile
            key={tile.label}
            label={tile.label}
            value={tile.value}
            {...(tile.sub === undefined ? {} : { sub: tile.sub })}
            {...(tile.tone === undefined ? {} : { tone: tile.tone })}
          />
        ))}
      </TileGrid>
    </Section>
  );
}
