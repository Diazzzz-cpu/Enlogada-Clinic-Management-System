#!/usr/bin/env node
/**
 * Proves the extracted discount strategies bill exactly what the old inline branch billed.
 * [1.63.0]
 *
 * ── Why this exists rather than "the tests will catch it" ───────────────────────────────────
 *
 * `discounts.spec.js` covers the cases the clinic actually sees, which is the right thing for an
 * E2E suite to do — but it is a handful of amounts at one VAT registration setting. Refactoring
 * the single most consequential piece of arithmetic in the application deserves a stronger claim
 * than "the examples we happened to write still pass".
 *
 * So this replays a REFERENCE COPY of the pre-refactor algorithm — reproduced below verbatim from
 * the implementation it replaces — against the new strategies over a dense matrix of subtotals,
 * HMO coverages, rates and both registration states. Roughly 4,000 comparisons, every figure to
 * the centavo. If a single one differs, the refactor is wrong and it says exactly which input.
 *
 * The matrix deliberately includes the boundaries that break naive money code: an HMO approving
 * more than the visit is worth, amounts whose 20% lands on a half-centavo, and the 1,000.00 case
 * whose two correct answers (714.29 VAT-registered, 800.00 not) differ by ₱85.71 — the error
 * CLAUDE.md records as having shipped for a day.
 *
 * Run: node src/scripts/verifyDiscountParity.js
 * Exit: 0 on exact parity, 1 on any divergence.
 */

const { computeBreakdown } = require('../services/discount');

/**
 * The algorithm as it stood before extraction, reproduced verbatim.
 *
 * Do not "clean this up" — its value is that it is the old code, not a tidier equivalent. It is
 * the thing being compared against, so any edit to it weakens the proof rather than improving it.
 *
 * @returns {{gross:number, vatDeducted:number, discountBase:number, discountAmount:number, netDue:number}}
 */
function referenceComputeBreakdown({ subtotal, hmoCoverage, percentage, isStatutory }, { vatRegistered, vatRate }) {
  const toCentavos = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

  const gross = toCentavos(Math.max(0, Number(subtotal) - Number(hmoCoverage)));
  const pct = Number(percentage) || 0;

  if (pct <= 0) {
    return { gross, vatDeducted: 0, discountBase: gross, discountAmount: 0, netDue: gross };
  }

  const vatDeducted =
    isStatutory && vatRegistered
      ? toCentavos(gross - gross / (1 + vatRate))
      : 0;
  const discountBase = toCentavos(gross - vatDeducted);
  const discountAmount = toCentavos((discountBase * pct) / 100);
  const netDue = toCentavos(discountBase - discountAmount);

  return { gross, vatDeducted, discountBase, discountAmount, netDue };
}

const SUBTOTALS = [
  0, 0.01, 1, 9.99, 100, 190, 350, 550, 950, 1000, 1450, 1499.99, 2690, 3333.33, 8344, 12345.67, 99999.99,
];
const COVERAGES = [0, 0.01, 100, 500, 1000, 99999.99];
const RATES = [0, 5, 10, 12, 20, 33.33, 50, 100];
const VAT_RATES = [0.12];
const REGISTRATIONS = [true, false];
const STATUTORY = [true, false];

const FIELDS = ['gross', 'vatDeducted', 'discountBase', 'discountAmount', 'netDue'];

function main() {
  let checked = 0;
  const failures = [];

  for (const subtotal of SUBTOTALS) {
    for (const hmoCoverage of COVERAGES) {
      for (const percentage of RATES) {
        for (const isStatutory of STATUTORY) {
          for (const vatRegistered of REGISTRATIONS) {
            for (const vatRate of VAT_RATES) {
              const input = { subtotal, hmoCoverage, percentage, isStatutory };
              const expected = referenceComputeBreakdown(input, { vatRegistered, vatRate });
              const actual = computeBreakdown({ ...input, vatRegistered, vatRate });
              checked += 1;

              for (const field of FIELDS) {
                if (expected[field] !== actual[field]) {
                  failures.push({ input, vatRegistered, field, expected: expected[field], actual: actual[field] });
                }
              }

              // The invariant processPayment depends on: the parts must reconstitute the whole.
              const sum = Math.round((actual.netDue + actual.discountAmount + actual.vatDeducted) * 100) / 100;
              if (sum !== actual.gross) {
                failures.push({ input, vatRegistered, field: 'SUM INVARIANT', expected: actual.gross, actual: sum });
              }
            }
          }
        }
      }
    }
  }

  console.log(`Discount parity: ${checked} input combinations, ${checked * FIELDS.length} field comparisons.`);

  // The two answers the clinic's own invoice turns on, stated explicitly so a reader does not have
  // to trust the matrix to see that the important case is covered.
  const senior = (vatRegistered) =>
    computeBreakdown({ subtotal: 1000, hmoCoverage: 0, percentage: 20, isStatutory: true, vatRegistered, vatRate: 0.12 });
  console.log(`  Senior on ₱1,000 — VAT-registered clinic : ₱${senior(true).netDue.toFixed(2)}  (expect 714.29)`);
  console.log(`  Senior on ₱1,000 — non-VAT clinic (ours) : ₱${senior(false).netDue.toFixed(2)}  (expect 800.00)`);

  if (failures.length) {
    console.error(`\n✗ ${failures.length} divergence(s) from the pre-refactor behaviour:`);
    for (const f of failures.slice(0, 20)) {
      console.error(
        `   ${JSON.stringify(f.input)} vatRegistered=${f.vatRegistered} ` +
        `→ ${f.field}: expected ${f.expected}, got ${f.actual}`
      );
    }
    if (failures.length > 20) console.error(`   … and ${failures.length - 20} more`);
    process.exit(1);
  }

  if (senior(true).netDue !== 714.29 || senior(false).netDue !== 800) {
    console.error('\n✗ The statutory worked example does not match the figures on the clinic invoice.');
    process.exit(1);
  }

  console.log('\n✓ Exact parity. The strategies bill what the inline branch billed, to the centavo.');
}

main();
