const scheduleService = require('../services/scheduleService');

class ScheduleController {
  async getPublic(req, res, next) {
    try {
      const schedule = await scheduleService.getPublicSchedule();
      return res.status(200).json({ status: 'success', data: schedule });
    } catch (err) {
      next(err);
    }
  }

  async getWeek(req, res, next) {
    try {
      const week = await scheduleService.getWeek();
      return res.status(200).json({ status: 'success', data: { week } });
    } catch (err) {
      next(err);
    }
  }

  async updateDay(req, res, next) {
    try {
      const day = await scheduleService.updateDay(req.params.dayOfWeek, req.body, req.user);
      return res.status(200).json({
        status: 'success',
        message: day.is_open
          ? `${day.day_name} open ${String(day.open_time).slice(0, 5)}–${String(day.close_time).slice(0, 5)}.`
          : `${day.day_name} is now closed.`,
        data: { day },
      });
    } catch (err) {
      next(err);
    }
  }

  async listOverrides(req, res, next) {
    try {
      const overrides = await scheduleService.listOverrides(req.query.from);
      return res.status(200).json({ status: 'success', data: { overrides } });
    } catch (err) {
      next(err);
    }
  }

  async setOverride(req, res, next) {
    try {
      const { override, affectedBookings } = await scheduleService.setOverride(req.body, req.user);
      // The booking count is in the MESSAGE, not merely in the payload. Closing a day that already
      // holds appointments is a decision with people attached to it, and the person doing it has
      // to be told without going looking.
      // override_date is already a 'YYYY-MM-DD' string — formatted in SQL, never via
      // toISOString(), which reports the UTC date and so names the previous day in PHT.
      const base = override.is_open
        ? `${override.override_date} updated.`
        : `${override.override_date} is now closed.`;
      return res.status(200).json({
        status: 'success',
        message: affectedBookings
          ? `${base} ${affectedBookings} booking(s) already exist on this date — telephone those patients.`
          : base,
        data: { override, affectedBookings },
      });
    } catch (err) {
      next(err);
    }
  }

  async removeOverride(req, res, next) {
    try {
      await scheduleService.removeOverride(req.params.date, req.user);
      return res.status(200).json({
        status: 'success',
        message: 'That date follows the normal weekly schedule again.',
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ScheduleController();
