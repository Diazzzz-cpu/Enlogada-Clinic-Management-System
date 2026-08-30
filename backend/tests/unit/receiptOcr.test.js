const test = require('node:test');
const assert = require('node:assert/strict');

const receiptOcrService = require('../../src/services/receiptOcrService');
const db = require('../../src/config/database');

const { extractReferenceNumber, extractAmount, parseAmountToken } = receiptOcrService.__parsers;

/**
 * The receipt parsers. [1.63.0]
 *
 * Tesseract itself needs no test — it is somebody else's OCR engine. What needs one is the layer
 * that turns its output into a reference number and an amount, because that layer already shipped
 * two bugs, both of which produced a PLAUSIBLE WRONG ANSWER rather than an obvious failure:
 *
 *   1. `\s` matched a newline, so the capture ran off the reference line into the next and
 *      returned `E2E-1787890589109Aug28` — a reference matching no record, so the duplicate check
 *      returned clean on exactly the receipt it was built to catch.
 *   2. A digits-only capture truncated `GC-1787890589109` to its numeric tail, breaking the same
 *      check on every hyphenated bank reference.
 *
 * Both were found by rendering an actual receipt image and reading the result, not by reading the
 * regex. These tests are that discovery, written down.
 */

// The module transitively opens a pg pool at require time. Closed here so the test process exits
// rather than hanging on an idle handle.
test.after(async () => {
  await db.pool.end();
});

test('a reference is read from the label, in the wordings receipts actually use', () => {
  const cases = [
    ['Ref. No. 1029384756123', '1029384756123'],   // the commonest GCash spelling
    ['Ref No. 1029384756124', '1029384756124'],
    ['Reference Number: 4455667788990', '4455667788990'],
    ['Reference No. 5566778899001', '5566778899001'],
    ['Transaction ID: 000123456789', '000123456789'],
    ['Txn No, 7788990011223', '7788990011223'],
  ];

  for (const [text, expected] of cases) {
    const got = extractReferenceNumber(text);
    assert.equal(got.value, expected, text);
    assert.equal(got.matchedOn, 'label', `${text} should use the high-confidence path`);
  }
});

test('the capture stops at the end of the line — the swallowed-date bug', () => {
  // `\s` matches a newline. With it, this returned 'E2E-1787890589109Aug28'.
  const text = 'Ref. No. E2E-1787890589109\nAug 28, 2026 3:41 PM';
  assert.equal(extractReferenceNumber(text).value, 'E2E-1787890589109');
});

test('a hyphenated or prefixed bank reference is kept whole', () => {
  // A digits-only capture truncated these to the numeric tail, so the duplicate lookup compared a
  // different string against the stored one and always found nothing.
  assert.equal(extractReferenceNumber('Reference No. GC-1787890589109').value, 'GC-1787890589109');
  assert.equal(extractReferenceNumber('Ref No: BPI2026081234567').value, 'BPI2026081234567');
  assert.equal(extractReferenceNumber('Transaction ID: TXN_998877665544').value, 'TXN_998877665544');
});

test('an OCR-split digit run is rejoined, but a following word is not', () => {
  // Spaces mean two different things depending on what is either side of them.
  assert.equal(extractReferenceNumber('Ref No. 1029 3847 5612 3').value, '1029384756123');
  assert.equal(extractReferenceNumber('Ref No: BPI2026081234567 Completed').value, 'BPI2026081234567');
});

test('prose after the label is refused rather than offered as a reference', () => {
  // "Ref No. Successful" is a real line on a real receipt when OCR loses the number. A field that
  // fills itself with a plausible wrong value is worse than one left empty — nobody re-reads a box
  // that already has something in it.
  assert.equal(extractReferenceNumber('Ref No. Successful').value, null);
  assert.equal(extractReferenceNumber('Reference Number: PENDING REVIEW').value, null);
});

test('an unlabelled long digit run is a lower-confidence fallback, and says so', () => {
  const got = extractReferenceNumber('some text 9081726354019 more');
  assert.equal(got.value, '9081726354019');
  assert.equal(got.matchedOn, 'digit-run', 'the caller must be able to tell how it was found');
});

test('a short digit run is NOT a reference', () => {
  // A date, an amount or a phone number would otherwise be offered as one.
  assert.equal(extractReferenceNumber('Total 1450').value, null);
  assert.equal(extractReferenceNumber('a wall').value, null);
});

test('amounts survive whichever decimal convention OCR produces', () => {
  // OCR confuses . and , constantly. The last separator followed by exactly two digits is the
  // decimal point, whichever character it chose.
  assert.equal(parseAmountToken('1,450.00'), 1450);
  assert.equal(parseAmountToken('1.450,00'), 1450);
  assert.equal(parseAmountToken('1,450,00'), 1450);
  assert.equal(parseAmountToken('1,450'), 1450, 'thousands separator, no decimals');
  assert.equal(parseAmountToken('950'), 950);
});

test('the total wins over a fee line', () => {
  // The figure the patient is claiming is the total they sent; a fee would otherwise win by
  // appearing first.
  const text = 'Amount PHP 1,450.00\nFee PHP 15.00\nRef No. 5566778899004';
  assert.equal(extractAmount(text), 1450);
});

test('a peso sign is read, and so is its absence', () => {
  assert.equal(extractAmount('Total ₱ 2,500.00'), 2500);
  assert.equal(extractAmount('Amount PHP 950.00'), 950);
  assert.equal(extractAmount('Total Amount Sent 1,450.00'), 1450);
});

test('an implausible figure is not offered as an amount', () => {
  // A digit run read out of a reference number parses as a number in the millions, and offering
  // that would put a 1,029,384.00 claim on a 950 visit.
  assert.equal(extractAmount('Ref No. 1029384756123'), null);
});

test('nothing readable yields null, not zero', () => {
  assert.equal(extractAmount('blurry photo of a wall'), null);
  assert.equal(extractAmount(''), null);
});
