# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Enlogada Clinic Management System — an enterprise diagnostic healthcare platform for human diagnostic services only (**Ultrasound, Laboratory, Digital X-Ray**). Veterinary/pet functionality was fully removed; do not reintroduce it.

**2D Echo and ECG are not offered.** `[1.47.0]` The clinic confirmed this. Their tests are
deactivated and they are gone from all public copy — but the `test_categories` rows, the
`modality.js` mappings, the category colours and the portal's result filters all REMAIN, because 18
historical `visit_tests` point at them and a past visit has to keep being able to say what it was
for. Do not "finish the job" by deleting the categories.

Stack: React 19 (Vite, Tailwind CSS v4) frontend + Node.js/Express 5 backend + PostgreSQL.

## Commands

```bash
# Backend (port 5000)
cd backend
npm run dev              # nodemon, auto-restart
npm start                # plain node

# Frontend (port 5173)
cd frontend
npm run dev
npm run build
npm run lint              # oxlint
npm run preview

# Database setup (run from backend/)
node src/scripts/migrateDb.js     # (re)creates all tables from database/schema.sql — destructive, drops/recreates
node src/scripts/setupRbac.js     # seeds permissions/roles for RBAC
node src/scripts/seedUsers.js     # seeds one test user per role (password: Password123!)
node src/scripts/testRbacEndpoints.js  # manual RBAC endpoint smoke test
node src/scripts/verifyRbacWiring.js  # asserts every permission-gated route matches the seeded matrix

# RUN THIS ON ANY DATABASE THAT ALREADY APPLIED [1.30.0], however current it otherwise is:
#
#   node src/scripts/migrateRefundTimestamp.js
#
# [1.32.0] adds no schema. It replaces [1.30.0]'s backfill — which set refunded_at = paid_at, a
# fabricated date — with the real moment read from audit_log, and CORRECTS rows already carrying
# the guess. Until it runs, every pre-existing reversal claims it happened the instant the receipt
# was taken, so the cash-up files it on the wrong day. Safe and idempotent; it reports how many it
# corrected and how many it could not.
#
# Deliberately stated ABOVE the gate below rather than inside the list: that gate scopes itself to
# databases created before [1.29.0], so a database that is already newer than that — which is
# exactly the one this applies to — would correctly skip the whole block and miss this.

# Additive migrations for an EXISTING database (migrateDb.js is destructive and cannot be used on
# a live one). Each is safe to re-run; run them in order on any database created before [1.29.0].
node src/scripts/migrateIndexes.js           # [1.11.0] foreign-key and lookup indexes
node src/scripts/migrateResultAttribution.js # [1.12.0] recorded_by vs released_by
node src/scripts/migrateDataIntegrity.js     # [1.13.0] daily_counters + queue/receipt/payment uniqueness
node src/scripts/migrateDiscounts.js         # [1.14.0] Senior Citizen / PWD statutory discounts
node src/scripts/migrateResultVersioning.js  # [1.15.0] result amendment history + critical values
node src/scripts/migrateSessionRevocation.js # [1.16.0] password change ends older sessions
node src/scripts/migrateVatExemption.js      # [1.17.0] VAT-exempt senior/PWD discounts
node src/scripts/migrateQueryPerformance.js  # [1.18.0] indexes for date-ranged screens
node src/scripts/migrateLoginProtection.js   # [1.19.0] account lockout + PHI read auditing
node src/scripts/migrateAccountScopedRbac.js # [1.20.0] per-account permissions + department assignment
node src/scripts/migrateHmoCard.js           # [1.22.0] HMO card evidence columns (--rollback reverses it)
node src/scripts/migrateReferringPhysician.js # [1.23.0] referring physician on a visit (--rollback reverses it)
node src/scripts/migrateTestPreparation.js    # [1.24.0] patient preparation per test (--rollback reverses it)
node src/scripts/migrateAppointmentReminders.js # [1.25.0] day-before reminder tracking (--rollback reverses it)
node src/scripts/migrateHmoDecisionTrail.js    # [1.27.0] why an HMO refused a test, and who recorded it (--rollback reverses it)
node src/scripts/migrateHmoClaimDecision.js    # [1.28.0] turning a whole claim down, + member number (--rollback reverses it)
node src/scripts/migrateIndexHygiene.js       # [1.29.0] index the growing FKs, drop two redundant indexes (--rollback reverses it)
node src/scripts/migrateRefundTimestamp.js    # [1.30.0] a reversal gets its own date, so a closed day is never restated (--rollback reverses it)
node src/scripts/migrateClaimIntegrity.js     # [1.31.0] one live HMO claim per test; drops the dead test_results.file_url (--rollback reverses it)
# [1.32.0] has no script of its own — see the re-run note at the top of this block.
node src/scripts/migrateSlotHold.js            # [1.35.0] an unpaid online booking holds its slot instead of taking it forever (--rollback reverses it)
node src/scripts/migratePaymentMethods.js     # [1.33.0] narrow chk_payment_method to what the clinic settles; refuses if a row would violate it (--rollback reverses it)
node src/scripts/migrateTestPackages.js        # [1.45.0] the clinic's package deals (--rollback reverses it)
node src/scripts/migratePaymentSubmissions.js  # [1.48.0] clinic payment channels + manual proof of payment (--rollback reverses it)
node src/scripts/migrateResultFieldSets.js     # [1.50.0] structured result entry, Ultrasound only (--rollback REFUSES while measurements exist; add --force)

# Clear accumulated E2E/fixture traffic, keeping reference data and seeded accounts.
# Dry-run by default; --confirm actually deletes. Refuses to run under NODE_ENV=production.
node src/scripts/resetDemoData.js             # report only
node src/scripts/resetDemoData.js --confirm   # apply

# Seed a realistic clinic dataset: ~18 visits today at every workflow stage (awaiting payment,
# senior/PWD discounts, on each modality worklist, a CRITICAL result, an AMENDED report, HMO
# pre-auth) plus 14 days of backdated history so the reporting screens have something to plot.
# Needs both servers running. Every "today" screen filters on the current date, so re-run before
# a demo — data seeded yesterday leaves the queues legitimately empty.
node src/scripts/seedDemoScenario.js

# Retention passes. Schedule both in any long-lived environment — notifications daily, audit
# monthly. audit_log now records PHI reads, so it grows with staff activity rather than with
# sensitive writes only.
node src/scripts/pruneNotifications.js --dry-run
node src/scripts/pruneNotifications.js
node src/scripts/pruneAuditLog.js --dry-run
node src/scripts/pruneAuditLog.js            # PHI reads 2y, everything else 7y

# Day-before appointment reminders. Schedule DAILY, in the evening. Dry-run by default.
#
# The clinic has counted 'No Show' since [1.0.0] with no tool against it; this is the standard
# one. It also carries the preparation instructions, which is where they matter most — "nothing
# to eat after 10pm tonight" is actionable the evening before and forgotten at booking time.
#
# Safe to re-run: each appointment is stamped once handled, so a second run finds nothing. That
# is what makes it safe to schedule.
node src/scripts/sendAppointmentReminders.js              # report only
node src/scripts/sendAppointmentReminders.js --confirm    # actually send

# Retention pass for HMO card images (insurance documents, not medical records). Dry-run by
# default; --confirm applies. The window is a constant in the script, overridable per run.
node src/scripts/pruneHmoCards.js
node src/scripts/pruneHmoCards.js --days=180
node src/scripts/pruneHmoCards.js --confirm
```

