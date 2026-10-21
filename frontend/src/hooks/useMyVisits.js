import { useCallback, useEffect, useState } from 'react';
import api from '../config/api';
import { isWalkIn } from '../lib/visitOrigin';

/**
 * The walk-in visits of every profile on this account. [1.136.0]
 *
 * A walk-in has no booking, so it never appeared in the portal's list of visits at all, and a record
 * the clinic linked by invitation would have shown its results and receipts with no visit they came
 * from. Bookings come from /appointments/my-bookings and keep their own cards; this reads each
 * profile's visits (a handful of profiles, each a small list) and keeps the walk-ins, across every
 * profile, as the bookings list does.
 */
export function useMyVisits(profileList = []) {
  const [walkIns, setWalkIns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const key = profileList.map((p) => p.id).join(',');

  const reload = useCallback(async () => {
    setError('');
    if (!key) {
      setWalkIns([]);
      setLoading(false);
      return;
    }
    try {
      const lists = await Promise.all(key.split(',').map(async (id) => {
        const res = await api.get(`/visits/patient/${id}`);
        const profile = profileList.find((p) => String(p.id) === id);
        return (res.data.data.visits || [])
          .filter((v) => isWalkIn(v) && v.status !== 'Cancelled')
          .map((v) => ({ ...v, first_name: profile?.first_name, last_name: profile?.last_name }));
      }));
      setWalkIns(lists.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load your walk-in visits.");
    } finally {
      setLoading(false);
    }
    // profileList is read through `key`, which is what changes when the profiles do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { reload(); }, [reload]);

  return { walkIns, loading, error, reload };
}

export default useMyVisits;
