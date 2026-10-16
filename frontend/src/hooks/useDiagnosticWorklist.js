import { useState, useCallback, useEffect, useRef } from 'react';
import api from '../config/api';
import { usePolling } from './usePolling';

const NAV_TO_CATEGORY = {
  'lab-ops': 'Laboratory',
  'lab-history': 'Laboratory',
  'ultrasound-ops': 'Ultrasound',
  'ultrasound-history': 'Ultrasound',
  'xray-ops': 'Xray',
  'xray-history': 'Xray',
};

/** Reports per page on a department's History. [1.128.0] Paged at the server now. */
export const HISTORY_PAGE_SIZE = 10;

const ROLE_TO_CATEGORY = [
  ['Laboratory Staff', 'Laboratory'],
  ['Xray Staff', 'Xray'],
  ['Ultrasound Staff', 'Ultrasound'],
];

/**
 * A worklist covers exactly the category it names.
 *
 * This used to widen 'Ultrasound' to ['Ultrasound', '2D Echo'], because 2D Echo was its own
 * test_categories row that MODULE_SCOPE.md assigned to the Ultrasound role. [1.50.0] removed that
 * category, so the widening became a query for a category that no longer exists. Kept as a
 * function rather than inlined: the shape is what a second such mapping would need.
 */
const categoriesFor = (category) => [category];

/**
 * A department's work: the tickets waiting for a report, and the reports already released.
 *
 * The two lists share everything that decides what is in them — which department this console is
 * showing, the search box, the status filter — so they are one hook rather than two. Only the
 * list the current mode needs is fetched.
 *
 * The category has to be RESOLVED before anything is fetched, and that is the subtle part. It
 * comes either from the nav item or, failing that, from the signed-in user's role, and until one
 * of those has answered, `category` is only a hardcoded default. Fetching immediately with that
 * default and again after resolution is a race whose winner is whichever response lands last —
 * and the resolved fetch is not reliably the faster one, least of all for Ultrasound, which
 * fetches two categories.
 *
 * @param {string} activeNav  the nav id, which names the department directly when present
 * @param {string[]} roles    the signed-in user's roles, used when the nav does not say
 * @param {'worklist'|'history'} mode
 * @param {boolean} paused    suspend polling — a refetch under an open findings dialog would
 *                            swap the list out from under someone who is typing into it
 */
