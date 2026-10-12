/**
 * The file types a diagnostic report may be. [1.96.0]
 *
 * The clinic's reports come out of more than one program: the laboratory analysers export
 * spreadsheets, the radiologist types into a word processor, and the rest are scanned to PDF or
 * photographed. Since [1.94.0] the attached file IS the result, so refusing a .docx or .xlsx meant
 * a technician converting a report the clinic had already produced, which is the double work that
 * release removed.
 *
 * ── Why both the extension and the contents decide ──────────────────────────────────────────
 *
 * Until now the declared mime type alone decided, and for PDF, JPEG and PNG that was good enough
 * because browsers report them consistently. Office files are not like that:
 *
 *   - A .csv arrives as `text/csv`, `text/plain`, or `application/vnd.ms-excel` depending on
 *     whether Excel is installed on the technician's PC, so the label does not say what the file is.
 *   - On a machine without Office, Chrome may send a .docx or .xlsx with no type at all, which
 *     reaches multer as `application/octet-stream`.
 *
 * So for those types the extension (checked against this allowlist, never used raw) says which
 * kind is intended, the label has to be one that kind is known to arrive with, and the first bytes
 * of the saved file have to match the format. The label is the weakest of the three, and the
 * contents check is what stops an executable renamed to report.docx.
 *
 * The stored mime type is the canonical one below, never the browser's label, so the patient's
 * download is served as what the file actually is.
 *
 * ── Deliberately not accepted ───────────────────────────────────────────────────────────────
 *
 * Macro-enabled Office files (.docm, .xlsm). A report has no business running code on the
 * patient's machine, and these are a common carrier for it.
 */

// The label a browser sends when it does not know the type. Accepted only together with an
// allowlisted extension AND matching contents.
const UNKNOWN_LABELS = new Set(['application/octet-stream', '']);

const ZIP = (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const OLE = (b) => b.length >= 8 && b.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
const has = (b, text) => b.includes(Buffer.from(text, 'latin1'));

/**
 * Plain text: no NUL bytes in the sample. Excludes every binary format above, including a ZIP or
 * an executable renamed to .csv, while accepting UTF-8, UTF-16 BOM-less ASCII and Latin-1 exports.
 */
const TEXT = (b) => b.length > 0 && !b.subarray(0, 8192).includes(0x00);

const REPORT_FILE_TYPES = [
  { key: 'pdf', label: 'PDF', exts: ['.pdf'], mime: 'application/pdf', labels: ['application/pdf'],
    inline: true, byMimeAlone: true,
    matches: (b) => b.subarray(0, 1024).includes(Buffer.from('%PDF-')) },
  { key: 'jpeg', label: 'JPEG', exts: ['.jpg', '.jpeg'], mime: 'image/jpeg', labels: ['image/jpeg'],
    inline: true, byMimeAlone: true,
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { key: 'png', label: 'PNG', exts: ['.png'], mime: 'image/png', labels: ['image/png'],
    inline: true, byMimeAlone: true,
    matches: (b) => b.length >= 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },

  { key: 'docx', label: 'Word (DOCX)', exts: ['.docx'],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    labels: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    matches: (b) => ZIP(b) && has(b, '[Content_Types].xml') && has(b, 'word/') },
  { key: 'doc', label: 'Word 97-2003 (DOC)', exts: ['.doc'], mime: 'application/msword',
    labels: ['application/msword'], matches: OLE },
  { key: 'odt', label: 'OpenDocument Text (ODT)', exts: ['.odt'], mime: 'application/vnd.oasis.opendocument.text',
    labels: ['application/vnd.oasis.opendocument.text'],
    matches: (b) => ZIP(b) && has(b, 'application/vnd.oasis.opendocument.text') },
  { key: 'rtf', label: 'Rich Text (RTF)', exts: ['.rtf'], mime: 'application/rtf',
    labels: ['application/rtf', 'text/rtf', 'application/msword', 'text/plain'],
    matches: (b) => b.subarray(0, 5).toString('latin1') === '{\\rtf' },

  { key: 'xlsx', label: 'Excel (XLSX)', exts: ['.xlsx'],
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    labels: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    matches: (b) => ZIP(b) && has(b, '[Content_Types].xml') && has(b, 'xl/') },
  { key: 'xls', label: 'Excel 97-2003 (XLS)', exts: ['.xls'], mime: 'application/vnd.ms-excel',
    labels: ['application/vnd.ms-excel'], matches: OLE },
  { key: 'ods', label: 'OpenDocument Spreadsheet (ODS)', exts: ['.ods'],
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    labels: ['application/vnd.oasis.opendocument.spreadsheet'],
    matches: (b) => ZIP(b) && has(b, 'application/vnd.oasis.opendocument.spreadsheet') },
  { key: 'csv', label: 'CSV', exts: ['.csv'], mime: 'text/csv',
    labels: ['text/csv', 'text/plain', 'application/csv', 'text/x-csv', 'application/vnd.ms-excel', 'text/comma-separated-values'],
    matches: TEXT },
];

const MESSAGE = 'Unsupported file type. Attach a PDF, JPEG or PNG, a Word document (DOCX, DOC, ODT, RTF), '
  + 'or a spreadsheet (XLSX, XLS, ODS, CSV).';

const extOf = (name = '') => {
  const m = /\.[a-z0-9]+$/i.exec(String(name).trim());
  return m ? m[0].toLowerCase() : '';
};

/**
 * Which report type an upload claims to be, from its filename and declared label, or null.
 *
 * An allowlisted extension wins when the label is one that type arrives with (or is unknown).
 * PDF, JPEG and PNG are also accepted on their label alone, as they always were, so a scan saved
 * without an extension still goes through. Nothing else is accepted on its label alone.
 */
function resolveReportType(originalName, declaredMime) {
  const ext = extOf(originalName);
  const label = String(declaredMime || '').split(';')[0].trim().toLowerCase();
  const byExt = REPORT_FILE_TYPES.find((t) => t.exts.includes(ext));
  if (byExt && (byExt.labels.includes(label) || UNKNOWN_LABELS.has(label))) return byExt;
  return REPORT_FILE_TYPES.find((t) => t.byMimeAlone && t.labels.includes(label)) || null;
}

/** Whether the saved bytes are really the format the upload claimed. */
function contentMatches(type, buffer) {
  try {
    return Boolean(type && buffer && type.matches(buffer));
  } catch {
    return false;
  }
}

/** Serve inline (the browser can show it) or as a download (it needs Word, Excel and so on). */
const servesInline = (mime) => REPORT_FILE_TYPES.some((t) => t.inline && t.mime === String(mime || '').toLowerCase());

module.exports = { REPORT_FILE_TYPES, resolveReportType, contentMatches, servesInline, MESSAGE, extOf };
