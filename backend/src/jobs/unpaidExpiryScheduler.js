const env = require('../config/environment');
const logger = require('../config/logger');
const unpaidExpiryService = require('../services/unpaidExpiryService');

/** Often enough that a lapsed time to pay frees its booking within minutes. */
const TICK_MS = 5 * 60 * 1000;

/**
 * Removes unpaid walk-ins and bookings whose time is up, from inside the server. [1.131.0] See
 * unpaidExpiryService. Idempotent; never throws (server.js shuts down on an unhandled rejection).
 * Off with UNPAID_EXPIRY=off.
 */
let timer = null;
let starter = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await unpaidExpiryService.removeExpired();
    if (result.removed) {
      logger.info(`Unpaid and time up: removed ${result.walkIns} walk-in(s) and ${result.bookings} booking(s).`);
    }
  } catch (err) {
    logger.error(`Removing expired unpaid visits failed: ${err.message}`);
  } finally {
    running = false;
  }
}

function start() {
  if (!env.UNPAID_EXPIRY) {
    logger.info('Removing expired unpaid visits is off (UNPAID_EXPIRY=off).');
    return;
  }
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  starter = setTimeout(tick, 20 * 1000);
  starter.unref();
}

function stop() {
  clearInterval(timer);
  clearTimeout(starter);
  timer = null;
}

module.exports = { start, stop, tick };
