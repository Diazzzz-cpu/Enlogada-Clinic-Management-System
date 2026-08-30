import React, { useEffect, useState } from 'react';
import { Printer, ArrowLeft, AlertCircle } from 'lucide-react';
import ReceiptDocument from '../components/Receipt';
import { Button } from '../components/ui/button';
import EmptyState from '../components/ui/empty-state';
import api from '../config/api';
import { printElement } from '../lib/printArea';

/**
 * One receipt, on its own page, opened in its own tab. [1.52.0]
 *
 * ── Why a page and not another dialog ───────────────────────────────────────────────────────
 *
 * The receipt document already existed and already printed correctly — but only as a dialog
 * inside the cashier's console, reachable only from the day's transaction list. A patient who
 * rings in October about a receipt from August could not be served: there was no address for one
 * receipt, so there was nothing to open, nothing to send, and nothing to keep open beside the
 * screen you were working in.
 *
 * `?receipt=RCT-…` is a real URL. It can be opened in a new tab, kept open in a second window
 * while the cashier carries on billing, bookmarked, or pasted to a colleague. It follows the
 * `?reset_token=` precedent already in App.jsx — this app has no router by design, and adding one
 * for a single deep link would be a large change to how every screen is reached.
 *
 * The token comes from localStorage, which is shared across tabs of the same origin, so a new tab
 * is already signed in. Nothing is put in the URL but the receipt number, which is deliberate: a
 * link carrying a credential ends up in browser history, in a chat message and in a screenshot.
 *
 * ── Not a PDF, not a picture of a receipt ───────────────────────────────────────────────────
 *
 * This renders the SAME `components/Receipt.jsx` the till prints at the counter, so a copy issued
 * months later is the same document rather than a reconstruction of one. It prints through the
 * browser at 80mm via the same `printing-receipt` body class the cashier's dialog uses. There is
 * no export step and no second rendering path that could drift from the original.
 */
export default function ReceiptView({ receiptNumber, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/payments/receipt/${encodeURIComponent(receiptNumber)}`);
        if (!cancelled) setData(res.data.data);
      } catch (err) {
        if (cancelled) return;
        setError(
          err.response?.status === 404
            ? `No receipt numbered ${receiptNumber}. Check the number on the printed slip.`
            : err.response?.data?.message || 'The receipt could not be loaded.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [receiptNumber]);

  // 80mm, not A4. @page cannot be scoped to an element, so the size is chosen by a body class and
  // taken off afterwards — the same mechanism the cashier's dialog uses, removed in a `finally`
  // so an abandoned print dialog cannot leave the whole app stuck on receipt paper.
  const print = () => printElement(null, 'printing-receipt');

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      {/* no-print: the print rule reveals every descendant of .print-area, and hides everything
          else — but this toolbar sits OUTSIDE it, so it is marked anyway. Cheap insurance against
          the exact defect this component's ancestor shipped with, where the Print button printed
          itself. */}
      <div className="no-print mx-auto mb-4 flex w-full max-w-[22rem] items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Close
        </Button>
        <Button size="sm" onClick={print} disabled={!data}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </div>

      {loading ? (
        <div className="mx-auto h-96 w-full max-w-[22rem] animate-pulse rounded-xl bg-white" aria-hidden="true" />
      ) : error ? (
        <div className="no-print mx-auto w-full max-w-[22rem]">
          <EmptyState
            tone="error"
            icon={AlertCircle}
            title="Receipt not found"
            description={error}
            action={<Button variant="outline" size="sm" onClick={onClose}>Go back</Button>}
          />
        </div>
      ) : (
        <div className="mx-auto w-full max-w-[22rem] rounded-xl bg-white shadow-overlay">
          {/* `reprint` is always true here: this page is never the moment of sale, so it can never
              honestly show cash tendered or change given. Those exist only at the counter, and
              inventing them would put a false statement on a document a patient may file for
              reimbursement. */}
          <ReceiptDocument
            payment={data.payment}
            bill={data.bill}
            cashier={
              data.payment.processed_by_first_name
                ? `${data.payment.processed_by_first_name} ${data.payment.processed_by_last_name}`
                : undefined
            }
            reprint
          />
        </div>
      )}
    </div>
  );
}
