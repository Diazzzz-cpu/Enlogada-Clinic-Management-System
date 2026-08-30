const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/environment');
const logger = require('./config/logger');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// 0. Baseline security response headers.
//
// This API serves patient-identifying records, so the defaults matter: nosniff, frameguard
// (an attacker's page cannot iframe an authenticated response), HSTS, and a referrer policy
// that stops URLs leaking to third parties. contentSecurityPolicy is off because this process
// only ever returns JSON and file downloads — the CSP that matters belongs to the Vite app,
// and a policy declared here would be both inert and misleading.
app.use(helmet({ contentSecurityPolicy: false }));

// 1. Cross-Origin Resource Sharing (CORS)
//
// Restricted to the configured frontend origin instead of the previous bare cors(), which
// reflected ANY origin. Because the browser sends the bearer token from JS rather than a
// cookie, a wide-open policy let any page a signed-in staff member visited call this API with
// their token and read the response. Extra origins can be listed in CORS_ORIGINS (comma
// separated) for staging or LAN testing.
const allowedOrigins = new Set(
  [env.FRONTEND_URL, ...(process.env.CORS_ORIGINS || '').split(',')]
    .map((o) => o.trim())
    .filter(Boolean)
);
app.use(cors({
  origin: (origin, cb) => {
    // No Origin header: same-origin, curl, health checks, and the PayMongo webhook. These are
    // not browser cross-origin requests, so CORS is not the control that applies to them.
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
    // Withhold the header rather than raising: an error here surfaces as a 500, which reads as
    // a server fault and tells the caller more than it should. Omitting the header is what
    // actually stops the browser handing the response to the calling page.
    return cb(null, false);
  },
  credentials: true,

  // ETag has to be readable by the frontend, and If-None-Match has to be allowed on the way in.
  // [1.26.0]
  //
  // CORS exposes only a handful of response headers to JavaScript by default, and ETag is not
  // among them. Express was already emitting one on every JSON response and already answering a
  // matching If-None-Match with a 0-byte 304 — verified with a raw request — but the browser
  // could not read the validator, so nothing ever sent one back and every poll re-downloaded a
  // body the client already had. Two lines of configuration were the whole gap between that and
  // ~500,000 requests a month carrying mostly unchanged bytes.
  //
  // No extra preflight cost: every request already carries Authorization, which is itself a
  // non-simple header, so these endpoints were being preflighted regardless. maxAge lets the
  // browser reuse that preflight rather than repeating it before each poll.
  // Content-Disposition joins it in [1.62.0] for the report CSV exports. The browser fetches
  // those with XHR as a blob and has to read the server's filename off this header; without it
  // being exposed, every export saves as the endpoint name with no extension and the clinic
  // cannot tell one month's file from another.
  exposedHeaders: ['ETag', 'Content-Disposition'],
  allowedHeaders: ['Content-Type', 'Authorization', 'If-None-Match'],
  maxAge: 600
}));

// 2. Parse Incoming JSON and URL-encoded requests
//
// The `verify` hook stashes the raw request bytes on req.rawBody. The PayMongo payment webhook
// signs the exact bytes it sent, so verifying against a re-serialised req.body would fail on
// every legitimate delivery (key order and whitespace are not preserved by a parse/stringify
// round trip). Capturing here — rather than mounting the webhook route ahead of this parser —
// keeps route ordering, CORS, logging and rate limiting identical for every endpoint.
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// 3. HTTP Request Logging (using Morgan redirected to Winston logger)
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// 4. Rate Limiting Middleware
// Production stays deliberately tight at 100/15min. The dev ceiling exists only so the
// frontend/tests/e2e Playwright suite can run: that suite is now ~190 tests, most of which
// perform several authenticated API calls, and it comfortably exceeded the previous 1000 —
// exhausting the window mid-run and failing ~25 specs with a misleading
// "Cannot read properties of undefined (reading 'token')" rather than an obvious 429.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 20000,
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// A second, much tighter bucket for the credential endpoints.
//
// The limiter above is one shared allowance across all 84 routes, so in production a single
// attacker gets 100 login attempts per window *and* consumes the clinic's own budget doing it —
// and in every other environment 20,000, which is no limit at all for password guessing. There is
// also no failed-login counter or account lockout anywhere in the schema, so nothing else slows
// credential stuffing down.
//
// skipSuccessfulRequests is the important flag: it means normal staff signing in all morning
// never touch this, while an attacker guessing wrong accumulates against it immediately. Keyed by
// IP, which a distributed attack still evades — this raises the cost, it does not remove the need
// for lockout, which needs a schema change and is tracked separately.
//
// Left generous outside production for the same reason as the limiter above: the Playwright suite
// signs in repeatedly, and tripping this mid-run produces scattered failures that look like
// anything but a rate limit.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 2000,
  skipSuccessfulRequests: true,
  message: {
    status: 'error',
    message: 'Too many failed attempts. Please wait 15 minutes before trying again.'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

// 5. Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Enlogada Clinic Backend API is healthy and running.',
    timestamp: new Date().toISOString()
  });
});

// 6. Mount feature routes
const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const visitRoutes = require('./routes/visitRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const testRoutes = require('./routes/testRoutes');
const packageRoutes = require('./routes/packageRoutes');
const paymentMethodRoutes = require('./routes/paymentMethodRoutes');
const paymentSubmissionRoutes = require('./routes/paymentSubmissionRoutes');
const resultRoutes = require('./routes/resultRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const hmoRoutes = require('./routes/hmoRoutes');
const rbacRoutes = require('./routes/rbacRoutes');
const adminRoutes = require('./routes/adminRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const reportRoutes = require('./routes/reportRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const clinicRoutes = require('./routes/clinicRoutes');
const discountRoutes = require('./routes/discountRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/discounts', discountRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/payment-submissions', paymentSubmissionRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/hmo', hmoRoutes);
app.use('/api/rbac', rbacRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/clinic', clinicRoutes);

// 6. Global Catch-all Error Handling Middleware
app.use(errorHandler);

module.exports = app;
