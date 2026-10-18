/**
 * Runs the end-of-day close now. [1.130.0]
 *
 * The server runs it by itself every half hour (jobs/dayCloseScheduler.js), so nothing needs
 * scheduling; this is for running it by hand, and for the suite. It closes what an earlier day left
 * open with nothing able to move it: unpaid walk-ins, and unpaid bookings nobody came for (marked
 * a no-show). Each is audited. See services/dayCloseService.js.
 *
 *   node src/scripts/closeEarlierDays.js
 */
require('dotenv').config();
const db = require('../config/database');
const dayCloseService = require('../services/dayCloseService');

dayCloseService.closeEarlierDays()
  .then(async (result) => {
    console.log(JSON.stringify(result));
    await db.pool.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error(`End-of-day close failed: ${err.message}`);
    process.exit(1);
  });
