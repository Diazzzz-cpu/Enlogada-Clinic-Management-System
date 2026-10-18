import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CalendarClock, Camera, CheckCircle2, FileText, Keyboard, Search, UserCheck, UserX } from 'lucide-react';
import AttachedFile from '../AttachedFile';
import { Panel } from '../ui/panel';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import DataBadge from '../ui/data-badge';
import { StatusBadge } from '../ui/status-badge';
import QrScanner from '../QrScanner';
import { ageFromBirthdate, formatAppointmentDate, formatTime12, toDateInput, todayStr } from '../../lib/date';

/** A booking reference as the clinic issues it: `APT-` and hex digits (appointmentRepository). */
const REFERENCE = /^apt-?[0-9a-f]{2,}$/i;
const LOOKUP_DEBOUNCE_MS = 350;
// Two letters match half the patient file. Past this the list pushed the queue off the screen,
// which is the thing the box sits above so as not to hide.
const RECORDS_SHOWN = 6;

const fullName = (p) => `${p.first_name} ${p.last_name}`;

/**
 * "Who's here?" — the one box the front desk starts every arrival from. [1.75.0]
 *
 * Steven picked this layout (F1) from the clickable gallery. Before it, one arrival meant three
 * screens: a returning patient was looked up on Walk-In Registration, a booking was checked in on
 * Appointment Check-In, and both were watched on the Active Queue. The box answers all three from
 * one field, above the queue it feeds:
 *
 *   a name        → today's bookings under that name (Check in), records on file (Start visit),
 *                   and the queue below narrows to the same name
 *   a reference   → Enter looks the booking up, as the old check-in screen did; so does a scan
 *   nothing typed → nothing; today's bookings still to arrive are the table below the queue
 *                   (ArrivalsPanel), whose Check in opens the same card here [1.130.0]
 *
 * Nothing here writes on its own. A booking goes `checkIn.verify` → the card → `checkIn.request`,
 * and a record goes `checkIn.request('walkin')` — the old screens' flows, and the same confirmation
 * dialog for both.
 *
 * A record already in today's queue is NOT offered "Start visit": a second visit the same morning
 * is how a patient ends up with two tickets and two bills. Record rows wait until the queue below
 * has answered for the same name, so the button is never shown before that check can be made.
 */
