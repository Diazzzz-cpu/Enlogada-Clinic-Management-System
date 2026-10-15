import React, { useState } from 'react';
import { AlertCircle, Check, KeyRound } from 'lucide-react';
import { Panel, PanelHeader, PanelBody, PanelFooter } from '../ui/panel';
import { PasswordInput } from '../ui/password-input';
import { Button } from '../ui/button';
import PasswordMeter from '../auth/PasswordMeter';
import { useAuth } from '../../contexts/AuthContext';
import { toastSuccess } from '../../lib/toast';
import { MIN_PASSWORD_LENGTH } from '../../lib/passwordStrength';

const EMPTY = { currentPassword: '', newPassword: '', confirmNewPassword: '' };

/**
 * Changing the password. [1.120.0]
 *
 * The same meter Create Account shows sits under the new password, and the confirmation says
 * whether it matches while it is typed, so a mismatch is found before the button rather than
 * after it. Changing it ends every other session ([1.16.0]); the header says so up front.
 */
export default function PasswordPanel() {
  const { changePassword } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const filled = Boolean(form.currentPassword && form.newPassword && form.confirmNewPassword);
  const matches = form.confirmNewPassword && form.newPassword === form.confirmNewPassword;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`The new password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (!matches) {
      setError("The new password and its confirmation don't match.");
      return;
    }
    setSaving(true);
    try {
      await changePassword(form.currentPassword, form.newPassword);
      toastSuccess('Password changed', 'Every other device has been signed out.');
      setForm(EMPTY);
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Your password could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <form onSubmit={onSubmit} noValidate>
        <PanelHeader
          icon={KeyRound}
          title="Password"
          description="A new one signs you out elsewhere."
        />
        <PanelBody className="space-y-4">
          {error && (
            <div role="alert" className="alert alert-error">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="sm:max-w-[calc(50%-0.5rem)]">
            <label htmlFor="account-current-password" className="field-label">Current password</label>
            <PasswordInput
              id="account-current-password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={set('currentPassword')}
              disabled={saving}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="account-new-password" className="field-label">New password</label>
              <PasswordInput
                id="account-new-password"
                autoComplete="new-password"
                aria-describedby="account-new-password-strength"
                value={form.newPassword}
                onChange={set('newPassword')}
                disabled={saving}
                required
              />
              <PasswordMeter id="account-new-password-strength" password={form.newPassword} />
            </div>
            <div>
              <label htmlFor="account-confirm-password" className="field-label">Confirm new password</label>
              <PasswordInput
                id="account-confirm-password"
                autoComplete="new-password"
                aria-describedby="account-confirm-password-match"
                value={form.confirmNewPassword}
                onChange={set('confirmNewPassword')}
                disabled={saving}
                required
              />
              <p id="account-confirm-password-match" className="m-0 mt-3 flex items-center gap-1 text-fine text-slate-500">
                {!form.confirmNewPassword
                  ? 'Type the new password again.'
                  : matches
                    ? (<><Check className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" /><span className="text-brand-700">Passwords match</span></>)
                    : "Doesn't match yet"}
              </p>
            </div>
          </div>
        </PanelBody>
        <PanelFooter className="justify-end">
          <Button type="submit" loading={saving} disabled={!filled}>Change Password</Button>
        </PanelFooter>
      </form>
    </Panel>
  );
}
