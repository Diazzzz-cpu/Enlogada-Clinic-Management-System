# E2E Smoke Tests

Initial automated QA baseline for the Enlogada Clinic Management System, using the `playwright` devDependency already in `frontend/package.json` (via its bundled `playwright/test` test-runner subpath — no extra package was added).

## What's covered

The suite was deliberately cut back to five specs (45 tests, ~9s) kept for demonstrations and
manual regression checking. It is a **demo and safety net, not exhaustive coverage** — the
~200-test suite that preceded it mirrored a module-by-module build-out that is now finished, and
most of it re-asserted UI copy that changes for good reasons. What survived is one spec per thing
that would be expensive to get wrong:

- `smoke.spec.js` — the app loads, the login page is reachable, required-field validation works.
  The cheapest possible "is anything alive".
- `api-authorization.spec.js` — the security boundaries, and the widest-reaching spec here.
  Ownership/IDOR (a client cannot read another client's records), role boundaries, the
  Admin-vs-SuperAdmin separation of duties (Admin reads department data but cannot capture a
  payment or author a clinical result), and combined-role access (a Receptionist+Cashier reaches
  both consoles). Mostly direct API calls, so it is fast and stable.
- `ticket-release-gating.spec.js` — the core business rule end to end: a ticket reaches a
  department only once payment is confirmed, plus check-in for online appointments. This is the
  flow to demo.
- `payment.spec.js` — the money path, including the gateway configuration surface.
- `laboratory.spec.js` — diagnostic result authoring and release, including the upload guard.

Between them these walk the whole clinical journey — register, book, pay, release, examine,
report — which is what makes them useful to demo as well as to run.

If you need coverage of something else, add a spec rather than reviving the old ones; they assert
UI copy that has since moved on. Deleted specs remain in git history if you want a starting point.

## Cleanup

The suite deletes what it creates. `globalSetup.js` stamps the run's start time; `globalTeardown.js`
then shells out to `backend/src/scripts/purgeE2eData.js`, which removes throwaway
`@enlogada-e2e.test` accounts along with every visit, payment, notification and audit row created
inside the window. Verified by row count: identical before and after a run.

This matters more than it sounds. Before it existed, each run left a client, patient, visit and
payment behind, and each staff-account spec left an account — the database reached 2,276 users and
3,034 visits, and `notification_reads` (one row per recipient per event, so events × staff) hit
255,540 rows. Demos became unusable and tests that page through a list to find their own record got
slower every run until they hit the 30s timeout.

- `E2E_SKIP_PURGE=1 npm test` keeps the data when you need to inspect a failure.
- Cleanup never fails the run. If it errors it logs the reason and leaves the data in place.
- Seed a demo dataset *before* running the suite and it survives — it falls outside the window.

## Prerequisites

Both servers must already be running, and the database must be seeded, before running the suite:

```bash
# 1. Database (from backend/, once):
node src/scripts/migrateDb.js
node src/scripts/setupRbac.js
node src/scripts/seedUsers.js

# 2. Backend (from backend/, keep running):
npm run dev

# 3. Frontend (from frontend/, keep running):
npm run dev
```

The suite assumes the frontend is reachable at `http://localhost:5173` and the backend at `http://localhost:5000` (both are this project's pinned defaults — see `frontend/vite.config.js` and `backend/.env`). Override with the `E2E_BASE_URL` / `E2E_API_URL` environment variables if your setup differs.

If Playwright's Chromium browser isn't installed yet: `npx playwright install chromium`.

## Running

From `frontend/`:

```bash
npm test          # headless run, all specs
npm run test:ui    # interactive UI mode
```

## Known limitations

- No CI wiring yet — this is a local/manual baseline only.
- Browser-level tests only cover the Client role end-to-end; Staff/Admin dashboards are exercised at the API-authorization level (`api-authorization.spec.js`) but not yet browser-driven.
- `frontend/src/config/api.js` hardcodes the backend base URL rather than reading an env var, so pointing this suite at a non-default backend also requires editing that file (see the audit's P2 findings) — `E2E_API_URL` only affects the `api-authorization.spec.js` requests, not the app under test.
