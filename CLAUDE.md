# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Enlogada Clinic Management System — an enterprise diagnostic healthcare platform for human diagnostic services only (**Ultrasound, Laboratory, Digital X-Ray**). Veterinary/pet functionality was fully removed; do not reintroduce it.

**2D Echo and ECG are not offered.** `[1.47.0]` The clinic confirmed this.

**2D Echo is now GONE entirely** `[1.50.0]` — category, tests, `modality.js` mappings, category
colour and the portal filter. [1.47.0] kept the category because 18 historical `visit_tests`
pointed at it; that count reached zero, so the reason expired. `migrateRemove2dEcho.js` does the
deletion and **re-counts the references itself before touching anything**, exiting without a
change if any remain — a developer database and the clinic's live database are not the same
database, and the whole argument for deleting rests on a number only true of one of them.
`--rollback` restores the category and both tests, inactive.

**ECG is different: deactivate, do not delete.** Its tests are inactive and it is gone from public
copy, but the `test_categories` row, its colour and `CATEGORY_ORDER` entry REMAIN so a past visit
can still say what it was for. The portal's filter chips are derived from what each patient
actually has `[1.49.0]`, so nobody is offered an ECG filter unless they had one.

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
npm run dev:lan           # the same, reachable from a phone on the Wi-Fi. Needs frontend/.env.lan
                          # (VITE_API_BASE_URL=http://<PC's IP>:5000/api) and that page address in
                          # backend CORS_ORIGINS; both are local, untracked. Google sign-in does not
                          # work from an IP address — use email and password on the phone.
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
node src/scripts/migratePatientArchive.js      # [1.56.0] archive a patient record without deleting a clinical history (--rollback reverses it)
node src/scripts/migrateScheduleOverrides.js   # [1.57.0] close a DATE, or change its hours/capacity, without touching the weekly pattern (--rollback reverses it)
node src/scripts/migrateResultDelivery.js      # [1.59.0] record that a released report actually reached the patient (--rollback reverses it)
node src/scripts/migratePatientEmail.js        # [1.60.0] an address on the patient record, so a walk-in can be sent their result (--rollback reverses it)
node src/scripts/migrateRemove2dEcho.js       # [1.50.0] remove the 2D Echo category and its tests; REFUSES if any visit_tests still reference them (--rollback restores)
node src/scripts/migrateAuthCodes.js           # [1.73.0] emailed codes for sign-up and password reset; one account per address (--rollback reverses it)
node src/scripts/migrateRemoveCriticalValues.js # [1.98.0] withdraw the critical-value workflow; copies each flag into audit_log first (--rollback restores the columns, empty)
node src/scripts/migrateRescheduleReason.js     # [1.105.0] a reschedule records why; dates earlier moves from audit_log (--rollback reverses it)
node src/scripts/migrateDoctorRequest.js        # [1.106.0] a patient's booking carries the doctor's signed request; drops the withdrawn hmo_requests draft (--rollback reverses it)
node src/scripts/migrateRemoveResultForms.js  # [1.109.0] drop the five typed result-form tables; copies every typed value and signatory into audit_log first,
                                              #   and REFUSES if a current result has typed values and no file (--force drops anyway; --rollback restores the tables and signatories)
# The [1.50.0]-[1.64.0] form migrations (ResultFieldSets, BiophysicalScore, LabResultForms, ResultPrecision,
# ResultSignatureMode) and seedResultFieldSets.js were deleted with it: they only built what [1.109.0] removes.
node src/scripts/migrateAuthorisedIndex.js      # [1.110.0] index authorised_at, which every report now reads as "released" (--rollback reverses it)
node src/scripts/migrateVisitFeedback.js        # [1.112.0] patient feedback: 2 tables, 6 visit columns, 2 permissions, the paper form's 4 questions (--rollback reverses it)
node src/scripts/migrateReportVerification.js   # [1.126.0] a verification code per released report version; backfills released ones (--rollback reverses it)
node src/scripts/migrateExamPerformed.js        # [1.129.0] visit_tests.performed_at/_by: an X-ray exam marked done (--rollback reverses it)
node src/scripts/migrateUnpaidIsTemporary.js    # [1.131.0] removes never-paid Cancelled / No Show visits (Activity Log line each), drops [1.130.0]'s closed_reason/_at, retires appointments:cancel

# Clear accumulated E2E/fixture traffic, keeping reference data and seeded accounts.
# Dry-run by default; --confirm actually deletes. Refuses to run under NODE_ENV=production.
node src/scripts/resetDemoData.js             # report only
node src/scripts/resetDemoData.js --confirm   # apply

# Seed a realistic clinic dataset: ~18 visits today at every workflow stage (awaiting payment,
# senior/PWD discounts, on each modality worklist, a markedly abnormal result, an AMENDED report,
# HMO pre-auth) plus 60 days of backdated history (~85 patients, ~140 visits) so the reporting
# screens have something to plot. [1.125.0]
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

# Appointment reminders are AUTOMATIC [1.130.0]: the server sweeps every minute and sends each
# when it falls due (see "Appointment reminders" under Database). Nothing to schedule. This script
# shows the plan, and can run one sweep by hand; safe beside the server, as each is claimed first.
node src/scripts/sendAppointmentReminders.js              # each booking owed a reminder, and when (--days=7, --json)
node src/scripts/sendAppointmentReminders.js --confirm    # send what is due right now

# Unpaid is temporary, and removed AUTOMATICALLY when its time is up [1.131.0] (every 5 min): an
# unpaid walk-in after its day, an unpaid booking after its day or once its time to pay runs out.
# This runs it now. Off in the server with UNPAID_EXPIRY=off.
node src/scripts/removeExpiredUnpaid.js

# Retention pass for HMO card images (insurance documents, not medical records). Dry-run by
# default; --confirm applies. The window is a constant in the script, overridable per run.
node src/scripts/pruneHmoCards.js
node src/scripts/pruneHmoCards.js --days=180
node src/scripts/pruneHmoCards.js --confirm
```

**Before a demo:** `cd backend && npm run demo`, on the day (every "today" screen reads the
current date) and with both servers running. It runs `resetDemoData.js --confirm`, then
`seedUsers.js`, then `seedDemoScenario.js`. `[1.89.0]` The seed is invented people
with ordinary names and Bugo / Cagayan de Oro addresses, one record each, with every result form
filled inside the clinic's printed ranges and the day spread across clinic hours; no patient has an
email address. `seedUsers.js` renames any demo account still carrying a placeholder name. Keep new
seed data looking real: no "Test", "E2E" or joke names, no shared phone number, no empty forms.
`[1.125.0]` Every report is drawn on the clinic's own form (`scripts/demoReportPdf.js`, from their
photographed CBC: letterhead, patient block, TEST / RESULT / UNIT / REFERENCE RANGE, the seal note
and the department's signatories from `constants/labResultForms.js`), with a small foot line saying
it is a demo record; never copy a real patient's report into the seed. The history is ~60 generated
people over 60 days, each visit a real mix (`VISIT_KINDS`, weighted so ultrasound leads), about one
in six abnormal, with senior/PWD discounts and approved HMO claims; its notifications are deleted, as
the staff saw them weeks ago. The reset deletes every account but the nine seeded ones, so list a
real person's own sign-in in `DEMO_KEEP_ACCOUNTS` (backend `.env`, comma-separated) to keep it.
`[1.130.0]` `seedUsers.js` also puts each seeded account back to its ONE role: a second role given
on Staff Accounts while trying it (Joel, cashier@enlogada.com, made a receptionist too) would
otherwise outlive the reset, and specs like `patient-records-final` take that account to be a
cashier and nothing else.

The suite now cleans up after itself — `playwright.config.js` wires a global setup/teardown that stamps the run start and then deletes everything the run created (throwaway `@enlogada-e2e.test` accounts, plus any visit, payment, notification or audit row created inside the window). Row counts are identical before and after a run, so a seeded demo dataset survives testing. Set `E2E_SKIP_PURGE=1` to keep the data when debugging a failure. Cleanup never fails the run; if it errors it says so and leaves the data behind.

The E2E suite creates a throwaway client, patient, visit and payment on every run and never cleans up, so the dev database drifts a long way from anything a clinic would recognise — left alone it reaches thousands of visits and a billing queue hundreds deep. That skews demos, makes paginated/aggregate screens behave unlike production, and slowly breaks tests that walk a list to find their own record.

The worst of it is `notification_reads`, which is a **fan-out** table: `notifyRoles` writes one row per recipient per event, so its size is events × staff, not events. Because the suite also created staff and elevated accounts that were never cleaned up (137 Cashiers, 89 Admins, 45 SuperAdmins had accumulated), both factors grew at once and the table reached 255,540 rows across 4,309 events in five days — average fan-out 60, peak 181, with 99.4% never read by anyone. After a reset the same fan-out is 3. Production will not see the runaway staff count, but it has no retention either: 20 staff × 200 events/day is ~1.5M rows a year, growing forever. Schedule `pruneNotifications.js` (default: read 30d, unread 90d) in any environment that runs longer than a demo.

**There are now two test tiers, and they answer different questions.** `[1.63.0]`

```bash
cd backend  && npm test        # 140 unit tests, node:test, ZERO dependencies, ~0.7s
cd frontend && npm run test:unit # 137 unit tests, vitest, ~1.5s
cd frontend && npm test        # 523 Playwright E2E, ~14m, needs both dev servers
```

The unit tier covers the pure, deterministic rules where the *arithmetic* is the thing at risk:
discount strategies (asserted against RA 9994 and the clinic's own non-VAT invoice, not merely
against the previous implementation), CSV serialisation (RFC 4180 escaping, the UTF-8 BOM, the
empty-cell-not-zero rule, filename header-injection), the error hierarchy's compatibility with the
~166 legacy `error.statusCode =` sites, arrival-time arithmetic, queue-estimate floors/rounding/
caps, the OCR reference and amount parsers, and abnormal-value detection.

`node --test` on the backend is deliberate: Node 24 has a test runner built in, so the backend
gained a whole tier without a single new dependency. Vitest on the frontend shares the existing
Vite config. `playwright.config.js` scopes `testDir` to `tests/e2e`, so the tiers cannot collect
each other's files.

**Which tier a new test belongs in:** if it needs a database, a server or a browser, it is E2E. If
it is a function you could call from a REPL, it is a unit test — and it belongs there, because a
7-minute suite is not where you want to discover that a rounding rule changed.

There **is** an automated end-to-end suite: `frontend/tests/e2e/` holds 87 Playwright specs (523 tests, ~14m) run with `npm test` (or `npm run test:ui`) from `frontend/`. It assumes **both dev servers are already running** and hits the real database — see `frontend/tests/e2e/README.md`. See the tiers above.

The suite is a deliberately small demo-and-regression net, not exhaustive coverage: smoke, security boundaries (`api-authorization.spec.js` — Admin-vs-SuperAdmin separation of duties, combined-role access, and the cross-role PHI boundaries), ticket-release gating, payments, laboratory results, statutory discounts (`discounts.spec.js`), result amendment history (`result-versioning.spec.js`), password-change session revocation (`session-revocation.spec.js`), account lockout and PHI read auditing (`login-protection.spec.js`), permission-matrix enforcement (`rbac-enforcement.spec.js`), department-scoped patient records (`department-scoping.spec.js`), the per-department operations report (`operations-report.spec.js`), atomic online booking with its HMO card evidence rule (`booking-atomicity.spec.js`), the two dialogs that feature added (`hmo-card-review.spec.js` — because a card that uploads correctly and then renders as a broken image on the approval screen is a working feature failing at its job), moving a booking rather than cancelling it (`appointment-reschedule.spec.js`, plus `reschedule-ui.spec.js` for the dialog), when a visit must name the doctor who requested the test (`referring-physician.spec.js`), correcting a patient record (`patient-edit.spec.js` / `patient-edit-ui.spec.js`), what the patient is told about their own booking (`booking-communication.spec.js`), that the ETag revalidation cache never hides a change (`revalidation.spec.js`), that each role can see what it needs on the screen where it acts (`workflow-context.spec.js`), registering a walk-in in one pass (`walkin-registration.spec.js`), the patient journey at phone width (`mobile-patient.spec.js`), what an HMO decision has to record before it counts as one (`hmo-decision-trail.spec.js` — a refusal that names no reason leaves the cashier explaining a charge nobody wrote down), the three-step claim workflow itself (`hmo-claim-handoff.spec.js` — reception raises it, an Admin decides it, and the cashier has to be TOLD), and that a failed request never renders as an empty one (`failure-states.spec.js` — six screens shipped without an error branch, so a 500 fell through to the empty state and the app stated "Today's Revenue ₱0.00" over a day that took ₱8,344; `[1.74.0]` added the screens each role lands on, whose counters start at zero and stayed there on a failure), that Transaction History's takings answer for the dates its receipt list shows (`takings-range.spec.js`), that the front desk finds a booking, a record or nobody from one box and never offers a second visit to someone already in the queue (`front-desk.spec.js`), that each sidebar count is the number its screen shows and an action is on screen once (`sidebar.spec.js`), that every member of staff lands on Today, where each item has the button that deals with it and a button that opens another screen arrives already doing it (`today.spec.js`), that SuperAdmin assigns access on the "Who sees what" grid, where every switch says in words what it will change and nothing is saved until Save (`access-grid.spec.js`), that every screen's heading and breadcrumb are its sidebar name (`screen-names.spec.js`), that the patient portal's Home says what is owed and what it could not check, and its phone tab bar covers nothing (`portal-home.spec.js`), and that there are no refunds: no route, no permission, no button, and a paid visit points to a new visit (`refunds-removed.spec.js`, `[1.121.0]`), and that what a final receipt rules out stays ruled out: a payment over a pending HMO decision or an unchecked online proof, a paid no-show, an unpaid booking holding its slot past its payment window (`process-fixes.spec.js`, `[1.123.0]`), and that the server refuses what the screens refuse, whoever skips the screen (`process-rules.spec.js`, `[1.124.0]`), and that the reader's chosen text size scales the whole interface without inverting its own type ramp (`text-scale.spec.js` — a pixel-pinned font size looks perfect at the default and misbehaves only for the people who changed it), and that a patient can pay into the clinic's own account and only a cashier can turn that into money (`manual-payment.spec.js` — publishing an account number is SuperAdmin alone, and the amount a patient CLAIMS never becomes the amount they are charged), and that a package deal bills its own fixed price rather than the sum of its parts, with every component reaching its own department (`packages.spec.js` — a bundle that costs more than buying the parts separately is a surcharge wearing the word "package"), and that updating a service does not delete the fields the caller did not mention (`catalogue-partial-update.spec.js` — the status toggle used to wipe a test's patient preparation, which is the sentence the day-before reminder carries). It was cut down from ~200 tests once the module-by-module build-out finished; the rest asserted UI copy that legitimately keeps changing. Prefer adding a focused spec over reviving deleted ones from git history.

**A booking carries a test, and lands inside the horizon.** `[1.124.0]` The API refuses a booking
with no tests, so a spec that only needs "a booking" passes `testIds: [await bookableTestId(ctx)]`
(`helpers/booking.js`). It also refuses a date more than 365 days ahead, and availability reads such
a day as closed, so a spec booking further out SKIPS itself rather than failing: `hmo-card-review`
booked at +500 days and went quiet that way. Keep booking dates within ~360 days, and watch the skip
count. A patient may hold more than one booking a day (fasting bloods in the morning, an ultrasound
later), so only the same SLOT is a duplicate. A spec that checks in a booking for the seeded client
removes it afterwards if unpaid (`ticket-release-gating`): a checked-in, unpaid booking is that
patient waiting, and the next spec's walk-in for them is then refused as a second unpaid visit.
`[1.131.0]` Nothing is cancelled any more, so a spec frees what it booked or opened unpaid with
`helpers/booking.js` `removeUnpaid(appointmentId)` / `removeUnpaid(visitId, { visit: true })`
(`e2eRemoveUnpaid.js`, which refuses anything ever paid), never a cancel route: there is none.

**A booking spec must claim its own slot.** `POST /appointments` returns the *existing* booking with 200 when the same patient re-submits the same date and time, so two tests that both take "the first available slot" silently share one visit — and `avail.slots.find(s => s.available)` will not stop them, because a dev database whose cap has been lifted (`cleanE2eData.js --apply --unlimited-slots`, which exists because 18 slots a day cannot absorb repeated runs) reports every slot as available however many bookings it holds. `booking-atomicity.spec.js` and `ticket-release-gating.spec.js` each keep a `claimed` set for this. Symptom when you get it wrong: a create test receives 200 instead of 201, or a test finds a visit some earlier test already checked in.

Run it before and after any non-trivial change and compare the pass/fail counts — the specs assert RBAC boundaries and some UI copy, so intentional changes to those will legitimately turn specs red and the spec must be updated alongside the code. A run takes ~25 seconds; it runs on a single worker because the specs share one database and seeded accounts (see the note in `playwright.config.js`).

Three notes learned the hard way. The dev rate limiter allows 20,000 requests per 15 minutes; running the suite many times back to back trips it, and the resulting 429s surface as scattered, unrelated-looking failures — restart the backend to reset the counter. (There is now a second, tighter limiter on the credential endpoints, but it only counts *failed* attempts and allows 2,000 outside production, so the suite does not touch it.) Editing a backend file mid-run has the same signature: nodemon restarts, in-flight requests are dropped, and several unrelated specs go red at once — re-run on a settled server before believing a failure. And navigation/role changes need `multirole@enlogada.com` (see `TEST_ACCOUNTS.md`) to exercise properly: a single-role account cannot reveal the class of bug where the sidebar offers a screen the router refuses to open. `[1.123.0]` Never start a second `playwright test` while one is running: both write their start time to `test-results/.e2e-run-started`, so the first run's teardown purges only from the second run's start and leaves its own early rows behind (29 visits, found afterwards). If it happens, run `purgeE2eData.js --since=<first run's start> --dry-run`, then without `--dry-run`.

