import React, { useRef, useState } from 'react';
import PublicHeader from '../../components/PublicHeader';
import Logo from '../../components/Logo';
import LoginForm from '../../components/auth/LoginForm';
import RegisterForm from '../../components/auth/RegisterForm';
import { useClinic } from '../../lib/clinic';
import { cn } from '../../lib/utils';
import { ShieldCheck, Clock, HeartHandshake, MapPin, Phone } from 'lucide-react';

// The clinic's front door: sign in and create an account, in one page that owns the switch
// between them.
//
// ── Why the page changed shape, twice ─────────────────────────────────────────────────────────
//
// [1.23.0] replaced a white form card floating between the public header and footer — four framed
// rectangles, none obviously the thing to do next — with a two-column layout and no footer.
//
// This pass fixes what that left behind:
//
//  * The dark column used `.rail-gradient`, which washes green AND azure over near-black. That is
//    right for a hero band under a page of white content. Filling half the screen with it made a
//    large muddy field where the two hues meet. `.auth-panel` is one hue — the logo's azure —
//    walked from mid to deep along a single diagonal. A single hue cannot go muddy.
//  * Switching between sign-in and register was a text link at the very bottom of the form, below
//    the Google button, and the swap was a generic fade. The two modes are peers and the choice
//    belongs at the TOP, so a segmented control states both, says which one you are on, and gives
//    the transition something to actually transition between.
//  * The panel carried a headline, three paragraphs and a full address block. It reads as a wall
//    beside a five-field form. Trimmed: the reassurance is what a first-time patient needs, and
//    the contact details are a quiet footnote rather than a fourth paragraph.
const TRUST_POINTS = [
  {
    icon: ShieldCheck,
    title: 'Licensed diagnostics',
    body: 'Certified technologists and radiologists handle every test.',
  },
  {
    icon: Clock,
    title: 'Results you can reach',
    body: 'Released to your account and emailed the moment they are signed off.',
  },
  {
    icon: HeartHandshake,
    title: 'HMO and senior/PWD',
    body: 'Accredited providers, and statutory discounts applied at the counter.',
  },
];

const MODES = [
  { id: 'login', label: 'Sign In' },
  { id: 'register', label: 'Create Account' },
];