**Before a demo:** `resetDemoData.js --confirm` then `seedDemoScenario.js`.

The suite now cleans up after itself — `playwright.config.js` wires a global setup/teardown that stamps the run start and then deletes everything the run created (throwaway `@enlogada-e2e.test` accounts, plus any visit, payment, notification or audit row created inside the window). Row counts are identical before and after a run, so a seeded demo dataset survives testing. Set `E2E_SKIP_PURGE=1` to keep the data when debugging a failure. Cleanup never fails the run; if it errors it says so and leaves the data behind.

The E2E suite creates a throwaway client, patient, visit and payment on every run and never cleans up, so the dev database drifts a long way from anything a clinic would recognise — left alone it reaches thousands of visits and a billing queue hundreds deep. That skews demos, makes paginated/aggregate screens behave unlike production, and slowly breaks tests that walk a list to find their own record.

The worst of it is `notification_reads`, which is a **fan-out** table: `notifyRoles` writes one row per recipient per event, so its size is events × staff, not events. Because the suite also created staff and elevated accounts that were never cleaned up (137 Cashiers, 89 Admins, 45 SuperAdmins had accumulated), both factors grew at once and the table reached 255,540 rows across 4,309 events in five days — average fan-out 60, peak 181, with 99.4% never read by anyone. After a reset the same fan-out is 3. Production will not see the runaway staff count, but it has no retention either: 20 staff × 200 events/day is ~1.5M rows a year, growing forever. Schedule `pruneNotifications.js` (default: read 30d, unread 90d) in any environment that runs longer than a demo.

There **is** an automated end-to-end suite: `frontend/tests/e2e/` holds 35 Playwright specs (211 tests, ~260s) run with `npm test` (or `npm run test:ui`) from `frontend/`. It assumes **both dev servers are already running** and hits the real database — see `frontend/tests/e2e/README.md`. There are no unit tests; the backend has no test script.

