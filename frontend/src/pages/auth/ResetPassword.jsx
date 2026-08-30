import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import Logo from '../../components/Logo';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import { AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';

const ResetPassword = ({ token, onNavigate }) => {
  const { resetPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!password || !confirmPassword) {
      setError('Please fill in both password fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const message = await resetPassword(token, password);
      setSuccess(message || 'Your password has been reset. You can now log in.');
      setTimeout(() => onNavigate('login'), 2500);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab="login" onNavigate={onNavigate} />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex items-center justify-center w-full">
        <div className="w-full max-w-md">
          <Card className="border-line rounded-2xl bg-surface overflow-hidden">
            <CardHeader className="space-y-1.5 pt-6 pb-2 px-6">
              <div className="w-12 h-12 rounded-full border-2 border-brand-300 flex items-center justify-center bg-gray-50/30 mb-2">
                <Logo className="w-8 h-8" />
              </div>
              <CardTitle className="text-xl font-bold text-dark-slate">Set a New Password</CardTitle>
              <CardDescription className="text-xs text-gray-500 font-medium">
                Choose a new password for your Enlogada Clinic account.
              </CardDescription>
            </CardHeader>

            <CardContent className="px-6 py-4 space-y-4">
              {!token && (
                <div role="alert" className="bg-red-50 border border-red-100 text-red-600 rounded-lg p-3 flex items-center space-x-2 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>This reset link is missing or malformed. Please request a new one.</span>
                </div>
              )}

              {token && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div role="alert" className="bg-red-50 border border-red-100 text-red-600 rounded-lg p-3 flex items-center space-x-2 text-xs">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  {success && (
                    <div role="status" className="bg-green-50 border border-green-100 text-green-600 rounded-lg p-3 flex items-center space-x-2 text-xs">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{success}</span>
                    </div>
                  )}

                  {!success && (
                    <>
                      <div className="space-y-1.5">
                        <label htmlFor="resetpassword-new-password" className="text-xs font-semibold text-gray-700">New Password</label>
                        <Input id="resetpassword-new-password"
                          type="password"
                          placeholder="At least 8 characters"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="rounded-xl border-gray-200 bg-slate-50/70 focus-visible:ring-brand-500"
                          disabled={submitting}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="resetpassword-confirm-new-password" className="text-xs font-semibold text-gray-700">Confirm New Password</label>
                        <Input id="resetpassword-confirm-new-password"
                          type="password"
                          placeholder="Re-enter your new password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="rounded-xl border-gray-200 bg-slate-50/70 focus-visible:ring-brand-500"
                          disabled={submitting}
                        />
                      </div>

                      <Button
                        type="submit"
                        loading={submitting}
                        size="lg"
            className="w-full"
                      >
                        <span>Reset Password</span>
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </form>
              )}
            </CardContent>

            <CardFooter className="flex justify-center border-t border-line py-4 bg-slate-50/70">
              <button
                onClick={() => onNavigate('login')}
                className="text-xs font-bold text-brand-600 hover:underline bg-transparent border-0 p-0 cursor-pointer"
              >
                Back to Sign In
              </button>
            </CardFooter>
          </Card>
        </div>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default ResetPassword;
