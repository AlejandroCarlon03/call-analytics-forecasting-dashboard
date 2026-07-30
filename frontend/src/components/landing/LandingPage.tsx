import { EXTERNAL_LINKS } from '../../config/externalLinks';
import { ThemeToggle } from '../shell/ThemeToggle';
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
}

/**
 * What the application does, in one sentence per capability. Static prose, and
 * deliberately so — **nothing on this page reads the payload.** A landing page
 * that quoted "218 calls next month" would be quoting the sample fixture to a
 * reader who has not chosen a dataset yet, which is the fabricated agreement
 * §10 exists to remove, arriving before the dashboard rather than inside it.
 */
const CAPABILITIES = [
  {
    id: 'forecast',
    title: 'Forecast call volume',
    body: 'Six cross-validated models compete on every target; the winner is refit on all history and projected 30, 60 and 90 days out with calibrated intervals.',
  },
  {
    id: 'analyse',
    title: 'Analyse operational trends',
    body: 'Daily and hourly arrival patterns, data-quality coverage, cost rollups and Erlang-C staffing scenarios, each with a table beside the chart.',
  },
  {
    id: 'explain',
    title: 'Understand the model',
    body: 'Feature importance, a model leaderboard and anomaly alerts explain why a number is what it is, rather than asking you to take it on trust.',
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
export function LandingPage({ onEnter, onImport, onOpenDocs }: LandingPageProps) {
  const repository = EXTERNAL_LINKS.find((link) => link.id === REPOSITORY_LINK_ID);

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <span className={styles.brand}>Call Analytics Forecast</span>
        <ThemeToggle />
      </div>

      {/* `tabIndex={-1}` for the same reason `AppShell`'s main carries one:
          it makes this region a focus target. Entering from here moves focus
          into the report, and a reader who comes back finds focus in a
          landmark rather than on whatever the browser last remembered. */}
      <main className={styles.main} id="landing" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <p className={styles.eyebrow}>Predictive call analytics</p>
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
                <h3 className={styles.capabilityTitle}>{capability.title}</h3>
                <p className={styles.capabilityBody}>{capability.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/*
          The shortcut PR 18 expands, and an honest empty state until it does.
          There is no import history yet — nothing records one — so this says
          exactly that rather than showing a plausible-looking list of files
          nobody imported. The heading and the region are what PR 18 fills; the
          copy is what it replaces.
        */}
        <section className={styles.recent} aria-labelledby="landing-recent">
          <h2 className={styles.sectionTitle} id="landing-recent">
            Recent imports
          </h2>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No imports yet</p>
            <p className={styles.emptyBody}>
              Datasets you import will be listed here for one-click reopening. Start with a
              RetellAI CSV export or a <code>dashboard_data.json</code> produced by the pipeline.
            </p>
            <button type="button" className={styles.secondary} onClick={onImport}>
              Import a dataset
            </button>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>Runs offline. No data leaves this page.</span>
      </footer>
    </div>
  );
}