The suite is a deliberately small demo-and-regression net, not exhaustive coverage: smoke, security boundaries (`api-authorization.spec.js` — Admin-vs-SuperAdmin separation of duties, combined-role access, and the cross-role PHI boundaries), ticket-release gating, payments, laboratory results, statutory discounts (`discounts.spec.js`), result amendment history and critical values (`result-versioning.spec.js`), password-change session revocation (`session-revocation.spec.js`), account lockout and PHI read auditing (`login-protection.spec.js`), permission-matrix enforcement (`rbac-enforcement.spec.js`), department-scoped patient records (`department-scoping.spec.js`), the per-department operations report (`operations-report.spec.js`), atomic online booking with its HMO card evidence rule (`booking-atomicity.spec.js`), the two dialogs that feature added (`hmo-card-review.spec.js` — because a card that uploads correctly and then renders as a broken image on the approval screen is a working feature failing at its job), moving a booking rather than cancelling it (`appointment-reschedule.spec.js`, plus `reschedule-ui.spec.js` for the dialog), when a visit must name the doctor who requested the test (`referring-physician.spec.js`), correcting a patient record (`patient-edit.spec.js` / `patient-edit-ui.spec.js`), what the patient is told about their own booking (`booking-communication.spec.js`), that the ETag revalidation cache never hides a change (`revalidation.spec.js`), that each role can see what it needs on the screen where it acts (`workflow-context.spec.js`), registering a walk-in in one pass (`walkin-registration.spec.js`), the patient journey at phone width (`mobile-patient.spec.js`), what an HMO decision has to record before it counts as one (`hmo-decision-trail.spec.js` — a refusal that names no reason leaves the cashier explaining a charge nobody wrote down), the three-step claim workflow itself (`hmo-claim-handoff.spec.js` — reception raises it, an Admin decides it, and the cashier has to be TOLD), and that a failed request never renders as an empty one (`failure-states.spec.js` — six screens shipped without an error branch, so a 500 fell through to the empty state and the app stated "Today's Revenue ₱0.00" over a day that took ₱8,344), and that a reversed receipt is both still listed and not counted (`cashup-reversals.spec.js` — see the note under Architecture; the log and the money are two different questions, and this spec fails if either half is answered with the other), and that the reader's chosen text size scales the whole interface without inverting its own type ramp (`text-scale.spec.js` — a pixel-pinned font size looks perfect at the default and misbehaves only for the people who changed it), and that a patient can pay into the clinic's own account and only a cashier can turn that into money (`manual-payment.spec.js` — publishing an account number is SuperAdmin alone, and the amount a patient CLAIMS never becomes the amount they are charged), and that a package deal bills its own fixed price rather than the sum of its parts, with every component reaching its own department (`packages.spec.js` — a bundle that costs more than buying the parts separately is a surcharge wearing the word "package"), and that updating a service does not delete the fields the caller did not mention (`catalogue-partial-update.spec.js` — the status toggle used to wipe a test's patient preparation, which is the sentence the day-before reminder carries). It was cut down from ~200 tests once the module-by-module build-out finished; the rest asserted UI copy that legitimately keeps changing. Prefer adding a focused spec over reviving deleted ones from git history.

**A booking spec must claim its own slot.** `POST /appointments` returns the *existing* booking with 200 when the same patient re-submits the same date and time, so two tests that both take "the first available slot" silently share one visit — and `avail.slots.find(s => s.available)` will not stop them, because a dev database whose cap has been lifted (`cleanE2eData.js --apply --unlimited-slots`, which exists because 18 slots a day cannot absorb repeated runs) reports every slot as available however many bookings it holds. `booking-atomicity.spec.js` and `ticket-release-gating.spec.js` each keep a `claimed` set for this. Symptom when you get it wrong: a create test receives 200 instead of 201, or a test finds a visit some earlier test already checked in.

Run it before and after any non-trivial change and compare the pass/fail counts — the specs assert RBAC boundaries and some UI copy, so intentional changes to those will legitimately turn specs red and the spec must be updated alongside the code. A run takes ~25 seconds; it runs on a single worker because the specs share one database and seeded accounts (see the note in `playwright.config.js`).

Three notes learned the hard way. The dev rate limiter allows 20,000 requests per 15 minutes; running the suite many times back to back trips it, and the resulting 429s surface as scattered, unrelated-looking failures — restart the backend to reset the counter. (There is now a second, tighter limiter on the credential endpoints, but it only counts *failed* attempts and allows 2,000 outside production, so the suite does not touch it.) Editing a backend file mid-run has the same signature: nodemon restarts, in-flight requests are dropped, and several unrelated specs go red at once — re-run on a settled server before believing a failure. And navigation/role changes need `multirole@enlogada.com` (see `TEST_ACCOUNTS.md`) to exercise properly: a single-role account cannot reveal the class of bug where the sidebar offers a screen the router refuses to open.

**Manual proof of payment is the live channel; the gateway is not.** `[1.48.0]` The clinic takes
online payment WITHOUT a gateway: SuperAdmin publishes its own GCash/bank details and QR
(`payment_methods`), the patient pays and uploads a screenshot plus reference (`payment_submissions`),
and a cashier verifies it. Approval runs the **existing** `paymentService.processPayment`, so it
gets a real receipt number, the visit release and the cash-up entry — never a parallel money writer.
The claimed amount is evidence only: the payment is always the recomputed bill, which is why the
review queue shows `amount_due` beside `amount_claimed` (approving a ₱50 claim on a ₱1,450 visit
records ₱1,450 and the drawer is short with nothing on screen to say so). `payment_methods.kind` is
constrained to **Cash/GCash/Bank** because those are the cash-up buckets `payments` accepts; the
clinic's own naming goes in `label`. Publishing an account number is **SuperAdmin only and audited**
— it is where a patient's money is sent. Everything below about PayMongo still applies if the clinic
ever wants a real gateway; the two paths coexist.

**Turning on online payment (GCash) is configuration only — no code change.** [1.37.0] The whole
path is wired, mounted and unflagged; it is dormant purely because the secrets are blank. In order:

1. Open a PayMongo merchant account and get the `sk_live_…` key (test with `sk_test_…` first).
2. Make the backend publicly reachable over HTTPS — PayMongo has to be able to POST to it.
3. Set `FRONTEND_URL` to the real public URL. It is interpolated into the provider's return links,
   so a stale `localhost:5173` sends the paying patient back to their own machine.
4. Set `PAYMONGO_SECRET_KEY`.
5. **In PayMongo's dashboard, create a webhook** pointing at
   `POST https://<your-host>/api/payments/gateway/webhook`, subscribed to
   `checkout_session.payment.paid`. Nothing in this repo registers it, and nothing can — it is a
   human step in their dashboard.
6. Paste the signing secret it shows **once** into `PAYMONGO_WEBHOOK_SECRET`. This is a different
   value from step 4, and both are required.
7. Check `/v1` vs `/v2` in `PAYMONGO_API_BASE` against what the account's dashboard shows.
8. Restart the backend. No frontend rebuild — availability is fetched at runtime.

Half-configured fails safe and says so: `isConfigured()` requires both secrets, so with only one
the clinic keeps taking counter payments and the backend logs which half is missing. That check
exists because the alternative was charging a patient and recording nothing — the webhook verifies
against the *webhook* secret, so a missing one rejects every delivery 401 through PayMongo's whole
retry schedule while the money has already moved.

**Two things change the day it goes on.** Unpaid client self-pay bookings become provisional and
start releasing their slot after 15 minutes ([1.35.0] — HMO and staff bookings stay permanent), and
the client's booking cards begin offering GCash instead of "pay at the counter".

Env files: `backend/.env` and `frontend/.env`, based on the respective `.env.example`. Backend needs `DATABASE_URL`, `JWT_SECRET`, SMTP settings (for result-release emails), and Google OAuth credentials. Frontend needs `VITE_GOOGLE_CLIENT_ID` and `VITE_API_BASE_URL` (the latter is inlined at **build** time, so it must be set before `npm run build` — setting it on the server afterwards has no effect). The backend refuses to start if `JWT_SECRET` is blank, shorter than 32 characters, or a known example value; generate one with `openssl rand -hex 32`.

## Architecture

### Backend layering (strict separation — see `.agents/PROJECT_STRUCTURE.md`)

`routes/` → `controllers/` → `services/` → `repositories/` → PostgreSQL (via `src/config/database.js`).

- **Routes**: endpoint definitions only, no logic.
- **Controllers**: parse/validate request, call one service, shape the response. No business logic.
- **Services**: all business logic lives here.
- **Repositories**: all SQL lives here — never write raw queries in controllers or services.

This layering is enforced convention in this codebase (checked by the "Project Architect" role described in `.agents/AGENTS.md`); keep new features consistent with it rather than mixing concerns into controllers.

### Auth & RBAC

- JWT-based auth (`backend/src/middlewares/auth.js`): `verifyToken` decodes the bearer token into `req.user` (contains `roles` and `permissions` arrays baked in at login).
- `authorizeRoles(...roles)` middleware gates routes by role name (e.g. `'Admin'`, `'Receptionist'`).
- `authorizePermissions(...perms)` gates by fine-grained permission strings (e.g. `billing:process`) and is **enforced on 53 routes**. **SuperAdmin bypasses; Admin does not** — that single difference is what separates the two roles.
- **`authorizeStaff` replaced the hardcoded role lists on 45 routes [1.20.0].** It asks only "is this a member of staff"; the permission decides the rest. Before this, `POST /payments` named `('SuperAdmin', 'Cashier')` and every result route named the three modality roles, so granting a cashier permission to Laboratory Staff saved, reported success and changed nothing — the matrix could not actually delegate, which is worse than having no matrix. Routes whose role list includes `Client` keep it: that is the one boundary a tick must never cross. Those routes pair the list with a permission anyway, and `verifyRbacWiring.js` then insists every named role holds it — which is why the Client role grants `hmo:request` and `hmo:read` (both ownership-scoped in `hmoService`) rather than the card and claim routes going ungated.
- **"Is this staff?" has exactly one definition: `isStaffUser` in `src/constants/roles.js`** — holds any role that is not `Client`. `authorizeStaff` uses it, and so do the two places that need the same question answered as a *business* rule (whether an HMO claim needs a card photo, in `hmoService.resolveCardEvidence` and `appointmentController.create`). A local `['SuperAdmin','Admin','Receptionist','Cashier']` list is the wrong shape twice over: it has to be found and edited whenever a role is added, and it disagrees with the matrix the moment a permission like `hmo:request` is delegated to a role the list does not mention.
- **Three axes, resolved server-side in `userRepository` so no caller can disagree with another:**
  - `roles` — staff or patient. Structural, not editable from any screen.
  - `permissions` — the role template **plus** that account's own grants, **minus** its revokes (`user_permissions`). Revoke is applied last as a set difference, so a conflict resolves to *less* access.
  - `departments` — the modalities implied by the account's roles **plus** `user_departments`. `null` means unrestricted (Admin/SuperAdmin) and is deliberately distinct from `[]`, "none"; collapsing the two is how an access check ends up inverted. Enforced in the service layer — see `resultService.assertStaffAllowedCategory`.
- Per-account exceptions are edited on **Access Control** (SuperAdmin → By Person) and are **audited**. Role edits are not: a role change is visible in the matrix everyone reads, while an exception applies to one person and is easy to forget.
- **`verifyRbacWiring.js` reads a route across lines, and must keep doing so.** `[1.48.0]` It used
  to read one LINE at a time, so a multi-line `router.post(...)` was never examined — a route gated
  on a permission that did not exist was reported as "All good", which is the one thing that script
  exists to prevent. Joined on balanced parentheses now.
- **Adding a permission to a route, or a nav item?** Run `node src/scripts/verifyRbacWiring.js`. Four checks: the permission exists; at least one staff role holds it (otherwise only SuperAdmin can reach the route); for routes that keep an explicit role list, every named role holds it; and every `permission:` in `frontend/src/config/navigation.js` is one the API actually enforces. That last check is what now guarantees the sidebar and the API agree — they used to agree by sharing a hardcoded role list, and no longer do.
- Navigation gates on the same three axes (`canSee` in `frontend/src/config/navigation.js`: `staffOnly`, `permission`, `department`), so the sidebar cannot advertise a screen the API will refuse. `AuthContext` re-reads `/auth/me` every 60s and on tab focus, so a change reaches a signed-in user without a re-login.
- Roles/permissions are DB-driven (`roles`, `permissions`, `user_roles`, `user_permissions`, `user_departments`), seeded via `setupRbac.js`.
- Google OAuth: `POST /api/auth/google` verifies an ID token via `google-auth-library`, then logs in or auto-creates a Client user.
- Frontend session handling: `frontend/src/config/api.js` (Axios) fires a global `auth:unauthorized` window event on HTTP 401; `AuthContext.jsx` listens for it to clear user state without breaking SPA navigation — follow this pattern rather than throwing/catching 401s locally in components.

### Where a file goes

`pages/` and `components/` are grouped **by feature, not by file type** — "package by feature",
what React's own docs call grouping by feature or route. The test is that the folder names say
what the clinic does, not what React is:

```
pages/public/     Home, Services, About, Privacy, Terms      — no account needed
pages/auth/       sign in, forgot password, reset
pages/portal/     ClientDashboard, ClientProfile             — the patient's own screens
pages/clinic/     Receptionist / Cashier / Diagnostic        — the three operational consoles
pages/admin/      oversight, reports, RBAC, the catalogue
pages/StaffAccountSettings.jsx                               — any staff, belongs to no console
components/       ui, booking, patients, reception, reports, charts, auth
```

**Grouped by feature, deliberately not by role.** Role looks like the obvious axis and does not
survive contact with this app: `DiagnosticDashboard` is one file serving Laboratory, Xray *and*
Ultrasound; `pages/admin/` serves Admin *and* SuperAdmin (`ADMINS` in `navigation.js`), with only
`SuperAdminManagement` restricted further; and `multirole@enlogada.com` holds two roles at once.
A role-shaped tree would have to file one dashboard in three places, and would then disagree with
the permission matrix the moment a permission is delegated — which is the same mistake as the
hardcoded role lists that [1.20.0] removed from 45 routes.

Who may open a screen is decided by `config/navigation.js` and the API's permission checks, never
by which folder the file sits in.

### Frontend routing model

There is no router library — `frontend/src/App.jsx` does manual, role-based conditional rendering based on `user.roles` from `AuthContext` plus local `currentTab`/`activeNav` state. When adding a new page/dashboard, wire it into the role-branching logic in `App.jsx` rather than introducing a routing library.

Role → primary console mapping:
- SuperAdmin/Admin → `AdminDashboard` (plus `ServicesCatalog` for the services-catalog nav item)
- Receptionist → `ReceptionistDashboard`
- Cashier → `CashierDashboard`
- Laboratory/Xray/Ultrasound Staff → shared `DiagnosticDashboard`, filtered by category
- Client → `ClientDashboard`

Public (unauthenticated) pages: `Home`, `ServicesPage` (dynamically fetches active tests from `GET /api/tests`, so admin price/service edits appear live), `Login`, `Register`.

### Database

Schema lives in `database/schema.sql` (source of truth, applied wholesale by `migrateDb.js`); human-readable change log in `database/migrations.md`.

**Transactions:** `db.withTransaction(fn)` in `src/config/database.js` makes every query issued underneath it — at any call depth, through any repository — run on one connection and commit as a unit. It uses `AsyncLocalStorage`, so repositories need no `client` argument and cannot accidentally write outside the transaction. Nested calls join the transaction already in progress. **Never call `db.pool.connect()` directly**: a self-managed client inside a `withTransaction` opens a second, independent transaction that commits on its own, and with a bounded pool it deadlocks once every connection is held by a transaction waiting for another connection. Any service method performing 2+ writes that must succeed together belongs in `withTransaction`; keep bcrypt hashing and outbound email/HTTP *outside* it so a pooled connection is not held during slow work. No code under `src/services` or `src/repositories` manages its own client any more — the only `pool.connect()` calls left are inside `withTransaction` itself and in one-shot migration scripts, which run alone.

**`createAppointment` is the shape to copy for "commit, then do the after-work".** It writes the visit, the appointment, the tests and any HMO claim in one `withTransaction`, and everything that must only happen *after* a successful commit — the staff notification, discarding an unused card upload — sits after the `try`, not inside it. The version this replaced tracked a `committed` boolean so its own `catch` would know whether the COMMIT had already run; a post-commit throw would otherwise have issued ROLLBACK on a committed transaction and reported a real booking as failed. Structuring it this way removes the flag rather than maintaining it.

**An uploaded file is never named from what the client sent, and never served statically.** All three upload paths (`src/config/upload.js`) build the stored filename from random hex plus an extension mapped from the *validated* mime type, and re-check containment with `assertInside`. The extension used to come from `file.originalname`, which combined with a `%2F`-encoded route param let a request choose both the directory and the suffix — and multer writes before the controller's authorization check runs, so the 403 arrives after the file is on disk. Result files, avatars and HMO cards are all streamed back through an authenticated, ownership-checked route: an HMO card carries a member number, a name and often a photo.

**An omitted field is not an instruction to erase.** `testRepository.updateTest` writes every
column unconditionally, so a caller sending only the fields it cares about destroys the rest —
the Services Catalogue's status toggle sent four fields and every activate/deactivate wiped that
test's `preparation`. Measured on Fasting Blood Sugar: one toggle deleted "Nothing to eat or
drink except water for 8 hours", which [1.25.0] puts in the day-before reminder, so the patient
is reminded of a fasting test with no instruction to fast. `testService.updateTest` now
distinguishes `undefined` (not sent — keep it) from `''`/`null` (sent — clear it), and decides it
in the service so every caller gets it. The controller's `isActive: isActive !== undefined ?
isActive : true` was the same bug pointing the other way, turning "I did not mention it" into
"switch it on". If you add a repository method that writes a whole row, the service above it owes
the same treatment.

**The patient portal has no notification bell — email is the only channel that reaches a patient.**
`[1.49.0]` `notifyRoles` writes to staff, who have a bell in `SidebarLayout`. A Client does not, so
an in-app notification addressed to one is a row nobody can ever see. Anything a patient must be
told goes through `appointmentEmailService`, which skips cleanly when SMTP is unconfigured; the
portal screen is where they look it up afterwards, not how they find out.

**PHI reads are audited; keep the scope narrow.** `auditService.logPhiRead` records reads of an *identified patient's* records (demographics, result history, report file). Do not add it to searches, worklists or queues — staff refresh those constantly, and the entries that matter would drown in traffic that is just people doing their job. That is the fan-out mistake that took `notification_reads` to 255,540 rows.

**`test_results` is versioned — always filter on `is_current`.** A test carries one row per version of its report (an amendment supersedes rather than overwrites; see [1.15.0]). A `LEFT JOIN test_results` without `AND tr.is_current` repeats the parent row once per amendment and shows superseded findings beside live ones, and an `UPDATE … WHERE visit_test_id = $1` without it rewrites the history. `findVersionHistoryByVisitTestId` is the only intentional reader of superseded rows.

**Never filter on `column::date`.** A B-tree index cannot serve a predicate on an expression, so `WHERE created_at::date = CURRENT_DATE` silently forces a sequential scan no matter what is indexed — `idx_patient_visits_created` existed for a year and was never used. Write half-open ranges on the raw column instead: `col >= $1::date AND col < ($2::date + 1)`. Measured at 219k rows: 50.7ms seq scan vs 0.84ms index scan. Casting in `SELECT`/`GROUP BY` is fine; only the filter matters.

**A money total never comes from the transaction list.** `GET /payments/transactions` is a log of
receipts *issued*, and it includes ones later reversed — the cashier's cash-up is the screen that
most needs to show a refund, not the one that can afford to hide it. The peso figures come from
the `summary` the same response carries, aggregated in SQL over settled rows. Reducing the rows
instead was how it worked before, in ten places across four screens, and it made the list's WHERE
clause silently load-bearing for every revenue figure in the app: the log could not begin showing
a reversal without that reversal being counted as income on the admin dashboard, the reports
overview, cashier monitoring and the cashier's own terminal. `summary` is also computed across the
whole date range, so it stays right on a paged call, where reducing the rows in hand totals one
page and labels it the day.

The same predicates serve `reportRepository` [1.32.0] — the operations report was left behind by
[1.30.0] and spent a day disagreeing with the cashier's screen about the same figures, while still
restating closed days on the half that gets printed. They live in `src/constants/moneyRange.js`
now; two copies of this rule drifted apart within one commit of each other, so there is one.

The figures are a **period cash book** [1.30.0]: `collected` is money taken *in* during the range,
bucketed by `paid_at` and counted whatever happens to the receipt afterwards; `reversed` is money
handed *back* during the range, bucketed by `refunded_at`. Collections are therefore never
restated — reversing an older receipt used to rewrite a day that had already been printed and
filed, so the sheet in the drawer and the screen disagreed with no way to tell which was right.
`reversed` is reported *beside* `collected`, never netted off it: a drawer short by a refund needs
the refund named, and a receipt paid and refunded on the same day should read as money in and money
out rather than as nothing having happened. The list matches the range on **either** date, so the
`reversed` figure always has a row behind it. Two conditions decide what counts as an
issued receipt, and both matter: the status list keeps 'Pending' checkouts out, and
`receipt_number IS NOT NULL` separates the two meanings of 'Cancelled' — an abandoned gateway
session (money never taken) from a paid receipt voided by staff (a real reversal). `paid_at`
cannot make that distinction; it is `DEFAULT CURRENT_TIMESTAMP`, so a pending row carries one too.

**Enlogada is NON-VAT registered, and that changes what a senior pays.** The clinic's
BIR-registered service invoice reads "Non VAT Reg. TIN : 412-980-963-00000" and "THIS DOCUMENT IS
NOT VALID FOR CLAIMING INPUT TAXES". `CLINIC_VAT_REGISTERED=false` is therefore set in
`backend/.env`; it had been defaulting to `true`, which stripped 12% VAT the clinic never charged
and billed a senior 714.29 on a 1,000.00 service instead of 800.00 — **85.71 undercharged per
1,000**, and a VAT exemption claimed by an establishment not registered for VAT. Any spec
asserting the discount arithmetic must read `GET /api/clinic` → `vatRegistered` rather than
assuming; `discounts.spec.js` does, and failed the day the setting was corrected because it did
not.

**The catalogue holds the clinic's real prices** — loaded by `node src/scripts/seedRealCatalogue.js`
(dry-run by default, `--confirm` to write) from the printed price lists. `[1.45.0]` covers
Laboratory, Ultrasound and X-Ray plus the five package deals. **2D Echo and ECG are deactivated**
— the clinic does not offer them. It updates rows in place rather than
replacing them, because `visit_tests.price_at_time` snapshots the sale price and historical rows
point at these ids; a demo row with no equivalent on a sheet is **deactivated, never deleted**.
Do not assert a literal price in a spec — read it from `GET /api/tests`, as
`booking-communication.spec.js` does.

**Packages are managed on Services Catalog, behind `tests:manage`.** `[1.47.0]` Deliberately the
same permission that governs pricing a test, because a package IS a price — a separate one would
have to be granted alongside it every time, and the first omission produces an admin who can
reprice a test but not the bundle containing it. `GET /packages` is public and active-only;
`GET /packages/manage` is staff-only and includes retired ones. Retiring is not deleting: the rows
stay so booked visits keep their price, it just stops being offered. The server refuses a bundle of
fewer than two tests and refuses to book a retired one.

**A package is not a `tests` row, and cannot be.** `[1.45.0]` A row has one `category_id` and that
is what routes work to a department worklist — every bundle spans Laboratory *and* Ultrasound, so
as one row half the work would never reach the department that has to do it. `test_packages` +
`test_package_items` instead, and at booking `packageService.attachPackages` **expands a package
into one `visit_tests` row per component**, so every downstream screen keeps working on ordinary
visit_tests. The fixed price is spread across the components in proportion to their list prices
with the remainder on the largest, so the parts sum to the package price **exactly** — that column
is what the visit subtotal, the discount base, the drawer and the per-department revenue report all
read. Packages attach BEFORE loose tests: both writes are `ON CONFLICT DO NOTHING`, and for a test
that is in a bundle *and* picked individually the package's allocated share must be the one that
survives.

**Statutory discounts: whether VAT comes off first depends on the clinic, and Enlogada's answer is no.** The order only exists for a VAT-REGISTERED establishment, where a Senior Citizen / PWD sale has the 12% VAT stripped **first** and the 20% applied to the VAT-exempt base (RA 9994 / RA 10754) — 714.29 on a 1,000.00 service. Enlogada is not VAT-registered (see above), so nothing is stripped and the 20% comes off the full price: **800.00**. `discountService.computeBreakdown` branches on `CLINIC_VAT_REGISTERED` at one line and that is the only place the two treatments differ. Only `is_statutory` discounts get the VAT step at all; a promo rate is an ordinary discount either way. `tests.price` is stored VAT-inclusive, so where VAT does apply it is extracted rather than added.

This paragraph asserted the opposite of the one above it for a day, having been written when the clinic was believed to be VAT-registered. If you change the registration, change both.

**Dates: never use `toISOString()` for "today" — and that includes test code.**
`ticket-release-gating.spec.js` computed tomorrow as `new Date(Date.now() + 86400000)
.toISOString().slice(0, 10)`. Run at 03:11 on a Sunday in PHT, UTC is still Saturday, so "tomorrow"
resolved to Sunday — the clinic is closed Sundays and three tests **silently skipped**. They are
the ones asserting an unpaid appointment stays invisible to the department, and a security check
that quietly does not run reads exactly like one that passed. Use the local-date `workingDay()` /
`nextWorkingDay()` helpers those specs now define. Watch the skip count, not just the pass count.

**Dates: never use `toISOString()` for "today".** It returns the **UTC** date, which in Philippine time (UTC+8) is *yesterday* between midnight and 08:00 — silently, with no error. Postgres `CURRENT_DATE` is the server's local date, so the two disagree every morning. Frontend code uses `frontend/src/lib/date.js` (`todayStr` / `daysAgoStr`, built from local getters); backend code derives date strings **in SQL** rather than in JavaScript. This bug shipped twice: in four dashboard `todayStr` helpers, and in the receipt-number generator.

**Numbers that must be unique** (queue tickets, receipt numbers) come from `daily_counters` via `INSERT … ON CONFLICT DO UPDATE … RETURNING`, never from `SELECT COUNT(*) + 1`. Counting rows is not a sequence: it races under concurrency, and it rewinds when a row is cancelled or refunded, reissuing a number already handed to a patient. Unique indexes back all three invariants. Core flow through the tables:

`users` → `patients` (1:N via `user_id` — one account owns several profiles, e.g. a parent booking for dependents; `GET /patients/my-profiles` is plural for this reason, and ownership checks must compare per-patient rather than resolving a user to a single patient) → `patient_visits` (a clinic visit/queue entry) → `visit_tests` (tests attached to a visit, priced via `price_at_time`) → `test_results` (findings/file per visit_test, released by staff) and `payments` (billed against a visit). `appointments` link to a `patient_visit`. `hmo_requests` link a visit to an `hmo_providers` approval flow. `tests` belong to a `test_categories` row (Laboratory/Xray/Ultrasound, plus the retired 2D Echo/ECG that only history uses) and have an `is_active` flag that controls public visibility.

**Polling revalidates rather than refetching.** Four screens poll to stay live, and a measured
idle reception terminal made 240 requests and pulled ~1.5 MB an hour — roughly 500,000 requests
and 3.2 GB a month across ten staff, nearly all of it re-sending unchanged bytes. Express already
emitted an `ETag` on every JSON response and already answered a matching `If-None-Match` with a
0-byte 304; **CORS was not exposing the validator to JavaScript**, so nothing ever asked. Two
lines of CORS config (`exposedHeaders: ['ETag']`, and `allowedHeaders` including `If-None-Match`)
plus `frontend/src/config/revalidationCache.js` cut measured traffic 47% over 95 seconds, and more
the longer a screen stays open.

The validators are held **in memory**, not via `Cache-Control`. The conventional header approach
would write active patient queues and result histories into the browser's on-disk HTTP cache,
where they outlive the logout and are keyed by URL alone — so two accounts on one reception
terminal would share them. The in-memory map is cleared on sign-out and on any 401. If you add a
polled endpoint it gets this for free; if you add one whose response must never be reused, give it
a distinct URL rather than trying to opt out.

`revalidation.spec.js` is the guard that matters here. The bandwidth is not the risk — a cache
that answers "nothing changed" when something did is, and a receptionist watching a queue that has
silently stopped updating is worse off than one on a slow connection.

### UI conventions

**Everything visual is decided once, in `frontend/src/index.css`.** The brand is unchanged —
`#769046` green, dark slate chrome, 'Outfit' — but it is now reached through tokens rather than
arbitrary values. Four rules make the difference, and breaking any of them is what the consoles
looked like before:

- **One neutral ramp.** Tailwind's `gray-*` is remapped onto `slate-*` in `@theme`, so the two
  ramps the app mixed (`border-gray-100` beside `text-slate-900`, warm against cool) are now the
  same colour temperature. Use either; they resolve identically. Hairlines are `border-[#e6ebf1]`
  (the `line` token) — `gray-100` as a *border* is nearly invisible against white.
- **The brand green comes from the `brand-*` ramp**, not from `bg-[#769046]/10`. Arbitrary
  opacity variants are how five different pale greens ended up on one screen.
- **Shadow means "this floats."** Static panels are separated by a hairline border and a tinted
  canvas, never by a shadow. `shadow-raised` is a hover lift, `shadow-float` is a dropdown,
  `shadow-overlay` is a dialog. There is no fourth.
- **Radius encodes size**: `md` (8px) for a badge, `lg` (10px) for a control, `xl` (14px) for a
  panel, `2xl` (18px) for a dialog or hero.
- **Never write a font size in px.** `[1.38.0]` The reader chooses a text scale (Normal/Large/
  Larger, `lib/textScale.js`), and it works by setting a root font size — which moves `rem` and
  nothing else. A `text-[13px]` does not merely fail to grow, it **inverts the hierarchy**: 13px
  sits between `text-fine` (12px) and `text-sm` (14px), so at 125% the "smaller" fine text renders
  at 15px and the pinned one is still 13. There were 85 of these; the ramp now covers every size
  they used — `nano` 9, `micro` 10, `meta` 11, `fine` 12, `note` 13, `lead` 15, `stat` 30, plus
  Tailwind's own. Same rule for a fixed width that **boxes** text (the sidebar rail truncated its
  labels this way): give it `rem`. Icon and divider sizes stay in px on purpose — they are
  decoration, not reading. `text-scale.spec.js` asserts `fine < note < sm` at all three scales and
  is what catches the 86th.
