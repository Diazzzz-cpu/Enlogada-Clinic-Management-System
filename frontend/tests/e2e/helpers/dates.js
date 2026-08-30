/**
 * Dates a booking spec can rely on. [1.60.0]
 *
 * ── Never toISOString ───────────────────────────────────────────────────────────────────────
 *
 * It returns the UTC date, which in Philippine time is *yesterday* between midnight and 08:00.
 * CLAUDE.md records this shipping three times in the app; it also reached the suite, where
 * `ticket-release-gating.spec.js` computed "tomorrow" as a UTC date, resolved it to a Sunday the
 * clinic is closed on, and **silently skipped three security tests**. A check that quietly does
 * not run reads exactly like one that passed. Everything here is built from local getters.
 *
 * ── Why counting beats offset-then-skip ─────────────────────────────────────────────────────
 *
 * The obvious helper — "today + N, then push off a weekend" — is what every spec here wrote, and
 * it has now failed twice for two different reasons:
 *
 *   the SATURDAY case   the clinic opens 08:00-17:00 on weekdays but only 08:00-12:00 on
 *                       Saturday, 18 slots against 8. A helper that skipped Sunday alone gave a
 *                       spec less than half the capacity it expected whenever today+N landed on
 *                       a Saturday, and it failed claiming its way through the slots.
 *
 *   the COLLAPSE case   fixed by also skipping Saturday — which introduced this. When today+150
 *                       is a Sunday it pushes to Monday, and today+151 is that same Monday. Two
 *                       constants meant to be different days silently become one, so "move this
 *                       booking to another day" becomes "move it to the slot it already holds",
 *                       and four reschedule tests fail on a correct 409. Measured on 2026-08-27:
 *                       both DAY_A and DAY_B resolved to 2027-01-25.
 *
 * Counting working days makes distinctness structural instead of accidental: nthWorkingDay(n) and
 * nthWorkingDay(n + 1) are different days for every n, on every calendar, forever. That is the
 * property the specs were assuming all along and never actually had.
 *
 * Both failures share a shape worth naming: nothing in the application had changed, the calendar
 * had. A test that passes or fails on the day of the week is worse than one that always fails,
 * because the morning goes on looking for a regression that is not there.
 */

/** Local-date 'YYYY-MM-DD'. Never toISOString. */
export function dateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Today, in the clinic's timezone rather than UTC. */
export const todayStr = () => dateStr(new Date());

/** Is the clinic open on this weekday at full weekday hours? Saturday is short; Sunday is shut. */
const isFullWeekday = (d) => d.getDay() !== 0 && d.getDay() !== 6;

/**
 * The Nth full weekday from today, counting forward. n = 1 is the next one.
 *
 * Saturday is excluded as well as Sunday — the clinic does open on Saturday, but for 8 slots
 * rather than 18, and a spec that claims its way through a list of slots needs the wide day.
 */
export function nthWorkingDay(n) {
  const d = new Date();
  let counted = 0;
  // Bounded so a mistake is a failed test rather than a hung one.
  for (let i = 0; i < 4000 && counted < n; i += 1) {
    d.setDate(d.getDate() + 1);
    if (isFullWeekday(d)) counted += 1;
  }
  return dateStr(d);
}

/** The next full weekday. Shorthand for the common case. */
export const nextWorkingDay = () => nthWorkingDay(1);
