import { EXTERNAL_LINKS } from '../../config/externalLinks';
import { ThemeToggle } from '../shell/ThemeToggle';
import { RecentImports } from '../importHistory';
import type { ImportHistoryEntry } from '../../lib/importHistory';
import styles from './LandingPage.module.css';

/**
 * Which configured external link the hero's repository action points at.
 *
 * `config/externalLinks.tsx` stays the only place a URL appears (§15), so
 * repointing the repository is still an edit there and nowhere else. If the
 * entry is ever removed the action simply does not render — an action wired to
 * a missing href would be a dead control, and a hard-coded fallback would be a
 * second copy of the URL, which is the thing that config exists to prevent.
 */
const REPOSITORY_LINK_ID = 'github';

interface LandingPageProps {
  /** Enter the application and show the report. */
  onEnter: () => void;
  /** Enter the application with the reader's attention on the import panel. */
  onImport: () => void;
  /** Open the in-app documentation. */
  onOpenDocs: () => void;
  /**
   * Previously imported datasets, newest first. Optional and empty by default,
   * so the page renders its honest "no imports yet" state on a first visit and
   * — as before PR 18 — needs no history wired to work at all.
   */
  recentImports?: ImportHistoryEntry[];
  /** The dataset currently loaded, for the "current" indicator. */
  activeImportId?: string | null;
  /** Reopen a remembered dataset. */
  onReopenImport?: (id: string) => void;
  /** Forget a remembered dataset. */
  onRemoveImport?: (id: string) => void;
}

/**
 * What the application does, in one sentence per capability. Static prose, and
 * deliberately so — **nothing on this page reads the payload.** A landing page
 * that quoted "218 calls next month" would be quoting the sample fixture to a
 * reader who has not chosen a dataset yet, which is the fabricated agreement
 * §10 exists to remove, arriving before the dashboard rather than inside it.
 */
/**
 * The capability icons are decorative (`aria-hidden`): each capability already
 * has a visible `<h3>` title that names it, so the glyph adds no information a
 * screen reader needs. They are simple `currentColor` strokes so the icon takes
 * the tile's accent colour with no per-icon fill to keep in step.
 */
const CAPABILITIES = [
  {
    id: 'forecast',
    title: 'Forecast call volume',
    body: 'Six cross-validated models compete on every target; the winner is refit on all history and projected 30, 60 and 90 days out with calibrated intervals.',
    icon: (
      <path d="M3 16.5l5.5-5.5 3.5 3.5L21 5M21 5h-4.5M21 5v4.5" />
    ),
  },
  {
    id: 'analyse',
    title: 'Analyse operational trends',
    body: 'Daily and hourly arrival patterns, data-quality coverage, cost rollups and Erlang-C staffing scenarios, each with a table beside the chart.',
    icon: (
      <path d="M4 20V13M9 20V7M14 20v-4M19 20V10M3 20h18" />
    ),
  },
  {
    id: 'explain',
    title: 'Understand the model',
    body: 'Feature importance, a model leaderboard and anomaly alerts explain why a number is what it is, rather than asking you to take it on trust.',
    icon: (
      <path d="M9.5 18h5M10 21h4M12 3a6 6 0 0 0-3.7 10.7c.5.4.7.8.8 1.3h5.8c.1-.5.3-.9.8-1.3A6 6 0 0 0 12 3z" />
    ),
  },
];

/**
 * The application's front door.
 *
 * ***The dashboard does not render until the reader chooses to enter.*** Before
 * this page the application opened straight onto a report built from whatever
 * `loadPayload()` found — in development, and in any build without an inlined
 * payload, that is the committed sample fixture, so the first thing a new
 * reader saw was a full page of charts describing data they had never supplied.
 * Nothing here renders a chart, a tile or a payload number; entering is a
 * decision, and until it is made the page says what the application is for.
 *
 * **This is a view, not a route.** It holds no state, writes no fragment and
 * mounts outside `AppShell` — the shell's header carries a run's provenance
 * line, which there is no run to describe yet. `App` owns the one boolean that
 * decides between this page and the report, and `lib/entry.ts` explains why
 * that boolean is not a URL key.
 *
 * Every action is a real control: two `<button>`s that change what this page
 * shows, one `<button>` for the documentation (a view of this same page, so
 * not a link off it), and one `<a>` for the repository, which genuinely leaves
 * — the same button/anchor split `ExternalLinks` argues for at length.
 */
