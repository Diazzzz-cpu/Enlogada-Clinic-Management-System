import { toast } from 'sonner';

/**
 * The clinic's toast vocabulary. [1.54.0]
 *
 * ── An error is not a success wearing red ───────────────────────────────────────────────────
 *
 * These used to share one dwell time, which treated two different events as the same. A success
 * CONFIRMS something the reader just did: they pressed Verify, the receipt number appears, they
 * glance and move on. An error asks them to do something DIFFERENTLY, and several of this app's
 * errors are consequential enough to need reading twice —
 *
 *     "Result released — email notification failed, patient was not notified."
 *
 * That sentence changes what happens next: somebody has to telephone. Giving it the same three
 * seconds as "Saved" is how it gets missed.
 *
 * So an error dwells more than twice as long and carries a close button, and a success stays
 * brief enough not to sit over the screen the reader has already moved on to.
 *
 * ── Why not simply make everything longer ───────────────────────────────────────────────────
 *
 * A toast that outstays its message trains people to dismiss toasts without reading them, which
 * costs exactly the errors this is trying to protect. Short for the routine, long for the thing
 * that matters, is the trade.
 */

/** Confirmation of something the reader just did. Brief on purpose. */
const SUCCESS_MS = 3500;

/** Something that changes what happens next. Long enough to read, and dismissible. */
const ERROR_MS = 8000;

/** Neutral notice — neither a confirmation nor a problem. */
const INFO_MS = 5000;

export function toastSuccess(message, description) {
  return toast.success(message, { duration: SUCCESS_MS, description });
}

export function toastError(message, description) {
  return toast.error(message, { duration: ERROR_MS, description });
}

export function toastInfo(message, description) {
  return toast(message, { duration: INFO_MS, description });
}

/**
 * A caution: the thing worked, but not completely.
 *
 * Distinct from an error because the outcome is not a failure and the reader must not undo
 * anything — a result WAS released, the email merely did not go. Reporting that in red says the
 * release failed, which is a different and wrong instruction.
 */
export function toastWarning(message, description) {
  return toast.warning(message, { duration: ERROR_MS, description });
}

/**
 * Tie a toast to work already in flight.
 *
 * For operations where the button's own spinner is not the whole story — the caller is navigating
 * away, or the work outlives the control that started it. Returns the promise untouched so the
 * caller's own error handling is unaffected: this reports, it does not swallow.
 */
export function toastPromise(promise, { loading, success, error }) {
  toast.promise(promise, {
    loading,
    success,
    error,
    duration: SUCCESS_MS,
  });
  return promise;
}

/** Dismiss one toast by the id these helpers return, or all of them when called bare. */
export function dismissToast(id) {
  toast.dismiss(id);
}
