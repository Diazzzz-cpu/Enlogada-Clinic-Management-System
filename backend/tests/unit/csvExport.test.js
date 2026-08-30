const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toCsv, toCsvSections, csvFilename, sendCsv, wantsCsv, escapeField, formatters: f,
} = require('../../src/utils/csvExport');

/**
 * CSV serialisation. [1.63.0]
 *
 * Three of these assert properties that only matter on somebody else's machine, which is exactly
 * why they need a test rather than a look: the BOM is invisible, RFC 4180 escaping only shows up
 * on a value containing a comma, and the "empty cell not zero" rule only shows up on a NULL.
 */

test('RFC 4180: a field is quoted only when it has to be, and quotes are doubled', () => {
  assert.equal(escapeField('plain'), 'plain');
  assert.equal(escapeField('has, comma'), '"has, comma"');
  assert.equal(escapeField('has "quotes"'), '"has ""quotes"""');
  assert.equal(escapeField('has\nnewline'), '"has\nnewline"');
  assert.equal(escapeField('has\rcarriage'), '"has\rcarriage"');
});

test('null and undefined are EMPTY cells, never the strings "null"/"undefined"', () => {
  assert.equal(escapeField(null), '');
  assert.equal(escapeField(undefined), '');
});

test('records are separated by CRLF, per the spec', () => {
  const csv = toCsv([{ a: 1 }, { a: 2 }], [{ key: 'a', header: 'A', format: f.integer }]);
  assert.equal(csv, 'A\r\n1\r\n2');
});

test('a NULL money value is an empty cell, NOT 0.00', () => {
  // Number(null) is 0 and passes isFinite, so the naive formatter states that the clinic collected
  // nothing rather than that nothing is recorded. Those are different facts.
  assert.equal(f.money(null), '');
  assert.equal(f.money(undefined), '');
  assert.equal(f.money(''), '');
  assert.equal(f.money(0), '0.00', 'a real zero still prints');
  assert.equal(f.money('1450'), '1450.00');
  assert.equal(f.money(1450.5), '1450.50');
});

test('money is a bare number so a spreadsheet can sum the column', () => {
  // The unit belongs in the header. A currency symbol or a thousands separator makes the cell TEXT
  // to Excel, and an unsummable column defeats the entire purpose of exporting rather than
  // printing. This is the one place in the codebase that deliberately avoids formatCurrency.
  const rendered = f.money(1450);
  assert.doesNotMatch(rendered, /[₱,]/);
  assert.equal(Number(rendered), 1450);
});

test('integers and decimals follow the same empty-not-zero rule', () => {
  assert.equal(f.integer(null), '');
  assert.equal(f.integer(0), '0');
  assert.equal(f.integer('42'), '42');
  assert.equal(f.decimal(1)(null), '');
  assert.equal(f.decimal(1)(7.77), '7.8');
});

test('a plain YYYY-MM-DD passes through without being re-parsed', () => {
  // Re-parsing it through Date() would apply a UTC interpretation and shift it — the timezone bug
  // CLAUDE.md records as having shipped three times by other routes.
  assert.equal(f.date('2026-08-28'), '2026-08-28');
  assert.equal(f.date(null), '');
  assert.equal(f.date(''), '');
});

test('a Date is rendered from LOCAL getters, not toISOString', () => {
  // Local midnight on the 28th must not become the 27th, which is what toISOString does in PHT.
  const localMidnight = new Date(2026, 7, 28, 0, 30);
  assert.equal(f.date(localMidnight), '2026-08-28');
});

test('the filename cannot inject a header or escape a directory', () => {
  // The value reaches Content-Disposition and then the user's filesystem.
  const injected = csvFilename('sum"mary\r\nX-Evil: yes', '2026-01-01', '2026-12-31');
  // The properties that matter: nothing that could terminate the header or open a second one.
  assert.doesNotMatch(injected, /["\r\n]/);
  assert.doesNotMatch(injected, /:/, 'a colon could start a second header');
  // Hyphens and underscores SURVIVE, deliberately — the report names use them ('hmo-claims',
  // 'clinic-summary') and stripping them would mangle every legitimate filename to fix a threat
  // that a hyphen does not pose.
  assert.equal(injected, 'summaryX-Evilyes-2026-01-01_to_2026-12-31.csv');

  const traversal = csvFilename('../../etc/passwd', '', '');
  assert.doesNotMatch(traversal, /[/\\.]{2}/);
});

test('a range-less report is named for today', () => {
  assert.match(csvFilename('operations'), /^operations-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('only "csv" means csv — everything else is JSON', () => {
  // The backward-compatibility guarantee. A typo must not turn a dashboard fetch into a download.
  assert.equal(wantsCsv({ query: { format: 'csv' } }), true);
  assert.equal(wantsCsv({ query: { format: 'CSV' } }), true);
  assert.equal(wantsCsv({ query: { format: 'json' } }), false);
  assert.equal(wantsCsv({ query: { format: 'xlsx' } }), false);
  assert.equal(wantsCsv({ query: {} }), false);
  assert.equal(wantsCsv({}), false);
});

test('an empty section still prints its heading and says it is empty', () => {
  // Omitting it would leave the reader unable to tell "the clinic refused no claims this month"
  // from "this export forgot about refusals".
  const csv = toCsvSections([
    { title: 'Refusals', rows: [], columns: [{ key: 'a', header: 'Provider' }] },
  ]);

  assert.match(csv, /Refusals/);
  assert.match(csv, /Provider/);
  assert.match(csv, /No records in this period/);
});

test('sendCsv writes a UTF-8 BOM, an attachment disposition and no-store', () => {
  // Excel on Windows reads a .csv as the system codepage without a BOM, so every ñ and ₱ becomes
  // mojibake — on the machines this clinic actually uses. charset=utf-8 never reaches Excel.
  const headers = {};
  let body = null;
  const res = {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    status() { return this; },
    send: (b) => { body = b; },
  };

  sendCsv(res, 'operations-2026-01-01_to_2026-12-31.csv', 'A,B\r\n1,2');

  assert.equal(body.charCodeAt(0), 0xFEFF, 'must begin with a BOM');
  assert.equal(Buffer.from(body, 'utf8').subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(headers['content-type'], /text\/csv; charset=utf-8/);
  assert.match(headers['content-disposition'], /^attachment; filename="operations-/);
  // A point-in-time document of patient figures must never be revalidated or reused.
  assert.match(headers['cache-control'], /no-store/);
});
