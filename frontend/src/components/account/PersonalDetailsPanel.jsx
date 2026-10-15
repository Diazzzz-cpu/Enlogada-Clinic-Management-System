import React, { useEffect, useState } from 'react';
import { AlertCircle, Lock, UserRound } from 'lucide-react';
import { Panel, PanelHeader, PanelBody, PanelFooter } from '../ui/panel';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';
import { toastSuccess } from '../../lib/toast';

const fromUser = (user) => ({
  firstName: user?.firstName || '',
  lastName: user?.lastName || '',
  contactNumber: user?.contactNumber || '',
});

/**
 * The account's name and contact number. [1.120.0]
 *
 * Save is offered only once something has changed: a Save that is always lit invites a press that
 * does nothing, and then the toast confirms a change nobody made. The sign-in email is shown as
 * what it is, a fact about the account, not a greyed-out box that looks broken.
 */
export default function PersonalDetailsPanel() {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState(() => fromUser(user));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // The account can change underneath the form (AuthContext re-reads /auth/me); follow it while
  // nothing has been typed.
  const saved = fromUser(user);
  const dirty = ['firstName', 'lastName', 'contactNumber'].some((k) => form[k].trim() !== saved[k].trim());
  useEffect(() => {
    if (!dirty) setForm(fromUser(user));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.firstName, user?.lastName, user?.contactNumber]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('Your first and last name are both needed.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        contactNumber: form.contactNumber.trim(),
      });
      toastSuccess('Details saved', `${form.firstName.trim()} ${form.lastName.trim()}`);
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Your details could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <form onSubmit={onSubmit} noValidate>
        <PanelHeader
          icon={UserRound}
          title="Personal details"
          description="Your name and a number to reach you."
        />
        <PanelBody className="space-y-4">
          {error && (
            <div role="alert" className="alert alert-error">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="account-first-name" className="field-label">First name</label>
              <Input id="account-first-name" autoComplete="given-name" value={form.firstName} onChange={set('firstName')} disabled={saving} required />
            </div>
            <div>
              <label htmlFor="account-last-name" className="field-label">Last name</label>
              <Input id="account-last-name" autoComplete="family-name" value={form.lastName} onChange={set('lastName')} disabled={saving} required />
            </div>
            <div>
              <label htmlFor="account-contact" className="field-label">Contact number</label>
              <Input
                id="account-contact"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="09171234567"
                value={form.contactNumber}
                onChange={set('contactNumber')}
                disabled={saving}
              />
            </div>
            <div>
              <span id="account-email-label" className="field-label">Sign-in email</span>
              <p
                aria-labelledby="account-email-label"
                className="m-0 flex h-9 items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 text-note text-ink"
              >
                <span className="min-w-0 flex-1 truncate" title={user?.email}>{user?.email}</span>
                <Lock className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
              </p>
              <p className="m-0 mt-1 text-fine text-slate-500">This is how you sign in, so it can't be changed here.</p>
            </div>
          </div>
        </PanelBody>
        <PanelFooter className="justify-end">
          {dirty && !saving && <span className="mr-auto text-fine text-slate-500">You have unsaved changes.</span>}
          <Button type="submit" loading={saving} disabled={!dirty}>Save Changes</Button>
        </PanelFooter>
      </form>
    </Panel>
  );
}
