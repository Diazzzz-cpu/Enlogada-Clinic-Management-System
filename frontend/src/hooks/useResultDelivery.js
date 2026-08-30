import { useState, useCallback } from 'react';
import api from '../config/api';
import { toastSuccess, toastError, toastInfo } from '../lib/toast';

/**
 * Sending a released report to the patient again. [1.59.0]
 *
 * Releasing already emails the patient, once, automatically — and that was the whole of it. The
 * toast said whether it went and then the toast faded, so a technician asked "did she ever get
 * her result?" a week later had nowhere to look, and a patient who says "it never arrived" could
 * only be helped by re-releasing a report that was already out.
 *
 * Deliberately NOT part of `useResultEntry`. Recording findings and authorising a release are
 * clinical acts against a specific version of a report; delivery is a postal problem that can
 * recur any number of times against the same version. Folding this into the release flow is what
 * would make "the email bounced" into a reason to re-authorise a clinical document.
 */
export function useResultDelivery({ onDelivered } = {}) {
  // Per-test, not a single boolean: the history table shows ten rows, and one flag would spin
  // every button on the screen because somebody pressed one of them.
  const [sendingId, setSendingId] = useState(null);
  const [confirming, setConfirming] = useState(null);

  const send = useCallback(async (test) => {
    if (!test) return;
    setSendingId(test.visit_test_id);
    try {
      const res = await api.post(`/results/${test.visit_test_id}/email`);
      // Names the address. "Sent" alone leaves the person on the phone unable to answer the
      // patient's obvious next question, which is "sent to what?".
      toastSuccess(
        res.data.message,
        `${test.test_name} for ${test.first_name} ${test.last_name}.`
      );
      setConfirming(null);
      onDelivered?.();
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.message || 'The report could not be sent.';
      // A missing address is not a fault — it is a walk-in registered at the counter with no
      // account, which is most of this clinic's patients. Reporting it in red sends somebody
      // looking for a broken system instead of into Patient Records to add an email.
      if (status === 409) toastInfo('Nothing was sent', message);
      else toastError('The report could not be sent', message);
    } finally {
      setSendingId(null);
    }
  }, [onDelivered]);

  return {
    sendingId,
    confirming,
    /** Ask first. Putting a medical report in front of a patient is not an undoable click. */
    requestSend: (test) => setConfirming(test),
    dismissSend: () => setConfirming(null),
    confirmSend: () => send(confirming),
  };
}

export default useResultDelivery;