- **A new `@theme` token that is not a colour must also be registered in `lib/utils.js`.**
  `[1.42.0]` `cn()` is `twMerge(clsx(…))`, and tailwind-merge parses class *names* against its own
  model of Tailwind — it cannot see `@theme`. It read `text-micro` as a text *colour*, hit
  `text-slate-500` later in the same call, and **deleted the size**: metric labels asked for 10px
  and rendered at 16px inherited, on every console. `cn()` uses `extendTailwindMerge` with the
  `text` and `shadow` keys registered; add to those lists in the same commit as the token.
  Colours need no entry — colour is tailwind-merge's fallback guess, which is exactly what broke
  the sizes. The class is present in the JSX and absent from the DOM, so only a computed-style
  check catches it; `text-scale.spec.js` has one.

Layout primitives, all in `frontend/src/components/ui/`. Reach for these before writing a `<div>`
with a border on it — each exists because the markup it replaces had been copy-pasted 15–40 times
and the copies had drifted apart:

| | what it is |
|---|---|
| `page-header.jsx` | opens every screen — eyebrow, title, one-sentence description, actions. `variant="hero"` is the dark treatment, for the two landing screens only |
| `panel.jsx` | the section container (`Panel` / `PanelHeader` / `PanelBody` / `PanelFooter`). `<PanelBody flush>` for a table or divided list |
| `toolbar.jsx` | the filter row above a worklist. `attached` joins it to the panel below; also exports `SegmentedFilter` and `ToolbarField` |
| `empty-state.jsx` | what a screen shows when there is nothing. `tone="error"` looks *deliberately* unlike empty — a failed request and a quiet morning must never be confusable |
| `.field-label` / `.alert` | two component classes in `index.css`, for the form label and the inline alert. Leaf elements, so a class is the right unit |
| `button.jsx` | `<Button loading>` for anything in flight — spinner, disable and `aria-busy`, and the **label stays put**. Never swap it for "Saving…": on `ConfirmDialog` that erased which of a refund, a cancellation or a release the person had just agreed to. `[1.39.0]` |
| `date-field.jsx` / `calendar.jsx` | every date input. Keeps the native `<input type="date">` and replaces only the picker, so ISO values, `min`/`max`, `required` and the phone's OS picker all still work. Where the browser's glyph cannot be hidden — Firefox, measured, no CSS exists — it renders nothing custom rather than showing a second icon. `RANGE_PRESETS` for filters, `BIRTHDATE_YEAR_RANGE` for birthdates. See migrations.md [1.34.0] |

