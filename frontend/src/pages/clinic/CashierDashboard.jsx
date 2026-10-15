import React, { useState } from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import PageHeader from '../../components/ui/page-header';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { useAuth } from '../../contexts/AuthContext';
// Aliased: `Receipt` is already taken by the lucide icon used in this file's headers.
import ReceiptDocument from '../../components/Receipt';
import useOperationsReport from '../../hooks/useOperationsReport';
import { useTransactionHistory } from '../../hooks/useTransactionHistory';
import { useBillingQueue } from '../../hooks/useBillingQueue';
import { useCheckout } from '../../hooks/useCheckout';
import { useReceipt } from '../../hooks/useReceipt';
import { usePaymentReview } from '../../hooks/usePaymentReview';
import CollectionsStrip from '../../components/cashier/CollectionsStrip';
import BillingQueuePanel from '../../components/cashier/BillingQueuePanel';
import CheckoutTerminal from '../../components/cashier/CheckoutTerminal';
import TransactionHistoryPanel from '../../components/cashier/TransactionHistoryPanel';
import OnlinePaymentsPanel from '../../components/cashier/OnlinePaymentsPanel';
import PaymentConfirmDialog from '../../components/cashier/PaymentConfirmDialog';
import { Receipt, Printer, History, Wallet, Search } from 'lucide-react';

// The sidebar's names, so the heading, the breadcrumb and the sidebar all call a screen the same
// thing (option C3, "the same screens, tidied"). [1.75.0] "Cashier POS & Billing Terminal" was a
// third name for the Billing Queue.
const PAGE_TITLES = {
  'cashier-queue': 'Billing Queue',
  'cashier-payments': 'Online Payments',
  'cashier-history': 'Transaction History',
};

const PAGE_ICONS = {
  'cashier-queue': Receipt,
  'cashier-payments': Wallet,
  'cashier-history': History,
};

const PAGE_BLURBS = {
  'cashier-queue': 'Pick a patient, apply a statutory discount, take payment and print the receipt.',
  'cashier-payments': "Patients who paid into the clinic's GCash or bank account and are waiting for you to check the screenshot. Verifying issues a receipt and releases their booking pass.",
  'cashier-history': 'Receipts you and other cashiers have issued, for the daily cash-up. A paid receipt is final.',
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
  // not want a report, and a cashier doing the cash-up does.
  //
  // It answers for the SAME dates as the receipt list above it, and the list is what loads it
  // (`onRangeLoad` below), so it never fetches on its own. [1.74.0] It was a fixed 7 days under a
  // header reading "Settled payments in this range": on 13 Sep the list said 0 receipts for the
  // day while Takings said ₱17,200 from 25.
  const operations = useOperationsReport({ enabled: false });

  // Nine pieces of state, a fetch, a pagination handler and a lazy-load effect, behind one name.
  //
  // Deliberately separate from `queue.transactions` above, which stays pinned to *today* — it also
  // drives queue.paidVisitIds and the queue's collections metrics. Sharing one list between the two
  // would mean picking a date range in History silently changes what "Today's Collections" means.
  const history = useTransactionHistory({
    enabled: view === 'cashier-history',
    onRangeLoad: operations.load,
  });
  // Only polls while its own screen is open, like the two above it.
  const review = usePaymentReview({ enabled: view === 'cashier-payments' });

  // The till, the queue and the receipt are three separate concerns and are wired to each other
  // here rather than inside one another. `checkout.selectedVisit` is read by the queue (to pause polling)
  // and the checkout announces a completed sale outward — nothing reaches back in.
  const receipt = useReceipt();

  // "Find a receipt", from the rail. [1.76.0] The question the till is asked about a receipt comes
  // from someone standing at the counter holding its number — a reprint for an HMO, a dispute —
  // and the only way to it was Transaction History, a date range, and a search. The receipt has an
  // address of its own (`?receipt=`, [1.52.0]); this just asks for the number and opens it.
  const [findingReceipt, setFindingReceipt] = useState(false);
  const [receiptNumber, setReceiptNumber] = useState('');
  const openReceipt = (event) => {
    event.preventDefault();
    const number = receiptNumber.trim().toUpperCase();
    if (!number) return;
    window.open(`?receipt=${encodeURIComponent(number)}`, '_blank', 'noopener');
    setFindingReceipt(false);
    setReceiptNumber('');
  };

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
    <SidebarLayout
      title={PAGE_TITLES[view]}
      activeNav={view}
      onSelectNav={onSelectNav}
      railActions={
        <Button
          variant="outline"
          className="w-full justify-center border-rail-line bg-white/[0.04] text-rail-ink hover:bg-white/[0.08] hover:text-white"
          onClick={() => setFindingReceipt(true)}
        >
          <Search className="h-4 w-4" />
          Find a receipt
        </Button>
      }
    >
      <div className="space-y-5">
        <PageHeader
          icon={PAGE_ICONS[view]}
          title={PAGE_TITLES[view]}
          description={PAGE_BLURBS[view]}
        />

        {view === 'cashier-queue' && (
        <>
        {/* No banner here. [1.74.0] A failed load is said once, in the queue panel, with the one
            Try again — the banner above it repeated the same message with a second Retry. That is
            how the front desk's queue has always reported it. */}

        {/* The day's money, as one line. [1.75.0] */}
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
            operations={operations}
          />
        )}

        {/* Payment confirmation — irreversible action, see .agents Phase 12 */}
        {/* The final check: the tests, their prices, and a tick that the patient confirmed them.
            [1.122.0] A paid receipt is final, so this is the last moment a test can change. */}
        <PaymentConfirmDialog
          open={checkout.confirming}
          onOpenChange={(next) => { if (!next) checkout.cancelConfirmation(); }}
          bill={checkout.bill}
          method={checkout.paymentMethod}
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

        <Dialog
          open={findingReceipt}
          onOpenChange={(open) => { setFindingReceipt(open); if (!open) setReceiptNumber(''); }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Find a receipt</DialogTitle>
              <DialogDescription>
                Type the number printed on it. The receipt opens in a new tab, ready to reprint.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={openReceipt} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="find-receipt-number" className="field-label">Receipt number</label>
                <Input
                  id="find-receipt-number"
                  value={receiptNumber}
                  onChange={(e) => setReceiptNumber(e.target.value)}
                  placeholder="RCT-20260914-0001"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setFindingReceipt(false)}>Cancel</Button>
                <Button type="submit" disabled={!receiptNumber.trim()}>Open receipt</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      </div>
    </SidebarLayout>
  );
};

export default CashierDashboard;
