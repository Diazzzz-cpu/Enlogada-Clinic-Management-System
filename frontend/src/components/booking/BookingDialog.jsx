import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../ui/dialog';
import SlotPicker from './SlotPicker';
import TestPicker from './TestPicker';
import ReferringPhysicianFields from './ReferringPhysicianFields';
import BookingConfirmation from '../BookingConfirmation';
import api from '../../config/api';
import { formatAppointmentDate } from '../../lib/date';
import { prepareCardImage } from '../../lib/cardImage';
import { PlusCircle, AlertCircle } from 'lucide-react';

/**
 * Booking a diagnostic appointment, from the patient's own portal.
 *
 * Extracted from ClientDashboard.jsx, which stood at 1,878 lines against a documented 300-500
 * rule. This is the largest single thing that page did and the most self-contained: a wizard with
 * its own steps, its own error surface, its own HMO-card upload and its own submit.
 *
 * It owns its state rather than taking it as props. Passing the twenty-odd values the dialog
 * touches down from the page would have moved the lines without moving the complexity — the page
 * would still have had to reason about `bookingStep` and `hmoCardPreview` while rendering a
 * results table. What crosses the boundary now is only what genuinely belongs to both: which
 * patient is selected, what the clinic sells, who it is accredited with, and a callback so the
 * page can refresh its lists once a booking exists.
 */
