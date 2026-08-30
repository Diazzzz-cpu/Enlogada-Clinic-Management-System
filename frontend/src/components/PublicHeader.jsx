import React, { useState } from 'react';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, User, Menu, X } from 'lucide-react';
import { ThemeToggle } from './ui/theme-toggle';

const NAV_LINKS = [
  { id: 'home', label: 'Home' },
  { id: 'services', label: 'Services' },
  { id: 'about', label: 'About Us' },
];

// Phase 1 (2026-08-12): this header was the measured cause of 131px of horizontal overflow at a
// 375px viewport (76px at 430px) on every public page — it had no breakpoint classes at all and
// forced brand + 3 nav links + 2 auth buttons onto one unwrapping row. Below `md` the links and
// auth actions now collapse into a dropdown panel. A dropdown, not a drawer: this is a 3-link
// nav, and Navbar.jsx (the Client shell) already solves the same problem this way — the two
// headers were diverging for no reason.
const PublicHeader = ({ currentTab = '', onNavigate }) => {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const go = (tab) => {
    setMenuOpen(false);
    onNavigate?.(tab);
  };

  const linkClass = (id) =>
    `transition-colors border-0 bg-transparent cursor-pointer ${
      currentTab === id ? 'text-brand-600 font-bold' : 'text-gray-700 hover:text-brand-600'
    }`;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        {/* Brand */}
        <button
          type="button"
          onClick={() => go('home')}
          className="flex items-center space-x-2 sm:space-x-3 min-w-0 border-0 bg-transparent cursor-pointer p-0 text-left"
        >
          <Logo className="h-9 w-9 flex-shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-lead font-bold leading-tight tracking-tight text-slate-900">ENLOGADA</span>
            <span className="hidden truncate text-micro font-semibold uppercase tracking-[0.12em] text-slate-500 sm:block">
              Ultrasound &amp; Diagnostic Clinic
            </span>
          </div>
        </button>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center space-x-6 lg:space-x-8">
          <nav className="flex items-center space-x-4 lg:space-x-6 text-sm font-semibold">
            {NAV_LINKS.map(link => (
              <button key={link.id} type="button" onClick={() => go(link.id)} className={linkClass(link.id)}>
                {link.label}
              </button>
            ))}
          </nav>

          {user ? (
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => go('dashboard')}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-surface px-2.5 py-1.5 text-fine font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-brand-100 text-brand-700">
                  <User className="w-3 h-3" />
                </span>
                <span className="whitespace-nowrap">{user.firstName}</span>
              </button>
              <button
                type="button"
                onClick={logout}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border-0 bg-brand-500 px-3 py-2 text-fine font-semibold text-white transition-colors hover:bg-brand-600"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => go('login')}
                className="cursor-pointer whitespace-nowrap border-0 bg-transparent text-note font-semibold text-slate-600 transition-colors hover:text-brand-600"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => go('register')}
                className="cursor-pointer whitespace-nowrap rounded-lg border-0 bg-brand-500 px-3.5 py-2 text-fine font-semibold text-white transition-colors hover:bg-brand-600"
              >
                Create Account
              </button>
            </div>
          )}
          {/* Inside the desktop cluster, not beside it. As a sibling it became a third flex item
              under justify-between and was pinned to the far edge, opening a hole next to the
              Create Account button. [1.39.0] */}
          <ThemeToggle />
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-surface text-slate-600 hover:bg-slate-50 md:hidden"
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile panel */}
      {menuOpen && (
        <div className="md:hidden border-t border-line bg-surface px-4 py-3 space-y-1 animate-fade-in">
          {/* Dark mode was desktop-only, which on a site whose patients book from phones meant
              most of them could not reach it at all. Inside this panel rather than beside it:
              mobile-patient.spec.js selects `header div.md:hidden` and takes the LAST match, so a
              new md:hidden div after this one would silently become the "menu". [1.39.0] */}
          <div className="flex items-center justify-between gap-2 pb-2">
            <span className="text-fine font-semibold text-slate-500">Appearance</span>
            <ThemeToggle />
          </div>
          {NAV_LINKS.map(link => (
            <button
              key={link.id}
              type="button"
              onClick={() => go(link.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold border-0 bg-transparent cursor-pointer ${
                currentTab === link.id ? 'bg-brand-50 text-brand-600' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {link.label}
            </button>
          ))}

          <div className="pt-2 mt-2 border-t border-line space-y-2">
            {user ? (
              <>
                <button
                  type="button"
                  onClick={() => go('dashboard')}
                  className="w-full flex items-center justify-center space-x-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2.5 rounded-lg text-sm font-semibold border-0 cursor-pointer"
                >
                  <User className="w-4 h-4" />
                  <span>{user.firstName}'s Dashboard</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="w-full flex items-center justify-center space-x-2 bg-primary-hover hover:bg-primary-active text-white px-4 py-2.5 rounded-lg text-sm font-semibold border-0 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log Out</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => go('login')}
                  className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 bg-transparent cursor-pointer"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => go('register')}
                  className="w-full bg-primary-hover hover:bg-primary-active text-white px-4 py-2.5 rounded-lg text-sm font-semibold border-0 cursor-pointer"
                >
                  Create Account
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default PublicHeader;