- **The printed receipt is `components/Receipt.jsx`**, and the clinic's own identity is
  `lib/clinic.js`. Two rules. First, anything inside `.print-area` prints, including a toolbar
  that happens to be nested there — the old receipt's Print button printed itself; mark chrome
  `no-print`. Second, `lib/clinic.js` leaves `tin` / `businessPermit` blank unless configured
  (`VITE_CLINIC_TIN`), and the receipt then says it is *not* a BIR-registered Official Receipt.
  Do not invent those numbers to make it look official — a patient may file it for reimbursement.
- **A mutation that only closes a dialog has told the user nothing** — success looks identical to
  cancelling. Reach for `toastSuccess` from `lib/toast.js` and **name the thing**: the patient, the
  new slot, the decision. A bare "Saved" on a list of forty records confirms nothing. Skip it where
  better feedback already exists (`BookingDialog` shows a reference code, `WalkInRegistration`
  prints the queue ticket) — a toast on top of those is noise.
- **A spinner is exempt from the reduced-motion kill, and must stay exempt.** `[1.39.0]` The
  blanket `prefers-reduced-motion` rule sets `animation-iteration-count: 1` at `0.01ms`, which does
  not slow a spinner — it stops it dead after one instant rotation, so every loading indicator in
  the app read as a hang for those users. `.animate-spin` is re-declared inside that media query at
  half speed. Keep the exemption narrow: decorative animation still gets killed.
