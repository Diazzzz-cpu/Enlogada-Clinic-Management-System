import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { usePolling } from './usePolling';
import { toastSuccess, toastError } from '../lib/toast';
import { reviewConcerns } from '../lib/paymentReview';

/**
 * The cashier's queue of online payments awaiting a human check. [1.48.0]
 *
 * A patient pays into the clinic's own GCash or bank account and uploads the confirmation. Nobody
 * is standing at the counter, so nothing prompts a cashier to look — which is why this polls like
 * the billing queue does, and why submitting one raises a notification.
 *
 * ── The comparison this screen exists to make ───────────────────────────────────────────────
 *
 * Approving bills the visit's REAL total, not the amount the patient typed. So approving a
 * screenshot that says ₱50 against a ₱1,450 visit records ₱1,450 as received and the drawer is
 * short ₱1,400 with nothing anywhere to explain it. The cashier is the only control on that, so
 * the queue carries both figures and the panel puts them side by side.
 */
export function usePaymentReview({ enabled = true } = {}) {
  const [submissions, setSubmissions] = useState([]);
  const [reviewed, setReviewed] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [acting, setActing] = useState(null);
  const [verifying, setVerifying] = useState(null);
  const [verifyAck, setVerifyAck] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    try {
      // Both together: the pending queue is the work, and the recent decisions are what a cashier
      // is asked about ("did we take that one yesterday?"). Settled together so a verification
      // moves a row from one list to the other in a single refresh rather than two.
      const [pendingRes, reviewedRes] = await Promise.all([
        api.get('/payment-submissions/pending'),
        api.get('/payment-submissions/reviewed'),
      ]);
      setSubmissions(pendingRes.data.data.submissions || []);
      setReviewed(reviewedRes.data.data.submissions || []);
      setError('');
    } catch (err) {
      console.error('Failed to load payment submissions:', err);
      // Named, so an empty queue and a broken one are never confusable — the failure this whole
      // app has fixed six times over.
      setError(err.response?.data?.message || 'The online payment queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  // usePolling only sets the interval — it does not fire on mount. Without this the queue would
  // sit on its loading skeleton for a full cycle before showing anything, which is the shape
  // useBillingQueue uses too.
  useEffect(() => { load(); }, [load]);

  // 20s: a patient who has just paid is watching for their pass, and the cashier is the only
  // thing between them and it. Faster than the 30s default for that reason.
  usePolling(load, 20000, { enabled });

  // ── Verification asks twice, because it cannot be taken back here ──────────────────────────
  //
  // Verifying is not a status change. It runs the same writer the counter uses: a receipt number
  // comes off daily_counters, the visit is released, a cash-up entry is written and the patient is
  // told their pass is ready. Undoing it means a cash-up reversal, which is a different screen, a
  // different permission and a line in the day's reconciliation that somebody has to explain.
  //
  // It was also the one irreversible action on this panel that took a single click, while REJECT —
  // which the patient can simply answer by submitting again — already asked for a confirmation and
  // a written reason. The guard was on the recoverable action and not on the expensive one.
  //
  // The queue makes that easy to do by accident: rows are stacked, every row carries the same
  // three buttons in the same places, and "Verify & issue receipt" sits between "Review" and
  // "Reject". A slip of one row books somebody else's money.
  const askVerify = (submission) => { setVerifyAck(false); setVerifying(submission); };
  const dismissVerify = () => { if (!acting) setVerifying(null); };

  const confirmVerify = async () => {
    if (!verifying || acting) return;

    // The graduated half. A clean payment is confirmed by confirming; one the system has already
    // called out — the claim not matching the bill, or a reference seen before — additionally has
    // to be acknowledged for what it is. Asserted here as well as disabling the button, because a
    // button is a courtesy and this is the rule.
    if (reviewConcerns(verifying).concerning && !verifyAck) {
      toastError('Tick the box to confirm you have checked what was flagged.');
      return;
    }

    setActing(verifying.id);
    try {
      const res = await api.post(`/payment-submissions/${verifying.id}/verify`);
      const receipt = res.data.data?.payment?.receipt_number;
      const name = `${verifying.first_name} ${verifying.last_name}`;
      // Closed before the reload, matching confirmReject — the row this dialog describes is about
      // to leave the pending queue, and a dialog still naming it would be describing nothing.
      setVerifying(null);
      await load();
      // Names the patient and the receipt: a bare "Verified" on a queue of six confirms nothing,
      // and the receipt number is what the cashier writes down.
      toastSuccess(`${name} — paid. Receipt ${receipt}.`);
    } catch (err) {
      toastError(err.response?.data?.message || 'The payment could not be verified.');
    } finally {
      setActing(null);
    }
  };

  const askReject = (submission) => { setRejectReason(''); setRejecting(submission); };
  const dismissReject = () => { if (!acting) setRejecting(null); };

  const confirmReject = async () => {
    if (!rejecting || acting) return;
    if (!rejectReason.trim()) {
      toastError('Say why — the patient is shown this, and will ask.');
      return;
    }
    setActing(rejecting.id);
    try {
      await api.post(`/payment-submissions/${rejecting.id}/reject`, { reviewNote: rejectReason.trim() });
      const name = `${rejecting.first_name} ${rejecting.last_name}`;
      setRejecting(null);
      await load();
      toastSuccess(`${name}'s payment rejected, with your reason sent to them.`);
    } catch (err) {
      toastError(err.response?.data?.message || 'The payment could not be rejected.');
    } finally {
      setActing(null);
    }
  };

  // `verify` is deliberately NOT returned. The only way to reach the POST from a component is
  // askVerify -> confirmVerify, so the confirmation cannot be skipped by wiring a button straight
  // to it later — the same shape confirmReject has always had.
  return {
    submissions, reviewed, loading, error, reload: load,
    acting,
    verifying, verifyAck, setVerifyAck, askVerify, dismissVerify, confirmVerify,
    rejecting, rejectReason, setRejectReason, askReject, dismissReject, confirmReject,
  };
}
