import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import api from '../../config/api';
import { toastSuccess } from '../../lib/toast';

/**
 * Connect a walk-in record to the patient's own portal account. [1.123.0]
 *
 * A walk-in registered at the Desk has no account; when they later sign up, nothing joined the
 * two, so they added themselves again, saw none of their earlier results online, and appeared
 * twice in Patient Records. Linking hands the account every result on this record, so the dialog
 * asks the person at the Desk to check, with the patient in front of them, that the address is
 * theirs. The server refuses a staff account and a record already linked, and audits the link.
 */
export default function LinkAccountDialog({ open, onOpenChange, patientId, patientName, onLinked }) {
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setEmail(''); setError(''); }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await api.put(`/patients/${patientId}/link-account`, { email: email.trim() });
      toastSuccess('Record linked', res.data.message);
      onLinked?.(res.data.data.patient);
      onOpenChange(false);
    } catch (err) {
      setError(err.response?.data?.message || 'The record could not be linked.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Link to a portal account</DialogTitle>
            <DialogDescription>
              {patientName}&apos;s visits and results will appear in the portal of the account below.
              Check the address with the patient before you link it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-3">
            {error && (
              <div role="alert" className="alert alert-error">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <label htmlFor="link-account-email" className="field-label">Email they signed up with</label>
            <Input
              id="link-account-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!email.trim()}>Link record</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
