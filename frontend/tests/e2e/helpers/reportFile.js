/**
 * The report document a diagnostic result carries. [1.94.0]
 *
 * Findings stopped being typed: the clinic attaches the report it already produces, and
 * `RESULTS_REQUIRE_FILE` refuses a release without one. Every fixture that records a result and
 * then releases it therefore needs a document, and there are a dozen of them across seven specs.
 *
 * One helper rather than a dozen inline buffers, for the usual reason — when the upload rules
 * change again (the MIME allowlist and the 15MB cap live in `backend/src/config/upload.js`), the
 * fixtures move together instead of one of them quietly becoming the odd one out.
 *
 * A REAL PDF, one page with the label on it. [1.114.0] A patient is served a digital copy, marked
 * on every page, and marking means parsing: the five-word "%PDF-1.4 E2E report" these fixtures used
 * to be is refused for a patient (it cannot be read, so it cannot be marked), exactly as a damaged
 * upload should be.
 */

/**
 * A minimal, valid one-page PDF reading `label`, with a correct cross-reference table.
 *
 * @param {string} [label]
 * @returns {Buffer}
 */
export function pdfReport(label = 'report') {
  // Printable ASCII only, with PDF string delimiters escaped, so any label makes a valid file.
  const text = String(label).replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 18 Tf 72 760 Td (Enlogada E2E - ${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/**
 * A multipart file part for `POST /results/:visitTestId`.
 *
 * @param {string} [label] What this report is, so a leftover file in `uploads/` names itself.
 * @returns {{name: string, mimeType: string, buffer: Buffer}}
 */
export function reportPart(label = 'report') {
  const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
  return {
    name: `e2e-${slug}.pdf`,
    mimeType: 'application/pdf',
    buffer: pdfReport(label),
  };
}

export default reportPart;
