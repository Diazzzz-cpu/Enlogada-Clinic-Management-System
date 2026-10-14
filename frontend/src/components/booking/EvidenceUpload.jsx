import React from 'react';

/**
 * An upload in the booking wizard: the HMO card, or the doctor's signed request. [1.106.0]
 * Driven by `useEvidenceFile`. The card is always required; the doctor's request only on an HMO
 * booking or a Private patient's, and optional for self-pay [1.107.0] — hence `required`, which is
 * presentation only. referralService on the server decides.
 *
 * The preview is shown large enough to actually read. No API detects blur, glare, a thumb over
 * the number or the wrong side of the card — asking the patient to confirm they can read it is
 * the only check that does.
 *
 * @param {string} id          the input's id, so the label names it
 * @param {string} label
 * @param {string} hint        what to photograph, said before they choose
 * @param {string} previewAlt  the preview image's alt text
 * @param {string} readCheck   the question asked under the preview
 * @param {string} pdfCheck    what to check when the file is a PDF, which cannot be previewed
 * @param {object} evidence    the hook's return value
 * @param {boolean} [required=true]  an asterisk when true, "(optional)" when false
 * @param {boolean} disabled
 */
export default function EvidenceUpload({ id, label, hint, previewAlt, readCheck, pdfCheck, evidence, required = true, disabled }) {
  const { file, preview, error, preparing, pick } = evidence;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="field-label">
        {label}{' '}
        {required
          ? <span className="text-rose-600">*</span>
          : <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>}
      </label>
      <p className="m-0 text-fine text-slate-500">{hint}</p>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={pick}
        disabled={preparing || disabled}
        className="block w-full text-fine text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-fine file:font-semibold file:text-white hover:file:bg-brand-700"
      />

      {preparing && (
        <p className="m-0 text-fine text-slate-500" aria-live="polite">Preparing your photo…</p>
      )}

      {error && (
        <div role="alert" className="alert alert-error">
          {error}
        </div>
      )}

      {file && !error && file.type === 'application/pdf' && (
        <p className="m-0 text-fine text-slate-600">
          Attached: {file.name}. {pdfCheck}
        </p>
      )}

      {preview && !error && file?.type !== 'application/pdf' && (
        <div className="space-y-1.5">
          <img
            src={preview}
            alt={previewAlt}
            className="max-h-64 w-full rounded-xl border border-line bg-sunken object-contain"
          />
          <p className="m-0 text-fine text-slate-600">{readCheck}</p>
        </div>
      )}
    </div>
  );
}
