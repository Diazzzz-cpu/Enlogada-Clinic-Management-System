import React from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import { Button } from '../../components/ui/button';
import PageHeader from '../../components/ui/page-header';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Textarea } from '../../components/ui/textarea';
import { formatCurrency } from '../../lib/currency';
import { useAuth } from '../../contexts/AuthContext';
// Aliased: `Receipt` is already taken by the lucide icon used in this file's headers.
import ReceiptDocument from '../../components/Receipt';
import useOperationsReport from '../../hooks/useOperationsReport';
import { useTransactionHistory } from '../../hooks/useTransactionHistory';
import { useBillingQueue } from '../../hooks/useBillingQueue';
import { useRefund } from '../../hooks/useRefund';
import { useCheckout } from '../../hooks/useCheckout';
import { useReceipt } from '../../hooks/useReceipt';
import { usePaymentReview } from '../../hooks/usePaymentReview';
import CollectionsStrip from '../../components/cashier/CollectionsStrip';
import BillingQueuePanel from '../../components/cashier/BillingQueuePanel';
import CheckoutTerminal from '../../components/cashier/CheckoutTerminal';
import TransactionHistoryPanel from '../../components/cashier/TransactionHistoryPanel';
import OnlinePaymentsPanel from '../../components/cashier/OnlinePaymentsPanel';
import { Receipt, Printer, AlertCircle, History, Wallet } from 'lucide-react';

const PAGE_TITLES = {
  'cashier-queue': 'Cashier POS & Billing Terminal',
  'cashier-payments': 'Online Payments',
  'cashier-history': 'Transaction History',
};

const PAGE_ICONS = {
  'cashier-queue': Receipt,
  'cashier-payments': Wallet,
  'cashier-history': History,
};

const PAGE_BLURBS = {
  'cashier-queue': 'Select a patient from the billing queue to price their visit, apply a statutory discount, take payment and issue a receipt.',
  'cashier-payments': "Patients who paid into the clinic's GCash or bank account and are waiting for you to check the screenshot. Verifying issues a receipt and releases their booking pass.",
  'cashier-history': 'Receipts you and other cashiers have issued, for the daily cash-up. Refunds and cancellations are recorded against the original receipt.',
};
const VALID_VIEWS = Object.keys(PAGE_TITLES);


