import React from 'react';

import { useClinic } from '../lib/clinic';
import { formatDateTime } from '../lib/date';

/**
 * The clinical result document — one rendering, for every screen that prints one. [1.50.0]
 *
 * Three existed before this. The technician's just-released certificate
 * (ResultEntryDialog), the staff read-back (ResultViewerDialog) and the patient's own copy
 * (portal/ResultsTab) each built their own, and they had drifted into three different documents:
 * two hardcoded the clinic's name as a string literal, the third printed no letterhead at all,
 * and only the patient's copy showed the referring physician. That is the same problem
 * `Receipt.jsx` was extracted to solve, in the one document a patient is most likely to file.
 *
 * It matters more now than it did: the clinic's copy and the patient's copy are the SAME
 * document — the requirement is that staff record findings once and the saved result is what
 * gets printed for the patient. Two renderings cannot satisfy that; they can only agree by
 * coincidence until someone edits one of them.
 *
 * ── The letterhead comes from lib/clinic.js, never from a literal ─────────────────────────────
 * `useClinic()` reads what `GET /api/clinic` returned, so changing the clinic's address is a
 * `backend/.env` edit rather than a rebuild. The two literals this replaced were already drifting
 * from the address the footer and the receipt print.
 *
 * ── What is deliberately NOT printed ──────────────────────────────────────────────────────────
 * No PRC licence number for the examiner. The clinic's own 1,113 ultrasound reports carry the
 * credential line and no licence number anywhere in the corpus, so there is no true value to
 * print — and inventing one on a document a patient may file for reimbursement is the same false
 * record `lib/clinic.js` refuses to create with a made-up TIN. The referring physician's PRC is a
 * different person's number, is captured per visit, and IS printed where present.
 */

/** One measurement, as the clinic writes it: `7.09 x 2.21 x 1.67 cm`, or `15.81 cm`. */
function formatMeasurement(m) {
  if (m.value_text) return m.value_text;
  if (m.value_date) return m.value_date;
  const axes = [m.value_1, m.value_2, m.value_3].filter((v) => v !== null && v !== undefined && v !== '');
  if (!axes.length) return '—';
  const joined = axes.map((v) => Number(v)).join(' x ');
  return m.unit ? `${joined} ${m.unit}` : joined;
}

export default function ResultReport({
  result,
  patientName,
  measurements = [],
  variant = 'clinic',
  children,
}) {
  const CLINIC = useClinic();
  if (!result) return null;

  const name = patientName || [result.first_name, result.last_name].filter(Boolean).join(' ');
  const releasedBy = result.released_by_first_name
    ? `${result.released_by_first_name} ${result.released_by_last_name || ''}`.trim()
    : null;

  // The credential line is printed only for Ultrasound, because that is the only modality whose
  // real reports state one. Laboratory's own forms name a Medical Technologist AND a Pathologist
  // with licence numbers, which this component has no source for; printing a guess would be worse
  // than printing nothing.
  const credential = result.category_name === 'Ultrasound' ? 'RADIOLOGIST/SONOLOGIST' : null;

  return (
    <div className="print-area print-active space-y-4 bg-white p-1">
      {/* Letterhead */}
      <div className="space-y-0.5 border-b border-line pb-3 text-center">
        <h2 className="m-0 text-base font-extrabold uppercase tracking-wide text-slate-900">{CLINIC.name}</h2>
        <p className="m-0 text-fine text-slate-500">{CLINIC.address}</p>
        {CLINIC.phone && <p className="m-0 text-fine text-slate-500">{CLINIC.phone}</p>}
        <p className="m-0 pt-1 text-note font-bold uppercase tracking-wider text-slate-700">
          {result.category_name === 'Ultrasound' ? 'Ultrasound Report' : 'Diagnostic Examination Report'}
        </p>
        {variant === 'patient' && (
          <span className="block text-meta font-bold text-brand-600">Confidential Medical Document</span>
        )}
      </div>

      {/* Who and what. Mirrors the header block on the clinic's own form. */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-slate-50 p-3.5 text-xs sm:grid-cols-3">
        <div>
          <span className="block text-meta font-bold uppercase text-slate-400">Patient</span>
          <span className="font-bold text-slate-900">{name || '—'}</span>
        </div>
        <div>
          <span className="block text-meta font-bold uppercase text-slate-400">Examination</span>
          <span className="font-bold text-slate-900">{result.test_name || '—'}</span>
        </div>
        {result.category_name && (
          <div>
            <span className="block text-meta font-bold uppercase text-slate-400">Category</span>
            <span className="font-bold text-slate-900">{result.category_name}</span>
          </div>
        )}
        {/* Only when there is one. A "Referred by: —" line on a self-pay walk-in's report is
            noise: nobody referred them, and an empty field invites the reader to wonder what is
            missing. */}
        {result.referring_physician && (
          <div>
            <span className="block text-meta font-bold uppercase text-slate-400">Referred By</span>
            <span className="font-bold text-slate-900">{result.referring_physician}</span>
            {result.referring_physician_prc && (
              <span className="block text-meta text-slate-500">PRC {result.referring_physician_prc}</span>
            )}
          </div>
        )}
      </div>

      {/* Measurements. Absent for a modality that records none, which is every test with no
          field set — the block does not render rather than printing an empty heading. */}
      {measurements.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="m-0 text-xs font-bold uppercase tracking-wider text-slate-900">Measurements</h4>
          <table className="w-full text-xs">
            <tbody>
              {measurements.map((m) => (
                <tr key={`${m.field_code}-${m.group_index || 1}`} className="border-b border-line last:border-0">
                  <td className="py-1 pr-3 align-top text-slate-600">
                    {m.group_label ? `${m.group_label} — ${m.label}` : m.label}
                  </td>
                  <td className="py-1 pr-3 text-right font-bold tabular-nums text-slate-900">
                    {formatMeasurement(m)}
                  </td>
                  <td className="py-1 text-right text-meta text-slate-400">{m.reference_note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The narrative. Still the whole of `findings` — the measurement block above is the only
          thing that left that column, and nothing regenerates prose from the numbers. */}
      <div className="space-y-1">
        <h4 className="m-0 text-xs font-bold uppercase tracking-wider text-slate-900">Findings &amp; Impression</h4>
        <div className="whitespace-pre-wrap rounded-xl border border-line bg-white p-3 text-xs leading-relaxed text-slate-800">
          {result.findings || 'No specific clinical findings recorded.'}
        </div>
      </div>

      {(result.remarks || result.result_remarks) && (
        <div className="border-l-4 border-brand-500 py-1 pl-3">
          <h4 className="m-0 text-fine font-bold uppercase text-slate-500">Remarks</h4>
          <p className="m-0 text-xs text-slate-700">{result.remarks || result.result_remarks}</p>
        </div>
      )}

      {/* The attachment row, supplied by the caller: each screen offers a different action on it
          (staff preview vs patient view), and only the caller knows which. */}
      {children}

      {/* Signatory. `break-inside: avoid` in the print block keeps this off its own orphan page. */}
      <div className="flex items-end justify-between gap-4 pt-6" data-signatory>
        <p className="m-0 text-fine text-slate-400">
          {result.released_at ? `Released ${formatDateTime(result.released_at)}` : 'Not yet released'}
        </p>
        <div className="min-w-[12rem] text-center">
          <p className="m-0 border-t border-slate-400 pt-1 text-xs font-bold text-slate-900">{releasedBy || ' '}</p>
          {credential && (
            <p className="m-0 text-meta uppercase tracking-wider text-slate-500">{credential}</p>
          )}
        </div>
      </div>
    </div>
  );
}
