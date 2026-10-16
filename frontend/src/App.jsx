import React, { Suspense, startTransition, useState, useEffect, useCallback } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GOOGLE_CLIENT_ID, isGoogleAuthConfigured } from './config/googleAuth';
import { CONSOLE, consoleForNav, landingNavForRoles } from './config/navigation';
import { lazyScreen } from './lib/lazyScreen';
import Home from './pages/public/Home';
import AboutUs from './pages/public/AboutUs';
import ServicesPage from './pages/public/ServicesPage';
import PrivacyPolicy from './pages/public/PrivacyPolicy';
import TermsOfService from './pages/public/TermsOfService';

// The public pages above come with the app. Every other screen is fetched the first time someone
// opens it. [1.87.0] It was all one file of about 1.5 MB, so a patient opening Home on a phone
// downloaded every console, chart and admin screen before the page could draw: 407 KB even
// compressed. Sign-in is split off as well, because most visitors to Home never sign in.
const AuthPage = lazyScreen(() => import('./pages/auth/AuthPage'));
const ClientDashboard = lazyScreen(() => import('./pages/portal/ClientDashboard'));
const ClientProfile = lazyScreen(() => import('./pages/portal/ClientProfile'));
const ReceptionistDashboard = lazyScreen(() => import('./pages/clinic/ReceptionistDashboard'));
const CashierDashboard = lazyScreen(() => import('./pages/clinic/CashierDashboard'));
const DiagnosticDashboard = lazyScreen(() => import('./pages/clinic/DiagnosticDashboard'));
const AdminDashboard = lazyScreen(() => import('./pages/admin/AdminDashboard'));
const ServicesCatalog = lazyScreen(() => import('./pages/admin/ServicesCatalog'));
const StaffAccountSettings = lazyScreen(() => import('./pages/StaffAccountSettings'));
const Today = lazyScreen(() => import('./pages/Today'));
const ReceiptView = lazyScreen(() => import('./pages/ReceiptView'));
const VerifyReport = lazyScreen(() => import('./pages/public/VerifyReport'));

// An emailed password-reset LINK, from before [1.73.0] replaced links with a 6-digit code. Some are
// still sitting in inboxes. One opens the forgot-password card with a word of explanation, and its
// token is stripped from the address bar: it no longer does anything, and it should not sit in
// history looking as though it might. Read once, on the first render, without a router — this app
// deliberately has none (see PROJECT_STRUCTURE.md).
const hadLegacyResetLink = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('reset_token');

const LEGACY_RESET_NOTICE =
  'Reset links are no longer used. Enter your email below and we will send you a 6-digit code instead.';

/**
 * `?receipt=RCT-…` — one receipt, on its own page, in its own tab. [1.52.0]
 *
 * The second deep link in the app, and it follows the first exactly. A receipt needs an ADDRESS:
 * a cashier keeps one open beside the till while billing the next patient, and a patient ringing
 * months later about a printed slip has to be findable by the number on it. A dialog has no
 * address; a URL does.
 *
 * Only the receipt number travels in the URL. The session comes from localStorage, which is
 * already shared across tabs of the same origin — putting a token in a link would carry it into
 * browser history, a chat message and any screenshot of the address bar.
 */
const getInitialReceipt = () => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('receipt');
};

/**
 * `?verify=ABCDE-12345` — is this report genuine? [1.126.0]
 *
 * The QR on a patient's copy opens this, usually on a stranger's phone: an employer, a school, an
 * HMO. Open to everyone, signed in or not, and it takes the whole page for the same reason the
 * receipt does. An empty string (the footer's "Verify a report") opens the page with no code yet;
 * null means the page is not open.
 */
const getInitialVerify = () => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.has('verify') ? params.get('verify') || '' : null;
};

// The one loading screen: while the session is checked, and while a screen's code arrives the
// first time it is opened. [1.87.0]
const AppLoading = () => (
  <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center space-y-3">
    <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
    <span className="text-sm font-semibold text-gray-500">Loading Enlogada Clinic...</span>
  </div>
);

