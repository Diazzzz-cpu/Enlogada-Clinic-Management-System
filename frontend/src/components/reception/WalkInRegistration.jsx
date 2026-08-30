import React, { useState } from 'react';
import { Panel } from '../ui/panel';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import TestPicker from '../booking/TestPicker';
import ReferringPhysicianFields from '../booking/ReferringPhysicianFields';
import api from '../../config/api';
import { useScrollIntoViewOnSet } from '../../hooks/useScrollIntoViewOnSet';
import { validatePatientProfile } from '../../validations/patientValidation';
import { UserPlus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { DateField, BIRTHDATE_YEAR_RANGE } from '../ui/date-field';
import { todayStr } from '../../lib/date';

/**
 * Registering a patient who walked in, and issuing their queue ticket.
 *
 * Extracted from ReceptionistDashboard.jsx, which stood at 1,718 lines against a documented
 * 300-500 rule. Deliberately just the registration panel, not the whole walk-in screen: the
 * "Find Existing Patient" panel above it feeds the page's check-in confirmation, so it belongs
 * to that flow and stays where it is.
 *
 * That boundary only became available once a real bug was fixed. The lookup check-in used to read
 * `visitNotes` — the notes field inside THIS form — so the two flows shared one piece of ambient
 * state and neither could be moved. See the note in confirmCheckIn.
 *
 * Everything here is registration's own: the new patient, the tests chosen in the same pass, the
 * referring doctor, and whether a submit is in flight. `onRegistered` is the only thing that
 * crosses back, so the queue behind this screen refreshes once the visit exists.
 */
const WalkInRegistration = ({ patientTypes, testCatalog, packages = [], onRegistered }) => {
  // The requesting doctor, captured alongside the visit rather than the patient: a referral
  // belongs to one episode of care, not to the person forever.
  const [referringPhysician, setReferringPhysician] = useState('');
  const [referringPhysicianPrc, setReferringPhysicianPrc] = useState('');
  // Tests chosen during walk-in registration, attached in the same flow as the visit. [1.26.0]
  const [walkInTestIds, setWalkInTestIds] = useState([]);
  const [walkInPackageIds, setWalkInPackageIds] = useState([]);
  const [newPatient, setNewPatient] = useState({
    firstName: '',
    lastName: '',
    birthdate: '',
    sex: 'Male',
    address: '',
    contactNumber: '',
    emergencyContact: '',
    email: '',
    patientTypeId: ''
  });
  const [visitNotes, setVisitNotes] = useState('');
  const [registrationSuccess, setRegistrationSuccess] = useState('');
  const [registrationError, setRegistrationError] = useState('');
  // The alert renders at the top of this form and the Register button is at the bottom of it —
  // further apart than a viewport once tests are ticked. Without this the form refuses and,
  // from where the receptionist is looking, nothing happens at all.
  const registrationErrorRef = useScrollIntoViewOnSet(registrationError);
  const [isRegistering, setIsRegistering] = useState(false);
  const selectedPatientTypeName = patientTypes.find(
    (t) => String(t.id) === String(newPatient.patientTypeId)
  )?.name;


  const handleWalkInRegister = async (e) => {
    e.preventDefault();
    setRegistrationSuccess('');
    setRegistrationError('');

    const validationError = validatePatientProfile(newPatient);
    if (validationError) {
      setRegistrationError(validationError);
      return;
    }

    setIsRegistering(true);
    try {
      // 1. Create Patient Profile
      const pRes = await api.post('/patients', newPatient);
      const patient = pRes.data.data.patient;

      // 2. Create Walk-in Visit with Generated Queue Ticket
      const vRes = await api.post('/visits', {
        patientId: patient.id,
        visitType: 'Walk in',
        notes: visitNotes,
        referringPhysician,
        referringPhysicianPrc
      });

      const visit = vRes.data.data.visit;

      // Attach in the same flow. Deliberately after the visit exists and deliberately not fatal:
      // the patient is registered and holds a queue number either way, so a failure here is
      // "tests still to add", not "registration failed" — and telling them to queue again would
      // be the worse outcome.
      let attachedNote = '';
      if (walkInTestIds.length > 0 || walkInPackageIds.length > 0) {
        try {
          // One call carrying both, so the server attaches them in a single transaction. Sending
          // two requests would let the tests land and the package fail, leaving a visit billed for
          // half a workup with the patient already holding a queue ticket.
          await api.post('/tests/visit-tests', {
            patientVisitId: visit.id,
            testIds: walkInTestIds.map((id) => parseInt(id, 10)),
            packageIds: walkInPackageIds.map((id) => parseInt(id, 10)),
          });
          const parts = [
            walkInPackageIds.length
              ? `${walkInPackageIds.length} package${walkInPackageIds.length === 1 ? '' : 's'}`
              : null,
            walkInTestIds.length
              ? `${walkInTestIds.length} test${walkInTestIds.length === 1 ? '' : 's'}`
              : null,
          ].filter(Boolean);
          attachedNote = ` ${parts.join(' and ')} attached.`;
        } catch {
          attachedNote = ' Tests could not be attached — add them from the Active Queue.';
        }
      }

      setRegistrationSuccess(
        `Walk-In registered successfully! Physical Queue Ticket: ${visit.queue_number}.${attachedNote}`
      );

      setNewPatient({
        firstName: '',
        lastName: '',
        birthdate: '',
        sex: 'Male',
        address: '',
        contactNumber: '',
        emergencyContact: '',
        email: '',
        patientTypeId: ''
      });
      setVisitNotes('');
      // Cleared with the rest of the form. A referring physician left in state would follow the
      // next patient registered, attaching a doctor to somebody they never saw.
      setReferringPhysician('');
      setReferringPhysicianPrc('');
      // Cleared with the rest: a test list left in state would follow the next patient registered.
      setWalkInTestIds([]);
      setWalkInPackageIds([]);
      onRegistered?.();
    } catch (err) {
      setRegistrationError(err.response?.data?.message || 'Failed to register walk-in patient');
    } finally {
      setIsRegistering(false);
    }
  };

  return (
              <Panel className="max-w-6xl p-6">
                <div className="border-b border-line pb-3 mb-4">
                  <h2 className="m-0 flex items-center gap-2 text-lead font-bold tracking-tight text-slate-900">
                    <UserPlus className="h-4 w-4 text-brand-600" />
                    <span>Register Walk-In Patient & Generate Physical Ticket</span>
                  </h2>
                </div>

                {registrationSuccess && (
                  <div className="mb-4 alert alert-success">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    <span>{registrationSuccess}</span>
                  </div>
                )}

                {registrationError && (
                  <div ref={registrationErrorRef} role="alert" className="mb-4 alert alert-error">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{registrationError}</span>
                  </div>
                )}

                <form onSubmit={handleWalkInRegister} className="@container space-y-4">
                  {/* Two columns above `@3xl`, split by QUESTION rather than by field count. [1.54.0]

                      CONTAINER queries, not viewport ones. [1.63.0] These were `sm:` and `lg:`,
                      which ask how wide the WINDOW is — the wrong question once this same form
                      also renders in the reception queue's 400px side column. At 1920 the viewport
                      breakpoints all fired, so the narrow column got a three-across field row and
                      rendered "Dela C", "S..." and "0917'". The form now asks how wide ITS OWN
                      container is, and lays out correctly in both places with no prop to thread
                      or duplicate.

                      This was one max-w-3xl column on a screen twice that wide: the right half of
                      a reception terminal sat empty while the form ran off the bottom, so the
                      person registering a patient standing at the desk was scrolling.

                      Left is WHO — the patient record, and the only fields that are required.
                      Right is WHY THEY CAME — what to run, who referred them, what to note. They
                      are answered at different moments of the same conversation, and keeping them
                      apart means the required half is complete and visible before the optional
                      half is even looked at. */}
                  <div className="grid grid-cols-1 gap-x-8 gap-y-4 @3xl:grid-cols-2">
                  <div className="space-y-4">
                  <div className="grid grid-cols-1 @md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="field-label" htmlFor="wi-first">First Name <span className="text-rose-600">*</span></label>
                      <Input
                        id="wi-first"
                        placeholder="Juan"
                        value={newPatient.firstName}
                        onChange={e => setNewPatient({...newPatient, firstName: e.target.value})}
                        disabled={isRegistering}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="field-label" htmlFor="wi-last">Last Name <span className="text-rose-600">*</span></label>
                      <Input
                        id="wi-last"
                        placeholder="Dela Cruz"
                        value={newPatient.lastName}
                        onChange={e => setNewPatient({...newPatient, lastName: e.target.value})}
                        disabled={isRegistering}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 @md:grid-cols-3 gap-4">
                    <div className="space-y-1 sm:col-span-2">
                      <label className="field-label" htmlFor="wi-birthdate">Birthdate <span className="text-rose-600">*</span></label>
                      <DateField
                        id="wi-birthdate"
                        value={newPatient.birthdate}
                        onChange={e => setNewPatient({...newPatient, birthdate: e.target.value})}
                        disabled={isRegistering}
                        max={todayStr()}
                        yearRange={BIRTHDATE_YEAR_RANGE}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="field-label" htmlFor="receptionistdashboard-sex">Sex <span className="text-rose-600">*</span></label>
                      <Select
                        value={newPatient.sex}
                        onValueChange={val => setNewPatient({...newPatient, sex: val})}
                        disabled={isRegistering}
                      >
                        <SelectTrigger className="rounded-xl" id="receptionistdashboard-sex">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 @md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="field-label" htmlFor="wi-contact">Contact Number</label>
                      <Input
                        id="wi-contact"
                        placeholder="09171234567"
                        value={newPatient.contactNumber}
                        onChange={e => setNewPatient({...newPatient, contactNumber: e.target.value})}
                        disabled={isRegistering}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="field-label" htmlFor="receptionistdashboard-patient-type">Patient Type <span className="text-rose-600">*</span></label>
                      <Select
                        value={newPatient.patientTypeId}
                        onValueChange={val => setNewPatient({...newPatient, patientTypeId: val})}
                        disabled={isRegistering}
                      >
                        <SelectTrigger className="rounded-xl" id="receptionistdashboard-patient-type">
                          <SelectValue placeholder="Select patient type" />
                        </SelectTrigger>
                        <SelectContent>
                          {patientTypes.map(t => (
                            <SelectItem key={t.id} value={t.id.toString()}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Shown for every patient type, because a self-paying patient who was referred
                      still needs the doctor on the record — the report goes back to them. Only
                      'Private' makes it mandatory, since at this clinic that type means "a physician
                      sent them". The server enforces the same rule; this mirrors it so the
                      receptionist is not told at submit what could have been said while typing. */}
                  <div className="space-y-1">
                    <label className="field-label" htmlFor="wi-address">Home Address</label>
                    <Input
                      id="wi-address"
                      placeholder="Barangay, City, Province"
                      value={newPatient.address}
                      onChange={e => setNewPatient({...newPatient, address: e.target.value})}
                      disabled={isRegistering}
                    />
                  </div>

                  {/* Where this patient's RESULTS will be sent. [1.60.0]
                      Asked HERE, at the counter, because this is the only moment the patient is
                      standing in front of somebody who can ask. A walk-in has no web account, so
                      before this there was nowhere to record an address for them at all — the
                      clinic could release a report and then have no way to send it. Measured on
                      the day it was added: 54 of 56 active patients had no address of any kind.

                      Optional, and it must stay optional: a patient entitled to their result is
                      never turned away for not having email. */}
                  <div className="space-y-1">
                    <label className="field-label" htmlFor="wi-email">Email for results</label>
                    <Input
                      id="wi-email"
                      type="email"
                      placeholder="juan.delacruz@example.com"
                      value={newPatient.email}
                      onChange={e => setNewPatient({...newPatient, email: e.target.value})}
                      disabled={isRegistering}
                    />
                    <p className="m-0 text-micro text-slate-500">
                      Released reports are sent here. Leave blank if they will collect a printed copy.
                    </p>
                  </div>

                  </div>

                  {/* ── Right: why they came ───────────────────────────────────────────────── */}
                  <div className="space-y-4">
                  {/* Tests, chosen here rather than on a second screen. [1.26.0]
                      Reception used to register the patient, then find them again in the queue to
                      attach anything — two screens for one interaction at the busiest point of the
                      day, and a visit whose second half never happened reaches the cashier as a
                      zero bill. The picker also totals the selection, so the price can be quoted
                      across the desk, and shows any preparation while the patient is still
                      standing there. */}
                  <div className="space-y-1.5">
                    <label className="field-label">
                      Tests Requested
                      <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
                        (optional — can be added later from the queue)
                      </span>
                    </label>
                    <TestPicker
                      tests={testCatalog}
                      selectedIds={walkInTestIds}
                      onToggle={(id) => setWalkInTestIds((prev) => (
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                      ))}
                      packages={packages}
                      selectedPackageIds={walkInPackageIds}
                      onTogglePackage={(id) => setWalkInPackageIds((prev) => (
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                      ))}
                      disabled={isRegistering}
                      maxHeight="max-h-44"
                    />
                  </div>

                  <ReferringPhysicianFields
                    idPrefix="wi-ref"
                    physician={referringPhysician}
                    prc={referringPhysicianPrc}
                    onPhysicianChange={setReferringPhysician}
                    onPrcChange={setReferringPhysicianPrc}
                    required={selectedPatientTypeName === 'Private'}
                    reason={
                      selectedPatientTypeName === 'Private'
                        ? 'A Private patient is one a physician referred, so the record needs to name them.'
                        : null
                    }
                    disabled={isRegistering}
                  />

                  <div className="space-y-1">
                    <label className="field-label" htmlFor="wi-notes">Visit Notes / Referral Reason</label>
                    <Input
                      id="wi-notes"
                      placeholder="Walk-in referral for Abdominal Ultrasound..."
                      value={visitNotes}
                      onChange={e => setVisitNotes(e.target.value)}
                      disabled={isRegistering}
                    />
                  </div>

                  </div>
                  </div>

                  <div className="flex justify-end pt-3">
                    <Button type="submit" className="font-bold text-xs px-6 py-2 rounded-xl" disabled={isRegistering}>
                      {isRegistering ? 'Registering…' : 'Register Walk-In & Issue Queue Ticket'}
                    </Button>
                  </div>
                </form>
              </Panel>
  );
};

export default WalkInRegistration;
