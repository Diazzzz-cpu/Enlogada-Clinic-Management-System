import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import Logo from './Logo';
import { Button } from './ui/button';
import { LogOut, User } from 'lucide-react';
import { ThemeToggle } from './ui/theme-toggle';
import TextScaleControl from './ui/text-scale-control';

const Navbar = ({ onNavigate, activeTab = 'dashboard' }) => {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 flex w-full items-center justify-between gap-2 border-b border-line bg-surface/85 px-4 py-2.5 backdrop-blur-md sm:px-6">
      {/* Clinic Identity (Logo + Name).
          Shrinkable on purpose. Both sides of this header were flex-shrink-0, so at 390px neither
          would give and the bar overflowed by 15px — the patient's dashboard scrolled sideways on
          a phone, which is the width most patients use it at. The name already has min-w-0 and
          truncate, so letting it compress is the behaviour it was written for; the clinic's own
          name is the least important thing on the screen when the alternative is a page that
          drags. */}
      <div className="flex min-w-0 items-center gap-2.5">
        <Logo className="h-9 w-9 flex-shrink-0" />
        {/* The wordmark is hidden below `sm`, not shrunk. Letting it compress is what stopped the
            15px overflow, but the result at 390px was "ENL…" — a clipped wordmark is worse
            branding than no wordmark, and it is the first thing a patient sees on their own
            portal. The logo carries the identity on a phone; the patient knows what site they
            signed in to. */}
        <div className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="truncate text-lead font-bold tracking-tight text-slate-900">ENLOGADA</span>
          <span className="truncate text-micro font-semibold uppercase tracking-[0.12em] text-slate-500">
            Ultrasound &amp; Diagnostic Clinic
          </span>
        </div>
      </div>

      {/* Navigation and User Actions.
          The two destinations are a segmented control rather than underlined tabs — the same
          shape the staff consoles use for switching views, so a patient and a member of staff
          are not learning two different idioms for the same gesture. */}
      <div className="flex flex-shrink-0 items-center gap-2 sm:gap-4">
        <nav className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
          <button
            type="button"
            onClick={() => onNavigate?.('dashboard')}
            className={`cursor-pointer whitespace-nowrap rounded-[7px] border-0 px-3 py-1.5 text-fine font-semibold transition-colors ${
              activeTab === 'dashboard'
                ? 'bg-surface text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]'
                : 'bg-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => onNavigate?.('account')}
            className={`cursor-pointer whitespace-nowrap rounded-[7px] border-0 px-3 py-1.5 text-fine font-semibold transition-colors ${
              activeTab === 'account'
                ? 'bg-surface text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]'
                : 'bg-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span className="hidden sm:inline">My Account</span>
            <span className="sm:hidden">Account</span>
          </button>
        </nav>

        {user && (
          <div className="flex items-center gap-2">
            {/* Two preferences, one slot. Both are 36px bordered icon buttons, so they read as a
                pair rather than as two unrelated controls. Theme first: it changes the whole
                screen, where text size changes its measure. */}
            <ThemeToggle />

            {/* The portal is the screen a patient reads their own results on, so the size control
                belongs here and not only on the public pages they pass through once. Hidden below
                `sm` because the bar is already tight there — phone users get the browser's own
                text-size setting, which this deliberately multiplies rather than overrides. */}
            <TextScaleControl className="hidden sm:inline-flex" />

            <span aria-hidden="true" className="hidden h-6 w-px bg-slate-200 sm:block" />

            {/* User Badge */}
            <button
              type="button"
              onClick={() => onNavigate?.('account')}
              aria-label="Manage account settings"
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-surface px-2 py-1.5 text-fine font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 sm:px-2.5"
            >
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-brand-100 text-brand-700">
                <User className="h-3.5 w-3.5" />
              </span>
              <span className="hidden whitespace-nowrap md:inline">{user.firstName} {user.lastName}</span>
            </button>

            {/* Log Off Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Log Off"
              title="Log off"
              className="text-slate-500 hover:bg-rose-50 hover:text-rose-600"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Navbar;
