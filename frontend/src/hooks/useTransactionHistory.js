import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { todayStr } from '../lib/date';

// Sent to the server as `limit` — this list pages at the database [1.29.0] rather than fetching
// the whole date range and slicing it in the browser.
export const HISTORY_PAGE_SIZE = 15;

/**
 * The receipts a cashier issued, over a chosen range — state, fetching and paging as one thing.
 *
 * ── Why a hook and not a class ───────────────────────────────────────────────────────────────
 * This is the "object" the four dashboards were asking for. CashierDashboard held 38 separate
 * pieces of state in one component, in four groups that never touch each other — the queue, this
 * history, the refund, and the till. Read top to bottom, the file was 38 unrelated `useState`
 * lines and then, hundreds of lines later, the handlers that act on them.
 *
 * A hook is React's unit of encapsulation: state plus the behaviour that owns it, behind one
 * named interface, testable and reusable on its own. A class component cannot do this job — it
 * cannot call hooks at all, so `usePolling`, `useAuth` and `useOperationsReport` would have to be
 * rewritten or wrapped, and the dashboards would become the only classes in a codebase of forty
 * function components. The one class here (ErrorBoundary) exists because React offers no hook for
 * error boundaries, which is the exception that shows the rule.
 *
 * `enabled` is what makes the history lazy: the caller passes false until the tab is opened, and
 * the first load fires once and only once. That belonged in the component as a `historyLoaded`
 * boolean and an effect keyed on the view — a piece of bookkeeping the screen had to remember to
 * do, which is exactly the kind of thing that belongs behind an interface rather than in a page.
 */
export function useTransactionHistory({ enabled = false } = {}) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  // What the cashier typed, and what was last SENT. Two values, not one: the box updates on every
  // keystroke, but the query only changes when they press Apply or Enter. Searching per keystroke
  // over a date range would fire a request per character on the screen used for the cash-up.
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  // 'All' is the absence of a filter, kept as a real value so the chip strip always has one
  // selected. The server already accepted `method` — nothing on screen ever sent it.
  const [method, setMethod] = useState('All');

  // Paged at the server, not here. [1.29.0] This used to pull every settled payment in the range
  // and slice fifteen out of it in the browser. Measured at 570 bytes a payment, a year-wide
  // range is a 2.0 MB response to fill a fifteen-row table — on the screen a cashier opens for
  // the daily cash-up.
  const fetch = useCallback(async (from, to, nextPage = 1, term = '', payMethod = 'All') => {
    setLoading(true);
    setError('');
    setAppliedSearch(term);
    try {
      const response = await api.get('/payments/transactions', {
        params: {
          startDate: from, endDate: to, page: nextPage, limit: HISTORY_PAGE_SIZE,
          // Omitted entirely when blank rather than sent as '', so the server's own
          // "trim to null" is never the only thing standing between an empty box and `%%`.
          ...(term ? { search: term } : {}),
          ...(payMethod !== 'All' ? { method: payMethod } : {}),
        },
      });
      const { transactions: rows, total: count, totalPages: pages } = response.data.data;
      setTransactions(rows || []);
      setTotal(count ?? (rows || []).length);
      setTotalPages(pages || 1);
      setPage(nextPage);
    } catch (err) {
      console.error('Failed to fetch transaction history:', err);
      setError('Could not load transaction history. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Lazy: nothing is fetched until the screen that shows it is actually open.
  useEffect(() => {
    if (enabled && !loadedOnce) {
      setLoadedOnce(true);
      fetch(startDate, endDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    transactions, loading, error,
    startDate, setStartDate,
    endDate, setEndDate,
    search, setSearch, appliedSearch,
    page, total, totalPages,
    method,
    /**
     * Applies on click, unlike the date range, which waits for Apply. Reconciling a drawer means
     * asking "what came in as cash?" and then "what as GCash?" in quick succession; making each
     * of those two clicks is friction on the one screen that is used against a ticking clock.
     */
    setMethod: (next) => { setMethod(next); fetch(startDate, endDate, 1, appliedSearch, next); },
    /** Re-run for the dates, search and method currently chosen — Apply and the retry link. */
    reload: () => fetch(startDate, endDate, 1, search, method),
    /** Jump to a page, keeping the range AND the filters — a page 2 that drops one is a bug. */
    goToPage: (next) => fetch(startDate, endDate, next, appliedSearch, method),
    /** Clear the box and re-run, so the list matches what the reader can see in the field. */
    clearSearch: () => { setSearch(''); fetch(startDate, endDate, 1, '', method); },
  };
}
