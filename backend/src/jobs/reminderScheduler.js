const env = require('../config/environment');
const logger = require('../config/logger');
const reminderService = require('../services/reminderService');

/** How often the server looks for reminders that are due. */
const TICK_MS = 60 * 1000;

/**
 * Sends appointment reminders from inside the server. [1.130.0]
 *
 * A minute is fine enough for the shortest case (a reminder planned 30 minutes before an
 * appointment) and costs one small query. A sweep never overlaps the previous one, and never
 * throws: server.js shuts the process down on an unhandled rejection, and a mail problem must not
 * take the clinic's server with it. Off with APPOINTMENT_REMINDERS=off.
 */
let timer = null;
let starter = null;
let running = false;
let warnedNotConfigured = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const counts = await reminderService.sweep(new Date());
    if (counts.notConfigured) {
      if (!warnedNotConfigured) {
        logger.warn(`Appointment reminders are waiting for outbound mail (${counts.notConfigured.join(', ')}).`);
        warnedNotConfigured = true;
      }
      return;
    }
    warnedNotConfigured = false;
    if (counts.sent || counts.noAddress || counts.missed || counts.failed) {
      logger.info(
        `Appointment reminders: ${counts.sent} sent, ${counts.noAddress} with no address, ` +
        `${counts.missed} too late to send, ${counts.failed} failed.`
      );
    }
  } catch (err) {
    logger.error(`Appointment reminder sweep failed: ${err.message}`);
  } finally {
    running = false;
  }
}

function start() {
  if (!env.APPOINTMENT_REMINDERS) {
    logger.info('Appointment reminders are off (APPOINTMENT_REMINDERS=off).');
    return;
  }
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  // The first sweep shortly after boot rather than a minute later: a reminder that fell due while
  // the server was off goes out as soon as it can.
  starter = setTimeout(tick, 15 * 1000);
  starter.unref();
  logger.info('Appointment reminders: automatic, the evening before (or halfway, for a late booking).');
}

function stop() {
  clearInterval(timer);
  clearTimeout(starter);
  timer = null;
}

module.exports = { start, stop, tick };
