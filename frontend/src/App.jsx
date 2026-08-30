import React, { useState, useEffect } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GOOGLE_CLIENT_ID, isGoogleAuthConfigured } from './config/googleAuth';
import { CONSOLE, consoleForNav, defaultNavForRoles } from './config/navigation';
import Home from './pages/public/Home';
import AboutUs from './pages/public/AboutUs';
import ServicesPage from './pages/public/ServicesPage';
import PrivacyPolicy from './pages/public/PrivacyPolicy';
import TermsOfService from './pages/public/TermsOfService';
import AuthPage from './pages/auth/AuthPage';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import ClientDashboard from './pages/portal/ClientDashboard';
import ClientProfile from './pages/portal/ClientProfile';
import ReceptionistDashboard from './pages/clinic/ReceptionistDashboard';
import CashierDashboard from './pages/clinic/CashierDashboard';
import DiagnosticDashboard from './pages/clinic/DiagnosticDashboard';
import AdminDashboard from './pages/admin/AdminDashboard';
import ServicesCatalog from './pages/admin/ServicesCatalog';
import StaffAccountSettings from './pages/StaffAccountSettings';
import ReceiptView from './pages/ReceiptView';

// Read a one-time deep-link param from the URL (e.g. an emailed password-reset link) without
// introducing a router — this app deliberately has none (see PROJECT_STRUCTURE.md). Read once
// on initial mount only; nothing else in the app reads or writes the URL.
const getInitialResetToken = () => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('reset_token');
};

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

const MainApp = () => {
  const { user, loading } = useAuth();
  const [resetToken] = useState(getInitialResetToken);
  const [receiptNumber, setReceiptNumber] = useState(getInitialReceipt);
  const [currentTab, setCurrentTab] = useState(() => (getInitialResetToken() ? 'reset-password' : 'home')); // 'home', 'services', 'about', 'login', 'register', 'forgot-password', 'reset-password', 'dashboard', 'account'
  const [activeNav, setActiveNav] = useState(null); // Active nav in staff/admin sidebar

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
    if (!activeNav || !consoleForNav(activeNav, roles, permissions, departments)) {
      setActiveNav(defaultNavForRoles(roles, permissions, departments));
    }
    // activeNav is deliberately not a dependency: this corrects the destination on sign-in and
    // on a role change, not on every navigation the user makes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, roleKey]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center space-y-3">
        <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm font-semibold text-gray-500">Loading Enlogada Clinic...</span>
      </div>
    );
  }

  const handleNavigate = (tab) => {
    setCurrentTab(tab);
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
      return <Home onNavigate={handleNavigate} />;
    }
    if (currentTab === 'register') {
      return <AuthPage key={currentTab} initialMode="register" onNavigate={handleNavigate} />;
    }
    if (currentTab === 'forgot-password') {
      return <ForgotPassword onNavigate={handleNavigate} />;
    }
    if (currentTab === 'reset-password') {
      return <ResetPassword token={resetToken} onNavigate={handleNavigate} />;
    }
    // Default fallback to login
    return <AuthPage key={currentTab} initialMode="login" onNavigate={handleNavigate} />;
  }

  // If user IS logged in
  const roles = user.roles || [];
  // Permissions gate navigation alongside roles — see canSee in config/navigation.js.
  const permissions = user.permissions || [];
  const departments = user.departments ?? null;

  // Client has no sidebar console; it keeps its own public-style shell and tab model.
  if (roles.includes('Client')) {
    if (currentTab === 'services') return <ServicesPage onNavigate={handleNavigate} />;
    if (currentTab === 'about') return <AboutUs onNavigate={handleNavigate} />;
    if (currentTab === 'account') return <ClientProfile onNavigate={handleNavigate} />;
    return <ClientDashboard onNavigate={handleNavigate} />;
  }

  // Every SidebarLayout-based role can reach a shared, self-service account page via the
  // sidebar's user-info block — see StaffAccountSettings.jsx. Checked before the nav routing
  // below since it applies uniformly and is not a role-gated destination.
  if (activeNav === 'account') {
    return <StaffAccountSettings onSelectNav={setActiveNav} />;
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
  const resolvedNav = consoleForNav(activeNav, roles, permissions, departments) ? activeNav : defaultNavForRoles(roles, permissions, departments);
  const targetConsole = consoleForNav(resolvedNav, roles, permissions, departments);

  switch (targetConsole) {
    case CONSOLE.RECEPTION:
      return <ReceptionistDashboard activeNav={resolvedNav} onSelectNav={setActiveNav} />;
    case CONSOLE.CASHIER:
      return <CashierDashboard activeNav={resolvedNav} onSelectNav={setActiveNav} />;
    case CONSOLE.DIAGNOSTIC:
      return <DiagnosticDashboard activeNav={resolvedNav} onSelectNav={setActiveNav} />;
    case CONSOLE.SERVICES_CATALOG:
      return <ServicesCatalog activeNav={resolvedNav} onSelectNav={setActiveNav} />;
    case CONSOLE.ADMIN:
      return <AdminDashboard activeNav={resolvedNav} onSelectNav={setActiveNav} />;
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
  const app = (
    <AuthProvider>
      <MainApp />
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