**A patient's HMO booking carries the doctor's signed request; self-pay may.** `[1.106.0]` It
replaced the typed referring physician and clinical notes in the patient's booking dialog, labelled
"Doctor's Request / Doctor's Notes". `[1.107.0]` It is required exactly when
`referralService.referralRequirement` says the visit must name its doctor — an HMO claim, or a
Private patient — and OPTIONAL for self-pay, so the patient's step 2 asks who pays first. A
self-pay booking from a Client token may be JSON again; an HMO or Private one without the file is
refused 400. Book as a patient in a spec through `helpers/booking.js` `appointmentForm()` (it
attaches the paper unless told not to), and walk the wizard's step 2 with `helpers/portal.js`
`attachDoctorRequest()`. Staff bookings stay exempt and may be JSON. The file is on the VISIT
(`uploads/doctor-requests`), read through `GET /visits/:id/doctor-request`, and a request on file
satisfies the referring-physician rule.

**Manual proof of payment is the live channel; the gateway is not.** `[1.48.0]` The clinic takes
online payment WITHOUT a gateway: SuperAdmin publishes its own GCash/bank details and QR
(`payment_methods`), the patient pays and uploads a screenshot plus reference (`payment_submissions`),
and a cashier verifies it. Approval runs the **existing** `paymentService.processPayment`, so it
gets a real receipt number, the visit release and the cash-up entry — never a parallel money writer.
The claimed amount is evidence only: the payment is always the recomputed bill, which is why the
review queue shows `amount_due` beside `amount_claimed` (approving a ₱50 claim on a ₱1,450 visit
records ₱1,450 and the drawer is short with nothing on screen to say so). `[1.105.0]` The portal no
longer asks the patient for an amount: it states the figure with a copy button, omits
`amountClaimed`, and the server records the amount due in its place. `payment_methods.kind` is
constrained to **Cash/GCash/Bank** because those are the cash-up buckets `payments` accepts; the
clinic's own naming goes in `label`. Publishing an account number is **SuperAdmin only and audited**
— it is where a patient's money is sent. Everything below about PayMongo still applies if the clinic
ever wants a real gateway; the two paths coexist.
`[1.126.0]` On a phone the pay panel offers **Save QR** and **Open GCash** (`pay-on-phone`): the
QR on a phone's screen cannot be scanned by that phone, and GCash's own way is QR → Upload of a
saved image. Open GCash only OPENS the app (an Android intent with a Play Store fallback,
`gcash://` on iPhone); nothing can hand GCash the amount and recipient from a personal QR. That
takes the gateway. The published QR is the clinic's real InstaPay card, shown at its own shape.

**Payment first: an unpaid online booking holds its slot only for the payment window.** `[1.123.0]`
Whenever the clinic publishes a payment account, a self-pay booking a patient makes is provisional
for `BOOKING_PAYMENT_MINUTES` (default 60, `PAY_WINDOW_MINUTES` in `constants/slotHold.js`), the
same `held_until` / `OCCUPIES_SLOT` machinery as the gateway's 15 minutes. A proof sent in time
clears the hold (`confirmHold`); one sent after it is refused 409; a rejected proof starts the
window again (`reholdForPayment`). Staff and HMO bookings still take their slot outright. Before
this, only the switched-off gateway ever released a slot, so an unpaid booking held one for good.

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

**Two things change the day it goes on.** Unpaid client self-pay bookings start releasing their
slot after 15 minutes instead of the manual payment window ([1.35.0], [1.123.0] — HMO and staff
bookings stay permanent), and
the client's booking cards begin offering GCash instead of "pay at the counter".

**Outbound email is configured and working.** `[1.50.0]` The clinic sends from
`enlogada2011@gmail.com` via Gmail SMTP — a released result when staff choose to send it `[1.113.0]`, as a marked digital copy `[1.114.0]`, booking confirmations, and the
6-digit codes for sign-up and password reset `[1.73.0]`, so without it nobody can create an
account online (sign-up answers 503 and says why). `SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` in `backend/.env` (gitignored, untracked);
`EMAIL_USER`/`EMAIL_APP_PASSWORD`/`EMAIL_FROM` are accepted as aliases because that is how Google
names them. The App Password lives **only** in that file — never in source, git, logs or docs.
`sendEmail` now requires BOTH halves and names the missing one: checking the username alone let a
half-configured clinic past the guard and fail inside nodemailer once per released result, which
reads as a mail outage rather than an unfinished setting. Nothing is ever sent to the fixture
domains `[1.86.0]` (`utils/fixtureRecipient.js`): the suite's `@enlogada-e2e.test` accounts, and
the seeded `@enlogada.com` ones, a domain that does not exist. A booking made as
`client@enlogada.com` therefore sends no email; test real delivery with an address you can read.

