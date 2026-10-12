/**
 * Which files a diagnostic report may be. [1.96.0]
 *
 * Mirrors backend/src/constants/reportFileTypes.js so an unsupported file is refused the moment it
 * is picked rather than after the upload. The server still has the final word: it also checks the
 * file's contents, which a browser cannot do cheaply, so a renamed file that passes here is still
 * refused there with its own message.
 *
 * Decided by extension as well as by `File.type`, because the type is unreliable for office files:
 * Windows reports a .csv as `application/vnd.ms-excel` when Excel is installed, and a PC without
 * Office may report a .docx or .xlsx with an empty type.
 */

const TYPES = [
  { exts: ['.pdf'], labels: ['application/pdf'], byTypeAlone: true },
  { exts: ['.jpg', '.jpeg'], labels: ['image/jpeg'], byTypeAlone: true },
  { exts: ['.png'], labels: ['image/png'], byTypeAlone: true },
  { exts: ['.docx'], labels: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  { exts: ['.doc'], labels: ['application/msword'] },
  { exts: ['.odt'], labels: ['application/vnd.oasis.opendocument.text'] },
  { exts: ['.rtf'], labels: ['application/rtf', 'text/rtf', 'application/msword', 'text/plain'] },
  { exts: ['.xlsx'], labels: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  { exts: ['.xls'], labels: ['application/vnd.ms-excel'] },
  { exts: ['.ods'], labels: ['application/vnd.oasis.opendocument.spreadsheet'] },
  {
    exts: ['.csv'],
    labels: ['text/csv', 'text/plain', 'application/csv', 'text/x-csv', 'application/vnd.ms-excel', 'text/comma-separated-values'],
  },
];

const UNKNOWN = new Set(['', 'application/octet-stream']);

export const REPORT_FILE_MAX_BYTES = 15 * 1024 * 1024;

/** For the file input's `accept`: extensions first, since the picker matches them reliably. */
export const REPORT_FILE_ACCEPT = [
  ...TYPES.flatMap((t) => t.exts),
  'application/pdf', 'image/jpeg', 'image/png',
].join(',');

export const REPORT_FILE_HINT = 'PDF, JPEG, PNG, Word (DOCX, DOC, ODT, RTF) or spreadsheet (XLSX, XLS, ODS, CSV)';

export const REPORT_FILE_TYPE_ERROR =
  'Unsupported file type. Attach a PDF, JPEG or PNG, a Word document (DOCX, DOC, ODT, RTF), or a spreadsheet (XLSX, XLS, ODS, CSV).';

const extOf = (name = '') => {
  const m = /\.[a-z0-9]+$/i.exec(String(name).trim());
  return m ? m[0].toLowerCase() : '';
};

/** Whether a picked File is one of the accepted report types, judged by its name and type. */
export const isAllowedReportFile = (file) => {
  if (!file) return false;
  const ext = extOf(file.name);
  const label = String(file.type || '').split(';')[0].trim().toLowerCase();
  const byExt = TYPES.find((t) => t.exts.includes(ext));
  if (byExt && (byExt.labels.includes(label) || UNKNOWN.has(label))) return true;
  return TYPES.some((t) => t.byTypeAlone && t.labels.includes(label));
};
