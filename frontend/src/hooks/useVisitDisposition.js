import { useState } from 'react';

/**
 * A booking that is not going ahead as booked is moved. [1.131.0]
 *
 * This held three ways a visit stopped proceeding: cancelled, marked a no-show, or moved. Steven:
 * unpaid is temporary, and paid has no takebacks. An unpaid walk-in or booking whose time is up is
 * removed on its own (backend unpaidExpiryService), and a paid one is moved, never cancelled or
 * written off. So moving is the one disposition left. Kept as `disposition.reschedule` so the
 * screens that open the reschedule dialog read the same.
 */
export function useVisitDisposition() {
  /** The verified booking currently open in the reschedule dialog, or null. */
  const [reschedulingAppointment, setReschedulingAppointment] = useState(null);

  const rescheduleFlow = {
    appointment: reschedulingAppointment,
    open: (appointment) => setReschedulingAppointment(appointment),
    close: () => setReschedulingAppointment(null),
  };

  return { reschedule: rescheduleFlow };
}

export default useVisitDisposition;