- **A sticky action bar cannot be the last child.** `position: sticky` is constrained by its
  containing block, so an element already at the end of one has no space to slide into and never
  moves. The cashier's Take Payment button was measured at y=904 on a 900px viewport that way. It
  is a pinned *header* now, with the button outside the form reaching it via `form="checkout-form"`.
- `SidebarLayout.jsx` is the shared shell for staff/admin consoles. Its nav column scrolls
  independently and its department groups collapse (remembered in `localStorage`, but the group
  holding the current screen always opens). The top bar is a **breadcrumb**, not a second page
  title — the screen's own `PageHeader` carries the heading, so don't add a title to both.
- `DashboardLayout.jsx` / `PublicHeader.jsx` / `PublicFooter.jsx` are the public-page equivalents.
- **A rename walks through prose. Run `python scripts/prose_scan.py frontend/src` after one.**
Extracting state into a hook means rewriting `findings` to `entry.findings` across a file, and a
word-boundary regex matches inside English and inside string literals — a hyphen and a space are
both non-word characters. It has produced, on screen: *"Release CBC entry.findings for Juan Dela
Cruz?"* on the dialog a technician confirms before a report leaves the department; *"No
bookings.appointments booked yet."* on a patient's own dashboard; and *"SuperAdmin · 30
access.permissions"* on the RBAC matrix. **No spec asserts this copy, and the build compiles it
happily**, so nothing catches it but reading the screen or running the scan.

