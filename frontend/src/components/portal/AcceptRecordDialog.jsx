import React, { useEffect, useState } from 'react';
import { AlertCircle, MailCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { DateField, BIRTHDATE_YEAR_RANGE } from '../ui/date-field';
import CodeInput, { CODE_LENGTH } from '../auth/CodeInput';
import api from '../../config/api';
import { formatDate, todayStr } from '../../lib/date';
import { toastSuccess } from '../../lib/toast';

/**
 * Accepting a record the clinic invited this account to. [1.136.0]
 *
 * Two steps, the first only when needed:
 *   1. An account that never proved its address (one made before codes, or a seed) confirms it
 *      with a 6-digit code. Until then the portal does not even say whose record is waiting.
 *   2. The record's date of birth, as the clinic has it. Three wrong tries end the invitation.
 *
 * `invitation` is one from GET /patients/invitations/mine, or `{ emailCheck: true }` for step 1 on
 * its own. A duplicate of a profile already on the account is said, and can be added anyway.
 */
export default function AcceptRecordDialog({ invitation, onOpenChange, onAccepted, onChanged }) {
  const open = Boolean(invitation);
  const emailOnly = Boolean(invitation?.emailCheck);
  const [birthdate, setBirthdate] = useState('');
  const [ticket, setTicket] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState(null);
  const [declining, setDeclining] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBirthdate('');
    setTicket(null);
    setCode('');
    setError('');
    setDuplicate(null);
  }, [open, invitation?.id]);

  const sendCode = async () => {
    setBusy('code');
    setError('');
    try {
      const res = await api.post('/auth/email-check');
      if (res.data.data.alreadyVerified) {
        onChanged?.();
        return;
      }
      setTicket(res.data.data.ticket);
    } catch (err) {
      setError(err.response?.data?.message || "We couldn't send a code. Try again in a minute.");
    } finally {
      setBusy('');
    }
  };

  const confirmCode = async (value = code) => {
    if (value.length !== CODE_LENGTH) return;
    setBusy('confirm');
    setError('');
    try {
      await api.post('/auth/email-check/confirm', { ticket, code: value });
      toastSuccess('Your email address is confirmed');
      onChanged?.();
      onOpenChange(false);
    } catch (err) {
      setError(err.response?.data?.message || "That code didn't work.");
    } finally {
      setBusy('');
    }
  };

  const accept = async (keepBoth = false) => {
    setBusy('accept');
    setError('');
    try {
      const res = await api.post(`/patients/invitations/${invitation.id}/accept`, { birthdate, keepBoth });
      toastSuccess(res.data.message);
      onAccepted?.(res.data.data.patientId);
      onOpenChange(false);
    } catch (err) {
      const details = err.response?.data?.details;
      if (err.response?.status === 409 && details?.possibleDuplicate) {
        setDuplicate(err.response.data.message);
      } else {
        setError(err.response?.data?.message || "The record couldn't be added.");
        // An ended invitation (410) disappears from the list.
        if (err.response?.status === 410) onChanged?.();
      }
    } finally {
      setBusy('');
    }
  };

  const decline = async () => {
    setBusy('decline');
    try {
      await api.post(`/patients/invitations/${invitation.id}/decline`);
      toastSuccess('Thanks. The clinic will see that it was not for you.');
      setDeclining(false);
      onChanged?.();
      onOpenChange(false);
    } catch (err) {
      setError(err.response?.data?.message || 'That did not work. Try again.');
      setDeclining(false);
    } finally {
      setBusy('');
    }
  };

  const whose = invitation?.forSelf ? 'Your' : `${invitation?.patientName}'s`;

  return (
    <>
      <Dialog open={open && !declining} onOpenChange={(o) => !busy && onOpenChange(o)}>
        <DialogContent className="max-w-md" data-testid="accept-record">
          {emailOnly ? (
            <>
              <DialogHeader>
                <DialogTitle>Confirm your email address</DialogTitle>
                <DialogDescription>
                  The clinic has a record waiting for this account. Confirm this is your address to see it.
                </DialogDescription>
              </DialogHeader>
              {ticket ? (
                <div className="space-y-2 py-1">
                  <label htmlFor="email-check-code" className="field-label">Code from the email</label>
                  <CodeInput
                    id="email-check-code"
                    value={code}
                    onChange={setCode}
                    onComplete={confirmCode}
                    disabled={busy === 'confirm'}
                    invalid={Boolean(error)}
                    autoFocus
                  />
                </div>
              ) : (
                <p className="m-0 flex items-start gap-2 text-note text-ink-muted">
                  <MailCheck className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  We&apos;ll email you a 6-digit code.
                </p>
              )}
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Add {invitation?.patientName} to your account</DialogTitle>
                <DialogDescription>
                  {invitation?.forSelf
                    ? 'The clinic invited you to see your own record here.'
                    : `The clinic invited this account to see ${invitation?.patientName}'s record, as their ${invitation?.relationshipLabel?.toLowerCase()}.`}
                  {invitation?.forSelf
                    ? ' Your visits, reports and receipts will appear here, including earlier ones.'
                    : ' Their visits, reports and receipts will appear under their name, including earlier ones.'}
                  {invitation?.expiresAt ? ` This invitation works until ${formatDate(invitation.expiresAt)}.` : ''}
                </DialogDescription>
              </DialogHeader>
              {duplicate ? (
                <p className="alert alert-warning m-0" data-testid="accept-duplicate">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{duplicate}</span>
                </p>
              ) : (
                <div className="space-y-1.5 py-1">
                  <label htmlFor="accept-birthdate" className="field-label">{whose} date of birth</label>
                  <DateField
                    id="accept-birthdate"
                    data-testid="accept-birthdate"
                    value={birthdate}
                    onChange={(e) => setBirthdate(e.target.value)}
                    max={todayStr()}
                    yearRange={BIRTHDATE_YEAR_RANGE}
                    disabled={Boolean(busy)}
                  />
                  <p className="m-0 text-meta text-ink-muted">
                    As the clinic has it. This shows the record belongs to {invitation?.forSelf ? 'you' : 'your family'}.
                    {/* After a miss the server's own count is in the error below; one count, not two. */}
                    {!error && invitation?.triesLeft < 3 ? ` ${invitation.triesLeft} ${invitation.triesLeft === 1 ? 'try' : 'tries'} left.` : ''}
                  </p>
                </div>
              )}
            </>
          )}

          {error && (
            <div role="alert" className="alert alert-error">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {emailOnly ? (
              <>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={Boolean(busy)}>Cancel</Button>
                {ticket ? (
                  <Button type="button" loading={busy === 'confirm'} disabled={code.length !== CODE_LENGTH} onClick={() => confirmCode()}>
                    Confirm email
                  </Button>
                ) : (
                  <Button type="button" loading={busy === 'code'} onClick={sendCode}>Send the code</Button>
                )}
              </>
            ) : duplicate ? (
              <>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={Boolean(busy)}>Cancel</Button>
                <Button type="button" loading={busy === 'accept'} onClick={() => accept(true)}>Add as a separate profile</Button>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => setDeclining(true)} disabled={Boolean(busy)}>
                  Not someone I know
                </Button>
                <Button type="button" loading={busy === 'accept'} disabled={!birthdate} onClick={() => accept(false)}>
                  Add to my account
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={declining}
        onOpenChange={(o) => { if (!o) setDeclining(false); }}
        title="Not someone you know?"
        description={`The invitation for ${invitation?.patientName} ends, and the clinic sees that it was not for you. Nothing is added to your account.`}
        confirmLabel="End the invitation"
        loading={busy === 'decline'}
        onConfirm={decline}
      />
    </>
  );
}
