/**
 * The payment methods this clinic accepts. One list, because it used to be six. [1.33.0]
 *
 * PayMaya was removed here: the clinic owner does not hold a PayMaya merchant account, so
 * offering it was offering a way to pay that nobody could settle. It is gone from the checkout,
 * the gateway, the e-wallet bucket and the database constraint.
 *
 * ── Putting it back ─────────────────────────────────────────────────────────────────────────
 *
 * That decision may be revisited, so nothing here is written in a way that assumes it is final.
 * Restoring PayMaya is:
 *
 *   1. add 'PayMaya' to COUNTER_METHODS and to EWALLET_METHODS below
 *   2. add `PayMaya: 'paymaya'` to GATEWAY_METHODS below
 *   3. add the same string to frontend/src/lib/paymentMethods.js
 *   4. run a migration widening chk_payment_method — copy [1.33.0] and reverse it, or just run
 *      `node src/scripts/migratePaymentMethods.js --rollback`, which restores the old constraint
 *
 * Steps 1-3 are one line each and step 4 is already written. Before this existed the same change
 * meant editing an inline SQL literal in the summary query, a hard-coded JSX array in the cashier
 * terminal, a caption string, a gateway map, the schema file and a seeder — six places that had
 * no way of knowing about each other.
 *
 * ── Why the split ───────────────────────────────────────────────────────────────────────────
 *
 *   COUNTER_METHODS   the whole vocabulary, and the source of chk_payment_method. A cashier can
 *                     record any of these; the CHECK constraint is what actually enforces it,
 *                     since no service-layer validation of the method string exists.
 *
 *   EWALLET_METHODS   the subset the cash-up reports as "E-Wallet". A strict subset of
 *                     COUNTER_METHODS, and the reason the cashier's three method tiles sum
 *                     exactly to the collected figure: Cash, e-wallet and Bank partition the
 *                     vocabulary with no remainder. Adding a method to COUNTER_METHODS without
 *                     deciding which tile it belongs to breaks that, which is why
 *                     assertMethodsPartition() below is called at module load rather than left
 *                     as a comment nobody reads.
 *
 *   GATEWAY_METHODS   the subset payable ONLINE, mapped to PayMongo's own vocabulary. Narrower
 *                     again: PayMongo also supports card, grab_pay and qrph, which the clinic
 *                     deliberately does not offer. Keys must be COUNTER_METHODS entries, because
 *                     the key is what gets written into payments.payment_method.
 */

const CASH_METHOD = 'Cash';
const BANK_METHOD = 'Bank';

// Everything a payment row may record. Drives chk_payment_method via migratePaymentMethods.js.
const EWALLET_METHODS = ['GCash'];

const COUNTER_METHODS = [CASH_METHOD, ...EWALLET_METHODS, BANK_METHOD];

/**
 * The subset a patient can pay into WITHOUT being at the counter. [1.64.0]
 *
 * ── Why this is not COUNTER_METHODS ─────────────────────────────────────────────────────────
 *
 * Publishing a payment method asks two questions, and only the first is about the cash-up:
 *
 *   1. Is this a bucket a verified payment can be written to?  Cash, GCash and Bank all pass.
 *   2. Can a patient REACH it from their phone?                Cash does not.
 *
 * `payment_methods` answers the second question as well, because a published row is an account
 * number a patient is told to send money to — `PayBookingPanel` renders it as a copyable field
 * under the words "Send ₱X to the…". Cash has no account number to copy and no QR to scan; it is
 * handed across a counter, which is the path that already exists when nothing is published here.
 *
 * So publishing a Cash "channel" produced a screen instructing a patient to transfer money to an
 * account that does not exist. The validation read COUNTER_METHODS — the right list for
 * `payments.payment_method`, the wrong list for this table — and the two happen to overlap enough
 * that the mistake looked correct.
 *
 * Kept as a derivation of the other constants rather than a literal, so adding an e-wallet adds it
 * here too. Cash is excluded by construction: it is the one method defined by its presence.
 */
const PUBLISHABLE_METHODS = [...EWALLET_METHODS, BANK_METHOD];

// clinic-facing payments.payment_method value -> PayMongo payment_method_types value.
// 'card', 'grab_pay', 'qrph' etc. are valid PayMongo values but are deliberately NOT offered.
const GATEWAY_METHODS = {
  GCash: 'gcash'
};

/**
 * Fails loudly at startup if the buckets stop partitioning the vocabulary.
 *
 * The cashier's Cash / E-Wallet / Bank tiles are asserted in cashup-reversals.spec.js to sum to
 * the collected total, and that only holds while every method lands in exactly one tile. A method
 * added to COUNTER_METHODS and to no bucket would silently make the tiles short by its takings —
 * the precise failure the Bank tile was added to fix, when a 200.00 transfer appeared in no tile
 * at all. Cheap to check once, expensive to notice on a cash-up sheet.
 */
function assertMethodsPartition() {
  const bucketed = [CASH_METHOD, ...EWALLET_METHODS, BANK_METHOD];
  const unbucketed = COUNTER_METHODS.filter((m) => !bucketed.includes(m));
  if (unbucketed.length > 0) {
    throw new Error(
      `paymentMethods: ${unbucketed.join(', ')} belongs to no cash-up tile. ` +
      'Add it to EWALLET_METHODS, or give it a tile of its own in findTransactionSummary.'
    );
  }
  const strays = Object.keys(GATEWAY_METHODS).filter((m) => !COUNTER_METHODS.includes(m));
  if (strays.length > 0) {
    throw new Error(
      `paymentMethods: ${strays.join(', ')} is offered online but is not a valid payment method. ` +
      'A gateway key is written straight into payments.payment_method and would violate ' +
      'chk_payment_method at settlement — after the patient has already been charged.'
    );
  }
}

assertMethodsPartition();

/** `'Cash', 'GCash', 'Bank'` — ready to drop into a CHECK or an IN (…). */
const sqlList = (methods) => methods.map((m) => `'${m}'`).join(', ');

module.exports = {
  CASH_METHOD,
  BANK_METHOD,
  EWALLET_METHODS,
  COUNTER_METHODS,
  PUBLISHABLE_METHODS,
  GATEWAY_METHODS,
  sqlList
};
