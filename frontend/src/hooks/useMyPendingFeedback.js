import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';

/**
 * The patient's finished visits that have not been rated yet. [1.112.0]
 *
 * A failure is kept quiet on purpose: being asked for feedback is an invitation, not something
 * the patient has to do, so a read that fails simply asks nothing rather than adding an error to
 * "Needs your attention".
 */
export function useMyPendingFeedback() {
  const [visits, setVisits] = useState([]);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/feedback/mine/pending');
      setVisits(res.data.data.visits || []);
    } catch {
      setVisits([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { visits, reload: load };
}

export default useMyPendingFeedback;
