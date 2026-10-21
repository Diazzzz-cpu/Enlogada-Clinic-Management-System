import React, { useState } from 'react';
import { Clock, AlertCircle, AlertTriangle, Upload, Copy, Check, QrCode, FileText, X, ScanLine, Download, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { formatCurrency } from '../../lib/currency';
import { AMOUNT_TOLERANCE } from '../../lib/paymentReview';
import { usePaymentSubmission } from '../../hooks/usePaymentSubmission';
import api from '../../config/api';

/**
 * Paying for a booking from home. [1.48.0]
 *
 * The clinic publishes its own GCash/bank accounts; the patient sends the money themselves and
 * uploads the confirmation. A cashier checks it and the booking pass appears.
 *
 * ── Copy buttons, not just text ─────────────────────────────────────────────────────────────
 *
 * The patient is going to retype an eleven-digit number into a banking app. Every digit they type
 * by hand is a chance to send the clinic's money to a stranger, and neither party would find out
 * until it did not arrive. A copy button removes the retyping entirely.
 */

/** A phone, where the QR on screen cannot be scanned by the same phone. */
const ON_PHONE = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const ON_ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

/**
 * Opens the GCash app. [1.126.0] Only the app: a personal QR cannot be handed to GCash with the
 * amount filled in (that needs a payment gateway, which this clinic has switched off), so the
 * patient pays the saved QR from inside the app. Android's intent link falls back to the Play
 * Store when the app is missing; iPhone tries the app's own scheme.
 */
const GCASH_APP_LINK = ON_ANDROID
  ? 'intent://#Intent;scheme=gcash;package=com.globe.gcash.android;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.globe.gcash.android;end'
  : 'gcash://';

/**
 * The QR image, fetched with the session's auth header rather than as a bare <img src>.
 *
 * [1.126.0] Shown at its own shape (the clinic's QR is a card with the account name under the
 * code, not a bare square), and on a phone with a way to pay from the same phone: GCash's own
 * instruction is to save the QR and upload it in the app, so Save QR comes first and Open GCash
 * second.
 */
function MethodQr({ methodId, label, kind }) {
  const [state, setState] = useState({ src: '', blob: null, failed: false });
  const [saved, setSaved] = useState(false);

  React.useEffect(() => {
    let revoked = false;
    let objectUrl = '';
    // The route requires a token, so a plain <img src> would 401. Fetched as a blob through the
    // configured axios instance, which carries the header — the same reason HMO card previews do.
    api.get(`/payment-methods/${methodId}/qr`, { responseType: 'blob' })
      .then((res) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(res.data);
        setState({ src: objectUrl, blob: res.data, failed: false });
      })
      .catch(() => setState({ src: '', blob: null, failed: true }));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [methodId]);

  // The phone's share sheet where it can take a file ("Save Image" on an iPhone), a download
  // otherwise. A cancelled share is not a failure.
  const saveQr = async () => {
    const name = `Enlogada-${kind || 'payment'}-QR.png`;
    try {
      const file = new File([state.blob], name, { type: state.blob.type || 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: label });
        setSaved(true);
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    const link = document.createElement('a');
    link.href = state.src;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setSaved(true);
  };

  if (state.failed) return null;
  if (!state.src) return <div className="h-48 w-40 animate-pulse rounded-lg bg-skeleton" aria-hidden="true" />;
  return (
    <div className="flex flex-col items-center gap-2">
      <img
        src={state.src}
        alt={`${label} QR code`}
        data-testid="payment-qr"
        className="h-auto w-44 rounded-lg border border-line bg-[#ffffff] p-1.5 sm:w-48"
      />
      {ON_PHONE ? (
        <div className="flex w-full flex-col gap-1.5" data-testid="pay-on-phone">
          <Button type="button" size="sm" variant="outline" onClick={saveQr}>
            {saved ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
            {saved ? 'QR saved' : 'Save QR'}
          </Button>
          {kind === 'GCash' && (
            <Button asChild size="sm">
              <a href={GCASH_APP_LINK}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open GCash
              </a>
            </Button>
          )}
          <p className="m-0 text-center text-micro leading-snug text-slate-500">
            {kind === 'GCash'
              ? 'In GCash, tap QR, then Upload, and choose the saved QR.'
              : 'Open your banking app and pay the saved QR.'}
          </p>
        </div>
      ) : (
        <span className="flex items-center gap-1 text-micro font-semibold text-slate-500">
          <QrCode className="h-3 w-3" aria-hidden="true" />
          Scan with your phone to pay
        </span>
      )}
    </div>
  );
}

/** `display` is what is shown when it differs from what is copied: "₱4,000.00" on screen, "4000" into a banking app. */
function CopyField({ label, value, display }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is unavailable over plain http and in some embedded browsers. The number is
      // still on screen and selectable, so this fails quietly rather than claiming success.
    }
  };
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-surface px-2.5 py-1.5 ring-1 ring-inset ring-line">
      <span className="min-w-0">
        <span className="block text-micro font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</span>
        <span className="block truncate font-mono text-note font-bold tabular-nums text-slate-900">{display ?? value}</span>
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-brand-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/**
 * What the patient is about to send, shown back to them.
 *
 * The single cheapest way to stop an unreadable screenshot reaching a cashier: at thumbnail size
 * it is obvious whether the figures are legible, and correcting it here costs one click instead of
 * a rejection, a phone call and a second upload.
 */
function ProofPreview({ file, onClear }) {
  const [src, setSrc] = useState('');

  React.useEffect(() => {
    if (!file || file.type === 'application/pdf') { setSrc(''); return undefined; }
    const url = URL.createObjectURL(file);
    setSrc(url);
    // Revoked on replacement as well as unmount: picking three files in a row would otherwise
    // leak two blobs for the life of the page.
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!file) return null;

  return (
    <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-line bg-surface p-2">
      {src ? (
        <img src={src} alt="" className="h-16 w-16 flex-shrink-0 rounded-md border border-line object-cover" />
      ) : (
        <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md border border-line bg-slate-50 text-slate-400">
          <FileText className="h-6 w-6" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-fine font-semibold text-slate-800">{file.name}</span>
        <span className="block text-fine text-slate-500">
          {(file.size / 1024).toFixed(0)} KB — check the reference and amount are readable
        </span>
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove this file"
        className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * What the automatic read of the screenshot made of it. [1.62.0]
 *
 * ── Three states, and only one of them is loud ──────────────────────────────────────────────
 *
 * Scanning      a quiet line. The patient did not ask for this and must not be made to wait on
 *               it — the form stays fully usable throughout, and this only explains why a field
 *               might fill itself in a moment.
 * Read something a quiet confirmation naming what was filled in, so a patient who sees a number
 *               appear in a field they did not type in knows where it came from. A field that
 *               populates itself with no explanation reads as a bug.
 * Duplicate     worth interrupting for.
 * Wrong amount  worth interrupting for. [1.105.0] The amount is no longer typed, so the patient
 *               never states a different figure for the cashier to notice; the screenshot is the
 *               only place a short payment shows, and this is the last moment it costs nothing to
 *               fix. Like the duplicate, it warns and does not block: a scan can misread.
 *
 * ── Why the duplicate warning does not block ────────────────────────────────────────────────
 *
 * It warns and lets the patient continue, deliberately. A repeated reference is USUALLY a genuine
 * mistake — the same screenshot sent twice — but not always: references are not globally unique
 * across providers, and a patient correcting a rejected submission is re-sending the same one on
 * purpose, which is exactly right. Blocking would strand that person with no way forward and no
 * one to ask.
 *
 * The cashier is the one who decides, as they already do for the amount. This tells the patient
 * what the clinic is about to notice, which is usually enough for them to check before sending.
 *
 * Nothing here is rendered when the scan found nothing at all: a silent failure is the correct
 * behaviour for an assistant nobody asked for, and "we could not read your image" invites a
 * patient to re-take a photograph they never needed to take.
 */
function ScanWarning({ title, children }) {
  return (
    <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden="true" />
      <span className="min-w-0 text-fine leading-relaxed text-amber-900">
        <strong className="font-semibold">{title}</strong> {children}
      </span>
    </div>
  );
}

function ScanAssist({ scanning, scan, amountDue }) {
  if (scanning) {
    return (
      <p className="m-0 mt-2 flex items-center gap-1.5 text-fine text-slate-500">
        <ScanLine className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
        Reading your screenshot…
      </p>
    );
  }

  if (!scan || !scan.scanned) return null;
  const read = scan.amount === null || scan.amount === undefined ? NaN : Number(scan.amount);
  const due = Number(amountDue);
  const readAmount = Number.isFinite(read);
  if (!scan.reference_number && !readAmount) return null;

  // Only when both figures are real. An unknown amount due is not a mismatch with anything.
  const amountDiffers = readAmount && Number.isFinite(due) && due > 0 && Math.abs(read - due) > AMOUNT_TOLERANCE;

  if (scan.is_duplicate || amountDiffers) {
    const prior = scan.duplicate_of || {};
    return (
      <>
        {amountDiffers && (
          <ScanWarning title="The amount does not match.">
            Your screenshot seems to show <strong className="font-semibold">{formatCurrency(read)}</strong>,
            but this booking is <strong className="font-semibold">{formatCurrency(due)}</strong>. The
            clinic can only confirm the full amount — please check you attached the right screenshot.
          </ScanWarning>
        )}
        {scan.is_duplicate && (
          <ScanWarning title="This reference has been used before.">
            Reference <span className="font-mono font-semibold">{scan.reference_number}</span> was
            already {prior.source === 'payment' ? 'recorded as a payment' : 'submitted'} at the
            clinic{prior.status ? ` (${prior.status.toLowerCase()})` : ''}. If you are re-sending a
            payment the clinic asked you to correct, carry on — otherwise please check you have
            attached the right screenshot.
          </ScanWarning>
        )}
      </>
    );
  }

  return (
    <p className="m-0 mt-2 flex items-start gap-1.5 text-fine leading-relaxed text-slate-500">
      <ScanLine className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-600" aria-hidden="true" />
      <span>
        Read from your screenshot
        {scan.reference_number && <> — reference <span className="font-mono font-semibold text-slate-700">{scan.reference_number}</span></>}
        {readAmount && <> — amount <span className="font-semibold text-slate-700">{formatCurrency(read)}</span></>}
        .{scan.reference_number && ' Please check the reference against your confirmation before sending.'}
      </span>
    </p>
  );
}

/**
 * Step one: are these the tests you want? [1.122.0]
 *
 * Asked BEFORE the clinic's account appears, because the money leaves the patient's banking app
 * and the clinic only sees it afterwards. A paid receipt is final: no refunds [1.121.0], and a paid
 * visit's tests cannot change. A patient still deciding is told not to pay yet: a booking is kept
 * only once paid [1.123.0], so they book again when sure.
 */
function FinalTestsCheck({ tests, amountDue, confirmed, onChange }) {
  return (
    <div data-testid="final-tests-check" className="space-y-2 rounded-lg border border-line bg-surface p-3">
      <p className="m-0 text-fine font-semibold text-slate-900">Check your tests before you pay</p>
      {tests.length > 0 && (
        <ul className="m-0 list-none divide-y divide-line rounded-lg border border-line p-0 text-fine">
          {tests.map((t, i) => (
            <li key={`${t.name}-${i}`} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
              <span className="min-w-0 text-slate-800">{t.name}</span>
              <span className="flex-shrink-0 tabular-nums text-slate-600">{formatCurrency(t.price)}</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-3 bg-slate-50 px-2.5 py-1.5 font-semibold text-ink">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(amountDue)}</span>
          </li>
        </ul>
      )}
      <p className="m-0 text-fine leading-relaxed text-slate-600">
        Once the clinic confirms your payment, these tests can&apos;t be changed and the payment
        can&apos;t be refunded. Not sure yet? Don&apos;t pay now: a booking is kept only once it is
        paid, and you can book again when you are sure.
      </p>
      <label className="flex cursor-pointer items-start gap-2 text-fine font-medium text-ink">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 rounded text-brand-600 focus:ring-brand-500"
        />
        These are the tests I want.
      </label>
    </div>
  );
}

export default function PayBookingPanel({ visitId, amountDue, tests = [], onSettled }) {
  const pay = usePaymentSubmission(visitId, { onSettled });
  const [confirmed, setConfirmed] = useState(false);
  const selected = pay.methods.find((m) => String(m.id) === String(pay.methodId)) || pay.methods[0];
  // What goes into the banking app's amount box: digits, no peso sign or thousands separator.
  const due = Number(amountDue);
  const dueToCopy = Number.isFinite(due) && due > 0 ? (Number.isInteger(due) ? String(due) : due.toFixed(2)) : '';

  if (pay.loading) {
    return <div className="h-24 animate-pulse rounded-xl bg-skeleton" aria-hidden="true" />;
  }

  // Settled. The fourth state the hook's docblock names — "verified -> the pass appears; nothing
  // to do" — which this panel did not implement, because `AppointmentsTab` gated it behind
  // `!appt.is_paid` and it was never rendered for a paid booking.
  //
  // The booking dialog mounts it without that guard, so the case became reachable: pay at the
  // counter, or have the cashier verify while a dialog is still open, then submit from it. The
  // server refuses with 409 "This visit is already paid.", the hook re-reads, and without this
  // branch the upload form renders again UNDER that sentence — inviting a retry that can only
  // fail. Decided here rather than by a third parent guard: the panel now has two parents with
  // different notions of "already paid", and one that decides for itself cannot be mounted
  // somewhere that forgets to check.
  if (pay.verified) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
        <p className="m-0 flex items-center gap-1.5 text-note font-semibold text-emerald-900">
          <Check className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          This booking is paid
        </p>
        <p className="m-0 mt-1 text-fine leading-relaxed text-emerald-800">
          Nothing further to send. Your booking pass is on this booking in{' '}
          <strong>Visits</strong>.
        </p>
      </div>
    );
  }

  // Already sent, awaiting a human. No second upload offered — a duplicate is refused by the
  // server anyway, and offering the form invites a patient to pay twice.
  if (pay.pending) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
        <p className="m-0 flex items-center gap-1.5 text-note font-semibold text-amber-900">
          <Clock className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          Payment sent for checking
        </p>
        <p className="m-0 mt-1 text-fine leading-relaxed text-amber-800">
          Reference <strong className="font-mono">{pay.pending.reference_number}</strong>. The clinic
          verifies it during opening hours — your booking pass appears here as soon as they do.
        </p>
      </div>
    );
  }

  if (pay.methods.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-slate-50 p-3.5">
        <p className="m-0 text-fine leading-relaxed text-slate-600">
          Online payment is not set up yet. Please pay at the counter when you arrive.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-azure-200 bg-azure-50/40 p-3.5">
      <div>
        <p className="m-0 text-note font-bold text-slate-900">Pay to confirm this booking</p>
        <p className="m-0 mt-0.5 text-fine leading-relaxed text-slate-600">
          {confirmed ? (
            <>
              Send {amountDue ? <strong>{formatCurrency(amountDue)}</strong> : 'the amount due'} to the
              account below, then upload the confirmation. Your pass is issued once the clinic checks it.
            </>
          ) : (
            'First, check the tests you are paying for.'
          )}
        </p>
      </div>

      <FinalTestsCheck tests={tests} amountDue={amountDue} confirmed={confirmed} onChange={setConfirmed} />

      {/* The account and the upload only once the tests are confirmed. [1.122.0] */}
      {confirmed && (
        <>

          {/* A rejection has to say why, and offer another go. */}
          {pay.rejected && (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2.5">
              <p className="m-0 flex items-center gap-1.5 text-fine font-semibold text-rose-800">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                Your last payment could not be confirmed
              </p>
              <p className="m-0 mt-0.5 text-fine leading-relaxed text-rose-700">
                {pay.rejected.review_note} — you can submit again below.
              </p>
            </div>
          )}

          {pay.methods.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {pay.methods.map((m) => {
                const on = String(m.id) === String(selected?.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => pay.setMethodId(String(m.id))}
                    aria-pressed={on}
                    // [1.139.0] Themed both ways. The unchosen ones were `bg-white/60` (a literal, so
                    // still white in dark mode) under `text-slate-600` (themed, so light grey there):
                    // "BPI SAVINGS" and "CHINABANK" read as pale text on a pale chip.
                    className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-fine font-semibold transition-colors ${
                      on ? 'border-azure-400 bg-surface text-azure-800' : 'border-line bg-sunken text-ink-soft hover:bg-surface hover:text-ink'
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <div className="flex flex-col gap-3 sm:flex-row">
              {selected.has_qr && (
                <div className="flex flex-shrink-0 flex-col items-center">
                  <MethodQr methodId={selected.id} label={selected.label} kind={selected.kind} />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <CopyField
                  label={selected.kind === 'Bank' ? 'Account number' : 'GCash number'}
                  value={selected.account_number}
                />
                {selected.account_name && (
                  <p className="m-0 text-fine text-slate-600">
                    Account name: <strong>{selected.account_name}</strong>
                    {selected.bank_name ? ` · ${selected.bank_name}` : ''}
                  </p>
                )}
                {/* The amount is stated, not asked for. [1.105.0] It was an editable "Amount sent"
                    box, which invited the patient to send a different figure from the one the
                    booking owes; it now sits beside the number it is sent to, ready to copy. */}
                {dueToCopy && (
                  <CopyField label="Amount to send" value={dueToCopy} display={formatCurrency(due)} />
                )}
                {selected.instructions && (
                  <p className="m-0 text-fine leading-relaxed text-slate-600">{selected.instructions}</p>
                )}
              </div>
            </div>
          )}

          <form onSubmit={pay.submit} className="space-y-2 border-t border-azure-200 pt-3">
            {pay.error && (
              <div role="alert" className="alert alert-error">
                <AlertCircle />
                <span>{pay.error}</span>
              </div>
            )}

            <div>
              <label htmlFor={`ref-${visitId}`} className="field-label">Reference number</label>
              <Input
                id={`ref-${visitId}`}
                value={pay.reference}
                onChange={(e) => pay.setReference(e.target.value)}
                placeholder="From your payment confirmation"
                disabled={pay.submitting}
              />
            </div>

            <div>
              <label htmlFor={`proof-${visitId}`} className="field-label">Screenshot of the transaction</label>
              {/* Said before they choose, not after it is rejected. A cashier can only approve what
                  they can read, and a cropped or blurred screenshot costs the patient a whole
                  round trip — a rejection, a phone call, and a second upload. */}
              <p className="m-0 mb-1.5 text-fine leading-relaxed text-slate-500">
                The <strong>reference number</strong> and the <strong>amount</strong> must both be
                readable. A screenshot from your banking app works better than a photo of the screen.
              </p>
              <input
                id={`proof-${visitId}`}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => pay.chooseProof(e.target.files?.[0] || null)}
                disabled={pay.submitting}
                className="block w-full cursor-pointer rounded-lg border border-slate-200 bg-surface p-2 text-fine text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-fine file:font-semibold file:text-slate-700"
              />
              {/* chooseProof(null) rather than setProof(null): clearing the file must also clear the
                  scan, or a removed screenshot leaves its duplicate warning on screen attached to
                  nothing. */}
              <ProofPreview file={pay.proof} onClear={() => pay.chooseProof(null)} />
              <ScanAssist scanning={pay.scanning} scan={pay.scan} amountDue={amountDue} />
            </div>

            <Button type="submit" loading={pay.submitting} className="w-full">
              <Upload className="h-4 w-4" />
              Send for verification
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