`TURNAROUND_TARGETS` (optional, e.g. `Laboratory:90,Xray:30`) sets the per-department turnaround
benchmarks the Today screen's department table judges against (it reads "Not set" without one).
`[1.62.0]` `[1.111.0]` They are a clinic
POLICY, not a measurement, and the built-in values are plausible defaults nobody has agreed — which
is why they are a setting rather than a table. A department absent from the map is measured and not
judged, with a NULL rate rather than 0.

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
- **"Is this staff?" has exactly one definition: `isStaffUser` in `src/constants/roles.js`** — holds any role that is not `Client`. `authorizeStaff` uses it, and so do the two places that need the same question answered as a *business* rule (whether an HMO claim needs a card photo, in `hmoService.resolveCardEvidence` and `appointmentController.create`; and since `[1.106.0]` whether a booking needs the doctor's signed request, in `referralService.assertDoctorRequestIfRequired`). A local `['SuperAdmin','Admin','Receptionist','Cashier']` list is the wrong shape twice over: it has to be found and edited whenever a role is added, and it disagrees with the matrix the moment a permission like `hmo:request` is delegated to a role the list does not mention.
- **Three axes, resolved server-side in `userRepository` so no caller can disagree with another:**
  - `roles` — staff or patient, and which staff. An account may hold SEVERAL and gets the union of
    what they allow. `[1.129.0]` Staff Accounts creates an account with one or more of the five
    front-line roles and changes them later (row → Roles, `PUT /admin/staff/:id/roles`, audited as
    `staff.roles_changed`); there was no way to before, so "a cashier who also covers the desk" was a
    database edit. Never on an account holding Admin or SuperAdmin (`isAdminManageable`).
  - `permissions` — the role template **plus** that account's own grants, **minus** its revokes (`user_permissions`). Revoke is applied last as a set difference, so a conflict resolves to *less* access.
  - `departments` — the modalities implied by the account's roles **plus** `user_departments`. `null` means unrestricted (Admin/SuperAdmin) and is deliberately distinct from `[]`, "none"; collapsing the two is how an access check ends up inverted. Enforced in the service layer — see `resultService.assertStaffAllowedCategory`.
- Per-account exceptions are edited on **Access Control** (SuperAdmin → One person) and are **audited**. Role edits are not: a role change is visible on the "Who sees what" grid everyone reads, while an exception applies to one person and is easy to forget.
- **`verifyRbacWiring.js` reads a route across lines, and must keep doing so.** `[1.48.0]` It used
  to read one LINE at a time, so a multi-line `router.post(...)` was never examined — a route gated
  on a permission that did not exist was reported as "All good", which is the one thing that script
  exists to prevent. Joined on balanced parentheses now.
- **Adding a permission to a route, or a nav item?** Run `node src/scripts/verifyRbacWiring.js`. Four checks: the permission exists; at least one staff role holds it (otherwise only SuperAdmin can reach the route); for routes that keep an explicit role list, every named role holds it; and every `permission:` in `frontend/src/config/navigation.js` is one the API actually enforces. That last check is what now guarantees the sidebar and the API agree — they used to agree by sharing a hardcoded role list, and no longer do.
- **A screen the sidebar is right to show can still offer actions the API refuses.** `[1.53.0]`
  Access is permission-driven, so a screen is reachable by whoever holds the right permission —
  which means it can be legitimately VISIBLE to someone holding only SOME of the permissions its
  controls need. A Cashier holds `visits:read` and so reaches the front desk's queue legitimately
  (knowing who is waiting is half of running a till), but not `visits:create`, `tests:assign` or
  `hmo:request` — and the screen offered all three anyway, each a 403. Gate every ACTION on the
  permission its own endpoint demands, not just the route. A control that cannot work is worse
  than a missing one: the person clicks it, gets an error that reads as a fault rather than a
  boundary, and stops trusting the parts that do work. `borrowed-screen-actions.spec.js` holds
  both directions — the Cashier is offered none of them, the Receptionist keeps all of them, and
  the API's 403s are asserted beside the UI so the two can only move together. `[1.74.0]` found
  the same on History: an Admin reads every department's results, and was offered Edit
  (`results:write`) and Email (`results:release`), neither of which it holds.
- Navigation gates on the same three axes (`canSee` in `frontend/src/config/navigation.js`: `staffOnly`, `permission`, `department`), so the sidebar cannot advertise a screen the API will refuse. `AuthContext` re-reads `/auth/me` every 60s and on tab focus, so a change reaches a signed-in user without a re-login.
- Roles/permissions are DB-driven (`roles`, `permissions`, `user_roles`, `user_permissions`, `user_departments`), seeded via `setupRbac.js`.
- Google OAuth: `POST /api/auth/google` verifies an ID token via `google-auth-library`, then logs in or auto-creates a Client user.
- **Sign-up and password reset are confirmed by a 6-digit code sent to the address.** `[1.73.0]`
  A sign-up waits in `auth_codes`, and the `users` row is created only when its code is entered, so
  no unproven account ever exists. That matters because Google sign-in links by email: a
  stranger's unverified account under your address would have become yours, with their password,
  the first time you used Google. Finishing needs the browser's TICKET and the emailed CODE; the
  ticket is stored as SHA-256, the code as an HMAC keyed from JWT_SECRET (`utils/authCodes.js`,
  unit-tested). A guess is spent before comparing and a code is consumed by exactly one request
  (`authCodeRepository`). A wrong code is **400, never 401**, which `api.js` treats as a sign-out.
  Forgot-password answers every address the same, in the same time (its work is not awaited), so
  it cannot find accounts; a reset ends every session, clears a lock and is audited. Every background
  send ends in a `.catch`, because `server.js` shuts down on an unhandled rejection. Account emails
  are normalised (`validations/email.js`) and `uq_users_email_lower` enforces one account per
  address. Specs cannot read email, so `helpers/accounts.js` `registerClient()` signs up through the
  real endpoints and sets a known code with `e2eAuthCode.js` (test addresses only). Use it for any
  throwaway client; a bare `POST /auth/register` no longer makes an account.
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
pages/Today.jsx                                              — every member of staff's first screen
components/       ui, booking, patients, reception, today, reports, charts, auth
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

**Every screen but the public pages is fetched on first use.** `[1.87.0]` `App.jsx` imports Home,
About, Services, Privacy and Terms, and loads every other screen through `lazyScreen`
(`lib/lazyScreen.js`), so a phone opening Home downloads 124 KB of compressed JavaScript instead of
407 KB. Add a new screen the same way, never as a plain import, or it lands back in the first file.
Navigation (`selectNav`, `handleNavigate`) runs inside `startTransition`, so the screen being left
stays up while the next one arrives; keep new navigation inside it. A screen's file missing after a
deploy reloads the page once, then goes to the ErrorBoundary. In development, a screen that dies
with "Failed to fetch dynamically imported module" while its own file loads is Vite's library
cache gone stale (a 504 "Outdated Optimize Dep" in the network log), not the screen: restart Vite,
or save `vite.config.js`, which restarts it and rebuilds the cache. Never start a second dev server
on the same folder; it shares `node_modules/.vite`. `[1.89.0]` found the portal failing 25 specs
this way.

Every member of staff lands on **Today** (`pages/Today.jsx`) `[1.77.0]`; see "Every member of
staff lands on Today" under UI conventions. The consoles their sidebar opens from there:
- SuperAdmin/Admin → `AdminDashboard` for the management screens (plus `ServicesCatalog` for the
  services-catalog nav item). Their Today is the clinic's; there is no separate dashboard any more.
- Receptionist → `ReceptionistDashboard`
- Cashier → `CashierDashboard`
- Laboratory/Xray/Ultrasound Staff → shared `DiagnosticDashboard`, filtered by category
- Client → `ClientDashboard`

Public (unauthenticated) pages: `Home`, `ServicesPage` (dynamically fetches active tests from `GET /api/tests`, so admin price/service edits appear live), `Login`, `Register`.

### Database

Schema lives in `database/schema.sql` (source of truth, applied wholesale by `migrateDb.js`); human-readable change log in `database/migrations.md`.

**It is actually the source of truth again as of `[1.54.0]`, and it had stopped being one.** Four
tables (`test_packages`, `test_package_items`, `payment_methods`, `payment_submissions`), the
`visit_tests.package_id` column and its FK, and **ten indexes** lived only inside the additive
migration scripts. A database rebuilt from this file came up with no package deals and no online
payment — the app failed the moment anyone opened the Services Catalogue — and, more quietly,
measurably slower, with no error to say why.

If you add a migration script, fold its DDL back into this file in the same commit. Verify the way
[1.54.0] did rather than by reading: build a throwaway database from `schema.sql` and diff it
against the live one on tables, columns, indexes AND constraints. All four matched exactly — 30
tables, 254 columns, 121 indexes, 240 constraints, zero differences:

```bash
psql -d postgres -c "CREATE DATABASE enlogada_schemacheck"
psql -d enlogada_schemacheck -v ON_ERROR_STOP=1 -f database/schema.sql
# then diff pg_class / information_schema.columns / pg_indexes / pg_constraint against the live DB
```

The one legitimate difference to expect: a constraint a migration added `NOT VALID` (to avoid
validating existing rows) is fully valid in a fresh build, which has no rows to validate.

**Transactions:** `db.withTransaction(fn)` in `src/config/database.js` makes every query issued underneath it — at any call depth, through any repository — run on one connection and commit as a unit. It uses `AsyncLocalStorage`, so repositories need no `client` argument and cannot accidentally write outside the transaction. Nested calls join the transaction already in progress. **Never call `db.pool.connect()` directly**: a self-managed client inside a `withTransaction` opens a second, independent transaction that commits on its own, and with a bounded pool it deadlocks once every connection is held by a transaction waiting for another connection. Any service method performing 2+ writes that must succeed together belongs in `withTransaction`; keep bcrypt hashing and outbound email/HTTP *outside* it so a pooled connection is not held during slow work. No code under `src/services` or `src/repositories` manages its own client any more — the only `pool.connect()` calls left are inside `withTransaction` itself and in one-shot migration scripts, which run alone.

**`createAppointment` is the shape to copy for "commit, then do the after-work".** It writes the visit, the appointment, the tests and any HMO claim in one `withTransaction`, and everything that must only happen *after* a successful commit — the staff notification, discarding an unused card upload — sits after the `try`, not inside it. The version this replaced tracked a `committed` boolean so its own `catch` would know whether the COMMIT had already run; a post-commit throw would otherwise have issued ROLLBACK on a committed transaction and reported a real booking as failed. Structuring it this way removes the flag rather than maintaining it.

**The appointment emails go out after the reply, not before it.** `[1.74.0]` Booking, cancelling
and rescheduling each awaited their email after the commit, so the patient's reply waited on Gmail:
3–4 seconds a send on an ordinary run, and 44 seconds for one on 2026-09-14, when three specs failed
at their 90-second timeout. Each is now started and not awaited, with a `.catch`. The commit is
what the reply reports, and the send never could fail it anyway. A send whose OUTCOME the screen
shows is different and stays awaited: emailing a result (`POST /results/:id/email`) reports whether it went.

**An uploaded file is never named from what the client sent, and never served statically.** All three upload paths (`src/config/upload.js`) build the stored filename from random hex plus an extension mapped from the *validated* mime type, and re-check containment with `assertInside`. The extension used to come from `file.originalname`, which combined with a `%2F`-encoded route param let a request choose both the directory and the suffix — and multer writes before the controller's authorization check runs, so the 403 arrives after the file is on disk. Result files, avatars and HMO cards are all streamed back through an authenticated, ownership-checked route: an HMO card carries a member number, a name and often a photo.

**Preparation is COMPOSED, not retyped.** `[1.54.0]` `tests.preparation` was a free-text box, and
free text drifts. Measured on the clinic's own catalogue: 61 active services, 16 carrying
preparation, and among those 16 only FOUR distinct sentences — two of which say the same thing in
different words ("…an hour before **your appointment** and do not empty your bladder" on Chest
Ultrasound and Thyroid; "…an hour before and do not empty your bladder" on KUB, Lower Abdomen and
Pelvic Ultrasound). The booking wizard de-duplicates preparation by TEST ID, not by sentence, so a
patient booking a Pelvic Ultrasound and a Thyroid together is shown both lines — one instruction,
printed twice, reading as two.

`lib/preparation.js` holds the rules; `PreparationField` ticks them and previews the sentence live.
The column still stores TEXT, deliberately: no migration, and `sendAppointmentReminders.js`, the
confirmation email and the booking wizard all keep working untouched. `parsePreparation` reads a
stored sentence back into toggles — recognising BOTH bladder wordings, so editing either converges
it — and anything unrecognised is preserved verbatim in the free-text field rather than dropped.

**A visit is opened with its tests.** `[1.129.0]` `POST /visits` takes `testIds` / `packageIds`
and refuses a visit with neither (400): an empty walk-in reached the till with a ₱0 bill and no
department ever saw it. It may also take a new patient (`patient`), and then the record, the visit,
its ticket and its tests are ONE transaction (`visitService.registerVisit`), so no failure leaves a
record without its visit. A new record with the same name (case and spacing ignored) and birthdate
as one on file is 409 with `details.possibleDuplicate` unless `confirmNewPatient`; the Desk asks
"Use the record on file" or "No, register someone new". The last test on a visit cannot be
removed (409); an unpaid visit is temporary and goes on its own. A spec that needs "a visit" passes a test.
`[1.130.0]` One request does what three endpoints did, so it answers to all three permissions:
`visits:create` AND `tests:assign` on the route, and `patients:create` (in the service) when it
registers a new patient. Checking `visits:create` alone let an account given only "start visits"
on the grid register patients and attach tests; the Desk gates Start visit and Register Walk-In
the same way (`can.startVisit`, `can.registerPatient`).

**Unpaid is temporary; paid is final. Nothing is "Cancelled" or a "No Show".** `[1.131.0]`
Steven's rule: a booking is paid first, a walk-in pays for its tests to go ahead, and once paid
there are no takebacks; what is never paid was only ever temporary. So there is NO cancel and NO
no-show, anywhere: `PUT /appointments/:id/cancel` is gone (404), a booking's only manual status is
'Confirmed' (check-in), a visit's 'Cancelled' is refused (409) paid or not, `appointments:cancel`
is retired, and the Desk, the portal and Visit History offer and show neither. Instead
`jobs/unpaidExpiryScheduler.js` runs `unpaidExpiryService.removeExpired` every five minutes, which
DELETES (`visitRepository.removeVisits`, child to parent, uploaded files after the commit) every
unpaid visit whose time is up (`findExpiredUnpaid`): a walk-in after its day; a booking after its
day, staff and HMO bookings included (they take a slot without paying first, but the patient still
has to come); a patient's own booking once its time to pay lapses. Each leaves one Activity Log
line (`visit.removed_unpaid`, "System (unpaid, time up)") and a released booking emails its patient
(`sendBookingReleased`). Never anything waiting on someone (an HMO decision, an online proof to
check) and never anything that had a receipt. A PAID visit still with a department is on the Desk's
"From earlier days" table; a paid booking nobody came for is on "Paid bookings nobody came for",
to be moved. A booking whose time to pay ran out cannot be checked in (409, "start a walk-in
visit") and, moved by the patient first, gets a fresh time to pay (`restartLapsedHold`).
`unpaid-expiry.spec.js`; `e2eBackdateVisit.js` moves a fixture's visit to an earlier day.

**Appointment reminders are sent by the server itself.** `[1.130.0]` Steven: automatic, the day
before, and halfway to the appointment when it is booked later than that. `utils/reminderTiming.js`
(pure, unit-tested) decides: the evening before at 18:00 (preparation is acted on the night
before, not 24 hours before an 08:00 slot); otherwise halfway between the last email about the slot
(its booking, or its latest move: `COALESCE(rescheduled_at, created_at)`) and the appointment; never
within 30 minutes of that email (the confirmation is the reminder, so a booking 30 minutes away gets
none), never 21:00-07:00 (a night halfway point moves to 07:00), never under 30 minutes before.
`jobs/reminderScheduler.js` sweeps every minute through `reminderService.sweep`, which CLAIMS each
reminder (`claimReminder`) before sending, so two servers on one database send it once, and gives
a failed send back to retry after 10 minutes. Late is sent, not lost: a reminder due while the
server was off goes out at the next sweep, after 07:00, unless the appointment is under 15 minutes
away. It waits while outbound mail is unconfigured, and `APPOINTMENT_REMINDERS=off` stops it.
Appointment emails go to the account's address, else the address on the patient's record, so a
booking made at the desk reaches them too. `appointment-reminders.spec.js` checks the plan.

**A PAID visit is finished in both directions.** `[1.55.0]` Tests cannot be added to it and
cannot be removed from it. Removal would change a bill the patient holds a receipt for. ADDING was
worse and was a live revenue leak, measured: pay a ₱190 visit, attach another ₱190 test, and the
new row is created `Processing` — released straight to the department worklist because the visit
is paid. The bill does not move, and `POST /payments` then refuses with "already been paid", since
`uq_payments_one_paid_per_visit` allows one settled row per visit. The clinic performed the test
and had no way to charge for it. Both directions now 409 with the remedy named: start another visit.
`[1.123.0]` That remedy was unreachable until then: the Desk refused a second visit to anyone in
today's queue, paid or not. A PAID visit no longer blocks one ("Start another visit", own bill).
Re-opening billing was the wrong fix: a second settled payment per visit is exactly what that
unique index exists to prevent.

**There are no refunds: a paid receipt is final.** `[1.121.0]` Steven: a refund does not fit how
the clinic works. It let one person take money and hand it back with nobody else involved, a
reprinted refunded receipt still read as paid, and only a whole receipt could be reversed. The
route (`PATCH /payments/:id/status`), the `billing:refund` permission (in `setupRbac.js`'s
RETIRED), the button and its dialog are gone. Reversals recorded before then stay: the cash book
below still reports them, the receipt log still lists them, so a past day still reconciles. A
discount on a paid visit cannot change either. With no way back, the till's HMO warning tells the
cashier to wait for a pending decision rather than charge for a test the HMO may yet cover. Do
not reintroduce a reversal path.

**No void either, and the tests are confirmed before the money.** `[1.122.0]` Cancelling a PAID
visit or booking kept the money and gave nothing for it: a void by another name. Since `[1.131.0]`
nothing is cancelled at all (see "Unpaid is temporary" above); a paid booking is moved. Because a receipt is final, the tests are confirmed
first: the till's `PaymentConfirmDialog` lists them and waits for the cashier's tick that the
patient confirmed them, and the portal's `PayBookingPanel` shows the clinic's account only after
the patient ticks "These are the tests I want" (bookings carry `booked_tests`).
`final-tests.spec.js` holds both halves.

**What a final receipt rules out.** `[1.123.0]` Steven's whole-system review; each rule is in
`process-fixes.spec.js`.
- **No payment over a pending HMO decision.** `POST /payments` refuses while a test on the visit
  waits on its HMO, unless `withdrawPendingClaims` (the till's "charge in full and withdraw the
  claim" tick), which closes those lines in the same transaction (`withdrawPendingForVisit`).
  Approving a claim or a line on a paid visit is refused. Otherwise the patient paid and the
  insurer was billed for the same test.
- **No counter payment over an unchecked online proof.** The bill carries `pendingProof`, and the
  till sends the cashier to Online Payments: a second payment has nowhere to go and no refund.
  Verifying a proof passes `fromSubmissionId`, which is what lets that payment through.
- **A date override names who it leaves without a slot.** Closing a day, or new hours, returns
  `affectedBookings`, emails each patient (`sendScheduleChangeNotice`), and Clinic Schedule lists
  them for moving (`GET /schedule/overrides/:date/bookings`). A lower capacity moves nobody.
- **Archiving waits for open work** (`patientRepository.findOpenWork`): refused while the patient
  has a visit in progress, an unpaid walk-in today, or a booking from today on. Archived records
  leave the Desk's search, which hid patients from the people about to look for them.
- **A walk-in record joins the account its patient signs up with.** `PUT /patients/:id/link-account`
  (staff, `patients:update`, from the patient's file) by the sign-up email, after checking it with
  the patient; refused for a staff account or an already linked record, audited. It does not merge
  two records that already exist.
- **A Word or Excel report says, at upload, that the patient cannot get it online**: a digital
  copy must be marked, and an Office file cannot be.

**A rule a screen enforces, the service enforces too.** `[1.124.0]` A probe of all 142 routes found
the API accepting what every screen refused: a booking on a date the clinic closed, at 09:07, five
years out or with no tests; a receipt for a cancelled visit; an unpaid visit set Completed by hand;
a cancelled booking checked in; a patient born next month; a senior discount for an 11-year-old.
Each is now refused in its service (`process-rules.spec.js`; the list is in migrations.md). Three
shapes to keep:
- **A date's real hours are `resolveDay`** (appointmentService): the weekly pattern with that
  date's override over it. Availability, booking and rescheduling all ask it; booking used to read
  the pattern alone.
- **A Postgres refusal is the client's mistake, said in words.** `errors.normalizeError` maps
  22P02/22003/22007/22008/2201W/22001/23502/23514 to 400, 23503 to 404 (or 409 when still
  referenced) and 23505 to 409, with `CONSTRAINT_MESSAGES` naming each known constraint. Before it,
  ~1,400 malformed inputs were 500s quoting the database. A new CHECK or UNIQUE constraint gets a
  sentence there. An error's `details` reach the client on a 4xx (never a 5xx) `[1.129.0]`: that
  is how the Desk learns WHICH record a new patient may duplicate.
- **Status moves by hand are a short list.** `[1.131.0]` A visit: none (Processing keeps its
  release rule, for SuperAdmin/Admin); Pending, Completed and Cancelled belong to the process, and
  an unpaid one is removed when its time is up. A booking: check in, and nothing else. A booking
  checked in on another day is moved to today.

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

**Patient feedback is the clinic's paper form, asked once per finished visit.** `[1.112.0]` Four
questions answered MAAYO / OKAY LANG / DILI MAAYO (stored 3 / 2 / 1; the scale is fixed so months
compare), a comment, and an optional "don't show my name". Asked of a VISIT once its status is
'Completed' (its last result released), never per test, because one question is whether the result
came on time. Three ways the rules are held:
- **Two tables, with the form's own fields on the visit.** `feedback_questions` (wording in Cebuano,
  Tagalog and English as COLUMNS, since the language set is fixed) and `visit_feedback_answers`
  (visit × question). The comment, channel, language, typist and name switch are `patient_visits`
  columns, one form per visit. The name is never copied; `findForms` withholds it in SQL when hidden.
- **Two ways in.** The patient answers in the portal (Home → "How was your visit?", within 30 days),
  and reception types in a walk-in's paper form from Visit History (`feedback:record`, Receptionist
  and Admin), which `chk_visits_feedback_paper` requires to name its typist. Most patients have no
  account, so the paper path is what makes the overview describe the clinic.
- **An answered question keeps its wording** (409); turning it off is always allowed, and the
  overview keeps showing a turned-off question for periods that answered it. `feedback:manage`
  (Admin) writes and orders questions; the overview is `reports:view`, bucketed by VISIT date, and
  prints. The pure rules are `utils/feedback.js` (unit-tested); `feedback.spec.js` holds the rest.

**The patient portal has no notification bell — email is the only channel that reaches a patient.**
`[1.49.0]` `notifyRoles` writes to staff, who have a bell in `SidebarLayout`. A Client does not, so
an in-app notification addressed to one is a row nobody can ever see. Anything a patient must be
told goes through `appointmentEmailService`, which skips cleanly when SMTP is unconfigured; the
portal screen is where they look it up afterwards, not how they find out.

**PHI reads are audited; keep the scope narrow.** `auditService.logPhiRead` records reads of an *identified patient's* records (demographics, result history, report file). Do not add it to searches, worklists or queues — staff refresh those constantly, and the entries that matter would drown in traffic that is just people doing their job. That is the fan-out mistake that took `notification_reads` to 255,540 rows.

**A released result is `authorised_at IS NOT NULL`, never `released_at`.** `[1.108.0]` `[1.110.0]`
`released_at` defaults to `CURRENT_TIMESTAMP` when a result is SAVED, so `released_at IS NOT NULL`
is true of every draft. Patient Records' roster counted drafts as "released" that way for months.
The final record of a test is its latest AUTHORISED version (`findLatestAuthorisedByVisitTestId`,
`findReleasedResultsByPatientId`), which also keeps the report that went out readable while an
amendment is being written. The reports made the same mistake until `[1.110.0]`: throughput,
turnaround against target and staff workload counted drafts and timed every report from when it was
typed. They now count a test once, at its FIRST authorised version (`FIRST_RELEASE` in
`reportRepository`), so a correction weeks later is not read as weeks of turnaround.

**Patient Records shows the final record, and only to whoever may read results.** `[1.108.0]` Any
holder of `results:read` opens a patient's name and gets their authorised results, newest visit
first, each with View and Print (`GET /results/history/:id?released=true`; a department sees its
own). `[1.130.0]` The final record is every FINISHED test: a released report, or an X-ray marked
done (`result_id` null, `performed_at` set, "Result given by the X-Ray department", no buttons),
which had dropped out once X-ray stopped issuing reports. Nothing pending. The roster counts them
apart: `released_count` is still reports, `done_count` / `last_done_at` are X-rays done. The front desk and the till see who the patient is and when they were here; the roster sends
them no result columns (`patientRepository.findPatients({ includeResults })`), and the screen
shows no Results column. `[1.116.0]` Their name opens the patient's FILE instead
(`components/patients/PatientFile.jsx`): what else is on file, the FINISHED visits and how each test
ended `[1.130.0]` (`lib/testProgress.js`: Released <date>, Done <date> for an X-ray;
`patient-file-test` with `data-state`). A record is final, Steven's rule: a visit still open is not
listed, and one line (`patient-file-open`) says it exists and that the Desk shows where it stands.
And "Start a visit", which opens the Desk with the name in "Who's here?" (the `find` intent) rather
than creating a visit, because the Desk refuses a second visit to someone already in today's queue
("Find at the Desk" for them). A permission, not a role list, so granting `results:read`
to a cashier shows them results with no code change. **Printing and saving a report are logged**:
they happen in the browser on a copy already fetched, so `ResultDocument` reports each to
`POST /results/:visitTestId/copies` (`kind: print | download`) for staff, best-effort, before it
happens. With the file fetch ("Opened…"), the Activity Log says who opened, printed or saved which
report of which patient. A cancelled print dialog still counts; a browser cannot prove the page
came out.

**`test_results` is versioned — always filter on `is_current`.** A test carries one row per version of its report (an amendment supersedes rather than overwrites; see [1.15.0]). A `LEFT JOIN test_results` without `AND tr.is_current` repeats the parent row once per amendment and shows superseded findings beside live ones, and an `UPDATE … WHERE visit_test_id = $1` without it rewrites the history. `findVersionHistoryByVisitTestId` is the only intentional reader of superseded rows.

**Never filter on `column::date`.** A B-tree index cannot serve a predicate on an expression, so `WHERE created_at::date = CURRENT_DATE` silently forces a sequential scan no matter what is indexed — `idx_patient_visits_created` existed for a year and was never used. Write half-open ranges on the raw column instead: `col >= $1::date AND col < ($2::date + 1)`. Measured at 219k rows: 50.7ms seq scan vs 0.84ms index scan. Casting in `SELECT`/`GROUP BY` is fine; only the filter matters.

**An HMO claim is a RECEIVABLE, and must never be added to takings.** `[1.51.0]` Every other
money figure in this app comes from `payments`; an approved HMO claim never reaches that table —
the insurer is billed and pays later, outside this system. `GET /reports/hmo-claims` reports
`approved` / `pending` / `refused` beside `collected` and never nets or sums them, because folding
approved into revenue reports the same peso twice, once as a claim and once as cash. The response
carries its own `note` saying so, so the caveat survives being copied into a summary.

Two things decide a claim, independently, and BOTH decide the money: `hmo_requests.status` (set by
approve/reject) and `hmo_request_tests.approval_status` (set per test). An HMO routinely clears a
claim while refusing one line on it, so neither column alone is the answer — reading only the
per-test column reported an approved claim as ₱0 approved with its full value still Pending.
A refusal at either level wins, matching the partial unique index on that table; otherwise an
approval at either level covers the test. `[1.125.0]` That is ONE rule,
`constants/hmoEffectiveStatus.js`, read by the bill, the worklist and the report alike: the bill
read only the test's own column, so after an Admin approved a whole claim the till still saw every
test Pending and refused to take payment (before [1.123.0], it charged the patient in full).
The Departments report's sales by service reads it too: a covered test is gross with no takings, so
the breakdown sums to the cash collected (`operations-report.spec.js` holds the reconciliation).
Bucketed by the VISIT date, so a claim decided three weeks later never moves money out of a period already
reported — the closed-day restatement [1.30.0] exists to prevent, arriving by another door.
`[1.127.0]` The report also breaks the claims down BY TEST (`tests` in the response, a section on
screen, in print and in both exports). Both queries read one `CLAIM_LINES` CTE body in
`reportRepository`, so a provider's tests always add up to its row; never give either query its
own copy of the claim lines.

**A report exports as Excel via `?format=xlsx`** `[1.119.0]`, which is what the Reports tabs' "Export
Excel" downloads: `utils/xlsxWriter.js` (no dependency) + `utils/reportXlsx.js`, laid out like the
printed report, money a NUMBER in a peso format, totals as SUM formulas. CSV below is still served.

**A report exports as CSV via `?format=csv`, and money in it is a NUMBER.** `[1.62.0]` All five
report endpoints serve the same figures as a file through `utils/csvExport.js` +
`utils/reportCsv.js`. Three rules, each of which was the obvious thing done the other way round:

- **Never `formatCurrency` in a CSV cell.** `₱1,450.00` is TEXT to Excel — the separator and the
  symbol both disqualify it as a number — so the column cannot be summed, which is the whole
  reason somebody exported rather than printing. Write `1450.00` and put the unit in the header
  (`Collected (PHP)`). This is the one place that deliberately does not use `formatCurrency`.
- **The file opens with a UTF-8 BOM** (`\uFEFF`, written as an escape — a literal one is invisible
  and one lint rule away from vanishing). Without it Excel on Windows reads the file as the system
  codepage and every `ñ` and `₱` is mojibake. `charset=utf-8` in the header never reaches Excel;
  the file is opened from disk.
- **A NULL money value is an EMPTY cell, not `0.00`.** `Number(null)` is 0 and passes
  `isFinite`, so the naive formatter states the clinic collected nothing rather than that nothing
  is recorded.

The format decision happens in the controller AFTER the service returns, so an export can never
see figures the JSON could not — the operations report's per-slice permission gating applies
unchanged, and a laboratory account's export omits Takings rather than zeroing it. Validation
throws before any header is written, because a response that has begun as a download cannot become
an error page. `Content-Disposition` must stay in `app.js`'s CORS `exposedHeaders` or the browser
cannot read the filename.

**An OCR read is a suggestion and must never write.** `[1.62.0]` `receiptOcrService` has no write
in it, by design. [1.48.0] already ruled that the amount a patient CLAIMS is evidence and never
the amount charged; a machine reading of that claim is weaker still. It pre-fills only a field the
patient left EMPTY, and its duplicate warning does not block — a patient correcting a rejected
submission legitimately re-sends the same reference. The scan uses `memoryStorage` and persists
nothing: most scans are abandoned, and a disk-backed scan would orphan a file per attempt,
indistinguishable from a real proof and safe for nothing to delete.

**A queue estimate multiplies a service RATE, never a wait.** `[1.62.0]` `getReceptionThroughput`
publishes a median WAIT of 36–96 minutes; multiplying that by patients-ahead tells the fourth
person in line they have four hours, because a wait already contains the queue. The multiplier is
the interval between consecutive patients being SERVED (`getMedianServiceMinutes` — `LAG` per day,
gaps bounded 0.5–60 min so an idle desk is not read as a slow one). Below 10 samples it falls back
to a stated default and says so in `estimate_basis`. `patients_ahead` counts only *Pending*
predecessors, and a non-Pending visit gets `null` rather than 0 — zero reads as "no wait", which
is a claim rather than an absence. Both the staff queue and the patient's booking pass go through
`queueEstimateService`, so the two screens cannot disagree.

**A second query must never publish a different number under an existing column's name.**
`[1.62.0]` `getDepartmentTurnaroundPerformance` reports `median_turnaround_minutes` on exactly the
basis `getDiagnosticThroughput` uses (payment → release) and verified equal to it, and names the
registration → release span `median_total_minutes` instead. Two screens sitting beside each other
disagreeing about "median turnaround" is the [1.32.0] divergence arriving by another door.

**Chart colours are validated, not chosen.** `[1.62.0]` `components/charts/chartTheme.js` holds the
pair and the evidence: `#53843b`/`#0a71a9` pass every check on both theme surfaces (ΔE 18.7 protan,
19.2 normal). Lightening them for dark mode — the instinct — was tested and FAILS at ΔE 13.6, below
the normal-vision floor. Same steps in both themes. Tritan separation is 5.2, so every chart using
the pair also carries a legend and names both series in its tooltip; colour is never the only
encoding. Median and p90 share one hue at two lightnesses because they are one distribution.

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
that quietly does not run reads exactly like one that passed. Use `tests/e2e/helpers/dates.js`
(`nthWorkingDay` / `nextWorkingDay` / `dateStr`, all built from local getters). Watch the skip
count, not just the pass count.

**And count working days rather than offsetting into them.** `[1.60.0]` The obvious helper —
"today + N, then push off a weekend" — was written four times in this suite and has now failed
twice, for two different reasons. First the SATURDAY case: the clinic opens 08:00-17:00 on
weekdays but only 08:00-12:00 on Saturday, 18 slots against 8, so a helper that skipped Sunday
alone silently gave a spec less than half the capacity it expected. Fixing that by skipping
Saturday too introduced the COLLAPSE case: when today+150 lands on a Sunday it pushes to Monday,
and today+151 *is* that Monday. Two constants meant to be different days became one, so "move this
booking to another day" became "move it to the slot it already holds" and four reschedule tests
failed on a correct 409. Measured on 2026-08-27: `DAY_A` and `DAY_B` both resolved to 2027-01-25.
`nthWorkingDay(n)` and `nthWorkingDay(n + 1)` are different days on every calendar, which is the
property those specs were assuming all along and never actually had. Both failures share a shape
worth naming: nothing in the application had changed, the calendar had.

**Dates: never use `toISOString()` for "today".** It returns the **UTC** date, which in Philippine time (UTC+8) is *yesterday* between midnight and 08:00 — silently, with no error. Postgres `CURRENT_DATE` is the server's local date, so the two disagree every morning. Frontend code uses `frontend/src/lib/date.js` (`todayStr` / `daysAgoStr`, built from local getters); backend code derives date strings **in SQL** rather than in JavaScript. This bug shipped twice: in four dashboard `todayStr` helpers, and in the receipt-number generator.

**A booking joins the queue when the patient checks in.** `[1.92.0]` Steven's pick. A booking
used to join on the day it was MADE, with that day's ticket, so next week's bookings sat in today's
queue and at the till, and a booking made last week never reached the queue on its own day.
`appointmentService.updateStatus` ('Confirmed') now stamps the visit with the moment of check-in
and gives it today's next ticket, in one transaction with the status; only the FIRST check-in
moves it. Until then a booking has a reference and no ticket (`queue_number` NULL), and the pass,
the confirmation and the emails say the number is given at the desk. Who is in today's queue is
ONE rule, `constants/queueMembership.js` `inTodaysQueue`: the Desk and the till
(`findActiveVisits`), the public count and the patient's own "people ahead" all read it, and a new
reader of the queue must too. When a booking was made stays in `appointments.created_at`; for a
booking, `patient_visits.created_at` now means arrival, so a wait measured from it leaves out a
visit paid before it arrived (a booking paid from home). `booking-queue.spec.js` holds all of it.

**Numbers that must be unique** (queue tickets, receipt numbers) come from `daily_counters` via `INSERT … ON CONFLICT DO UPDATE … RETURNING`, never from `SELECT COUNT(*) + 1`. Counting rows is not a sequence: it races under concurrency, and it rewinds when a row is cancelled or refunded, reissuing a number already handed to a patient. Unique indexes back all three invariants. Core flow through the tables:

`users` → `patients` (1:N via `user_id` — one account owns several profiles, e.g. a parent booking for dependents; `GET /patients/my-profiles` is plural for this reason, and ownership checks must compare per-patient rather than resolving a user to a single patient) → `patient_visits` (a clinic visit/queue entry) → `visit_tests` (tests attached to a visit, priced via `price_at_time`) → `test_results` (findings/file per visit_test, released by staff) and `payments` (billed against a visit). `appointments` link to a `patient_visit`. `hmo_requests` link a visit to an `hmo_providers` approval flow. `tests` belong to a `test_categories` row (Laboratory/Xray/Ultrasound, plus the retired 2D Echo/ECG that only history uses) and have an `is_active` flag that controls public visibility.

**Reports has four tabs, one per question.** `[1.111.0]` Departments (what each part of the clinic
did), Trends (money and volume over time, and arrivals by hour), HMO Claims (what the insurers owe)
and Staff Workload (who did how much). Today, Access Matrix and Analytics were removed because each
repeated another screen: the Today screen, "Who sees what", and Departments plus Trends.
`GET /reports/analytics` stays — the Today screen reads its turnaround and arrivals — but lost the
previous-period revenue overlay only the Analytics tab drew. Add a report where it answers a question
no tab answers yet; a second view of a figure another tab already shows is how there were seven.

**The Activity Log leaves out migration archives.** `[1.111.0]` A migration that drops data writes
what it held into `audit_log` first (`result.measurements_archived`, `clinic.signatory_archived`,
`result.critical_flag_retired`: `ARCHIVE_ACTIONS` in `auditRepository`). Those are records, not
activity, and one removal wrote 33 of them over a morning's refunds and corrections. The feed hides
them unless "Show archived records" is ticked (`GET /admin/activity?archives=true`); they are never
deleted, because on the clinic's database they are the only remaining copy. A new archive action
belongs in that list.

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
| `page-header.jsx` | opens every screen — eyebrow, title, one-sentence description, actions. `variant="hero"` is the dark treatment, and nothing uses it since the portal moved to its own `PortalBand` `[1.81.0]` (Today uses the light header) |
| `panel.jsx` | the section container (`Panel` / `PanelHeader` / `PanelBody` / `PanelFooter`). `<PanelBody flush>` for a table or divided list |
| `toolbar.jsx` | the filter row above a worklist. `attached` joins it to the panel below; also exports `SegmentedFilter` and `ToolbarField` |
| `empty-state.jsx` | what a screen shows when there is nothing. `tone="error"` looks *deliberately* unlike empty — a failed request and a quiet morning must never be confusable |
| `.field-label` / `.alert` | two component classes in `index.css`, for the form label and the inline alert. Leaf elements, so a class is the right unit |
| `button.jsx` | `<Button loading>` for anything in flight — spinner, disable and `aria-busy`, and the **label stays put**. Never swap it for "Saving…": on `ConfirmDialog` that erased which of a refund, a cancellation or a release the person had just agreed to. `[1.39.0]` |
| `date-field.jsx` / `calendar.jsx` | every date input. Keeps the native `<input type="date">` and replaces only the picker, so ISO values, `min`/`max`, `required` and the phone's OS picker all still work. Where the browser's glyph cannot be hidden — Firefox, measured, no CSS exists — it renders nothing custom rather than showing a second icon. `RANGE_PRESETS` for filters, `BIRTHDATE_YEAR_RANGE` for birthdates. See migrations.md [1.34.0] |
| `date-time.jsx` | a date and a time that wraps only BETWEEN the two, never before "PM" (`formatDateTimeParts`). Use it wherever a table shows `formatDateTime`. `[1.130.0]` |
| `sheet.jsx` | a panel that slides in from the right, over the screen it belongs to. The same Radix dialog as `dialog.jsx` (focus trap, Escape, the date-popover rule), full height. For work that must not take someone off the list they are watching: the Desk's walk-in registration. `[1.75.0]` |

- **Printing an element uses `lib/printArea.js`, never a print stylesheet alone.** `[1.52.0]` The
receipt printed the clinic name and then a blank sheet, and nothing in the suite could see it —
every on-screen assertion was true, because the defect lived entirely in `@media print`, which no
test had ever evaluated.

Measured, the receipt was laid out inside the DIALOG rather than on the page: `position: fixed`
(a fixed element is a containing block, so `.print-area { top: 0 }` resolved against the dialog),
`max-height: 648px` and `overflow-y: auto` clipping a 644px receipt into a box measuring 56px.
Undoing those moved it to top:720 — off the first sheet — because `visibility: hidden` KEEPS
layout, so the whole app still occupied the page and the receipt queued up after it.

`printElement()` copies the node to a child of `<body>`, `display: none`s every sibling, prints,
and tears the copy down in a `finally`. A COPY, because relocating a live node is a mutation React
did not perform. `display`, not `visibility`, because only `display` removes the layout.
`receipt-print.spec.js` evaluates the print stylesheet — the only way any of this is visible —
and asserts top === 0, zero other visible body children, and that the text reaches the FOOTER
rather than stopping at the letterhead.

**A receipt has an ADDRESS: `?receipt=RCT-…`.** `[1.52.0]` The printable document lived only in
a dialog inside the cashier's console, reachable only from the day's transaction list — so "send me
a copy of RCT-…", asked weeks later, had no answer. `pages/ReceiptView.jsx` renders the SAME
`components/Receipt.jsx` at its own URL, openable in a new tab from the cashier log, from Cashier
Monitoring (Admin/SuperAdmin), and from the patient's own booking pass. Not a PDF and not a second
rendering path — the browser prints it at 80mm through the same `printing-receipt` body class.

The second deep link in the app, after the old `?reset_token=` (retired in [1.73.0]); this app has no router by design. Only
the receipt NUMBER travels in the URL — the session comes from localStorage, already shared across
tabs of the same origin. A link carrying a token ends up in history, a chat message and a screenshot.

`GET /payments/receipt/:receiptNumber` authorizes in the SERVICE, not in route middleware, because
the two callers need different questions answered: staff on `billing:read`, a Client on OWNERSHIP.
A patient printing the receipt for money they paid is what a receipt is for — an HMO or an employer
asks them to produce it. Verified: own receipt 200, another patient's 403, technician 403.

**The booking pass carries the receipt but the QR does NOT encode it.** The QR holds the appointment
reference alone, because ReceptionistDashboard's scanner hands whatever it decodes straight to
`GET /appointments/verify/:ref`. Packing a second value in would not give the patient more — it
would stop check-in working. The pass shows both: the code the desk scans, and the receipt number
with a link to the printable document.

**The printed receipt is `components/Receipt.jsx`**, and the clinic's own identity is
  `lib/clinic.js`. Two rules. First, anything inside `.print-area` prints, including a toolbar
  that happens to be nested there — the old receipt's Print button printed itself; mark chrome
  `no-print`. Second, `lib/clinic.js` leaves `tin` / `businessPermit` blank unless configured
  (`VITE_CLINIC_TIN`), and the receipt then says it is *not* a BIR-registered Official Receipt.
  Do not invent those numbers to make it look official — a patient may file it for reimbursement.
- **A report prints as a document, not as its screen.** `[1.117.0]` Every Reports tab and Patient
  Feedback print `components/reports/ReportDocument.jsx`: letterhead, title, period, generated
  at/by, numbered sections of plain tables with totals, a Prepared by / Noted by block (Noted by
  is `clinic.reportNotedBy`, Jesie B. Enlogada, Proprietor `[1.118.0]`), and a footer on every
  page naming the clinic, the report, its period and "Confidential", with "Page N of M". Each report
  fits one A4 page `[1.119.0]`: narrow tables print two to a row (`ReportColumns`), and the
  signatures are kept with the last section so no sheet is only signatures. Departments is takings
  and sales by service only; front desk and turnaround live on Visit History and Today. One print component per report in `ReportPrints.jsx`, fed the figures the tab already
  holds and the range they were fetched FOR. Tables, not charts, on paper (printers are often black
  and white). Print with `lib/reportPrint.js` `printReport`, which selects `@page document` (A4);
  `.report-doc` styles are in points, the one place a size is not rem. A new report gets a print
  component here, never a print of its screen. `report-print.spec.js` checks each under print media.
- **A counter that could not load reads "—", never 0.** `[1.74.0]` Every landing screen opens
  with a strip of counts whose state starts at zero, and a failed fetch left them there: the till
  said "Collected Today ₱0.00", a worklist "Awaiting Exam 0" over a full bench. A figure is
  a claim about the clinic. When its fetch failed, the figure reads `—` and the list beneath says
  why, ONCE, with the one Try again — a banner above it as well, or a caption on every tile, is
  the same fact said twice. Only a figure with no list of its own carries its own caption. The
  panels in `OperationsPanels.jsx` take `error` /
  `onRetry` for the same reason; where two share one request, show the failure on one. Keep one
  error per fetch: the billing queue's two fetches shared one, and whichever succeeded cleared the
  other's failure.
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
- **The front desk works from one Desk.** `[1.75.0]` Steven's pick (F1) from the gallery replaced
  Active Queue, Walk-In Registration and Appointment Check-In with one screen (`reception-queue`,
  "Desk" in the sidebar and as the h1 — not "Front Desk", which is the group a phone's top bar
  shows by itself, right above the heading). `WhoIsHereBox` takes a name, queue number,
  reference or scan: today's bookings (Check in → the old card), records on file (Start visit →
  the old confirmation), and it drives the queue's search. It never offers Start visit to someone
  with an UNPAID visit in today's queue; a paid one gets "Start another visit" `[1.123.0]`. Both
  ask what the visit is for, and Confirm Check-In waits for a test `[1.129.0]`. It
  waits for the queue to answer for the same name before showing records
  (`useReceptionQueue.appliedSearch`), and the queue matches a full name, not only either half. Registration is a `Sheet`
  titled "Walk-In Registration" holding the unchanged form (`#wi-*`, "Register Walk-In & Issue Queue
  Ticket"). Test contracts: the nav button "Desk", the searchbox named "Who's here?", the header
  button "Register Walk-In", `data-testid="desk-match"` and `"booking-card"`.
  `[1.130.0]` Below the queue, two tables in its style: **Still to arrive today** (`ArrivalsPanel`,
  `arrivals` / `arrival-row`: time, patient and reference, category, booked tests, paid, Check in,
  which opens the card in the box and scrolls to it), which replaced a row of name buttons in the
  box; and **From earlier days, still with a department** (`CarriedOverPanel`, `carried-over` /
  `carried-over-row`, `GET /visits/carried-over`), shown only when there is any. Today's queue is
  today's, so a visit paid yesterday and still being done was on no Desk screen at all. A Cashier gets no box,
  and keeps the queue's own "Search patient name or Queue #..." field. The till (C3) is headed
  "Billing Queue", and its collections are one line whose first label is "Collected Today".
- `SidebarLayout.jsx` is the shared shell for staff/admin consoles. Its nav column scrolls
  independently and its department groups collapse (remembered in `localStorage`, but the group
  holding the current screen always opens). The top bar is a **breadcrumb**, not a second page
  title — the screen's own `PageHeader` carries the heading, so don't add a title to both.
- **One shell for the whole staff session.** `[1.128.0]` Steven: clicking the sidebar "reload like
  move". Every console drew its own `SidebarLayout`, so moving between consoles rebuilt the shell:
  the rail's scroll jumped to the top, the counts vanished and came back, the page slid up. App now
  mounts `StaffShellHost` once (lazy, `components/StaffShellHost.jsx`) around whichever console is
  open, My Account included; a console's `<SidebarLayout railActions>` is only a SLOT under it (its
  content keyed on the screen, its rail actions portalled into the rail). Rules that keep it smooth:
  - A new staff screen renders inside the host, through App's `screen` map. Never key the host's
    content on the screen: that rebuilds the whole console (the Desk's and the till's state) on
    every click between its own screens. The slot keys the console's content instead.
  - A screen opens at its top (`main` is reset on `activeNav`) and fades in by opacity only
    (`animate-screen-in`; the portal tabs too). `animate-fade-in` rises 6px and is for popovers.
  - A click in the rail records where the list sits and puts it back once the next screen is
    in place, so a rail action appearing above the list never moves the item under the mouse.
  - **Never declare a component inside another component's render.** It is a new type on every
    render, so React replaces it each time: the rail's `NavButton` lost hover and focus mid-click
    on every minute tick and count refresh. Declare it at module level and pass what it needs.
  `smooth-navigation.spec.js` holds the rail (same element across consoles, the clicked item does
  not move, a screen opens at its top, rail actions come and go with their console).
- **The rail earns its space.** `[1.76.0]` This is the "Useful" rail Steven chose.
  - **Clinic status:** from `lib/clinicStatus.js`, which reads `GET /schedule/public` and its date
    overrides. A failed read shows nothing, never "Closed".
  - **The screen's own most-used action:** passed as the `railActions` prop and shown in the
    desktop rail only. The screen keeps an `lg:hidden` copy for phones, so the action is on screen
    once at every width.
  - **A count beside each screen**, from `useNavCounts`:
    - It must be the SAME number the screen shows, computed the same way. The Billing Queue badge
      applies the till's paid-today rule, through the till's own function (`lib/collections.js`
      `paidVisitIds`, shared with Today since `[1.77.0]`).
    - It is `aria-hidden`, so every nav button's accessible name stays exactly its label.
    - When it fails to load, it is left out rather than shown as 0.
    - None while Today is open `[1.83.0]`. Its "Needs you now" already states each number beside
      the button that deals with it, and the rail would say it twice. Every other screen keeps them.
  - **Patient Records** sits in the person's own group unless they manage the clinic.
    `data-nav-group` marks each group.
  - **Log out stays in the top bar**, and the name card opens My Account.
  - **No Today summary in the rail:** Today is a screen `[1.77.0]`, and a summary here would repeat it.
- **Every member of staff lands on Today.** `[1.77.0]` Steven's "A and B" from the decisions page.
  `TODAY_ITEM` is first in every staff sidebar (above the groups, in none of them), and
  `landingNavForRoles` sends sign-in there. Admin's Dashboard became Admin's Today, and the
  `dashboard` id is gone. `defaultNavForRoles` still means "my work".
  - **Sections follow what the person already holds.** `homeNavIds` (the departmental screens that
    are theirs, not borrowed) decides front desk, till and each department; `reports:view` decides
    the clinic's. Every read is an endpoint their own screens already call, on the same permission,
    so Today widens nothing.
  - **One "Needs you now"**, however many sections, built from descriptors in `lib/today.js` (pure,
    unit-tested). Each row has the one button that deals with it. A button that opens another screen
    passes an INTENT, `onSelectNav(id, intent)`: the Desk takes `verify` (that booking's card),
    `find` and `editTests` (that visit's tests); a department's History takes `delivery` (nothing on
    Today sends it since `[1.113.0]`). App clears
    it on the next navigation, and the screen acts on it once.
  - **A fact appears once.** A need is never also a figure; a booking is on the bookings list only.
    There is no "Open the X" in the header: the empty list offers it, and a row carries it otherwise.
  - **One Refresh.** `useTodayReads` settles each read on its own, so a failed one reads "—" or says
    "Couldn't load …" where it would have been, and "Needs you now" names what it could not check.
    No Try again beside each: they would all do what Refresh does.
  - **Money comes from the summary**, never the receipt list, so "yesterday" is the whole of
    yesterday rather than "yesterday by now".
  - **Test contracts:** `data-testid="today-needs"`, each row `today-need` with `data-need`
    (`no-tests-<visitId>`, `till`, `online`, `worklist-<Category>`,
    `hmo-decisions`, `failed`), plus `today-booking`, `today-takings`,
    `today-departments`. A spec about any other screen opens it first: `helpers/auth.js`
    `openScreen` / `signInTo`.
- **SuperAdmin assigns access on "Who sees what".** `[1.78.0]` This is Steven's picture from the
  decisions page, made editable (`components/admin/WhoSeesWhat.jsx`, rules in
  `lib/whoSeesWhat.js`): a row per kind of information, a column per kind of staff, and a mark and
  a sentence in every cell. The sentence is COMPUTED from the switches under it, so the words
  cannot drift from what the server enforces.
  - Every permission has a row; one the rows do not name lands in "Other". Each label starts with a
    verb, because it also finishes "Front desk can now …" in the list of unsaved changes.
  - The three departments share a column that moves them together, and it says "(differs by
    department)" when they do not match. "Each department" splits it into three.
  - Nothing saves until Save. The footer states each change in words, and warns when a permission
    would be left to SuperAdmin alone. Save sends only the changed roles, through the old endpoint.
  - It also warns when a switch is on without what its endpoint needs as well (`NEEDS` in
    `lib/whoSeesWhat.js`, `data-testid="who-needs"`) `[1.130.0]`: "start a visit" needs "add tests",
    because a visit is opened with them. Add an entry when an endpoint starts asking for two.
  - `rbac:manage` is shown and locked. **One person**, the per-account exceptions, is unchanged.
  - Test contracts: `data-testid="who-sees-what"`; `who-row` with `data-area`; `who-cell` with
    `data-column` and `data-mark`; `who-permission` with `data-permission`; `who-changes`. Each
    switch is a checkbox (a department column can be mixed) named "<column>: <permission label>".
- **A screen is called what its sidebar calls it.** `[1.79.0]` The heading (`PageHeader` title),
  the breadcrumb and the sidebar item are the same words. The breadcrumb reads the label from
  `config/navigation.js` (`findNavItem(activeNav).label`), and so does the diagnostic console's
  heading; the other consoles' headings are written to match. A screen that needs to say more says
  it in the description, not in a longer title. `screen-names.spec.js` checks every role's screens.
- **A department's worklist is one row per patient.** `[1.115.0]` A visit with several tests is
  one row whose NAME is the dropdown (`aria-expanded`), with its tests underneath; a visit with one
  test stays an ordinary row, which is what every worklist spec drives. Grouped by visit (one queue
  ticket), paged by patient, and the footer counts both ("2 patients · 5 tests") because the
  sidebar badge counts tests. Rules in `lib/worklistGroups.js`. Test contracts:
  `data-testid="worklist-group"` and `"worklist-group-test"`. On a phone a sub-row is
  `tr[data-subrow="true"]`, indented under its patient's card.
- **A queue ticket is always `<DataBadge variant="queue">`.** `[1.79.0]` The Desk's queue, the
  diagnostic worklist and history, Visit History and the booking card all draw it that way. Four
  hand-drawn versions had drifted apart, one in a grey that failed AA.
- **A count is said once, and a screen has one Refresh.** `[1.79.0]` A paged list's count lives in
  its `Pagination` footer (pass `total` and `pageSize`: "12 total", or "Showing 1–15 of 66"), so the
  header and toolbar do not repeat it — Service Requests read "1 request" above the list and "1 total"
  below it. The one exception is the Desk queue, whose toolbar count shows only while a filter is
  narrowing it. A panel on a screen whose `RefreshButton` already reloads it gets none of its own,
  and a page heading carries no eyebrow that renames the sidebar group it sits in.
- **A list that grows with the clinic pages at the server.** `[1.128.0]` Patient Records, Visit
  History, Transaction History, Service Requests, Appointments and the Activity Log always did;
  a department's History (`/results/released/:category?page=`, with `total` and a server search)
  and Cashier Monitoring (`?page=&limit=&byCashier=true`, its per-cashier figures in the
  `summary`) do now. Each had fetched more than it showed and paged it in the browser, and History
  silently stopped at 200 reports. Paging in the browser is fine only for a list bounded by
  something else: today's queue, a catalogue, one patient's own records (the portal's Results,
  Appointments and Payments), or a capped report (Patient Feedback's forms). A money figure never
  comes from the rows on a page. `server-paging.spec.js` holds both.
- **The patient portal is layout A2, in the Flat colouring.** `[1.81.0]` Steven's pick from the
  gallery.
  - **The shell:** `components/portal/PortalLayout` holds a solid header pill (`PortalHeader`: the
    logo, the tabs on a screen 1280 px and wider, the "Viewing" patient chip, the account menu),
    which spreads into a full-width bar once the page scrolls `[1.91.0]`, and
    ONE list of tabs. It sits in the header when the screen is wide and in a bar fixed to the bottom
    otherwise, never both, so each tab name is on the page once. 1280, not 1024, because a media
    query ignores the reader's text size, and at 1024 with Larger text the pill overflowed.
  - **Each tab** opens with a `PortalBand` (solid `bg-rail`, rail ink only), then the one Refresh,
    then its content. Home's four tiles straddle the band. Flat means the public site's Aurora layer
    stays off the portal: no gradient text, glow, glass or mesh.
  - **App holds the tab** (`portalTab`), so My Account and back returns to it.
  - **The tabs are plain `Panel`s** `[1.82.0]`, and the band is the only dark block on a screen. A
    patient profile is added or corrected in ONE form, `ProfileFormDialog` (`mode="add"` or
    `"edit"`), whose ids carry the mode; it replaced two copies of the same eight fields.
  - **Home's figures** come from the tabs' own hooks through `lib/portalSummary.js` (pure,
    unit-tested). A fact is said once: a released result is in "Latest results" and not also in
    "Needs your attention", which holds only things to do.
  - **Test contracts:** the tab names in `helpers/portal.js` and `portalTabs.js`; `portal-tile` with
    `data-tile`; `portal-need` with `data-need` (`pay-<id>`, `prepare-<id>`, `bookings-failed`,
    `no-profile`); `portal-tab-bar`; the "Account menu" button and `account-menu`; the chip's name
    "Active patient profile"; "Back to the portal".
- **A portal spec names a tab by what it is.** `[1.80.0]` `tests/e2e/helpers/portal.js` holds the
  patient portal's tab names (`PORTAL_TABS`), `openPortalTab(page, 'appointments')` and
  `openBooking(page)`. Nine specs clicked a tab or "Book Schedule" by its words, and the portal's
  redesign renames three of them; a spec that spells a tab's name itself is the one a rename misses.
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
runs, sitting in the front desk's queue and patient search, so `E2E Pkg1786480428` means anyone who opens
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
  panels, the public site's `.aurora` and the navy banners do not flip, so `text-slate-300`
  on them inverts to dark-on-dark. Use `text-rail-ink-*` and `border-rail-line`. This has now been
  found four separate times; it is the single most repeated dark-mode mistake in this codebase.
- **The public site has a colouring layer of its own: Aurora (option A1).** `[1.72.0]` Steven kept
  today's palette and chose to have it applied with more depth — a mesh-gradient hero (`.aurora`),
  gradient headline text (`.text-gradient-aurora`), a frosted header (`.glass-pill`; a pill only at
  the top of a page, spreading into a plain full-width bar once it scrolls `[1.88.0]`), gradient card
  edges (`.edge-gradient`), a tinted page ground (`.wash-aurora`) and a gradient call to action
  (`<Button variant="brand">`: `bg-gradient-brand` + `shadow-glow`). None of it adds a hue.
  **Every piece is measured, not trusted:** `checkContrast.js` reads the `.aurora` and `.glass-pill`
  rules out of index.css and measures each ink on the base AND on every glow at its brightest, and
  the header's ink on the glass composited over each of those. That is how the header opacity that
  looked best, 0.74, was caught at 4.24:1; it is 0.88. `shadow-glow` is the one exception to
  "shadow means this floats" — the public call to action only, never a console, never a panel.
- **Every header floats at the top of a page and spreads into a full-width bar once it scrolls.**
  `[1.91.0]` Steven's rule, after [1.88.0] did it on the public site and the portal kept its pill.
  `PublicHeader` and `PortalHeader` each do it with `useScrolled(12)`, moving the header's padding
  into the bar so nothing inside it moves; the staff consoles' top bar (`SidebarLayout`) is a
  full-width bar already. The bar carries `data-testid="header-bar"`, and `helpers/header.js`
  holds both headers to it. A new header does the same. Full width ends at the scrollbar: `html`
  has `scrollbar-gutter: stable`, so the page is 1270 px on a 1280 px viewport, and a check that
  compares with `clientWidth` fails a header that is right.
- **Scroll-reveal is CSS, driven by `components/public/Reveal.jsx`.** `[1.72.0]` `variant` picks the
  motion (fade-up, slide-left, slide-right, rise — timings measured from the reference site) and
  `index` staggers a group by 180ms. Reduced motion makes it instant, including the DELAY, which the
  blanket reduced-motion rule does not reset; print shows everything. Never put a hover transform on
  the Reveal element itself — it owns `transition`, so the hover would move at the reveal's pace
  after the reveal's delay. Put it on a child, as `FeatureCard` does.
- **A public page is assembled from `components/public/`, not copied from another.** `[1.72.0]`
  `PageHero` opens every inner page (pass `overlay` to `PublicHeader`; its top padding clears the
  floating header), `CtaBand` closes Home, Services and About, `LegalDocument` lays out Privacy and
  Terms, `ClinicHours` is the one live opening-hours list (FAQ and About), and `ClinicShowcase`
  puts one of the clinic's own photographs on the offset panel `[1.84.0]`, falling back to the
  logo card when given none. The photos live in `src/assets/clinic/` as WebP, and the hero's
  slides are the sign and two of the rooms. Contact details come from `useClinic()` and never
  from a string in the page — About's typed-in address is the bug that rule came from, and
  `public-site.spec.js` now compares it with the footer's.
- **Sign In is the front of one card; Create Account and Forgot Password are its back.** `[1.72.0]`
  `[1.73.0]` Steps inside a side (details, then the emailed code) replace one another, so they never
  add a second form. `AuthPage` turns the
  card over (850ms) and mounts BOTH sides only for the length of the turn; the side turning away is
  `inert`, and it unmounts the moment the turn ends. That is load-bearing: `helpers/auth.js` fills
  `input[type="password"]` and clicks `button[type="submit"]`, so a second form left in the
  document is a second match for every sign-in in the suite. App renders `AuthPage` without a `key`
  so the header's Sign In / Create Account turn the card instead of rebuilding the page. The submit
  is named exactly "Sign In" and must stay the LAST button with that name (`failure-states`,
  `mobile-patient`); the card's own way back reads "Sign in instead". The new-password meter
  (`lib/passwordStrength.js`) may advise, but the only rule it states is the server's minimum, and
  its unit test reads `backend/src/validations/passwordPolicy.js` so the two cannot drift.

- **The clinic does not call panic values back, and the system no longer pretends to.** `[1.98.0]`
  Steven: deciding that a figure is an emergency and telephoning somebody about it is not work this
  clinic performs or answers for — the reference range is printed beside the figure on its own
  forms, and the report goes to the doctor who requested the test. The flag, the outstanding list,
  the recorded callback, the `results:acknowledge_critical` permission and the four `test_results`
  columns are gone; each flag was copied into `audit_log` first. Abnormal-value HIGHLIGHTING stays
  (`lib/abnormalValues.js`) — marking a figure outside its printed range is a reading aid, not a
  judgement. Do not reintroduce a callback workflow.

- **There is no critical-result callback.** `[1.95.0]` The clinic reports clinical results and
  does not diagnose, so the flag, the callback queue, the acknowledge flow, the "contact the
  clinic" email and `results:acknowledge_critical` are all gone. The `is_critical` columns and
  their three historical rows stay: removing a feature is not a reason to erase the record that
  a clinician judged a value dangerous and somebody telephoned a patient about it. Nothing
  writes or displays them.
- **X-ray issues no report here; its exams are marked done.** `[1.129.0]` The clinic's X-ray
  department gives its results through its own system. `NO_REPORT_CATEGORIES` / `issuesReports`
  (`constants/modality.js`, mirrored in `lib/categories.js`; change both) name such departments,
  and it is `['Xray']`. Upload, release and email are refused on the server (409). The worklist's
  one action is Mark done: `PATCH /results/test-status/:id` with `Completed` stamps
  `visit_tests.performed_at` / `performed_by`, completes the test, and the visit if nothing else is
  outstanding. A department that issues reports is refused there (403), because its tests finish
  by releasing: that endpoint used to let anyone complete a test with no report at all. Every
  report that counts released work counts an exam done the same way (Departments throughput and
  turnaround, Today's department table, Staff Workload; `reportRepository` UNIONs the two). X-Ray
  History shows "Done" and who, with no delivery column or Email; the portal says the result comes
  from the X-Ray department and leaves it out of "Latest results". X-ray still queues and bills.
  `xray-no-report.spec.js` holds it.
- **A result is its attached report document.** `[1.94.0]` Findings, remarks, the structured
  measurement grid and the quick-fill templates were all removed: the clinic already produces a
  report file for every diagnosis, and asking a technologist to re-enter it was work done twice.
  Across 35 seeded forms and 133 fields, exactly 4 results in the database ever carried a
  structured measurement while 84 of 90 already had a file. The file is required to RELEASE and
  not to save, so a ticket still parks in 'Waiting for Release' while the report is produced.
  `RESULTS_REQUIRE_FILE=false` restores the old behaviour without a deploy.
- **Releasing does not email; emailing is a separate choice.** `[1.113.0]` Not every patient wants a
  medical report in their inbox. `releaseResult` authorises the report and puts it in the portal,
  and returns `patientEmail` so the panel after release can OFFER "Email to patient"; History's
  Email button sends it later, as often as needed. Both go through `POST /results/:id/email`
  (`results:release`), the only path that emails a result, audited as `result.emailed`. History
  reads "Not sent" for a released report with an address and no send, which is now the normal
  state, so Today no longer lists unemailed reports as work.
- **A patient views a released report; the portal offers no download and no print.** `[1.113.0]`
  `[1.115.0]` The clinic's choice: the original is printed and handed over at the clinic, and a copy
  is emailed on request. `ResultDocument` hides Download, Print and "Open in new tab" for a Client,
  names the document "Digital copy", and asks the PDF viewer to hide its toolbar (`#toolbar=0`,
  Chrome and Edge). It is what the portal OFFERS, not a lock — a report on someone's screen can be
  kept. A phone with no PDF viewer keeps "Open in new tab", the only way to read it.
- **A patient's copy is marked DIGITAL COPY; the clinic keeps the original.** `[1.114.0]` Against
  forgery. Everything a patient receives, in the portal (`getResultFile` for a Client) or attached to
  an email (`resolveReportAttachment`), goes through `utils/digitalCopy.js`: a faint diagonal
  DIGITAL COPY pattern over every page, and a strip ADDED below each page saying the original with
  the official seal is at the clinic. Staff are served the stored original, which is what the clinic
  prints. Marked in memory per request, never stored. An image becomes a one-page PDF; a Word or
  Excel report, or a PDF that cannot be parsed, is REFUSED (409) rather than handed over unmarked —
  never add a fallback to the original. A label, not a lock: pdf-lib cannot encrypt. Spec fixtures
  must be real PDFs (`helpers/reportFile.js` `pdfReport`); a fake `%PDF-1.4` buffer is refused for a
  patient, as a damaged upload should be. `digital-copy.spec.js` holds it.
- **Every released report carries a verification code, and anyone can check it.** `[1.126.0]`
  `markReleased` issues `test_results.verification_code` (ten Crockford base32 characters, printed
  ABCDE-12345, `utils/verificationCode.js`) per AUTHORISED version, kept if released again; an
  amendment's release issues a new one. The digital copy's strip carries the code and a QR to
  `FRONTEND_URL/?verify=CODE` (vector-drawn, clickable in a PDF viewer), and the result email
  names it. `GET /api/verify/:code` is PUBLIC and answers genuine / replaced / not found with only
  the clinic, test, department, patient INITIALS, release date and version. Never add a finding,
  a full name or the file to it: a verification link gets forwarded. Its limiter counts only
  misses. The original staff print is not stamped. `FRONTEND_URL` must be the address a
  stranger's phone can reach, or every QR printed meanwhile points nowhere.
  `report-verification.spec.js` holds it.
- **The typed result forms are gone, tables and all.** `[1.109.0]` `result_field_sets`,
  `result_fields`, `result_field_set_tests`, `result_measurements` and `clinic_signatories` were
  dropped by `migrateRemoveResultForms.js`, which writes every typed value
  (`result.measurements_archived`) and every signatory (`clinic.signatory_archived`) into
  `audit_log` first. `POST /results` answers a `measurements` key with a 400 rather than ignoring
  it, and `GET /results/field-set/:id` is gone. The clinic's form layouts and signatories survive in
  `constants/labResultForms.js`, which only the demo seed reads, to print realistic sample reports.
- **A report may be PDF, JPEG, PNG, Word or a spreadsheet.** `[1.96.0]` The list is
  `backend/src/constants/reportFileTypes.js`, mirrored in `frontend/src/lib/reportFileTypes.js`;
  change both together. Office types are judged by extension, label AND contents, because their
  browser labels are unreliable — never go back to trusting the label alone. Macro-enabled files
  (DOCM, XLSM) stay refused. PDFs and images are served inline, everything else as a download.
- **`components/ResultReport.jsx` is the letterhead around a report.** `[1.94.0]` `[1.109.0]` The
  clinic's attached document is the report; this wraps it in the letterhead, the patient's header,
  the attachment row and, for a result typed before files were attached, its findings. The typed
  grids and the signature footer went with their tables. The clinic's copy and the patient's copy
  are the same document by requirement, so a second rendering can only agree with the first by
  coincidence. Print through `lib/printReport.js`, never a bare `window.print()`: two mounted
  `.print-area` elements print stacked on top of each other, and the diagnostic dashboard can hold
  three at once. Every list a report opens from must carry what its header prints: the queries
  select `patient_type_name`, birthdate and sex.
- **Never add a second `<input type="file">` to the result entry dialog.** `[1.94.0]` This rule
  used to be about `<textarea>`, because `laboratory.spec.js` drove the findings box with a bare
  `page.locator('textarea')`. The textarea is gone and that spec now attaches the report with a
  bare `page.locator('input[type="file"]')`, so the hazard moved rather than disappeared: a second
  file input breaks two of its tests with a strict-mode violation from a file that never mentions
  the component that added it. `result-entry.spec.js` guards the count.

**Don't couple a test to a class name.** `payment.spec.js` used to scope itself with
  `ancestor::div[contains(@class,"rounded-2xl")]`, so changing a corner radius failed a payment
  assertion. Add a `data-testid` instead.

## Repo conventions

- Files: PascalCase for React components, camelCase for JS utilities/backend files, snake_case for DB identifiers.
- Keep files focused; split when they exceed roughly 300–500 lines.
- `.agents/AGENTS.md` and `.agents/PROJECT_STRUCTURE.md` define an internal "AI team" convention (Architect/Backend/Frontend/Database/Business-Analyst roles) used to keep contributions consistent — the layering and naming rules above are drawn from it.
- A version-control skill (`.agents/skills/version_control_agent/`) exists for timestamped checkpoint commits/rollback via PowerShell scripts; this explains the "Checkpoint (yyyymmdd-HHMMSS)" style commit messages seen in git history. Don't assume this workflow applies unless the user invokes it.
- **The capstone paper's diagrams are generated, not hand-drawn.** `[1.93.0]`
  `docs/diagrams/buildDiagrams.cjs` writes the flowcharts, use cases and DFDs from specs inside it,
  and reads the ERD out of the live database, so the ERD cannot drift from the schema; it reports
  any table missing from its sheets. `exportPng.ps1` exports every page (draw.io's `-p` is
  ONE-based; `0` silently exports the first page and shifts a whole run). Change what a diagram
  SAYS in the script, not in the `.drawio`, or the next regeneration discards it — hand-tuned
  placement in the `.drawio` is fine and expected. The System Architecture figure is not generated.
  `checkDiagrams.cjs` reads the files back and fails on a decision with fewer than two exits, a
  dead end, a LINE THROUGH A BOX it is not attached to, overlapping boxes, or a label too long to
  read; run it after any change. It judges only the axis-aligned segments this script fixes —
  a diagonal in the file means draw.io is routing that stub itself and its real path is not there.
  **A role's chart lands on Today** `[1.103.0]`, like the app: sign-in goes to Today for every
  member of staff, and each column opens with the screen it uses (Desk, Billing Queue, a
  worklist), which is also what keeps that screen's name out of the other columns.
  **One flow, one line, one label on it — and the actor is never drawn big** `[1.100.0]`. Steven's
  rule: a DFD keeps the paper's own box sizes (a modest process box, a small actor), and the
  ROUTING is what makes it readable. Level 0 gives every flow its own corridor and NESTS them —
  the corridor furthest from the boxes starts furthest right on the actor and lands furthest left
  on the system — so no two flows in a group cross, with inputs above the boxes and outputs below.
  Level 1 is the shape Steven's reference uses: ONE small actor at the top left, the processes
  numbered down the middle, the stores down the right. Each flow gets a TRACK of its own in the
  left margin — never a shared trunk — ordered so the lower the process the further left its
  track, which is what keeps them from crossing; each label is PINNED beside its process
  (`labelX` as `{at, dx, dy}`), because a label floated along the path lands in a different place
  on every flow. **Never draw the same actor more than once.**
  **A flowchart has the paper's header** `[1.102.0]`: the actor, Login, Access Granted? and the
  landing screen in one CENTRED stack, the no branch looping back up the left into Login, and the
  columns fanning out below off one shared bus (on a chained chart the header sits over the first
  column, or its fan crosses the chain's link corridor). **It says a thing once**: the Desk's
  walk-in path was drawn three times, each ending in its own queue ticket. A branch that rejoins
  merges into the TOP of its target, never the right edge.
