const app = require('./app');
const env = require('./config/environment');
const logger = require('./config/logger');
const db = require('./config/database');

const { reportPendingRepairs, reportGatewayConfiguration, reportAccountMail } = require('./config/startupAdvisory');
const reminderScheduler = require('./jobs/reminderScheduler');

const server = app.listen(env.PORT, () => {
  logger.info(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
  // After listen, and deliberately not awaited: an advisory about historical data must never
  // delay the port opening or fail the boot. It reports and returns; it repairs nothing. [1.32.0]
  reportPendingRepairs();
  reportGatewayConfiguration();
  reportAccountMail();
  // [1.130.0] Appointment reminders, sent by the server itself.
  reminderScheduler.start();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection! Shutting down server...', err);
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception! Shutting down server...', err);
  process.exit(1);
});

// Handle system shutdown signals (graceful close)
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  reminderScheduler.stop();
  server.close(() => {
    db.pool.end();
    logger.info('Process terminated.');
  });
});
