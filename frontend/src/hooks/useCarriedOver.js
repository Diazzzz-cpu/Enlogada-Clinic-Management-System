import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { usePolling } from './usePolling';

/**
 * Visits from earlier days still with a department. [1.130.0]
 *
 * Today's queue holds today's visits only, so a patient paid yesterday whose tests are still being
 * done was on no screen the desk uses. Polled like the queue, slower: this changes when a
 * department finishes something, not every minute.
 */
export function useCarriedOver({ enabled = true } = {}) {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/visits/carried-over');
      setVisits(res.data.data.visits || []);
      setError('');
    } catch (err) {
      console.error('Failed to fetch carried-over visits:', err);
      setError('Could not load unfinished visits from earlier days.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  usePolling(load, 60000, { enabled });

  return { visits, loading, error, reload: load };
}

export default useCarriedOver;
