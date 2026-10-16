import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../ui/dialog';
import SlotPicker from './SlotPicker';
import TestPicker from './TestPicker';
import EvidenceUpload from './EvidenceUpload';
import BookingConfirmation from '../BookingConfirmation';
import api from '../../config/api';
import { formatAppointmentDate } from '../../lib/date';
import { DOCUMENT_MAX_EDGE } from '../../lib/cardImage';
import { useEvidenceFile } from '../../hooks/useEvidenceFile';
import { PlusCircle, AlertCircle } from 'lucide-react';

const DOCTOR_REQUEST_IMAGE = { name: 'doctor-request.jpg', maxEdge: DOCUMENT_MAX_EDGE };

const EMPTY_BOOKING = {
  scheduledDate: '',
  scheduledTime: '',
  testIds: [],
  packageIds: [],
  hmoProviderId: '',
  hmoApprovalCode: '',
};

/**
 * Booking a diagnostic appointment, from the patient's own portal.
 *
 * Extracted from ClientDashboard.jsx, which stood at 1,878 lines against a documented 300-500
 * rule. This is the largest single thing that page did and the most self-contained: a wizard with
 * its own steps, its own error surface, its own HMO-card upload and its own submit.
 *
 * It owns its state rather than taking it as props. Passing the twenty-odd values the dialog
 * touches down from the page would have moved the lines without moving the complexity — the page
 * would still have had to reason about `bookingStep` and the card's preview while rendering a
 * results table. What crosses the boundary now is only what genuinely belongs to both: which
 * patient is selected, what the clinic sells, who it is accredited with, and a callback so the
 * page can refresh its lists once a booking exists.
 */
