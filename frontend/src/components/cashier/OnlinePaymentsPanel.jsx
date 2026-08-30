import React, { useState } from 'react';
import LoadingState from '../ui/loading-state';
import { AlertTriangle, Check, Eye, History, ShieldAlert, Wallet, X } from 'lucide-react';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ConfirmDialog } from '../ui/confirm-dialog';
import ProofReviewDialog from './ProofReviewDialog';
import DataBadge from '../ui/data-badge';
import { Textarea } from '../ui/textarea';
import EmptyState from '../ui/empty-state';
import { formatCurrency } from '../../lib/currency';

/**
 * Online payments waiting for a cashier to look at the screenshot. [1.48.0]
 *
 * ── The two numbers ─────────────────────────────────────────────────────────────────────────
 *
 * Approving bills the visit's REAL total, not what the patient typed. A screenshot claiming ₱50
 * against a ₱1,450 visit, approved, records ₱1,450 as received — and the drawer is short ₱1,400
 * with nothing on any screen to explain it. So both figures sit side by side and a mismatch is
 * called out in words, because "1450.00" and "50.00" in adjacent columns is exactly the kind of
 * difference a tired eye slides over at the end of a shift.
 */

export default function OnlinePaymentsPanel({ review }) {
  // The whole submission, not just its id. [1.63.0] The review dialog shows the claim BESIDE the
  // evidence — reference, both amounts, the duplicate warning — so it needs the row, and passing
  // an id would mean re-finding it or fetching it again.
  const [reviewing, setReviewing] = useState(null);

  return (
    <div className="space-y-5">
      <Panel className="overflow-hidden">
        <PanelHeader
          title="Online Payments to Verify"
          description="Patients who paid into the clinic's account and are waiting for their booking pass"
          icon={Wallet}
          actions={
            review.submissions.length > 0 ? (
              <span className="rounded-md bg-amber-100 px-2 py-1 text-fine font-semibold text-amber-800">
                {review.submissions.length} waiting
              </span>
            ) : null
          }
        />
        <PanelBody flush>
          {review.error ? (
            <EmptyState
              tone="error"
              compact
              title="Could not load the payment queue"
              description={review.error}
              action={<Button variant="outline" size="sm" onClick={review.reload}>Try again</Button>}
            />
          ) : review.loading ? (
            <LoadingState label="Loading payments to check…" />
          ) : review.submissions.length === 0 ? (
            <EmptyState
              compact
              title="Nothing waiting"
              description="Payments patients make online appear here for checking. The list refreshes on its own."
            />
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {review.submissions.map((s) => {
                const claimed = Number(s.amount_claimed);
                const due = Number(s.amount_due);
                const mismatch = Math.abs(claimed - due) > 0.01;
                const busy = review.acting === s.id;

                return (
                  <li key={s.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 font-semibold text-slate-900">
                          {s.first_name} {s.last_name}
                        </p>
                        <p className="m-0 text-fine text-slate-500">
                          {s.method_label || s.method_kind || 'Online'} · ref{' '}
                          <DataBadge variant="reference" label="Payment reference">{s.reference_number}</DataBadge>
                          {/* Flagged on the ROW, not only inside the dialog: a cashier working a
                              queue should see which one needs a second look before choosing which
                              to open. */}
                          {Number(s.duplicate_count) > 0 && (
                            <span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-rose-800 ring-1 ring-inset ring-rose-300">
                              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                              Reference reused
                            </span>
                          )}
                          {s.appointment_reference ? ` · ${s.appointment_reference}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-4 text-right">
                        <span>
                          <span className="block text-micro font-semibold uppercase tracking-[0.1em] text-slate-400">
                            Patient says
                          </span>
                          <span className={`block font-bold tabular-nums ${mismatch ? 'text-rose-600' : 'text-slate-900'}`}>
                            {formatCurrency(claimed)}
                          </span>
                        </span>
                        <span>
                          <span className="block text-micro font-semibold uppercase tracking-[0.1em] text-slate-400">
                            Visit owes
                          </span>
                          <span className="block font-bold tabular-nums text-slate-900">
                            {formatCurrency(due)}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Said in words, not left as two numbers to compare. */}
                    {mismatch && (
                      <p className="m-0 mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-fine font-semibold text-rose-800 ring-1 ring-inset ring-rose-200">
                        <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                        <span>
                          These do not match. Approving records {formatCurrency(due)} as received —
                          check the screenshot before you do.
                        </span>
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {/* Opens the evidence and the claim TOGETHER. The old viewer put the
                          screenshot on top of the two figures the cashier has to compare it
                          against, so they read the image, closed it, and then decided from a row
                          they were remembering rather than reading. Never disabled now: without a
                          proof there is still a reference and two amounts to weigh. */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReviewing(s)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Review
                      </Button>
                      <Button size="sm" loading={busy} onClick={() => review.verify(s)}>
                        <Check className="h-3.5 w-3.5" />
                        Verify &amp; issue receipt
                      </Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => review.askReject(s)}>
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </PanelBody>
      </Panel>

      {/* What was decided, and by whom. A settled submission used to leave the system entirely, so
          "did we take that GCash payment yesterday?" had nowhere to look and the screenshot behind
          somebody else's decision could not be re-opened. The receipt lives in Transaction
          History; the evidence for it lives here. */}
      {review.reviewed.length > 0 && (
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Recently Reviewed"
            description="The last decisions made here, with the proof still attached"
            icon={History}
          />
          <PanelBody flush>
            <ul className="m-0 list-none divide-y divide-line p-0">
              {review.reviewed.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-note font-semibold text-slate-800">
                      {s.first_name} {s.last_name}
                    </span>
                    <span className="block text-fine text-slate-500">
                      ref <span className="font-mono">{s.reference_number}</span>
                      {s.reviewed_by_first_name ? ` · by ${s.reviewed_by_first_name} ${s.reviewed_by_last_name}` : ''}
                    </span>
                    {s.review_note && (
                      <span className="mt-0.5 block text-fine italic leading-relaxed text-slate-500">
                        “{s.review_note}”
                      </span>
                    )}
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-2.5">
                    {s.receipt_number && (
                      <span className="font-mono text-fine text-slate-500">{s.receipt_number}</span>
                    )}
                    <Badge variant={s.status === 'Verified' ? 'default' : 'secondary'}>
                      {s.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!s.has_proof}
                      onClick={() => setReviewing(s)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Proof
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      )}

      {reviewing && (
        <ProofReviewDialog
          submission={reviewing}
          onClose={() => setReviewing(null)}
          onVerify={(sub) => { setReviewing(null); review.verify(sub); }}
          onReject={(sub) => { setReviewing(null); review.askReject(sub); }}
          busy={review.acting === reviewing.id}
        />
      )}

      <ConfirmDialog
        open={!!review.rejecting}
        onOpenChange={(open) => { if (!open) review.dismissReject(); }}
        title="Reject this payment"
        description={review.rejecting && (
          `${review.rejecting.first_name} ${review.rejecting.last_name} is shown your reason and can submit again. Their booking stays unpaid and no pass is issued.`
        )}
        confirmLabel="Reject payment"
        onConfirm={review.confirmReject}
        loading={!!review.acting}
      >
        <Textarea
          rows={3}
          value={review.rejectReason}
          onChange={(e) => review.setRejectReason(e.target.value)}
          placeholder="e.g. The screenshot shows ₱500 but this visit is ₱1,450."
          aria-label="Reason for rejecting"
        />
      </ConfirmDialog>
    </div>
  );
}
