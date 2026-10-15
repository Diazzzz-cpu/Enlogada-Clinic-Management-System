const zlib = require('zlib');

/**
 * A report as an Excel workbook (.xlsx) the clinic can open and read without fixing it. [1.119.0]
 *
 * The CSV export opened in Excel as one cramped grid: every column at the default width, so
 * "Receipts Issued" read "Receipts I", no bold, no money format, the report's sections run
 * together. A CSV cannot carry any of that; it has no widths, no styles and no number formats. An
 * .xlsx carries all three, and stays a spreadsheet: money is still a NUMBER (formatted "₱1,450.00",
 * not typed as text), so a column still adds up, and each table's total row is a SUM formula.
 *
 * Written here rather than with a library: one sheet, inline strings and a fixed set of styles is
 * a few hundred lines of XML and a zip container, which Node's own zlib compresses. The backend has
 * kept its dependencies to what it cannot do without, and this is not one of those.
 *
 * The workbook is laid out like the printed report: the clinic, the report's title, its period and
 * when it was made, then numbered sections, each a bordered table or a list of figures. Gridlines
 * are off, the page is A4 fitted to one page wide, and the printed footer names the report and
 * numbers the pages, so printing it from Excel wastes no paper either.
 */

// ── Styles ──────────────────────────────────────────────────────────────────────────────────
// Indices into cellXfs below. Fixed, so a builder names a style rather than describing one.
const S = {
  default: 0,
  clinic: 1,
  title: 2,
  metaLabel: 3,
  metaValue: 4,
  section: 5,
  head: 6,
  headNum: 7,
  text: 8,
  money: 9,
  int: 10,
  decimal: 11,
  date: 12,
  percent: 13,
  totalText: 14,
  totalMoney: 15,
  totalInt: 16,
  totalDecimal: 17,
  totalPercent: 18,
  note: 19,
  pairLabel: 20,
};

const MONEY_FMT = 164;
const DATE_FMT = 165;
const DECIMAL_FMT = 166;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="${MONEY_FMT}" formatCode="&quot;₱&quot;#,##0.00"/>
<numFmt numFmtId="${DATE_FMT}" formatCode="mmm d, yyyy"/>
<numFmt numFmtId="${DECIMAL_FMT}" formatCode="0.0"/>
</numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="12"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE9ECEF"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="4">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FF333333"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="medium"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="21">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>
<xf numFmtId="${MONEY_FMT}" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="${DECIMAL_FMT}" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="${DATE_FMT}" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="${MONEY_FMT}" fontId="3" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="3" fontId="3" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="${DECIMAL_FMT}" fontId="3" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="9" fontId="3" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** The cell and total styles for each kind of column. */
const KIND = {
  text: { cell: S.text, total: S.totalText, numeric: false },
  money: { cell: S.money, total: S.totalMoney, numeric: true },
  int: { cell: S.int, total: S.totalInt, numeric: true },
  decimal: { cell: S.decimal, total: S.totalDecimal, numeric: true },
  date: { cell: S.date, total: S.totalText, numeric: false },
  percent: { cell: S.percent, total: S.totalPercent, numeric: true },
};

// ── XML helpers ─────────────────────────────────────────────────────────────────────────────

