import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, MailCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SkeletonList } from '../ui/skeleton';
import api from '../../config/api';
import { formatDate } from '../../lib/date';
import { toastSuccess } from '../../lib/toast';

/**
 * Give a patient's record to a portal account, by invitation. [1.136.0]
 *
 * It replaced "Link to a portal account" [1.123.0], which joined a record to an account on the
 * desk's word alone. Now the desk sends an invitation to an address it has checked with the patient,
 * says whose address it is and who agreed, and the person at that address accepts the record in the
 * portal with its date of birth.
 *
 * Who agrees follows the PATIENT's age, never the helper's:
 *   under 18     their parent or guardian, at the patient's own address or the guardian's
 *   18 or over   their own address needs nothing more; a family member's needs the patient's own
 *                yes, here or by phone, or that family member is responsible for a patient who
 *                cannot decide
 *
 * The dialog draws itself from the server's `state` (GET /patients/:id/portal-access), so it never
 * offers a button the server would refuse.
 */
const FAMILY = [
  ['parent_guardian', 'Parent or guardian'],
  ['child', 'Son or daughter'],
  ['grandchild', 'Grandchild'],
  ['spouse', 'Husband or wife'],
  ['sibling', 'Brother or sister'],
  ['other_family', 'Other family member'],
  ['caregiver', 'Caregiver'],
];
const ADULT_AGREED = [
  ['patient_in_person', 'The patient said yes, here at the clinic'],
  ['patient_by_phone', 'The patient said yes by phone (name and birthdate checked)'],
  ['responsible_for_patient', 'The patient cannot decide; this family member is responsible for them'],
];

const STATE_LINE = {
  expired: (inv) => `The invitation sent to ${inv.email} on ${formatDate(inv.sentAt)} ran out unused.`,
  not_delivered: (inv) => `The invitation to ${inv.email} could not be emailed, so it was not sent.`,
  declined: (inv) => `${inv.email} said this record is not someone they know.`,
  birthdate_locked: (inv) => `The invitation to ${inv.email} was locked after three wrong dates of birth.`,
  withdrawn: (inv) => `The invitation to ${inv.email} was withdrawn.`,
};

const blankForm = (email) => ({
  email: email || '', whose: 'self', recipientName: '', relationship: '', consentBasis: '', agreed: false,
});

