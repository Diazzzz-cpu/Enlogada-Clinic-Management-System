import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import EmptyState from '../ui/empty-state';
import { SkeletonList } from '../ui/skeleton';
import RescheduleDialog from '../booking/RescheduleDialog';
import api from '../../config/api';
import { formatTime12 } from '../../lib/date';

/**
 * The bookings a closed or shortened day leaves without a slot, each with Move. [1.123.0]
 *
 * Closing a date used to report a count — "Those patients still hold their slot" — with no names,
 * no way to reach them, and paid bookings that cannot be cancelled. Each patient is now emailed
 * when the date is saved, and this lists them so whoever closed the day can move each booking
 * through the same dialog the Desk and the patient use. A moved booking leaves the list.
 */
export default function AffectedBookingsDialog({ date, onOpenChange }) {
  const [state, setState] = useState({ status: 'idle', bookings: [], error: '' });
  const [moving, setMoving] = useState(null);

  const load = useCallback(async () => {
    if (!date) return;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const res = await api.get(`/schedule/overrides/${date}/bookings`);
      setState({ status: 'ready', bookings: res.data.data.bookings || [], error: '' });
    } catch (err) {
      setState({ status: 'error', bookings: [], error: err.response?.data?.message || 'The bookings could not be loaded.' });
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  // A plain YYYY-MM-DD, read at local noon so no time zone can move it to a neighbouring day.
  const readable = date
    ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <>
      <Dialog open={Boolean(date)} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg" data-testid="affected-bookings">
          <DialogHeader>
            <DialogTitle>Bookings to move: {readable}</DialogTitle>
            <DialogDescription>
              Patients with an email on file were asked to choose a new time. Move a booking here
              when they call, or to settle it for them. A paid booking is moved, never cancelled.
            </DialogDescription>
          </DialogHeader>

          {state.status === 'loading' || state.status === 'idle' ? (
            <SkeletonList rows={3} />
          ) : state.status === 'error' ? (
            <EmptyState compact tone="error" title="Couldn't load the bookings" description={state.error}
              action={<Button size="sm" variant="outline" onClick={load}>Try again</Button>} />
          ) : state.bookings.length === 0 ? (
            <EmptyState compact icon={CalendarClock} title="Nothing to move"
              description="No booking on this date is left without a slot." />
          ) : (
            <ul className="m-0 list-none divide-y divide-line rounded-lg border border-line p-0">
              {state.bookings.map((b) => (
                <li key={b.id} data-testid="affected-booking" className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="m-0 text-note font-semibold text-ink">
                      {formatTime12(String(b.scheduled_time).slice(0, 5))} · {b.first_name} {b.last_name}
                    </p>
                    <p className="m-0 flex flex-wrap items-center gap-1.5 text-fine text-slate-500">
                      <span className="font-mono">{b.appointment_reference}</span>
                      {b.is_paid && <Badge variant="outline">Paid</Badge>}
                      {!b.email && <span>no email on file, call them</span>}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setMoving(b)}>Move</Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <RescheduleDialog
        open={Boolean(moving)}
        onOpenChange={(open) => { if (!open) setMoving(null); }}
        appointment={moving}
        onRescheduled={() => { setMoving(null); load(); }}
      />
    </>
  );
}
