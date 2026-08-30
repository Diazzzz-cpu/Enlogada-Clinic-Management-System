import { useState } from 'react';
import api from '../config/api';
import { printElement } from '../lib/printArea';
import { toastError } from '../lib/toast';

/**
 * The receipt document: what it shows, and how it gets on screen.
 *
 * Deliberately separate from the checkout, even though a sale opens one. A receipt is reached
 * two ways that have nothing to do with each other — a payment that was just taken, and a
 * reprint of one taken hours ago from the history tab — and only the first involves the till at
 * all.
 *
 * Keeping them apart is not tidiness, it is the fix for a real bug preserved in this file's
 * history: reprinting used to write into `billDetails`, the state the *checkout panel* renders
 * from. Selecting a visit, reprinting an older receipt, then returning to the queue rendered the
 * checkout panel from a history row — one patient's name and totals beside another patient's
 * queue number, which is the state a wrong-amount charge comes from. It also wrote an object
 * with no `items` array into something that does `billDetails.items.map(...)` unguarded, so the
 * terminal threw and whited out.
 *
 * With the two split, the reprint path has no reference to the checkout's bill and cannot
 * corrupt it. The bug is not fixed here so much as made unrepresentable.
 */
export function useReceipt() {
  /** The payment the receipt is FOR — a fresh one, or a row from the transaction log. */
  const [payment, setPayment] = useState(null);
  /** The itemised bill. Always the receipt's own copy, never shared with the checkout panel. */
  const [bill, setBill] = useState(null);
  /**
   * Cash tendered and change. These exist only at the moment of sale — a reprint has no record
   * of what was handed over — so `null` means "this is a reprint", which is also what stamps
   * the duplicate copy.
   */
  const [tender, setTender] = useState(null);
  const [open, setOpen] = useState(false);

  /** A sale just completed: show its receipt. */
  const showForSale = (completedPayment, soldBill, cashTender) => {
    setPayment(completedPayment);
    setBill(soldBill);
    setTender(cashTender);
    setOpen(true);
  };

  /**
   * Reopen a receipt from the transaction log.
   *
   * Opens immediately with a placeholder carrying an empty `items` array — present from the
   * start so the itemised block can never map over undefined — then fills in the real bill.
   * Fetches the same GET /payments/bill/:visitId the checkout uses rather than hand-rolling a
   * partial object, which is why a reprint shows the same test breakdown the original did.
   */
  const reprint = async (transaction) => {
    setPayment(transaction);
    setTender(null);
    setBill({
      patientName: `${transaction.patient_first_name} ${transaction.patient_last_name}`,
      items: [],
    });
    setOpen(true);
    try {
      const response = await api.get(`/payments/bill/${transaction.patient_visit_id}`);
      setBill(response.data.data.bill);
    } catch (err) {
      console.error('Failed to load itemized bill for reprint:', err);
      toastError('Could not load the itemized test list for this receipt.');
    }
  };

  /**
   * Prints at 80mm rather than A4.
   *
   * The page size is chosen by a body class (see the @page rule in index.css) because @page
   * cannot be scoped to an element — it applies to the whole printed document. Set it, print,
   * take it off again, so printing a diagnostic report afterwards still gets a normal sheet.
   * Removed in a `finally` so an aborted print dialog cannot leave it stuck on.
   */
  const print = () => printElement(null, 'printing-receipt');

  /** Forget the subject — what selecting a new patient to bill wants. */
  const reset = () => setPayment(null);

  return { payment, bill, tender, open, setOpen, showForSale, reprint, print, reset };
}

export default useReceipt;
