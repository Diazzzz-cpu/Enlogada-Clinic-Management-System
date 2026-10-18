import { useState } from 'react';
import api from '../config/api';
import { toastSuccess } from '../lib/toast';

/**
 * Mark an exam done, in a department that issues no report here (X-ray). [1.129.0]
 *
 * The X-ray department gives its results through its own system, so its worklist does not attach
 * or release a report: the technologist marks the exam done once it has been taken, and the ticket
 * leaves the worklist. The server records when and by whom (visit_tests.performed_at / _by), which
 * is what the reports count, and completes the visit when nothing else on it is outstanding.
 *
 * Asked before it happens, like a release: done cannot be undone from this screen.
 */
export function useMarkExamDone({ onDone } = {}) {
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ask = (test) => {
    setError('');
    setTarget(test);
  };

  const cancel = () => {
    if (!busy) setTarget(null);
  };

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/results/test-status/${target.visit_test_id}`, { status: 'Completed' });
      toastSuccess(`${target.test_name} for ${target.first_name} ${target.last_name} marked done`);
      setTarget(null);
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.message || 'The exam could not be marked done. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return { target, busy, error, ask, cancel, confirm };
}

export default useMarkExamDone;
