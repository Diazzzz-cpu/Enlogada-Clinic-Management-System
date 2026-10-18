const env = require('../config/environment');
const logger = require('../config/logger');
const dayCloseService = require('../services/dayCloseService');

/** Often enough to close yesterday soon after midnight, or soon after a server that was off starts. */
const TICK_MS = 30 * 60 * 1000;

/**
 * Closes what earlier days left open, from inside the server. [1.130.0] See dayCloseService.
 * Idempotent, so it simply runs every half hour; it finds work once a day. Never throws (server.js
 * shuts down on an unhandled rejection). Off with DAY_CLOSE=off.
 */
let timer = null;
let starter = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await dayCloseService.closeEarlierDays();
    if (result.visitsClosed || result.noShows) {
      logger.info(
        `End of day: closed ${result.unpaidWalkIns} unpaid walk-in(s), marked ${result.noShows} booking(s) a no-show, ` +
        `${result.visitsClosed} visit(s) closed in all.`
      );
    }
  } catch (err) {
    logger.error(`End-of-day close failed: ${err.message}`);
  } finally {
    running = false;
  }
}

function start() {
  if (!env.DAY_CLOSE) {
    logger.info('End-of-day close is off (DAY_CLOSE=off).');
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
