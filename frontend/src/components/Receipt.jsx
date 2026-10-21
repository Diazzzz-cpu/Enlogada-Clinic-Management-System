import React from 'react';
import { useClinic, hasStatutoryIdentity, isSampleIdentity, isVatRegistered } from '../lib/clinic';
import { formatCurrency } from '../lib/currency';

/**
 * The document the patient walks out with.
 *
 * ── What was wrong with the previous one ──────────────────────────────────────────────────────
 * It printed. That was about the extent of it. Three problems, in rising order of seriousness:
 *
 *  1. The action buttons sat INSIDE `.print-area`, so "Print Receipt" printed its own button.
 *     The print rule in index.css hides `body *` and reveals only `.print-area` and its
 *     descendants — put the toolbar in there and the toolbar comes out of the printer.
 *
 *  2. It carried no date, no time, no cashier, no visit reference, no clinic address, no contact
 *     details, and — for a cash sale — neither the amount tendered nor the change given. A
 *     receipt with no date is not a receipt; it is a note saying a number.
 *
 *  3. It reconciled its own arithmetic from `paymentSuccess.amount + discount + vat` but never
 *     showed the reader how, so a patient checking whether the senior discount was actually
 *     applied had to do the subtraction themselves.
 *
 * ── Deliberately not claiming to be a BIR Official Receipt ────────────────────────────────────
 * It says "Payment Receipt", and prints a line saying it is not a BIR-registered Official
 * Receipt, until the clinic is genuinely authorised to issue one. Fabricating a TIN or an OR
 * series to make the document look official would produce a false record that a patient might
 * file for reimbursement.
 *
 * The upgrade is keyed to the **permit** — the Authority to Print, or the Permit to Use for a
 * computerised system — and NOT to the TIN. That distinction is the whole point: a TIN identifies
 * the taxpayer, it does not authorise anyone to issue an official receipt, so a registered clinic
 * with no ATP/PTU still cannot. Keying it to the TIN, as this once did, would print "Official
 * Receipt" on a document that is not one.
 *
 * Set CLINIC_TIN and CLINIC_PERMIT in **backend/.env** (not the frontend — see lib/clinic.js for
 * why that moved), restart the backend, and the wording upgrades itself. Placeholder values are
 * detected and print a "sample configuration" band instead.
 *
 * ── Why 80mm ──────────────────────────────────────────────────────────────────────────────────
 * Clinic counters print to thermal roll, not A4. The @page rule in index.css sizes the sheet to
 * 80mm so the output is not one narrow column stranded at the top-left of a portrait page.
 */

const Row = ({ label, value, strong = false, tone = 'default', small = false }) => (
  <div className={`flex items-baseline justify-between gap-3 ${small ? 'text-micro' : 'text-meta'}`}>
    <span className={strong ? 'font-bold text-slate-900' : 'text-slate-500'}>{label}</span>
    <span
      className={`tabular-nums ${
        strong ? 'font-bold text-slate-900' : tone === 'credit' ? 'font-semibold text-slate-700' : 'font-medium text-slate-800'
      }`}
    >
      {value}
    </span>
  </div>
);

const Rule = ({ dashed = false }) => (
  <div className={`my-2 border-t ${dashed ? 'border-dashed border-slate-300' : 'border-slate-300'}`} />
);

/**
 * @param payment  the payments row as returned by the API (the snapshot, not the live catalogue —
 *                 a reprint years later must show what was actually granted at the time)
 * @param bill     the itemised bill this payment settled
 * @param cashier  who took the money; a receipt with no attribution cannot be queried later
 * @param tendered / change  cash only, and only meaningful at the moment of sale
 * @param reprint  stamps the copy, so an original and a duplicate are distinguishable
 */
