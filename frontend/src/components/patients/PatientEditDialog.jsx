import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import api from '../../config/api';
import { validatePatientProfile } from '../../validations/patientValidation';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { DateField, BIRTHDATE_YEAR_RANGE } from '../ui/date-field';
import { todayStr } from '../../lib/date';
import { toastSuccess } from '../../lib/toast';

/**
 * Correcting a patient's details. [1.24.0]
 *
 * `PUT /patients/:id` has existed since the beginning and nothing on any staff screen ever called
 * it, so a misspelt surname or a wrong birthdate could only be fixed in the database. That is not
 * merely an inconvenience: diagnostic reference ranges are banded by age and by sex, so a patient
 * carrying the wrong birthdate has every result on their file interpreted against the wrong band,
 * and the only people who could see the mistake had no way to correct it.
 *
 * ── Why birthdate and sex are set apart from the rest ─────────────────────────────────────────
 * Changing an address is administrative. Changing a birthdate or a sex re-interprets results that
 * have already been released and may already have been acted on. They are grouped separately,
 * warned about when touched, and the change is written to the audit log with its before-and-after
 * — a log entry saying only "patient updated" does not answer the question that gets asked
 * afterwards, which is always what the record said before.
 */
const FIELDS = ['patientTypeId', 'firstName', 'lastName', 'birthdate', 'sex', 'address', 'contactNumber', 'emergencyContact', 'email'];

/** A DATE arriving as a UTC instant, as the calendar date an <input type="date"> wants. */
const toDateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fromPatient = (patient) => ({
  patientTypeId: patient?.patient_type_id ? String(patient.patient_type_id) : '',
  firstName: patient?.first_name || '',
  lastName: patient?.last_name || '',
  birthdate: toDateInput(patient?.birthdate),
  sex: patient?.sex || '',
  address: patient?.address || '',
  contactNumber: patient?.contact_number || '',
  emergencyContact: patient?.emergency_contact || '',
  email: patient?.email || '',
});

