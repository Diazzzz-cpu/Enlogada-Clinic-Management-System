import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { AlertCircle, QrCode } from 'lucide-react';
import { METHOD_KINDS } from '../../hooks/usePaymentMethodAdmin';

/**
 * Adding or editing an account patients pay into.
 *
 * The account number is echoed back in large tabular figures as it is typed. That is the whole
 * safeguard against the failure this screen can cause: a mistyped digit produces no error
 * anywhere — the money simply goes somewhere else — so the only defence is making it easy to read
 * back against the bank app it was copied from.
 */
export default function PaymentMethodFormDialog({ paymentMethods }) {
  const { form, editing, submitting, modalError, qrFile } = paymentMethods;
  const isBank = form.kind === 'Bank';

  return (
    <Dialog open={paymentMethods.showModal} onOpenChange={(open) => { if (!open) paymentMethods.close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.label}` : 'New Payment Method'}</DialogTitle>
          <DialogDescription>
            Patients see this when they settle a booking online, and send money to the number below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={paymentMethods.submit} className="space-y-4">
          {modalError && (
            <div role="alert" className="alert alert-error">
              <AlertCircle />
              <span>{modalError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
            <div>
              <label htmlFor="pm-kind" className="field-label">Settles as</label>
              <select
                id="pm-kind"
                value={form.kind}
                onChange={(e) => paymentMethods.setField('kind', e.target.value)}
                disabled={submitting}
                className="flex h-9 w-full cursor-pointer rounded-lg border border-slate-200 bg-surface px-3 text-note text-slate-900 transition-colors hover:border-slate-300 focus-visible:border-azure-400 focus-visible:ring-4 focus-visible:ring-azure-500/12"
              >
                {METHOD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              {/* Says why the choice is not free text. */}
              <p className="m-0 mt-1 text-fine leading-snug text-slate-500">
                Which cash-up total it lands in.
              </p>
            </div>
            <div>
              <label htmlFor="pm-label" className="field-label">Label the patient sees</label>
              <Input
                id="pm-label"
                value={form.label}
                onChange={(e) => paymentMethods.setField('label', e.target.value)}
                placeholder={isBank ? 'BPI Savings' : 'GCash — Enlogada Clinic'}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pm-number" className="field-label">
                {isBank ? 'Account number' : 'Mobile number'}
              </label>
              <Input
                id="pm-number"
                value={form.accountNumber}
                onChange={(e) => paymentMethods.setField('accountNumber', e.target.value)}
                placeholder={isBank ? '1234-5678-90' : '09XX XXX XXXX'}
                disabled={submitting}
                className="font-mono tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="pm-name" className="field-label">Account name</label>
              <Input
                id="pm-name"
                value={form.accountName}
                onChange={(e) => paymentMethods.setField('accountName', e.target.value)}
                placeholder="Jesie B. Enlogada"
                disabled={submitting}
              />
            </div>
          </div>

          {isBank && (
            <div>
              <label htmlFor="pm-bank" className="field-label">Bank</label>
              <Input
                id="pm-bank"
                value={form.bankName}
                onChange={(e) => paymentMethods.setField('bankName', e.target.value)}
                placeholder="BPI"
                disabled={submitting}
              />
            </div>
          )}

          {/* Read back at size. A wrong digit here is silent, so this is the check. */}
          {form.accountNumber.trim() && (
            <div className="rounded-lg bg-sunken px-3 py-2.5">
              <p className="m-0 text-micro font-semibold uppercase tracking-[0.1em] text-slate-500">
                Patients will send money to
              </p>
              <p className="m-0 mt-1 font-mono text-lg font-bold tabular-nums tracking-wide text-slate-900">
                {form.accountNumber}
              </p>
              {form.accountName.trim() && (
                <p className="m-0 text-fine text-slate-600">{form.accountName}</p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="pm-instructions" className="field-label">
              Instructions <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <Textarea
              id="pm-instructions"
              rows={2}
              value={form.instructions}
              onChange={(e) => paymentMethods.setField('instructions', e.target.value)}
              placeholder="Use the patient's full name as the message."
              disabled={submitting}
            />
          </div>

          <div>
            <label htmlFor="pm-qr" className="field-label">
              QR image <span className="font-normal text-slate-400">(optional — patients scan it instead of typing the number)</span>
            </label>
            <input
              id="pm-qr"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => paymentMethods.setQrFile(e.target.files?.[0] || null)}
              disabled={submitting}
              className="block w-full cursor-pointer rounded-lg border border-slate-200 bg-surface p-2 text-fine text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-fine file:font-semibold file:text-slate-700"
            />
            {qrFile && (
              <p className="m-0 mt-1 flex items-center gap-1.5 text-fine font-semibold text-brand-700">
                <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                {qrFile.name} will be uploaded
              </p>
            )}
            {editing?.has_qr && !qrFile && (
              <p className="m-0 mt-1 text-fine text-slate-500">
                A QR image is already saved. Choosing a file replaces it.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={paymentMethods.close} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {editing ? 'Save changes' : 'Add method'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