const Receipt = ({ payment, bill, cashier, tendered, change, reprint = false }) => {
  // Fetched at runtime so the clinic can set its TIN without rebuilding the frontend; falls back
  // to the built-in name and address if the API is unreachable. See lib/clinic.js.
  const CLINIC = useClinic();
  if (!payment) return null;

  const paidAt = payment.paid_at ? new Date(payment.paid_at) : new Date();
  const discount = parseFloat(payment.discount_amount || 0);
  const vat = parseFloat(payment.vat_amount || 0);
  const net = parseFloat(payment.amount || 0);
  // The receipt reconciles from the payment row alone, so it stays correct even if the bill
  // object is unavailable on a reprint: amount + discount + vat === the VAT-inclusive gross.
  const gross = net + discount + vat;
  const isCash = payment.payment_method === 'Cash';

  const sampleIdentity = isSampleIdentity(CLINIC);

  return (
    <div className="paper print-area mx-auto w-full max-w-[20rem] bg-white p-4 font-sans text-slate-900">
      {/* Sample configuration, said before anything else and impossible to miss.
          The sample block exists so the layout can be reviewed with every field populated, which
          means at some point a real receipt will be printed from a machine still carrying it. The
          band is what makes that harmless: the document says what it is at the top, and prints
          that way too — it is inside .print-area, not marked no-print. */}
      {sampleIdentity && (
        <div className="mb-2 border-2 border-dashed border-rose-400 px-2 py-1 text-center">
          <p className="m-0 text-micro font-extrabold uppercase tracking-widest text-rose-600">
            Sample configuration
          </p>
          <p className="m-0 text-nano leading-snug text-rose-600">
            Placeholder TIN / permit. Not valid for issue to a patient.
          </p>
        </div>
      )}

      <header className="text-center">
        <h2 className="m-0 text-note font-extrabold uppercase tracking-wide">{CLINIC.shortName}</h2>
        <p className="m-0 text-micro font-semibold uppercase tracking-wide text-slate-600">
          Ultrasound &amp; Diagnostic Clinic
        </p>
        <p className="m-0 mt-1 text-micro leading-snug text-slate-500">{CLINIC.address}</p>
        <p className="m-0 text-micro leading-snug text-slate-500">
          {CLINIC.phone} · {CLINIC.email}
        </p>
        {/* Printed whenever set, independent of whether this qualifies as an Official Receipt —
            the TIN identifies the taxpayer, and a patient claiming reimbursement wants to see it
            either way. What it does NOT do on its own is authorise the wording below. */}
        {/* A sole proprietorship's receipts name the person behind the trade name, as the
            clinic's own booklet does ("JESIE B. ENLOGADA - Prop."). */}
        {CLINIC.proprietor && (
          <p className="m-0 text-micro text-slate-500">{CLINIC.proprietor} &mdash; Prop.</p>
        )}
        {/* The Non-VAT designation travels WITH the TIN rather than sitting elsewhere, because
            that is how it appears on the registered booklet — "Non VAT Reg. TIN: ..." — and
            because the two facts are only meaningful together. */}
        {CLINIC.tin && (
          <p className="m-0 text-micro font-semibold text-slate-600">
            {isVatRegistered(CLINIC) ? 'TIN' : 'Non-VAT Reg. TIN'} {CLINIC.tin}
          </p>
        )}
        {CLINIC.businessPermit && (
          <p className="m-0 text-micro text-slate-600">ATP/PTU {CLINIC.businessPermit}</p>
        )}
        {CLINIC.accreditation && (
          <p className="m-0 text-micro text-slate-600">PhilHealth {CLINIC.accreditation}</p>
        )}
      </header>

      <Rule />

      <p className="m-0 text-center text-meta font-bold uppercase tracking-[0.12em]">
        {hasStatutoryIdentity(CLINIC) ? 'Official Receipt' : 'Payment Receipt'}
      </p>
      {reprint && (
        <p className="m-0 mt-0.5 text-center text-micro font-bold uppercase tracking-widest text-rose-600">
          Reprint — duplicate copy
        </p>
      )}

      <Rule dashed />

      <div className="space-y-0.5">
        <Row label="Receipt No." value={payment.receipt_number || `OR-${payment.id}`} strong />
        <Row label="Date" value={paidAt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })} />
        <Row label="Time" value={paidAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true })} />
        {bill?.patientName && <Row label="Patient" value={bill.patientName} />}
        {bill?.queueNumber && <Row label="Queue" value={bill.queueNumber} />}
        {cashier && <Row label="Cashier" value={cashier} />}
      </div>

      <Rule dashed />

      {bill?.items?.length > 0 && (
        <>
          <p className="m-0 mb-1 text-micro font-bold uppercase tracking-wider text-slate-500">Services</p>
          <div className="space-y-0.5">
            {bill.items.map((item, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 text-meta">
                <span className="min-w-0 flex-1 truncate text-slate-700">{item.name}</span>
                <span className="tabular-nums font-medium">{formatCurrency(item.price)}</span>
              </div>
            ))}
          </div>
          <Rule dashed />
        </>
      )}

      <div className="space-y-0.5">
        <Row label="Gross amount" value={formatCurrency(gross)} />

        {/* The statutory ladder, itemised by name and rate rather than folded into one figure —
            RA 9994 / RA 10754. The receipt is the patient's evidence the mandated deduction was
            given, and the clinic's evidence for claiming it back. VAT comes off FIRST: the sale
            is VAT-exempt, so the 20% applies to the VAT-exempt base, not the shelf price. */}
        {vat > 0 && (
          <>
            <Row label="Less VAT (12%)" value={`- ${formatCurrency(vat)}`} tone="credit" />
            <Row label="VAT-exempt sale" value={formatCurrency(net + discount)} />
          </>
        )}
        {discount > 0 && (
          <>
            <Row
              label={`${payment.discount_type_name || 'Discount'} (20%)`}
              value={`- ${formatCurrency(discount)}`}
              tone="credit"
            />
            {payment.discount_id_number && (
              <Row small label="ID presented" value={payment.discount_id_number} />
            )}
          </>
        )}
        {parseFloat(bill?.hmoCoverage || 0) > 0 && (
          <Row label="HMO coverage" value={`- ${formatCurrency(bill.hmoCoverage)}`} tone="credit" />
        )}
      </div>

      <Rule />

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-fine font-extrabold uppercase tracking-wide">Amount paid</span>
        <span className="text-lead font-extrabold tabular-nums">{formatCurrency(net)}</span>
      </div>

      <Rule dashed />

      <div className="space-y-0.5">
        <Row label="Payment method" value={payment.payment_method} />
        {payment.reference_number && <Row label="Reference" value={payment.reference_number} />}
        {/* Cash tendered and change belong on the receipt: they are the two figures a patient
            checks at the counter, and the previous version showed neither. Only rendered at the
            point of sale — a reprint has no record of what was handed over. */}
        {isCash && tendered != null && (
          <>
            <Row label="Cash tendered" value={formatCurrency(tendered)} />
            <Row label="Change" value={formatCurrency(change || 0)} strong />
          </>
        )}
      </div>

      <Rule />

      <footer className="space-y-1 text-center">
        <p className="m-0 text-micro leading-snug text-slate-600">
          Thank you. Please keep this receipt — it is required for claiming
          your results.
        </p>
        {/* Required on a non-VAT establishment's invoice, and printed on the clinic's own
            booklet in these words. Without it a patient or their employer may try to claim input
            tax against a document that cannot support it. Independent of the Official Receipt
            question below: this is about VAT status, that is about authority to issue. */}
        {!isVatRegistered(CLINIC) && (
          <p className="m-0 text-nano font-semibold uppercase tracking-wide text-slate-500">
            This document is not valid for claiming input taxes.
          </p>
        )}
        {!hasStatutoryIdentity(CLINIC) && (
          // Said plainly rather than dressed up. A document that looks like a BIR Official
          // Receipt but is not one is worse than one that admits what it is.
          //
          // Reached when the TIN is missing, when the ATP/PTU is missing, or when either is still
          // a placeholder — a registered taxpayer without an authority to print cannot issue an
          // Official Receipt, so a TIN alone is not enough to drop this line.
          <p className="m-0 text-nano leading-snug text-slate-400">
            This is a payment acknowledgement, not a BIR-registered Official Receipt.
          </p>
        )}
        <p className="m-0 text-nano text-slate-400">
          Printed {new Date().toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
        </p>
      </footer>
    </div>
  );
};

export default Receipt;
