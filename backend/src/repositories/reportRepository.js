const db = require('../config/database');
const {
  ISSUED_IN_RANGE, REVERSED_IN_RANGE, ISSUED_IN_DAY_RANGE, MONEY_IN_RANGE, ISSUED_RECEIPT_CLAUSE
} = require('../constants/moneyRange');

class ReportRepository {
  /**
   * Money taken in per day. [1.30.0]
   *
   * `payment_status = 'Paid'` used to sit in this predicate, which meant a past day's bar shrank
   * whenever a receipt from that day was reversed weeks later — the chart rewrote history every
   * time a cashier corrected a mistake. Under the cash book a day's takings are what was taken
   * that day, whatever became of the receipt afterwards, so the bar is fixed once the day ends.
   *
   * `ISSUED_RECEIPT_CLAUSE` is new here and is what keeps 'Pending' checkout sessions out now
   * that the status test is gone: an online checkout inserts a row the moment the patient is
   * redirected, carrying a `paid_at` it got from DEFAULT CURRENT_TIMESTAMP, and that is not money
   * until the signed webhook says so.
   */
  async getRevenueTrend(startDate, endDate) {
    const queryText = `
      SELECT pay.paid_at::date as day, SUM(pay.amount) as total
      FROM payments pay
      WHERE ${ISSUED_RECEIPT_CLAUSE}
        AND ${ISSUED_IN_DAY_RANGE}
      GROUP BY pay.paid_at::date
      ORDER BY pay.paid_at::date
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  async getServiceVolume(startDate, endDate) {
    const queryText = `
      SELECT tc.name as category_name, COUNT(*) as test_count
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      WHERE vt.created_at >= $1::date AND vt.created_at < ($2::date + 1)
      GROUP BY tc.name
      ORDER BY test_count DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  async getVisitStatusBreakdown(startDate, endDate) {
    const queryText = `
      SELECT status, COUNT(*) as visit_count
      FROM patient_visits
      WHERE created_at >= $1::date AND created_at < ($2::date + 1)
      GROUP BY status
      ORDER BY status
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  // Same basis as the cashier's cash / e-wallet / bank tiles, which are FILTERed off `issued`
  // and are guaranteed in SQL to reconcile to `collected`. On the old basis this breakdown could
  // not add up to the collected figure shown beside it once anything was reversed. [1.30.0]
  async getPaymentMethodBreakdown(startDate, endDate) {
    const queryText = `
      SELECT pay.payment_method, SUM(pay.amount) as total, COUNT(*) as payment_count
      FROM payments pay
      WHERE ${ISSUED_RECEIPT_CLAUSE}
        AND ${ISSUED_IN_RANGE(true)}
      GROUP BY pay.payment_method
      ORDER BY total DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  // Feature Gap Plan Phase D: staff workload visibility existed for Cashier only
  // (CashierMonitoring.jsx's own byCashier, computed client-side from transactions). These two
  // mirror that pattern server-side for Reception and Diagnostic, the two departments Admin had
  // no per-staff throughput view for at all.
  async getReceptionWorkload(startDate, endDate) {
    // Staff only, and the report says so on its face — "Check-Ins by Staff".
    //
    // `patient_visits.created_by` is whoever opened the visit, and a client booking online opens
    // their own. So every self-service booking put a PATIENT into a staffing report, listed
    // beside the receptionist and counted as though they had worked a desk. On a report an
    // administrator would use to see who is carrying the front desk, that is not a cosmetic
    // problem: it invents throughput for someone who does not work here.
    //
    // The SQL mirrors isStaffUser in src/constants/roles.js — holds any role that is not
    // 'Client' — because that is this system's one definition of staff and a report must not
    // answer the question differently from the middleware.
    const queryText = `
      SELECT u.id as staff_id, u.first_name, u.last_name, COUNT(*) as visit_count
      FROM patient_visits pv
      JOIN users u ON pv.created_by = u.id
      WHERE pv.created_at >= $1::date AND pv.created_at < ($2::date + 1)
        AND EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = u.id AND r.name <> 'Client'
        )
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY visit_count DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  async getDiagnosticWorkload(startDate, endDate) {
    const queryText = `
      SELECT u.id as staff_id, u.first_name, u.last_name, tc.name as category_name, COUNT(*) as result_count
      FROM test_results tr
      JOIN users u ON tr.released_by = u.id
      JOIN visit_tests vt ON tr.visit_test_id = vt.id
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      -- is_current: an amended result would otherwise count once per version, inflating a
      -- clinician's throughput every time somebody corrected a report.
      WHERE tr.is_current
        AND tr.released_at >= $1::date AND tr.released_at < ($2::date + 1)
      GROUP BY u.id, u.first_name, u.last_name, tc.name
      ORDER BY result_count DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  // ── Per-department operational metrics [1.22.0] ────────────────────────────────────────────
  //
  // Every date predicate below is a half-open range on the raw column, never `col::date = …`.
  // A B-tree index cannot serve a predicate on an expression, so the cast form silently forces a
  // sequential scan whatever is indexed — measured at 50.7ms vs 0.84ms on 219k rows. See the
  // dates note in CLAUDE.md.

  /**
   * What the clinic actually sold, by service and by category.
   *
   * Revenue is attributed from `visit_tests.price_at_time` on visits that were PAID, not from
   * the payment total: a payment is one figure for a basket, and "which test earns the money" is
   * the question this answers. price_at_time rather than the live `tests.price` so a later price
   * change does not silently rewrite last month's numbers.
   *
   * The discount is apportioned across the visit's tests rather than ignored, otherwise the sum
   * of this breakdown would exceed the money actually taken — a report that does not reconcile
   * with the cash drawer is a report nobody trusts twice.
   */
  async getSalesByService(startDate, endDate) {
    const queryText = `
      WITH paid AS (
        SELECT pay.patient_visit_id,
               SUM(pay.amount)                            AS collected,
               SUM(pay.discount_amount + pay.vat_amount)  AS deducted
          FROM payments pay
         -- Must move with getBillingTotals and never separately: operations-report.spec.js
         -- asserts the sum of this breakdown reconciles to that query's collected figure to
         -- within a peso, and two bases would break it the moment anything is reversed. [1.30.0]
         WHERE ${ISSUED_RECEIPT_CLAUSE}
           AND ${ISSUED_IN_RANGE(true)}
         GROUP BY pay.patient_visit_id
      ),
      lines AS (
        SELECT vt.patient_visit_id,
               t.name  AS test_name,
               tc.name AS category_name,
               vt.price_at_time,
               -- Each test's share of the visit's gross, used to spread the deduction.
               vt.price_at_time / NULLIF(SUM(vt.price_at_time) OVER (PARTITION BY vt.patient_visit_id), 0) AS share
          FROM visit_tests vt
          JOIN tests t            ON t.id = vt.test_id
          JOIN test_categories tc ON tc.id = t.category_id
         WHERE vt.patient_visit_id IN (SELECT patient_visit_id FROM paid)
      )
      SELECT l.test_name, l.category_name,
             COUNT(*)::int                                              AS sold,
             SUM(l.price_at_time)::numeric(12,2)                        AS gross,
             SUM(l.price_at_time - (p.deducted * l.share))::numeric(12,2) AS net
        FROM lines l
        JOIN paid p ON p.patient_visit_id = l.patient_visit_id
       GROUP BY l.test_name, l.category_name
       ORDER BY net DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  /**
   * Cash-up figures: what was taken, what was given away, what was reversed.
   *
   * Three defects fixed together in [1.30.0], because they are one defect wearing three hats.
   * This is the query behind the "Takings" panel on the report that gets PRINTED, so a figure
   * that moves after the fact is a printout disagreeing with a screen.
   *
   * 1. It was left on `payment_status = 'Paid'` over a `paid_at` range while the cashier's
   *    summary moved to the cash book — so the two disagreed about the same day, and this half
   *    still restated closed days, which is the regression [1.30.0] is named for.
   *
   * 2. `refunds`/`refunded` counted `'Refunded'` only, so a receipt a staff member VOIDED —
   *    status 'Cancelled', a real reversal — was reported by the cashier's summary and by
   *    nothing at all here. Its amount fell out of `collected` too, under-reporting both sides
   *    at once, and BillingTotalsPanel hides the stat entirely when it is zero: a day of nothing
   *    but voids showed no reversal at all.
   *
   * 3. `receipt_number IS NOT NULL` was missing. Harmless only while (2) was also true — the two
   *    mistakes cancelled. Widen the reversal side without it and abandoned gateway checkouts,
   *    money never taken, immediately start reporting as refunds. One change, not two.
   */
  async getBillingTotals(startDate, endDate) {
    const issued = ISSUED_IN_RANGE(true);
    const reversed = REVERSED_IN_RANGE(true);
    const queryText = `
      SELECT
        COUNT(*) FILTER (WHERE ${issued})::int              AS receipts,
        COALESCE(SUM(pay.amount)      FILTER (WHERE ${issued}), 0)::numeric(12,2) AS collected,
        COALESCE(SUM(pay.discount_amount) FILTER (WHERE ${issued}), 0)::numeric(12,2) AS discounts,
        COALESCE(SUM(pay.vat_amount)  FILTER (WHERE ${issued}), 0)::numeric(12,2) AS vat_exempted,
        COUNT(*) FILTER (WHERE ${reversed})::int          AS refunds,
        COALESCE(SUM(pay.amount)      FILTER (WHERE ${reversed}), 0)::numeric(12,2) AS refunded
      FROM payments pay
      WHERE ${ISSUED_RECEIPT_CLAUSE}
        AND ${MONEY_IN_RANGE(true)}
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows[0];
  }

  /**
   * Front-desk throughput, including how long a patient waits to be billed.
   *
   * The wait is measured check-in -> payment because that is the part of the visit the front desk
   * and the till jointly own; everything after it belongs to a department and is measured
   * separately below. PERCENTILE_CONT for the median as well as the mean: one patient who came in
   * at 8am and paid at 5pm drags an average into uselessness, and the median is what actually
   * describes a normal morning.
   */
  async getReceptionThroughput(startDate, endDate) {
    const queryText = `
      SELECT
        COUNT(*)::int                                                    AS visits,
        COUNT(*) FILTER (WHERE pv.visit_type = 'Walk in')::int           AS walk_ins,
        COUNT(*) FILTER (WHERE pv.visit_type <> 'Walk in')::int          AS appointments,
        COUNT(*) FILTER (WHERE pv.status = 'Cancelled')::int             AS cancelled,
        COUNT(*) FILTER (WHERE pv.status = 'Completed')::int             AS completed,
        COALESCE(AVG(EXTRACT(EPOCH FROM (pay.paid_at - pv.created_at)) / 60)
                 FILTER (WHERE pay.paid_at IS NOT NULL), 0)::int         AS avg_wait_minutes,
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(EPOCH FROM (pay.paid_at - pv.created_at)) / 60
                 ), 0)::int                                              AS median_wait_minutes
      FROM patient_visits pv
      LEFT JOIN LATERAL (
        SELECT MIN(p2.paid_at) AS paid_at
          FROM payments p2
         WHERE p2.patient_visit_id = pv.id AND p2.payment_status = 'Paid'
      ) pay ON TRUE
      WHERE pv.created_at >= $1::date AND pv.created_at < ($2::date + 1)
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows[0];
  }

  /**
   * Per-department turnaround: payment to released report.
   *
   * Payment is the right start point because that is when the ticket actually reaches the
   * modality — a visit registered at 8am but paid at 11am did not spend three hours in the lab.
   * `is_current` throughout, or an amended report counts twice and its correction time is
   * averaged in as though it were a second patient.
   */
  async getDiagnosticThroughput(startDate, endDate) {
    const queryText = `
      SELECT tc.name AS category_name,
             COUNT(*)::int                                        AS released,
             COUNT(*) FILTER (WHERE tr.is_critical)::int          AS critical,
             COUNT(*) FILTER (WHERE tr.version > 1)::int          AS amended,
             COALESCE(AVG(EXTRACT(EPOCH FROM (tr.released_at - pay.paid_at)) / 60)
                      FILTER (WHERE pay.paid_at IS NOT NULL), 0)::int AS avg_turnaround_minutes,
             COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (
                        ORDER BY EXTRACT(EPOCH FROM (tr.released_at - pay.paid_at)) / 60
                      ), 0)::int                                  AS median_turnaround_minutes
        FROM test_results tr
        JOIN visit_tests vt     ON vt.id = tr.visit_test_id
        JOIN tests t            ON t.id = vt.test_id
        JOIN test_categories tc ON tc.id = t.category_id
        LEFT JOIN LATERAL (
          SELECT MIN(p2.paid_at) AS paid_at
            FROM payments p2
           WHERE p2.patient_visit_id = vt.patient_visit_id AND p2.payment_status = 'Paid'
        ) pay ON TRUE
       WHERE tr.is_current
         AND tr.released_at >= $1::date AND tr.released_at < ($2::date + 1)
       GROUP BY tc.name
       ORDER BY released DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  /** Work still outstanding right now — a backlog, not a date range. */
  async getOutstandingWork() {
    const queryText = `
      SELECT tc.name AS category_name,
             COUNT(*) FILTER (WHERE vt.status = 'Processing')::int          AS awaiting_exam,
             COUNT(*) FILTER (WHERE vt.status = 'Waiting for Release')::int AS awaiting_release
        FROM visit_tests vt
        JOIN tests t            ON t.id = vt.test_id
        JOIN test_categories tc ON tc.id = t.category_id
       WHERE vt.status IN ('Processing', 'Waiting for Release')
       GROUP BY tc.name
       ORDER BY tc.name
    `;
    const result = await db.query(queryText);
    return result.rows;
  }

  /**
   * What the clinic's HMO work is worth, per provider.
   *
   * ── An approved claim is NOT money in the drawer ────────────────────────────────────────────
   *
   * This is the whole reason the query is shaped this way. An approved HMO test is a RECEIVABLE:
   * the clinic bills the insurer and is paid later, through a channel this system does not see.
   * `payments` never contains it. So `approved` must never be added to, compared against, or
   * presented as the same kind of number as `collected` — doing that reports the same peso twice,
   * once as a claim and once as cash, and inflates revenue by exactly the amount the clinic is
   * still waiting for.
   *
   * The four figures answer four different questions and are returned side by side, never netted:
   *
   *   approved   billable to the insurer — work done, decision favourable, cash not yet in
   *   refused    the HMO said no, so it falls to the PATIENT — the counter conversation [1.27.0]
   *   pending    undecided, and therefore at risk of becoming either of the two above
   *   collected  what the patient actually paid at the counter on these visits. This one IS in
   *              the cash-up already, and is here only so the two halves of an HMO visit can be
   *              seen together
   *
   * ── Why the visit's date, not the decision's ────────────────────────────────────────────────
   *
   * Bucketed by `patient_visits.created_at`: "HMO work done in this period". A claim decided
   * three weeks later would otherwise move a peso out of a period already reported — the closed-
   * day restatement [1.30.0] exists to prevent, arriving by a different door. A period's figures
   * are fixed by when the work happened; only the split between the columns changes as claims
   * are decided, which is the honest behaviour.
   *
   * Half-open range on the raw column, never `created_at::date` — see CLAUDE.md.
   */
  async getHmoClaimTotals(startDate, endDate) {
    const queryText = `
      WITH claim_lines AS (
        SELECT hp.name                AS provider_name,
               vt.price_at_time,
               pv.id                  AS patient_visit_id,
               -- The effective decision on ONE test, read from BOTH levels.
               --
               -- A claim and its tests are decided independently and can legitimately disagree:
               -- approveRequest sets hmo_requests.status alone, and PUT /hmo/request-test/:id
               -- sets each test. That is not a bug — an HMO routinely clears a claim while
               -- refusing one line on it — but it means a report reading either column BY ITSELF
               -- misstates the money. Reading only the per-test column reported an approved claim
               -- as ₱0 approved and its full value still Pending; reading only the claim column
               -- would report a refused test as billable.
               --
               -- A refusal at either level wins, matching the partial unique index on this table
               -- in schema.sql, whose predicate is approval_status <> 'Rejected' -- it treats a
               -- rejected test as no longer a live claim on that work.
               CASE
                 WHEN hr.status = 'Rejected' OR hrt.approval_status = 'Rejected' THEN 'Rejected'
                 WHEN hr.status = 'Approved'                                     THEN 'Approved'
                 ELSE 'Pending'
               END AS effective_status
          FROM hmo_requests hr
          JOIN hmo_providers hp     ON hp.id = hr.hmo_provider_id
          JOIN hmo_request_tests hrt ON hrt.hmo_request_id = hr.id
          JOIN visit_tests vt       ON vt.id = hrt.visit_test_id
          JOIN patient_visits pv    ON pv.id = vt.patient_visit_id
         WHERE pv.created_at >= $1::date AND pv.created_at < ($2::date + 1)
      ),
      -- Counter takings per visit, resolved BEFORE the join so a visit carrying three claimed
      -- tests contributes its receipt once rather than three times. Summing payments alongside
      -- the lines is how a two-test claim reports double the money that was actually taken.
      visit_cash AS (
        SELECT pay.patient_visit_id,
               SUM(pay.amount)::numeric(12,2) AS collected
          FROM payments pay
         WHERE ${ISSUED_RECEIPT_CLAUSE}
           AND pay.patient_visit_id IN (SELECT patient_visit_id FROM claim_lines)
         GROUP BY pay.patient_visit_id
      )
      SELECT cl.provider_name,
             COUNT(*)::int                                                                  AS tests_claimed,
             COUNT(DISTINCT cl.patient_visit_id)::int                                       AS visits,
             COALESCE(SUM(cl.price_at_time) FILTER (WHERE cl.effective_status = 'Approved'), 0)::numeric(12,2) AS approved,
             COALESCE(SUM(cl.price_at_time) FILTER (WHERE cl.effective_status = 'Rejected'), 0)::numeric(12,2) AS refused,
             COALESCE(SUM(cl.price_at_time) FILTER (WHERE cl.effective_status = 'Pending'),  0)::numeric(12,2) AS pending,
             COALESCE((
               SELECT SUM(vc.collected)
                 FROM visit_cash vc
                WHERE vc.patient_visit_id IN (
                  SELECT cl2.patient_visit_id FROM claim_lines cl2
                   WHERE cl2.provider_name = cl.provider_name
                )
             ), 0)::numeric(12,2)                                                           AS collected
        FROM claim_lines cl
       GROUP BY cl.provider_name
       ORDER BY approved DESC, cl.provider_name
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  /**
   * Turnaround per department, measured against a target. [1.62.0]
   *
   * ── Two spans, deliberately, and neither is called just "turnaround" ────────────────────────
   *
   * There are two honest answers to "how long did that take", and this codebase already publishes
   * one of them: `getDiagnosticThroughput` reports `median_turnaround_minutes` measured from
   * PAYMENT to release, on the documented grounds that a visit registered at 8am and paid at 11am
   * did not spend three hours in the lab.
   *
   * The other — registration to release — is what the PATIENT experienced, and it is the more
   * useful number for a clinic asking where its capacity goes. Both belong here. What must not
   * happen is a second query publishing a different figure under the SAME name as the first, on a
   * screen sitting beside it: that is precisely how the cashier's strip and the operations report
   * spent a day disagreeing about the same money in [1.32.0], and CLAUDE.md keeps the scar.
   *
   * So the columns say which is which:
   *
   *   median_turnaround_minutes  payment -> release. The DEPARTMENT-owned span, identical in
   *                              basis to getDiagnosticThroughput, and the one the target is
   *                              measured against — you cannot hold Ultrasound to a target for
   *                              time the patient spent queueing at the till.
   *   median_total_minutes       registration -> release. The whole visit, end to end.
   *
   * ── Why p90 as well as the median ───────────────────────────────────────────────────────────
   *
   * A median hides its own tail by construction: half the patients are above it and it says
   * nothing about how far. A department can hold a 45-minute median while one report in ten takes
   * four hours, and it is the four-hour patient who telephones. The 90th percentile names that
   * case, and `within_target_rate` says how often the promise was actually kept — which is the
   * figure an SLA is, as opposed to an average that no individual patient ever experiences.
   *
   * Targets are supplied by the caller rather than stored: they are a clinic policy, not a fact
   * about the data, and inventing a table for three numbers nobody has agreed yet would be
   * pretending otherwise. `$3::jsonb` carries them in as department -> minutes.
   */
  async getDepartmentTurnaroundPerformance(startDate, endDate, targets = {}) {
    const queryText = `
      WITH released AS (
        SELECT tc.name AS category_name,
               EXTRACT(EPOCH FROM (tr.released_at - pay.paid_at)) / 60      AS dept_minutes,
               EXTRACT(EPOCH FROM (tr.released_at - pv.created_at)) / 60    AS total_minutes,
               COALESCE(($3::jsonb ->> tc.name)::numeric, NULL)             AS target_minutes
          FROM test_results tr
          JOIN visit_tests vt     ON vt.id = tr.visit_test_id
          JOIN tests t            ON t.id = vt.test_id
          JOIN test_categories tc ON tc.id = t.category_id
          JOIN patient_visits pv  ON pv.id = vt.patient_visit_id
          -- Same LATERAL as getDiagnosticThroughput: the FIRST settled payment on the visit is
          -- when the ticket actually reached the modality. A plain JOIN to payments would
          -- multiply a visit's rows by its receipts and weight that visit's turnaround twice.
          LEFT JOIN LATERAL (
            SELECT MIN(p2.paid_at) AS paid_at
              FROM payments p2
             WHERE p2.patient_visit_id = vt.patient_visit_id AND p2.payment_status = 'Paid'
          ) pay ON TRUE
         -- is_current, or an amended report is counted once per version and its correction time
         -- is averaged in as though it were a second patient.
         WHERE tr.is_current
           AND tr.released_at IS NOT NULL
           AND tr.released_at >= $1::date AND tr.released_at < ($2::date + 1)
      )
      SELECT category_name,
             COUNT(*)::int                                                       AS released,
             COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dept_minutes), 0)::int  AS median_turnaround_minutes,
             COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY dept_minutes), 0)::int  AS p90_turnaround_minutes,
             COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_minutes), 0)::int AS median_total_minutes,
             MAX(target_minutes)::int                                            AS target_minutes,
             COUNT(*) FILTER (
               WHERE target_minutes IS NOT NULL AND dept_minutes <= target_minutes
             )::int                                                              AS within_target,
             -- NULLIF on the denominator, not a CASE: a department with a report released but no
             -- payment behind it has no measurable span, and 0/0 must be NULL ("not measured")
             -- rather than 0 ("never hit the target"). The CSV writes NULL as an empty cell.
             ROUND(
               100.0 * COUNT(*) FILTER (
                 WHERE target_minutes IS NOT NULL AND dept_minutes <= target_minutes
               ) / NULLIF(COUNT(*) FILTER (WHERE target_minutes IS NOT NULL AND dept_minutes IS NOT NULL), 0)
             , 1)::float                                                         AS within_target_rate
        FROM released
       GROUP BY category_name
       ORDER BY category_name
    `;
    const result = await db.query(queryText, [startDate, endDate, JSON.stringify(targets)]);
    return result.rows;
  }

  /**
   * Arrivals by hour of day, split walk-in against booked. [1.62.0]
   *
   * What it is for: the clinic staffs the front desk evenly across the day and has never had a
   * picture of when patients actually turn up. A peak an hour after opening is a rota problem,
   * and a rota problem is invisible in any figure aggregated to the day.
   *
   * `generate_series` supplies the hours the clinic is open, LEFT JOINed to the data, so an hour
   * with no arrivals is a zero rather than a missing bar. That distinction is the whole point of
   * the chart: a gap at 11am and a quiet 11am look identical once the row is simply absent, and
   * only one of them is worth acting on.
   *
   * The window is the clinic's own operating span, read from clinic_operating_hours rather than
   * hardcoded, so a schedule change moves the chart with it. COALESCE bounds it if the table is
   * empty, and the range is clamped to whole hours because that is the axis.
   *
   * EXTRACT(HOUR FROM …) reads the SERVER's local hour, which is what CURRENT_DATE elsewhere in
   * this file already assumes — deriving it in JavaScript would reintroduce exactly the UTC
   * offset bug CLAUDE.md documents, one hour at a time.
   */
  async getHourlyPatientArrivals(startDate, endDate) {
    const queryText = `
      WITH bounds AS (
        SELECT COALESCE(MIN(EXTRACT(HOUR FROM open_time))::int, 7)   AS first_hour,
               COALESCE(MAX(EXTRACT(HOUR FROM close_time))::int, 17) AS last_hour
          FROM clinic_operating_hours
         WHERE is_open
      ),
      hours AS (
        SELECT generate_series((SELECT first_hour FROM bounds), (SELECT last_hour FROM bounds)) AS hour
      ),
      arrivals AS (
        SELECT EXTRACT(HOUR FROM pv.created_at)::int AS hour,
               COUNT(*) FILTER (WHERE pv.visit_type = 'Walk in')::int    AS walk_in,
               COUNT(*) FILTER (WHERE pv.visit_type = 'Appointment')::int AS online
          FROM patient_visits pv
         -- Half-open range on the raw column. Never created_at::date — a B-tree cannot serve a
         -- predicate on an expression, and this is one of the fastest-growing tables here.
         WHERE pv.created_at >= $1::date AND pv.created_at < ($2::date + 1)
         GROUP BY EXTRACT(HOUR FROM pv.created_at)
      )
      SELECT h.hour,
             COALESCE(a.walk_in, 0) AS walk_in,
             COALESCE(a.online, 0)  AS online,
             COALESCE(a.walk_in, 0) + COALESCE(a.online, 0) AS total
        FROM hours h
        LEFT JOIN arrivals a ON a.hour = h.hour
       ORDER BY h.hour
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  /**
   * How often the front desk actually clears one patient. [1.62.0]
   *
   * ── This is a SERVICE RATE, not a wait ──────────────────────────────────────────────────────
   *
   * The distinction is the whole correctness of the queue estimate above it, and getting it wrong
   * produces numbers that are not slightly off but absurd.
   *
   * `getReceptionThroughput` already reports a median WAIT — check-in to billed — and on this
   * clinic's own data that is 36 to 96 minutes. Multiplying it by the number of people ahead, as
   * the obvious reading of "patients ahead x median service duration" invites, tells the fourth
   * person in a queue they have a four-hour wait. It is wrong because a wait already CONTAINS the
   * queue: everyone waiting at once shares the same 40 minutes, they do not each add 40 to the
   * next person.
   *
   * What multiplies correctly is the interval between consecutive patients being SERVED. If the
   * desk settles one bill every six minutes and three people are ahead, the fourth waits about
   * eighteen minutes. So: LAG over each day's settlements, and the median of those gaps.
   *
   * ── Why the gaps are bounded ────────────────────────────────────────────────────────────────
   *
   * Partitioned by day so the gap from the last patient of Monday to the first of Tuesday — some
   * sixteen hours — is never a sample. Within a day the lunch lull produces the same distortion in
   * miniature, so gaps over an hour are discarded as "the desk was idle, not busy": an idle period
   * says nothing about how fast the clinic serves people, which is the only thing being measured.
   * The floor of half a minute drops double-settlements of one visit, which are one transaction.
   *
   * PERCENTILE_CONT over AVG for the reason stated throughout this file: one patient who argued
   * about a bill for forty minutes should not move everybody else's estimate.
   */
  async getMedianServiceMinutes(lookbackDays = 30) {
    const queryText = `
      WITH settled AS (
        SELECT pay.paid_at,
               pay.paid_at::date AS day,
               LAG(pay.paid_at) OVER (PARTITION BY pay.paid_at::date ORDER BY pay.paid_at) AS previous_paid_at
          FROM payments pay
         WHERE ${ISSUED_RECEIPT_CLAUSE}
           AND pay.paid_at >= (CURRENT_DATE - $1::int)
           AND pay.paid_at < (CURRENT_DATE + 1)
      ),
      gaps AS (
        SELECT EXTRACT(EPOCH FROM (paid_at - previous_paid_at)) / 60 AS minutes
          FROM settled
         WHERE previous_paid_at IS NOT NULL
      )
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes)::numeric(10,2) AS median_minutes,
             COUNT(*)::int                                                       AS sample_size
        FROM gaps
       -- An idle desk is not a slow desk. Both bounds are about excluding periods when nobody
       -- was being served, rather than about trimming outliers for neatness.
       WHERE minutes BETWEEN 0.5 AND 60
    `;
    const result = await db.query(queryText, [lookbackDays]);
    return result.rows[0] || { median_minutes: null, sample_size: 0 };
  }

  /**
   * The same daily revenue series as getRevenueTrend, for an arbitrary range. [1.62.0]
   *
   * Exists so the trend chart can overlay a previous period without a second endpoint or a
   * different basis — it delegates rather than re-deriving, because a comparison drawn from two
   * differently-computed series is worse than no comparison at all.
   */
  async getRevenueTrendForRange(startDate, endDate) {
    return this.getRevenueTrend(startDate, endDate);
  }
}

module.exports = new ReportRepository();