const MainApp = () => {
  const { user, loading } = useAuth();
  const [legacyResetLink] = useState(hadLegacyResetLink);
  const [receiptNumber, setReceiptNumber] = useState(getInitialReceipt);
  const [verifyCode, setVerifyCode] = useState(getInitialVerify);
  const [currentTab, setCurrentTab] = useState(() => (hadLegacyResetLink() ? 'forgot-password' : 'home')); // 'home', 'services', 'about', 'login', 'register', 'forgot-password', 'dashboard', 'account'
  const [activeNav, setActiveNav] = useState(null); // Active nav in staff/admin sidebar
  // A section of the destination page to scroll to on arrival — the header's FAQ link sends a
  // visitor to Home's #faq from any other page. [1.72.0] Cleared by any plain navigation.
  const [pendingSection, setPendingSection] = useState(null);
  // What a Today button asked the screen it opens to do on arrival — open this booking's check-in,
  // this visit's tests, the reports not yet sent. [1.77.0] Set only by that navigation and cleared by
  // any other (the sidebar passes an id alone), so an intent is acted on once and never re-fires.
  const [navIntent, setNavIntent] = useState(null);
  // Both navigations are transitions [1.87.0], so the screen being left stays on show while the
  // next one's code arrives, instead of the whole app blinking to the loading screen.
  const selectNav = useCallback((navId, intent = null) => {
    startTransition(() => {
      setActiveNav(navId);
      setNavIntent(intent);
    });
  }, []);

  // The patient portal's tab. [1.81.0] Held here, above ClientDashboard, so going to My Account
  // and back lands on the tab the patient left; the dashboard used to forget it on every page
  // change. A different account signing in on the same browser starts on Home.
  const [portalTab, setPortalTab] = useState('home');
  const accountKey = user?.id ?? user?.email ?? null;
  useEffect(() => {
    setPortalTab('home');
  }, [accountKey]);

  // Take a legacy reset token out of the address bar once it has been noticed. [1.73.0]
  useEffect(() => {
    if (!legacyResetLink) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('reset_token');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [legacyResetLink]);

  // Land each user on a destination they actually hold. This used to default to 'dashboard' —
  // an Admin/SuperAdmin-only destination — so every other role signed in pointing at an id it
  // did not own, and the sidebar highlighted nothing on arrival. Also re-homes anyone whose
  // current destination stops being reachable (e.g. a role was revoked mid-session).
  const roleKey = (user?.roles || []).join(',');
  useEffect(() => {
    if (!user || (user.roles || []).includes('Client')) return;
    const roles = user.roles || [];
    const permissions = user.permissions || [];
    // null = unrestricted (Admin/SuperAdmin); an array = only these modalities. Distinct on purpose.
    const departments = user.departments ?? null;
    if (activeNav === 'account') return;
    // Today, for every member of staff, since [1.77.0].
    if (!activeNav || !consoleForNav(activeNav, roles, permissions, departments)) {
      setActiveNav(landingNavForRoles(roles, permissions, departments));
    }
    // activeNav is deliberately not a dependency: this corrects the destination on sign-in and
    // on a role change, not on every navigation the user makes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, roleKey]);

  if (loading) {
    return <AppLoading />;
  }

  const handleNavigate = (tab, { section = null } = {}) => {
    // Into the verification page, or out of it: leaving takes its code out of the address bar.
    if (tab === 'verify') {
      setVerifyCode('');
      return;
    }
    if (verifyCode !== null) {
      setVerifyCode(null);
      window.history.replaceState({}, '', window.location.pathname);
    }
    startTransition(() => {
      setCurrentTab(tab);
      setPendingSection(section);
    });
  };

  /**
   * A receipt link, opened by anyone who may read billing.
   *
   * Rendered BEFORE the signed-out branch and before any console, because this page is the whole
   * point of the tab — it must not land the reader on a dashboard they then have to navigate out
   * of.
   *
   * Open to PATIENTS as well as staff [1.52.0]. Being able to print the receipt for money you paid
   * is not a staff privilege — it is what a receipt is for, and it is what an HMO or an employer
   * asks a patient to produce. paymentService.getReceipt decides who may read which one: staff on
   * billing:read, a Client on ownership. Anyone else's receipt is a 403 the page reports plainly.
   *
   * Closing clears the param as well as the state, so a refresh of a tab the reader has closed
   * out of does not silently reopen the receipt.
   */
  if (verifyCode !== null) {
    return <VerifyReport initialCode={verifyCode} onNavigate={handleNavigate} />;
  }

  if (receiptNumber && user) {
    return (
      <ReceiptView
        receiptNumber={receiptNumber}
        onClose={() => {
          setReceiptNumber(null);
          window.history.replaceState({}, '', window.location.pathname);
        }}
      />
    );
  }

  // If user is NOT logged in
  if (!user) {
    if (currentTab === 'services') {
      return <ServicesPage onNavigate={handleNavigate} />;
    }
    if (currentTab === 'privacy') {
      return <PrivacyPolicy onNavigate={handleNavigate} />;
    }
    if (currentTab === 'terms') {
      return <TermsOfService onNavigate={handleNavigate} />;
    }
    if (currentTab === 'about') {
      return <AboutUs onNavigate={handleNavigate} />;
    }
    if (currentTab === 'home') {
      return <Home onNavigate={handleNavigate} section={pendingSection} />;
    }
    if (currentTab === 'register') {
      return <AuthPage mode="register" onNavigate={handleNavigate} />;
    }
    // The back of the sign-in card, like 'register' — the same page, so moving here from Sign In
    // turns the card rather than loading a new screen. [1.73.0]
    if (currentTab === 'forgot-password') {
      return (
        <AuthPage
          mode="forgot-password"
          notice={legacyResetLink ? LEGACY_RESET_NOTICE : undefined}
          onNavigate={handleNavigate}
        />
      );
    }
    // Default fallback to sign-in. Neither AuthPage above carries a `key`, deliberately: sign-in
    // and create-account are the two sides of one card, so moving between them from the header
    // must keep the same page and turn the card rather than rebuild it. See AuthPage.jsx.
    return <AuthPage mode="login" onNavigate={handleNavigate} />;
  }

  // If user IS logged in
  const roles = user.roles || [];
  // Permissions gate navigation alongside roles — see canSee in config/navigation.js.
  const permissions = user.permissions || [];
  const departments = user.departments ?? null;

  // Client has no sidebar console; it has the portal's own shell (PortalLayout) and tabs. The tab
  // lives here rather than in the dashboard, so My Account and back returns to it. [1.81.0]
  if (roles.includes('Client')) {
    if (currentTab === 'services') return <ServicesPage onNavigate={handleNavigate} />;
    if (currentTab === 'about') return <AboutUs onNavigate={handleNavigate} />;
    if (currentTab === 'account') {
      return (
        <ClientProfile
          onNavigate={handleNavigate}
          onOpenTab={(tab) => { setPortalTab(tab); handleNavigate('dashboard'); }}
        />
      );
    }
    return <ClientDashboard onNavigate={handleNavigate} tab={portalTab} onTabChange={setPortalTab} />;
  }

  // Every SidebarLayout-based role can reach a shared, self-service account page via the
  // sidebar's user-info block — see StaffAccountSettings.jsx. Checked before the nav routing
  // below since it applies uniformly and is not a role-gated destination.
  if (activeNav === 'account') {
    return <StaffAccountSettings onSelectNav={selectNav} />;
  }

  if (roles.includes('SuperAdmin') || roles.includes('Admin')) {
    if (currentTab === 'services') return <ServicesPage onNavigate={handleNavigate} />;
    if (currentTab === 'about') return <AboutUs onNavigate={handleNavigate} />;
  }

  // Route by DESTINATION, not by a fixed role priority. A user holding several operational
  // roles reaches every console their roles grant; previously the first matching role won and
  // the rest of their sidebar was decorative (see config/navigation.js for the full history).
  //
  // Resolve to a destination this user genuinely holds before rendering. The effect above
  // settles `activeNav` too, but only after the first paint — consoles derive their category
  // and mode straight from this prop, so they must never receive the unset value. An
  // unreachable destination falls back to the user's own default rather than rendering someone
  // else's console, so a stale activeNav cannot leak a screen either.
  // Permissions as well as roles: the router must refuse exactly what the sidebar hides, or a
  // revoked permission would leave a screen reachable by a stale nav id.
  const resolvedNav = consoleForNav(activeNav, roles, permissions, departments) ? activeNav : landingNavForRoles(roles, permissions, departments);
  const targetConsole = consoleForNav(resolvedNav, roles, permissions, departments);

  switch (targetConsole) {
    case CONSOLE.TODAY:
      return <Today onSelectNav={selectNav} />;
    case CONSOLE.RECEPTION:
      return <ReceptionistDashboard activeNav={resolvedNav} onSelectNav={selectNav} intent={navIntent} />;
    case CONSOLE.CASHIER:
      return <CashierDashboard activeNav={resolvedNav} onSelectNav={selectNav} />;
    case CONSOLE.DIAGNOSTIC:
      return <DiagnosticDashboard activeNav={resolvedNav} onSelectNav={selectNav} intent={navIntent} />;
    case CONSOLE.SERVICES_CATALOG:
      return <ServicesCatalog activeNav={resolvedNav} onSelectNav={selectNav} />;
    case CONSOLE.ADMIN:
      return <AdminDashboard activeNav={resolvedNav} onSelectNav={selectNav} />;
    default:
      break;
  }

  // Fallback for unauthorized roles
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="space-y-2 rounded-xl border border-line bg-surface p-6 text-center shadow-raised">
        <h2 className="text-lg font-bold text-red-500">Unauthorized Profile Access</h2>
        <p className="text-sm text-gray-500">Your account does not have any clinical roles assigned.</p>
      </div>
    </div>
  );
};

function App() {
  // The boundary for every screen fetched on first use [1.87.0]. Its fallback is the same loading
  // screen as the session check, so a first visit and a sign-in look alike.
  const app = (
    <AuthProvider>
      <Suspense fallback={<AppLoading />}>
        <MainApp />
      </Suspense>
    </AuthProvider>
  );

  // Mount the provider only when a real client ID exists. It loads Google's Identity Services
  // script on mount, and with no usable client ID that script can only fail — so when Google
  // Sign-In is unconfigured we skip it entirely and LoginForm.jsx renders its explanatory notice
  // in place of the button (rendering <GoogleLogin> outside this provider would throw).
  if (!isGoogleAuthConfigured) {
    return app;
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {app}
    </GoogleOAuthProvider>
  );
}

export default App;