export default function PortalAccessDialog({ open, onOpenChange, patientId, patientName, canInvite, onChanged }) {
  const [access, setAccess] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(blankForm(''));
  const [composing, setComposing] = useState(false);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get(`/patients/${patientId}/portal-access`);
      const data = res.data.data;
      setAccess(data);
      setForm(blankForm(data.patient.email));
      // Straight to the form when there is nothing waiting to look after.
      setComposing(!['pending', 'expired', 'linked', 'archived'].includes(data.state));
      return data;
    } catch (err) {
      setLoadError(err.response?.data?.message || "This record's portal access could not be loaded.");
      return null;
    }
  }, [patientId]);

  useEffect(() => {
    if (!open) return;
    setAccess(null);
    setCheck(null);
    setError('');
    load();
  }, [open, load]);

  const minor = Boolean(access?.patient.isMinor);
  const forSelf = form.whose === 'self';
  const consentBasis = minor ? 'guardian_of_minor' : forSelf ? 'own_address' : form.consentBasis;
  const relationship = forSelf ? 'self' : minor ? 'parent_guardian' : form.relationship;
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value, agreed: key === 'agreed' ? value : false }));

  // What the desk should know about the address before sending: a staff account, an account that
  // already exists, and how many profiles it holds (a family manager's inbox, not the patient's).
  const address = form.email.trim().toLowerCase();
  useEffect(() => {
    if (!open || !composing || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setCheck(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      api.post(`/patients/${patientId}/invitations/check`, { email: address })
        .then((res) => setCheck(res.data.data))
        .catch(() => setCheck(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [open, composing, address, patientId]);

  const ready = Boolean(address)
    && !check?.staffAccount
    && Boolean(relationship) && Boolean(consentBasis)
    && (forSelf || form.recipientName.trim())
    && form.agreed;

  // Said to whoever agrees: the patient (here or by phone), their parent or guardian, or the
  // family member responsible for them. "Your visits" only when it is the patient listening.
  const sayingTo = minor
    ? 'their parent or guardian'
    : forSelf
      ? `${patientName}, here or by phone`
      : form.consentBasis === 'responsible_for_patient'
        ? (form.recipientName.trim() || 'the family member responsible for them')
        : form.consentBasis === 'patient_by_phone'
          ? `${patientName}, by phone`
          : patientName;
  const whose = forSelf && !minor ? 'your' : `${patientName}'s`;
  const readBack = `"Whoever signs in with ${address || 'this address'} will see ${whose} visits, reports and receipts online, including the ones from before today. Is that all right?"`;

  const act = async (kind, request, success) => {
    setBusy(kind);
    setError('');
    try {
      const res = await request();
      toastSuccess(success(res.data), res.data.data?.delivery === 'suppressed' ? 'A test address: nothing was emailed.' : undefined);
      const fresh = await load();
      onChanged?.(fresh);
    } catch (err) {
      setError(err.response?.data?.message || 'That did not work. Try again.');
    } finally {
      setBusy('');
    }
  };

  const send = (e) => {
    e.preventDefault();
    if (!ready) return;
    act('send', () => api.post(`/patients/${patientId}/invitations`, {
      email: address,
      relationship,
      recipientName: forSelf ? undefined : form.recipientName.trim(),
      consentBasis,
      confirmed: true,
    }), () => `Invitation for ${patientName} sent to ${address}`);
  };

  const inv = access?.invitation;
  const state = access?.state;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg" data-testid="portal-access" data-state={state || 'loading'}>
        <DialogHeader>
          <DialogTitle>Portal access</DialogTitle>
          <DialogDescription>
            {patientName} can see their visits, released reports and receipts online. We email an
            invitation; the person at that address signs up or signs in, and confirms the record with
            {` ${patientName}`}&apos;s date of birth.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <div role="alert" className="alert alert-error">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{loadError}</span>
            <Button size="sm" variant="outline" onClick={load}>Try again</Button>
          </div>
        ) : !access ? (
          <SkeletonList rows={2} />
        ) : (
          <div className="space-y-3">
            {state === 'linked' && (
              <p className="m-0 flex items-start gap-2 text-note text-slate-700" data-testid="portal-access-linked">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" aria-hidden="true" />
                <span>
                  In the portal account of <strong>{access.account.name}</strong> ({access.account.email})
                  {access.account.relationshipLabel ? `, as ${access.account.relationshipLabel.toLowerCase()}` : ''}.
                </span>
              </p>
            )}
            {state === 'archived' && (
              <p className="m-0 text-note text-slate-600">This record is archived. Restore it before inviting anyone to it.</p>
            )}

            {(state === 'pending' || state === 'expired') && inv && (
              <div className="space-y-2 rounded-lg border border-line bg-slate-50 p-3" data-testid="portal-access-pending">
                <p className="m-0 flex items-start gap-2 text-note text-slate-800">
                  <MailCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-azure-600" aria-hidden="true" />
                  <span>
                    {state === 'pending'
                      ? <>Invitation sent to <strong>{inv.email}</strong> on {formatDate(inv.lastSentAt)}. Works until {formatDate(inv.expiresAt)}.</>
                      : STATE_LINE.expired(inv)}
                  </span>
                </p>
                <p className="m-0 text-fine text-slate-500">
                  {inv.relationship === 'self' ? "The patient's own address." : `${inv.recipientName}, ${inv.relationshipLabel.toLowerCase()}.`}
                  {' '}{inv.consentLabel}.{inv.invitedBy ? ` Sent by ${inv.invitedBy}.` : ''}
                </p>
                {canInvite && !access.blockedForYou && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy === 'resend'}
                      disabled={!access.canResend || Boolean(busy)}
                      onClick={() => act('resend', () => api.post(`/patients/${patientId}/invitations/resend`),
                        () => `Invitation sent to ${inv.email} again`)}
                    >
                      Send again
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy === 'withdraw'}
                      disabled={Boolean(busy)}
                      onClick={() => act('withdraw', () => api.delete(`/patients/${patientId}/invitations/open`),
                        () => `Invitation to ${inv.email} withdrawn`)}
                    >
                      Withdraw invitation
                    </Button>
                    {!composing && (
                      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setComposing(true)}>
                        Use another address
                      </Button>
                    )}
                  </div>
                )}
                {canInvite && !access.canResend && state === 'pending' && (
                  <p className="m-0 text-meta text-slate-500">
                    {access.sendsLeft === 0
                      ? 'It has been sent as many times as it can be. Withdraw it and send a new one.'
                      : 'Sent a moment ago. It can be sent again in a minute.'}
                  </p>
                )}
              </div>
            )}

            {STATE_LINE[state] && state !== 'expired' && inv && (
              <p className="m-0 text-fine text-slate-600">{STATE_LINE[state](inv)}</p>
            )}

            {canInvite && access.blockedForYou && state !== 'linked' && (
              <p className="alert alert-info m-0" data-testid="portal-access-blocked">
                <Info className="h-4 w-4 flex-shrink-0" />
                <span>You unlinked this record recently, so another member of staff sends its next invitation.</span>
              </p>
            )}

            {canInvite && composing && !access.blockedForYou && state !== 'linked' && state !== 'archived' && (
              <form id="portal-access-form" onSubmit={send} className="space-y-3" noValidate>
                <div className="space-y-1.5">
                  <label htmlFor="portal-access-email" className="field-label">Email address</label>
                  <Input
                    id="portal-access-email"
                    type="email"
                    autoComplete="off"
                    value={form.email}
                    onChange={(e) => set('email')(e.target.value)}
                    disabled={Boolean(busy)}
                  />
                  {!access.patient.email && (
                    <p className="m-0 text-meta text-slate-500">Saved to {patientName}&apos;s record too, so released reports can be emailed there.</p>
                  )}
                </div>

                <fieldset className="space-y-1.5" data-testid="portal-access-whose">
                  <legend className="field-label">Whose address is this?</legend>
                  <label className="flex items-center gap-2 text-note text-slate-800">
                    <input type="radio" name="whose" checked={forSelf} onChange={() => set('whose')('self')} />
                    {patientName}&apos;s own
                  </label>
                  <label className="flex items-center gap-2 text-note text-slate-800">
                    <input type="radio" name="whose" checked={!forSelf} onChange={() => set('whose')('family')} />
                    {minor ? 'Their parent or guardian' : 'A family member who manages their records'}
                  </label>
                </fieldset>

                {!forSelf && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="portal-access-name" className="field-label">Their name</label>
                      <Input
                        id="portal-access-name"
                        value={form.recipientName}
                        onChange={(e) => set('recipientName')(e.target.value)}
                        disabled={Boolean(busy)}
                      />
                    </div>
                    {!minor && (
                      <div className="space-y-1.5">
                        <label htmlFor="portal-access-relationship" className="field-label">They are the patient&apos;s</label>
                        <Select value={form.relationship} onValueChange={set('relationship')} disabled={Boolean(busy)}>
                          <SelectTrigger id="portal-access-relationship"><SelectValue placeholder="Choose" /></SelectTrigger>
                          <SelectContent>
                            {FAMILY.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                {minor ? (
                  <p className="m-0 text-fine text-slate-600">
                    {patientName} is under 18, so their parent or guardian agrees for them.
                  </p>
                ) : !forSelf && (
                  <fieldset className="space-y-1.5">
                    <legend className="field-label">Who agreed?</legend>
                    {ADULT_AGREED.map(([value, label]) => (
                      <label key={value} className="flex items-start gap-2 text-note text-slate-800">
                        <input
                          type="radio"
                          name="consent"
                          className="mt-1"
                          checked={form.consentBasis === value}
                          onChange={() => set('consentBasis')(value)}
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                )}

                {check?.staffAccount && (
                  <p role="alert" className="alert alert-error m-0">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>That address belongs to a staff account. Use an address of the patient or their family.</span>
                  </p>
                )}
                {check?.accountExists && !check.staffAccount && (
                  <p className="alert alert-info m-0" data-testid="portal-access-account-exists">
                    <Info className="h-4 w-4 flex-shrink-0" />
                    <span>
                      An account already uses this address. They sign in and accept the record there.
                      {forSelf && check.profilesOnAddress > 0
                        ? ` It already holds ${check.profilesOnAddress} profile${check.profilesOnAddress === 1 ? '' : 's'}. Is it really ${patientName}'s own?`
                        : ''}
                    </span>
                  </p>
                )}

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="portal-access-readback">
                  <p className="m-0 text-fine font-semibold text-amber-900">
                    {forSelf && !minor ? 'Confirm with' : 'Read this to'} {sayingTo}:
                  </p>
                  <p className="m-0 mt-1 text-note text-amber-900">{readBack}</p>
                  <label className="mt-2 flex items-center gap-2 text-note font-semibold text-amber-900">
                    <input
                      type="checkbox"
                      data-testid="portal-access-agreed"
                      checked={form.agreed}
                      onChange={(e) => set('agreed')(e.target.checked)}
                    />
                    They said yes
                  </label>
                </div>
              </form>
            )}

            {error && (
              <div role="alert" className="alert alert-error">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={Boolean(busy)}>Close</Button>
          {canInvite && composing && access && !access.blockedForYou && state !== 'linked' && state !== 'archived' && (
            <Button type="submit" form="portal-access-form" loading={busy === 'send'} disabled={!ready || Boolean(busy)}>
              Send invitation
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
