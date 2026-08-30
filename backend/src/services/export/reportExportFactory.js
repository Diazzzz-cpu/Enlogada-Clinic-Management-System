const { wantsCsv, csvFilename, sendCsv } = require('../../utils/csvExport');

/**
 * Chooses how a report leaves the building. [1.63.0]
 *
 * ── What this replaces ──────────────────────────────────────────────────────────────────────
 *
 * `reportController` carried the same five lines five times, once per report:
 *
 *     if (wantsCsv(req)) {
 *       return sendCsv(res, csvFilename('clinic-summary', startDate, endDate),
 *                      reportCsv.summaryCsv(report, startDate, endDate));
 *     }
 *     return res.status(200).json({ status: 'success', data: { report } });
 *
 * Five copies of a decision is five chances for them to drift, and they were already drifting —
 * one used `data: { workload }` where the others used `data: { report }`, which is a real
 * difference a caller depends on and which no reader would spot buried in the fifth copy.
 *
 * ── Factory, not a helper function ──────────────────────────────────────────────────────────
 *
 * The two output formats are genuinely different objects: one negotiates a filename, sets three
 * headers and writes a BOM-prefixed body; the other writes an envelope. They share only the
 * question "can you render this report?". So the factory returns a SERIALIZER with a uniform
 * `send()`, and the controller stops knowing which one it got.
 *
 * That matters for the next format rather than for these two. Adding PDF or XLSX becomes a new
 * serializer registered here, with no edit to any controller — where under the old shape it was a
 * sixth branch in five places.
 *
 * ── The security property is preserved by construction ──────────────────────────────────────
 *
 * The serializer is chosen and invoked AFTER the service has returned. It never sees `req.user`
 * and cannot widen what a caller may read — a CSV export contains exactly the slices the JSON
 * would have contained, which is what makes a Laboratory account's operations export omit Takings
 * rather than zero it. Keeping the format decision downstream of the permission decision is the
 * whole reason this is safe to centralise.
 */

/**
 * @typedef {object} ReportSerializer
 * @property {string} format
 * @property {(res: import('express').Response, report: object, context: SerializerContext) => void} send
 */

/**
 * @typedef {object} SerializerContext
 * @property {string} name        Filename stem, e.g. 'clinic-summary'. Sanitised downstream.
 * @property {string} [startDate] Range start, YYYY-MM-DD.
 * @property {string} [endDate]   Range end, YYYY-MM-DD.
 * @property {string} [key]       Envelope key for JSON. Defaults to 'report'.
 * @property {(report: object, startDate: string, endDate: string) => string} [toCsv]
 *                                Renders this specific report as CSV. Required for the CSV format.
 */

/**
 * The default: the JSON envelope every screen in the app already reads.
 *
 * `key` exists because `/reports/staff-workload` answers with `data: { workload }` rather than
 * `data: { report }`. That asymmetry predates this refactor and is preserved deliberately — the
 * frontend reads it, and 295 specs assert it. It is a parameter here rather than a special case.
 *
 * @type {ReportSerializer}
 */
const jsonSerializer = {
  format: 'json',
  send(res, report, { key = 'report' } = {}) {
    return res.status(200).json({
      status: 'success',
      data: { [key]: report },
    });
  },
};

/**
 * RFC 4180 CSV with a UTF-8 BOM, as an attachment.
 *
 * @type {ReportSerializer}
 */
const csvSerializer = {
  format: 'csv',
  send(res, report, { name, startDate, endDate, toCsv }) {
    if (typeof toCsv !== 'function') {
      // A programmer error, not a caller error: a report was registered for CSV export without
      // supplying the function that renders it. Fail loudly in development rather than sending an
      // empty file that looks like a quiet month.
      throw new Error(`No CSV renderer was provided for the "${name}" report.`);
    }
    return sendCsv(res, csvFilename(name, startDate, endDate), toCsv(report, startDate, endDate));
  },
};

const SERIALIZERS = {
  json: jsonSerializer,
  csv: csvSerializer,
};

/**
 * The serializer for a named format.
 *
 * Anything unrecognised — including no format at all — resolves to JSON. That is the
 * backward-compatibility guarantee: a caller who sends `format=xlsx` by mistake gets the response
 * they have always got, not a 400 and not a download.
 *
 * @param {string} [format]
 * @returns {ReportSerializer}
 */
function createSerializer(format) {
  return SERIALIZERS[String(format || '').toLowerCase()] || jsonSerializer;
}

/**
 * Picks the format from the request and writes the response. The controller's one line.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {object} report   Whatever the service returned. Passed through untouched.
 * @param {SerializerContext} context
 * @returns {void}
 */
function respond(req, res, report, context) {
  const serializer = createSerializer(wantsCsv(req) ? 'csv' : 'json');
  return serializer.send(res, report, context);
}

module.exports = { createSerializer, respond, jsonSerializer, csvSerializer };
