import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';
import { toastSuccess } from '../lib/toast';

/**
 * A patient settling a booking by paying into the clinic's own account. [1.48.0]
 *
 * They pay from their own GCash or banking app, then upload the confirmation screenshot with its
 * reference number. A cashier looks at it and approves, and only then is the booking pass issued.
 *
 * ── The state that matters ──────────────────────────────────────────────────────────────────
 *
 * A booking is in exactly one of four situations, and the patient must be able to tell which:
 *
 *   nothing submitted   -> show the accounts and the upload form
 *   awaiting review     -> say so, and do NOT offer a second upload
 *   rejected            -> say why, and offer the form again
 *   verified            -> the pass appears; nothing to do
 *
 * The middle two are the ones a naive implementation loses. A patient who has uploaded and hears
 * nothing assumes it failed and pays twice; a patient whose proof was rejected without a reason
 * rings the clinic, and whoever answers cannot help them.
 */
export function usePaymentSubmission(visitId, { onSettled } = {}) {
  const [methods, setMethods] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [proof, setProof] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // [1.62.0] What the OCR pass made of the screenshot. `null` until one has run.
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);

  const reload = useCallback(async () => {
    if (!visitId) return;
    setLoading(true);
    // Allowed to fail independently: a patient who cannot see the account list can still be shown
    // what they have already submitted, and vice versa.
    const [m, s] = await Promise.allSettled([
      api.get('/payment-methods'),
      api.get(`/payment-submissions/visit/${visitId}`),
    ]);
    if (m.status === 'fulfilled') setMethods(m.value.data.data.methods || []);
    if (s.status === 'fulfilled') setSubmissions(s.value.data.data.submissions || []);
    setLoading(false);
  }, [visitId]);

  useEffect(() => { reload(); }, [reload]);

  // Newest first from the API, so the head is the current state of play.
  const latest = submissions[0] || null;
  const pending = latest?.status === 'Pending' ? latest : null;
  const rejected = latest?.status === 'Rejected' ? latest : null;
  const verified = submissions.some((s) => s.status === 'Verified');

  /**
   * Picking a file runs the OCR pass and offers what it read. [1.62.0]
   *
   * ── It only fills a field the patient has left EMPTY ────────────────────────────────────────
   *
   * The rule that keeps this an assistant rather than an authority. Somebody who has already
   * typed their reference number has told us what it is, and a machine reading of a phone
   * screenshot is not better evidence than the person holding the phone. Overwriting them would
   * also be maddening: type the reference, attach the image, watch your own typing get replaced.
   *
   * A blank field, by contrast, costs nothing to fill and saves transcribing thirteen digits —
   * which is the actual error this addresses. A transposed digit produces a reference the clinic
   * can never reconcile against the transfer it names.
   *
   * Everything here is best-effort. A scan that fails, times out, or reads nothing leaves the
   * form exactly as it was, with no error shown: the patient never asked for this, so it cannot
   * fail in front of them. `setError` is deliberately untouched on the failure path.
   */
  const scanProof = useCallback(async (file) => {
    setScan(null);
    if (!file) return;
    // Tesseract reads raster images; a PDF receipt is legitimate but unscannable, and saying
    // nothing is better than reporting it as unreadable.
    if (!String(file.type || '').startsWith('image/')) return;

    setScanning(true);
    try {
      const fd = new FormData();
      fd.append('proof', file);
      const res = await api.post('/payments/scan-receipt', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = res.data?.data?.scan;
      if (!result) return;
      setScan(result);

      // Functional updates: the scan resolves a second or two after the file was picked, and the
      // patient may well have been typing in the meantime. Reading the value from the setter
      // rather than from the closure is what makes "only fill what is empty" true at the moment
      // of writing rather than at the moment the request was sent.
      if (result.reference_number) {
        setReference((current) => (current.trim() ? current : result.reference_number));
      }
      if (result.amount !== null && result.amount !== undefined) {
        setAmount((current) => (String(current).trim() ? current : String(result.amount)));
      }
    } catch {
      // Silent by design — see above.
    } finally {
      setScanning(false);
    }
  }, []);

  /** Replaces `setProof` at the call site, so choosing a file always triggers a scan. */
  const chooseProof = useCallback((file) => {
    setProof(file);
    scanProof(file);
  }, [scanProof]);

  const submit = async (e) => {
    e?.preventDefault();
    if (submitting) return;
    setError('');

    if (!reference.trim()) {
      setError('Enter the reference number from your payment confirmation.');
      return;
    }
    if (!proof) {
      setError('Attach a screenshot or photo of the transaction.');
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('patientVisitId', String(visitId));
      if (methodId) fd.append('paymentMethodId', String(methodId));
      fd.append('referenceNumber', reference.trim());
      fd.append('amountClaimed', String(amount || 0));
      fd.append('proof', proof);

      await api.post('/payment-submissions', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setReference('');
      setAmount('');
      setProof(null);
      setScan(null);
      await reload();
      toastSuccess('Payment sent for verification. Your pass appears once the cashier confirms it.');
      onSettled?.();
    } catch (err) {
      setError(err.response?.data?.message || 'The payment could not be submitted. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    methods, submissions, loading, reload,
    methodId, setMethodId, reference, setReference, amount, setAmount, proof, setProof,
    error, submitting, submit,
    latest, pending, rejected, verified,
    // [1.62.0] `chooseProof` is what the file input should call — `setProof` is still exported
    // for the Remove button, which must clear the file WITHOUT starting a scan of nothing.
    chooseProof, scan, scanning,
  };
}