export default function WhoIsHereBox({ lookup, checkIn, disposition, arrivals, queue, can }) {
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const term = lookup.query.trim();
  const needle = term.toLowerCase();
  const isReference = REFERENCE.test(term);
  const typed = term.length >= 2;

  const onChange = (value) => {
    lookup.setQuery(value);
    const next = value.trim();
    const reference = REFERENCE.test(next);
    // The queue narrows to the same name. A booking reference names no visit, so it clears it.
    queue.onSearchChange(reference ? '' : value);
    clearTimeout(timer.current);
    if (can.searchRecords && !reference) {
      timer.current = setTimeout(() => lookup.searchFor(next), LOOKUP_DEBOUNCE_MS);
    }
  };

  const onSubmit = (event) => {
    event.preventDefault();
    clearTimeout(timer.current);
    if (isReference) {
      if (can.checkIn) checkIn.verify(null, term.toUpperCase());
    } else if (can.searchRecords) {
      lookup.searchFor(term);
    }
  };

  const bookings = typed
    ? arrivals.bookings.filter((b) => (isReference
      ? String(b.appointment_reference).toLowerCase().startsWith(needle)
      : fullName(b).toLowerCase().includes(needle)))
    : [];

  const queueAnswered = Boolean(queue.error)
    || (!queue.loading && (queue.appliedSearch || '').trim().toLowerCase() === needle);
  // [1.123.0] A visit that is already PAID does not stop another one: a paid visit's tests are
  // final, so extra tests can only go on a second visit with its own bill. The rule this guards,
  // no second ticket and second bill by mistake, is about unpaid visits.
  const inQueue = new Set(
    queue.visits
      .filter((v) => (v.visit_status === 'Pending' || v.visit_status === 'Processing') && !v.is_paid)
      .map((v) => v.patient_id)
  );
  const paidToday = new Set(queue.visits.filter((v) => v.is_paid).map((v) => v.patient_id));
  const bookedToday = new Set(arrivals.bookings.map((b) => b.patient_id));
  const found = typed && !isReference && queueAnswered && Array.isArray(lookup.results) ? lookup.results : null;
  const records = found ? found.filter((p) => !inQueue.has(p.id) && !bookedToday.has(p.id)) : [];
  const alreadyQueued = found ? found.filter((p) => inQueue.has(p.id)).length : 0;
  const shownRecords = records.slice(0, RECORDS_SHOWN);
  const moreRecords = records.length - shownRecords.length;
  const nothing = found !== null && found.length === 0 && bookings.length === 0;
  const looking = typed && !isReference && (lookup.searching || !queueAnswered);

  return (
    <Panel id="whos-here" className="scroll-mt-4 p-4 sm:p-5">
      <form onSubmit={onSubmit}>
        <label htmlFor="desk-who" className="field-label">Who's here?</label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <Input
              id="desk-who"
              type="search"
              autoComplete="off"
              value={lookup.query}
              onChange={(e) => onChange(e.target.value)}
              // Short enough to show whole on a phone, where the input keeps a 16px font so iOS does
              // not zoom on focus. The label above says what the box is for.
              placeholder="Name, queue # or reference"
              className="pl-9"
            />
          </div>
          {can.checkIn && (
            <Button type="button" variant="outline" onClick={checkIn.toggleScanMode} aria-pressed={checkIn.scanMode}>
              {checkIn.scanMode ? <Keyboard className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
              {checkIn.scanMode ? 'Type instead' : 'Scan pass'}
            </Button>
          )}
        </div>
      </form>

      {checkIn.scanMode && (
        <div className="mt-3 max-w-md">
          <QrScanner active={checkIn.scanMode} onScan={checkIn.scanned} onError={checkIn.reportError} />
        </div>
      )}

      {lookup.notice && (
        <div role="status" className="alert alert-success mt-3">
          <CheckCircle2 />
          <span>{lookup.notice}</span>
        </div>
      )}

      {/* One block for a booking's check-in, not two: the notice and the "guide them to" line used
          to sit in separate boxes that both began by saying the patient was checked in. */}
      {(checkIn.notice || checkIn.guidance) && (
        <div role="status" className="mt-3 space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-fine text-emerald-800">
          {checkIn.notice && (
            <p className="m-0 flex items-start gap-1.5 font-semibold">
              <UserCheck className="mt-px h-4 w-4 flex-shrink-0" />
              <span>{checkIn.guidance ? `${checkIn.guidance.patientName}: ${checkIn.notice}` : checkIn.notice}</span>
            </p>
          )}
          {checkIn.guidance && (
            <p className="m-0">
              {checkIn.guidance.categories.length > 0 ? (
                <>Please guide the patient to: <strong>{checkIn.guidance.categories.join(', ')}</strong>.</>
              ) : (
                'No tests are on this visit yet. Add them from the queue below before sending the patient anywhere.'
              )}
            </p>
          )}
        </div>
      )}

      {(checkIn.verifyError || lookup.error) && (
        <div role="alert" className="alert alert-error mt-3">
          <AlertCircle />
          <span>{checkIn.verifyError || lookup.error}</span>
        </div>
      )}

      {checkIn.result && (
        <BookingCard booking={checkIn.result} checkIn={checkIn} disposition={disposition} can={can} />
      )}

      {typed && (
        <div className="mt-3">
          {(bookings.length > 0 || records.length > 0) && (
            <ul
              aria-label="Matches"
              className="m-0 list-none divide-y divide-line overflow-hidden rounded-xl border border-line p-0"
            >
              {bookings.map((b) => (
                <li key={`booking-${b.id}`} data-testid="desk-match" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                  <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">Booking today</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-note font-semibold text-slate-900">{fullName(b)}</span>
                    <span className="block text-fine text-slate-500">
                      {formatTime12(b.scheduled_time)} · <span className="font-mono">{b.appointment_reference}</span>
                    </span>
                  </span>
                  {can.checkIn && (
                    <Button type="button" size="sm" onClick={() => checkIn.verify(null, b.appointment_reference)}>
                      Check in
                    </Button>
                  )}
                </li>
              ))}
              {shownRecords.map((p) => {
                const age = ageFromBirthdate(p.birthdate);
                const unpaid = Number(p.unpaid_visit_count) || 0;
                return (
                  <li key={`record-${p.id}`} data-testid="desk-match" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                    <Badge variant="outline" className="text-slate-600">On file</Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-note font-semibold text-slate-900">
                        {fullName(p)} <span className="text-fine font-normal text-slate-400">PT-{p.id}</span>
                      </span>
                      <span className="block text-fine text-slate-500">
                        {p.patient_type_name}
                        {age !== null && ` · ${age}y`}
                        {' · '}
                        {Number(p.visit_count) > 0
                          ? `${p.visit_count} prior visit${Number(p.visit_count) === 1 ? '' : 's'} · last ${new Date(p.last_visit_at).toLocaleDateString()}`
                          : 'No prior visits'}
                      </span>
                      {paidToday.has(p.id) && (
                        <span className="mt-1 block text-fine text-slate-600">
                          Already has a paid visit today. This starts another visit, with its own bill.
                        </span>
                      )}
                      {/* A returning patient's unpaid balance, visible before they are admitted again. */}
                      {unpaid > 0 && (
                        <span className="mt-1 inline-block rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-micro font-bold text-rose-700">
                          {unpaid} unpaid visit{unpaid === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                    {can.startVisit && (
                      <Button type="button" size="sm" variant="outline" onClick={() => checkIn.request('walkin', p)}>
                        {paidToday.has(p.id) ? 'Start another visit' : 'Start visit'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {moreRecords > 0 && (
            <p className="m-0 mt-2 text-fine text-slate-500">
              And {moreRecords} more on file. Keep typing the name to narrow it down.
            </p>
          )}
          {looking && bookings.length === 0 && <p className="m-0 text-fine text-slate-400">Looking…</p>}
          {nothing && (
            <p className="m-0 text-fine text-slate-500">
              Nobody by that name is booked today or on file.
              {can.registerPatient && ' Register them with Register Walk-In, above.'}
            </p>
          )}
          {alreadyQueued > 0 && (
            <p className="m-0 mt-2 text-fine text-slate-500">
              {alreadyQueued === 1 ? 'One match is' : `${alreadyQueued} matches are`} already in today's queue, shown below.
            </p>
          )}
          {isReference && can.checkIn && !checkIn.result && bookings.length === 0 && (
            <p className="m-0 text-fine text-slate-500">Press Enter to look up booking {term.toUpperCase()}.</p>
          )}
        </div>
      )}

      {/* Today's bookings still to arrive are a table of their own below the queue now (ArrivalsPanel):
          a row of name buttons here stopped at eight and crowded the box on a busy day. [1.130.0] */}
    </Panel>
  );
}

/**
 * A booking in hand, from a scan, a reference or a name. The old check-in screen's card, with the
 * same three actions: check in, move it, or mark it a no-show.
 */
function BookingCard({ booking, checkIn, disposition, can }) {
  // [1.106.0] The patient uploaded the doctor's signed request instead of typing the doctor's
  // name, so check-in is where the desk reads it. Optional on a self-pay booking [1.107.0], so the
  // button appears only when there is one. Shown in place, not in a dialog, so the card's
  // own actions stay in view.
  const [showRequest, setShowRequest] = useState(false);
  // [1.124.0] What the server will accept, so the card offers nothing it would refuse.
  const bookedFor = toDateInput(new Date(booking.scheduled_date));
  const today = todayStr();
  const over = ['Cancelled', 'No Show', 'Completed'].includes(booking.status);
  const canNoShow = !booking.is_paid && booking.status === 'Pending' && bookedFor <= today;
  return (
    <div data-testid="booking-card" className="mt-3 space-y-3 rounded-xl border border-line bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-note font-bold text-slate-900">{fullName(booking)}</p>
          {/* The API sends scheduled_date as a full ISO instant; formatting it is what keeps it from
              reading one day behind on a UTC+8 clock. */}
          <p className="m-0 text-fine text-slate-600">
            {formatAppointmentDate(booking.scheduled_date)} at {formatTime12(booking.scheduled_time)}
            {' · '}
            <span className="font-mono">{booking.appointment_reference}</span>
          </p>
        </div>
        <span className="flex flex-shrink-0 items-center gap-1.5">
          {booking.queue_number && (
            <DataBadge variant="queue" label="Queue ticket">{booking.queue_number}</DataBadge>
          )}
          <StatusBadge status={booking.is_paid ? 'Paid' : 'Pending'} />
        </span>
      </div>

      {/* Payment is the other half of the release rule, so the desk sees it before checking anyone
          in — otherwise the patient is checked in, nothing reaches the department, and nobody
          knows why. */}
      {over && (
        <p role="note" className="m-0 rounded-lg border border-line bg-white p-2 text-fine text-slate-700">
          This booking is {booking.status === 'No Show' ? 'marked a no-show' : booking.status.toLowerCase()}, so it can&apos;t be checked in.
          Register the patient as a walk-in instead.
        </p>
      )}
      {!over && bookedFor !== today && (
        <p role="note" data-testid="booking-other-day" className="alert alert-info m-0 text-fine">
          This booking is for {formatAppointmentDate(booking.scheduled_date)}, not today. Checking in moves it to
          today and frees that day&apos;s slot.
        </p>
      )}
      {!over && !booking.is_paid && (
        <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 p-2 text-fine text-amber-800">
          This booking has no confirmed payment yet. You can still check the patient in, but the
          ticket reaches the department only once the cashier confirms payment.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {can.checkIn && !over && (
          <Button type="button" onClick={() => checkIn.request('appointment', booking)}>
            <UserCheck className="h-4 w-4" />
            Confirm Check-In Patient
          </Button>
        )}
        {/* Only while the booking is still Pending: once Confirmed the patient is standing here, and
            a new date is not what is being asked for. */}
        {can.reschedule && booking.status === 'Pending' && (
          <Button type="button" variant="outline" onClick={() => disposition.reschedule.open(booking)}>
            <CalendarClock className="h-4 w-4" />
            Reschedule this booking
          </Button>
        )}
        {booking.has_doctor_request && (
          <Button
            type="button"
            variant="outline"
            aria-expanded={showRequest}
            onClick={() => setShowRequest((v) => !v)}
          >
            <FileText className="h-4 w-4" />
            {showRequest ? "Hide doctor's request / notes" : "View doctor's request / notes"}
          </Button>
        )}
        {/* A paid booking is moved, not written off as a no-show. [1.123.0] Nor is one already
            checked in, or one whose day has not come yet. [1.124.0] */}
        {can.checkIn && canNoShow && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => disposition.noShow.request(booking)}
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          >
            <UserX className="h-4 w-4" />
            Mark as No-Show instead
          </Button>
        )}
        <Button type="button" variant="ghost" className="ml-auto" onClick={checkIn.clearResult}>
          Close
        </Button>
      </div>

      {showRequest && (
        <AttachedFile
          url={`/visits/${booking.patient_visit_id}/doctor-request`}
          hasFile
          noun="doctor's request"
          imageAlt="The doctor's signed request for this booking"
          frameTitle="Scan of the doctor's signed request"
          missing=""
        />
      )}
    </div>
  );
}
