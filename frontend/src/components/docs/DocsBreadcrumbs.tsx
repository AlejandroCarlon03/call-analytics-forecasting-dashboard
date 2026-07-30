import styles from './DocsBreadcrumbs.module.css';

interface DocsBreadcrumbsProps {
  pageTitle: string;
  onExit: () => void;
}

/**
 * Orientation, not a second nav: "Documentation / <page title>".
 *
 * The first crumb is a real button — leaving the docs is the same kind of
 * in-place view change `onExit` performs everywhere else in this tree, not a
 * navigation to a document, so it is not an anchor for the same reason
 * `DocsNav`'s and `SideNav`'s tabs are not. The last crumb names the page the
 * reader is already on, so it is marked current and is not a control.
 */
export function DocsBreadcrumbs({ pageTitle, onExit }: DocsBreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
      <ol className={styles.list}>
        <li>
          <button type="button" className={styles.crumbButton} onClick={onExit}>
            Documentation
          </button>
        </li>
        <li aria-current="page" className={styles.current}>
          {pageTitle}
        </li>
      </ol>
    </nav>
  );
}
