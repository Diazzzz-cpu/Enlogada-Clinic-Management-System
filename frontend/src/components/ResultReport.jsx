import React from 'react';

import { useClinic } from '../lib/clinic';
import { formatDateTime, formatDate } from '../lib/date';

/**
 * The clinical result document — one rendering, for every screen that prints one. [1.50.0]
 *
 * Three existed before this: the technician's just-released certificate, the staff read-back and
 * the patient's own copy. They had drifted into three different documents — two hardcoded the
 * clinic's name, the read-back printed no letterhead at all, and only the patient's copy showed
 * the referring physician. The clinic's copy and the patient's copy are the SAME document by
 * requirement — staff record findings once and the saved result is what gets printed — and two
 * renderings can only agree by coincidence.
 *
 * ── It reproduces the clinic's own form, not a generic report ────────────────────────────────
 *
 * [1.52.0] The clinic issues a four-column sheet: `TEST | RESULT | UNIT | REFERENCE RANGE`, with
 * section headings (`Macroscopic:`, `Chemical:`, `Microscopic:`) grouping the analytes beneath a
 * discipline heading, then a COMMENT block, a disclaimer, and a two-signatory footer carrying PRC
 * licence numbers. That is the document a patient files and a referring physician reads, so the
 * system prints it rather than an approximation of it.
 *
 * Ultrasound is a genuinely different document — a Measurements block, narrative prose, an ALL-CAPS
 * impression, one radiologist and no licence number — so the same component renders both shapes
 * from the data rather than branching on the category name in more than one place.
 *
 * ── What is deliberately NOT printed ──────────────────────────────────────────────────────────
 *
 * A PRC licence number that was not supplied. The laboratory forms carry one for both signatories
 * and those are seeded from the clinic's own workbook; the radiologist has none anywhere in 1,113
 * archived reports, so that slot prints nothing rather than a plausible-looking number. Same rule
 * `lib/clinic.js` applies to the TIN: a made-up number on a document a patient files for
 * reimbursement is a false record.
 */

/** One measurement, as the clinic writes it: `7.09 x 2.21 x 1.67 cm`, or `15.81`. */
function formatValue(m) {
  if (m.value_text) return m.value_text;
  if (m.value_date) return m.value_date;
  const axes = [m.value_1, m.value_2, m.value_3].filter((v) => v !== null && v !== undefined && v !== '');
  if (!axes.length) return '';
  return axes.map((v) => Number(v)).join(' x ');
}

/** The header block, identical on every form the clinic issues. */
function Letterhead({ clinic, title }) {
  return (
    <div className="space-y-0.5 border-b-2 border-slate-800 pb-2 text-center">
      <h2 className="m-0 text-base font-extrabold uppercase tracking-[0.2em] text-slate-900">{clinic.name}</h2>
      {clinic.services && (
        <p className="m-0 text-meta font-semibold uppercase tracking-widest text-slate-600">{clinic.services}</p>
      )}
      <p className="m-0 text-meta text-slate-500">{clinic.address}</p>
      {clinic.phone && <p className="m-0 text-meta text-slate-500">{clinic.phone}</p>}
      {title && (
        <p className="m-0 pt-1 text-note font-bold uppercase tracking-wider text-slate-800">{title}</p>
      )}
    </div>
  );
}

/** Name / Birthday / Sex on the left, Date / Patient Type / Physician on the right. */
function PatientBlock({ result, name }) {
  const Row = ({ label, value }) => (
    <div className="flex gap-1.5">
      <span className="font-bold text-slate-700">{label}</span>
      <span className="min-w-0 flex-1 truncate text-slate-900">{value || ''}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 border-b border-slate-400 py-2 text-fine">
      <Row label="Name:" value={name} />
      <Row label="Date:" value={result.released_at ? formatDate(result.released_at) : formatDate(result.visit_date)} />
      <Row label="Birthday:" value={result.birthdate ? formatDate(result.birthdate) : ''} />
      <Row label="Patient Type:" value={result.patient_type_name} />
      <Row label="Sex:" value={result.sex} />
      <Row label="Physician:" value={result.referring_physician} />
    </div>
  );
}

