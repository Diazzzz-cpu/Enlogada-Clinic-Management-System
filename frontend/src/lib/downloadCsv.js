import api from '../config/api';

/**
 * Fetch a report as CSV and hand it to the browser as a download. [1.62.0]
 *
 * ── Why not just point an <a href> at the endpoint ──────────────────────────────────────────
 *
 * Because the API is bearer-authenticated. A plain link is a top-level navigation carrying no
 * Authorization header, so it would 401 — and it would 401 by navigating AWAY from the console
 * to a JSON error page, losing whatever the user was doing. Every request in this app goes
 * through the configured Axios instance for exactly that reason, and a download is not an
 * exception to it.
 *
 * So: fetch as a blob with the interceptor's token attached, then synthesise the click locally.
 * `config/api.js` already skips its revalidation cache for `responseType: 'blob'`, so an export
 * is never answered from memory and never leaves a file of patient figures sitting in the
 * validator map for the life of the tab.
 *
 * ── The filename comes from the server ───────────────────────────────────────────────────────
 *
 * `Content-Disposition` is parsed rather than the name being rebuilt here, so the clinic's files
 * are named consistently whether they were produced by this button or by a scheduled call, and
 * so the date in the name is the SERVER's idea of the range. A local fallback exists for the case
 * where the header is unreadable — which, before `exposedHeaders` was widened in app.js, was
 * every case.
 */

/**
 * Pulls the filename out of a Content-Disposition header.
 *
 * Handles the RFC 5987 `filename*=UTF-8''…` form first, because that is the one that carries a
 * non-ASCII name correctly, then the plain quoted form. Anything unrecognised returns null and
 * the caller falls back — never a partial parse, which would produce a file called `attachment`.
 */
function filenameFromDisposition(disposition) {
  if (!disposition) return null;

  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // A malformed percent-escape is not worth failing the download over.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : null;
}

/**
 * Triggers the browser's save dialog for a blob.
 *
 * The anchor is appended to the document before clicking: a detached node's click is ignored by
 * Firefox, which is the browser this app already documents as behaving differently around
 * downloads. The object URL is revoked in a `finally` — an un-revoked one pins the whole blob in
 * memory for the life of the document, and a month of exports adds up.
 */
function saveBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Deferred: revoking synchronously can cancel the download in flight in some browsers, since
    // the click only queues the fetch of the object URL.
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }
}

/**
 * A server error arrives as a BLOB, not as JSON.
 *
 * `responseType: 'blob'` applies to the error response too, so `err.response.data` is a Blob
 * containing `{"status":"error","message":"…"}` and the usual `data.message` read yields
 * `undefined` — the user would be told "Export failed" with no reason, on a 403 that has a
 * perfectly good one. Read the blob back as text and parse it.
 */
async function messageFromBlobError(err) {
  const data = err?.response?.data;
  if (!data) return err?.message || 'Export failed.';
  if (typeof data === 'string') return data;
  if (typeof data.text === 'function') {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.message || 'Export failed.';
    } catch {
      return 'Export failed.';
    }
  }
  return data.message || err?.message || 'Export failed.';
}

/**
 * Downloads `path` as CSV.
 *
 * @param {string} path      report endpoint, e.g. '/reports/summary'
 * @param {object} params    query parameters — `format: 'csv'` is added here so no caller forgets
 * @param {string} fallback  filename to use if the server's is unreadable
 * @returns {Promise<string>} the filename actually saved, for the caller's confirmation message
 */
export async function downloadCsv(path, params, fallback = 'report.csv') {
  try {
    const response = await api.get(path, {
      params: { ...params, format: 'csv' },
      responseType: 'blob',
    });

    const name = filenameFromDisposition(response.headers?.['content-disposition']) || fallback;
    // The server already prepends a BOM to the body; declaring the type here only tells the OS
    // what the file is. Re-adding a BOM would put two in the file and Excel shows the second as
    // a stray character in the first cell.
    saveBlob(new Blob([response.data], { type: 'text/csv;charset=utf-8' }), name);
    return name;
  } catch (err) {
    const error = new Error(await messageFromBlobError(err));
    error.status = err?.response?.status;
    throw error;
  }
}

export default downloadCsv;
