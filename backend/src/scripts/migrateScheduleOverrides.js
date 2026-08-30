/**
 * [1.57.0] Per-DATE schedule overrides: closures, changed hours, changed capacity.
 *
 * ── What existed, and what it could not say ─────────────────────────────────────────────────
 *
 * `clinic_operating_hours` holds one row per WEEKDAY — open/closed, the hours, the slot interval
 * and how many bookings a slot may hold. Booking reads it to build the grid, so capacity was
 * already enforced. Two things were missing, and both are about specific days rather than the
 * pattern:
 *
 *   the clinic cannot close for a DATE   Holy Week, a public holiday, a day the radiographer is
 *                                        away. The weekly pattern has no way to express "not this
 *                                        Thursday", so the booking grid offered slots the clinic
 *                                        could not honour and somebody had to telephone every
 *                                        patient who took one.
 *
 *   capacity cannot vary by DATE         a day with one sonographer instead of two takes half the
 *                                        ultrasound bookings. Changing the weekday row to say so
 *                                        would change every Thursday, forever.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────────────────────
 *
 * One row per overridden date, and every field except the date is NULLABLE. A NULL means "keep
 * whatever the weekday says", so closing a day is one row with is_open=false and nothing else,
 * and halving capacity for one Saturday does not restate its opening hours. Overriding by
 * omission is how this stays readable a year from now.
 *
 * `note` is shown to the PATIENT on the booking screen. A closed day with no reason reads as a
 * fault in the website; "Closed — Holy Week" reads as a clinic that is shut.
 *
 *   node src/scripts/migrateScheduleOverrides.js
 *   node src/scripts/migrateScheduleOverrides.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS clinic_schedule_overrides (
        id SERIAL PRIMARY KEY,
        override_date DATE NOT NULL UNIQUE,
        is_open BOOLEAN NOT NULL DEFAULT TRUE,
        open_time TIME,
        close_time TIME,
        slot_interval_minutes INT,
        max_concurrent_bookings INT,
        note VARCHAR(200),
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_schedule_override_creator FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT chk_schedule_override_interval CHECK (slot_interval_minutes IS NULL OR slot_interval_minutes BETWEEN 5 AND 240),
        CONSTRAINT chk_schedule_override_capacity CHECK (max_concurrent_bookings IS NULL OR max_concurrent_bookings >= 0),
        -- Both times or neither. Half a range is not a schedule, and the slot builder would read
        -- the missing half from the weekday and produce a window nobody chose.
        CONSTRAINT chk_schedule_override_times CHECK (
          (open_time IS NULL AND close_time IS NULL)
          OR (open_time IS NOT NULL AND close_time IS NOT NULL AND close_time > open_time)
        )
      )
    `);

    // The lookup is always "is there an override for THIS date", one row at a time, and the UNIQUE
    // on override_date already indexes it. This one serves the admin list, which reads forward
    // from today.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_schedule_overrides_date
        ON clinic_schedule_overrides (override_date DESC)
    `);
  });

  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM clinic_schedule_overrides');
  console.log(`\n  clinic_schedule_overrides ready — ${rows[0].n} row(s).`);
  console.log('  No override means the weekday pattern stands, which is every date today.\n');
}

async function rollback() {
  await db.query('DROP TABLE IF EXISTS clinic_schedule_overrides');
  console.log('\n  Dropped. Every date falls back to its weekday pattern again.\n');
}

(async () => {
  try {
    if (process.argv.includes('--rollback')) await rollback();
    else await apply();
  } catch (err) {
    console.error('\n  Failed:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
