import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';

/**
 * The amendment chain for one report. [1.63.0]
 *
 * ── The endpoint existed and nothing called it ──────────────────────────────────────────────
 *
 * `[1.15.0]` made results versioned — an amendment SUPERSEDES rather than overwrites, `is_current`
 * flags the live one, and `GET /results/:visitTestId/versions` returns the whole chain with the
 * amendment reason and the clinician on each. `findVersionHistoryByVisitTestId` is described in
 * CLAUDE.md as "the only intentional reader of superseded rows".
 *
 * It had no reader. The history was recorded, queryable and completely invisible in the app — so
 * the question a referring doctor actually rings up with ("this says something different from the
 * copy I have — what changed?") could only be answered from the database.
 *
 * ── Fetched only when there IS a history ────────────────────────────────────────────────────
 *
 * A first issue is `version === 1` and its chain is one row, which is the overwhelming majority
 * of reports. Fetching for those would put a request behind every report anyone opens to buy
 * nothing. The result payload already carries `version`, so the caller can decide before asking.
 *
 * @param {number|null} visitTestId  The line to fetch history for. Null clears and fetches nothing.
 * @param {boolean} enabled  Pass `result.version > 1`. False keeps this inert.
 */
export function useResultVersions(visitTestId, enabled = true) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!visitTestId || !enabled) {
      setVersions([]);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/results/${visitTestId}/versions`);
      setVersions(res.data.data.versions || []);
    } catch (err) {
      // Named rather than swallowed. A silent failure here reads as "this report was never
      // amended", which is a statement about a clinical record and not one to make by accident.
      setError(err.response?.data?.message || 'The amendment history could not be loaded.');
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [visitTestId, enabled]);

  useEffect(() => { load(); }, [load]);

  return { versions, loading, error, reload: load };
}

export default useResultVersions;