export function LandingPage({
  onEnter,
  onImport,
  onOpenDocs,
  recentImports = [],
  activeImportId = null,
  onReopenImport,
  onRemoveImport,
}: LandingPageProps) {
  const repository = EXTERNAL_LINKS.find((link) => link.id === REPOSITORY_LINK_ID);

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <span className={styles.brand}>
          {/* Decorative brand mark — the wordmark beside it carries the name, so
              the tile is aria-hidden and adds no duplicate label. */}
          <span className={styles.brandMark} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round" focusable={false}>
              <path d="M4 16.5l4.5-4.5 3 3L20 7" />
            </svg>
          </span>
          Call Analytics Forecast
        </span>
        <ThemeToggle />
      </div>

      {/* `tabIndex={-1}` for the same reason `AppShell`'s main carries one:
          it makes this region a focus target. Entering from here moves focus
          into the report, and a reader who comes back finds focus in a
          landmark rather than on whatever the browser last remembered. */}
      <main className={styles.main} id="landing" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <p className={styles.eyebrow}>
            <span className={styles.chip}>Predictive call analytics</span>
          </p>
          <h1 className={styles.title} id="landing-title">
            Call Analytics Forecast
          </h1>
          <p className={styles.lead}>
            Forecast call volume, analyze operational trends, and understand predictive models
            through an interactive analytics dashboard.
          </p>

          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onImport}>
              Import Dashboard
              {/* Decorative arrow — aria-hidden so the button's accessible name
                  stays exactly "Import Dashboard". */}
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            </button>
            <button type="button" className={styles.secondary} onClick={onEnter}>
              Open dashboard
            </button>
          </div>

          <div className={styles.links}>
            <button type="button" className={styles.link} onClick={onOpenDocs}>
              Documentation &amp; about
            </button>
            {repository ? (
              <a
                className={styles.link}
                href={repository.href}
                target="_blank"
                rel="noopener noreferrer"
                title={repository.description}
              >
                GitHub
                {/* The external-link indicator, and the visually hidden tail
                    that tells a screen-reader user what the glyph tells a
                    sighted one — the pattern `ExternalLinks` established. */}
                <svg
                  className={styles.indicator}
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable={false}
                >
                  <path d="M14 5h5v5M19 5l-8 8M17 14v5H5V7h5" />
                </svg>
                <span className={styles.srOnly}>{` — ${repository.description}`}</span>
              </a>
            ) : null}
          </div>
        </section>

        <section className={styles.capabilities} aria-labelledby="landing-capabilities">
          <h2 className={styles.sectionTitle} id="landing-capabilities">
            What it does
          </h2>
          <ul className={styles.capabilityList}>
            {CAPABILITIES.map((capability) => (
              <li key={capability.id} className={styles.capability}>
                <span className={styles.capabilityIcon} aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    focusable={false}
                  >
                    {capability.icon}
                  </svg>
                </span>
                <h3 className={styles.capabilityTitle}>{capability.title}</h3>
                <p className={styles.capabilityBody}>{capability.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/*
          Recent imports (PR 18). One-click reopening of datasets imported
          earlier — the whole list, and its honest empty state, live in the
          shared `RecentImports` body so the report can render the same thing.
          The heading stays here so this page owns its own hierarchy.
        */}
        <section className={styles.recent} aria-labelledby="landing-recent">
          <h2 className={styles.sectionTitle} id="landing-recent">
            Recent imports
          </h2>
          <RecentImports
            variant="landing"
            entries={recentImports}
            activeId={activeImportId}
            onReopen={onReopenImport ?? (() => {})}
            onRemove={onRemoveImport ?? (() => {})}
            onImport={onImport}
          />
        </section>
      </main>

      <footer className={styles.footer}>
        <span>Runs offline. No data leaves this page.</span>
      </footer>
    </div>
  );
}
