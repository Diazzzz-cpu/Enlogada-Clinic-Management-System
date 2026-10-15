import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../config/api';
import { formatCurrency } from '../lib/currency';
import { toastError } from '../lib/toast';

/**
 * The till: the patient being billed, what they owe, and taking the money.
 *
 * Everything here is about one ticket at a time — selecting it, discounting it, charging it.
 * The queue it was picked from, the day's transaction log and the receipt document are all
 * separate concerns with their own hooks; this one neither reads nor writes them.
 *
 * `onPaid` is how a completed sale leaves. The hook does not know that a receipt gets shown or
 * that a queue gets refreshed — it announces the sale and lets the screen decide, the same shape
 * the other till hooks use. That is what keeps the reprint path from being able to reach `bill`.
 *
 * `isAlreadyPaid` is a question rather than the Set itself, for two reasons. The checkout only
 * ever needs the answer for one visit, and — less obviously — the queue that knows the answer is
 * declared *after* this hook, because it reads `selectedVisit` to decide whether to keep polling.
 * A value would be read during this call and blow up on the temporal dead zone; a function is not
 * evaluated until the cashier clicks something, by which point everything exists.
 *
 * @param {(visitId: number) => boolean} isAlreadyPaid  settled today, so it cannot be charged twice
 * @param {(sale: {payment: object, bill: object, tender: object}) => void} onPaid
 */
