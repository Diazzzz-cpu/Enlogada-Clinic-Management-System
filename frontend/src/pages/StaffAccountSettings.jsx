import React from 'react';
import SidebarLayout from '../components/SidebarLayout';
import PageHeader from '../components/ui/page-header';
import ProfileCard from '../components/account/ProfileCard';
import PersonalDetailsPanel from '../components/account/PersonalDetailsPanel';
import PasswordPanel from '../components/account/PasswordPanel';

// UI/UX Phase 1: every SidebarLayout-based role (Admin/SuperAdmin and all 5 operational
// roles) previously had no way to change their own password or contact info at all — the
// sidebar's user-info block wasn't even a button. Reached via that block regardless of role; the
// backend endpoints it calls (PUT /auth/me, PUT /auth/change-password) already work for any
// authenticated role, so this is purely wiring up the missing frontend affordance.
//
// [1.79.0] It had no page heading, so it was the one staff screen with no <h1>: a screen reader
// user landed on "Profile" at level three with nothing above it. The heading is the name the
// sidebar's account button carries.
//
// [1.120.0] Two columns: who the account is on the left (the photo, the name, the role, the
// sign-in email), and what can be changed on the right. It was one narrow column of forms with
// the rest of a desk screen empty beside it. The same three parts make the patient portal's My
// Account (pages/portal/ClientProfile.jsx), so the two cannot drift apart.
const StaffAccountSettings = ({ onSelectNav }) => (
  <SidebarLayout title="My Account" activeNav="account" onSelectNav={onSelectNav}>
    <div className="max-w-6xl space-y-5">
      <PageHeader
        title="My Account"
        description="Your photo, name, contact details and password."
      />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <ProfileCard className="lg:sticky lg:top-4" />
        <div className="space-y-5">
          <PersonalDetailsPanel />
          <PasswordPanel />
        </div>
      </div>
    </div>
  </SidebarLayout>
);

export default StaffAccountSettings;
