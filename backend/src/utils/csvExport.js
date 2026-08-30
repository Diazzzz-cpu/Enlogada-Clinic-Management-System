/**
 * CSV serialisation for the report endpoints. [1.62.0]
 *
 * The reports were readable and not extractable: `/reports/summary`, `/reports/operations` and
 * `/reports/hmo-claims` returned JSON to a screen, and the only way to get a figure off that
 * screen was to retype it or print the page. The clinic's own filing, and anyone reconciling a
 * month against the drawer, needs a file.
 *
 * ── Numbers stay NUMBERS ────────────────────────────────────────────────────────────────────
 *
 * The obvious move is to reuse `utils/money.js` and write "₱1,450.00" into the cell, matching
 * what the screen says. Do not. Excel reads that as TEXT — the thousands separator and the
 * currency symbol both disqualify it as a number — so the column cannot be summed, sorted or
 * charted, which is the entire reason somebody exports a CSV rather than printing the page. A
 * cash-up that cannot be totalled in the spreadsheet it was exported to is a screenshot with
 * extra steps.
 *
 * So money is written as a bare `1450.00` and the UNIT moves into the header: `Collected (PHP)`.
 * The reader loses nothing — they are looking at a clinic's peso report — and the column adds up.
 * This is the one place in the codebase that deliberately does not use `formatCurrency`.
 *
 * ── The BOM is not optional ─────────────────────────────────────────────────────────────────
 *
 * Excel on Windows assumes the system codepage for a `.csv`, not UTF-8, unless the file opens
 * with a byte-order mark. Without it every `ñ` in a patient's name and every `₱` in a header
 * renders as mojibake — on the machines this clinic actually uses. `charset=utf-8` in the
 * Content-Type header does not reach Excel; the file is opened from disk, long after the header
 * is gone.
 *
 * ── Dates ───────────────────────────────────────────────────────────────────────────────────
 *
 * Built from LOCAL getters, never `toISOString()`. See the dates note in CLAUDE.md: in Philippine
 * time an ISO date string is yesterday between midnight and 08:00, silently. A file named
 * `summary-2026-08-27.csv` exported on the 28th is the kind of error nobody catches until they
 * are reconciling two months at once.
 */

