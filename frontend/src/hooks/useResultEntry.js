import { useState } from 'react';
import api from '../config/api';
import { toastSuccess, toastInfo, toastWarning } from '../lib/toast';

// Mirrors backend/src/config/upload.js's own allowlist and size cap, so a mismatched file is
// rejected instantly instead of round-tripping to the server first.
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

/**
 * Writing a diagnostic report, and releasing it.
 *
 * Recording findings and releasing them are two distinct events, matching the two ticket states
 * the front desk sees: `record` parks the ticket in 'Waiting for Release', and only `release`
 * notifies the patient. They were once one action, so "Authorize & Release Result" recorded
 * findings and told nobody.
 *
 * The form is reached three ways, and each resets a different amount:
 *
 *   openFor(test)      a new report, or editing one still awaiting release
 *   openForEdit(test)  amending a report that has already gone out
 *   openRelease(test)  releasing straight from a table row, with no form at all
 *
 * That third one is why every opener resets `findings`. Releasing from a row skips the form
 * entirely, and `release` below saves whatever is in `findings` first — so leftover text from a
 * previous ticket's session would be written over THIS ticket's recorded result, silently,
 * moments before it is sent to the patient.
 *
 * @param {object} user  who is releasing, for the receipt-style attribution on the success panel
 * @param {(test: object) => void} onOpened    the form opened for a test — for loading context
 * @param {() => void} onRecorded              findings saved, ticket now awaiting release
 * @param {() => void} onReleased              report sent
 */
/**
 * Stored rows -> the form's shape.
 *
 * The API returns one row per recorded field; the form holds a map keyed by field code, because
 * that is what makes "did the client render this field?" answerable when it submits. A derived
 * row is carried in too, so the technician can see the weight the last save computed rather than
 * an empty box that looks like missing data.
 */
