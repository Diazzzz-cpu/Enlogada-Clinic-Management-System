import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * One treatment for every code the clinic reads aloud. [1.63.0]
 *
 * ── What this replaces ──────────────────────────────────────────────────────────────────────
 *
 * Seventeen different hand-rolled treatments for the same class of thing — queue tickets, receipt
 * numbers, appointment references, patient IDs. Counted across the app they ranged over five type
 * sizes (`micro`/`meta`/`fine`/`note`/`sm`), five weights (normal through extrabold) and four inks,
 * so `RCT-20260828-0042` looked like a different kind of object on the cashier's log than on the
 * patient's booking pass. Four of those treatments used `text-slate-400`, which measures 2.56:1 on
 * white — a hard AA failure, on precisely the strings somebody has to read back over a telephone.
 *
 * ── Why these strings deserve their own component ───────────────────────────────────────────
 *
 * They are the identifiers the clinic and the patient use to refer to the same thing across a
 * counter, a phone call and an email. Every one of them gets transcribed by hand at some point.
 * That makes three properties non-negotiable, and none of them survive being re-decided per screen:
 *
 *   - **Monospace**, so 0/O and 1/l are distinguishable — the two mistakes that actually happen.
 *   - **`tabular-nums`**, so a column of receipt numbers aligns and a changed digit is visible.
 *   - **Contrast that clears AA**, because these are read under fluorescent light on a reception
 *     monitor at an angle, not on a designer's display.
 *
 * ── Variants are semantic, not decorative ───────────────────────────────────────────────────
 *
 * The variant says what KIND of identifier this is, and the styling follows. A queue ticket is the
 * loudest because a receptionist calls it across a room; a patient ID is the quietest because it
 * is a cross-reference nobody says out loud. Choosing by meaning rather than by appearance is what
 * stops the next screen inventing an eighteenth treatment.
 */

const VARIANTS = {
  /**
   * The number a receptionist calls out and a patient answers to. Deliberately the heaviest
   * treatment in the app's data vocabulary — it is read across a waiting room.
   *
   * `bg-emphasis`/`text-emphasis-foreground` rather than `bg-slate-900 text-white`: the neutral
   * ramp inverts in dark mode for the INK role, so a slate-900 fill renders near-white there and
   * white-on-white at 1.12:1. That is the exact bug `scripts/checkFillRoles.js` was written to
   * catch, and it shipped on this very element once already.
   */
  queue: 'bg-emphasis text-emphasis-foreground text-fine font-bold px-2 py-1 rounded-md',

  /** A receipt number. Filed, photographed and produced for an HMO or an employer months later. */
  receipt: 'bg-slate-100 text-slate-800 text-fine font-semibold px-2 py-0.5 rounded-md ring-1 ring-inset ring-slate-200',

  /** A booking reference. Typed into a search box at the front desk, or read down a phone. */
  reference: 'bg-slate-100 text-slate-800 text-fine font-semibold px-2 py-0.5 rounded-md ring-1 ring-inset ring-slate-200',

  /**
   * A patient record id. A cross-reference rather than something anybody says, so it is the
   * quietest — but it still uses `ink-muted`, which clears AA, rather than the `slate-400` it
   * previously used at 2.56:1.
   */
  patient: 'text-ink-muted text-micro font-medium',

  /** A peso figure in a table. Tabular so the decimal points line up down a column. */
  amount: 'text-ink text-fine font-semibold',

  /** No chrome — for a code already inside its own labelled container. */
  plain: 'text-ink-soft text-fine font-semibold',
};

/**
 * @param {object} props
 * @param {'queue'|'receipt'|'reference'|'patient'|'amount'|'plain'} [props.variant]
 * @param {React.ReactNode} props.children  The identifier itself.
 * @param {boolean} [props.copyable]  Offer a copy button. For codes a person would otherwise
 *                                    retype — references and receipt numbers, not queue tickets.
 * @param {string} [props.label]      Accessible name, e.g. "Receipt number". Read before the value.
 * @param {string} [props.className]
 */
const DataBadge = ({ variant = 'plain', children, copyable = false, label, className, ...props }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(children));
      setCopied(true);
      // Long enough to be seen, short enough that the control is ready again before somebody
      // wonders whether it worked.
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // A denied clipboard permission must not break the badge. The value is on screen and
      // selectable either way, which is the fallback that already worked before the button existed.
    }
  };

  const badge = (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap font-mono tabular-nums tracking-tight',
        VARIANTS[variant] || VARIANTS.plain,
        !copyable && className
      )}
      // The label is announced before the value, so a screen reader says "Receipt number,
      // RCT-2026…" rather than reading a bare string with no idea what it identifies.
      aria-label={label ? `${label}: ${children}` : undefined}
      {...(copyable ? {} : props)}
    >
      {children}
    </span>
  );

  if (!copyable) return badge;

  return (
    <span className={cn('inline-flex items-center gap-1', className)} {...props}>
      {badge}
      <button
        type="button"
        onClick={copy}
        // Both, and not just `title`: a title alone is not a reliable accessible name and is
        // invisible on touch, which is how the queue rows ended up announcing unlabelled buttons.
        title={copied ? 'Copied' : `Copy ${label || 'value'}`}
        aria-label={copied ? 'Copied' : `Copy ${label || 'value'}`}
        className="flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-muted transition-colors hover:bg-slate-100 hover:text-ink"
      >
        {copied
          ? <Check className="h-3 w-3 text-brand-600" aria-hidden="true" />
          : <Copy className="h-3 w-3" aria-hidden="true" />}
      </button>
    </span>
  );
};

export default DataBadge;
export { VARIANTS as DATA_BADGE_VARIANTS };
