const appointmentEmailService = require('./appointmentEmailService');
const scheduleRepository = require('../repositories/scheduleRepository');
const auditService = require('./auditService');

/**
 * The clinic's own diary: which days it opens, for how long, and how many patients a slot holds.
 * [1.57.0]
 *
 * `clinic_operating_hours` has existed since [1.0.0] and booking has always read it — but nothing
 * could WRITE it. There was no route and no screen, so the clinic's hours, its slot interval and
 * its per-slot capacity could only be changed by someone with a database client. A clinic that
 * cannot say when it is open is a clinic whose booking screen is guessing.
 *
 * Two layers, and the split is the design:
 *
 *   the WEEKLY PATTERN     one row per weekday. What the clinic does most weeks.
 *   per-DATE OVERRIDES     what it does on one specific day instead. Every field nullable, NULL
 *                          meaning "keep the weekday's answer", so a closure is one row saying
 *                          is_open=false and a halved capacity does not restate the hours.
 *
 * Editing the pattern to handle one Thursday would change every Thursday, forever — which is the
 * mistake overrides exist to make unnecessary.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const bad = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
};

/** A real calendar date, YYYY-MM-DD. [1.124.0] 2026-02-30 used to reach the database. */
const isRealDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** HH:MM or HH:MM:SS, and open must precede close. Both or neither. */
function normaliseTimes(openTime, closeTime, { required }) {
  const has = (v) => v !== undefined && v !== null && v !== '';
  if (!has(openTime) && !has(closeTime)) {
    if (required) bad('Give an opening and a closing time.');
    return { openTime: null, closeTime: null };
  }
  if (!has(openTime) || !has(closeTime)) {
    // Half a range is not a schedule. The slot builder would read the missing half from the
    // weekday and produce a window nobody chose.
    bad('Give both an opening and a closing time, or neither.');
  }
  const shape = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
  if (!shape.test(openTime) || !shape.test(closeTime)) bad('Times must look like 08:00.');
  if (closeTime <= openTime) bad('The closing time must be after the opening time.');
  return { openTime, closeTime };
}

function normaliseInterval(value, { required }) {
  if (value === undefined || value === null || value === '') {
    if (required) bad('Give a slot length in minutes.');
    return null;
  }
  const n = parseInt(value, 10);
  // 5 minutes is shorter than any diagnostic exam; 240 is longer than a working morning. Outside
  // that band the number is a typo rather than a decision.
  if (!Number.isFinite(n) || n < 5 || n > 240) bad('A slot must be between 5 and 240 minutes.');
  return n;
}

function normaliseCapacity(value, { required }) {
  if (value === undefined || value === null || value === '') {
    if (required) bad('Give how many bookings a slot may hold.');
    return null;
  }
  const n = parseInt(value, 10);
  // Zero is meaningful and deliberate: "open, but taking no online bookings today". It is why
  // every read of this value uses ?? rather than ||.
  if (!Number.isFinite(n) || n < 0 || n > 50) bad('A slot may hold between 0 and 50 bookings.');
  return n;
}

class ScheduleService {
  /** The whole week, as the admin screen edits it. */
  async getWeek() {
    const hours = await scheduleRepository.findAllOperatingHours();
    return hours.map((h) => ({ ...h, day_name: DAY_NAMES[h.day_of_week] }));
  }

  async updateDay(dayOfWeek, payload, actor) {
    const day = parseInt(dayOfWeek, 10);
    if (!Number.isInteger(day) || day < 0 || day > 6) bad('Day must be 0 (Sunday) to 6 (Saturday).');

    const isOpen = payload.isOpen !== false;

    // A closed day needs no hours, and demanding them would make "we are shut on Sunday" a form
    // somebody has to fill in before it will accept the one fact that matters.
    const { openTime, closeTime } = normaliseTimes(payload.openTime, payload.closeTime, { required: isOpen });
    const slotIntervalMinutes = normaliseInterval(payload.slotIntervalMinutes, { required: isOpen });
    const maxConcurrentBookings = normaliseCapacity(payload.maxConcurrentBookings, { required: isOpen });

    const before = await scheduleRepository.findOperatingHoursForDay(day);
    if (!before) {
      const error = new Error('No operating-hours row for that day.');
      error.statusCode = 404;
      throw error;
    }

    const updated = await scheduleRepository.updateOperatingHours(day, {
      isOpen,
      openTime: isOpen ? openTime : null,
      closeTime: isOpen ? closeTime : null,
      slotIntervalMinutes: isOpen ? slotIntervalMinutes : before.slot_interval_minutes,
      maxConcurrentBookings: isOpen ? maxConcurrentBookings : before.max_concurrent_bookings,
    });

    await auditService.log({
      actorId: actor?.userId,
      action: 'schedule.week_updated',
      entityType: 'clinic_operating_hours',
      entityId: day,
      description: isOpen
        ? `${DAY_NAMES[day]}: open ${openTime}–${closeTime}, ${slotIntervalMinutes}-minute slots, ${maxConcurrentBookings} per slot`
        : `${DAY_NAMES[day]}: closed`,
    });

    return { ...updated, day_name: DAY_NAMES[day] };
  }

