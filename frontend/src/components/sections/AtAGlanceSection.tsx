import type { DashboardPayload, ForecastSection, HorizonRollup } from '../../data/types';
import { formatCount, formatCurrency } from '../../lib/format';
import { Section, StatTile, TileGrid } from '../primitives';
import type { TileTone } from '../primitives';

/**
 * The headline horizon, in days.
 *
 * Hard-coded to 30 in `dashboard.py` rather than read from
 * `cfg.forecast.horizons`, and kept hard-coded here: these tiles say "next 30
 * days" in words, so reading the first configured horizon would let the label
 * and the number drift apart.
 */
const HEADLINE_DAYS = 30;

function rollupFor(forecast: ForecastSection | undefined): HorizonRollup | undefined {
  return forecast?.horizons.find((horizon) => horizon.days === HEADLINE_DAYS);
}

interface Tile {
  label: string;
  value: string;
  sub?: string;
  tone?: TileTone;
}

/**
 * The at-a-glance tiles.
 *
 * Tile order is fixed — calls, volume, cost, duration, alerts — rather than
 * following `payload.targets`, matching the Python dashboard. A reader who
 * opens this every morning should find the cost tile in the same place each
 * time, even on a run where one target produced no forecast.
 */
export function AtAGlanceSection({ payload }: { payload: DashboardPayload }) {
  const { ingestion, anomalies, forecasts } = payload;
  const tiles: Tile[] = [];

  const perDay = ingestion.rows_kept / Math.max(ingestion.calendar_days, 1);
  tiles.push({
    label: 'Calls in period',
    value: formatCount(ingestion.rows_kept),
    // `.1f` in Python, with no thousands separator. Faithfully reproduced.
    sub: `${perDay.toFixed(1)}/day average`,
  });

  const volume = forecasts['call_volume'];
  const volume30 = rollupFor(volume);
  if (volume && volume30) {
    // Python prints `int(interval_level * 100)`, which truncates. 0.9 * 100 is
    // 90.000000000000014 in binary floating point, so trunc and round agree
    // here — but at 0.95 they would not, and truncation is what ships today.
    const level = Math.trunc(volume.intervalLevel * 100);
    tiles.push({
      label: 'Next 30 days',
      value: `${formatCount(volume30.forecast)} calls`,
      sub: `${formatCount(volume30.lower)}–${formatCount(volume30.upper)} at ${level}%`,
    });
  }

  const cost = forecasts['total_cost'];
  const cost30 = rollupFor(cost);
  if (cost && cost30) {
    tiles.push({
      label: '30-day cost',
      value: formatCurrency(cost30.forecast),
      sub: `${formatCurrency(cost30.lower)}–${formatCurrency(cost30.upper)}`,
    });
  }

  const duration = forecasts['avg_duration_sec'];
  const duration30 = rollupFor(duration);
  if (duration && duration30) {
    tiles.push({
      label: 'Avg duration',
      value: `${formatCount(duration30.forecast)}s`,
      sub: 'forecast, next 30 days',
    });
  }

  const { critical, warning } = anomalies.counts;
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
