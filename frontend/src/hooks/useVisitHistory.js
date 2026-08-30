import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { todayStr } from '../lib/date';

// Sent to the server as `limit`. This list pages at the database [1.29.0] — the screen used to
// fetch every visit in the range and render all of them, no slice and no footer, straight into
// the DOM. Measured at 664 bytes a visit, a year-wide range is a 3.6 MB response and roughly
// 5,700 table rows.
export const HISTORY_PAGE_SIZE = 25;

/**
 * Past visits over a chosen range — state, fetching, searching and paging as one thing.
 *
 * The reception counterpart of `useTransactionHistory`, and deliberately the same shape: same
 * `enabled` laziness, same `reload` / `goToPage` pair, same rule that the range and the page
 * always travel together. The only addition is a free-text `search`, which the endpoint applies
 * server-side alongside the dates.
 *
 * `enabled` is what makes it lazy — the caller passes false until the tab is opened, and the
 * first load fires once and only once. On the page that was a `historyLoaded` boolean plus an
 * effect keyed on the current view: bookkeeping the screen had to remember to do, which is
 * exactly what belongs behind an interface instead.
 */
export function useVisitHistory({ enabled = false } = {}) {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(false);
  // Recorded, not merely logged: a swallowed failure renders as an empty range, and "no visits"
  // is a claim about the clinic's day rather than an apology for a broken request.
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [page, setPage] = useState(1);
  // 'All' is the absence of a filter, kept as a real value so the segmented control always has a
  // selected option — an empty string would render as nothing being chosen.
  const [visitType, setVisitType] = useState('All');
  const [status, setStatus] = useState('All');
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const fetch = useCallback(async (from, to, term, nextPage = 1, type = 'All', visitStatus = 'All') => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/visits/history', {
        params: {
          startDate: from,
          endDate: to,
          search: term || undefined,
          // Filtered at the SERVER, alongside the dates and the search. Doing it here would
          // narrow the 25 rows already in hand and leave the footer's count describing the
          // range, so the screen would say "53 visits" over a list of four.
          visitType: type === 'All' ? undefined : type,
          status: visitStatus === 'All' ? undefined : visitStatus,
          page: nextPage,
          limit: HISTORY_PAGE_SIZE,
        },
      });
      const { visits: rows, total: count, totalPages: pages } = response.data.data;
      setVisits(rows || []);
      setTotal(count ?? (rows || []).length);
      setTotalPages(pages || 1);
      setPage(nextPage);
    } catch (err) {
      console.error('Failed to fetch visit history:', err);
      setError('Could not load visit history. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Lazy: nothing is fetched until the screen that shows it is actually open.
  useEffect(() => {
    if (enabled && !loadedOnce) {
      setLoadedOnce(true);
      fetch(startDate, endDate, search, 1, visitType, status);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    visits, loading, error,
    search, setSearch,
    startDate, setStartDate,
    endDate, setEndDate,
    page, total, totalPages,
    visitType, status,
    /**
     * Chosen from a chip, so it applies at once rather than waiting for Apply — a filter that
     * needs a second click to take effect reads as broken. Page resets to 1: staying on page 3
     * of a list that just became four rows long shows an empty table over a non-empty result.
     */
    setVisitType: (next) => { setVisitType(next); fetch(startDate, endDate, search, 1, next, status); },
    setStatus: (next) => { setStatus(next); fetch(startDate, endDate, search, 1, visitType, next); },
    /** Re-run for the filters currently chosen — what Apply and the retry link both do. */
    reload: () => fetch(startDate, endDate, search, 1, visitType, status),
    /** Jump to a page, keeping the chosen range, search term and filters. */
    goToPage: (next) => fetch(startDate, endDate, search, next, visitType, status),
  };
}

export default useVisitHistory;