The scanner checks all four places prose hides — quoted strings, template literals, JSX text
between tags, and `{/* … */}` comments — and ignores a backticked `hook.property`, which is the
convention for a deliberate code reference. Its `HOOKS` list is its eyesight: **a prefix missing
from it is damage it cannot see**, which is how the RBAC copy survived a run reporting clean. Add
each new hook's binding name to that list in the same commit that introduces the hook.

**Fixtures are named after people, and the uniqueness lives in the email.** `[1.46.0]`
`tests/e2e/helpers/people.js` — the rows a run creates are real rows in a real database while it
runs, sitting in the Active Queue and patient search, so `E2E Pkg1786480428` means anyone who opens
the app mid-run sees a clinic full of garbage. Nothing in the automatic teardown ever keyed on the
name (`purgeE2eData.js` scopes by the `@enlogada-e2e.test` domain and the run window), but the
manual `cleanE2eData.js` did — it keys on the reserved contact number `09000000000` now, and keeps
the old name patterns for historical rows. Two deliberate exceptions: `revalidation.spec.js` needs
a surname that provably does not exist yet, and a pool name could collide with a demo patient. And
never hard-code a fixture's name into an assertion — `laboratory.spec.js` had `M9` in five of them,
a second source of truth for something the fixture already carries.