const BookingDialog = ({ selectedProfileId, selectedProfile, testCatalog, packages = [], hmoProviders, onBooked }) => {
  const [showBooking, setShowBooking] = useState(false);
  const [bookingStep, setBookingStep] = useState(1);
  const [isBooking, setIsBooking] = useState(false);
  // The booking's uploads. [1.106.0] The doctor's signed request names the doctor and the tests in
  // the doctor's own hand, so the patient no longer types the doctor's name or clinical notes. An
  // HMO claim needs it and the card; self-pay may attach it and does not have to [1.107.0].
  const cardPhoto = useEvidenceFile();
  const doctorRequest = useEvidenceFile(DOCTOR_REQUEST_IMAGE);
  const [bookingData, setBookingData] = useState(EMPTY_BOOKING);

  // UI/UX Modernization Phase 10: holds the full confirmation payload (not just a success
  // string) so BookingConfirmation.jsx can render a durable QR/reference/queue-ticket card
  // instead of the old plain-text message that auto-closed after 4 seconds.
  const [bookingConfirmation, setBookingConfirmation] = useState(null);
  const [bookingError, setBookingError] = useState('');

  // Slot availability lives in SlotPicker, which fetches it itself. This counter is the one thing
  // the page still needs to say about it: bump it to make the grid refetch after a 409, when the
  // slot the patient chose turned out to have gone.
  const [slotsRefreshKey, setSlotsRefreshKey] = useState(0);


  // The card is identity evidence, so it must never outlive the context it was attached in.
  // Left in state it would follow the patient selector: attach your own card, close the dialog,
  // switch to your child's profile, and their claim is filed against your member number. The
  // doctor's request names the patient too, so it goes with it.
  const clearCard = cardPhoto.clear;
  const clearDoctorRequest = doctorRequest.clear;
  const clearEvidence = useCallback(() => {
    clearCard();
    clearDoctorRequest();
  }, [clearCard, clearDoctorRequest]);

  // Switching patient invalidates any evidence already chosen, for the same reason.
  useEffect(() => {
    clearEvidence();
  }, [selectedProfileId, clearEvidence]);

  // The Self-Pay option carries the string 'none' rather than an empty value, so a bare
  // truthiness check treated self-pay as an HMO selection. Nothing chosen is self-pay too.
  const isHmo = Boolean(bookingData.hmoProviderId) && bookingData.hmoProviderId !== 'none';
  // [1.107.0] When the doctor's request is required: referralService.referralRequirement's rule,
  // said here so the field is marked before the patient submits rather than refused after. A
  // Private patient is one a physician referred, whoever pays.
  const isReferred = selectedProfile?.patient_type_name === 'Private';
  const needsDoctorRequest = isHmo || isReferred;

  const handleBookAppointment = async (e) => {
    e.preventDefault();
    if (isBooking) return; // a second submit while the first is still in flight books twice
    setBookingError('');
    setBookingConfirmation(null);

    const { scheduledDate, scheduledTime, testIds, packageIds, hmoProviderId, hmoApprovalCode } = bookingData;
    if (!scheduledDate || !scheduledTime || (testIds.length === 0 && packageIds.length === 0)) {
      setBookingError('Date, Time, and at least one diagnostic test are required.');
      return;
    }

    const hmo = isHmo
      ? { providerId: parseInt(hmoProviderId, 10), approvalCode: hmoApprovalCode || null }
      : null;

    // The same two rules the server holds (referralService, hmoService), said before the request
    // rather than after it.
    if (needsDoctorRequest && !doctorRequest.file) {
      setBookingError(isHmo
        ? "Please upload your doctor's request / notes — your HMO approves these tests against it."
        : "Please upload your doctor's request / notes — this profile is a Private (doctor-referred) patient.");
      return;
    }
    if (hmo && !cardPhoto.file) {
      setBookingError('Please attach a photo of your HMO card to claim HMO coverage.');
      return;
    }

    setIsBooking(true);
    try {
      // One call. The appointment, its tests and any HMO claim are written in a single
      // transaction server-side — previously these were three sequential requests, and a failure
      // after the first left a booking the patient had been told did not happen, holding a slot
      // their own retry was then refused.
      //
      // Always multipart since [1.106.0], with or without a file: one shape for every booking, so
      // attaching the optional doctor's request to a self-pay booking changes nothing else.
      const fd = new FormData();
      fd.append('patientId', String(parseInt(selectedProfileId, 10)));
      fd.append('scheduledDate', scheduledDate);
      fd.append('scheduledTime', scheduledTime);
      // The [] suffix matters: it makes a single test arrive as a one-element array rather
      // than a bare string, which a plain repeated field would not.
      testIds.forEach((id) => fd.append('testIds[]', String(parseInt(id, 10))));
      packageIds.forEach((id) => fd.append('packageIds[]', String(parseInt(id, 10))));
      if (doctorRequest.file) fd.append('doctorRequest', doctorRequest.file, doctorRequest.file.name);
      if (hmo) {
        fd.append('hmo[providerId]', String(hmo.providerId));
        if (hmo.approvalCode) fd.append('hmo[approvalCode]', hmo.approvalCode);
        fd.append('hmoCard', cardPhoto.file, cardPhoto.file.name);
      }

      // The header override is load-bearing, not decoration: the axios instance defaults to
      // application/json, and posting FormData under that header serialises the form to JSON
      // and silently drops the file. AvatarUpload.jsx does the same for the same reason.
      const response = await api.post('/appointments', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const appt = response.data.data.appointment;
      const { visitTests = [], hmoRequest } = response.data.data;

      // Summed from the rows the SERVER wrote, never from the prices the picker was showing. A
      // package expands into one visit_test per component with its allocated share of the fixed
      // price [1.45.0], so the picker's own figure would be the list total of the parts — higher
      // than the bill, on the one screen telling a patient what to send to a bank.
      const amountDue = visitTests.reduce((sum, t) => sum + Number(t.price_at_time || 0), 0);

      setBookingConfirmation({
        // Carried through so the confirmation can take the payment itself rather than sending the
        // patient to Appointments to find it. Present on both branches — the INSERT is
        // `RETURNING *`, and the already-booked branch returns the existing row.
        visitId: appt.patient_visit_id,
        // When the slot is released if it is not paid for. [1.123.0]
        heldUntil: appt.held_until || null,
        referenceCode: appt.appointment_reference,
        queueNumber: appt.queue_number,
        patientName: selectedProfile ? `${selectedProfile.first_name} ${selectedProfile.last_name}` : '',
        scheduledDate: formatAppointmentDate(bookingData.scheduledDate),
        scheduledTime: bookingData.scheduledTime,
        amountDue,
        // What the pay panel asks the patient to confirm before paying. [1.122.0] The rows the
        // server wrote, named from the catalogue the picker showed.
        tests: visitTests.map((vt) => ({
          name: (testCatalog || []).find((t) => String(t.id) === String(vt.test_id))?.name || 'Test',
          price: vt.price_at_time,
        })),
        isHmo: !!hmoRequest
      });
      setBookingData(EMPTY_BOOKING);
      clearEvidence();
      onBooked?.();
    } catch (err) {
      setBookingError(err.response?.data?.message || 'Failed to book appointment');
      if (err.response?.status === 409 && bookingData.scheduledDate) {
        setSlotsRefreshKey((k) => k + 1);
      }
      // The booking either happened completely or not at all, but a request that failed after
      // the server committed (dropped connection) still leaves the client unaware of it —
      // refreshing the list means a booking that does exist shows up rather than being retried.
      onBooked?.();
    } finally {
      setIsBooking(false);
    }
  };

  const handlePackageSelection = (packageId) => {
    setBookingData((prev) => ({
      ...prev,
      packageIds: prev.packageIds.includes(packageId)
        ? prev.packageIds.filter((id) => id !== packageId)
        : [...prev.packageIds, packageId],
    }));
  };

  const handleTestSelection = (testId) => {
    const isSelected = bookingData.testIds.includes(testId);
    setBookingData({
      ...bookingData,
      testIds: isSelected 
        ? bookingData.testIds.filter(id => id !== testId) 
        : [...bookingData.testIds, testId]
    });
  };

  return (
                  <Dialog open={showBooking} onOpenChange={(open) => {
                    setShowBooking(open);
                    if (!open) {
                      setBookingStep(1);
                      setBookingError('');
                      setBookingConfirmation(null);
                      clearEvidence();
                    }
                  }}>
                    <DialogTrigger asChild>
                      <Button size="lg" disabled={!selectedProfileId}>
                        <PlusCircle className="h-4 w-4" />
                        Book a visit
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-xl">
                      {bookingConfirmation ? (
                        <BookingConfirmation
                          {...bookingConfirmation}
                          onClose={() => setShowBooking(false)}
                        />
                      ) : (
                        <>
                      <DialogHeader>
                        <DialogTitle className="text-lg font-bold text-slate-900">
                          Book Diagnostic Appointment
                        </DialogTitle>
                        <DialogDescription>
                          Schedule a diagnostic test for <strong>{selectedProfile?.first_name} {selectedProfile?.last_name}</strong>.
                        </DialogDescription>
                      </DialogHeader>

                      <form onSubmit={handleBookAppointment} className="space-y-4 pt-2">
                        {bookingError && (
                          <div role="alert" className="alert alert-error">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span>{bookingError}</span>
                          </div>
                        )}

                        {/* The steps, once. [1.80.0] A numbered progress bar in the header called them
                            "Select Tests" and "Schedule & HMO", and these pills right under it called
                            the same two steps "Schedule & Services" and "HMO / Payment Note": one
                            wizard with two sets of names. The pills stay, because they also move
                            between the steps. */}
                        <div className="flex items-center justify-between border-b border-line pb-3">
                          <button
                            type="button"
                            onClick={() => setBookingStep(1)}
                            aria-current={bookingStep === 1 ? 'step' : undefined}
                            className={`text-xs font-bold px-3 py-1 rounded-full border-0 cursor-pointer ${bookingStep === 1 ? 'bg-primary text-primary-foreground' : 'bg-gray-100 text-gray-500'}`}
                          >
                            1. Schedule & Services
                          </button>
                          <button
                            type="button"
                            onClick={() => setBookingStep(2)}
                            aria-current={bookingStep === 2 ? 'step' : undefined}
                            className={`text-xs font-bold px-3 py-1 rounded-full border-0 cursor-pointer ${bookingStep === 2 ? 'bg-primary text-primary-foreground' : 'bg-gray-100 text-gray-500'}`}
                          >
                            2. HMO &amp; Doctor&apos;s Notes
                          </button>
                        </div>

                        {bookingStep === 1 && (
                          <div className="space-y-4">
                            {/* Same control the reschedule dialog uses. It owns its own availability
                                fetch, so the two cannot disagree about which slots are free. */}
                            <SlotPicker
                              date={bookingData.scheduledDate}
                              time={bookingData.scheduledTime}
                              onDateChange={(d) => setBookingData({ ...bookingData, scheduledDate: d, scheduledTime: '' })}
                              onTimeChange={(t) => setBookingData({ ...bookingData, scheduledTime: t })}
                              refreshKey={slotsRefreshKey}
                            />

                            {/* The SAME picker reception uses. [1.54.0] This dialog carried its own
                                flat list: 65 services in a 176px scroll box, ungrouped, unsearchable
                                — and it never offered the clinic's PACKAGES at all, so a patient
                                booking online could not buy the bundle that exists precisely to be
                                cheaper than its parts. Reception could; the patient could not.

                                Sharing the control fixes both at once and stops the two lists
                                drifting again, which is how one of them came to be missing a whole
                                product line. */}
                            <div className="space-y-1.5">
                              <label className="field-label">Select Diagnostic Tests</label>
                              <TestPicker
                                tests={testCatalog}
                                selectedIds={bookingData.testIds}
                                onToggle={handleTestSelection}
                                packages={packages}
                                selectedPackageIds={bookingData.packageIds}
                                onTogglePackage={handlePackageSelection}
                                disabled={isBooking}
                                audience="patient"
                              />
                            </div>

                            <div className="flex justify-end pt-2">
                              <Button type="button"  onClick={() => setBookingStep(2)}>
                                Next: HMO &amp; Doctor&apos;s Notes &rarr;
                              </Button>
                            </div>
                          </div>
                        )}

                        {bookingStep === 2 && (
                          <div className="space-y-4">
                            {/* Who pays comes first, because it decides what else is asked. [1.107.0]
                                An HMO claim needs the card and the doctor's signed request; self-pay
                                needs neither, and may still attach the request. */}
                            <div className="space-y-1.5">
                              <label className="field-label">
                                HMO Provider
                                <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">(optional)</span>
                              </label>
                              <p className="m-0 text-fine text-slate-500">
                                Choose your HMO to claim coverage — you will need a photo of your HMO card and your doctor&apos;s request. Choose Self-Pay to pay for this visit yourself.
                              </p>
                              <Select
                                value={bookingData.hmoProviderId}
                                onValueChange={val => setBookingData({...bookingData, hmoProviderId: val})}
                              >
                                <SelectTrigger className="rounded-xl">
                                  <SelectValue placeholder="Select HMO Provider if applicable" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Self-Pay / None</SelectItem>
                                  {hmoProviders.map(hmo => (
                                    <SelectItem key={hmo.id} value={hmo.id.toString()}>
                                      {hmo.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {isHmo && (
                              <>
                                <div className="space-y-1.5">
                                  <label htmlFor="clientdashboard-hmo-authorization-loa-code" className="field-label">HMO Authorization / LOA Code</label>
                                  <Input id="clientdashboard-hmo-authorization-loa-code"
                                    placeholder="Enter approval or card LOA number"
                                    value={bookingData.hmoApprovalCode}
                                    onChange={e => setBookingData({...bookingData, hmoApprovalCode: e.target.value})}
                                  />
                                </div>

                                <EvidenceUpload
                                  id="booking-hmo-card"
                                  label="Photo of your HMO card"
                                  hint="Take a photo of the front of your card, or choose one you already have. Make sure the member number is readable."
                                  previewAlt="The HMO card photo you attached"
                                  readCheck="Can you read your member number in this photo? If not, take another."
                                  pdfCheck="Check it shows the front of your card with the member number readable."
                                  evidence={cardPhoto}
                                  disabled={isBooking}
                                />
                              </>
                            )}

                            {/* [1.106.0] The signed request names the doctor and the tests in the
                                doctor's own hand, which is why this step no longer asks the patient
                                to type the doctor's name or their symptoms. Reception reads it at
                                check-in. "Doctor's Notes" beside it because that is what many
                                patients call the paper. [1.107.0] */}
                            <EvidenceUpload
                              id="booking-doctor-request"
                              label="Doctor's Request / Doctor's Notes"
                              hint={isHmo
                                ? "Your HMO approves these tests against it. Attach a photo or scan of the request your doctor signed — make sure the doctor's name, signature and the tests are clear."
                                : isReferred
                                  ? "This profile is a Private (doctor-referred) patient, so the clinic needs the request your doctor signed. Attach a photo or scan — make sure the doctor's name, signature and the tests are clear."
                                  : "Not needed when you pay for the visit yourself. If your doctor gave you a signed request or notes for these tests, attach a photo or scan and the clinic will have it ready when you arrive."}
                              previewAlt="The doctor's request you attached"
                              readCheck="Can you clearly read the doctor's name, signature and the tests? If not, take another photo."
                              pdfCheck="Check it shows the doctor's name, signature and the tests."
                              evidence={doctorRequest}
                              required={needsDoctorRequest}
                              disabled={isBooking}
                            />

                            <div className="flex justify-between pt-2 border-t border-line">
                              <Button type="button" variant="outline" onClick={() => setBookingStep(1)}>
                                &larr; Back
                              </Button>
                              <Button type="submit" disabled={isBooking} className="font-bold">
                                {isBooking ? 'Submitting…' : 'Submit Schedule Request'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </form>
                        </>
                      )}
                    </DialogContent>
                  </Dialog>
  );
};

export default BookingDialog;
