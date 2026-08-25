/**
 * Print one report.
 *
 * The body class exists because `@page` cannot be scoped to an element — it applies to the whole
 * printed document — so the page size is selected by a class that is set, printed, and taken off
 * again. Copied deliberately from `useReceipt.print`, including the `finally`: an aborted print
 * dialog must not leave the class stuck on, or the next receipt prints on A4.
 *
 * `.print-active` is the other half. `index.css` positions every `.print-area` absolutely at the
 * page origin, so two mounted at once print stacked on top of each other — reachable on the
 * diagnostic dashboard, which can hold a viewer, an entry dialog and a document preview at the
 * same time. Narrowing the rule to the active one makes that impossible rather than unlikely.
 */
export function printReport() {
  document.body.classList.add('printing-report');
  try {
    window.print();
  } finally {
    document.body.classList.remove('printing-report');
  }
}
