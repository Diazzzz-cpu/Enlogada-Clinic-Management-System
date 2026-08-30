import React from 'react';

const LIST_PAGE_SIZE = 8;
import { AlertTriangle, CalendarClock, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { StatusBadge } from '../ui/status-badge';
import { TabsContent } from '../ui/tabs';
import Pagination from '../ui/pagination';
import BookingPass from '../BookingPass';
import PayBookingPanel from './PayBookingPanel';
import { formatAppointmentDate, formatTime12 } from '../../lib/date';
import AppointmentTime from '../ui/appointment-time';
import DataBadge from '../ui/data-badge';

/**
 * Bookings this patient has, and the pass they present.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 */
export default function AppointmentsTab({ bookings }) {
  // Open bookings first and soonest-first within them; everything finished falls below, newest
  // first. A patient opening this tab is almost always asking "what do I still have to attend".
  const isOpenBooking = (a) => a.status !== 'Cancelled' && a.status !== 'Completed';
  const sorted = [...bookings.appointments].sort((a, b) => {
    if (isOpenBooking(a) !== isOpenBooking(b)) return isOpenBooking(a) ? -1 : 1;
    const da = new Date(a.scheduled_date).getTime();
    const db = new Date(b.scheduled_date).getTime();
    return isOpenBooking(a) ? da - db : db - da;
  });

  // Client-side, because the whole list arrives in one request — a page size over an array
  // already in hand is proportionate here, unlike the payments table.
  const totalPages = Math.max(1, Math.ceil(sorted.length / LIST_PAGE_SIZE));
  const safePage = Math.min(bookings.page, totalPages);
  const paged = sorted.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE);

  return (
        <TabsContent value="appointments" className="m-0">
          <Card className="border-line rounded-xl bg-surface overflow-hidden">
            <CardHeader className="bg-slate-50/80 border-b border-line py-3.5">
              <CardTitle className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                <CalendarClock className="w-4 h-4 text-brand-600" />
                <span>My Appointments</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {bookings.payError && (
                <div role="alert" className="alert alert-error mb-3">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{bookings.payError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {bookings.loading ? (
                <p className="text-xs text-gray-400 text-center py-4">Loading appointments…</p>
              ) : bookings.appointments.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4 italic">No appointments booked yet.</p>
              ) : (
                paged.map((appt) => {
                  const isCancellable = appt.status === 'Pending' || appt.status === 'Confirmed';
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
                  const showPass = isOpen && appt.is_paid;
                  // The two payment routes are mutually exclusive by construction: a configured
                  // gateway takes precedence, and the manual channel is what an unconfigured
                  // deployment falls back to. Showing both would ask the patient to pay twice.
                  const showPayOptions = isOpen && !appt.is_paid && bookings.gateway.available;
                  const showPayPanel = isOpen && !appt.is_paid && !bookings.gateway.available;

                  // Postgres TIMESTAMP arrives as an ISO instant; toTimeString gives the local
                  // wall clock, which is what formatTime12 formats and what the patient reads.
                  const heldUntil = appt.held_until ? new Date(appt.held_until) : null;
                  const isHeld = Boolean(heldUntil) && heldUntil.getTime() > Date.now();
                  const heldUntilClock = isHeld ? heldUntil.toTimeString().slice(0, 5) : null;                  return (
                    <div
                      key={appt.id}
                      data-testid="appointment-card"
                      data-reference={appt.appointment_reference}
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
                        </div>
                        <StatusBadge status={appt.status} />
                      </div>

                      {showPass ? (
                        <BookingPass
                          reference={appt.appointment_reference}
                          queueNumber={appt.queue_number}
                          isPaid={appt.is_paid}
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
                      {showPayPanel && (
                        <PayBookingPanel
                          visitId={appt.patient_visit_id}
                          amountDue={appt.amount_due}
                          onSettled={bookings.reload}
                        />
                      )}

                      {/* Reschedule sits before Cancel, and only while the booking is still
                          Pending — once reception has checked the patient in, the date is not
                          the thing anyone is changing. Ordering matters here: cancelling used to
                          be the only way to change a booking, so it was doing duty as both, and
                          a patient who only wanted a different Tuesday gave their slot up to get
                          it. The gentler action goes first. */}
                      {(appt.status === 'Pending' || isCancellable) && (
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
                          {isCancellable && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => bookings.requestCancel(appt)}
                              className="flex-1 items-center justify-center gap-1.5 rounded-lg border-rose-200 py-1.5 text-fine font-bold text-rose-600 hover:bg-rose-50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              <span>Cancel</span>
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              </div>
            </CardContent>
            {bookings.appointments.length > 0 && (
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={bookings.setPage}
                total={bookings.appointments.length}
                pageSize={LIST_PAGE_SIZE}
              />
            )}
          </Card>
        </TabsContent>
  );
}
