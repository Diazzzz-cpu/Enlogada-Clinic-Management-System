import React from 'react';
import DashboardLayout from '../../components/DashboardLayout';
import AccountSettingsForm from '../../components/AccountSettingsForm';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

// Module 5: Profile — a client's own account settings (contact info, password,
// read-only view of account type). Distinct from Module 4 (Patient Management),
// which covers the `patients` records a client manages, not the `users` account itself.
// The form itself (Account Information + Change Password) now lives in the shared,
// layout-agnostic AccountSettingsForm component — this page supplies the Client-specific
// shell (back button, header).
//
// UI/UX Phase 3 dropped the raw resource:action permission strings that sat here; the "Account
// Type" card holding the role badge is now gone too, and for the same reason taken one step
// further. Every account that can reach this screen is a Client — the staff consoles have their
// own settings page — so the card spent a third of the layout telling each patient the one thing
// about their account that could never be anything else. "Client" is not information to a
// patient; it is the system describing its own data model.
const ClientProfile = ({ onNavigate }) => {
  return (
    <DashboardLayout onNavigate={onNavigate} activeTab="account">
      <div className="flex flex-col space-y-6">

        <div className="flex items-center space-x-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onNavigate?.('dashboard')}
            className="h-9 w-9 p-0 rounded-xl border-gray-200 text-gray-500 hover:text-brand-600 hover:border-brand-500"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 m-0">My Account</h1>
            <p className="text-xs text-gray-500 m-0">Manage your contact details, photo, and password.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left column: editable settings */}
          <div className="lg:col-span-2">
            <AccountSettingsForm />
          </div>

          {/* Right column: read-only role/permissions */}
          <div className="space-y-6">
            <Card className="border-line bg-rail text-white rounded-2xl overflow-hidden p-5 space-y-2">
              <div className="flex items-center space-x-2 text-brand-600">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="font-bold text-sm text-white m-0">Account Security</h3>
              </div>
              <p className="text-rail-ink-soft text-xs leading-relaxed m-0">
                Never share your password. If you suspect unauthorized access to your account, change your password immediately.
              </p>
            </Card>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
};

export default ClientProfile;
