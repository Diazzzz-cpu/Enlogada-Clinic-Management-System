import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import { isGoogleAuthConfigured } from '../../config/googleAuth';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import { AlertCircle, ArrowRight } from 'lucide-react';

// Card-only content, no shell/graphic — AuthPage.jsx owns the shared header/footer/graphic
// panel and the login<->register crossfade.
const LoginForm = ({ onNavigate }) => {
  const { login, googleLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /**
   * The Google button is always shown when a client ID is configured. It is never hidden by us.
   *
   * There WAS a detector here that hid it when it looked dead, and it was wrong about what it
   * was measuring. It asked for `slot.querySelector('iframe')` and treated a missing or 0-height
   * iframe as proof the button had failed — but @react-oauth/google calls
   * `google.accounts.id.renderButton(container)` into a plain <div>, and GSI frequently renders
   * the pill as native DOM with no iframe at all. So on a perfectly working sign-in the query
   * returned null, the check read that as broken, and it hid a button the user had just used.
   * Reported twice from the real screen; not reproducible in a headless browser here, where the
   * origin is refused and the DOM looks different.
   *
   * Two attempts to make the heuristic smarter (a longer grace period, then letting it change
   * its mind in both directions) both missed this, because the premise was wrong rather than the
   * timing. A check that cannot distinguish "no iframe because it rendered natively" from "no
   * iframe because Google refused" is not measuring the thing it claims to measure.
   *
   * What it was guarding against is real: when the origin is refused, GSI still paints a
   * Google-looking pill and clicking it does nothing, because onError never fires — the flow
   * never starts. That is a genuine dead control. But hiding a WORKING button is the worse
   * failure of the two: it removes the sign-in method the user actually has, and it did so
   * repeatedly, where the dead-button case only appears while an origin allowlist propagates.
   *
   * If this needs solving properly it wants a real signal — Google publishing a failure state,
   * or intercepting the 403 on accounts.google.com/gsi/button — not geometry.
   */

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  // Bumped on every rejection so the alert remounts and the shake replays. A boolean would not:
  // two wrong passwords in a row set the same error text, and React would keep the same element.
  const [rejections, setRejections] = useState(0);

  // GSI renders once at the width it is given, so this is measured rather than styled.
  const googleSlot = useRef(null);
  const [googleWidth, setGoogleWidth] = useState(240);
  useEffect(() => {
    const el = googleSlot.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // 400 is Google's own cap; below that, fill the slot exactly.
      const w = Math.min(400, Math.floor(el.getBoundingClientRect().width));
      if (w > 0) setGoogleWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setSubmitting(true);
    try {
      if (!credentialResponse.credential) {
        throw 'Google did not return a sign-in credential. Please try again.';
      }
      await googleLogin(credentialResponse.credential);
    } catch (err) {
      setRejections((n) => n + 1);
      setError(typeof err === 'string' ? err : err?.message || 'Google login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="space-y-1">
        <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Welcome Back</h1>
        <p className="m-0 text-note leading-relaxed text-slate-500">
          Sign in to your dashboard to manage records.
        </p>
      </div>

      <div className="mt-6 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* The shake is a head-shake: a rejection, shown as one. It rides ALONGSIDE the red
              border, the icon and the message — never instead of them, because motion says nothing
              to a screen reader or to anyone with reduced motion on, and both still get the whole
              message. Keyed on the rejection count so a second wrong password shakes again rather
              than sitting there looking already-answered. */}
          {error && (
            <div key={rejections} role="alert" className="alert alert-error animate-shake">
              <AlertCircle />
              <span>{error}</span>
            </div>
          )}

          {/* htmlFor/id, so the visible label is the field's accessible name and clicking it
              focuses the input. Both were decorative <label> elements with no association — on
              the one screen every single user has to get through. */}
          <div className="space-y-1.5">
            <label htmlFor="login-email" className="mb-1.5 block text-fine font-semibold text-slate-700">
              Email Address
            </label>
            <Input
              id="login-email"
              name="email"
              type="email"
              // Lets a password manager and the browser offer the right value.
              autoComplete="username"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label htmlFor="login-password" className="mb-1.5 block text-fine font-semibold text-slate-700">
                Password
              </label>
              <button
                type="button"
                onClick={() => onNavigate('forgot-password')}
                className="text-fine font-semibold text-brand-600 hover:underline bg-transparent border-0 cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
            <PasswordInput
              id="login-password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
              disabled={submitting}
            />
          </div>

          {/* UI/UX Phase 4: reverses Phase 0's navy choice for this button — this card's
              own top accent bar, heading, and links are all green, and Register's
              sibling submit button is green, so navy here read as mismatched rather
              than as "the brand's second color." */}
          <Button
            type="submit"
            loading={submitting}
            size="lg"
            className="w-full"
          >
            <span>Sign In</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>

        {/* Gated on the same condition as the button below, so the two always appear together.
            It used to render unconditionally, which left the divider heading an empty gap on any
            deployment that does not configure Google at all. */}
        {isGoogleAuthConfigured && (
          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-line"></div>
            {/* Just "or". The button directly beneath already says "Continue with Google" — that
                wording comes from GSI's `text="continue_with"` and is fixed by Google's branding
                rules, so spelling it out here too printed the same sentence twice, stacked. The
                divider's job is to separate the two ways in, not to name the second one. */}
            <span className="mx-3 flex-shrink text-fine font-medium text-slate-400">or</span>
            <div className="flex-grow border-t border-line"></div>
          </div>
        )}

        {/* `min-w-0` + `overflow-hidden` below are load-bearing, not tidiness. GSI renders at a
            fixed pixel width, so without them an oversized button sets its own slot's min-content
            width, which pushes the card, which pushes the page — and the measurement then reads
            that inflated width back and can never converge. Clipped instead, the slot's width is
            dictated by the card, the measurement is honest, and it self-corrects. */}
        {isGoogleAuthConfigured && (
          <div ref={googleSlot} className="flex w-full min-w-0 justify-center overflow-hidden">
            {/* Google's Identity Services button takes a pixel width only — it rejects
                percentages, which is why this cannot simply be the "100%" that matches the
                form's full-width Sign In button above.
                
                It was a hard-coded 360, which overflowed: 360 plus the page's own `px-4` is
                392px, so a 390px phone scrolled sideways by exactly 2px. Measuring the slot
                instead makes it match the Sign In button at every width, and it cannot go stale
                the next time the column's max-width changes. Google caps it at 400 regardless. */}
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => { setRejections((n) => n + 1); setError('Google Sign In was cancelled or failed.'); }}
              useOneTap={false}
              shape="pill"
              theme="outline"
              text="continue_with"
              width={googleWidth}
            />
          </div>
        )}

        {/* No notice here, deliberately.

            This used to print, on the public login page, that the client ID "does not list
            http://localhost:5173 under Authorized JavaScript origins — add it at
            console.cloud.google.com". That is a developer's instruction shown to a patient: it
            names an internal address, tells them to open a Google Cloud console they have no
            access to, and reads like the clinic is broken. The same block also fired when Google
            Sign-In was simply never configured, which is not an error at all — it is a
            deployment that does not offer Google.

            Either way the patient's answer is the same and is already on screen: sign in with
            email and password. So the Google section disappears entirely and the page says
            nothing about it. The diagnosis still exists for whoever needs it, in the console,
            where a developer looks and a patient does not.
        */}

      </div>
    </div>
  );
};

export default LoginForm;
