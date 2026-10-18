import { formatDate } from './date';
import { categoryLabel, issuesReports } from './categories';

/**
 * Where one test on a visit stands, in the words the front desk answers a patient with. [1.130.0]
 *
 * "Is my result ready?" is asked at the counter more than anywhere, and the desk does not read
 * results (Patient Records gives them the patient's file, not the reports). The answer needs only
 * the state and the date: released, done, still with a department, waiting for payment, or
 * cancelled. `state` is also the test contract (`data-state`).
 */
export function testProgress(test, { paid = false } = {}) {
  const dept = categoryLabel(test.category);
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
      return { state: 'in-progress', label: `With ${dept}`, tone: 'working' };
    case 'Cancelled':
      return { state: 'cancelled', label: 'Cancelled', tone: 'quiet' };
    default:
      return paid
        ? { state: 'not-started', label: 'Not started yet', tone: 'quiet' }
        : { state: 'unpaid', label: 'Waiting for payment', tone: 'working' };
  }
}

export default testProgress;
