import type { ReactNode } from 'react';

/**
 * A shortcut out of the dashboard to a related resource on the web.
 *
 * These are **not** application pages. Nothing here participates in the URL
 * fragment, the model selection or the docs route — see `ExternalLinks.tsx`
 * for why that separation is enforced by the markup rather than by care.
 */
export interface ExternalLink {
  /** Stable React key. Never appears in a URL or the payload. */
  id: string;
  label: string;
  href: string;
  /**
   * Hover/focus tooltip, and the tail of the link's accessible name.
   *
   * A bare "Documentation" tells a reader nothing about where it lands, and
   * three links that all open somewhere off-site read identically to a screen
   * reader without it.
   */
  description: string;
  icon: ReactNode;
}

/**
 * Shared attributes for the small line icons below.
 *
 * `currentColor` is the whole trick: the icon inherits the link's colour, so
 * it restyles with hover, focus and the light/dark toggle without a single
 * theme-aware rule of its own. `aria-hidden` because every icon here sits
 * beside its own text label — announcing it would double the name.
 */
const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

/** Waveform-in-a-circle: the call analytics the run is built from. */
const PhoneAgentIcon = (
  <svg {...ICON}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 10v4M12 7.5v9M16 10v4" />
  </svg>
);

/** GitHub's mark, simplified to a single stroked path at this size. */
const RepositoryIcon = (
  <svg {...ICON}>
    <path d="M9 19c-4 1.4-4-2-6-2.5m12 4.5v-3.6c0-1 .1-1.5-.5-2 2.3-.3 4.5-1.2 4.5-5a4 4 0 0 0-1.1-2.7 3.7 3.7 0 0 0-.1-2.8s-.9-.3-3 1.1a10.3 10.3 0 0 0-5.6 0C7.1 4.6 6.2 4.9 6.2 4.9a3.7 3.7 0 0 0-.1 2.8A4 4 0 0 0 5 10.4c0 3.8 2.2 4.7 4.5 5-.4.4-.5.9-.5 1.5V21" />
  </svg>
);

/** An open book: the project's written documentation. */
const DocumentationIcon = (
  <svg {...ICON}>
    <path d="M12 6.5c-1.5-1.3-3.4-2-5.5-2H3.5v13H7c1.9 0 3.7.6 5 1.7 1.3-1.1 3.1-1.7 5-1.7h3.5v-13H17c-2.1 0-4 .7-5 2Z" />
    <path d="M12 6.5v12.7" />
  </svg>
);

/**
 * The external resources rendered in the sidebar, in order.
 *
 * **This array is the only place these URLs appear.** Adding, removing or
 * repointing a link is an edit here and nowhere else; `ExternalLinks` renders
 * whatever it finds and has no knowledge of any particular entry.
 *
 * Documentation points at the repository README rather than at the in-app
 * docs: the header's "Docs" control already reaches those, and they are a
 * *view* of this page, not a destination on the web. Sending a reader
 * off-site for something they can read in place would be the worse of the two.
 */
export const EXTERNAL_LINKS: ExternalLink[] = [
  {
    id: 'retellai',
    label: 'RetellAI Dashboard',
    href: 'https://dashboard.retellai.com/',
    description: 'The phone agent this report is built from (opens in a new tab)',
    icon: PhoneAgentIcon,
  },
  {
    id: 'github',
    label: 'GitHub Repository',
    href: 'https://github.com/AlejandroCarlon03/call-analytics-forecasting-dashboard',
    description: 'Source, issues and releases (opens in a new tab)',
    icon: RepositoryIcon,
  },
  {
    id: 'docs',
    label: 'Documentation',
    href: 'https://github.com/AlejandroCarlon03/call-analytics-forecasting-dashboard#readme',
    description: 'Project README and setup guide (opens in a new tab)',
    icon: DocumentationIcon,
  },
];