export function useDiagnosticWorklist({ activeNav, roles, mode, paused = false } = {}) {
  const [pending, setPending] = useState([]);
  const [released, setReleased] = useState([]);
  // What the server says matched, before paging. [1.128.0]
  const [releasedTotal, setReleasedTotal] = useState(0);
  const [releasedPages, setReleasedPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Two errors, not one: a failed worklist fetch and a failed history fetch are shown on
  // different screens, and a failure used to look identical to a genuinely empty list
  // [Phase C finding 01] — console.error only. See VISUAL_IDENTITY.md §3b's five-state pattern.
  const [worklistError, setWorklistError] = useState('');
  const [historyError, setHistoryError] = useState('');

  const [category, setCategory] = useState('Laboratory');
  const [categoryResolved, setCategoryResolved] = useState(false);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [worklistPage, setWorklistPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  /**
   * Whether the patient has been TOLD about a released report. [1.59.0]
   *
   * 'unsent' is the pile that matters: released reports nobody was ever notified of. It matters
   * most after a mail outage, when the failures are a contiguous block with no other way to find
   * them — which is exactly the state this clinic was in when the Gmail send quota ran out.
   *
   * Filtered at the SERVER, so it hits idx_test_results_undelivered and the count below is the
   * count of what matches rather than of the page in hand.
   */
  const [deliveryFilter, setDeliveryFilter] = useState('all');

  // History searches at the server [1.128.0], so it waits for a pause in typing rather than
  // asking once per keystroke. The worklist still filters the tickets in hand, instantly.
  const [historySearch, setHistorySearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setHistorySearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPending = useCallback(async (catName) => {
    setWorklistError('');
    try {
      const responses = await Promise.all(
        categoriesFor(catName).map((c) => api.get(`/results/pending/${c}`))
      );
      setPending(responses.flatMap((r) => r.data.data.pending || []));
    } catch (err) {
      console.error('Failed to fetch pending diagnostics:', err);
      setWorklistError('Could not load the worklist. Please try again.');
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * One page of the department's released reports. [1.128.0]
   *
   * It fetched the last 90 days, at most 200 reports, and paged those here: a laboratory that
   * released more lost its older reports from History without a word. The server pages now, so
   * every report is reachable, the total is the real one, and the search covers all of it.
   */
  const fetchReleased = useCallback(async (catName, { delivery = 'all', page = 1, term = '' } = {}) => {
    setHistoryError('');
    try {
      const res = await api.get(`/results/released/${categoriesFor(catName)[0]}`, {
        params: {
          page,
          limit: HISTORY_PAGE_SIZE,
          ...(delivery === 'all' ? {} : { delivery }),
          ...(term ? { search: term } : {}),
        },
      });
      const data = res.data.data;
      setReleased(data.released || []);
      setReleasedTotal(data.total ?? (data.released || []).length);
      setReleasedPages(data.totalPages || 1);
    } catch (err) {
      console.error('Failed to fetch released diagnostics:', err);
      setHistoryError('Could not load result history. Please try again.');
      setReleased([]);
      setReleasedTotal(0);
      setReleasedPages(1);
    } finally {
      setLoading(false);
    }
  }, []);

  // Which department this console is for. The nav says so directly when it can; otherwise the
  // account's role does.
  useEffect(() => {
    const fromNav = NAV_TO_CATEGORY[activeNav];
    if (fromNav) {
      setCategory(fromNav);
      setCategoryResolved(true);
    } else if (roles) {
      const match = ROLE_TO_CATEGORY.find(([role]) => roles.includes(role));
      setCategory(match ? match[1] : 'Laboratory');
      setCategoryResolved(true);
    }
  }, [activeNav, roles]);

  /** Re-read whichever list the current mode is showing. */
  const refresh = useCallback(() => {
    if (!category || !categoryResolved) return;
    return mode === 'history'
      ? fetchReleased(category, { delivery: deliveryFilter, page: historyPage, term: historySearch })
      : fetchPending(category);
  }, [category, categoryResolved, mode, deliveryFilter, historyPage, historySearch, fetchPending, fetchReleased]);

  // The skeleton only when the department or the mode changes. A new page, search or filter keeps
  // the rows on screen until the next ones arrive [1.128.0], so paging does not blink.
  const loadedScope = useRef('');
  useEffect(() => {
    if (category && categoryResolved) {
      const scope = `${category}|${mode}`;
      if (scope !== loadedScope.current) {
        loadedScope.current = scope;
        setLoading(true);
      }
      refresh();
    }
  }, [category, categoryResolved, mode, refresh]);

  /**
   * Keep it live. A ticket reaches a department only once the cashier takes payment and the
   * front desk checks the patient in — both at other terminals — so without this a technician
   * had no way to learn work had arrived except by re-navigating. The wait badges recompute on
   * these re-renders too, which is what makes them usable for triage.
   */
  usePolling(refresh, 30000, { enabled: categoryResolved && !!category && !paused });

  // Back to page 1 whenever the filtered set could change shape, so a stale page number never
  // points past the end of a newly filtered or newly fetched list.
  useEffect(() => {
    setWorklistPage(1);
  }, [category, search, status]);

  // On the search the server is asked, not on each keystroke, so a page reset and its fetch are one.
  useEffect(() => {
    setHistoryPage(1);
  }, [category, historySearch]);

  return {
    pending, released, releasedTotal, releasedPages, loading,
    worklistError, historyError,
    category, categoryResolved,
    search, setSearch,
    status, setStatus,
    worklistPage, setWorklistPage,
    historyPage, setHistoryPage,
    deliveryFilter,
    // Page back to 1: staying on page 3 of a list that just became two rows shows an empty table
    // over a non-empty result.
    setDeliveryFilter: (next) => { setDeliveryFilter(next); setHistoryPage(1); },
    refresh,
  };
}

export default useDiagnosticWorklist;
