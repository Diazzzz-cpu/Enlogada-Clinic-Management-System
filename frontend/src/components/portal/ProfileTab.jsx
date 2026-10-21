import React from 'react';
import { Inbox, Pencil, ShieldCheck, UserPlus, UserRound, Users } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import ProfileFormDialog from './ProfileFormDialog';

const listFormat = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

/**
 * The patient being viewed, and the family on this account.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 *
 * Plain panels, the Flat colouring's one container. [1.82.0] It was three cards, one of them on
 * the rail colour: a second dark block under the band, which is meant to be the only one.
 */
export default function ProfileTab({ profiles, reference, invitations = null, onAcceptInvitation }) {
  // The providers the clinic is accredited with, from the list the booking dialog offers. This
  // card used to name "1CoopHealth" in a sentence typed into this file, and would have gone on
  // naming it whatever the clinic's accreditations became. [1.80.0]
  const providers = (reference?.hmoProviders || []).map((p) => p.name).filter(Boolean);
  const accredited = providers.length ? listFormat.format(providers) : '';

  const patient = profiles.selected;
  const facts = patient
    ? [
        ['Patient ID', `PT-${patient.id}`],
        ['Birthdate', new Date(patient.birthdate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })],
        ['Contact number', patient.contact_number || 'None on file'],
      ]
    : [];

  // [1.136.0] Records the clinic invited this account to accept, beside the family they join.
  const waiting = invitations?.needsEmailCheck
    ? [{ key: 'email-check', title: 'Confirm your email to see a record waiting', action: 'Confirm email', invitation: { emailCheck: true } }]
    : (invitations?.invitations || []).map((inv) => ({
        key: inv.id, title: `A record is waiting: ${inv.patientName}`, action: 'Review', invitation: inv,
      }));

  return (
        <div className="space-y-4">
          {waiting.map((w) => (
            <Panel key={w.key} data-testid="waiting-record" className="overflow-hidden">
              <PanelBody className="flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="flex items-center gap-2.5">
                  <Inbox className="h-4 w-4 flex-shrink-0 text-azure-600" aria-hidden="true" />
                  <span className="text-note font-semibold text-ink">{w.title}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  aria-label={w.invitation.patientName ? `Review ${w.invitation.patientName}'s record` : undefined}
                  onClick={() => onAcceptInvitation?.(w.invitation)}
                >
                  {w.action}
                </Button>
              </PanelBody>
            </Panel>
          ))}

          {patient && (
            <Panel className="overflow-hidden">
              <PanelHeader
                title={`${patient.first_name} ${patient.last_name}`}
                description="The patient whose bookings and results you are viewing."
                icon={UserRound}
                actions={
                  <Button type="button" variant="outline" size="sm" onClick={profiles.openEdit} aria-label="Edit patient profile">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit
                  </Button>
                }
              />
              <PanelBody flush>
                <dl className="m-0 divide-y divide-line">
                  {facts.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-3 px-5 py-3">
                      <dt className="text-fine text-ink-muted">{label}</dt>
                      <dd className="m-0 text-note font-semibold text-ink">{value}</dd>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 px-5 py-3">
                    <dt className="text-fine text-ink-muted">Billing category</dt>
                    <dd className="m-0">
                      <Badge variant="secondary" className="bg-brand-50 text-meta font-bold text-brand-700">
                        {patient.patient_type_name}
                      </Badge>
                    </dd>
                  </div>
                </dl>
              </PanelBody>
            </Panel>
          )}

          {/* Family on this account. [1.81.0] Adding a profile sat in a bar above every tab, beside
              the switcher. The switcher is the header's "Viewing" chip now, and adding someone
              belongs here, next to the list it adds to. The list marks who is being viewed but
              does not switch: a second switcher beside the chip would be the same control twice. */}
          <Panel data-testid="portal-family" className="overflow-hidden">
            <PanelHeader
              title="Family on this account"
              icon={Users}
              actions={
                <Button type="button" size="sm" onClick={() => profiles.openAdd(true)}>
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add a profile
                </Button>
              }
            />
            <PanelBody flush>
              {profiles.profiles.length === 0 ? (
                <p className="m-0 px-5 py-4 text-fine text-ink-muted">
                  No patient profiles yet. Add yourself first, then anyone you book for.
                </p>
              ) : (
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {profiles.profiles.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-note font-semibold text-ink">{p.first_name} {p.last_name}</span>
                        <span className="block text-fine text-ink-muted">
                          {p.patient_type_name || 'Patient'}
                          {/* Put here by the clinic, by invitation, rather than added by hand. [1.136.0] */}
                          {p.from_clinic && <span data-testid="family-from-clinic"> · From the clinic</span>}
                        </span>
                      </span>
                      {String(p.id) === String(profiles.selectedId) && (
                        <span className="flex-shrink-0 text-fine font-semibold text-brand-700">Viewing</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>

          <Panel tone="brand" className="p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 flex-shrink-0 text-brand-700" aria-hidden="true" />
              <h2 className="m-0 text-note font-semibold text-ink">HMO coverage</h2>
            </div>
            <p className="m-0 mt-2 text-fine leading-relaxed text-ink-muted">
              {accredited ? (
                <>Enlogada Clinic is accredited with <strong className="text-ink">{accredited}</strong>. Choose your provider when you book, and add a photo of your HMO card.</>
              ) : (
                <>Choose your HMO provider when you book, and add a photo of your HMO card. The clinic confirms your coverage before your visit.</>
              )}
            </p>
          </Panel>

          <ProfileFormDialog profiles={profiles} reference={reference} mode="add" />
          <ProfileFormDialog profiles={profiles} reference={reference} mode="edit" />
        </div>
  );
}
