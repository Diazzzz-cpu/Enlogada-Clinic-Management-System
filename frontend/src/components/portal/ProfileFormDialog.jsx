import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { DateField, BIRTHDATE_YEAR_RANGE } from '../ui/date-field';
import { todayStr } from '../../lib/date';

/**
 * Adding a patient profile, or correcting one: one form. [1.82.0]
 *
 * These were AddProfileDialog and EditProfileDialog, two copies of the same eight fields that had
 * already drifted. They shared DOM ids (`clientdashboard-first-name` in both), and the Add copy
 * swapped its button to "Saving…", which CLAUDE.md rules out: the label stays, and `loading`
 * carries the spinner. `mode` picks which half of usePatientProfiles the form reads and writes.
 *
 * No trigger of its own. The Profile tab's "Add a profile" button calls `profiles.openAdd(true)`,
 * and the pencil on the patient's card calls `profiles.openEdit()`.
 *
 * An account owns several profiles — a parent booking for a dependent is the ordinary case — which
 * is why patients are plural everywhere they appear.
 */
/** The mark on a required field. Declared outside the dialog, so it is one component type. */
const Required = () => <span className="text-rose-600">*</span>;

export default function ProfileFormDialog({ profiles, reference, mode }) {
  const editing = mode === 'edit';
  const open = editing ? profiles.showEdit : profiles.showAdd;
  const onOpenChange = editing ? profiles.closeEdit : profiles.openAdd;
  const draft = editing ? profiles.editDraft : profiles.addDraft;
  const setDraft = editing ? profiles.setEditDraft : profiles.setAddDraft;
  const busy = editing ? profiles.editing : profiles.adding;
  const error = editing ? profiles.editError : profiles.addError;
  const onSubmit = editing ? profiles.edit : profiles.add;

  // Ids carry the mode, so the two dialogs never share one even if both are mounted.
  const id = (field) => `${mode}-profile-${field}`;
  const set = (field) => (value) => setDraft({ ...draft, [field]: value });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-slate-900">
            {editing ? 'Edit patient profile' : 'Add a patient profile'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? `Update ${profiles.selected?.first_name || 'this patient'}'s details.`
              : 'For yourself, or someone in your family you book for.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          {error && (
            <div role="alert" className="alert alert-error">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={id('first-name')} className="field-label">First name <Required /></label>
              <Input
                id={id('first-name')}
                placeholder="Juan"
                value={draft.firstName}
                onChange={(e) => set('firstName')(e.target.value)}
                disabled={busy}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={id('last-name')} className="field-label">Last name <Required /></label>
              <Input
                id={id('last-name')}
                placeholder="Dela Cruz"
                value={draft.lastName}
                onChange={(e) => set('lastName')(e.target.value)}
                disabled={busy}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor={id('birthdate')} className="field-label">Birthdate <Required /></label>
              <DateField
                id={id('birthdate')}
                value={draft.birthdate}
                onChange={(e) => set('birthdate')(e.target.value)}
                disabled={busy}
                max={todayStr()}
                yearRange={BIRTHDATE_YEAR_RANGE}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={id('sex')} className="field-label">Sex <Required /></label>
              <Select value={draft.sex} onValueChange={set('sex')} disabled={busy}>
                <SelectTrigger id={id('sex')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={id('contact-number')} className="field-label">Contact number</label>
              <Input
                id={id('contact-number')}
                placeholder="09171234567"
                value={draft.contactNumber}
                onChange={(e) => set('contactNumber')(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={id('billing-category')} className="field-label">Billing category <Required /></label>
              <Select value={draft.patientTypeId} onValueChange={set('patientTypeId')} disabled={busy}>
                <SelectTrigger id={id('billing-category')}>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {(reference?.patientTypes || []).map((type) => (
                    <SelectItem key={type.id} value={type.id.toString()}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={id('address')} className="field-label">Address</label>
            <Input
              id={id('address')}
              placeholder="Barangay, City, Province"
              value={draft.address}
              onChange={(e) => set('address')(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={id('emergency-contact')} className="field-label">Emergency contact</label>
            <Input
              id={id('emergency-contact')}
              placeholder="Name and contact number"
              value={draft.emergencyContact}
              onChange={(e) => set('emergencyContact')(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {editing ? 'Save changes' : 'Save profile'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