**A spec that creates a catalogue row must expect the purge to remove it.** `[1.46.0]`
`purgeE2eData.js` deletes unreferenced `tests` rows named `E2E %`. Before that it only cleaned
visits, patients and notifications, so `catalogue-partial-update.spec.js` — which deactivates its
fixture rather than deleting — left one row behind on every run, forever, visible in the admin
Services Catalogue.

- **A solid fill never comes from a ramp shade — it comes from a paired token.** `[1.46.0]` The
  dark block remaps ramps for the INK role, so `bg-slate-900` is near-black in light and
  **near-white** in dark. Under a hardcoded `text-white` that is 1.12:1, which is what shipped on
  the queue ticket, the walk-in Search button and — worse — the Confirm Refund button at 2.69:1.
  Use `bg-emphasis text-emphasis-foreground` or `bg-destructive text-destructive-foreground`: the
  fill and its ink are defined next to each other so the dark block cannot flip one without the
  other. `scripts/checkFillRoles.js` (wired into `npm run lint`) rejects the ink-only shades.
- **A surface that is dark in BOTH themes must not carry themeable ink.** The rail, the hero
  panels, `.auth-panel`, the public footer and the navy banners do not flip, so `text-slate-300`
  on them inverts to dark-on-dark. Use `text-rail-ink-*` and `border-rail-line`. This has now been
  found four separate times; it is the single most repeated dark-mode mistake in this codebase.

**Don't couple a test to a class name.** `payment.spec.js` used to scope itself with
  `ancestor::div[contains(@class,"rounded-2xl")]`, so changing a corner radius failed a payment
  assertion. Add a `data-testid` instead.

## Repo conventions

- Files: PascalCase for React components, camelCase for JS utilities/backend files, snake_case for DB identifiers.
- Keep files focused; split when they exceed roughly 300–500 lines.
- `.agents/AGENTS.md` and `.agents/PROJECT_STRUCTURE.md` define an internal "AI team" convention (Architect/Backend/Frontend/Database/Business-Analyst roles) used to keep contributions consistent — the layering and naming rules above are drawn from it.
- A version-control skill (`.agents/skills/version_control_agent/`) exists for timestamped checkpoint commits/rollback via PowerShell scripts; this explains the "Checkpoint (yyyymmdd-HHMMSS)" style commit messages seen in git history. Don't assume this workflow applies unless the user invokes it.
