import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { formatCurrency } from '../../lib/currency';

/**
 * The last check before money is taken: are these the patient's final tests? [1.122.0]
 *
 * A paid receipt is final. There are no refunds [1.121.0], and a paid visit's tests can no longer
 * be added to or removed. So a patient still deciding between tests, charged at the counter, has
 * paid for what was on the screen. The dialog lists every test and its price, says plainly what
 * payment locks, and Take Payment waits until the cashier ticks that the patient has confirmed the
 * list. A tick, not just a button: a confirm dialog is the screen people click through without
 * reading, and the tick is the moment the cashier actually turns and asks.
 */
export default function PaymentConfirmDialog({ open, onOpenChange, bill, method, onConfirm, loading, error }) {
  const [confirmed, setConfirmed] = useState(false);

  // Each opening asks again: a tick left over from a cancelled attempt is not a confirmation.
  useEffect(() => {
    if (open) setConfirmed(false);
  }, [open]);

  const items = bill?.items || [];
  const pending = Number(bill?.hmoPendingCount) || 0;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Are these the final tests?"
      description={bill
        ? `Ask ${bill.patientName} to confirm the tests below. Once paid, tests can't be added or removed, and the payment can't be refunded.`
        : ''}
      confirmLabel={bill ? `Take ${formatCurrency(bill.totalAmount)}` : 'Take Payment'}
      confirmDisabled={!confirmed}
      onConfirm={onConfirm}
      loading={loading}
      error={error}
    >
      <ul data-testid="final-tests" className="m-0 list-none divide-y divide-line rounded-lg border border-line p-0 text-fine">
        {items.map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 text-slate-800">{item.name}</span>
            <span className="flex-shrink-0 tabular-nums text-slate-600">{formatCurrency(item.price)}</span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 bg-slate-50 px-3 py-1.5 font-semibold text-ink">
          <span>Total · {method}</span>
          <span className="tabular-nums">{formatCurrency(bill?.totalAmount)}</span>
        </li>
      </ul>

      {pending > 0 && (
        <p className="m-0 flex items-start gap-1.5 text-fine text-amber-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {pending} test{pending > 1 ? 's are' : ' is'} still waiting for an HMO decision and charged in full.
        </p>
      )}

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface p-2.5 text-fine font-medium text-ink">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          disabled={loading}
          className="mt-0.5 rounded text-brand-600 focus:ring-brand-500"
        />
        The patient has confirmed these are their final tests.
      </label>
    </ConfirmDialog>
  );
}