const BookingDialog = ({ selectedProfileId, selectedProfile, testCatalog, packages = [], hmoProviders, onBooked }) => {
  const [showBooking, setShowBooking] = useState(false);
  const [bookingStep, setBookingStep] = useState(1);
  const [isBooking, setIsBooking] = useState(false);
  const [hmoCardFile, setHmoCardFile] = useState(null);
  const [hmoCardPreview, setHmoCardPreview] = useState('');
  const [hmoCardError, setHmoCardError] = useState('');
  const [preparingCard, setPreparingCard] = useState(false);
  const [bookingData, setBookingData] = useState({
    scheduledDate: '',
    scheduledTime: '',
    notes: '',
    testIds: [],
    packageIds: [],
    hmoProviderId: '',
    hmoApprovalCode: '',
    referringPhysician: '',
    referringPhysicianPrc: ''
  });

  // UI/UX Modernization Phase 10: holds the full confirmation payload (not just a success
  // string) so BookingConfirmation.jsx can render a durable QR/reference/queue-ticket card
  // instead of the old plain-text message that auto-closed after 4 seconds.
  const [bookingConfirmation, setBookingConfirmation] = useState(null);
  const [bookingError, setBookingError] = useState('');

  // Slot availability lives in SlotPicker, which fetches it itself. This counter is the one thing
  // the page still needs to say about it: bump it to make the grid refetch after a 409, when the
  // slot the patient chose turned out to have gone.
  const [slotsRefreshKey, setSlotsRefreshKey] = useState(0);


  // One predicate for the field's `required`, the pre-submit guard, and what the server enforces.
  // Derived rather than duplicated: three copies of this rule is how the desk ends up demanding
  // something the booking form never asked for.
  const hmoSelected = Boolean(
    bookingData.hmoProviderId && bookingData.hmoProviderId !== 'none'
  );
  const referralRequired = hmoSelected || selectedProfile?.patient_type_name === 'Private';

  // The card is identity evidence, so it must never outlive the context it was attached in.
  // Left in state it would follow the patient selector: attach your own card, close the dialog,
  // switch to your child's profile, and their claim is filed against your member number.

  const clearHmoCard = useCallback(() => {
    setHmoCardFile(null);
    setHmoCardError('');
    setHmoCardPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return '';
    });
  }, []);

  // Switching patient invalidates any card already chosen, for the same reason.
  useEffect(() => {
    clearHmoCard();
  }, [selectedProfileId, clearHmoCard]);

  // Nothing renders the object URL after unmount, so release it rather than leaking one per
  // abandoned booking.
  useEffect(() => () => {
    if (hmoCardPreview) URL.revokeObjectURL(hmoCardPreview);
  }, [hmoCardPreview]);

  const handleCardSelected = async (e) => {
    const picked = e.target.files?.[0];
    // Clearing the input lets the same file be re-picked after a rejection; the accepted file is
    // deliberately NOT cleared, so cancelling a re-pick keeps the photo already chosen.
    e.target.value = '';
    if (!picked) return;

    setHmoCardError('');
    setPreparingCard(true);
    try {
      const prepared = await prepareCardImage(picked);
      setHmoCardFile(prepared);
      setHmoCardPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(prepared);
      });
    } catch (err) {
      setHmoCardError(err.message);
      setHmoCardFile(null);
    } finally {
      setPreparingCard(false);
    }
  };

  const handleBookAppointment = async (e) => {
    e.preventDefault();
    if (isBooking) return; // a second submit while the first is still in flight books twice
    setBookingError('');
    setBookingConfirmation(null);

    const {
      scheduledDate, scheduledTime, notes, testIds, packageIds, hmoProviderId, hmoApprovalCode,
      referringPhysician, referringPhysicianPrc,
    } = bookingData;
    if (!scheduledDate || !scheduledTime || (testIds.length === 0 && packageIds.length === 0)) {
      setBookingError('Date, Time, and at least one diagnostic test are required.');
      return;
    }

    // The Self-Pay option carries the string 'none' rather than an empty value, so a bare
    // truthiness check treated self-pay as an HMO selection. The render guard below already
    // tests for 'none'; these two must agree.
    const hmo = hmoProviderId && hmoProviderId !== 'none'
      ? { providerId: parseInt(hmoProviderId, 10), approvalCode: hmoApprovalCode || null }
      : null;

    if (hmo && !hmoCardFile) {
      setBookingError('Please attach a photo of your HMO card to claim HMO coverage.');
      return;
    }

    if (referralRequired && !referringPhysician?.trim()) {
      // Two branches, because the reason differs and the reason is the whole message. Telling a
      // self-paying Private patient that "your HMO needs it" contradicts the option they just
      // chose, and the explanation rendered directly above the field.
      setBookingError(
        hmoSelected
          ? 'Please give the name of the doctor who requested these tests — your HMO needs it to approve coverage.'
          : 'Please give the name of the doctor who requested these tests — a Private patient is one a physician referred.'
      );
      return;
    }

    setIsBooking(true);
    try {
      // One call. The appointment, its tests and any HMO claim are written in a single
      // transaction server-side — previously these were three sequential requests, and a failure
      // after the first left a booking the patient had been told did not happen, holding a slot
      // their own retry was then refused.
      //
      // Self-pay stays JSON, byte-identical to what it has always sent. Only an HMO booking —
      // which has a file to carry — switches to multipart, so the common path is code that did
      // not change.
      let response;
      if (hmo) {
        const fd = new FormData();
        fd.append('patientId', String(parseInt(selectedProfileId, 10)));
        fd.append('scheduledDate', scheduledDate);
        fd.append('scheduledTime', scheduledTime);
        fd.append('notes', notes || '');
        // The [] suffix matters: it makes a single test arrive as a one-element array rather
        // than a bare string, which a plain repeated field would not.
        testIds.forEach((id) => fd.append('testIds[]', String(parseInt(id, 10))));
        packageIds.forEach((id) => fd.append('packageIds[]', String(parseInt(id, 10))));
        fd.append('hmo[providerId]', String(hmo.providerId));
        if (hmo.approvalCode) fd.append('hmo[approvalCode]', hmo.approvalCode);
        fd.append('referringPhysician', referringPhysician.trim());
        if (referringPhysicianPrc?.trim()) fd.append('referringPhysicianPrc', referringPhysicianPrc.trim());
        fd.append('hmoCard', hmoCardFile, hmoCardFile.name);

        // The header override is load-bearing, not decoration: the axios instance defaults to
        // application/json, and posting FormData under that header serialises the form to JSON
        // and silently drops the file. AvatarUpload.jsx does the same for the same reason.
        response = await api.post('/appointments', fd, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      } else {
        response = await api.post('/appointments', {
          patientId: parseInt(selectedProfileId, 10),
          scheduledDate,
          scheduledTime,
          notes,
          testIds: testIds.map((id) => parseInt(id, 10)),
          packageIds: packageIds.map((id) => parseInt(id, 10)),
          hmo: null,
          // Sent on this branch too: a referred self-payer still belongs on the record, and the
          // server requires it for a Private patient. The controller already read this field on
          // both branches — only the client never supplied it here.
          referringPhysician: referringPhysician?.trim() || undefined,
          referringPhysicianPrc: referringPhysicianPrc?.trim() || undefined
        });
      }

      const appt = response.data.data.appointment;
      const { visitTests = [], hmoRequest } = response.data.data;

      // Summed from the rows the SERVER wrote, never from the prices the picker was showing. A
      // package expands into one visit_test per component with its allocated share of the fixed
      // price [1.45.0], so the picker's own figure would be the list total of the parts — higher
      // than the bill, on the one screen telling a patient what to send to a bank.
      const amountDue = visitTests.reduce((sum, t) => sum + Number(t.price_at_time || 0), 0);

      setBookingConfirmation({
        referenceCode: appt.appointment_reference,
        queueNumber: appt.queue_number,
        patientName: selectedProfile ? `${selectedProfile.first_name} ${selectedProfile.last_name}` : '',
        scheduledDate: formatAppointmentDate(bookingData.scheduledDate),
        scheduledTime: bookingData.scheduledTime,
        amountDue,
        isHmo: !!hmoRequest
      });
      setBookingData({
        scheduledDate: '',
        scheduledTime: '',
        notes: '',
        testIds: [],
        packageIds: [],
        hmoProviderId: '',
        hmoApprovalCode: '',
        referringPhysician: '',
        referringPhysicianPrc: ''
      });
      clearHmoCard();
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
                      clearHmoCard();
                    }
                  }}>
                    <DialogTrigger asChild>
                      <Button size="lg" disabled={!selectedProfileId}>
                        <PlusCircle className="h-4 w-4" />
                        Book Schedule
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

                        {/* Visual Step Progress Bar */}
                        <div className="flex items-center justify-between pt-3 pb-1 border-b border-slate-100 my-2">
                          <div className={`flex items-center space-x-2 text-xs font-bold ${bookingStep === 1 ? 'text-brand-600' : 'text-slate-400'}`}>
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-meta ${bookingStep === 1 ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-600'}`}>1</span>
                            <span>Select Tests</span>
                          </div>
                          <div className="h-[2px] flex-1 mx-3 bg-slate-200" />
                          <div className={`flex items-center space-x-2 text-xs font-bold ${bookingStep === 2 ? 'text-brand-600' : 'text-slate-400'}`}>
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-meta ${bookingStep === 2 ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-600'}`}>2</span>
                            <span>Schedule & HMO</span>
                          </div>
                        </div>
                      </DialogHeader>

                      <form onSubmit={handleBookAppointment} className="space-y-4 pt-2">
                        {bookingError && (
                          <div role="alert" className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 flex items-center space-x-2 text-xs font-semibold">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span>{bookingError}</span>
                          </div>
                        )}

                        {/* Step Indicators */}
                        <div className="flex items-center justify-between border-b border-line pb-3">
                          <button 
                            type="button"
                            onClick={() => setBookingStep(1)}
                            className={`text-xs font-bold px-3 py-1 rounded-full border-0 cursor-pointer ${bookingStep === 1 ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500'}`}
                          >
                            1. Schedule & Services
                          </button>
                          <button 
                            type="button"
                            onClick={() => setBookingStep(2)}
                            className={`text-xs font-bold px-3 py-1 rounded-full border-0 cursor-pointer ${bookingStep === 2 ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500'}`}
                          >
                            2. HMO / Payment Note
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
                              />
                            </div>

                            <div className="flex justify-end pt-2">
                              <Button type="button"  onClick={() => setBookingStep(2)}>
                                Next: HMO & Notes &rarr;
                              </Button>
                            </div>
                          </div>
                        )}

                        {bookingStep === 2 && (
                          <div className="space-y-4">
                            <div className="space-y-1.5">
                              <label className="field-label">HMO Provider (Optional)</label>
                              <p className="m-0 text-fine text-slate-500">
                                Claiming HMO coverage requires a photo of your card. Choose Self-Pay to pay for this visit yourself.
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

                            {bookingData.hmoProviderId && bookingData.hmoProviderId !== 'none' && (
                              <>
                                <div className="space-y-1.5">
                                  <label htmlFor="clientdashboard-hmo-authorization-loa-code" className="field-label">HMO Authorization / LOA Code</label>
                                  <Input id="clientdashboard-hmo-authorization-loa-code"
                                    placeholder="Enter approval or card LOA number"
                                    value={bookingData.hmoApprovalCode}
                                    onChange={e => setBookingData({...bookingData, hmoApprovalCode: e.target.value})}
                                  />
                                </div>

                                <div className="space-y-1.5">
                                  <label className="field-label">
                                    Photo of your HMO card <span className="text-rose-600">*</span>
                                  </label>
                                  <p className="m-0 text-fine text-slate-500">
                                    Take a photo of the front of your card, or choose one you already have.
                                    Make sure the member number is readable.
                                  </p>
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,application/pdf"
                                    onChange={handleCardSelected}
                                    disabled={preparingCard || isBooking}
                                    className="block w-full text-fine text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-fine file:font-semibold file:text-white hover:file:bg-brand-700"
                                  />

                                  {preparingCard && (
                                    <p className="m-0 text-fine text-slate-500" aria-live="polite">Preparing your photo…</p>
                                  )}

                                  {hmoCardError && (
                                    <div role="alert" className="alert alert-error">
                                      {hmoCardError}
                                    </div>
                                  )}

                                  {hmoCardFile && !hmoCardError && hmoCardFile.type === 'application/pdf' && (
                                    <p className="m-0 text-fine text-slate-600">
                                      Attached: {hmoCardFile.name}. Check it shows the front of your card
                                      with the member number readable.
                                    </p>
                                  )}

                                  {hmoCardPreview && !hmoCardError && hmoCardFile?.type !== 'application/pdf' && (
                                    <div className="space-y-1.5">
                                      {/* Shown large enough to actually read. No API detects blur, glare, a
                                          thumb over the number or the wrong side of the card — asking the
                                          patient to confirm they can read it is the only check that does. */}
                                      <img
                                        src={hmoCardPreview}
                                        alt="The HMO card photo you attached"
                                        className="max-h-64 w-full rounded-xl border border-line bg-sunken object-contain"
                                      />
                                      <p className="m-0 text-fine text-slate-600">
                                        Can you read your member number in this photo? If not, take another.
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </>
                            )}

                            {/* Shown for every booking, not just an HMO one. A self-paying patient
                                who WAS referred still needs the doctor on the record — the report
                                goes back to them — which is what this component's own contract says
                                and what ReceptionistDashboard already does. Required when an HMO
                                claim needs it for the LOA, or when the patient's type is Private,
                                which at this clinic means a physician sent them. Same predicate the
                                server enforces, so the patient is not told at submit what could
                                have been said while they were typing. */}
                            <ReferringPhysicianFields
                              physician={bookingData.referringPhysician}
                              prc={bookingData.referringPhysicianPrc}
                              onPhysicianChange={(v) => setBookingData({ ...bookingData, referringPhysician: v })}
                              onPrcChange={(v) => setBookingData({ ...bookingData, referringPhysicianPrc: v })}
                              required={referralRequired}
                              reason={
                                hmoSelected
                                  ? 'Your HMO needs the doctor who requested these tests in order to approve coverage.'
                                  : referralRequired
                                    ? 'A Private patient is one a physician referred, so the record needs to name them.'
                                    : null
                              }
                              disabled={isBooking}
                            />

                            <div className="space-y-1.5">
                              <label htmlFor="clientdashboard-additional-clinical-notes" className="field-label">Additional Clinical Notes</label>
                              <Input id="clientdashboard-additional-clinical-notes"
                                placeholder="Physician referral notes or symptoms..."
                                value={bookingData.notes}
                                onChange={e => setBookingData({...bookingData, notes: e.target.value})}
                              />
                            </div>

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
