import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import { AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';

// Card-only content, no shell/graphic — AuthPage.jsx owns the shared header/footer/graphic
// panel and the login<->register crossfade.
const RegisterForm = ({ onSwitchToLogin }) => {
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    contactNumber: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Counts rejections rather than holding a flag, so React sees a NEW element each time and
  // replays the shake. A boolean would sit there already-true and the second wrong attempt would
  // look like nothing happened. Login does the same; this form was the one that did not.
  const [rejections, setRejections] = useState(0);

  // Said while they type, not after they submit. The mismatch is the one error on this form the
  // browser can detect without asking the server, and finding out at submit time means retyping
  // a password they already typed twice.
  const passwordsMismatch =
    formData.confirmPassword.length > 0 && formData.password !== formData.confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const { firstName, lastName, email, password, confirmPassword, contactNumber } = formData;

    if (!firstName || !lastName || !email || !password) {
      setError('Please fill in all required fields.');
      setRejections((n) => n + 1);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setRejections((n) => n + 1);
      return;
    }

    setSubmitting(true);
    try {
      await register({
        firstName,
        lastName,
        email,
        password,
        contactNumber
      });
      setSuccess('Account created successfully! You can now log in.');
      setTimeout(() => {
        onSwitchToLogin();
      }, 2000);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="space-y-1">
        <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Create an Account</h1>
        <p className="m-0 text-note leading-relaxed text-slate-500">
          Register to access your clinic account
        </p>
      </div>

      <div className="mt-6 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {error && (
            <div key={rejections} role="alert" className="alert alert-error animate-shake">
              <AlertCircle />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-3 flex items-center space-x-2 text-xs">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="registerform-first-name" className="mb-1.5 block text-fine font-semibold text-slate-700">First Name</label>
              <Input id="registerform-first-name"
                type="text"
                autoComplete="given-name"
                placeholder="First name"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="rounded-xl border-gray-200 bg-slate-50/70 text-xs focus-visible:ring-brand-500"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="registerform-last-name" className="mb-1.5 block text-fine font-semibold text-slate-700">Last Name</label>
              <Input id="registerform-last-name"
                type="text"
                autoComplete="family-name"
                placeholder="Last name"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="rounded-xl border-gray-200 bg-slate-50/70 text-xs focus-visible:ring-brand-500"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="registerform-email-address" className="mb-1.5 block text-fine font-semibold text-slate-700">Email Address</label>
            <Input id="registerform-email-address"
              type="email"
              autoComplete="email"
              placeholder="Enter your email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="rounded-xl border-gray-200 bg-slate-50/70 text-xs focus-visible:ring-brand-500"
              disabled={submitting}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="registerform-contact-number" className="mb-1.5 block text-fine font-semibold text-slate-700">Contact Number</label>
            <Input id="registerform-contact-number"
              type="tel"
              autoComplete="tel"
              placeholder="09171234567"
              value={formData.contactNumber}
              onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
              className="rounded-xl border-gray-200 bg-slate-50/70 text-xs focus-visible:ring-brand-500"
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="registerform-password" className="mb-1.5 block text-fine font-semibold text-slate-700">Password</label>
              <PasswordInput id="registerform-password"
                autoComplete="new-password"
                placeholder="Create a password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="rounded-xl border-gray-200 bg-slate-50/70 text-xs focus-visible:ring-brand-500"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="registerform-confirm-password" className="mb-1.5 block text-fine font-semibold text-slate-700">Confirm Password</label>
              <PasswordInput id="registerform-confirm-password"
                autoComplete="new-password"
                placeholder="Confirm your password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                aria-invalid={passwordsMismatch || undefined}
                aria-describedby={passwordsMismatch ? 'registerform-confirm-error' : undefined}
                className={`rounded-xl bg-slate-50/70 text-xs ${
                  passwordsMismatch
                    ? 'border-rose-300 focus-visible:ring-rose-500'
                    : 'border-gray-200 focus-visible:ring-brand-500'
                }`}
                disabled={submitting}
              />
              {/* aria-live, so someone who cannot see the red border is still told — and polite
                  rather than assertive, because this fires on a keystroke and must not interrupt
                  what they are typing. */}
              <p
                id="registerform-confirm-error"
                aria-live="polite"
                className={`m-0 text-fine font-semibold text-rose-600 transition-opacity ${
                  passwordsMismatch ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {passwordsMismatch ? 'Both passwords must match.' : ' '}
              </p>
            </div>
          </div>

          <Button
            type="submit"
            loading={submitting}
            size="lg"
            className="w-full mt-2"
          >
            <span>Create Account</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
};

export default RegisterForm;
