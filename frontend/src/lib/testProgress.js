import { formatDate, toDateInput, todayStr } from './date';
import { categoryLabel, issuesReports } from './categories';

/**
 * Where one test on a visit stands, in the words the front desk answers a patient with. [1.130.0]
 *
 * "Is my result ready?" is asked at the counter more than anywhere, and the desk does not read
 * results (Patient Records gives them the patient's file, not the reports). The answer needs only
 * the state and the date: released, done, still with a department, waiting for payment, or
 * cancelled. `state` is also the test contract (`data-state`).
 *
 * Unfinished work from an EARLIER day says since when (`since`, the visit's date): "With
 * Laboratory" on its own read as current, and a test paid yesterday and never started is a
 * different conversation with the patient from one sent to the lab an hour ago.
 */
export function testProgress(test, { paid = false, since = null, today = todayStr() } = {}) {
  const dept = categoryLabel(test.category);
  const carried = since && toDateInput(new Date(since)) < today ? `Since ${formatDate(since)}` : null;
  switch (test.status) {
    case 'Completed':
      if (test.released_at) {
        return { state: 'released', label: `Released ${formatDate(test.released_at)}`, tone: 'done' };
      }
      if (test.done_at || !issuesReports(test.category)) {
        return {
          state: 'done',
          label: test.done_at ? `Done ${formatDate(test.done_at)}` : 'Done',
          detail: `Result from the ${dept} department`,
          tone: 'done',
        };
      }
      return { state: 'released', label: 'Finished', tone: 'done' };
    case 'Processing':
    case 'Waiting for Release':
      return { state: 'in-progress', label: `With ${dept}`, detail: carried, tone: 'working' };
    case 'Cancelled':
      return { state: 'cancelled', label: 'Cancelled', tone: 'quiet' };
    default:
      return paid
        ? { state: 'not-started', label: 'Not started yet', detail: carried, tone: 'quiet' }
        : { state: 'unpaid', label: 'Waiting for payment', detail: carried, tone: 'working' };
  }
}

export default testProgress;
