import React from 'react';
import { Receipt } from 'lucide-react';
import { formatCurrency } from '../../lib/currency';

/**
 * What the terminal shows when no ticket is open — the shift so far.
 *
 * Lifted out of CashierDashboard, which rendered the whole till, the queue beside it and
 * the transaction log from one 971-line file. The props are the hooks this piece reads —
 * listed rather than reached for, so its dependencies are visible at the top.
 * 
 * This is the largest area on the busiest screen in the clinic, and for most of a
 * shift nothing is selected. It used to hold one grey sentence.
 */
export default function ShiftSummaryPanel({ queue }) {
  const collected = Number(queue.summary?.collected || 0);
  const receipts = Number(queue.summary?.receipts || 0);
  const statutoryDiscounts = Number(queue.summary?.discounts || 0);
  const reversalCount = Number(queue.summary?.reversals || 0);
  const reversedAmount = Number(queue.summary?.reversed || 0);
  // Over settled receipts, not over the rows in the log — a reversed receipt is not a sale that
  // happened at some average price.
  const averagePerReceipt = receipts > 0 ? collected / receipts : 0;

  return (
              /* Idle state. This panel is the largest area on the busiest screen in the clinic
                 and it previously held one grey sentence, so for most of a shift the cashier's
                 main view was mostly empty. The prompt still leads, because it is the answer to
                 "what do I do", but the space beneath it now carries the shift summary a cashier
                 would otherwise go to Transaction History to find. */
              <div className="p-8 space-y-6">
                <div className="text-center space-y-2">
                  <Receipt className="w-10 h-10 text-gray-300 mx-auto" />
                  <p className="text-sm font-bold text-gray-500 m-0">
                    Select a patient ticket from the queue to open the billing terminal.
                  </p>
                  {queue.visits.length > 0 && (
                    <p className="text-xs text-gray-400 m-0">
                      {queue.visits.length} patient{queue.visits.length === 1 ? '' : 's'} waiting to be billed.
                    </p>
                  )}
                </div>

                <div className="border-t border-line pt-5">
                  <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block mb-3">
                    This shift so far
                  </span>
                  {/* "Receipts issued" used to be the left half of this pair, showing
                      `queue.transactions.length` — the identical number to the Receipts Issued metric
                      card 400px above it, under an identical label. Six zeros on one screen and
                      two of them were the same zero. What replaces it is the figure the strip
                      above genuinely does not carry: how much was given away in statutory
                      discounts, which is the number a cashier reconciles against their senior
                      and PWD booklet at the end of a shift. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-line bg-slate-50/80 p-3">
                      <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block">Average per receipt</span>
                      <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                        {formatCurrency(averagePerReceipt)}
                      </span>
                    </div>
                    <div className="rounded-xl border border-line bg-slate-50/80 p-3">
                      <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block">Statutory discounts</span>
                      <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                        {formatCurrency(statutoryDiscounts)}
                      </span>
                    </div>
                  </div>
                  {/* Only when there is one. A permanent "0 reversed" row would be noise on the
                      overwhelming majority of shifts; on the shift where it is not zero, it is
                      the reason the drawer will not balance. */}
                  {reversalCount > 0 && (
                    <div className="mt-3 flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2">
                      <span className="text-meta font-bold uppercase tracking-wider text-rose-700">
                        Reversed this shift
                      </span>
                      <span className="text-sm font-extrabold tabular-nums text-rose-700">
                        {formatCurrency(reversedAmount)}
                        <span className="ml-1.5 font-semibold text-rose-500">
                          ({reversalCount} receipt{reversalCount === 1 ? '' : 's'})
                        </span>
                      </span>
                    </div>
                  )}
                  {/* The count-back figure, on the panel where the count-back happens. [1.30.0]
                      `reversed` is reported beside `collected` and never subtracted from it —
                      deliberately, so a reversal is never hidden — which leaves the cashier doing
                      the subtraction in their head against the cash in front of them at the end
                      of a shift. Stated here rather than inferred. Same condition as the band
                      above: on a shift with nothing reversed this is just `collected` again. */}
                  {reversalCount > 0 && (
                    <div className="mt-2 flex items-center justify-between rounded-xl border border-line bg-slate-50/80 px-3 py-2">
                      <span className="text-meta font-bold uppercase tracking-wider text-gray-500">
                        Net in drawer
                      </span>
                      <span className="text-sm font-extrabold tabular-nums text-slate-900">
                        {formatCurrency(collected - reversedAmount)}
                      </span>
                    </div>
                  )}
                </div>

                {queue.transactions.length > 0 && (
                  <div>
                    <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block mb-2">
                      Recent receipts
                    </span>
                    <div className="space-y-1.5">
                      {queue.transactions.slice(0, 4).map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between rounded-lg border border-line px-3 py-2"
                        >
                          <div className="min-w-0">
                            <span className="block text-xs font-bold text-slate-900 truncate">
                              {t.patient_first_name} {t.patient_last_name}
                            </span>
                            <span className="block text-meta text-gray-400 font-mono">
                              #{t.receipt_number}
                              {/* Named, not merely struck. This list is glanceable — four lines
                                  a cashier reads sideways — and a reversed receipt sitting in it
                                  unlabelled reads as money taken. */}
                              {(t.payment_status || 'Paid') !== 'Paid' && (
                                <span className="ml-1.5 font-sans font-bold uppercase tracking-wide text-rose-600">
                                  {t.payment_status}
                                </span>
                              )}
                            </span>
                          </div>
                          <span className={`text-xs font-extrabold tabular-nums flex-shrink-0 ${
                            (t.payment_status || 'Paid') === 'Paid'
                              ? 'text-slate-900'
                              : 'text-slate-400 line-through'
                          }`}>
                            {formatCurrency(parseFloat(t.amount || 0))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
  );
}
