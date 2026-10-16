import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Search, Phone } from 'lucide-react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import PageHero from '../../components/public/PageHero';
import PageShell from '../../components/ui/page-shell';
import { Button } from '../../components/ui/button';
import api from '../../config/api';
import { useClinic } from '../../lib/clinic';
import { formatDate, formatDateTime } from '../../lib/date';

/**
 * Is this report genuine? [1.126.0]
 *
 * Opened by whoever a patient showed their report to: an employer, a school, an HMO. They scan the
 * QR on the patient's copy, which lands here as `?verify=ABCDE-12345`, or type the code printed
 * beside it. No account, and nothing on the page but what lets them match the paper in their hand:
 * the test, the patient's initials and the release date. Never a result (see verificationService).
 *
 * Three answers, each its own look, so none can be mistaken for another:
 *   genuine     the clinic issued this report and it is the current one.
 *   replaced    the clinic issued it, then released a correction. Real, but out of date.
 *   not found   no report carries this code. Worded as "call the clinic", not "forgery": a code
 *               misread off a creased print reads exactly the same way.
 *
 * The address bar follows the code looked up, so the page can be shared or bookmarked as it is.
 */

const TONES = {
  genuine: {
    icon: ShieldCheck,
    title: 'Genuine report',
    box: 'border-emerald-200 bg-emerald-50',
    ink: 'text-emerald-900',
    soft: 'text-emerald-800',
  },
  replaced: {
    icon: ShieldAlert,
    title: 'Replaced by a corrected report',
    box: 'border-amber-200 bg-amber-50',
    ink: 'text-amber-900',
    soft: 'text-amber-800',
  },
  'not-found': {
    icon: ShieldQuestion,
    title: 'No report matches this code',
    box: 'border-rose-200 bg-rose-50',
    ink: 'text-rose-900',
    soft: 'text-rose-800',
  },
};

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="w-36 flex-shrink-0 text-fine font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 text-sm font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

function Answer({ state, clinic }) {
  const tone = TONES[state.status];
  const Icon = tone.icon;
  const report = state.report;
  const phone = clinic.phone;
  return (
    <section
      aria-live="polite"
      data-testid="verify-result"
      data-status={state.status}
      className={`rounded-2xl border p-5 sm:p-6 ${tone.box}`}
    >
      <h2 className={`m-0 flex items-center gap-2 text-lg font-bold ${tone.ink}`}>
        <Icon className="h-6 w-6 flex-shrink-0" aria-hidden="true" />
        {tone.title}
      </h2>

      {state.status === 'not-found' ? (
        <p className={`m-0 mt-2 text-sm leading-relaxed ${tone.soft}`}>
          {state.message} The code is printed beside the QR, after “Verification code”.
        </p>
      ) : (
        <>
          <p className={`m-0 mt-2 text-sm leading-relaxed ${tone.soft}`}>
            {state.status === 'genuine'
              ? `${report.clinic} issued this report. Check that the details below match the report in front of you.`
              : `${report.clinic} issued this report, then released a corrected one on ${formatDate(report.replacedAt)}. Ask the patient for the corrected report.`}
          </p>
          <dl className="m-0 mt-4 divide-y divide-line rounded-xl border border-line bg-surface px-4">
            <Row label="Test">
              {report.testName}
              <span className="font-normal text-slate-500"> · {report.department}</span>
            </Row>
            <Row label="Patient">{report.patientInitials || '—'}</Row>
            <Row label="Released">{formatDateTime(report.releasedAt)}</Row>
            {report.version > 1 && <Row label="Version">Corrected report, version {report.version}</Row>}
            <Row label="Code"><span className="font-mono tracking-wider">{report.code}</span></Row>
          </dl>
          <p className="m-0 mt-3 text-fine leading-relaxed text-slate-600">
            This page never shows results. To confirm a figure on the report, call the clinic.
          </p>
        </>
      )}

      {phone && (
        <a
          href={`tel:${phone.replace(/\s/g, '')}`}
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-700 no-underline hover:underline"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          {phone}
        </a>
      )}
    </section>
  );
}

export default function VerifyReport({ initialCode = '', onNavigate }) {
  const clinic = useClinic();
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState({ status: 'idle' });
  const inputRef = useRef(null);

  const lookUp = useCallback(async (raw) => {
    const typed = String(raw || '').trim();
    if (!typed) {
      setState({ status: 'invalid', message: 'Enter the code printed on the report.' });
      inputRef.current?.focus();
      return;
    }
    setState({ status: 'loading' });
    try {
      const res = await api.get(`/verify/${encodeURIComponent(typed)}`);
      const report = res.data.data.report;
      setCode(report.code);
      setState({ status: report.status, report });
      window.history.replaceState({}, '', `${window.location.pathname}?verify=${report.code}`);
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.message;
      if (status === 404) setState({ status: 'not-found', message });
      else if (status === 400) setState({ status: 'invalid', message });
      else if (status === 429) setState({ status: 'error', message });
      else setState({ status: 'error', message: 'The clinic could not be reached. Check your connection and try again.' });
    }
  }, []);

  // A scanned QR arrives with its code: look it up at once.
  useEffect(() => {
    if (initialCode) lookUp(initialCode);
  }, [initialCode, lookUp]);

  const submit = (e) => {
    e.preventDefault();
    lookUp(code);
  };

  const showsAnswer = TONES[state.status];
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <PublicHeader overlay currentTab="verify" onNavigate={onNavigate} />
      <PageHero
        id="verify-title"
        eyebrow="Report verification"
        title={<>Verify a <span className="text-gradient-aurora">report</span></>}
        subtitle="Check that a result from our clinic is genuine. Scan the QR on the report, or enter the code printed beside it."
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="verify-code" className="sr-only">Verification code</label>
          <div className="flex flex-1 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-3 backdrop-blur-sm transition-colors focus-within:border-white/60 focus-within:bg-white/15">
            <Search className="h-4 w-4 flex-shrink-0 text-aurora-soft" aria-hidden="true" />
            <input
              ref={inputRef}
              id="verify-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABCDE-12345"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={state.status === 'invalid' || undefined}
              aria-describedby={state.status === 'invalid' ? 'verify-code-error' : undefined}
              // text-base on a phone: iOS zooms the page into any field under 16px.
              className="min-w-0 flex-1 border-0 bg-transparent font-mono text-base uppercase tracking-wider text-aurora-ink outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-aurora-soft sm:text-sm"
            />
          </div>
          <Button type="submit" variant="brand" size="lg" loading={state.status === 'loading'} className="rounded-full">
            Verify
          </Button>
        </form>
        {(state.status === 'invalid' || state.status === 'error') && (
          <p id="verify-code-error" role="alert" className="m-0 mt-3 text-sm font-semibold text-aurora-ink">
            {state.message}
          </p>
        )}
      </PageHero>

      <PageShell width="5xl" className="flex-1 py-10 sm:py-14">
        <div className="mx-auto max-w-2xl">
          {showsAnswer ? (
            <Answer state={state} clinic={clinic} />
          ) : (
            <div className="rounded-2xl border border-line bg-surface p-5 text-sm leading-relaxed text-slate-600 sm:p-6">
              <p className="m-0 font-semibold text-slate-900">Where to find the code</p>
              <p className="m-0 mt-1">
                Every report a patient receives from us, in their portal or by email, carries a QR and a
                10-character verification code at the foot of each page. The original, printed and sealed
                at the clinic, can be confirmed by calling us
                {clinic.phone ? <> on <strong className="whitespace-nowrap">{clinic.phone}</strong></> : null}.
              </p>
            </div>
          )}
        </div>
      </PageShell>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
}
