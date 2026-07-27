import type { IngestionReport } from '../../data/types';
import { Callout, Section } from '../primitives';
import type { CalloutTone } from '../primitives';

/** How many ingestion warnings the Python banner showed. The rest are in the CSVs. */
const MAX_WARNINGS = 4;

/** Below this share of days with calls, the series is treated as intermittent. */
const INTERMITTENT_COVERAGE_PCT = 60;

/** Below this much history, monthly and seasonal structure is not estimable. */
const MIN_SEASONAL_DAYS = 120;

interface Advisory {
  tone: CalloutTone;
  text: string;
}

/**
 * Build the banner's advisories.
 *
 * Split out from the component because these are the thresholds the section
 * exists to communicate, and they should be readable without reading JSX. The
 * wording is copied from `dashboard.py` verbatim — the two dashboards must not
 * disagree about what the data is fit for.
 */
function advisories(ingestion: IngestionReport): Advisory[] {
  const items: Advisory[] = [];

  if (ingestion.coverage_pct < INTERMITTENT_COVERAGE_PCT) {
    items.push({
      tone: 'warning',
      text:
        `Only ${ingestion.active_days} of ${ingestion.calendar_days} days contain calls. ` +
        'The series is intermittent, so percentage errors are unstable and models are ' +
        'ranked on MASE instead.',
    });
  }

  if (ingestion.calendar_days < MIN_SEASONAL_DAYS) {
    items.push({
      tone: 'warning',
      text:
        `${ingestion.calendar_days} days of history. Weekly patterns are estimable; ` +
        'seasonal and monthly patterns are not. Treat 60- and 90-day figures as ' +
        'directional.',
    });
  }

  for (const warning of ingestion.warnings.slice(0, MAX_WARNINGS)) {
    items.push({ tone: 'info', text: warning });
  }

  return items;
}

/**
 * The data-quality banner.
 *
 * Renders nothing when there is nothing to say — a clean run should not carry
 * an empty "Data quality" heading, and the Python dashboard omits the section
 * entirely in that case.
 */
export function DataQualitySection({ ingestion }: { ingestion: IngestionReport }) {
  const items = advisories(ingestion);
  if (items.length === 0) return null;

  return (
    <Section title="Data quality">
      {items.map((item, index) => (
        // Two ingestion warnings can carry identical text; the index is the
        // only stable identity these have.
        <Callout key={`${item.tone}-${index}`} tone={item.tone}>
          {item.text}
        </Callout>
      ))}
    </Section>
  );
}
