import React from 'react';
import { useClinic, isSampleIdentity } from '../lib/clinic';
import { formatDateTime } from '../lib/date';
import FindingsText from './diagnostic/FindingsText';

/**
 * The clinic's diagnostic report, as a document. [1.54.0]
 *
 * ── What this replaces ──────────────────────────────────────────────────────────────────────
 *
 * The printable block was findings, remarks and a released-by line. The patient's name and the
 * name of the examination were in the dialog HEADER — outside `.print-area` — so they did not
 * print at all. What came out of the printer was a page of clinical findings attributable to
 * nobody, for an examination it did not name, on a day it did not state.
 *
 * A clinician cannot read findings without knowing whose they are: diagnostic reference ranges
 * are banded by age and by sex, so "haemoglobin 11.2" means one thing for a 40-year-old man and
 * another for a child. Those two facts are not decoration on a report; they are what makes the
 * numbers interpretable.
 *
 * ── What a report has to carry ──────────────────────────────────────────────────────────────
 *
 *   who    the patient, their age and sex, and the clinic's own identity
 *   what   the examination and the department that performed it
 *   when   the date the exam was PERFORMED — not the date it was released, which is later and
 *          is a separate line
 *   who asked   the referring physician, because the report is addressed to them as much as to
 *          the patient [1.23.0]
 *   who released it, and when — the accountable name, matching what the audit trail holds
 *
 * ── Two things it deliberately does not do ──────────────────────────────────────────────────
 *
 * It never claims to be signed. There is a printed line for a signature and nothing that asserts
 * one was given electronically — this system has no signature capture, and a document implying it
 * had one would be a false statement on a clinical record.
 *
 * The attachment is NAMED, not offered. On screen there is a button to open the file; on paper a
 * button is meaningless, so the printed form states the file exists and leaves it at that. That
 * button was previously inside the print area and came out of the printer.
 */

const Rule = () => <div className="my-2 border-t border-dashed border-slate-300" aria-hidden="true" />;

/** Age at the time of the examination, which is the age the reference range was read against. */
function ageAt(birthdate, when) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  const at = when ? new Date(when) : new Date();
  if (Number.isNaN(b.getTime()) || Number.isNaN(at.getTime())) return null;
  let age = at.getFullYear() - b.getFullYear();
  const m = at.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

function Field({ label, children }) {
  if (!children) return null;
  return (
    <div className="flex gap-2">
      <span className="w-[6.5rem] flex-shrink-0 text-micro font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-fine font-semibold text-slate-900">{children}</span>
    </div>
  );
}

