import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import api from '../config/api';
import { canRenderPdfInline, previewKindFor } from '../lib/preview';

/**
 * A patient's uploaded file, shown where staff need it. [1.106.0] The HMO card and the doctor's
 * signed request on Admin's claim review, and the doctor's request on the Desk's booking card.
 * Lifted out of ServiceRequests when the second file arrived.
 *
 * Fetched as a blob rather than pointed at with an <img src>, because the route requires a bearer
 * token that a plain browser image request cannot send — the same reason ClientDashboard
 * downloads results this way.
 *
 * The kind is read off the blob rather than assumed, because either file may be a PDF: reception
 * scans arrive that way and the upload allowlist accepts them. Rendering one in an <img> gives
 * Admin a broken-image icon and no way to tell that apart from a claim filed without evidence —
 * on the screen where they are about to approve coverage.
 *
 * @param {string}  url         the authorised route, relative to the API
 * @param {boolean} hasFile     the record says a file is on record
 * @param {string}  [title]     the heading over it
 * @param {string}  noun        "card image", "doctor's request" — used in the messages
 * @param {string}  imageAlt
 * @param {string}  frameTitle  the PDF frame's accessible name
 * @param {string}  missing     what to say when there is no file
 */
export default function AttachedFile({ url, hasFile, title, noun, imageAlt, frameTitle, missing }) {
  const [file, setFile] = useState({ url: '', kind: null });
  const [error, setError] = useState('');

  useEffect(() => {
    let revoked = false;
    let objectUrl = '';
    setFile({ url: '', kind: null });
    setError('');

    if (!url || !hasFile) return undefined;

    (async () => {
      try {
        const res = await api.get(url, { responseType: 'blob' });
        if (revoked) return;
        objectUrl = URL.createObjectURL(res.data);
        setFile({ url: objectUrl, kind: previewKindFor(res.data?.type) });
      } catch (err) {
        if (!revoked) setError(err.response?.status === 410
          ? `This ${noun} was removed under the retention policy.`
          : `The ${noun} could not be loaded.`);
      }
    })();

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, hasFile, noun]);

  return (
    <div className="space-y-1.5">
      {title && <span className="text-fine font-medium text-slate-500">{title}</span>}

      {file.url && file.kind === 'image' && (
        <a href={file.url} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={file.url}
            alt={imageAlt}
            className="max-h-56 w-full rounded-xl border border-line bg-sunken object-contain"
          />
          <span className="text-micro font-semibold text-brand-700">Open full size</span>
        </a>
      )}

      {file.url && file.kind === 'pdf' && (
        canRenderPdfInline() ? (
          <>
            <iframe
              title={frameTitle}
              src={file.url}
              className="h-56 w-full rounded-xl border border-line bg-surface"
            />
            <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-micro font-semibold text-brand-700">
              Open full size
            </a>
          </>
        ) : (
          <p className="m-0 text-fine text-slate-600">
            The {noun} is a PDF and this browser has no viewer for it.{' '}
            <a href={file.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700">
              Open it in a new tab
            </a>{' '}
            to review the claim.
          </p>
        )
      )}

      {file.url && !file.kind && (
        <p className="m-0 text-fine text-slate-600">
          The attached file is not a format this page can display.{' '}
          <a href={file.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700">
            Open it in a new tab
          </a>.
        </p>
      )}

      {error && (
        <div role="alert" className="alert alert-warning">
          <AlertCircle />
          <span>{error}</span>
        </div>
      )}

      {!hasFile && !error && (
        <p className="m-0 text-fine text-slate-600">{missing}</p>
      )}
    </div>
  );
}