/**
 * The four-column analyte table, with section headings printed once above the fields they group.
 *
 * The heading is emitted by comparing against the PREVIOUS row rather than tracking state, which
 * means a field with no section simply closes the group. That matters on the clinic's CBC, where
 * `RDW-CV` prints after the `Differential Count` block and does not belong to it — a rule that
 * carried a section forward until the next one would file it wrongly on every CBC they issue.
 */
function AnalyteTable({ measurements, showReference }) {
  return (
    <table className="w-full text-fine">
      <thead>
        <tr className="border-b border-slate-400 text-meta uppercase tracking-[0.15em] text-slate-700">
          <th className="py-1 text-left font-bold">Test</th>
          <th className="py-1 text-left font-bold">Result</th>
          <th className="py-1 text-left font-bold">Unit</th>
          {showReference && <th className="py-1 text-left font-bold">Reference Range</th>}
        </tr>
      </thead>
      <tbody>
        {measurements.map((m, i) => {
          const startsSection = m.section && m.section !== measurements[i - 1]?.section;
          return (
            <React.Fragment key={`${m.field_code}-${m.group_index || 1}`}>
              {startsSection && (
                <tr>
                  <td className="pt-2 pb-0.5 font-bold text-slate-800" colSpan={showReference ? 4 : 3}>
                    {m.section}
                  </td>
                </tr>
              )}
              <tr>
                <td className={`py-0.5 text-slate-800${m.section ? ' pl-4' : ''}`}>
                  {m.group_label ? `${m.group_label} — ${m.label}` : m.label}
                </td>
                <td className="py-0.5 font-bold tabular-nums text-slate-900">{formatValue(m)}</td>
                <td className="py-0.5 text-slate-600">{m.unit || ''}</td>
                {showReference && <td className="py-0.5 text-slate-600">{m.reference_note || ''}</td>}
              </tr>
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/** The two-column footer. A signatory with no licence number prints none. */
function Signatories({ signatories }) {
  if (!signatories?.length) return null;
  return (
    <div className="pt-8" data-signatory>
      <p className="m-0 pb-4 text-fine font-bold text-slate-700">FOR:</p>
      <div className="grid grid-cols-2 gap-6">
        {signatories.map((s) => (
          <div key={`${s.full_name}-${s.role_caption}`} className="text-center">
            <p className="m-0 border-t border-slate-800 pt-1 text-fine font-bold uppercase text-slate-900">
              {s.full_name}
            </p>
            <p className="m-0 text-meta text-slate-700">{s.role_caption}</p>
            {s.prc_license && (
              <p className="m-0 text-meta italic text-slate-600">PRC License No. {s.prc_license}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResultReport({
  result,
  patientName,
  measurements = [],
  signatories = [],
  fieldSet = null,
  variant = 'clinic',
  children,
}) {
  const CLINIC = useClinic();
  if (!result) return null;

  const name = patientName || [result.first_name, result.last_name].filter(Boolean).join(' ');
  // 2D Echo is performed by Ultrasound Staff and reads as an ultrasound study, so it takes the
  // ultrasound SHAPE — a narrative and an impression rather than a COMMENT box. Its tests are
  // deactivated, but 18 historical visit_tests point at the category and their reports must still
  // render as what they were. [1.53.0]
  const isUltrasound = result.category_name === 'Ultrasound' || result.category_name === '2D Echo';
  const sigs = signatories.length ? signatories : result.signatories || [];

  // Fecalysis is the one form in the clinic's workbook with no reference-range column, so the
  // column is dropped for it — but the decision belongs to the FORM, not to what happens to have
  // been recorded. [1.53.0] Deriving it from the values printed a three-column Urinalysis when
  // microscopy was left blank and a four-column one for the next patient, because only 2 of its 14
  // fields carry a range. `fieldSet` is authoritative when the caller has it.
  // `fieldSet` when the caller has it (the entry dialog); otherwise the server's own answer for
  // the same question, which the viewer and the patient's copy DO get — they pass no fieldSet, so
  // before this they fell through to the heuristic above and could disagree with the clinic's copy
  // about how many columns the form has. The heuristic survives only for a test with no form at
  // all, which is why the column is NULL rather than FALSE in that case.
  const showReference = fieldSet
    ? fieldSet.fields.some((f) => f.reference_note)
    : result.field_set_has_reference ?? measurements.some((m) => m.reference_note);

  return (
    <div className="print-area print-active space-y-3 bg-white p-1">
      <Letterhead
        clinic={CLINIC}
        // [1.53.0] `discipline` is NULL for X-ray, for 2D Echo, and for any test outside the 22
        // seeded laboratory sets — so falling back to it alone printed NO title at all beneath the
        // letterhead, under a disclaimer about an official seal.
        title={isUltrasound ? 'Ultrasound Report' : result.discipline || 'Diagnostic Examination Report'}
      />
      <PatientBlock result={result} name={name} />

      {measurements.length > 0 && (
        isUltrasound ? (
          <div className="space-y-1">
            <h4 className="m-0 text-fine font-bold uppercase tracking-wider text-slate-900">Measurements</h4>
            <AnalyteTable measurements={measurements} showReference={showReference} />
          </div>
        ) : (
          <AnalyteTable measurements={measurements} showReference={showReference} />
        )
      )}

      {/* The narrative. Still the whole of `findings` — the analyte table is the only thing that
          left that column, and nothing regenerates prose from the numbers. The clinic's laboratory
          form calls this box COMMENT; their ultrasound report calls it Findings & Impression. */}
      <div className="space-y-1 pt-1">
        <h4 className="m-0 text-fine font-bold uppercase tracking-wider text-slate-900">
          {isUltrasound ? 'Findings & Impression' : 'Comment'}
        </h4>
        <div className="min-h-[2.5rem] whitespace-pre-wrap border-b border-slate-300 pb-2 text-fine leading-relaxed text-slate-800">
          {result.findings || ''}
        </div>
      </div>

      {(result.remarks || result.result_remarks) && (
        <div className="border-l-4 border-brand-500 py-1 pl-3">
          <h4 className="m-0 text-meta font-bold uppercase text-slate-500">Remarks</h4>
          <p className="m-0 text-fine text-slate-700">{result.remarks || result.result_remarks}</p>
        </div>
      )}

      {/* The attachment row, supplied by the caller: each screen offers a different action on it
          (staff preview vs patient view), and only the caller knows which. */}
      {children}

      {/* The clinic prints this on 28 of its 38 forms. It is their claim, not one this system
          invents, and it is why the signature block matters. */}
      <p className="m-0 pt-3 text-center text-meta text-slate-600">
        NOTE: DO NOT ACKNOWLEDGE THE RESULT WITHOUT THE OFFICIAL SEAL
      </p>

      <Signatories signatories={sigs} />

      {variant === 'patient' && (
        <p className="m-0 pt-2 text-center text-meta font-bold text-brand-600">
          Confidential Medical Document
        </p>
      )}

      {/* Who authorised it, and when. [1.53.0] The rewrite dropped this: the seeded signatories
          are the clinic's standing attestation, but they are not a record of who actually released
          THIS report, and the query has carried that all along. A report that cannot say who
          authorised it is weaker than the one it replaced. */}
      {result.released_at && (
        <p className="m-0 text-fine text-slate-400">
          Released {formatDateTime(result.released_at)}
          {result.released_by_first_name
            && ` by ${result.released_by_first_name} ${result.released_by_last_name || ''}`.trimEnd()}
        </p>
      )}
    </div>
  );
}
