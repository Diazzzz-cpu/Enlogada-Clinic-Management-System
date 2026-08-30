import React from 'react';
import ShiftSummaryPanel from './ShiftSummaryPanel';
import { AlertCircle, BadgeCheck, CheckCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel } from '../ui/panel';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { formatCurrency } from '../../lib/currency';
// The vocabulary, not a copy of it — mirrors backend constants/paymentMethods.js. [1.33.0]
import { COUNTER_PAYMENT_METHODS } from '../../lib/paymentMethods';

/**
 * The till: one patient, what they owe, and taking the money.
 *
 * Lifted out of CashierDashboard. Holds the ternary that decides between an open ticket and
 * an idle terminal, and hands the idle case to ShiftSummaryPanel — the two states share a
 * Panel and nothing else.
 * 
 * The action bar is a pinned HEADER, not a footer. position: sticky is constrained by its
 * containing block, so a button already at the end of one has nowhere to slide to and never
 * moves; Take Payment was measured at y=904 on a 900px viewport that way. It reaches the form
 * below through form="checkout-form".
 */
export default function CheckoutTerminal({ checkout, queue }) {
  return (
        <div className="lg:col-span-7">
          <Panel className="overflow-hidden">
            {checkout.selectedVisit && checkout.bill ? (
              <div>
                {/* Who, how much, and the button — pinned to the top of the terminal.
                    ── Why the top and not the bottom ──────────────────────────────────────────
                    The primary action used to be the last element of a long column, which on a
                    900px screen put it 4px below the fold: completing a sale meant scrolling
                    past the bill to find the button, by which point the figure being charged
                    was off screen. The obvious fix — a sticky bar at the bottom — does not
                    work, and it is worth writing down why: a `position: sticky` element is
                    constrained by its containing block, and one that is already the LAST child
                    has no space beneath it to slide into, so it never moves. Measured at
                    y=904 against a 900px viewport before this changed.
                    A sticky header has no such problem, and for a till it is arguably better
                    anyway: the amount stays in front of the cashier the whole time they are
                    picking a method and counting cash, rather than reappearing at the end.
                    The button lives outside the form and reaches it by `form="checkout-form"`,
                    so submit behaviour and Enter-to-pay are unchanged. */}
                <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white/95 px-6 py-4 backdrop-blur-sm">
                  <div className="min-w-0">
                    <span className="field-label">Now billing</span>
                    <h2 className="m-0 truncate text-lead font-bold tracking-tight text-slate-900">
                      {checkout.bill.patientName}
                    </h2>
                    <span className="text-fine text-slate-500">
                      Ticket {checkout.selectedVisit.queue_number} &bull; {checkout.selectedVisit.patient_type_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="block text-micro font-semibold uppercase tracking-[0.1em] text-slate-500">
                        Amount due
                      </span>
                      <span className="block text-xl font-extrabold leading-none tracking-tight tabular-nums text-slate-900">
                        {formatCurrency(checkout.bill.totalAmount)}
                      </span>
                    </div>
                    <Button type="submit" form="checkout-form" size="lg">
                      <CheckCircle className="h-4 w-4" />
                      Take Payment
                    </Button>
                  </div>
                </div>

                <div className="space-y-6 p-6">

                {/* Itemized Tests Breakdown Table */}
                <div className="space-y-2">
                  <span className="field-label">Itemised services</span>
                  <div className="border border-line rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader sticky>
                        <TableRow>
                          <TableHead className="text-meta font-bold uppercase py-2">Test Name</TableHead>
                          <TableHead className="text-meta font-bold uppercase py-2">Category</TableHead>
                          <TableHead className="text-meta font-bold uppercase py-2 text-right">Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {/* `checkout.bill` is now only ever a complete bill or null, so this
                            cannot be partial the way it could when the reprint path wrote here.
                            The optional chain stays as a cheap guard at what was the crash
                            site, in case the endpoint's shape ever changes. */}
                        {(checkout.bill.items ?? []).map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="py-2.5 text-xs font-bold text-slate-900">
                              {item.name}
                              {/* Why the HMO refused this one, on the line it applies to. The
                                  cashier is the person the patient asks, and until [1.27.0] the
                                  answer existed nowhere they could see — the charge simply
                                  appeared, higher than the patient had been led to expect. */}
                              {item.hmoRejected && item.hmoDecisionReason && (
                                <span className="mt-0.5 block text-fine font-normal text-rose-700">
                                  HMO refused: {item.hmoDecisionReason}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="py-2.5 text-xs text-gray-500">{item.category}</TableCell>
                            <TableCell className="py-2.5 text-xs font-bold text-slate-900 text-right">{formatCurrency(item.price)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Subtotal & HMO Breakdown Card */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200/80 space-y-2 text-xs">
                  <div className="flex justify-between items-center text-gray-600">
                    <span>Gross Services Subtotal:</span>
                    <span className="font-bold text-slate-900">{formatCurrency(checkout.bill.subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center text-gray-600">
                    {/* Renamed: this line is HMO coverage only. It used to read "HMO Coverage /
                        Discount", which was the single occurrence of the word "discount" in the
                        entire app and described something that did not exist. */}
                    <span>HMO Coverage:</span>
                    <span className="font-bold text-emerald-600">- {formatCurrency(checkout.bill.hmoCoverage || 0)}</span>
                  </div>
                  {/* A statutory sale is VAT-EXEMPT, so the 12% comes off before the 20% does.
                      Shown as its own line because the patient is comparing what they pay to
                      the shelf price, and because BIR requires a VAT-exempt sale to be
                      presented this way rather than folded into one "discount" figure. */}
                  {parseFloat(checkout.bill.vatDeducted || 0) > 0 && (
                    <>
                      <div className="flex justify-between items-center text-gray-600">
                        <span>Less VAT (12%) — VAT-exempt sale:</span>
                        <span className="font-bold text-emerald-600">- {formatCurrency(checkout.bill.vatDeducted)}</span>
                      </div>
                      <div className="flex justify-between items-center text-gray-500 pt-1 border-t border-dashed border-gray-200">
                        <span className="text-fine uppercase tracking-wide font-bold">VAT-exempt sale</span>
                        <span className="text-fine font-bold text-slate-700">{formatCurrency(checkout.bill.vatExemptSale)}</span>
                      </div>
                    </>
                  )}
                  {/* Statutory deductions must be itemised on the receipt by name and rate, not
                      folded into the total — RA 9994 / RA 10754. */}
                  {checkout.bill.discount && (
                    <div className="flex justify-between items-center text-gray-600">
                      <span>
                        {checkout.bill.discount.name} ({parseFloat(checkout.bill.discount.percentage)}%)
                        {checkout.bill.discount.idNumber && (
                          <span className="text-meta text-gray-400 font-normal"> · ID {checkout.bill.discount.idNumber}</span>
                        )}
                      </span>
                      <span className="font-bold text-emerald-600">- {formatCurrency(checkout.bill.discountAmount || 0)}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-gray-200 flex justify-between items-center text-sm font-extrabold text-slate-900">
                    <span>NET AMOUNT DUE:</span>
                    <span className="text-base text-brand-600">{formatCurrency(checkout.bill.totalAmount)}</span>
                  </div>
                </div>

                {/* Statutory discount control (Senior Citizen / PWD).
                    Deliberately sits between the bill and the payment form: the cashier checks
                    the ID against the person in front of them, and the total has to update
                    before any money is taken. */}
                <div className="bg-surface p-4 rounded-xl border border-gray-200/80 space-y-2.5">
                  <span className="field-label">Statutory / other discount</span>
                  {checkout.bill.discount ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs">
                        <BadgeCheck className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />
                        <span className="font-bold text-slate-900">{checkout.bill.discount.name}</span>
                        <span className="text-gray-500">
                          {parseFloat(checkout.bill.discount.percentage)}%
                          {checkout.bill.discount.idNumber ? ` · ID ${checkout.bill.discount.idNumber}` : ''}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={checkout.applyingDiscount}
                        onClick={checkout.removeDiscount}
                      >
                        {checkout.applyingDiscount ? 'Removing…' : 'Remove'}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Select value={checkout.discountTypeId} onValueChange={checkout.setDiscountTypeId}>
                        <SelectTrigger className="text-xs sm:w-44" aria-label="Statutory or other discount"><SelectValue placeholder="No discount" /></SelectTrigger>
                        <SelectContent>
                          {checkout.discountCatalogue.map(d => (
                            <SelectItem key={d.id} value={String(d.id)}>
                              {d.name} ({parseFloat(d.percentage)}%)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={checkout.discountIdNumber}
                        onChange={(e) => checkout.setDiscountIdNumber(e.target.value)}
                        placeholder="OSCA / PWD ID number"
                        className="text-xs flex-1"
                        aria-label="Senior Citizen or PWD ID number"
                      />
                      <Button
                        type="button"
                        disabled={!checkout.discountTypeId || checkout.applyingDiscount}
                        onClick={checkout.applyDiscount}
                        className="font-bold"
                      >
                        {checkout.applyingDiscount ? 'Applying…' : 'Apply'}
                      </Button>
                    </div>
                  )}
                  {checkout.discountError && (
                    <p role="alert" className="text-fine text-rose-600 font-semibold m-0">{checkout.discountError}</p>
                  )}
                </div>

                {/* Payment Processor Form */}
                {/* id, because the Take Payment button lives in the pinned header above and
                    reaches this form by `form="checkout-form"`. */}
                <form id="checkout-form" onSubmit={checkout.requestConfirmation} className="space-y-4">
                  {checkout.error && (
                    <div role="alert" className="alert alert-error">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{checkout.error}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="field-label">Payment method</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {COUNTER_PAYMENT_METHODS.map(method => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => checkout.setPaymentMethod(method)}
                          className={`cursor-pointer rounded-lg border px-3 py-2 text-fine font-semibold transition-colors ${
                            checkout.paymentMethod === method
                              ? 'border-brand-500 bg-brand-500 text-white'
                              : 'border-slate-200 bg-surface text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Reflects the real, per-test-approved coverage computed server-side
                      (Module 14) — an HMO-category patient is not guaranteed full coverage
                      just from their billing category alone. */}
                  {checkout.bill?.patientType === 'HMO' && (
                    parseFloat(checkout.bill.hmoCoverage) > 0 ? (
                      <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center space-x-2 text-xs font-semibold">
                        <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        <span>
                          <strong>HMO Partner Accredited</strong> — {formatCurrency(checkout.bill.hmoCoverage)} covered
                          {parseFloat(checkout.bill.hmoCoverage) >= parseFloat(checkout.bill.subtotal) ? ' (full coverage, ₱0.00 out of pocket).' : ' (partial coverage — remaining balance due).'}
                        </span>
                      </div>
                    ) : (checkout.bill.hmoPendingCount ?? 0) === 0 && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 flex items-center space-x-2 text-xs font-semibold">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        <span><strong>HMO Partner Accredited</strong> — no approved coverage yet for this visit. Full amount is due unless Reception logs an approval first.</span>
                      </div>
                    )
                  )}

                  {/* A claim nobody has answered yet. [1.27.0] Shown whatever the patient type
                      and whatever the coverage so far, because partial coverage is exactly the
                      case the green badge above used to swallow: some tests approved, others
                      still open, and the amount at stake invisible.

                      It names the figure rather than saying "some tests", because the decision
                      the cashier is making is whether that number is small enough to collect now
                      and refund later, or large enough to be worth chasing the provider first.
                      Not a block — some providers take days, and the patient cannot wait at the
                      counter for one. */}
                  {(checkout.bill?.hmoPendingCount ?? 0) > 0 && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 flex items-start space-x-2 text-xs">
                      <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <span>
                        <strong>
                          {checkout.bill.hmoPendingCount} test{checkout.bill.hmoPendingCount > 1 ? 's' : ''} still
                          awaiting an HMO decision — {formatCurrency(checkout.bill.hmoPendingAmount)}
                        </strong>
                        <span className="block font-normal mt-0.5">
                          That amount is billed in full here. If the HMO approves it afterwards,
                          the patient has to come back for a refund.
                        </span>
                      </span>
                    </div>
                  )}

                  {checkout.paymentMethod === 'Cash' ? (
                    <div className="space-y-2 bg-surface p-3 rounded-xl border border-gray-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label htmlFor="cashierdashboard-cash-tendered" className="field-label">Cash tendered</label>
                          <Input id="cashierdashboard-cash-tendered"
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={checkout.amountTendered}
                            onChange={e => checkout.setAmountTendered(e.target.value)}
                            className="text-sm font-bold"
                            required
                          />
                        </div>
                        <div className="space-y-1 bg-gray-50 p-2 rounded-lg border border-line">
                          <span className="field-label">Change Due</span>
                          <span className="text-base font-extrabold text-emerald-600">{formatCurrency(checkout.changeDue())}</span>
                        </div>
                      </div>

                      {/* Quick Cash Presets */}
                      <div className="flex items-center space-x-1.5 pt-1">
                        <span className="text-meta font-extrabold text-slate-400 uppercase mr-1">Presets:</span>
                        {['100', '500', '1000'].map(val => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => checkout.setAmountTendered(val)}
                            className="px-2 py-0.5 bg-slate-100 hover:bg-brand-500 hover:text-white rounded-md text-meta font-bold text-slate-700 transition-all border border-slate-200 cursor-pointer"
                          >
                            ₱{val}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => checkout.setAmountTendered((checkout.bill?.totalAmount ?? 0).toString())}
                          className="px-2 py-0.5 bg-brand-50 text-brand-600 hover:bg-brand-500 hover:text-white rounded-md text-meta font-bold transition-all border border-brand-300 cursor-pointer"
                        >
                          Exact
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label htmlFor="cashierdashboard-transaction-reference" className="field-label">Transaction reference</label>
                      <Input id="cashierdashboard-transaction-reference"
                        placeholder={`Enter ${checkout.paymentMethod} reference code`}
                        value={checkout.referenceNumber}
                        onChange={e => checkout.setReferenceNumber(e.target.value)}
                        className="text-xs rounded-xl"
                        required
                      />
                    </div>
                  )}

                </form>
                </div>
              </div>
            ) : (
              /* Nothing selected. The prompt is still the answer to "what do I do", and the
                 shift summary beneath it is what a cashier would otherwise open Transaction
                 History to find. */
              <ShiftSummaryPanel queue={queue} />
            )}
          </Panel>
        </div>
  );
}
