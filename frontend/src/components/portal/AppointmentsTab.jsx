import React from 'react';

const LIST_PAGE_SIZE = 8;
import { AlertTriangle, CalendarClock, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel, PanelBody } from '../ui/panel';
import { SkeletonList } from '../ui/skeleton';
import { StatusBadge } from '../ui/status-badge';
import EmptyState from '../ui/empty-state';
import Pagination from '../ui/pagination';
import BookingPass from '../BookingPass';
import PayBookingPanel from './PayBookingPanel';
import { formatAppointmentDate, formatTime12 } from '../../lib/date';
import AppointmentTime from '../ui/appointment-time';
import DataBadge from '../ui/data-badge';
import OriginBadge from './OriginBadge';
import { formatDate } from '../../lib/date';

/**
 * Bookings this patient has, and the pass they present.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 */
export default function AppointmentsTab({ bookings, visits = null }) {
  // Open bookings first and soonest-first within them; everything finished falls below, newest
  // first. A patient opening this tab is almost always asking "what do I still have to attend".
  //
  // [1.136.0] Walk-in visits join the finished part. A walk-in has no booking, so a record the
  // clinic linked by invitation had results and receipts and no visit they came from; and it must
  // never be drawn as a booking card, which would say the patient booked it online.
  const walkIns = (visits?.walkIns || []).map((v) => ({ ...v, kind: 'walk-in' }));
  const isOpenBooking = (a) => a.kind !== 'walk-in' && a.status !== 'Cancelled' && a.status !== 'Completed';
  const when = (a) => new Date(a.kind === 'walk-in' ? a.created_at : a.scheduled_date).getTime();
  const sorted = [...bookings.appointments, ...walkIns].sort((a, b) => {
    if (isOpenBooking(a) !== isOpenBooking(b)) return isOpenBooking(a) ? -1 : 1;
    return isOpenBooking(a) ? when(a) - when(b) : when(b) - when(a);
  });

  // Client-side, because the whole list arrives in one request — a page size over an array
  // already in hand is proportionate here, unlike the payments table.
  const totalPages = Math.max(1, Math.ceil(sorted.length / LIST_PAGE_SIZE));
  const safePage = Math.min(bookings.page, totalPages);
  const paged = sorted.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE);

  // Two groups, not one stream. [1.72.0]
  //
  // The ordering below was already right — open bookings first — but ordering alone was being
  // undone by the layout. Every card went into the same two-across grid, so a Pending booking
  // carrying the whole payment panel sat in one cell while a Cancelled booking sat in the other,
  // and the grid row grew to the tall card's height. The patient got a half-empty screen in which
  // the thing they had to act on and the thing they could ignore were given equal billing.
  //
  // So: anything unfinished gets a full-width row of its own, and everything finished drops into a
  // compact grid underneath a quiet heading. Cancelled bookings are still here and still fully
  // legible — a patient looking one up needs to read it — they are just no longer competing for
  // the same space as the booking that still needs paying.
  const active = paged.filter(isOpenBooking);
  const earlier = paged.filter((a) => !isOpenBooking(a));

  // A walk-in visit: when, the ticket, what it was for, and that it was at the clinic. No pass, no
  // reference, no reschedule: there is nothing to present or move.
  const renderWalkIn = (v) => (
    <div
      key={`walk-in-${v.id}`}
      data-testid="walk-in-visit"
      data-visit-id={v.id}
      className="space-y-2 rounded-xl border border-line bg-surface p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="block text-xs font-extrabold text-slate-900">{formatDate(v.created_at)}</span>
          <span className="block text-fine text-slate-500">{v.first_name} {v.last_name}</span>
        </div>
        {v.queue_number && <DataBadge variant="queue" label="Queue ticket">{v.queue_number}</DataBadge>}
      </div>
      <OriginBadge row={v} />
      {v.tests?.length > 0 && (
        <p className="m-0 text-fine text-slate-600">{v.tests.map((t) => t.name).join(', ')}</p>
      )}
      <p className="m-0 text-meta text-slate-500">
        {v.is_paid
          ? `Paid at the clinic${v.receipt_number ? ` · ${v.receipt_number}` : ''}`
          : 'Not paid'}
      </p>
    </div>
  );
  const renderItem = (item) => (item.kind === 'walk-in' ? renderWalkIn(item) : renderCard(item));

  const renderCard = (appt) => {
    const isOpen = appt.status !== 'Cancelled' && appt.status !== 'Completed';

    // The QR pass is issued only once the booking is PAID. [1.48.0]
    //
    // This reverses the previous rule, and the reason the previous rule existed is
    // worth restating so it is not reinstated by accident: the pass used to require
    // payment, that disabled the feature because the clinic could only take money at
    // the counter, and so it was shown unpaid instead — "a patient walking in with an
    // unpaid booking still needs a code to be scanned".
    //
    // That premise is gone. A patient can now settle a booking from home by paying
    // into the clinic's own account, so withholding the pass no longer strands
    // anyone: it gives them something to do instead.
    //
    // The reference is still printed as TEXT on an unpaid booking, which is what
    // keeps the counter path working — reception can look it up by hand exactly as
    // before. Only the scannable code waits for payment.
    //
    // [1.132.0] An HMO booking is kept once its HMO approves it, as a paid one is, so it gets
    // its pass then. While the claim waits there is nothing to pay; refused, it is paid like any.
    const hmoWaiting = appt.hmo_status === 'Pending';
    const hmoApproved = appt.hmo_status === 'Approved';
    const showPass = isOpen && (appt.is_paid || hmoApproved);
    // The two payment routes are mutually exclusive by construction: a configured
    // gateway takes precedence, and the manual channel is what an unconfigured
    // deployment falls back to. Showing both would ask the patient to pay twice.
    const payable = isOpen && !appt.is_paid && !hmoWaiting && !hmoApproved;
    const showPayOptions = payable && bookings.gateway.available;
    const showPayPanel = payable && !bookings.gateway.available;

    // Postgres TIMESTAMP arrives as an ISO instant; toTimeString gives the local
    // wall clock, which is what formatTime12 formats and what the patient reads.
    const heldUntil = appt.held_until ? new Date(appt.held_until) : null;
    const isHeld = Boolean(heldUntil) && heldUntil.getTime() > Date.now();
    const heldUntilClock = isHeld ? heldUntil.toTimeString().slice(0, 5) : null;
    // Payment first [1.123.0]: an unpaid booking whose time to pay ran out has released its slot.
    const lapsed = Boolean(heldUntil) && !isHeld && !appt.is_paid;

    return (
      <div
        key={appt.id}
        data-testid="appointment-card"
        data-reference={appt.appointment_reference}
        data-status={appt.status}
        className="border border-line rounded-xl p-3 space-y-2 bg-slate-50/70"
      >
        <div className="flex justify-between items-start">
          <div>
            <span className="block text-xs font-extrabold text-slate-900">
              {formatAppointmentDate(appt.scheduled_date)}
            </span>
            {/* Inline variant — this is a dense list of cards, and the stacked
                two-line form belongs on the pass below rather than repeated in
                every row header. */}
            <AppointmentTime scheduledTime={appt.scheduled_time} variant="inline" />
            {/* Why it moved. [1.105.0] Most useful when the clinic moved it for them. */}
            {isOpen && appt.reschedule_reason && (
              <span className="mt-0.5 block text-fine text-slate-500">
                Moved &middot; {appt.reschedule_reason}
              </span>
            )}
          </div>
          <StatusBadge status={appt.status} />
        </div>
        {/* Booked online by the patient, or booked by the clinic. [1.136.0] */}
        <OriginBadge row={appt} />

        {showPass ? (
          <BookingPass
            reference={appt.appointment_reference}
            queueNumber={appt.queue_number}
            // Covered in full by the HMO: nothing to pay, and not "Paid" either.
            isPaid={appt.is_paid ? true : hmoApproved && Number(appt.amount_due) === 0 ? null : false}
            hmoApproved={hmoApproved}
            canPayOnline={bookings.gateway.available}
            receiptNumber={appt.receipt_number}
            estimatedWaitMinutes={appt.estimated_wait_minutes ?? null}
            patientsAhead={appt.patients_ahead ?? null}
            estimateIsCapped={appt.estimate_is_capped ?? false}
          />
        ) : (
          <DataBadge variant="reference" label="Booking reference" copyable>{appt.appointment_reference}</DataBadge>
        )}


        {/* What to do before this appointment. [1.24.0] surfaced these while
            choosing tests and in the confirmation email, and then left them off
            the one screen a patient opens the day before to check the time. Only
            for bookings still ahead — a preparation note on a completed visit is
            an instruction for something that already happened. */}
        {isOpen && appt.preparation_notes?.length > 0 && (
          <div className="space-y-1 rounded-lg bg-amber-50 px-2.5 py-2 ring-1 ring-inset ring-amber-200">
            <p className="m-0 flex items-center gap-1.5 text-fine font-semibold text-amber-900">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              Before this appointment
            </p>
            <ul className="m-0 list-disc space-y-0.5 pl-5 text-fine leading-relaxed text-amber-800">
              {appt.preparation_notes.map((prep, i) => (
                <li key={i}>{prep}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Waiting on the HMO [1.132.0]: the slot is kept until the appointment's own time. */}
        {isOpen && hmoWaiting && (
          <p data-testid="booking-hmo-waiting" className="m-0 rounded-lg border border-azure-200 bg-azure-50 p-2.5 text-fine text-azure-900">
            {isHeld || !heldUntil ? (
              <>
                <strong>Waiting for your HMO&apos;s approval.</strong> Your slot is kept until your
                appointment time; if your HMO has not approved it by then, it is released. We email
                you their answer.
              </>
            ) : (
              <>
                <strong>Your HMO had not approved this booking in time</strong>, so its slot was
                released.
              </>
            )}
          </p>
        )}
        {payable && appt.hmo_status === 'Rejected' && (
          <p data-testid="booking-hmo-refused" className="m-0 rounded-lg border border-line bg-slate-100 p-2.5 text-fine text-slate-700">
            <strong>Your HMO did not approve this booking.</strong> You can still keep it by paying
            for it yourself.
          </p>
        )}

        {/* A hold is live only while held_until is in the future. Compared against
            the browser clock, which is the same clock the countdown is read on; the
            server's value is authoritative for capacity and this is only the telling. */}
        {showPayOptions && (
          <div className="space-y-2 pt-1">
            {/* The hold, said out loud. [1.35.0]
                An unpaid self-pay booking now holds its slot rather than taking it,
                and releases it when the hold lapses — so a patient who is not told
                would come back to a booking that had quietly stopped being theirs.
                Only rendered while a hold is actually live: a permanent booking
                (staff-made, HMO, or already paid) carries no held_until, and telling
                those patients about a deadline that does not apply to them would be
                worse than saying nothing. */}
            {isHeld ? (
              <p className="text-fine text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 m-0">
                <strong>Your slot is held until {formatTime12(heldUntilClock)}.</strong>{' '}
                Pay before then to confirm it — after that the time goes back on offer
                to other patients, and your booking stays here unpaid.
              </p>
            ) : (
              <p className="text-fine text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 m-0">
                Payment is required before your visit. Once paid, your QR booking pass appears
                here — show it at the front desk on arrival.
              </p>
            )}
            <div className="flex gap-2">
              {bookings.gateway.methods.map((method) => (
                <Button
                  key={method}
                  type="button"
                  disabled={bookings.payingId === appt.id}
                  onClick={() => bookings.payOnline(appt, method)}
                  className="flex-1 text-fine font-bold rounded-lg py-1.5"
                >
                  {bookings.payingId === appt.id ? 'Redirecting…' : `Pay with ${method}`}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Paying from home, into the clinic's own account. [1.48.0] Replaced a
            paragraph that could only say "settle at the counter on arrival" — which
            was true when there was no way to pay in advance, and is now the fallback
            this panel itself shows when no payment method is configured. */}
        {/* Payment first. [1.123.0] The deadline is said beside the payment, and once it has
            passed the booking says so rather than inviting a payment for a slot it no longer has. */}
        {showPayPanel && lapsed && (
          <p data-testid="booking-lapsed" className="m-0 rounded-lg border border-line bg-slate-100 p-2.5 text-fine text-slate-700">
            <strong>This booking wasn&apos;t paid in time</strong>, so its slot was released. Reschedule it
            to choose a time again, then pay before the new deadline shown here.
          </p>
        )}
        {showPayPanel && !lapsed && (
          <>
            {isHeld && (
              <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 p-2 text-fine text-amber-800">
                <strong>Pay by {formatTime12(heldUntilClock)} to keep this slot.</strong> After that it goes
                back on offer to other patients.
              </p>
            )}
            <PayBookingPanel
              visitId={appt.patient_visit_id}
              amountDue={appt.amount_due}
              tests={appt.booked_tests || []}
              onSettled={bookings.reload}
            />
          </>
        )}

        {/* Reschedule only while the booking is still Pending: once reception has checked
            the patient in, the date is not the thing anyone is changing. No Cancel [1.131.0]:
            an unpaid booking is released on its own when its time is up, and a paid one moves. */}
        {appt.status === 'Pending' && (
          <div className="flex gap-2 pt-0.5">
            {appt.status === 'Pending' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => bookings.openReschedule(appt)}
                className="flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-fine font-bold"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                <span>Reschedule</span>
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  // One plain panel with no heading of its own. [1.82.0] The band above already says Appointments,
  // and a "My Appointments" card title under it was the same name twice.
  return (
          <Panel className="overflow-hidden">
            <PanelBody className="p-4">
              {bookings.payError && (
                <div role="alert" className="alert alert-error mb-3">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{bookings.payError}</span>
                </div>
              )}
              {bookings.error ? (
                // Before "none booked", never after it: an empty list over a failed request tells a
                // patient holding a booking that they have none. [1.80.0]
                <EmptyState
                  tone="error"
                  compact
                  title="Couldn't load your visits"
                  description={bookings.error}
                  action={<Button variant="outline" size="sm" onClick={bookings.reload}>Try again</Button>}
                />
              ) : bookings.loading || (visits?.loading && sorted.length === 0) ? (
                <SkeletonList rows={2} />
              ) : sorted.length === 0 && visits?.error ? (
                // Nothing listed and the walk-ins did not load: that is the thing to say, never
                // "no visits yet" over a read that failed.
                <EmptyState
                  tone="error"
                  compact
                  title="Couldn't load your visits"
                  description={visits.error}
                  action={<Button variant="outline" size="sm" onClick={visits.reload}>Try again</Button>}
                />
              ) : sorted.length === 0 ? (
                <EmptyState
                  compact
                  icon={CalendarClock}
                  title="No visits yet"
                  description="Book a visit above. It appears here, and your booking pass with it once it is paid. Visits you make at the clinic appear here too."
                />
              ) : (
                <>
                  {active.length > 0 && (
                    <div data-testid="active-bookings" className="space-y-3">{active.map(renderItem)}</div>
                  )}

                  {/* Still on this tab, as asked — a cancellation is part of a patient's booking
                      history and hiding it would mean answering "did that get cancelled?"
                      somewhere else. The heading is the boundary: above it is what needs attending
                      to, below it is what already happened. */}
                  {earlier.length > 0 && (
                    <div data-testid="earlier-bookings" className={active.length > 0 ? 'mt-5' : ''}>
                      <p className="m-0 mb-2.5 flex items-center gap-2 text-micro font-bold uppercase tracking-wider text-ink-muted">
                        <span>Earlier visits</span>
                        <span className="h-px flex-1 bg-line" aria-hidden="true" />
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {earlier.map(renderItem)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </PanelBody>
            {visits?.error && !bookings.error && sorted.length > 0 && (
              <div role="alert" className="alert alert-error mx-4 mb-4">
                <XCircle className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{visits.error} Your bookings above are complete.</span>
                <Button variant="outline" size="sm" onClick={visits.reload}>Try again</Button>
              </div>
            )}
            {!bookings.error && sorted.length > 0 && (
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={bookings.setPage}
                total={sorted.length}
                pageSize={LIST_PAGE_SIZE}
              />
            )}
          </Panel>
  );
}