const AuthPage = ({ initialMode = 'login', onNavigate }) => {
  const [mode, setMode] = useState(initialMode);
  // Which way the swap is travelling, so the form arrives from the side you came from rather than
  // always from the right. A `ref` and not state: it is read during the same render that the mode
  // changes, and storing it in state would need a second render to apply.
  const dir = useRef('fwd');
  const go = (next) => {
    if (next === mode) return;
    dir.current = next === 'register' ? 'fwd' : 'back';
    setMode(next);
  };
  const activeIndex = MODES.findIndex((m) => m.id === mode);
  // Runtime identity, so the address here and on the receipt cannot disagree. See lib/clinic.js.
  const CLINIC = useClinic();

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <PublicHeader currentTab={mode} onNavigate={onNavigate} />

      <main className="flex flex-1 items-stretch">
        {/* Form column. Each half owns its full height — the previous `max-w-6xl` + `items-center`
            left a band of empty canvas above and below both columns. */}
        <div className="auth-ground flex flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:px-12">
          <div className="w-full max-w-[27rem]">
            {/* Below `lg` the panel is hidden, which left this page carrying no brand at all — on
                the one screen a patient reaches before they have any context about who they are
                handing their details to. */}
            <div className="mb-7 flex items-center gap-3 lg:hidden">
              <Logo className="h-10 w-10 flex-shrink-0" />
              <div className="min-w-0 leading-tight">
                <p className="m-0 text-note font-bold tracking-tight text-slate-900">{CLINIC.shortName}</p>
                <p className="m-0 text-micro font-semibold uppercase tracking-[0.14em] text-azure-700">
                  Ultrasound &amp; Diagnostic Clinic
                </p>
              </div>
            </div>

            {/* The form gets a surface of its own. It had none — a bare form on a flat white
                column — which is the single reason the page read as unfinished whatever the panel
                beside it was doing. A card with a soft shadow gives the eye somewhere to land and
                separates the task from the page it sits on. */}
            <div className="auth-card rounded-2xl p-6 sm:p-7">
            {/* The mode switch, at the top where the decision is actually made. It was a text link
                under the Google button, which is after everything else on the page — so somebody
                who arrived at the wrong one filled in a form before finding out. */}
            <div
              role="tablist"
              aria-label="Sign in or create an account"
              className="relative mb-7 grid grid-cols-2 rounded-xl border border-line bg-slate-100/70 p-1"
            >
              {/* One pill that TRAVELS, rather than a white background blinking from one button to
                  the other. It is the same 220ms as the form swap beside it, so the two read as
                  one movement — the indicator leads and the form follows. transform only, so it
                  is composited rather than laid out on every frame. */}
              <span
                aria-hidden="true"
                className="absolute inset-y-1 left-1 rounded-lg bg-surface shadow-[0_1px_3px_rgb(15_23_42_/_0.10)] transition-transform duration-[220ms] ease-[cubic-bezier(0.22,0.9,0.28,1)]"
                style={{
                  width: 'calc(50% - 0.25rem)',
                  transform: `translateX(${activeIndex * 100}%)`,
                }}
              />
              {MODES.map((m) => {
                const on = m.id === mode;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => go(m.id)}
                    className={cn(
                      'relative z-10 cursor-pointer rounded-lg border-0 bg-transparent px-3 py-2 text-note font-semibold transition-colors duration-150',
                      on ? 'text-azure-800' : 'text-slate-500 hover:text-slate-800'
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            {/* Keyed on the mode, so the animation replays on the swap and only on the swap. */}
            <div key={mode} data-auth-dir={dir.current}>
              {mode === 'login' ? (
                <LoginForm onNavigate={onNavigate} />
              ) : (
                <RegisterForm onSwitchToLogin={() => go('login')} />
              )}
            </div>
            </div>
          </div>
        </div>

        {/* Brand and reassurance. Stays put across the swap — only the form changes. */}
        <aside className="auth-panel relative hidden w-[46%] flex-shrink-0 items-center overflow-hidden text-white lg:flex xl:w-[44%]">
          {/* The mark, oversized and barely there. Gives the panel a subject without an image. */}
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -bottom-16 opacity-[0.07]">
            <Logo className="h-[26rem] w-[26rem]" />
          </div>

          <div className="relative w-full px-10 py-14 xl:px-14">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-inset ring-white/20">
                <Logo className="h-8 w-8" />
              </span>
              <div className="leading-tight">
                <p className="m-0 text-lead font-bold tracking-tight text-white">{CLINIC.shortName}</p>
                <p className="m-0 text-micro font-semibold uppercase tracking-[0.14em] text-azure-200">
                  Ultrasound &amp; Diagnostic Clinic
                </p>
              </div>
            </div>

            <h2 className="m-0 mt-10 max-w-md text-2xl font-bold leading-snug tracking-tight text-white xl:text-3xl">
              Book a test, follow your visit, and collect your results in one place.
            </h2>

            <ul className="m-0 mt-9 list-none space-y-3 p-0">
              {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
                <li
                  key={title}
                  className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.07] p-3.5 backdrop-blur-sm"
                >
                  <span className="mt-px flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-note font-semibold text-white">{title}</span>
                    <span className="mt-0.5 block text-fine leading-relaxed text-azure-100/80">{body}</span>
                  </span>
                </li>
              ))}
            </ul>

            {/* A footnote, not a fourth paragraph. */}
            <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-5 text-fine text-azure-100/70">
              <span className="flex w-full items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {/* Wraps rather than truncates. An address ending "Misamis Orient…" is not a
                    shorter address, it is a wrong one — and this is the only place on the page
                    that tells somebody where to physically turn up. */}
                <span className="leading-relaxed">{CLINIC.address}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {CLINIC.phone}
              </span>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default AuthPage;
