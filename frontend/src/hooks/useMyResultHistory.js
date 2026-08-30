import { useState, useCallback, useEffect, useMemo } from 'react';
import api from '../config/api';
import { CATEGORY_ORDER } from '../lib/categories';

/**
 * One patient's diagnostic history, with the filters the portal puts over it.
 *
 * Keyed on `patientId` rather than fetched once, because an account owns several profiles and
 * switching between them must change what is shown. Passing null empties the list — that is what
 * "no profile selected" looks like, and it is deliberately not the same as "this patient has no
 * results", which the caller renders differently.
 */
export function useMyResultHistory({ patientId } = {}) {
  const [history, setHistory] = useState([]);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  // A failed fetch used to reach console.error and stop there, so the tab rendered its EMPTY
  // state — "No results yet" — to a patient whose results exist and who has just been emailed
  // to say so. Telling somebody their medical results are not there when the request merely
  // failed is the worst version of the mistake failure-states.spec.js was written about.
  const [error, setError] = useState('');

  const load = useCallback(async (id) => {
    if (!id) {
      setHistory([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api.get(`/results/history/${id}`);
      setHistory(response.data.data.results);
    } catch (err) {
      console.error('Failed to fetch diagnostic history:', err);
      setHistory([]);
      setError('Your results could not be loaded just now. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(patientId);
  }, [patientId, load]);

  const filtered = useMemo(() => history.filter((item) => {
    const matchesCategory = category === 'All' || item.category_name === category;
    const matchesSearch = !search
      || item.test_name.toLowerCase().includes(search.toLowerCase())
      || item.category_name.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  }), [history, category, search]);

  /**
   * The filter chips this patient gets — derived from what they actually have.
   *
   * This list used to be hardcoded as all five test_categories rows, which meant every patient was
   * offered "2D Echo" and "ECG" filters. The clinic RETIRED both [1.47.0]; the category rows stay
   * only so a past visit can still say what it was for. So the portal was advertising two services
   * nobody can book, to patients who had never had one, and the chips returned nothing when
   * clicked.
   *
   * Deriving it fixes both directions at once: a patient with a historical 2D Echo keeps the chip
   * that reaches it, and a patient without one never learns the service exists. Same reason the
   * category rows are not deleted — see CLAUDE.md.
   */
  const categories = useMemo(() => {
    const present = new Set(history.map((h) => h.category_name).filter(Boolean));
    const known = CATEGORY_ORDER.filter((c) => present.has(c));
    // A category added to the database after this was written still gets a chip rather than
    // becoming unreachable — it just sorts after the ones with a defined order.
    const unknown = [...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return ['All', ...known, ...unknown];
  }, [history]);

  // Switching profiles can strip the chip that is currently selected — a child with no X-ray
  // history, say — which would otherwise leave the list filtered to a category with no chip to
  // clear it, reading as an empty record.
  useEffect(() => {
    if (!categories.includes(category)) setCategory('All');
  }, [categories, category]);

  // Counted over the WHOLE history, not the filtered view: these are tiles describing the
  // patient's record, and a search box narrowing them would make them read as the record itself
  // shrinking.
  const pendingCount = useMemo(
    () => history.filter((h) => h.test_status === 'Pending' || h.test_status === 'Processing').length,
    [history]
  );
  const completedCount = useMemo(
    () => history.filter((h) => h.test_status === 'Completed').length,
    [history]
  );

  return {
    history, filtered, categories,
    category, setCategory,
    search, setSearch,
    pendingCount, completedCount,
    loading, error,
    reload: () => load(patientId),
  };
}

export default useMyResultHistory;