const PatientEditDialog = ({ open, onOpenChange, patient, patientTypes = [], onSaved }) => {
  const original = useMemo(() => fromPatient(patient), [patient]);
  const [form, setForm] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset whenever a different patient is opened, so the form never shows the previous one's
  // details against this one's name.
  useEffect(() => {
    if (!open) return;
    setForm(original);
    setError('');
    setSaving(false);
  }, [open, original]);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  const changed = FIELDS.filter((k) => form[k] !== original[k]);
  const clinicalChanged = changed.filter((k) => k === 'birthdate' || k === 'sex');

  const submit = async (e) => {
    e.preventDefault();
    if (saving || changed.length === 0) return;

    const invalid = validatePatientProfile(form);
    if (invalid) {
      setError(invalid);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/patients/${patient.id}`, {
        patientTypeId: parseInt(form.patientTypeId, 10),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        birthdate: form.birthdate,
        sex: form.sex,
        address: form.address.trim(),
        contactNumber: form.contactNumber.trim(),
        emergencyContact: form.emergencyContact.trim(),
        email: form.email.trim(),
      });
      const saved = res.data.data.patient;
      onSaved?.(saved);
      onOpenChange(false);
      // Names the patient, because this dialog is opened from a list and the person who just
      // corrected a record needs to know WHICH record took the change — a bare "Saved" on a
      // screen of forty patients confirms nothing worth confirming.
      toastSuccess(`${saved.first_name} ${saved.last_name}'s record updated.`);
    } catch (err) {
      // 404 here is the department scope, not a missing record: an out-of-scope patient answers
      // 404 rather than 403 precisely so the response does not confirm they exist.
      setError(
        err.response?.status === 404
          ? 'This record is outside the departments you cover, so it cannot be edited here.'
          : err.response?.data?.message || 'Could not save these changes. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!patient) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Correct Patient Details</DialogTitle>
          <DialogDescription>
            {patient.first_name} {patient.last_name} · PT-{patient.id}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {/* Clinical fields first and fenced off, because they are the ones with consequences
              beyond this record. */}
          <div className="space-y-3 rounded-xl border border-line bg-sunken p-3">
            <p className="m-0 text-micro font-semibold uppercase tracking-[0.08em] text-slate-500">
              Used to interpret results
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="patienteditdialog-birthdate" className="field-label">Birthdate <span className="text-rose-600">*</span></label>
                {/* max=today: the markup accepted a future birthdate on all four of these
                    fields, and a birthdate re-interprets results that have already been
                    released. yearRange gives month/year dropdowns — paging a month at a time
                    to 1962 is some 770 clicks. */}
                <DateField id="patienteditdialog-birthdate"
                  value={form.birthdate}
                  disabled={saving}
                  onChange={(e) => set('birthdate')(e.target.value)}
                  max={todayStr()}
                  yearRange={BIRTHDATE_YEAR_RANGE}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="field-label" htmlFor="patienteditdialog-sex">Sex <span className="text-rose-600">*</span></label>
                <Select value={form.sex} onValueChange={set('sex')} disabled={saving}>
                  <SelectTrigger className="rounded-xl" id="patienteditdialog-sex"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {clinicalChanged.length > 0 && (
              <div role="alert" className="alert alert-warning">
                <AlertTriangle />
                <span>
                  Diagnostic reference ranges are banded by age and sex. Changing{' '}
                  {clinicalChanged.length === 2 ? 'these' : 'this'} re-interprets results already on
                  this patient&apos;s file. The change is recorded against your account.
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="patienteditdialog-first-name" className="field-label">First Name <span className="text-rose-600">*</span></label>
              <Input id="patienteditdialog-first-name" value={form.firstName} disabled={saving} onChange={(e) => set('firstName')(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="patienteditdialog-last-name" className="field-label">Last Name <span className="text-rose-600">*</span></label>
              <Input id="patienteditdialog-last-name" value={form.lastName} disabled={saving} onChange={(e) => set('lastName')(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-1">
            <label className="field-label" htmlFor="patienteditdialog-patient-type">Patient Type <span className="text-rose-600">*</span></label>
            <Select value={form.patientTypeId} onValueChange={set('patientTypeId')} disabled={saving}>
              <SelectTrigger className="rounded-xl" id="patienteditdialog-patient-type"><SelectValue placeholder="Select patient type" /></SelectTrigger>
              <SelectContent>
                {patientTypes.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label htmlFor="patienteditdialog-contact-number" className="field-label">Contact Number</label>
            <Input id="patienteditdialog-contact-number" value={form.contactNumber} disabled={saving} onChange={(e) => set('contactNumber')(e.target.value)} placeholder="09171234567" />
          </div>

          <div className="space-y-1">
            <label htmlFor="patienteditdialog-home-address" className="field-label">Home Address</label>
            <Input id="patienteditdialog-home-address" value={form.address} disabled={saving} onChange={(e) => set('address')(e.target.value)} placeholder="Barangay, City, Province" />
          </div>

          {/* Where this patient's RESULTS go. [1.60.0] Most patients here are walk-ins with no
              web account, and before this there was nowhere to record an address for them — so
              the clinic could release a report and had no way to send it. Optional: a patient
              entitled to their result must never be turned away for not having email. */}
          <div className="space-y-1">
            <label htmlFor="patienteditdialog-email" className="field-label">Email for results</label>
            <Input
              id="patienteditdialog-email"
              type="email"
              value={form.email}
              disabled={saving}
              onChange={(e) => set('email')(e.target.value)}
              placeholder="juan.delacruz@example.com"
            />
            <p className="m-0 text-micro text-slate-500">
              Released reports are sent here. Leave blank if they will collect a printed copy.
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="patienteditdialog-emergency-contact" className="field-label">Emergency Contact</label>
            <Input id="patienteditdialog-emergency-contact" value={form.emergencyContact} disabled={saving} onChange={(e) => set('emergencyContact')(e.target.value)} />
          </div>

          {error && (
            <div role="alert" className="alert alert-error">
              <AlertCircle />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
            <span className="text-micro text-slate-500">
              {changed.length === 0
                ? 'No changes yet'
                : `${changed.length} field${changed.length === 1 ? '' : 's'} changed`}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              {/* Inert until something differs: a save that writes the same values still produces
                  a write, and on a record this sensitive an audit trail of no-op edits is noise
                  in the one log somebody will read during an investigation. */}
              <Button type="submit" loading={saving} disabled={changed.length === 0}>
                Save corrections
              </Button>
            </span>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default PatientEditDialog;
