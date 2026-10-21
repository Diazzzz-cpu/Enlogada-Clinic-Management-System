import React, { useEffect, useState } from 'react';
import { AlertCircle, ListChecks } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { SkeletonList } from '../ui/skeleton';
import api from '../../config/api';
import { toastSuccess } from '../../lib/toast';

/**
 * Take a patient's record out of the portal account holding it. Admin only. [1.136.0]
 *
 * For when a record is in the wrong account: the wrong Maria Santos was invited, a child grown up
 * wants their own account, the family member who managed it has handed over, or the patient no
 * longer agrees. Nothing is deleted; the record goes back to being a walk-in record, and can be
 * invited again (by someone else for the next 30 days: the two-person rule).
 *
 * The reasons are in two groups. Urgent ones go through with work still open, and the open work is
 * listed afterwards for the desk; planned ones wait until it is finished, so a family member is not
 * cut off from a booking they paid for. The open work is shown BEFORE anything is pressed, and a
 * planned reason is unavailable while there is any, rather than refused after the click.
 */
const REASONS = [
  ['linked_in_error', 'Linked to the wrong account by mistake', true],
  ['account_compromised', 'Someone else has got into the account', true],
  ['consent_withdrawn', 'The patient no longer agrees to this account seeing their record', true],
  ['moving_to_another_manager', 'Another family member is taking over', false],
  ['patient_wants_own_account', 'The patient wants their own account', false],
  ['other', 'Something else', false],
];
const MUST_CLEAR = ['linked_in_error', 'account_compromised'];

export default function UnlinkDialog({ open, onOpenChange, patientId, patientName, onUnlinked }) {
  const [access, setAccess] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reasonKind, setReasonKind] = useState('');
  const [note, setNote] = useState('');
  const [recordEmail, setRecordEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // After an urgent unlink with work still open: what to hand to the desk.
  const [handOver, setHandOver] = useState(null);

  const load = () => {
    setLoadError('');
    setAccess(null);
    api.get(`/patients/${patientId}/portal-access`)
      .then((res) => setAccess(res.data.data))
      .catch((err) => setLoadError(err.response?.data?.message || "This record's portal account could not be loaded."));
  };

  useEffect(() => {
    if (!open) return;
    setReasonKind('');
    setNote('');
    setRecordEmail('');
    setError('');
    setHandOver(null);
    load();
    // load reads patientId, which is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId]);

  const openWork = access?.openWork || [];
  const reason = REASONS.find(([key]) => key === reasonKind);
  const emailIsAccount = Boolean(access?.account?.recordEmailIsAccount);
  const mustClear = MUST_CLEAR.includes(reasonKind);
  // A "keep" chosen before switching to a reason that forbids it would leave the button dead.
  useEffect(() => {
    if (mustClear && recordEmail === 'keep') setRecordEmail('');
  }, [mustClear, recordEmail]);
  const ready = Boolean(reason)
    && (reason[2] || openWork.length === 0)
    && note.trim().length >= 10
    && (!emailIsAccount || recordEmail === 'clear' || (recordEmail === 'keep' && !mustClear));

  const confirm = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.delete(`/patients/${patientId}/account-link`, {
        data: { reasonKind, note: note.trim(), recordEmail: emailIsAccount ? recordEmail : undefined },
      });
      onUnlinked?.(res.data.data.patient);
      const left = res.data.data.openWork || [];
      if (left.length) {
        setHandOver(left);
      } else {
        toastSuccess(`${patientName} unlinked from ${access.account.email}`);
        onOpenChange(false);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'The record could not be unlinked.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg" data-testid="unlink-dialog">
        <DialogHeader>
          <DialogTitle>Unlink {patientName}&apos;s portal account</DialogTitle>
          <DialogDescription>
            The record leaves that account at once. Nothing is deleted, and it can be invited again.
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
        ) : handOver ? (
          <div className="space-y-2" data-testid="unlink-handover">
            <p className="m-0 text-note text-slate-800">
              Unlinked. These are still open for {patientName}. Give them to the Desk, and tell the patient:
            </p>
            <ul className="m-0 list-disc space-y-0.5 pl-5 text-note text-slate-700">
              {handOver.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="m-0 text-note text-slate-700">
              In the account of <strong>{access.account?.name}</strong> ({access.account?.email}).
            </p>
            <div className="rounded-lg border border-line bg-slate-50 p-3 text-fine text-slate-600">
              <p className="m-0 font-semibold text-slate-800">This will</p>
              <ul className="m-0 mb-2 list-disc pl-5">
                <li>take the record out of that account&apos;s portal at once</li>
                <li>withdraw any invitation still waiting</li>
                <li>email the account that a record was removed (no name, no reason)</li>
              </ul>
              <p className="m-0 font-semibold text-slate-800">This won&apos;t</p>
              <ul className="m-0 list-disc pl-5">
                <li>delete any visit, report or receipt</li>
                <li>recall reports already emailed, or copies already viewed or saved</li>
              </ul>
            </div>

            {openWork.length > 0 && (
              <div className="alert alert-warning" data-testid="unlink-open-work">
                <ListChecks className="h-4 w-4 flex-shrink-0" />
                <span>
                  Still open: {openWork.join('; ')}. Only an urgent reason can unlink before these are finished.
                </span>
              </div>
            )}

            <fieldset className="space-y-1.5">
              <legend className="field-label">Why?</legend>
              {REASONS.map(([key, label, urgent]) => {
                const unavailable = !urgent && openWork.length > 0;
                return (
                  <label key={key} className={`flex items-start gap-2 text-note ${unavailable ? 'text-slate-400' : 'text-slate-800'}`}>
                    <input
                      type="radio"
                      name="unlink-reason"
                      className="mt-1"
                      value={key}
                      disabled={unavailable}
                      checked={reasonKind === key}
                      onChange={() => setReasonKind(key)}
                    />
                    <span>{label}{urgent ? ' (urgent)' : ''}</span>
                  </label>
                );
              })}
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor="unlink-note" className="field-label">What happened</label>
              <Textarea
                id="unlink-note"
                rows={2}
                value={note}
                maxLength={500}
                aria-describedby="unlink-note-hint"
                onChange={(e) => setNote(e.target.value)}
                placeholder="For the Activity Log. Not shown to the family."
              />
              <p id="unlink-note-hint" className="m-0 text-meta text-slate-500">At least 10 characters.</p>
            </div>

            {emailIsAccount && (
              <fieldset className="space-y-1.5" data-testid="unlink-record-email">
                <legend className="field-label">The record&apos;s email is that account&apos;s address</legend>
                <label className="flex items-center gap-2 text-note text-slate-800">
                  <input type="radio" name="record-email" checked={recordEmail === 'clear'} onChange={() => setRecordEmail('clear')} />
                  Clear it, so released reports are not emailed there
                </label>
                <label className={`flex items-center gap-2 text-note ${mustClear ? 'text-slate-400' : 'text-slate-800'}`}>
                  <input
                    type="radio"
                    name="record-email"
                    disabled={mustClear}
                    checked={recordEmail === 'keep'}
                    onChange={() => setRecordEmail('keep')}
                  />
                  Keep it {mustClear ? '(not for this reason)' : ''}
                </label>
              </fieldset>
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
          {handOver ? (
            <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
              <Button type="button" onClick={confirm} loading={saving} disabled={!ready || saving || !access}>
                Unlink record
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
