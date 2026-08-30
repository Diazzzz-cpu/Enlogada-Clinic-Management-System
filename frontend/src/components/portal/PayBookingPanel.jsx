import React, { useState } from 'react';
import { Clock, AlertCircle, AlertTriangle, Upload, Copy, Check, QrCode, FileText, X, ScanLine } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { formatCurrency } from '../../lib/currency';
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

/** The QR image, fetched with the session's auth header rather than as a bare <img src>. */
function MethodQr({ methodId, label }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  React.useEffect(() => {
    let revoked = false;
    let objectUrl = '';
    // The route requires a token, so a plain <img src> would 401. Fetched as a blob through the
    // configured axios instance, which carries the header — the same reason HMO card previews do.
    api.get(`/payment-methods/${methodId}/qr`, { responseType: 'blob' })
      .then((res) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [methodId]);

  if (failed) return null;
  if (!src) return <div className="h-36 w-36 animate-pulse rounded-lg bg-skeleton" aria-hidden="true" />;
  return <img src={src} alt={`${label} QR code`} className="h-36 w-36 rounded-lg border border-line bg-[#ffffff] p-2 object-contain" />;
}

function CopyField({ label, value }) {
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
        <span className="block truncate font-mono text-note font-bold tabular-nums text-slate-900">{value}</span>
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
 * Duplicate     the one case worth interrupting for.
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
function ScanAssist({ scanning, scan }) {
  if (scanning) {
    return (
      <p className="m-0 mt-2 flex items-center gap-1.5 text-fine text-slate-500">
        <ScanLine className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
        Reading your screenshot…
      </p>
    );
  }

  if (!scan || !scan.scanned) return null;
  const found = scan.reference_number || scan.amount !== null;
  if (!found) return null;

  if (scan.is_duplicate) {
    const prior = scan.duplicate_of || {};
    return (
      <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden="true" />
        <span className="min-w-0 text-fine leading-relaxed text-amber-900">
          <strong className="font-semibold">This reference has been used before.</strong>{' '}
          Reference <span className="font-mono font-semibold">{scan.reference_number}</span> was
          already {prior.source === 'payment' ? 'recorded as a payment' : 'submitted'} at the
          clinic{prior.status ? ` (${prior.status.toLowerCase()})` : ''}. If you are re-sending a
          payment the clinic asked you to correct, carry on — otherwise please check you have
          attached the right screenshot.
        </span>
      </div>
    );
  }

  return (
    <p className="m-0 mt-2 flex items-start gap-1.5 text-fine leading-relaxed text-slate-500">
      <ScanLine className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-600" aria-hidden="true" />
      <span>
        Read from your screenshot
        {scan.reference_number && <> — reference <span className="font-mono font-semibold text-slate-700">{scan.reference_number}</span></>}
        {scan.amount !== null && scan.amount !== undefined && <> — amount <span className="font-semibold text-slate-700">{formatCurrency(scan.amount)}</span></>}
        . Please check both against your confirmation before sending.
      </span>
    </p>
  );
}

export default function PayBookingPanel({ visitId, amountDue, onSettled }) {
  const pay = usePaymentSubmission(visitId, { onSettled });
  const selected = pay.methods.find((m) => String(m.id) === String(pay.methodId)) || pay.methods[0];

  if (pay.loading) {
    return <div className="h-24 animate-pulse rounded-xl bg-skeleton" aria-hidden="true" />;
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
          Send {amountDue ? <strong>{formatCurrency(amountDue)}</strong> : 'the amount due'} to the
          account below, then upload the confirmation. Your pass is issued once the clinic checks it.
        </p>
      </div>

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
                className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-fine font-semibold transition-colors ${
                  on ? 'border-azure-400 bg-surface text-azure-800' : 'border-line bg-white/60 text-slate-600 hover:bg-surface'
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
            <div className="flex flex-shrink-0 flex-col items-center gap-1">
              <MethodQr methodId={selected.id} label={selected.label} />
              <span className="flex items-center gap-1 text-micro font-semibold text-slate-500">
                <QrCode className="h-3 w-3" aria-hidden="true" />
                Scan to pay
              </span>
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

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
            <label htmlFor={`amt-${visitId}`} className="field-label">Amount sent</label>
            <Input
              id={`amt-${visitId}`}
              type="number"
              min="0"
              step="0.01"
              value={pay.amount}
              onChange={(e) => pay.setAmount(e.target.value)}
              placeholder={amountDue ? String(amountDue) : '0.00'}
              disabled={pay.submitting}
            />
          </div>
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
          <ScanAssist scanning={pay.scanning} scan={pay.scan} />
        </div>

        <Button type="submit" loading={pay.submitting} className="w-full">
          <Upload className="h-4 w-4" />
          Send for verification
        </Button>
      </form>
    </div>
  );
}