export function useCheckout({ isAlreadyPaid, onPaid } = {}) {
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [bill, setBill] = useState(null);

  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [amountTendered, setAmountTendered] = useState('');

  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Statutory (Senior Citizen / PWD) and commercial discounts.
   *
   * The entitlement is stored against the visit rather than held here, so the recalculated total
   * comes back from the server — the cashier must never be able to charge a figure the backend
   * did not compute, and POST /payments rejects an amount that disagrees by more than a centavo.
   */
  const [discountCatalogue, setDiscountCatalogue] = useState([]);
  const [discountTypeId, setDiscountTypeId] = useState('');
  const [discountIdNumber, setDiscountIdNumber] = useState('');
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  const [discountError, setDiscountError] = useState('');

  /**
   * Monotonic id for bill fetches. Clicking patient A then B quickly can let A's slower reply
   * land last, which would put A's totals beside B's queue number — and that is the state the
   * wrong-amount charge comes from, because the confirmation dialog quotes the stale pair and
   * reads as self-consistent.
   */
  const billRequestRef = useRef(0);

  const fetchDiscountCatalogue = useCallback(async () => {
    try {
      const res = await api.get('/discounts');
      setDiscountCatalogue(res.data.data.discounts || []);
    } catch (err) {
      console.error('Failed to fetch discount catalogue:', err);
    }
  }, []);

  useEffect(() => {
    fetchDiscountCatalogue();
  }, [fetchDiscountCatalogue]);

  /** Re-read the bill after the server has changed what is owed. */
  const refreshBill = useCallback(async (visitId) => {
    const response = await api.get(`/payments/bill/${visitId}`);
    const fresh = response.data.data.bill;
    setBill(fresh);
    setAmountTendered((fresh?.totalAmount ?? 0).toString());
    return fresh;
  }, []);

  /** Open a ticket for billing. Refuses one already settled today. */
  const select = async (visit) => {
    if (isAlreadyPaid?.(visit.id)) {
      toastError('This visit has already been paid today. Refresh the queue if this looks wrong.');
      return;
    }
    setSelectedVisit(visit);
    setError('');
    setReferenceNumber('');
    setAmountTendered('');

    // Clear the previous patient's bill before fetching the next. Without this, a failed fetch
    // left the previous patient's totals on screen beside the newly selected patient's queue
    // number, and the charge posts `selectedVisit.id` with `bill.totalAmount`.
    setBill(null);
    // The discount entry goes too: an OSCA number typed for one patient must never linger into
    // the next patient's bill.
    setDiscountTypeId('');
    setDiscountIdNumber('');
    setDiscountError('');

    const requestId = ++billRequestRef.current;
    try {
      const response = await api.get(`/payments/bill/${visit.id}`);
      if (requestId !== billRequestRef.current) return; // superseded by a later selection
      const fresh = response.data.data.bill;
      setBill(fresh);
      setAmountTendered((fresh?.totalAmount ?? 0).toString());
    } catch (err) {
      if (requestId !== billRequestRef.current) return;
      console.error(err);
      // Drop the selection as well as the bill. A selected visit with no bill is the half-state
      // that invited the mismatch above.
      setSelectedVisit(null);
      toastError('Failed to retrieve billing summary.');
    }
  };

  /** Put the ticket down without charging it. */
  const clear = () => {
    setSelectedVisit(null);
    setBill(null);
    setError('');
  };

  const applyDiscount = async () => {
    if (!selectedVisit || !discountTypeId) return;
    setApplyingDiscount(true);
    setDiscountError('');
    try {
      await api.post(`/discounts/visit/${selectedVisit.id}`, {
        discountTypeId: parseInt(discountTypeId, 10),
        idNumber: discountIdNumber.trim(),
      });
      await refreshBill(selectedVisit.id);
      setDiscountTypeId('');
      setDiscountIdNumber('');
    } catch (err) {
      // Inline rather than a toast: the commonest failure is a missing OSCA/PWD ID, and the
      // message needs to sit next to the field it is about.
      setDiscountError(err.response?.data?.message || 'Could not apply the discount.');
    } finally {
      setApplyingDiscount(false);
    }
  };

  const removeDiscount = async () => {
    if (!selectedVisit) return;
    setApplyingDiscount(true);
    setDiscountError('');
    try {
      await api.delete(`/discounts/visit/${selectedVisit.id}`);
      await refreshBill(selectedVisit.id);
    } catch (err) {
      setDiscountError(err.response?.data?.message || 'Could not remove the discount.');
    } finally {
      setApplyingDiscount(false);
    }
  };

  const changeDue = () => {
    if (!bill) return 0;
    const totalDue = parseFloat(bill.totalAmount);
    const tendered = parseFloat(amountTendered);
    if (isNaN(tendered) || tendered < totalDue) return 0;
    return tendered - totalDue;
  };

  /**
   * Validate, then ask. Taking payment issues a receipt and advances the visit, so it is not
   * something a stray click should be able to do — the actual charge is in `confirm`.
   */
  const requestConfirmation = (e) => {
    e?.preventDefault();
    setError('');

    if (!selectedVisit || !bill) {
      setError('No active billing ticket selected.');
      return;
    }
    if (isAlreadyPaid?.(selectedVisit.id)) {
      setError('This visit was already paid — refresh the queue before retrying.');
      return;
    }

    const totalDue = parseFloat(bill.totalAmount);
    const tendered = parseFloat(amountTendered);

    if (paymentMethod === 'Cash' && (isNaN(tendered) || tendered < totalDue)) {
      setError(`Cash tendered (${formatCurrency(tendered || 0)}) is less than total amount due (${formatCurrency(totalDue)}).`);
      return;
    }
    if (paymentMethod !== 'Cash' && !referenceNumber) {
      setError(`Reference number is required for ${paymentMethod} transaction.`);
      return;
    }

    setConfirming(true);
  };

  const cancelConfirmation = () => {
    if (submitting) return;
    setConfirming(false);
  };

  const confirm = async () => {
    const totalDue = parseFloat(bill.totalAmount);
    const tender = paymentMethod === 'Cash'
      ? { tendered: parseFloat(amountTendered || 0), change: changeDue() }
      : { tendered: null, change: null };

    setSubmitting(true);
    setError('');

    let payment;
    try {
      // The visit is advanced server-side inside POST /payments itself. It used to be a separate
      // PATCH from here, so a network blip between the two left a fully paid visit stuck at
      // 'Pending' with its ticket never reaching a modality.
      const response = await api.post('/payments', {
        patientVisitId: selectedVisit.id,
        paymentMethod,
        referenceNumber: paymentMethod !== 'Cash' ? referenceNumber : null,
        amount: totalDue,
      });
      payment = response.data.data.payment;
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to process payment');
      setConfirming(false);
      return;
    } finally {
      setSubmitting(false);
    }

    // Past this line the money is taken and the receipt exists, so nothing may report it as
    // failed. `bill` is passed out rather than read later because the panel moves on to the next
    // patient while the receipt is still on screen. Same rule as createAppointment.
    setConfirming(false);
    onPaid?.({ payment, bill, tender });
  };

  return {
    selectedVisit, bill,
    paymentMethod, setPaymentMethod,
    referenceNumber, setReferenceNumber,
    amountTendered, setAmountTendered,
    error, confirming, submitting,
    discountCatalogue, discountTypeId, setDiscountTypeId,
    discountIdNumber, setDiscountIdNumber,
    applyingDiscount, discountError,
    select, clear, applyDiscount, removeDiscount,
    changeDue, requestConfirmation, cancelConfirmation, confirm,
  };
}

export default useCheckout;