export default function DiagnosticReport({ patient, result }) {
  const CLINIC = useClinic();
  if (!result) return null;

  const age = ageAt(patient?.birthdate, result.visit_date);
  const name = patient ? `${patient.first_name} ${patient.last_name}`.trim() : null;
  const amended = Number(result.version) > 1;

  return (
    <div className="print-area mx-auto w-full max-w-[46rem] bg-white p-6 font-sans text-slate-900">
      {/* Said before anything else, and it prints. A placeholder TIN on a document a patient may
          hand to an insurer is worse than no document. */}
      {isSampleIdentity(CLINIC) && (
        <div className="mb-3 border-2 border-dashed border-rose-400 px-3 py-1.5 text-center">
          <p className="m-0 text-micro font-extrabold uppercase tracking-widest text-rose-600">
            Sample configuration
          </p>
          <p className="m-0 text-nano leading-snug text-rose-600">
            Placeholder clinic identity. Not valid for issue to a patient.
          </p>
        </div>
      )}

      <header className="text-center">
        <h2 className="m-0 text-lead font-extrabold uppercase tracking-wide">{CLINIC.shortName}</h2>
        <p className="m-0 text-micro font-semibold uppercase tracking-wide text-slate-600">
          Ultrasound &amp; Diagnostic Clinic
        </p>
        <p className="m-0 mt-1 text-micro leading-snug text-slate-500">{CLINIC.address}</p>
        <p className="m-0 text-micro leading-snug text-slate-500">
          {CLINIC.phone} · {CLINIC.email}
        </p>
        {CLINIC.proprietor && (
          <p className="m-0 text-micro text-slate-500">{CLINIC.proprietor} &mdash; Prop.</p>
        )}
      </header>

      <Rule />

      <p className="m-0 text-center text-meta font-bold uppercase tracking-[0.14em]">
        Diagnostic Examination Report
      </p>
      {amended && (
        <p className="m-0 mt-0.5 text-center text-micro font-bold uppercase tracking-widest text-amber-700">
          Amended &mdash; version {result.version}, supersedes all earlier copies
        </p>
      )}

      <Rule />

      {/* Two columns on paper as on screen: who, and what. A single stacked list of six fields
          pushes the findings — the reason the document exists — onto a second page. */}
      <section className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <Field label="Patient">{name}</Field>
        <Field label="Examination">{result.test_name}</Field>
        <Field label="Age / Sex">
          {age !== null || patient?.sex
            ? [age !== null ? `${age} yrs` : null, patient?.sex].filter(Boolean).join(' · ')
            : null}
        </Field>
        <Field label="Department">{result.category_name}</Field>
        <Field label="Patient No.">{patient?.id ? `PT-${patient.id}` : null}</Field>
        <Field label="Date of Exam">
          {result.visit_date ? formatDateTime(result.visit_date) : null}
        </Field>
        <Field label="Referred by">
          {result.referring_physician
            ? `${result.referring_physician}${result.referring_physician_prc ? ` (PRC ${result.referring_physician_prc})` : ''}`
            : null}
        </Field>
        <Field label="Report No.">{result.visit_test_id ? `REQ-${result.visit_test_id}` : null}</Field>
      </section>

      <Rule />

      <section className="space-y-1">
        <span className="block text-micro font-bold uppercase tracking-wider text-slate-500">
          Findings &amp; Impression
        </span>
        {/* Out-of-range values are marked. [1.63.0] A CBC panel is eight lines of near-identical
            text, and the two the clinician needs looked exactly like the six they did not.

            FindingsText carries the flag as a bold HIGH/LOW tag as well as a tint, because this
            block is inside a document the clinic PRINTS — browsers drop background colours, so a
            colour-only signal is invisible on the copy that gets handed over. It marks abnormal
            and never marks normal; an unparseable line renders exactly as typed. */}
        <FindingsText
          findings={result.findings}
          className="text-fine leading-relaxed text-slate-900"
        />
      </section>

      {result.result_remarks && (
        <section className="mt-3 space-y-1">
          <span className="block text-micro font-bold uppercase tracking-wider text-slate-500">
            Remarks
          </span>
          <p className="m-0 whitespace-pre-wrap text-fine leading-relaxed text-slate-700">
            {result.result_remarks}
          </p>
        </section>
      )}

      {result.file_original_name && (
        <p className="m-0 mt-3 text-micro italic text-slate-500">
          An image or document is attached to this report electronically: {result.file_original_name}
        </p>
      )}

      <Rule />

      {/* A printed line to sign, and nothing claiming a signature was given. This system captures
          none, and a report asserting otherwise would be a false statement on a clinical record. */}
      <section className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-[14rem] flex-1">
          <div className="border-t border-slate-400 pt-1">
            <p className="m-0 text-fine font-semibold text-slate-900">
              {result.released_by_first_name
                ? `${result.released_by_first_name} ${result.released_by_last_name}`
                : ' '}
            </p>
            <p className="m-0 text-micro text-slate-500">Released by</p>
          </div>
        </div>
        <div className="min-w-[14rem] flex-1">
          <div className="border-t border-slate-400 pt-1">
            <p className="m-0 text-fine font-semibold text-slate-900">&nbsp;</p>
            <p className="m-0 text-micro text-slate-500">Pathologist / Radiologist</p>
          </div>
        </div>
      </section>

      <p className="m-0 mt-4 text-center text-micro text-slate-500">
        Released {result.released_at ? formatDateTime(result.released_at) : '—'}
      </p>
      <p className="m-0 mt-1 text-center text-nano leading-snug text-slate-400">
        CONFIDENTIAL MEDICAL DOCUMENT. This report relates to the named patient only and should be
        interpreted by a qualified clinician alongside the clinical findings.
      </p>
    </div>
  );
}
