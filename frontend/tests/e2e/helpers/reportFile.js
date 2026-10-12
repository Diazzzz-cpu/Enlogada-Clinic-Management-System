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
 * A real PDF header, because the allowlist checks the declared mime type and a reviewer reading
 * a failure should see something that is obviously meant to be a report.
 */

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
    buffer: Buffer.from(`%PDF-1.4 E2E ${label}`),
  };
}

export default reportPart;
