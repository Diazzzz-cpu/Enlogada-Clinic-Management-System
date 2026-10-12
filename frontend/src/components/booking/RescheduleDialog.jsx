import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import SlotPicker from './SlotPicker';
import api from '../../config/api';
import { AlertCircle, ArrowRight, CalendarClock } from 'lucide-react';
import { formatTime12, formatAppointmentDate } from '../../lib/date';
import { toastSuccess } from '../../lib/toast';

/**
 * Move an existing booking to a different slot.
 *
 * Shared by the patient's own list and the front desk's oversight screen, because both are doing
 * the same thing to the same record and a patient should not be told a different rule from the
 * receptionist they are on the phone to.
 *
 * Cancel-and-rebook was the only route to this before, and it is not the same: between the two
 * calls the patient holds nothing, and at one patient per slot someone else can take the
 * replacement in the gap. PUT /appointments/:id/reschedule keeps the original until the new slot
 * is secured, so the worst case is being told the new time is unavailable — not losing both.
 */
const formatDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * Why the booking is moving. [1.105.0] Required, by the server as well as here. The common answers
 * are one tap; anything else is written under "Other". What is saved is the words chosen, so the
 * list can change without touching a stored row. 500 is the column's width.
 */
const REASONS = [
  'Schedule conflict',
  'Feeling unwell',
  "Can't prepare in time",
  'Transport problem',
  'Clinic asked to move it',
];
const OTHER = 'Other';
const REASON_MAX = 500;

/** A DATE that arrived as a UTC instant, as the calendar date it actually is. */
const toDateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const RescheduleDialog = ({ open, onOpenChange, appointment, onRescheduled }) => {
  const currentDate = toDateInput(appointment?.scheduled_date);
  const currentTime = appointment?.scheduled_time?.slice(0, 5) || '';

  const [date, setDate] = useState(currentDate);
  const [time, setTime] = useState(currentTime);
  const [choice, setChoice] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset whenever a different booking is opened, so the dialog never shows the previous
  // appointment's slot as the one being moved — or the previous move's reason.
  useEffect(() => {
    if (!open) return;
    setDate(currentDate);
    setTime(currentTime);
    setChoice('');
    setOtherReason('');
    setError('');
    setSubmitting(false);
  }, [open, currentDate, currentTime]);

  const unchanged = date === currentDate && time === currentTime;
  const reason = choice === OTHER ? otherReason.trim() : choice;

  const submit = async (e) => {
    e.preventDefault();
    if (submitting || !time || !reason) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api.put(`/appointments/${appointment.id}/reschedule`, {
        scheduledDate: date,
        scheduledTime: time,
        reason,
      });
      onRescheduled?.(res.data.data.appointment);
      onOpenChange(false);
      // A dialog closing on success looks exactly like a dialog being cancelled, and this one
      // moved a real appointment. Naming the new slot back is also the only confirmation the
      // patient gets that it took the time they picked and not the one they first opened on.
      toastSuccess(`Appointment moved to ${formatAppointmentDate(date)} at ${formatTime12(time)}.`);
    } catch (err) {
      // 409 is the interesting one and always means something the patient can act on — the slot
      // went while they were deciding, or the booking has since been checked in.
      setError(err.response?.data?.message || 'Could not move this appointment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!appointment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule Appointment</DialogTitle>
          <DialogDescription>
            {appointment.first_name
              ? `${appointment.first_name} ${appointment.last_name} · ${appointment.appointment_reference}`
              : appointment.appointment_reference}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {/* What is changing, stated before the controls. A grid of times with no reference point
              makes the patient work out for themselves what they are moving away from. */}
          <div className="flex items-center gap-3 rounded-xl border border-line bg-sunken px-3 py-2.5">
            <CalendarClock className="h-4 w-4 flex-shrink-0 text-brand-600" />
            <div className="min-w-0 text-fine">
              <span className="block font-semibold text-slate-900">
                {formatDate(appointment.scheduled_date)} at {formatTime12(currentTime)}
              </span>
              <span className="block text-slate-500">Current appointment</span>
            </div>
            {!unchanged && time && (
              <>
                <ArrowRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <div className="min-w-0 text-fine">
                  <span className="block font-semibold text-brand-700">
                    {formatDate(date)} at {formatTime12(time)}
                  </span>
                  <span className="block text-slate-500">New time</span>
                </div>
              </>
            )}
          </div>

          <SlotPicker
            date={date}
            time={time}
            onDateChange={(d) => { setDate(d); setTime(''); }}
            onTimeChange={setTime}
            currentDate={currentDate}
            currentTime={currentTime}
            disabled={submitting}
            label="New date"
          />

          <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0" disabled={submitting}>
            {/* Worded for both callers: the patient moving their own, and reception moving one on
                a patient's behalf over the phone. */}
            <legend className="field-label mb-1.5">Reason for moving it</legend>
            <div className="flex flex-wrap gap-1.5">
              {[...REASONS, OTHER].map((r) => (
                <label
                  key={r}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-fine font-semibold text-slate-600 transition-colors hover:bg-slate-50 has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-800"
                >
                  <input
                    type="radio"
                    name="reschedule-reason"
                    value={r}
                    checked={choice === r}
                    onChange={() => setChoice(r)}
                    className="h-3.5 w-3.5 cursor-pointer accent-brand-500"
                  />
                  {r}
                </label>
              ))}
            </div>
            {choice === OTHER && (
              <Input
                aria-label="Other reason"
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                maxLength={REASON_MAX}
                placeholder="Write the reason"
                autoFocus
              />
            )}
          </fieldset>

          {error && (
            <div role="alert" className="alert alert-error">
              <AlertCircle />
              <span>{error}</span>
            </div>
          )}

          <p className="m-0 text-micro leading-relaxed text-slate-500">
            Your reference code and booking pass stay the same — only the date and time change.
          </p>

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Keep current time
            </Button>
            <Button type="submit" loading={submitting} disabled={!time || unchanged || !reason}>
              Confirm new time
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RescheduleDialog;