// RFC 4180 §2.6: a field is quoted if it contains the delimiter, a quote, CR or LF. §2.7: a
// literal quote inside a quoted field is escaped by doubling it.
const NEEDS_QUOTING = /[",\r\n]/;

// RFC 4180 §2.1 specifies CRLF between records. Excel, Numbers and every spreadsheet import
// accept LF too, but CRLF is what the spec says and what Notepad needs to show line breaks.
const RECORD_SEPARATOR = '\r\n';

/**
 * One field, escaped. `null`/`undefined` become an EMPTY cell rather than the strings "null" or
 * "undefined" — a blank means "no value", which is what those actually are, and it sums as zero
 * instead of poisoning the column with text.
 */
function escapeField(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!NEEDS_QUOTING.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** A local YYYY-MM-DD. Local getters throughout — never toISOString(). */
function localDateStr(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A local YYYY-MM-DD HH:MM. Space-separated, not `T` — spreadsheets parse this as a datetime. */
function localDateTimeStr(date) {
  if (date === null || date === undefined || date === '') return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${localDateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Cell formatters ─────────────────────────────────────────────────────────────────────────
// Each takes a raw value and returns the string that goes in the cell. They are exported so a
// controller can describe its columns declaratively rather than pre-mapping every row.

/**
 * A missing number is an EMPTY cell, never a zero.
 *
 * `Number(null)` is 0 and `Number.isFinite(0)` is true, so the obvious implementation writes
 * `0.00` into every NULL — and a nullable money column then states that the clinic collected
 * nothing, rather than that nothing is recorded. Those are different facts and they call for
 * different responses; this is the same false-confidence failure as the dashboard that read
 * "Today's Revenue ₱0.00" over a day that took ₱8,344. A blank cell still sums as zero in a
 * spreadsheet, so nothing downstream is lost by being honest here.
 */
const isBlank = (value) => value === null || value === undefined || value === '';

/** Money: two decimals, no symbol, no separators. Name the unit in the header. */
const money = (value) => {
  if (isBlank(value)) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '';
};

/** A whole number. Postgres COUNT/::int arrive as numbers, but SUM/NUMERIC arrive as strings. */
const integer = (value) => {
  if (isBlank(value)) return '';
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n)) : '';
};

/** A decimal held to `places`, for rates and averages that are not money. */
const decimal = (places = 2) => (value) => {
  if (isBlank(value)) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(places) : '';
};

/** A date column. Accepts a Date, an ISO string, or an already-plain YYYY-MM-DD. */
const date = (value) => {
  if (value === null || value === undefined || value === '') return '';
  // pg returns a DATE column as a native Date; a bare 'YYYY-MM-DD' may also arrive over JSON
  // already in the shape we want, and re-parsing that through Date() would apply a UTC
  // interpretation and shift it. Pass it straight through.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return localDateStr(value);
};

/** A timestamp column. */
const dateTime = (value) => localDateTimeStr(value);

/** Plain text, trimmed. The default when a column names no formatter. */
const text = (value) => (value === null || value === undefined ? '' : String(value).trim());

/**
 * Serialises `rows` into a CSV body using an explicit column list.
 *
 * `columns` is `[{ key, header, format }]`. The explicit list is the point: deriving headers from
 * `Object.keys(rows[0])` would leak snake_case column names into a document the clinic files, and
 * would silently change shape the day a query gains a column — an export whose columns move on
 * their own cannot be reconciled against last month's.
 */
function toCsv(rows, columns) {
  const lines = [columns.map((c) => escapeField(c.header)).join(',')];
  for (const row of rows || []) {
    lines.push(
      columns
        .map((c) => escapeField((c.format || text)(row ? row[c.key] : undefined)))
        .join(',')
    );
  }
  return lines.join(RECORD_SEPARATOR);
}

/**
 * Several tables in one file, separated by a titled blank-line break.
 *
 * `/reports/summary` is four datasets and `/reports/operations` is up to six; one endpoint has to
 * produce one file. RFC 4180 has nothing to say about sections — it describes a single table — so
 * this is a convention rather than a standard, chosen because it is the one every spreadsheet
 * opens without complaint and a person reads without instructions.
 *
 * A section with no rows still prints its title and headers followed by a "No records" marker.
 * Omitting an empty section would leave the reader unable to distinguish "the clinic refused no
 * HMO claims this month" from "this export forgot about refusals" — and those call for opposite
 * responses.
 *
 * A section may also be a `{ title, pairs }` block: a two-column Field/Value table, for the
 * single-row totals that would otherwise be a one-row table with fifteen columns.
 */
function toCsvSections(sections, meta = []) {
  const blocks = [];

  if (meta.length) {
    blocks.push(
      meta.map(([label, value]) => `${escapeField(label)},${escapeField(value)}`).join(RECORD_SEPARATOR)
    );
  }

  for (const section of sections) {
    if (!section) continue;
    const parts = [escapeField(section.title)];

    if (section.pairs) {
      parts.push(['Field', 'Value'].map(escapeField).join(','));
      for (const [label, value] of section.pairs) {
        parts.push(`${escapeField(label)},${escapeField(value)}`);
      }
    } else {
      const rows = section.rows || [];
      parts.push(toCsv(rows, section.columns));
      if (!rows.length) parts.push(escapeField('No records in this period'));
    }

    blocks.push(parts.join(RECORD_SEPARATOR));
  }

  // A trailing CRLF: RFC 4180 §2.2 permits it, and its absence is what makes some tools drop the
  // final record.
  return blocks.join(RECORD_SEPARATOR + RECORD_SEPARATOR) + RECORD_SEPARATOR;
}

/**
 * `<report>-<start>_to_<end>.csv`, or `<report>-<today>.csv` when the report carries no range.
 *
 * Sanitised hard: the value reaches a `Content-Disposition` header and then the user's filesystem.
 * A quote or a newline in it is header injection, and a slash is a path. The date parameters here
 * are already validated as YYYY-MM-DD by the service before any of this runs, so this is defence
 * in depth rather than the only check — which is exactly how it should be for something that
 * writes a header.
 */
function csvFilename(reportName, startDate, endDate) {
  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '');
  const base = safe(reportName) || 'report';
  const from = safe(startDate);
  const to = safe(endDate);
  if (from && to) return `${base}-${from}_to_${to}.csv`;
  return `${base}-${localDateStr()}.csv`;
}

/**
 * Writes the CSV response. One place, so the headers cannot drift between three controllers.
 *
 * `\uFEFF` is the BOM — see the note at the top. It is prepended to the STRING and the response
 * is sent as UTF-8, so the byte sequence Excel looks for (EF BB BF) is what lands on disk.
 */
function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // NOTE: the browser fetches this with XHR and reads the filename off Content-Disposition, which
  // CORS does not expose to JavaScript by default. That is configured ONCE in app.js's
  // `exposedHeaders` rather than with a res.setHeader here — setting the expose header on this
  // response would replace the list rather than add to it, silently dropping ETag.
  //
  // Never revalidate or reuse an export: it is a point-in-time document, and the ETag machinery
  // this app uses for polled JSON has no business holding a file containing patient figures.
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(`\uFEFF${csv}`);
}

/**
 * Whether this request asked for CSV. Case-insensitive, and anything else — including no
 * parameter at all — means JSON, so every existing caller is untouched.
 */
function wantsCsv(req) {
  return String(req.query?.format || '').toLowerCase() === 'csv';
}

module.exports = {
  toCsv,
  toCsvSections,
  csvFilename,
  sendCsv,
  wantsCsv,
  escapeField,
  localDateStr,
  formatters: { money, integer, decimal, date, dateTime, text },
};
