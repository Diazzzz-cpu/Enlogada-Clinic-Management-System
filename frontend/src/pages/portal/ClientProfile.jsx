import React from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import PortalLayout from '../../components/portal/PortalLayout';
import PortalBand from '../../components/portal/PortalBand';
import ProfileCard from '../../components/account/ProfileCard';
import PersonalDetailsPanel from '../../components/account/PersonalDetailsPanel';
import PasswordPanel from '../../components/account/PasswordPanel';
import { Button } from '../../components/ui/button';
import { Panel } from '../../components/ui/panel';

// Module 5: Profile — a client's own account settings (contact info, password). Distinct from
// Module 4 (Patient Management), which covers the `patients` records a client manages — the
// Profile tab — not the `users` account itself. The parts are the staff My Account's
// (components/account/) [1.120.0]; this page supplies the portal's shell and arranges them.
//
// UI/UX Phase 3 dropped the raw resource:action permission strings that sat here, and the
// "Account Type" card went with them: every account that can reach this screen is a Client, so the
// card spent a third of the layout telling each patient the one thing about their account that
// could never be anything else.
//
// [1.81.0] In the portal's own layout, with the header's tabs still one press away. None of them is
// shown as current here (`tab="account"`), and choosing one goes back to it; "Back to the portal"
// returns to the tab the patient came from.
const ClientProfile = ({ onNavigate, onOpenTab }) => (
  <PortalLayout tab="account" onTabChange={onOpenTab} onNavigate={onNavigate} screen="account">
    <div className="space-y-5">
      <PortalBand
        title="My Account"
        subtitle="Your name, contact details, photo and password."
        actions={
          <Button variant="outline" onClick={() => onNavigate?.('dashboard')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to the portal
          </Button>
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <PersonalDetailsPanel />
          <PasswordPanel />
        </div>

        {/* Who the account is, then a plain note: not a card on the dark rail colour, because the
            band above is the one dark thing on this page. On a phone the card comes last, after
            the forms the patient came here to use. */}
        <div className="space-y-5">
          <ProfileCard />
          <Panel className="h-fit space-y-2 p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 flex-shrink-0 text-brand-600" aria-hidden="true" />
              <h2 className="m-0 text-note font-semibold text-ink">Keeping your account safe</h2>
            </div>
            <p className="m-0 text-fine leading-relaxed text-ink-muted">
              Never share your password. If you think someone else has used your account, change it
              straight away.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  </PortalLayout>
);

export default ClientProfile;
