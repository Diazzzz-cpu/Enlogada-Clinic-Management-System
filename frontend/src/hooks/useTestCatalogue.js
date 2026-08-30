import { useState, useEffect, useCallback, useRef } from 'react';

// Fifteen rows: a full screen without scrolling on a laptop, and enough that most categories fit
// on one page so paging is invisible until the list is genuinely long.
const CATALOGUE_PAGE_SIZE = 15;
import api from '../config/api';

/**
 * The services the clinic sells — listing them, editing one, and taking one off the booking form.
 *
 * `preparation` is deliberately part of the edit form and of every save. It is the sentence the
 * day-before reminder carries [1.25.0] ("nothing to eat after 10pm tonight"), which is actionable
 * the evening before and forgotten at booking time. The status toggle used to omit it, and
 * because the repository writes every column, each activate/deactivate erased it — that is now
 * held on the server side in testService.updateTest, where it protects every caller rather than
 * this one screen.
 */
export function useTestCatalogue() {
  const [tests, setTests] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  const [showModal, setShowModal] = useState(false);
  const [editingTest, setEditingTest] = useState(null);
  const [form, setForm] = useState({ categoryId: '', name: '', price: '', preparation: '', isActive: true });
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState('');

  // The success message is left up for a moment before the dialog closes itself. Held in a ref so
  // it can be cancelled: without this, saving and then navigating away fires setState on a screen
  // that is gone, and a second save queues a second close.
  const closeTimer = useRef(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [testsRes, catRes] = await Promise.all([
        api.get('/tests?includeInactive=true'),
        api.get('/tests/categories'),
      ]);
      setTests(testsRes.data.data.tests || []);
      setCategories(catRes.data.data.categories || []);
    } catch (err) {
      console.error('Failed to fetch services catalog:', err);
      setError(err.response?.data?.message || 'The catalogue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const openAdd = () => {
    setEditingTest(null);
    setForm({
      categoryId: categories[0]?.id?.toString() || '',
      name: '',
      price: '',
      preparation: '',
      isActive: true,
    });
    setModalError('');
    setModalSuccess('');
    setShowModal(true);
  };

  const openEdit = (test) => {
    setEditingTest(test);
    setForm({
      categoryId: test.category_id.toString(),
      name: test.name,
      price: test.price,
      preparation: test.preparation || '',
      isActive: test.is_active,
    });
    setModalError('');
    setModalSuccess('');
    setShowModal(true);
  };

  const closeModal = () => {
    if (submitting) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setShowModal(false);
  };

  const save = async (e) => {
    e?.preventDefault();
    setModalError('');
    setModalSuccess('');

    if (!form.categoryId || !form.name || !form.price) {
      setModalError('Category, Service Name, and Price are required.');
      return;
    }
    const numericPrice = parseFloat(form.price);
    if (isNaN(numericPrice) || numericPrice < 0) {
      setModalError('Please enter a valid positive price.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingTest) {
        await api.put(`/tests/${editingTest.id}`, {
          categoryId: parseInt(form.categoryId, 10),
          name: form.name,
          price: numericPrice,
          preparation: form.preparation,
          isActive: form.isActive,
        });
        setModalSuccess('Service updated successfully! Live website catalog updated.');
      } else {
        await api.post('/tests', {
          categoryId: parseInt(form.categoryId, 10),
          name: form.name,
          price: numericPrice,
          preparation: form.preparation,
        });
        setModalSuccess('New service added successfully! Now live on public Services page.');
      }
    } catch (err) {
      setModalError(err.response?.data?.message || 'Failed to save service.');
      return;
    } finally {
      setSubmitting(false);
    }

    // Saved. The message stays up long enough to be read, then the dialog closes itself.
    reload();
    closeTimer.current = setTimeout(() => setShowModal(false), 1500);
  };

  const requestToggle = (test) => {
    setToggleError('');
    setConfirmTarget(test);
  };

  const dismissToggle = () => {
    if (toggling) return;
    setConfirmTarget(null);
  };

  const confirmToggle = async () => {
    const test = confirmTarget;
    if (!test) return;
    setToggleError('');
    setToggling(true);
    try {
      // `preparation` is not sent, and must not be: testService.updateTest keeps what a caller
      // does not mention, so this changes the flag and nothing else.
      await api.put(`/tests/${test.id}`, {
        categoryId: test.category_id,
        name: test.name,
        price: parseFloat(test.price),
        isActive: !test.is_active,
      });
      setConfirmTarget(null);
    } catch (err) {
      console.error(err);
      setToggleError(err.response?.data?.message || 'Failed to update service status.');
      return;
    } finally {
      setToggling(false);
    }
    reload();
  };

  const filtered = filterCategory === 'all'
    ? tests
    : tests.filter((t) => t.category_id.toString() === filterCategory);

  /**
   * The catalogue is paged client-side, deliberately.
   *
   * GET /tests returns the whole catalogue in one call and several screens depend on that — the
   * public Services page, the booking wizard's test picker, the demo seeder. It is also bounded by
   * what a clinic sells rather than by traffic: 67 rows today, and it grows when someone adds a
   * service, not when a patient books. Server-side paging would mean a new endpoint and a second
   * shape for the same data to buy nothing at this size.
   *
   * What it fixes is the SCREEN. Sixty-seven rows in one scroll is where an admin loses the row
   * they were looking for, and the filter above only helps if they already know the category.
   *
   * Paging sits after the filter, so a category and a page compose the way a reader expects; the
   * page resets whenever the filter changes, or page 4 of "All" becomes an empty page 4 of
   * "Ultrasound".
   */
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [filterCategory]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / CATALOGUE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * CATALOGUE_PAGE_SIZE, safePage * CATALOGUE_PAGE_SIZE);

  return {
    tests, categories, filtered, loading, error,
    paged, page: safePage, totalPages, setPage,
    filterCategory, setFilterCategory,
    showModal, editingTest, form, setForm, modalError, modalSuccess, submitting,
    openAdd, openEdit, closeModal, save,
    confirmTarget, toggling, toggleError, requestToggle, dismissToggle, confirmToggle,
    reload,
  };
}

export default useTestCatalogue;
