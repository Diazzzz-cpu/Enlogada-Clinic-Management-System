import { describe, it, expect } from 'vitest';
import { reviewConcerns, AMOUNT_TOLERANCE } from '../../src/lib/paymentReview';

/**
 * What makes a payment submission worth a second look. [1.72.0]
 *
 * This predicate decides two things that must agree: which submissions the cashier is WARNED about,
 * and which ones additionally demand a tick before they can be verified. Verification is the one
 * irreversible action on that panel — it issues a receipt, releases the visit and writes a cash-up
 * entry — so the interesting cases are the boundaries, where being wrong in either direction is a
 * real cost.
 *
 * Wrong one way, the screen flags a clean payment and the tick becomes furniture the cashier stops
 * reading. Wrong the other way, it waves through the exact submission it had just objected to.
 */

/** The shape the pending queue returns, with only what this function reads. */
const submission = (over = {}) => ({
  amount_claimed: '1450.00',
  amount_due: '1450.00',
  duplicate_count: 0,
  ...over,
});

describe('a payment that matches and stands alone', () => {
  it('raises nothing, so it is confirmed by confirming', () => {
    const c = reviewConcerns(submission());
    expect(c.mismatch).toBe(false);
    expect(c.duplicates).toBe(0);
    expect(c.concerning).toBe(false);
  });

  it('returns both figures as numbers, whatever NUMERIC gave us', () => {
    // Postgres NUMERIC(10,2) arrives as a STRING. Compared with === or subtracted without
    // coercion it misbehaves quietly, which is the kind of bug that reaches a drawer count.
    const c = reviewConcerns(submission({ amount_claimed: '1450.00', amount_due: '1450.00' }));
    expect(c.claimed).toBe(1450);
    expect(c.due).toBe(1450);
  });
});

describe('the amount comparison', () => {
  it('flags the case the queue exists for — a small claim against a large bill', () => {
    const c = reviewConcerns(submission({ amount_claimed: '50.00', amount_due: '1450.00' }));
    expect(c.mismatch).toBe(true);
    expect(c.concerning).toBe(true);
  });

  it('flags an OVERclaim too, not only an underclaim', () => {
    // Approving still records the visit's total, so the patient has sent more than the clinic is
    // about to record receiving. That is the clinic holding money it has not accounted for.
    const c = reviewConcerns(submission({ amount_claimed: '2000.00', amount_due: '1450.00' }));
    expect(c.mismatch).toBe(true);
  });

  it('ignores a difference inside the centavo tolerance', () => {
    const c = reviewConcerns(submission({ amount_claimed: '1450.00', amount_due: '1450.005' }));
    expect(c.mismatch, 'a rounding artefact is not a discrepancy').toBe(false);
  });

  it('treats a difference exactly ON the tolerance as clean', () => {
    // The comparison is strictly greater-than. Stated so the boundary is a decision on record
    // rather than whichever way the operator happened to be typed.
    const c = reviewConcerns(submission({ amount_claimed: '1450.00', amount_due: String(1450 + AMOUNT_TOLERANCE) }));
    expect(c.mismatch).toBe(false);
  });

  it('flags a difference just past the tolerance', () => {
    const c = reviewConcerns(submission({ amount_claimed: '1450.00', amount_due: '1450.02' }));
    expect(c.mismatch).toBe(true);
  });
});

describe('a missing or unreadable amount', () => {
  // Incomplete is not the same as suspicious. Putting the strict path in front of a cashier for a
  // reason they cannot act on teaches them to tick past it.
  it('does not call a null amount a mismatch', () => {
    expect(reviewConcerns(submission({ amount_claimed: null })).mismatch).toBe(false);
    expect(reviewConcerns(submission({ amount_due: null })).mismatch).toBe(false);
  });

  it('does not call unparseable text a mismatch', () => {
    expect(reviewConcerns(submission({ amount_claimed: 'n/a' })).mismatch).toBe(false);
  });

  it('still reports a usable figure to render, rather than NaN on screen', () => {
    const c = reviewConcerns(submission({ amount_claimed: null, amount_due: null }));
    expect(c.claimed).toBe(0);
    expect(c.due).toBe(0);
  });
});

describe('a reference that has been seen before', () => {
  it('is concerning on its own, even when the amounts agree perfectly', () => {
    const c = reviewConcerns(submission({ duplicate_count: 1 }));
    expect(c.mismatch).toBe(false);
    expect(c.duplicates).toBe(1);
    expect(c.concerning, 'the same transfer counted twice is money that never arrived').toBe(true);
  });

  it('counts more than one', () => {
    expect(reviewConcerns(submission({ duplicate_count: '3' })).duplicates).toBe(3);
  });

  it('treats a missing count as none rather than as a warning', () => {
    expect(reviewConcerns(submission({ duplicate_count: undefined })).concerning).toBe(false);
  });
});

describe('a submission that is not there at all', () => {
  it('answers without throwing, because the dialog renders from whatever it was handed', () => {
    expect(() => reviewConcerns(null)).not.toThrow();
    expect(reviewConcerns(null).concerning).toBe(false);
    expect(reviewConcerns(undefined).concerning).toBe(false);
  });
});
