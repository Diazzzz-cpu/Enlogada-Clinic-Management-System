import React from 'react';
import { Panel, PanelBody } from '../ui/panel';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import AvatarUpload from './AvatarUpload';

/** "SuperAdmin" -> "Super Admin"; a Client is a patient everywhere a patient reads it. */
const roleLabel = (role) => (role === 'Client' ? 'Patient' : String(role).replace(/([a-z])([A-Z])/g, '$1 $2'));

/**
 * Who this account is, at a glance: the photo, the name, and what they are here as. [1.120.0]
 *
 * Nothing the forms beside it already show: the email and the contact number are in Personal
 * details, and a card repeating them is the same fact twice on one screen. It sits beside those
 * forms so a saved name is seen to change.
 */
export default function ProfileCard({ className }) {
  const { user } = useAuth();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const roles = (user?.roles || []).map(roleLabel).join(' · ');

  return (
    <Panel className={cn('h-fit', className)} data-testid="profile-card">
      <PanelBody>
        <AvatarUpload>
          <div className="text-center">
            <p className="m-0 text-lead font-semibold text-ink">{name || 'Your account'}</p>
            {roles && <p className="m-0 text-fine text-ink-muted">{roles}</p>}
          </div>
        </AvatarUpload>
      </PanelBody>
    </Panel>
  );
}