  /**
   * What a PATIENT is allowed to know: which days the clinic opens, and which upcoming dates are
   * different. Public and unauthenticated, the same as the services catalogue — a clinic's opening
   * hours are on its front door.
   *
   * It exists because the booking calendar has to mark a closed date BEFORE the patient picks it.
   * Telling them only once they have chosen the 30th means they choose the 30th, read "we are
   * closed", and go looking for another date with no idea which ones are worth trying.
   *
   * Capacity is deliberately not in this payload. How many patients an hour the clinic can take is
   * an operational figure; what the patient needs is whether a slot is free, which the availability
   * grid already answers slot by slot.
   */
  async getPublicSchedule() {
    const [hours, overrides] = await Promise.all([
      scheduleRepository.findAllOperatingHours(),
      scheduleRepository.findOverridesFrom(null, 120),
    ]);
    return {
      week: hours.map((h) => ({
        dayOfWeek: h.day_of_week,
        dayName: DAY_NAMES[h.day_of_week],
        isOpen: h.is_open,
        openTime: h.open_time,
        closeTime: h.close_time,
      })),
      // Only dates that CHANGE something a patient can act on. An override that merely retunes
      // capacity is invisible here on purpose: it does not change whether they may book, only
      // how many slots come back, and the grid already shows that.
      upcoming: overrides
        .filter((o) => !o.is_open || o.note || o.open_time)
        .map((o) => ({
          date: o.override_date,
          isOpen: o.is_open,
          note: o.note,
          openTime: o.open_time,
          closeTime: o.close_time,
        })),
    };
  }

  async listOverrides(from) {
    // A null start means CURRENT_DATE, decided by Postgres. Computing "today" in JavaScript here
    // would give the UTC date, which is yesterday in PHT for the first eight hours of every day.
    const start = isRealDate(String(from || '')) ? from : null;
    return await scheduleRepository.findOverridesFrom(start);
  }

  /**
   * Set what happens on one date.
   *
   * Warns rather than refuses when bookings already exist. The clinic genuinely does need to close
   * a day it has taken bookings for — a radiographer falls ill — and refusing would leave them
   * with no way to say so in the system at all. What it must never do is close the day SILENTLY,
   * so the count of affected bookings comes back with the result and the screen says it.
   */
  async setOverride(payload, actor) {
    const date = (typeof payload.date === 'string' ? payload.date : '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad('Give a date as YYYY-MM-DD.');
    // [1.124.0] A real date, from today on. A probe saved an override for a day already past,
    // which changes nothing anyone can act on and reads on the schedule as if it had.
    if (!isRealDate(date)) bad('That is not a real date.');
    if (date < localToday()) bad('That date has already passed. Choose today or a later date.');

    const isOpen = payload.isOpen !== false;
    const { openTime, closeTime } = normaliseTimes(payload.openTime, payload.closeTime, { required: false });

    const override = await scheduleRepository.upsertOverride({
      date,
      isOpen,
      openTime: isOpen ? openTime : null,
      closeTime: isOpen ? closeTime : null,
      slotIntervalMinutes: normaliseInterval(payload.slotIntervalMinutes, { required: false }),
      maxConcurrentBookings: normaliseCapacity(payload.maxConcurrentBookings, { required: false }),
      note: (payload.note || '').trim() || null,
      createdBy: actor?.userId ?? null,
    });

    // Who this leaves without a slot: everyone booked on a closed day, or booked outside the new
    // hours on an open one. [1.123.0] Named, so they can be moved, and each is emailed, so nobody
    // turns up to a closed clinic. It used to be a count and nothing more.
    // An open day with its hours unchanged (only capacity or the slot length) leaves nobody out.
    const bookings = !isOpen
      ? await scheduleRepository.findBookingsOnDate(date)
      : openTime && closeTime
        ? await scheduleRepository.findBookingsOnDate(date, { openTime, closeTime })
        : [];
    const affected = bookings.length;
    for (const b of bookings) {
      appointmentEmailService.sendScheduleChangeNotice({
        to: b.email,
        patientName: `${b.first_name} ${b.last_name}`,
        reference: b.appointment_reference,
        date: b.scheduled_date,
        time: b.scheduled_time,
        closed: !isOpen,
      }).catch(() => {});
    }

    await auditService.log({
      actorId: actor?.userId,
      action: 'schedule.override_set',
      entityType: 'clinic_schedule_overrides',
      entityId: override.id,
      description: `${date}: ${isOpen ? 'open' : 'CLOSED'}${override.note ? ` — ${override.note}` : ''}${affected ? ` (${affected} booking(s) already on this date)` : ''}`,
    });

    return { override, affectedBookings: affected, bookings };
  }

  /** The bookings a date's override leaves without a slot, for moving them one by one. [1.123.0] */
  async listAffectedBookings(date) {
    if (!isRealDate(String(date || ''))) bad('Give a real date as YYYY-MM-DD.');
    const override = await scheduleRepository.findOverrideForDate(date);
    if (!override) return [];
    if (!override.is_open) return scheduleRepository.findBookingsOnDate(date);
    if (!override.open_time || !override.close_time) return [];
    return scheduleRepository.findBookingsOnDate(date, { openTime: override.open_time, closeTime: override.close_time });
  }

  async removeOverride(date, actor) {
    if (!isRealDate(String(date || ''))) bad('That is not a real date.');
    const removed = await scheduleRepository.deleteOverride(date);
    if (!removed) {
      const error = new Error('There is no override for that date.');
      error.statusCode = 404;
      throw error;
    }

    await auditService.log({
      actorId: actor?.userId,
      action: 'schedule.override_removed',
      entityType: 'clinic_schedule_overrides',
      entityId: removed.id,
      description: `${date} follows the normal weekly schedule again`,
    });

    return removed;
  }
}

module.exports = new ScheduleService();
