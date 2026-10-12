import React from 'react';

/**
 * A required upload in the HMO branch of the booking wizard: the card, or the doctor's signed
 * request. [1.106.0] Driven by `useEvidenceFile`.
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
 * @param {boolean} disabled
 */
export default function EvidenceUpload({ id, label, hint, previewAlt, readCheck, pdfCheck, evidence, disabled }) {
  const { file, preview, error, preparing, pick } = evidence;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="field-label">
        {label} <span className="text-rose-600">*</span>
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