const CashierDashboard = ({ activeNav = 'cashier-queue', onSelectNav }) => {
  // Any nav value this component doesn't recognize (e.g. a stale/default 'dashboard') falls
  // back to the primary billing queue view.
  const view = VALID_VIEWS.includes(activeNav) ? activeNav : 'cashier-queue';
  // Who is at the till. The receipt names them: a receipt nobody can be asked about is not much
  // use when a patient comes back three weeks later disputing a charge.
  const { user } = useAuth();
  // Sales analysis belongs on the History screen, not the till: a cashier mid-transaction does
  // not want a report, and a cashier doing the cash-up does. Only fetched when that view is open.
  const operations = useOperationsReport({ days: 7, enabled: view === 'cashier-history' });

  // Nine pieces of state, a fetch, a pagination handler and a lazy-load effect, behind one name.
  //
  // Deliberately separate from `queue.transactions` above, which stays pinned to *today* — it also
  // drives queue.paidVisitIds and the queue's collections metrics. Sharing one list between the two
  // would mean picking a date range in History silently changes what "Today's Collections" means.
  const history = useTransactionHistory({ enabled: view === 'cashier-history' });
  // Only polls while its own screen is open, like the two above it.
  const review = usePaymentReview({ enabled: view === 'cashier-payments' });

  // Feature Gap Plan Phase A: payment_status has always allowed 'Refunded'/'Cancelled', but
  // nothing in the app ever set them — a duplicate or disputed charge had no reversal path.
  const refund = useRefund({
    // Both, not just the log. Review catch: refreshing only the history list left the metric
    // strip stating a Collected Today and a "Reversed this shift" that predated the reversal,
    // for up to a polling interval — on the screen whose figures a cashier reconciles against
    // the drawer in front of them. `queue` is declared below; the closure is not called until
    // the reversal returns, by which point it exists.
    onRefunded: () => {
      history.reload();
      queue.refresh();
    },
  });

  // The till, the queue and the receipt are three separate concerns and are wired to each other
  // here rather than inside one another. `checkout.selectedVisit` is read by the queue (to pause polling)
  // and the checkout announces a completed sale outward — nothing reaches back in.
  const receipt = useReceipt();

  const checkout = useCheckout({
    // A function, not `queue.paidVisitIds` — `queue` is declared below (it needs
    // `checkout.selectedVisit`), so reading a value here would hit the temporal dead zone.
    isAlreadyPaid: (visitId) => queue.paidVisitIds.has(visitId),
    // Everything that must happen only AFTER the money is taken. The checkout does not know a
    // receipt exists; it says a sale happened and the screen decides what that means.
    onPaid: ({ payment, bill, tender }) => {
      receipt.showForSale(payment, bill, tender);
      queue.refresh();
    },
  });

  // Declared after `checkout` because it reads it: polling is suspended while a visit is open
  // for billing, so a refetch cannot move the row out from under the cashier's cursor.
  const queue = useBillingQueue({
    enabled: view === 'cashier-queue',
    paused: Boolean(checkout.selectedVisit),
  });







  return (
    <SidebarLayout title={PAGE_TITLES[view]} activeNav={view} onSelectNav={onSelectNav}>
      <div className="space-y-5">
        <PageHeader
          icon={PAGE_ICONS[view]}
          title={PAGE_TITLES[view]}
          description={PAGE_BLURBS[view]}
        />

        {view === 'cashier-queue' && (
        <>
        {queue.error && (
          <div role="alert" className="alert alert-error">
            <AlertCircle />
            <span>{queue.error}</span>
            <button type="button" onClick={queue.refresh} className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-bold text-rose-800 underline underline-offset-2">Retry</button>
          </div>
        )}

        {/* Collections Overview Metrics Bar */}
        <CollectionsStrip queue={queue} />

        {/* POS Split Workstation (Left: Billing Queue, Right: Invoice Checkout Terminal) */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

          {/* Left Panel: Pending Patients Billing Queue */}
          <BillingQueuePanel queue={queue} checkout={checkout} />

          {/* Right Panel: Invoice & Cashier POS Terminal */}
          <CheckoutTerminal checkout={checkout} queue={queue} />

        </div>
        </>
        )}

        {view === 'cashier-payments' && <OnlinePaymentsPanel review={review} />}

        {view === 'cashier-history' && (
          <TransactionHistoryPanel
            history={history}
            receipt={receipt}
            refund={refund}
            operations={operations}
          />
        )}

        <Dialog open={!!refund.target} onOpenChange={(open) => { if (!open) refund.cancel(); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Refund Payment</DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                {refund.target && `Refund ${formatCurrency(refund.target.amount)} (Receipt ${refund.target.receipt_number || `OR-${refund.target.id}`})? This marks the payment as Refunded and cannot be undone from this screen.`}
              </DialogDescription>
            </DialogHeader>

            {refund.error && (
              <div role="alert" className="alert alert-error">
                <AlertCircle />
                <span>{refund.error}</span>
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="cashierdashboard-reason" className="field-label">Reason <span className="text-red-600">*</span></label>
              <Textarea id="cashierdashboard-reason"
                value={refund.reason}
                onChange={e => refund.setReason(e.target.value)}
                placeholder="e.g. Duplicate charge, patient dispute..."
                disabled={refund.submitting}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={refund.cancel} disabled={refund.submitting}>Cancel</Button>
              <Button
                type="button"
                variant="destructive"
                onClick={refund.confirm}
                loading={refund.submitting}
              >
                Confirm Refund
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Payment confirmation — irreversible action, see .agents Phase 12 */}
        <ConfirmDialog
          open={checkout.confirming}
          onOpenChange={(next) => { if (!next) checkout.cancelConfirmation(); }}
          title="Confirm Payment"
          description={checkout.bill ? `Charge ${formatCurrency(checkout.bill.totalAmount)} via ${checkout.paymentMethod} for ${checkout.bill.patientName}? This will issue a receipt and cannot be undone from this screen.` : ''}
          confirmLabel="Confirm & Process"
          onConfirm={checkout.confirm}
          loading={checkout.submitting}
          error={checkout.error}
        />

        {/* Printable receipt. The document itself lives in components/Receipt.jsx so the point of
            sale and a later reprint cannot drift into showing different things. */}
        <Dialog open={receipt.open} onOpenChange={receipt.setOpen}>
          <DialogContent className="max-w-sm">
            {receipt.payment && receipt.bill && (
              <>
                <ReceiptDocument
                  payment={receipt.payment}
                  bill={receipt.bill}
                  cashier={user ? `${user.firstName} ${user.lastName}` : undefined}
                  tendered={receipt.tender?.tendered}
                  change={receipt.tender?.change}
                  reprint={receipt.tender == null}
                />
                {/* no-print: the print rule reveals every descendant of .print-area, so a toolbar
                    inside it comes out of the printer with the receipt. That is exactly what the
                    previous version did — the Print button printed itself. */}
                <div className="no-print flex justify-end gap-2 border-t border-line pt-3">
                  <Button variant="outline" onClick={() => receipt.setOpen(false)}>
                    Close
                  </Button>
                  <Button onClick={receipt.print}>
                    <Printer className="h-3.5 w-3.5" />
                    Print Receipt
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

      </div>
    </SidebarLayout>
  );
};

export default CashierDashboard;
