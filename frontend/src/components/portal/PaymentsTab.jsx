import React from 'react';

const LIST_PAGE_SIZE = 8;
import { ExternalLink, Receipt } from 'lucide-react';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import EmptyState from '../ui/empty-state';
import { Button } from '../ui/button';
import { SkeletonList } from '../ui/skeleton';
import { StatusBadge } from '../ui/status-badge';
import Pagination from '../ui/pagination';
import { formatCurrency } from '../../lib/currency';
import { visitOrigin } from '../../lib/visitOrigin';

/**
 * What this patient has paid.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 *
 * The standard panel header since [1.82.0], so this reads like every other panel in the portal.
 */
export default function PaymentsTab({ payments }) {
  const totalPages = Math.max(1, Math.ceil(payments.payments.length / LIST_PAGE_SIZE));
  const safePage = Math.min(payments.page, totalPages);
  const paged = payments.payments.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE);

  return (
          // data-testid, because payment.spec.js needs to scope its assertions to this panel
          // and was doing it by walking up to the nearest element with a `rounded-2xl` class.
          // That coupled a passing test to a corner radius: changing the radius broke the
          // spec, and the spec's failure said nothing about payments.
          <Panel data-testid="payment-history" className="max-w-2xl overflow-hidden">
            <PanelHeader title="Payment History" icon={Receipt} />
            <PanelBody className="space-y-2 p-4">
              {payments.error ? (
                <EmptyState
                  tone="error"
                  compact
                  title="Could not load your payments"
                  description={payments.error}
                  action={<Button variant="outline" size="sm" onClick={payments.reload}>Try again</Button>}
                />
              ) : payments.loading ? (
                <SkeletonList rows={3} />
              ) : payments.payments.length === 0 ? (
                <EmptyState
                  compact
                  icon={Receipt}
                  title="No payments yet"
                  description="Receipts appear here once the clinic has settled a visit for you."
                />
              ) : (
                paged.map((pay) => (
                  <div key={pay.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="block text-lead font-bold tabular-nums text-slate-900">{formatCurrency(pay.amount)}</span>
                        <span className="block text-fine text-slate-500">
                          {pay.patient_first_name} {pay.patient_last_name}
                          {/* Paid for a walk-in at the clinic, or for a booking. [1.136.0] */}
                          {visitOrigin(pay) && (
                            <span data-testid="visit-origin" data-origin={visitOrigin(pay).key}> · {visitOrigin(pay).label}</span>
                          )}
                        </span>
                      </div>
                      <StatusBadge status={pay.payment_status} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-micro text-slate-400">
                      {/* The receipt, one press away. [1.80.0] The number was printed as text, so the
                          document an HMO or an employer asks a patient to produce had no way to it
                          from the list of what they paid. It opens at its own address, and the
                          server checks the receipt is theirs. */}
                      {pay.receipt_number ? (
                        <a
                          href={`?receipt=${encodeURIComponent(pay.receipt_number)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono font-semibold text-azure-700 underline underline-offset-2 hover:text-azure-800"
                        >
                          {pay.receipt_number}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="font-mono">{`OR-${pay.id}`}</span>
                      )}
                      <span>{new Date(pay.paid_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                  </div>
                ))
              )}
            </PanelBody>
            {payments.payments.length > 0 && (
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={payments.setPage}
                total={payments.payments.length} pageSize={LIST_PAGE_SIZE}
              />
            )}
          </Panel>
  );
}
