import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import Logo from '../../components/Logo';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import { AlertCircle, CheckCircle, ArrowRight, ArrowLeft } from 'lucide-react';

const ForgotPassword = ({ onNavigate }) => {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email) {
      setError('Please enter your email address.');
      return;
    }

    setSubmitting(true);
    try {
      const message = await forgotPassword(email);
      setSuccess(message || 'If that email is registered, a password reset link has been sent.');
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
              <CardTitle className="text-xl font-bold text-dark-slate">Forgot Password?</CardTitle>
              <CardDescription className="text-xs text-gray-500 font-medium">
                Enter your account email and we'll send you a link to reset your password.
              </CardDescription>
            </CardHeader>

            <CardContent className="px-6 py-4 space-y-4">
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
                      <label htmlFor="forgotpassword-email-address" className="text-xs font-semibold text-gray-700">Email Address</label>
                      <Input id="forgotpassword-email-address"
                        type="email"
                        placeholder="Enter your email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
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
                      <span>Send Reset Link</span>
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </form>
            </CardContent>

            <CardFooter className="flex justify-center border-t border-line py-4 bg-slate-50/70">
              <button
                onClick={() => onNavigate('login')}
                className="text-xs font-bold text-brand-600 hover:underline bg-transparent border-0 p-0 cursor-pointer flex items-center space-x-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Sign In</span>
              </button>
            </CardFooter>
          </Card>
        </div>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default ForgotPassword;
