import { DOC_PAGE_IDS, type DocPageId } from '../../lib/docs/types';
import { DOC_PAGES } from '../../content/docs';
import { Card } from '../primitives';
import { DocsBreadcrumbs } from './DocsBreadcrumbs';
import { DocBlocks } from './blocks';
import styles from './DocsView.module.css';

interface DocsViewProps {
  page: DocPageId;
  onSelect: (page: DocPageId) => void;
  onExit: () => void;
}

/**
 * The documentation page body: breadcrumbs, the page itself, and prev/next
 * links along `DOC_PAGE_IDS`' order.
 *
 * **Heading hierarchy is load-bearing.** The shell's own `<h1>` is the
 * dashboard title, so this page's title is an `<h2>` — matching `Section`'s
 * heading level, since a doc page is this view's equivalent of a report
 * section — and every block-level heading inside it (`HeadingBlock`, rendered
 * by Agent 3's `DocBlocks`) is an `<h3>`. Nothing here may skip a level.
 *
 * The body is wrapped in `Card` rather than bespoke chrome, per the "sections
 * compose primitives" convention — and `Card`'s own `cardEnter` animation is
 * what gives the page its mount transition; this file adds none of its own.
 */
export function DocsView({ page, onSelect, onExit }: DocsViewProps) {
  const doc = DOC_PAGES[page];
  const index = DOC_PAGE_IDS.indexOf(page);
  const prevId = index > 0 ? DOC_PAGE_IDS[index - 1] : undefined;
  const nextId = index < DOC_PAGE_IDS.length - 1 ? DOC_PAGE_IDS[index + 1] : undefined;

  return (
    <div className={styles.docsview}>
      <DocsBreadcrumbs pageTitle={doc.title} onExit={onExit} />
      <Card>
        <article aria-labelledby="docs-page-title">
          <h2 id="docs-page-title" className={styles.title}>
            {doc.title}
          </h2>
          <p className={styles.summary}>{doc.summary}</p>
          <DocBlocks blocks={doc.blocks} />
        </article>
      </Card>
      <nav className={styles.pager} aria-label="Documentation pages">
        {prevId ? (
          <button type="button" className={styles.pagerButton} onClick={() => onSelect(prevId)}>
            <span className={styles.pagerDirection}>Previous</span>
            <span className={styles.pagerLabel}>
              {DOC_PAGES[prevId].navLabel ?? DOC_PAGES[prevId].title}
            </span>
          </button>
        ) : (
          <span />
        )}
        {nextId ? (
          <button
            type="button"
            className={`${styles.pagerButton} ${styles.pagerNext}`}
            onClick={() => onSelect(nextId)}
          >
            <span className={styles.pagerDirection}>Next</span>
            <span className={styles.pagerLabel}>
              {DOC_PAGES[nextId].navLabel ?? DOC_PAGES[nextId].title}
            </span>
          </button>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
