/**
 * Print one element, and nothing else. [1.52.0]
 *
 * ── Why this is JavaScript and not a stylesheet ─────────────────────────────────────────────
 *
 * The receipt prints from inside a dialog, and the usual print stylesheet — hide `body *`, reveal
 * `.print-area`, pull it to `top: 0; left: 0` — cannot survive that. Measured, twice:
 *
 *   Before any fix   the dialog was `position: fixed`, `max-height: 648px`, `overflow-y: auto`,
 *                    and its own box was 56px tall. A fixed element is a CONTAINING BLOCK for
 *                    absolutely-positioned descendants, so `top: 0` resolved against the dialog.
 *                    A 644px receipt was laid out inside a 56px clipping box, 333px down the
 *                    page: the clinic name printed, everything under it was cut, and the rest
 *                    spilled to a second blank sheet.
 *
 *   After un-fixing  the clipping went away and the receipt moved to `top: 720, left: -635` —
 *                    off the left edge and below the fold, because `visibility: hidden` KEEPS
 *                    layout. The whole application was still occupying the page; the receipt was
 *                    simply queued up after it.
 *
 * That second measurement is the point. Every CSS approach here is a negotiation with whatever
 * the surrounding page happens to be doing — a transform, a scroll container, a positioned
 * ancestor added later by someone with no idea a receipt prints out of this screen. The rule
 * would keep working until it silently did not, and the failure only ever shows up on paper.
 *
 * ── What this does instead ──────────────────────────────────────────────────────────────────
 *
 * Copies the element to a container appended directly to <body>, hides body's other children
 * with `display: none` (which removes their layout rather than merely their pixels), prints, and
 * tears the copy down. There is no containing block left to resolve against and nothing left in
 * the flow to push it down the page.
 *
 * A COPY rather than a move: relocating a live node and putting it back is a mutation React did
 * not perform and may reconcile over, at a moment when a dialog is open and re-rendering. The
 * clone is inert, lives for the length of one print call, and is removed in a `finally` so an
 * abandoned print dialog cannot leave the app with its own UI hidden.
 */

const HOST_ID = 'print-root';
const ISOLATED = 'printing-isolated';

/**
 * @param {HTMLElement|null} node    the element to print; falls back to the first `.print-area`
 * @param {string|null} pageClass    a body class selecting an @page size (e.g. 'printing-receipt')
 */
export function printElement(node = null, pageClass = null) {
  // A dialog's print area wins over one on the page behind it. Several screens render a printable
  // document inside a dialog while the console underneath has its own — the receipt over the
  // transaction log, a result report over the worklist — and `querySelector` alone returns the
  // first in DOM order, which is the one nobody asked to print. Radix renders dialogs into a
  // portal at the end of <body>, so "open dialog first" is both correct and cheap to ask for.
  const target =
    node
    || document.querySelector('[role="dialog"] .print-area')
    || document.querySelector('.print-area');

  // Nothing to isolate — print the page as it is rather than silently doing nothing.
  if (!target) {
    window.print();
    return;
  }

  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.appendChild(target.cloneNode(true));
  document.body.appendChild(host);

  document.body.classList.add(ISOLATED);
  if (pageClass) document.body.classList.add(pageClass);

  try {
    window.print();
  } finally {
    // Every one of these must be undone even if the print dialog was dismissed, or the app is
    // left with its own interface display:none — a blank screen that looks like a crash.
    document.body.classList.remove(ISOLATED);
    if (pageClass) document.body.classList.remove(pageClass);
    host.remove();
  }
}

export default printElement;