// XML 1.0 forbids most control characters outright; one in a patient's comment would make the
// whole file unreadable, so they are dropped rather than escaped.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const xml = (value) => String(value ?? '')
  .replace(INVALID_XML, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
const colName = (index) => {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
};

const isBlank = (v) => v === null || v === undefined || v === '';

/**
 * A calendar day as Excel's date serial. The day is read with LOCAL getters (pg returns a DATE as
 * local midnight), and a bare "YYYY-MM-DD" is taken as written, never through UTC.
 */
const dateSerial = (value) => {
  let y; let m; let d;
  const plain = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (plain) {
    [y, m, d] = [Number(plain[1]), Number(plain[2]), Number(plain[3])];
  } else {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    [y, m, d] = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
  }
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
};

/** The number a cell holds, or null for a blank (a missing figure is an empty cell, never 0). */
const numberOf = (kind, value) => {
  if (isBlank(value)) return null;
  if (kind === 'date') return dateSerial(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// ── The sheet ───────────────────────────────────────────────────────────────────────────────

/**
 * Lays out the blocks into rows of cells, and works out the column widths from what is in them.
 *
 * A block is one of:
 *   { type: 'section', title }                      a numbered heading, ruled underneath
 *   { type: 'note', text }                          a short italic line, wrapped across the sheet
 *   { type: 'pairs', items: [{ label, value, kind }] }   figures, label beside value
 *   { type: 'table', columns: [{ header, key, kind, value? }], rows, total?: { label, sum: [keys] } }
 */
function layout({ clinic, title, meta = [], blocks = [] }) {
  const rows = [];        // [{ cells: [{ col, style, text?, number?, formula? }], height?, merge? }]
  const widths = [];      // characters per column, from table and figure cells only
  const fit = (col, chars) => { widths[col] = Math.max(widths[col] || 0, chars); };
  const add = (cells, extra = {}) => { rows.push({ cells, ...extra }); return rows.length; };

  add([{ col: 0, style: S.clinic, text: clinic }], { height: 20 });
  add([{ col: 0, style: S.title, text: title }], { height: 18 });
  for (const [label, value] of meta) {
    add([{ col: 0, style: S.metaLabel, text: label }, { col: 1, style: S.metaValue, text: value }]);
    fit(0, String(label).length);
  }

  for (const block of blocks) {
    if (block.type === 'section') {
      add([]);
      add([{ col: 0, style: S.section, text: block.title }], { underlineAcross: true });
    } else if (block.type === 'note') {
      add([{ col: 0, style: S.note, text: block.text }], { note: true });
    } else if (block.type === 'pairs') {
      for (const item of block.items) {
        const kind = KIND[item.kind] || KIND.text;
        const number = kind.numeric ? numberOf(item.kind, item.value) : null;
        add([
          { col: 0, style: S.pairLabel, text: item.label },
          kind.numeric
            ? { col: 1, style: kind.cell, number }
            : { col: 1, style: kind.cell, text: item.value ?? '' },
        ]);
        fit(0, String(item.label).length);
        fit(1, item.kind === 'money' ? String(Math.round(number || 0)).length + 6 : String(item.value ?? '').length);
      }
    } else if (block.type === 'table') {
      const { columns, rows: data = [] } = block;
      add(columns.map((c, i) => {
        fit(i, String(c.header).length);
        return { col: i, style: (KIND[c.kind] || KIND.text).numeric ? S.headNum : S.head, text: c.header };
      }));
      const first = rows.length + 1;
      if (!data.length) {
        add([{ col: 0, style: S.note, text: block.empty || 'Nothing in this period.' }]);
        continue;
      }
      for (const row of data) {
        add(columns.map((c, i) => {
          const kind = KIND[c.kind] || KIND.text;
          const raw = c.value ? c.value(row) : row[c.key];
          if (kind.numeric || c.kind === 'date') {
            const number = numberOf(c.kind, raw);
            fit(i, c.kind === 'money' ? String(Math.round(number || 0)).length + 6 : c.kind === 'date' ? 12 : String(number ?? '').length + 1);
            return { col: i, style: kind.cell, number };
          }
          fit(i, String(raw ?? '').length);
          return { col: i, style: kind.cell, text: raw ?? '' };
        }));
      }
      const last = rows.length;
      if (block.total) {
        add(columns.map((c, i) => {
          const kind = KIND[c.kind] || KIND.text;
          if (i === 0) return { col: 0, style: S.totalText, text: block.total.label || 'Total' };
          if (block.total.sum?.includes(c.key)) {
            const ref = colName(i);
            const sum = data.reduce((s, r) => s + (numberOf(c.kind, c.value ? c.value(r) : r[c.key]) || 0), 0);
            return { col: i, style: kind.total, formula: `SUM(${ref}${first}:${ref}${last})`, number: sum };
          }
          if (block.total.values && c.key in block.total.values) {
            return { col: i, style: kind.total, number: block.total.values[c.key] };
          }
          return { col: i, style: S.totalText, text: '' };
        }));
      }
    }
  }

  const columnCount = Math.max(2, widths.length);
  return { rows, widths, columnCount };
}

function sheetXml(spec) {
  const { rows, widths, columnCount } = layout(spec);
  const width = (i) => Math.min(48, Math.max(i === 0 ? 14 : 10, (widths[i] || 0) + 2));
  const totalWidth = Array.from({ length: columnCount }, (_, i) => width(i)).reduce((a, b) => a + b, 0);
  const lastCol = colName(columnCount - 1);
  const merges = [];

  const rowXml = rows.map((row, r) => {
    const n = r + 1;
    let height = row.height;
    if (row.note) {
      merges.push(`A${n}:${lastCol}${n}`);
      const text = row.cells[0]?.text || '';
      height = 14 * Math.max(1, Math.ceil(text.length / Math.max(20, totalWidth * 1.1)));
    }
    // A section heading's rule runs the width of the sheet, so each section reads as one block.
    const cells = row.underlineAcross
      ? [...row.cells, ...Array.from({ length: columnCount - 1 }, (_, i) => ({ col: i + 1, style: S.section, text: '' }))]
      : row.cells;
    const body = cells.map((c) => {
      const ref = `${colName(c.col)}${n}`;
      if (c.formula) {
        return `<c r="${ref}" s="${c.style}"><f>${xml(c.formula)}</f><v>${Number(c.number) || 0}</v></c>`;
      }
      if (c.number !== undefined) {
        return c.number === null
          ? `<c r="${ref}" s="${c.style}"/>`
          : `<c r="${ref}" s="${c.style}"><v>${c.number}</v></c>`;
      }
      if (c.text === '' || c.text === undefined || c.text === null) return `<c r="${ref}" s="${c.style}"/>`;
      return `<c r="${ref}" s="${c.style}" t="inlineStr"><is><t xml:space="preserve">${xml(c.text)}</t></is></c>`;
    }).join('');
    const ht = height ? ` ht="${height}" customHeight="1"` : '';
    return `<row r="${n}"${ht}>${body}</row>`;
  }).join('');

  const cols = Array.from({ length: columnCount }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${width(i)}" customWidth="1"/>`).join('');

  // Excel's header/footer codes treat "&" as a command, so a literal one is written "&&".
  const footerText = (spec.footer || '').replace(/&/g, '&&');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${lastCol}${Math.max(1, rows.length)}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rowXml}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.7" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>${xml(`&L&8${footerText}&R&8Page &P of &N`)}</oddFooter></headerFooter>
</worksheet>`;
}

// ── The package ─────────────────────────────────────────────────────────────────────────────

/** An Excel sheet name: at most 31 characters, none of []:*?/\ */
const sheetName = (name) => String(name || 'Report').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Report';

function packageParts(spec) {
  const name = sheetName(spec.sheetName || spec.title);
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(spec.title)}</dc:title>
<dc:creator>${xml(spec.clinic)}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
</cp:coreProperties>`],
    ['docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Enlogada Clinic Management System</Application></Properties>`],
    // No fullCalcOnLoad: each total's value is written beside its formula, so Excel has nothing to
    // recalculate, and a recalculation on open makes it ask to save a file nobody changed.
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>
<calcPr calcId="191029"/>
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', STYLES_XML],
    ['xl/worksheets/sheet1.xml', sheetXml(spec)],
  ];
}

// ── Zip ─────────────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32, as zip requires. zlib.crc32 where this Node has it, the table otherwise. */
const crc32 = (buffer) => {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer) >>> 0;
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A zip archive of [name, string] parts, each deflated. */
function zip(parts) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  // 1980-01-01 00:00, the zip epoch: the timestamp carries nothing a reader needs.
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1;

  for (const [name, content] of parts) {
    const data = Buffer.from(content, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * @param {object} spec
 * @param {string} spec.clinic      the clinic's name, first line of the sheet
 * @param {string} spec.title       the report's title
 * @param {string} [spec.sheetName] the tab name (defaults to the title)
 * @param {Array<[string,string]>} [spec.meta]  label/value lines under the title
 * @param {Array<object>} spec.blocks  see `layout`
 * @param {string} [spec.footer]    the printed page footer, left side
 * @returns {Buffer} the .xlsx file
 */
function buildXlsx(spec) {
  return zip(packageParts(spec));
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

module.exports = { buildXlsx, XLSX_MIME, colName, dateSerial, crc32, sheetName };
