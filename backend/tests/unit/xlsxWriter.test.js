const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');

const { buildXlsx, colName, dateSerial, crc32, sheetName } = require('../../src/utils/xlsxWriter');
const { operationsXlsx, summaryXlsx, hmoClaimsXlsx, staffWorkloadXlsx, dayLabel, hourLabel } = require('../../src/utils/reportXlsx');

/**
 * The Excel export. [1.119.0]
 *
 * Written without a library, so these hold the parts a library would have: the zip is readable
 * (every entry's CRC checks out), the workbook has the parts Excel requires, money is a NUMBER in
 * a money format, a total row is a SUM over exactly its own rows, and text that would break XML
 * or Excel's footer codes is escaped.
 */

/** Unzips a buffer into { name: string } by walking the central directory. */
function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'has an end-of-central-directory record');
  const count = buffer.readUInt16LE(end + 10);
  let p = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(p), 0x02014b50);
    const crc = buffer.readUInt32LE(p + 16);
    const size = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const offset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(offset + 26);
    const data = zlib.inflateRawSync(buffer.subarray(offset + 30 + localNameLength, offset + 30 + localNameLength + size));
    assert.equal(crc32(data), crc, `${name} checks out`);
    files[name] = data.toString('utf8');
    p += 46 + nameLength;
  }
  return files;
}

const sheetOf = (buffer) => unzip(buffer)['xl/worksheets/sheet1.xml'];

test('the package has every part Excel requires', () => {
  const files = unzip(buildXlsx({ clinic: 'Clinic', title: 'A Report', blocks: [] }));
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
    'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'docProps/core.xml', 'docProps/app.xml']) {
    assert.ok(files[part], part);
  }
  assert.match(files['xl/styles.xml'], /formatCode="&quot;₱&quot;#,##0\.00"/, 'a peso money format');
  assert.match(files['xl/worksheets/sheet1.xml'], /paperSize="9"/, 'A4');
  assert.match(files['xl/worksheets/sheet1.xml'], /fitToWidth="1"/, 'one page wide');
});

test('money is a number with a money style, and a total is a SUM of exactly its rows', () => {
  const sheet = sheetOf(buildXlsx({
    clinic: 'Clinic',
    title: 'T',
    blocks: [{
      type: 'table',
      columns: [{ key: 'name', header: 'Service', kind: 'text' }, { key: 'net', header: 'Net', kind: 'money' }],
      rows: [{ name: 'CBC', net: '338.18' }, { name: 'Urinalysis', net: 169.09 }],
      total: { label: 'Total', sum: ['net'] },
    }],
  }));
  // Rows: clinic(1), title(2), header(3), data(4,5), total(6).
  assert.match(sheet, /<c r="B4" s="9"><v>338\.18<\/v><\/c>/);
  assert.match(sheet, /<c r="B6" s="15"><f>SUM\(B4:B5\)<\/f><v>507\.27<\/v><\/c>/);
});

test('a missing figure is an empty cell, never a zero', () => {
  const sheet = sheetOf(buildXlsx({
    clinic: 'C', title: 'T',
    blocks: [{ type: 'table', columns: [{ key: 'a', header: 'A', kind: 'text' }, { key: 'b', header: 'B', kind: 'money' }], rows: [{ a: 'x', b: null }] }],
  }));
  assert.match(sheet, /<c r="B4" s="9"\/>/);
});

test('text that would break the file is escaped', () => {
  const files = unzip(buildXlsx({
    clinic: 'Enlogada Ultrasound & Diagnostic Clinic',
    title: 'T <1>',
    footer: 'Enlogada Ultrasound & Diagnostic Clinic',
    blocks: [{ type: 'note', text: 'say "hi" \u0007 & bye' }],
  }));
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /Enlogada Ultrasound &amp; Diagnostic Clinic/);
  assert.match(sheet, /T &lt;1&gt;/);
  assert.ok(!sheet.includes('\u0007'), 'control characters are dropped');
  // In the footer, "&" is Excel's command character: a literal one is "&&", then XML-escaped.
  assert.match(sheet, /Enlogada Ultrasound &amp;&amp; Diagnostic Clinic/);
});

test('helpers', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(dateSerial('2026-10-16'), 46311);
  assert.equal(dateSerial(new Date(2026, 9, 16)), 46311, 'a local date, not shifted through UTC');
  assert.equal(sheetName('HMO Claims: [Oct]/Nov?'), 'HMO Claims   Oct  Nov');
  assert.equal(dayLabel('2026-10-09'), 'October 9, 2026');
  assert.equal(hourLabel(8), '8:00 AM');
  assert.equal(hourLabel(12), '12:00 PM');
  assert.equal(hourLabel(15), '3:00 PM');
});

test('Departments is takings and sales only: no front desk, no turnaround', () => {
  const sheet = sheetOf(operationsXlsx({
    billing: {
      totals: { collected: '11780', receipts: 20, discounts: '240', vat_exempted: '0', refunded: '0', refunds: 0 },
      byService: [{ test_name: 'Whole Abdomen', category_name: 'Ultrasound', sold: 2, gross: '2500', net: '2500' }],
    },
    reception: { visits: 33 },
    diagnostics: { byCategory: [{ category_name: 'Laboratory', released: 9 }], outstanding: [] },
  }, '2026-10-10', '2026-10-16'));
  assert.match(sheet, /Departments Report/);
  assert.match(sheet, /1\. Takings/);
  assert.match(sheet, /2\. Sales by service/);
  assert.match(sheet, /October 10, 2026 to October 16, 2026/);
  assert.doesNotMatch(sheet, /Front desk|Turnaround|Outstanding/i);
});

test('every report builds', () => {
  assert.ok(sheetOf(summaryXlsx({ revenueTrend: [{ day: '2026-10-10', total: '980' }], serviceVolume: [], visitStatusBreakdown: [{ status: 'Completed', visit_count: 2 }], paymentMethodBreakdown: [], hourlyArrivals: [{ hour: 8, walk_in: 1, online: 0, total: 1 }] }, '2026-10-10', '2026-10-16')).includes('Arrivals by hour'));
  assert.ok(sheetOf(hmoClaimsXlsx({ totals: { approved: 0, pending: 700, refused: 0, collected: 0 }, providers: [{ provider_name: '1CoopHealth', visits: 1, tests_claimed: 1, approved: 0, pending: 700, refused: 0, collected: 0 }] }, '2026-09-16', '2026-10-15')).includes('money still owed'));
  // [1.127.0] Which tests the claims were for, as its own section.
  const hmo = sheetOf(hmoClaimsXlsx({
    totals: { approved: 1080, pending: 0, refused: 0, collected: 0 },
    providers: [{ provider_name: '1CoopHealth', visits: 6, tests_claimed: 6, approved: 1080, pending: 0, refused: 0, collected: 0 }],
    tests: [{ provider_name: '1CoopHealth', test_name: 'Complete Blood Count (CBC)', category_name: 'Laboratory', tests_claimed: 6, approved: 1080, pending: 0, refused: 0 }],
  }, '2026-09-16', '2026-10-15'));
  assert.match(hmo, /3\. By test/);
  assert.match(hmo, /Complete Blood Count \(CBC\)/);
  assert.ok(sheetOf(staffWorkloadXlsx({ receptionWorkload: [{ first_name: 'Maria', last_name: 'Santos', visit_count: 33 }], diagnosticWorkload: [] }, '2026-10-10', '2026-10-16')).includes('Maria Santos'));
});
