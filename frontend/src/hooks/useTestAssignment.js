import { useState } from 'react';
import api from '../config/api';
import { toastError, toastSuccess } from '../lib/toast';

/**
 * Editing the tests on a visit. [1.55.0]
 *
 * ── It used to only add ─────────────────────────────────────────────────────────────────────
 *
 * This opened with an EMPTY basket and posted whatever was ticked, so it could not show what the
 * visit already carried and could not take anything off. But reception attaches tests at
 * registration — by the time a visit is in the queue the list already exists, and what the desk
 * actually needs is to change it: a patient adds a test, or one was picked in error.
 *
 * With no way to remove, a wrong test stayed on the visit and reached the cashier as a charge
 * somebody had to explain to a patient standing at the counter.
 *
 * ── Removal is not symmetrical with adding ──────────────────────────────────────────────────
 *
 * Adding a test is always safe. Removing one is not, and the server owns every refusal —
 * testService.removeTestFromVisit rejects a paid visit, a recorded result, work already with a
 * department, and any package it cannot remove whole. This hook does not re-implement those
 * rules; it reports them. The one thing it does locally is mark which lines are LOCKED, so the
 * screen can grey them rather than offering an action that will be refused.
 *
 * Removals go one at a time and stop at the first refusal, rather than firing in parallel. A
 * partial batch is the worst outcome here: some tests gone, some not, and one error message that
 * does not say which is which.
 */
export function useTestAssignment({ onAssigned } = {}) {
  const [visitId, setVisitId] = useState(null);
  const [existing, setExisting] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [selectedPackageIds, setSelectedPackageIds] = useState([]);
  const [removing, setRemoving] = useState(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /** A line the server will refuse to remove, and the reason to show beside it. */
  const lockReason = (line) => {
    if (line.status !== 'Pending') return `Already ${line.status.toLowerCase()} with the department`;
    return null;
  };

  const loadExisting = async (id) => {
    setLoading(true);
    try {
      const res = await api.get(`/tests/visit-tests/${id}`);
      setExisting(res.data.data.visitTests || []);
    } catch {
      // Non-fatal: the picker still works for ADDING. Showing an empty current-list is honest —
      // it is what we know — and blocking the whole dialog would stop the desk doing the half
      // of the job that does not depend on this.
      setExisting([]);
    } finally {
      setLoading(false);
    }
  };

  /** Open for a visit. The basket starts empty — it holds what is being ADDED, not what exists. */
  const openFor = (id) => {
    setVisitId(id);
    setSelectedTestIds([]);
    // Packages clear here for the same reason. A bundle left in state would be attached to the
    // NEXT patient opened, and a package is ₱1,450 of tests they never asked for.
    setSelectedPackageIds([]);
    setExisting([]);
    setOpen(true);
    loadExisting(id);
  };

  const close = () => {
    if (submitting || removing) return;
    setOpen(false);
  };

  const togglePackage = (packageId) => {
    setSelectedPackageIds((prev) => (
      prev.includes(packageId) ? prev.filter((id) => id !== packageId) : [...prev, packageId]
    ));
  };

  const toggleTest = (testId) => {
    setSelectedTestIds((current) =>
      current.includes(testId) ? current.filter((id) => id !== testId) : [...current, testId]
    );
  };

  /**
   * Take one line off the visit.
   *
   * The list is re-read from the server rather than spliced locally, because removing one
   * component of a package removes the whole bundle — the response says how many went, and the
   * only way to show the truth is to ask again.
   */
  const remove = async (line) => {
    if (removing) return;
    setRemoving(line.id);
    try {
      const res = await api.delete(`/tests/visit-tests/${line.id}`);
      await loadExisting(visitId);
      toastSuccess(res.data.message || 'Removed from the visit.');
      onAssigned?.();
    } catch (err) {
      // The server's own sentence, not a generic one: every refusal here explains something the
      // person at the desk has to act on — reverse a payment, cancel at the department.
      toastError(err.response?.data?.message || 'That test could not be removed.');
    } finally {
      setRemoving(null);
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!visitId || (selectedTestIds.length === 0 && selectedPackageIds.length === 0)) return;
    if (submitting) return; // the guard that keeps a slow connection from billing twice
    setSubmitting(true);

    try {
      await api.post('/tests/visit-tests', {
        patientVisitId: visitId,
        testIds: selectedTestIds.map((id) => parseInt(id, 10)),
        packageIds: selectedPackageIds.map((id) => parseInt(id, 10)),
      });
      setOpen(false);
    } catch (err) {
      toastError(err.response?.data?.message || 'Failed to assign tests to visit');
      return;
    } finally {
      setSubmitting(false);
    }

    onAssigned?.();
  };

  return {
    visitId, open, submitting, openFor, close, submit,
    existing, loading, remove, removing, lockReason,
    selectedTestIds, toggleTest,
    selectedPackageIds, togglePackage,
  };
}

export default useTestAssignment;
