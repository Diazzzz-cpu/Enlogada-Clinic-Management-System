import { useCallback, useEffect, useState } from 'react';
import api from '../config/api';

/**
 * Records the clinic has invited this account to accept. [1.136.0]
 *
 * Until the account has proven its address the server names nobody, and says only how many are
 * waiting (`needsEmailCheck`): someone who signed up with an address they do not own must not learn
 * whose record it is. A failed read is kept as an error, so Home says it could not check rather than
 * telling the person to add a profile by hand and make a duplicate.
 */
export function useMyInvitations() {
  const [invitations, setInvitations] = useState([]);
  const [needsEmailCheck, setNeedsEmailCheck] = useState(false);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setError('');
    try {
      const res = await api.get('/patients/invitations/mine');
      const data = res.data.data;
      setInvitations(data.invitations || []);
      setNeedsEmailCheck(Boolean(data.needsEmailCheck));
      setCount(Number(data.count) || 0);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't check for records waiting for you.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { invitations, needsEmailCheck, count, loading, error, reload };
}

export default useMyInvitations;
