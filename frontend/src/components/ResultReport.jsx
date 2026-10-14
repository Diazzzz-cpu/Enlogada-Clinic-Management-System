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
 * ── What it is now [1.109.0] ───────────────────────────────────────────────────────────────────
 *
 * A result is its attached report file [1.94.0], and the typed forms this used to lay out — the
 * laboratory TEST | RESULT | UNIT | REFERENCE RANGE grid, the ultrasound Measurements block and the
 * two-signatory footer — went with their tables in [1.109.0]. What is left is the clinic's
 * letterhead and the patient's header around the report: the attachment row the caller passes in,
 * and the typed findings of a result recorded before reports were attached, which still has to
 * read as what it was.
 */

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

export default function ResultReport({
  result,
  patientName,
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
  return (
    <div className="print-area print-active space-y-3 bg-white p-1">
      <Letterhead
        clinic={CLINIC}
        title={isUltrasound ? 'Ultrasound Report' : 'Diagnostic Examination Report'}
      />
      <PatientBlock result={result} name={name} />

      {/* Which study this was. [1.67.0] The clinic's reports carry BOTH a generic "ULTRASOUND
          REPORT" heading and a specific "Examination:" line; ours had only the heading, so a
          report never said what the patient actually had done.

          Printed as the catalogue name rather than folded into the title as
          "ULTRASOUND OF THE <name>" — that reads correctly for "Whole Abdomen" and badly for "BPS"
          or "Trans-vaginal (TVS)", and manufacturing English around a catalogue string is how a
          clinical document ends up saying something nobody wrote. */}
      {isUltrasound && result.test_name && (
        <p className="m-0 text-fine text-slate-800">
          <span className="font-bold uppercase tracking-wide">Examination:</span>{' '}
          <span className="font-semibold uppercase">{result.test_name}</span>
        </p>
      )}

      {/* The narrative, for a result typed before reports were attached — and only then: a heading
          over an empty box is a document claiming a comment it does not have. The clinic's
          laboratory form calls this box COMMENT; their ultrasound report calls it Findings &
          Impression. */}
      {result.findings && (
      <div className="space-y-1 pt-1">
        <h4 className="m-0 text-fine font-bold uppercase tracking-wider text-slate-900">
          {/* "Findings" is what the document says. The impression is a labelled paragraph inside
              this prose in the source too, not a separate field — which is also why there is no
              impression column to render. */}
          {isUltrasound ? 'Findings' : 'Comment'}
        </h4>
        <div className="whitespace-pre-wrap border-b border-slate-300 pb-2 text-fine leading-relaxed text-slate-800">
          {result.findings}
        </div>
      </div>
      )}

      {(result.remarks || result.result_remarks) && (
        <div className="border-l-4 border-brand-500 py-1 pl-3">
          <h4 className="m-0 text-meta font-bold uppercase text-slate-500">Remarks</h4>
          <p className="m-0 text-fine text-slate-700">{result.remarks || result.result_remarks}</p>
        </div>
      )}

      {/* The attachment row, supplied by the caller: each screen offers a different action on it
          (staff preview vs patient view), and only the caller knows which. */}
      {children}

      {/* The clinic's standing note. [1.109.0] It came in two forms, chosen per typed form; with
          the forms gone the seal note stays, as the majority and the more cautious of the two. */}
      <p className="m-0 pt-3 text-center text-meta text-slate-600">
        NOTE: DO NOT ACKNOWLEDGE THE RESULT WITHOUT THE OFFICIAL SEAL
      </p>

      {variant === 'patient' && (
        <p className="m-0 pt-2 text-center text-meta font-bold text-brand-600">
          Confidential Medical Document
        </p>
      )}

      {/* Who authorised it, and when. A report that cannot say who released it is weaker than one
          that can, and the query has carried it all along. */}
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