export function useResultEntry({ user, onOpened, onRecorded, onReleased } = {}) {
  const [activeTest, setActiveTest] = useState(null);
  const [resultFile, setResultFile] = useState(null);

  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [releasing, setReleasing] = useState(false);

  /**
   * Shown in place of the form straight after a release, so "Print Now" does not mean navigating
   * to History and finding the same result again.
   */
  const [justReleased, setJustReleased] = useState(null);

  const [isEditing, setIsEditing] = useState(false);

  /** Why a released report is being changed. Kept with the superseded version, so the amendment
   *  history says what changed and not merely that something did. */
  const [amendmentReason, setAmendmentReason] = useState('');

  /**
   * A reason is owed once the report has left the department, and only then. Re-saving a ticket
   * still 'Waiting for Release' is drafting — the findings have been seen by nobody, so demanding
   * a justification for fixing your own typo just fills the box with "typo" until it stops
   * meaning anything. Mirrors the server rule in resultService.uploadResult, which is the one
   * that actually enforces it.
   */
  const isAmendingReleased = isEditing && activeTest?.test_status === 'Completed';

  const resetForm = () => {
    // `resultFile` is a File picked in a previous dialog session. Clearing it is the whole point:
    // release() submits whatever is in state, so carrying one over would attach the PREVIOUS
    // patient's report to this patient's result moments before it is emailed to them. What a
    // ticket already HAS on the server is read from activeTest.file_path, never from here.
    setResultFile(null);
    setError('');
  };

  /** Open the form for a worklist ticket. */
  const openFor = async (test) => {
    setActiveTest(test);
    setIsEditing(false);
    resetForm();
    // Never carry an amendment reason over from the previous ticket: it describes a change to
    // one report and means nothing on the next.
    setAmendmentReason('');
    setJustReleased(null);
    setOpen(true);

    onOpened?.(test);
  };

  /**
   * Amend a report that has already been released. Same form, pre-filled. Re-submitting reuses
   * the same upsert and release the original used, so a correction also re-notifies the patient
   * by email — deliberate: they should know the result they were sent has since been corrected.
   */
  const openForEdit = async (test) => {
    setActiveTest(test);
    setIsEditing(true);
    setResultFile(null);
    setError('');
    // The reason starts empty on purpose — it describes THIS change, not the previous one.
    setAmendmentReason('');
    setJustReleased(null);
    setOpen(true);
    onOpened?.(test);
  };

  /** Release straight from a table row, bypassing the form. See the note above about resetting. */
  const openRelease = (test) => {
    setActiveTest(test);
    resetForm();
    setAmendmentReason('');
    setConfirmingRelease(true);
  };

  /**
   * Closing also drops the just-released panel. All three ways of closing wanted both, and a
   * success panel that survives the dialog reappears over the NEXT ticket someone opens.
   */
  const close = () => {
    if (saving || releasing) return;
    setOpen(false);
    setJustReleased(null);
  };

  const dismissReleaseConfirm = () => {
    if (releasing) return;
    setConfirmingRelease(false);
  };

  const chooseFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setResultFile(null);
      return;
    }
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      setError('Unsupported file type. Only PDF, JPEG, and PNG files are allowed.');
      e.target.value = '';
      setResultFile(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError('File is too large. Maximum size is 15MB.');
      e.target.value = '';
      setResultFile(null);
      return;
    }
    setError('');
    setResultFile(file);
  };

  /**
   * The report document is what a result IS. [1.94.0]
   *
   * Required to RELEASE, not to save: a technician still parks a ticket in 'Waiting for Release'
   * while the report is being produced, which is what that state has always been for. The check
   * accepts a file already on the record as well as a newly chosen one, because an amendment and
   * a release-from-row both legitimately carry no new upload.
   *
   * The server enforces this too. This exists so the refusal arrives before the confirm dialog
   * rather than after it.
   */
  const hasReport = () => Boolean(resultFile || activeTest?.file_path);

  const validateForRelease = () => {
    if (!hasReport()) {
      setError('Attach the report file before releasing this result.');
      return false;
    }
    return true;
  };

  /**
   * One submit path for both exits from the form. Multipart when a file is attached, plain JSON
   * otherwise — the same endpoint accepts both, since uploadResultFileMiddleware only engages
   * for multipart bodies. `amendmentReason` is meaningful only when correcting an already
   * recorded result and is ignored by the backend on a first version.
   */
  const submitReport = async () => {
    if (resultFile) {
      const formData = new FormData();
      formData.append('file', resultFile);
      if (isEditing) formData.append('amendmentReason', amendmentReason);
      await api.post(`/results/${activeTest.visit_test_id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return;
    }
    // No new document: the flag or the amendment reason is the only thing being recorded, and the
    // server carries the existing file forward.
    await api.post(`/results/${activeTest.visit_test_id}`, {
      ...(isEditing ? { amendmentReason } : {}),
    });
  };

  /** Save the findings and park the ticket in 'Waiting for Release'. Notifies nobody. */
  const record = async (e) => {
    e?.preventDefault();
    setError('');

    setSaving(true);
    try {
      await submitReport();
      setOpen(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record diagnostic result.');
      return;
    } finally {
      setSaving(false);
    }
    onRecorded?.();
  };

  /**
   * Ask before releasing. Releasing is clinically significant and effectively irreversible from
   * this screen — the report goes to the patient.
   */
  const requestRelease = () => {
    setError('');
    if (!validateForRelease()) return;
    setConfirmingRelease(true);
  };

  const release = async () => {
    setReleasing(true);
    setError('');

    try {
      // Submit ONLY when a new document was chosen. A ticket parked in 'Waiting for Release'
      // already has its report on the server, so there is nothing to save and only to release.
      //
      // The narrowness matters. A predicate that also fired on "a file exists on the record"
      // would post the form on every release-from-row, minting a second version with an
      // "Amended" badge for an amendment nobody made.
      if (resultFile) await submitReport();

      const releaseRes = await api.post(`/results/${activeTest.visit_test_id}/release`);
      const emailStatus = releaseRes.data.data.result?.emailStatus;

      // What actually happened, not a blanket "released and notified". This used to claim
      // success even when sendEmail had failed or silently skipped on unconfigured SMTP.
      // A WARNING, not an error. [1.54.0] The release SUCCEEDED — the report is out, the visit
      // has moved on, and there is nothing to undo. Only the email did not go. Reporting that in
      // red says the release failed, which sends a technician looking for a problem that is not
      // there, and risks them releasing it a second time.
      //
      // The description carries the action, because the headline states an outcome and the
      // reader's next question is "so what do I do".
      if (emailStatus === 'sent') {
        toastSuccess('Result released and the patient was notified by email.');
      } else if (emailStatus === 'failed') {
        toastWarning(
          'Result released — but the email did not send.',
          'The report is available in the portal. Telephone the patient if this one is urgent.'
        );
      } else {
        toastInfo(
          'Result released. No email address on file.',
          'The patient can still read it in their portal, or collect a printed copy.'
        );
      }

      setConfirmingRelease(false);

      // Re-read what was actually stored rather than rebuilding the document from form state.
      // [1.53.0] The reconstruction carried no signatories, no discipline heading and no section
      // headings — `activeTest` comes from the worklist query, which has none of them — so the
      // certificate handed across the counter printed "DO NOT ACKNOWLEDGE THE RESULT WITHOUT THE
      // OFFICIAL SEAL" above no signatures, as a flat list, while the same result viewed one screen
      // away showed all three. That is the "three renderings that agree only by coincidence"
      // failure ResultReport was extracted to end, reappearing as three data shapes.
      let stored = null;
      try {
        stored = (await api.get(`/results/${activeTest.visit_test_id}`)).data.data.result;
      } catch {
        // Non-fatal: the release succeeded either way, and the panel falls back to what is in hand.
      }

      setJustReleased(stored ? { ...activeTest, ...stored } : {
        ...activeTest,
        released_at: new Date().toISOString(),
        released_by_first_name: user?.firstName,
        released_by_last_name: user?.lastName,
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to release diagnostic result.');
      setConfirmingRelease(false);
      return;
    } finally {
      setReleasing(false);
    }

    // The report has gone to the patient. Nothing past here may report it as failed.
    onReleased?.();
  };

  return {
    activeTest,
    resultFile, hasReport,
    open, error, saving,
    confirmingRelease, releasing,
    justReleased,
    isEditing, isAmendingReleased,
    amendmentReason, setAmendmentReason,
    openFor, openForEdit, openRelease,
    close, dismissReleaseConfirm,
    chooseFile,
    record, requestRelease, release,
  };
}

export default useResultEntry;
