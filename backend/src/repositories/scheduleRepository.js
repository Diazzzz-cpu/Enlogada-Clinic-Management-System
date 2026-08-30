const db = require('../config/database');
// Shared with the two capacity checks in appointmentService/appointmentRepository, so the grid
// and the booking cannot disagree about whether a slot is free. [1.35.0]
const { OCCUPIES_SLOT } = require('../constants/slotHold');

/**
 * A DATE column comes back from node-postgres as a JS Date at LOCAL midnight, and anything that
 * then reaches for .toISOString() gets the UTC date — which in PHT is the day before, between
 * midnight and 08:00. Measured: closing 2026-11-24 reported "2026-11-23 is now closed".
 *
 * So the date never becomes a Date at all. It is formatted in SQL and travels as a string, which
 * is the same rule the rest of the backend follows.
 */
const overrideColumns = (a = '') => `
  ${a}id, TO_CHAR(${a}override_date, 'YYYY-MM-DD') AS override_date, ${a}is_open,
  ${a}open_time, ${a}close_time, ${a}slot_interval_minutes, ${a}max_concurrent_bookings,
  ${a}note, ${a}created_by, ${a}created_at, ${a}updated_at
`;
class ScheduleRepository {
  async findOperatingHoursForDay(dayOfWeek, client = db) {
    const queryText = `
      SELECT * FROM clinic_operating_hours WHERE day_of_week = $1
    `;
    const result = await client.query(queryText, [dayOfWeek]);
    return result.rows[0];
  }

  /** Every weekday row, Sunday first — the pattern the admin screen edits. */
  async findAllOperatingHours(client = db) {
    const result = await client.query(
      'SELECT * FROM clinic_operating_hours ORDER BY day_of_week'
    );
    return result.rows;
  }

  async updateOperatingHours(dayOfWeek, fields, client = db) {
    const result = await client.query(
      `UPDATE clinic_operating_hours
          SET is_open = $2,
              open_time = $3,
              close_time = $4,
              slot_interval_minutes = $5,
              max_concurrent_bookings = $6
        WHERE day_of_week = $1
        RETURNING *`,
      [
        dayOfWeek, fields.isOpen, fields.openTime, fields.closeTime,
        fields.slotIntervalMinutes, fields.maxConcurrentBookings,
      ]
    );
    return result.rows[0];
  }

  /** The override for one date, if the clinic has said anything special about it. [1.57.0] */
  async findOverrideForDate(date, client = db) {
    const result = await client.query(
      `SELECT ${overrideColumns()} FROM clinic_schedule_overrides WHERE override_date = $1`,
      [date]
    );
    return result.rows[0];
  }

  /** Overrides from a date onwards — the admin list, which looks forward rather than back. */
  async findOverridesFrom(fromDate, limit = 60, client = db) {
    const result = await client.query(
      `SELECT ${overrideColumns('o.')},
                u.first_name AS created_by_first_name, u.last_name AS created_by_last_name
         FROM clinic_schedule_overrides o
         LEFT JOIN users u ON u.id = o.created_by
        WHERE o.override_date >= COALESCE($1::date, CURRENT_DATE)
        ORDER BY o.override_date
        LIMIT $2`,
      [fromDate, limit]
    );
    return result.rows;
  }

  /**
   * Create or replace the override for a date.
   *
   * ON CONFLICT rather than a read-then-write: two admins editing the same holiday would
   * otherwise race, and the loser's edit would vanish with no error. The date is UNIQUE, so the
   * conflict target is the natural key.
   */
  async upsertOverride(fields, client = db) {
    const result = await client.query(
      `INSERT INTO clinic_schedule_overrides
         (override_date, is_open, open_time, close_time, slot_interval_minutes,
          max_concurrent_bookings, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (override_date) DO UPDATE SET
         is_open = EXCLUDED.is_open,
         open_time = EXCLUDED.open_time,
         close_time = EXCLUDED.close_time,
         slot_interval_minutes = EXCLUDED.slot_interval_minutes,
         max_concurrent_bookings = EXCLUDED.max_concurrent_bookings,
         note = EXCLUDED.note,
         created_by = EXCLUDED.created_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING ${overrideColumns()}`,
      [
        fields.date, fields.isOpen, fields.openTime, fields.closeTime,
        fields.slotIntervalMinutes, fields.maxConcurrentBookings, fields.note, fields.createdBy,
      ]
    );
    return result.rows[0];
  }

  async deleteOverride(date, client = db) {
    const result = await client.query(
      `DELETE FROM clinic_schedule_overrides WHERE override_date = $1 RETURNING ${overrideColumns()}`,
      [date]
    );
    return result.rows[0];
  }

  /** Bookings already taken on a date that an override is about to restrict. [1.57.0] */
  async countBookingsOnDate(date, client = db) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM appointments
        WHERE scheduled_date = $1 AND ${OCCUPIES_SLOT()}`,
      [date]
    );
    return result.rows[0].cnt;
  }

  async countBookingsByTimeForDate(date, client = db) {
    const queryText = `
      SELECT scheduled_time, COUNT(*)::int AS cnt
      FROM appointments
      WHERE scheduled_date = $1 AND ${OCCUPIES_SLOT()}
      GROUP BY scheduled_time
    `;
    const result = await client.query(queryText, [date]);
    return result.rows;
  }
}

module.exports = new ScheduleRepository();
