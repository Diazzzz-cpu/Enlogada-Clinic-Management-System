/**
 * What is questionable about a payment submission, decided in ONE place. [1.72.0]
 *
 * The cashier's queue, the review dialog and now the verification confirm all have to agree about
 * whether a submission looks wrong, and they were each deciding it themselves — the queue row with
 * a bare `Math.abs(claimed - due) > 0.01`, the dialog with a guarded version of the same sum.
 *
 * That duplication is harmless while the rule is one line, and stops being harmless the moment a
 * confirm step depends on it: the extra acknowledgement is demanded for exactly the submissions
 * the cashier was warned about, so if the two drift the screen warns about a payment it then lets
 * through on one click, or blocks one it never flagged. Same function, three callers.
 */

/**
 * A centavo of slack. Both figures are NUMERIC(10,2) and this is a comparison for a human, not a
 * reconciliation — flagging a 0.001 difference would cry wolf on every visit.
 */
export const AMOUNT_TOLERANCE = 0.01;

/**
 * A stated amount, or NaN if there isn't one.
 *
 * `Number(null)` and `Number('')` are both 0, not NaN — so a figure that was never stated coerces
 * to a perfectly finite zero and compares as a ₱0.00 claim against the bill. That reads on screen
 * as "the patient claims nothing", demands an acknowledgement for it, and is not what happened.
 * `amount_claimed` is NOT NULL in the schema so it cannot arrive empty, but `amount_due` is
 * computed from the visit's bill and can, and a predicate that is only correct for the column that
 * cannot break it is not worth relying on.
 */
function toAmount(value) {
  if (value === null || value === undefined || value === '') return NaN;
  return Number(value);
}

/**
 * What the screen should be uneasy about, for one submission.
 *
 * @param {object} submission A row from the pending queue.
 * @returns {{claimed: number, due: number, mismatch: boolean, duplicates: number, concerning: boolean}}
 */
export function reviewConcerns(submission) {
  const claimed = toAmount(submission?.amount_claimed);
  const due = toAmount(submission?.amount_due);

  // Both must be real numbers before a difference between them means anything. A submission
  // missing an amount is incomplete, not suspicious, and treating it as a mismatch would put the
  // strict path in front of the cashier for a reason they cannot act on.
  const mismatch =
    Number.isFinite(claimed) && Number.isFinite(due) && Math.abs(claimed - due) > AMOUNT_TOLERANCE;

  const duplicates = Number(submission?.duplicate_count) || 0;

  return {
    claimed: Number.isFinite(claimed) ? claimed : 0,
    due: Number.isFinite(due) ? due : 0,
    mismatch,
    duplicates,
    // The two conditions the system already knows something about. Neither blocks the decision —
    // a repeated reference is legitimate when a patient re-sends a corrected submission, and a
    // mismatch is the cashier's judgement to make — but both earn a deliberate second action.
    concerning: mismatch || duplicates > 0,
  };
}
