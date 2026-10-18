import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { usePolling } from './usePolling';
import { todayStr } from '../lib/date';

/**
 * Today's bookings that have not arrived yet: the front desk's "still to arrive". [1.75.0]
 *
 * The desk had no list of the day's appointments at all. Appointments is Admin's screen, and the
 * only way to find a booking at the desk was to be handed its reference. The API has served this
 * all along — `GET /appointments` with a date and a status, behind `appointments:read`, which the
 * front desk holds — so this is a read, not a new endpoint.
 *
 * 'Pending' is a booking nobody has checked in: confirming it at the desk sets 'Confirmed'. Sorted
 * soonest first here, because the endpoint sorts newest first for the Admin screen, which is the
 * wrong way round for a morning.
 *
 * A failure is reported, not turned into an empty list: "no bookings left to arrive" over a failed
 * request is a false statement about the clinic. [1.74.0]
 */
export function useTodaysBookings({ enabled = true } = {}) {
  const [bookings, setBookings] = useState([]);
  const [lapsed, setLapsed] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const today = todayStr();
      const res = await api.get('/appointments', {
        params: { status: 'Pending', dateFrom: today, dateTo: today, limit: 100 },
      });
      const rows = [...(res.data.data.appointments || [])]
        .sort((a, b) => String(a.scheduled_time).localeCompare(String(b.scheduled_time)));
      // [1.130.0] A booking not paid within its window released its slot, so it is not arriving:
      // the desk would check in a patient whose slot may be someone else's. Counted, not listed.
      const now = Date.now();
      const isLapsed = (b) => !b.is_paid && b.held_until && new Date(b.held_until).getTime() < now;
      setBookings(rows.filter((b) => !isLapsed(b)));
      setLapsed(rows.filter(isLapsed));
      setError('');
    } catch (err) {
      console.error("Failed to fetch today's bookings:", err);
      setError("Could not load today's bookings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  // Bookings made online after the desk opened, and check-ins at a second terminal.
  usePolling(load, 30000, { enabled });

  return { bookings, lapsed, loading, error, reload: load };
}

export default useTodaysBookings;
