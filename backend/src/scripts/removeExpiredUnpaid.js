/**
 * Removes unpaid walk-ins and bookings whose time is up, now. [1.131.0]
 *
 * The server does this by itself every five minutes (jobs/unpaidExpiryScheduler.js); this runs it
 * by hand, and for the suite. Unpaid is temporary: a walk-in not paid by the end of its day, a
 * booking not paid by its day (or within its time to pay) is removed, with an Activity Log line.
 * Never anything paid, or waiting on an HMO decision or an online proof. See unpaidExpiryService.
 *
 *   node src/scripts/removeExpiredUnpaid.js
 */
require('dotenv').config();
const db = require('../config/database');
const unpaidExpiryService = require('../services/unpaidExpiryService');

unpaidExpiryService.removeExpired()
  .then(async (result) => {
    console.log(JSON.stringify(result));
    // Gives a released booking's email a moment to leave before the pool closes.
    await new Promise((r) => setTimeout(r, 1500));
    await db.pool.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error(`Removing expired unpaid visits failed: ${err.message}`);
    process.exit(1);
  });
