# System Audit Summary
## Web-Based Clinic Management System for Enlogada Ultrasound and Diagnostic Clinic

**Audit date:** 2026-08-28
**Codebase version audited:** `[1.61.0]` (per `database/migrations.md`)
**Method:** Static analysis of routes, controllers, services, repositories, `database/schema.sql`, dependency manifests, and the frontend component tree.

> ### ⚠️ Partly superseded by `[1.62.0]`, committed the same day
>
> Four of the gaps this audit identified were closed immediately after it was written. The
> findings below are preserved as the **pre-`[1.62.0]` baseline** — useful for a "before and
> after" in your chapters — but do not quote the status columns as current. What changed:
>
> | Section | Was | Now |
> |---|---|---|
> | §1.7 Reporting **& Export** | Partially Implemented — no file export | **Implemented** — `?format=csv` on all five report endpoints |
> | §2 Feature 1 — OCR half | Not Started | **Implemented** — `tesseract.js`, `POST /payments/scan-receipt`, with duplicate detection |
> | §2 Feature 5 — Smart Queue | Partial: retrospective metrics only | **Prediction added** — `patients_ahead` + `estimated_wait_minutes` on the staff queue and the patient's booking pass. *Telegram remains absent* |
> | §2 Feature 7 — BI Dashboards | Partial: two chart types, no drill-down | **Extended** — `GET /reports/analytics`, turnaround-vs-target, peak-hours arrivals, comparative period overlay, CSV export |
> | §4.1 gap table | CSV export = the one outright baseline gap | **Closed** |
> | E2E suite | 47 spec files | **49 spec files, 295 tests** |
>
> **Unchanged and still accurate:** the Supabase/RLS stack correction (§3.2 — still zero RLS
> policies, still no Supabase), and Features 2 (DICOM), 3 (HL7) and 4 (HMO eligibility), which
> remain Not Started. `[1.62.0]` added **no schema change and no migration script**, so §3.1 is
> current as written.
>
> See `database/migrations.md` `[1.62.0]` for the full reasoning behind each.
>
> **One measurement correction that also applies to the baseline.** The two route-gate counts above
> were produced with `grep -c`, which counts every LINE mentioning the middleware — including the
> `require(...)` import in each of the 19 route files and the explanatory comments — rather than
> route definitions. Parsed per route, `[1.61.0]` had **76** permission-gated and **60**
> staff-gated routes, not 90 and 77 (measured directly against commit `9692ce2`: 127 routes, 76 permission-gated, 61 staff-gated, 27 with an explicit role list). `SYSTEM_ROLE_DASHBOARD_INVENTORY.md` §1.3 shows the method
> and the corroborating output from `verifyRbacWiring.js`. Every other figure in this document
> stands.

### Measured scale

| Metric | Count |
|---|---|
| Backend JS files / lines | 145 / 22,288 |
| Frontend JS+JSX files / lines | 176 / 26,926 |
| Database tables (in `schema.sql`) | 31 |
| Indexes | 73 |
| API route definitions | 127 |
| Routes gated by `authorizePermissions` | 90 (line count; the per-route figure is 76 — see the note below) |
| Routes gated by `authorizeStaff` | 77 (line count; per-route: 61) |
| Seeded permission strings | 31 |
| Seeded roles | 8 |
| Additive migration scripts | 30 |
| Playwright E2E spec files | 47 |

---

## ⚠️ Stack correction — read this before chapter alignment

Your brief describes the stack as **"React, Express.js, and Supabase (PostgreSQL)"**. The codebase does not use Supabase.

- **Zero occurrences** of `supabase` anywhere in the repository (no `@supabase/supabase-js`, no client, no config, no reference in any `.js`, `.jsx`, `.json`, or `.md` file).
- The database layer is **raw PostgreSQL** through the `pg` driver (`backend/src/config/database.js`), with a self-managed connection pool and an `AsyncLocalStorage`-based `withTransaction` helper.
- The connection is a plain `DATABASE_URL` pointing at `postgresql://postgres:postgres@localhost:5432/enlogada_clinic` in `.env.example`.

**Consequence for your written chapters:** any statement that the system uses Supabase, Supabase Auth, or Supabase Row-Level Security would be inaccurate. The correct description is *"a self-hosted PostgreSQL database accessed through a layered Node.js/Express data-access tier, with authorization enforced in application middleware and the service layer."* See §3.2 for the full picture.

---

## 1. BASELINE PROPOSAL SCOPE AUDIT

| # | Baseline requirement | Status |
|---|---|---|
| 1 | Patient Management & Registration | **Implemented** |
| 2 | Role-Based Access Control (6 role groups) | **Implemented** |
| 3 | Appointment Scheduling with QR Code Verification | **Implemented** |
| 4 | Diagnostic Results Management (Ultrasound / X-ray / Laboratory) | **Implemented** |
| 5 | Basic Payment Recording (Cash, GCash reference logging) | **Implemented** |
| 6 | HMO Record & Transaction Logging | **Implemented** |
| 7 | Basic Administrative Reporting & Export | **Partially Implemented** — reporting yes, **file export no** |

### 1.1 Patient Management & Registration — Implemented

**Evidence:** `patientRoutes.js`, `patientController.js`, `patientService.js`, `patientRepository.js`; tables `patients`, `patient_types`.

- Full CRUD surface: `POST /patients` (create profile), `GET /patients/search` (staff lookup), `GET /patients/:id`, `PUT /patients/:id` (correction), `PATCH /patients/:id/archive`.
- **The guardian model is real, not implied.** `users` → `patients` is 1:N via `user_id`, so one account owns several patient profiles (a parent booking for dependants). The endpoint is deliberately plural — `GET /patients/my-profiles` — and ownership checks compare per-patient rather than resolving a user to a single patient.
- Walk-in registration is a single-pass flow (`WalkInRegistration.jsx`) that issues a queue ticket immediately.
- Archiving is soft (`migratePatientArchive.js`, `[1.56.0]`) — a patient record is retired without destroying clinical history.
- Patient email is captured on the record (`migratePatientEmail.js`, `[1.60.0]`) so a walk-in can be sent their result.
- **Department scoping applies:** `patients:read_all_departments` separates staff who may search the full roster from those confined to their own modality.

### 1.2 Role-Based Access Control — Implemented (exceeds proposal)

**Evidence:** `backend/src/middlewares/auth.js`, `backend/src/scripts/setupRbac.js`; tables `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permissions`, `user_departments`.

All six proposed role groups exist, seeded in `schema.sql`, with the medical/diagnostic group split into three modality roles:

`SuperAdmin` · `Admin` · `Receptionist` · `Cashier` · `Laboratory Staff` · `Xray Staff` · `Ultrasound Staff` · `Client`

This is materially more than the proposal describes — see §4.2 and §3.4.

### 1.3 Appointment Scheduling with QR Code Verification — Implemented

**Evidence:** `appointmentRoutes.js`, `appointmentService.js`, `scheduleService.js`; tables `appointments`, `patient_visits`, `clinic_operating_hours`, `clinic_schedule_overrides`.

- **QR generation:** `BookingPass.jsx` encodes the appointment reference via the `qrcode` library into a data-URL, rendered on the patient's booking pass. It degrades gracefully — the reference is always printed as text below, so a failed encode falls back to manual entry.
- **QR scanning:** `QrScanner.jsx` uses `html5-qrcode` on the Receptionist console, feeding the decoded value straight to `GET /appointments/verify/:reference` (gated on `appointments:read`). A scan and a manual entry resolve through the identical lookup.
- **Security choice worth citing:** the QR encodes *only* the appointment reference — nothing sensitive — and the reference is useless without an authenticated receptionist.
- **Scheduling depth beyond the proposal:** a weekly operating-hours pattern with per-date overrides (close a date, or change its hours/capacity, `[1.57.0]`); slot capacity enforcement; atomic booking; reschedule-rather-than-cancel; a day-before reminder job carrying preparation instructions (`sendAppointmentReminders.js`); and a 15-minute provisional slot hold for unpaid self-pay online bookings (`[1.35.0]`).

### 1.4 Diagnostic Results Management — Implemented

**Evidence:** `resultRoutes.js` (13 endpoints), `resultService.js`, `resultRepository.js`; tables `test_results`, `visit_tests`, `test_categories`, `tests`.

- Per-modality worklists: `GET /results/pending/:category` and `GET /results/released/:category`, department-scoped in the service layer via `assertStaffAllowedCategory`.
- Upload → record → **release** are separate gated actions (`results:write` vs `results:release`), so recording a finding and authorising its release to the patient are distinct permissions.
- **Attribution split** (`[1.12.0]`): `recorded_by` and `released_by` are stored separately.
- **Versioned reports** (`[1.15.0]`): an amendment supersedes rather than overwrites; `is_current` flags the live version and `GET /results/:visitTestId/versions` exposes the amendment history.
- **Critical values:** flagging, an outstanding-criticals worklist, and a recorded callback acknowledgement (`results:acknowledge_critical`).
- **File handling is hardened:** uploads are accepted only as `application/pdf`, `image/jpeg`, `image/png` (15 MB cap); the stored filename is random hex plus an extension derived from the *validated* MIME type, never from the client's filename, with a containment re-check (`assertInside`). Files are streamed back through an authenticated, ownership-checked route — never served statically.
- **Delivery is recorded** (`[1.59.0]`, `migrateResultDelivery.js`): the system stores that a released report actually reached the patient, and `POST /results/:visitTestId/email` sends it.

### 1.5 Basic Payment Recording — Implemented (substantially exceeded)

**Evidence:** `paymentRoutes.js`, `paymentService.js`, `paymentRepository.js`, `constants/moneyRange.js`; tables `payments`, `payment_methods`, `payment_submissions`, `daily_counters`.

- Settlement methods are constrained to `Cash`, `GCash`, `Bank` (`chk_payment_method`). PayMaya was deliberately **removed** in `[1.33.0]` — the clinic holds no PayMaya merchant account, so offering it was offering a way to pay that nobody could collect. If your proposal text names PayMaya, this is a deliberate scope decision to explain rather than a gap.
- **Reference logging is a full manual-verification workflow, not a text field** (`[1.48.0]`): SuperAdmin publishes the clinic's own GCash/bank details and QR (`payment_methods`); the patient pays and uploads a screenshot plus reference (`payment_submissions`); a cashier verifies it. Approval routes through the *existing* `paymentService.processPayment`, so it earns a real receipt number, the visit release and the cash-up entry — never a parallel money writer. The claimed amount is treated as evidence only; the recomputed bill is what is charged.
- Receipt numbers and queue tickets come from `daily_counters` via `INSERT … ON CONFLICT DO UPDATE … RETURNING` — never `COUNT(*) + 1`, which races under concurrency and rewinds when a row is cancelled.
- Statutory Senior Citizen / PWD discounts with correct non-VAT treatment (`discountService.computeBreakdown`, `CLINIC_VAT_REGISTERED=false`).
- Refunds and voids carry their own `refunded_at` so a closed day is never restated (`[1.30.0]` / `[1.32.0]`).
- Printable receipt at its own address (`?receipt=RCT-…`, `[1.52.0]`), authorised in the service layer so staff pass on `billing:read` and a patient passes on ownership.

### 1.6 HMO Record & Transaction Logging — Implemented

**Evidence:** `hmoRoutes.js` (10 endpoints), `hmoService.js`; tables `hmo_providers`, `hmo_requests`, `hmo_request_tests`.

- Provider registry (create/update, gated on `hmo:approve`).
- Three-step claim workflow: reception raises it → an Admin decides it → the cashier is explicitly notified (`hmo-claim-handoff.spec.js`).
- **Two independent decision axes, both recorded:** `hmo_requests.status` (the whole claim) and `hmo_request_tests.approval_status` (per line item) — an HMO routinely clears a claim while refusing one line on it, so neither column alone is the answer.
- **Decision trail** (`[1.27.0]`): a refusal must record *why* and *who*, so the cashier is never left explaining a charge nobody wrote down.
- **Card evidence:** member number plus a card photo, uploaded through the same hardened path, downloadable only through an authorised ownership-checked route, with a retention pruner (`pruneHmoCards.js`) because an insurance card is not a medical record.
- **Accounting correctness:** `GET /reports/hmo-claims` reports `approved` / `pending` / `refused` *beside* `collected` and never nets or sums them — an approved claim is a receivable the insurer pays later, and folding it into revenue would report the same peso twice.

### 1.7 Basic Administrative Reporting & Export — ⚠️ Partially Implemented

**What exists (reporting):** `reportRoutes.js` — `/reports/summary`, `/reports/staff-workload`, `/reports/hmo-claims`, `/reports/operations`. Backed by `reportRepository.js` with genuine SQL aggregation (`PERCENTILE_CONT` medians, `FILTER` clauses, lateral joins). Surfaced on `ReportsOverview.jsx`, `AdminDashboard.jsx`, `CashierMonitoring.jsx`, `ActivityLog.jsx`, and `PatientRecordsOversight.jsx`. Per-department slicing is authorised individually inside the service, so a cashier sees their own sales and a modality its own turnaround.

**What is missing (export):**

- **No CSV export anywhere.** A repository-wide search for `text/csv`, `Content-Disposition: attachment`, or CSV generation returns **zero** hits in report code. The only two `Content-Disposition` headers in the entire codebase are `inline` dispositions for streaming a result file (`resultController.js:164`) and an HMO card image (`hmoController.js:57`).
- **No PDF or Excel export.** No `pdfkit`, `puppeteer`, `exceljs`, or `jspdf` in either `package.json`.
- **What stands in for it:** browser printing via `lib/printArea.js` on Reports Overview and Patient Records Oversight. That produces a printed page, not a data file — an adviser asking for "exportable reports" will not accept a print dialog as an export.

> **This is the single clearest baseline gap.** Closing it is small: `reportService` already returns clean aggregate arrays, so a CSV serializer plus `Content-Disposition: attachment` on two or three report endpoints would satisfy it.

---

## 2. RECOMMENDED UPGRADE AUDIT — the 7 advanced features

| # | Advanced feature | Status |
|---|---|---|
| 1 | Automated Payment Verification | **Implemented (PayMongo) / Not Started (OCR)** |
| 2 | DICOM Medical Viewer | **Not Started** |
| 3 | Laboratory Machine Ingestion (HL7) | **Not Started** |
| 4 | Automated HMO Eligibility & Co-Pay | **Not Started** (the manual workflow is complete) |
| 5 | Smart Queue Optimization | **Partially Implemented** (retrospective metrics only) |
| 6 | Offline-First (PWA / SW / IndexedDB) | **Not Started** |
| 7 | Interactive BI Dashboards | **Partially Implemented** |

### Feature 1 — Automated Payment Verification → **PayMongo implemented; OCR absent**

**PayMongo: fully built, dormant by configuration only.**

`backend/src/services/paymentGatewayService.js` is a complete, production-shaped integration — not a stub:

- Real hosted Checkout Session creation against `POST {PAYMONGO_API_BASE}/checkout_sessions`, HTTP Basic auth with the secret key as the username.
- Correct centavo conversion using `Math.round` — the code notes that truncating `parseFloat('1234.56') * 100` (which is `123455.99999999999` in binary floating point) would silently undercharge by one centavo.
- **Webhook receiver** at `POST /api/payments/gateway/webhook` (deliberately unauthenticated, signature-verified), handling `checkout_session.payment.paid` and `payment.paid`.
- Creates a `Pending` payments row keyed to the checkout session — **never** `Paid` — and settles only on verified webhook delivery. `uq_payments_gateway_session` prevents duplicate settlement.
- **Fails safe:** `isConfigured()` requires *both* `PAYMONGO_SECRET_KEY` and `PAYMONGO_WEBHOOK_SECRET`. With only one, the clinic keeps taking counter payments and the backend logs which half is missing — because the alternative was charging a patient and recording nothing (the webhook verifies against the *webhook* secret, so a missing one rejects every delivery 401 while the money has already moved).
- `GET /payments/gateway/status` lets the frontend discover availability at runtime, so enabling it needs no rebuild.

Environment keys are present and blank in `.env.example`: `PAYMONGO_SECRET_KEY=`, `PAYMONGO_WEBHOOK_SECRET=`, `PAYMONGO_API_BASE=https://api.paymongo.com/v1`. Dropping in `sk_test_…` sandbox credentials and registering a webhook activates the path with **no code change**.

The service also documents *why* an aggregator rather than GCash directly: neither GCash nor Maya issues merchant API credentials to an arbitrary application — in the Philippines you onboard through a BSP-regulated processor, which then exposes them as payment methods. That is a defensible design rationale worth quoting in your chapter.

> **Caveat for your defence:** the `paymongo` **npm SDK is not a dependency** — the integration calls the REST API with native `fetch`. That is a legitimate choice, but if a panelist greps `package.json` for evidence they will find nothing. Point them at `paymentGatewayService.js`.

**OCR receipt reading: not started.** No `tesseract.js` in either manifest and no OCR code. The single grep hit for "ocr" was the word *Hematocrit* inside a lab result template — a false positive.

Worth noting: the manual proof-of-payment workflow (§1.5) already occupies exactly the problem space OCR would automate. The screenshot is already uploaded and stored against `payment_submissions`, so an OCR pass that pre-fills the reference number and amount for the cashier would slot in cleanly as an assistive layer over an existing, working flow — a considerably safer framing than OCR deciding a payment on its own.

### Feature 2 — DICOM Medical Viewer → **Not Started**

Zero traces. No `cornerstone`, `cornerstone-core`, `dicom-parser`, `ohif`, or `dcmjs` in any manifest, and no matching identifier in any source file.

The upload filter is the hard blocker: `RESULT_MIME_EXTENSIONS` in `backend/src/config/upload.js` admits **only** `application/pdf`, `image/jpeg`, and `image/png`. A `.dcm` file (`application/dicom`) is rejected at the `fileFilter` with a 400 before it ever reaches disk. Adding DICOM would require widening that map, building a viewer component, and revisiting storage and retention — `.dcm` studies are orders of magnitude larger than the current 15 MB cap.

### Feature 3 — Laboratory Machine Ingestion (Dymind DF50 / HL7) → **Not Started**

Zero traces. No `hl7`, `dymind`, or `astm` identifier anywhere in `backend/src` or `frontend/src`; no parser, no serial or TCP listener, no bridge service, no ingestion endpoint.

Result entry is entirely manual — `ResultEntryDialog.jsx` with `lib/resultTemplates.js` supplying pre-formatted analyte templates (CBC with reference ranges, and so on). That template file is the closest thing present, and it is a typing aid, not an instrument interface.

### Feature 4 — Automated HMO Eligibility & Co-Pay Verification → **Not Started**

The HMO module (§1.6) is complete but **entirely human-decided**. `hmoRoutes.js` exposes approve and reject endpoints operated by staff holding `hmo:approve`. There is no outbound call to any insurer API, no eligibility lookup, no coverage-percentage rule engine, and no automatic co-pay computation.

The data model would support it — `hmo_providers`, `hmo_request_tests.approval_status`, and the decision-trail columns are the right shape — but nothing populates them automatically.

Realistically this feature is **externally blocked**: Philippine HMOs do not generally expose eligibility APIs to third-party clinic software. State that explicitly in your defence rather than leaving it as an unexplained gap.

### Feature 5 — Smart Queue Optimization → **Partially Implemented**

**Present:**

- `patient_visits.queue_number` issued atomically from `daily_counters` — race-free, and it never rewinds.
- A live Active Queue whose polling **revalidates** via `ETag` / `If-None-Match` rather than refetching (`revalidationCache.js` — a measured 47% traffic reduction).
- **Genuine wait-time measurement** in `reportRepository.getReceptionThroughput`: both `avg_wait_minutes` and `median_wait_minutes`, computed as `paid_at − created_at` per visit. The code explicitly reasons that one patient who came in at 8am and paid at 5pm drags an average into uselessness, and the median is what actually describes a normal morning.
- Per-modality turnaround in the operations report.

**Missing:**

- **Prediction.** Everything above is *retrospective* — it reports what waits have been, not what the patient standing at the desk should expect. There is no per-patient ETA, no queue-position × service-rate estimate, and no load-based routing.
- **Telegram Bot: entirely absent.** No `telegram`, `node-telegram-bot-api`, or `telegraf` dependency, and no bot token anywhere. Notification channels are exactly two: in-app (`notification_events` / `notification_reads`, **staff only**) and email (`nodemailer` via Gmail SMTP, which is configured and working). Note the deliberate architectural decision recorded in the codebase: **the patient portal has no notification bell — email is the only channel that reaches a patient**, because a Client has no bell to read an in-app notification in. A Telegram or SMS channel would therefore be a genuine architectural addition, not a swap.

> Your measured medians are a real asset here: you already store the historical wait distribution that a predictive ETA would need as its input, which makes this the cheapest of the remaining advanced features to complete.

### Feature 6 — Offline-First Capabilities → **Not Started**

Definitively absent, confirmed four independent ways:

- `frontend/public/` contains only `favicon.svg` and `icons.svg` — **no `manifest.json`, no `sw.js`**.
- `frontend/index.html` has no manifest link and no service-worker registration.
- `frontend/vite.config.js` loads only `react`, `tailwindcss`, and a path alias — **no `vite-plugin-pwa`, no `workbox`**.
- Zero occurrences of `indexedDB`, `navigator.onLine`, or `serviceWorker` in `frontend/src`.

The application is online-only. Every screen assumes a reachable API; there is no request queue, no local write buffer, and no sync reconciliation.

### Feature 7 — Interactive Business Intelligence Dashboards → **Partially Implemented**

**Present:** `recharts@^3.10.1` **is** a frontend dependency and is genuinely used:

- `components/charts/RevenueTrendChart.jsx` — an `AreaChart` with gradient fill, a custom themed tooltip, and compact peso axis formatting (`₱8.3k`), single brand-green series.
- `components/charts/CategoryVolumeChart.jsx` — volume by test category.

Both replaced hand-rolled `<div>`-bar charts that had been duplicated across `ReportsOverview.jsx` and `AdminDashboard.jsx`. Behind them sits real aggregate SQL: revenue by day, volume by category, per-staff workload, HMO claim value by provider, payment-method breakdown, reception throughput with median wait, per-modality turnaround, and cashier shift summaries.

**Why "partially":**

- **Only two chart types exist** — one area chart and one volume chart. There is no drill-down, no cross-filtering, no comparative period overlay, and no cohort view.
- **Interactivity is limited to date-range presets** (`RANGE_PRESETS` in `date-field.jsx`) plus Recharts' built-in hover tooltip. Clicking a chart segment does not filter the screen.
- **No export from the dashboards** — the §1.7 gap resurfaces here, and for a claim of "business intelligence" it matters more than it does for basic reporting.

---

## 3. DATABASE & SECURITY STATUS

### 3.1 Schema

The source of truth is `database/schema.sql` (984 lines, applied wholesale by `migrateDb.js`), with a human-readable change log in `database/migrations.md` currently at `[1.61.0]`. **31 tables, 73 indexes:**

| Domain | Tables |
|---|---|
| Identity & access | `users`, `roles`, `user_roles`, `permissions`, `role_permissions`, `user_permissions`, `user_departments`, `password_reset_tokens` |
| Patients | `patients`, `patient_types` |
| Visits & scheduling | `patient_visits`, `appointments`, `clinic_operating_hours`, `clinic_schedule_overrides` |
| Catalogue | `test_categories`, `tests`, `test_packages`, `test_package_items`, `visit_tests` |
| Clinical | `test_results` |
| Billing | `payments`, `payment_methods`, `payment_submissions`, `discount_types` |
| Insurance | `hmo_providers`, `hmo_requests`, `hmo_request_tests` |
| Platform | `notification_events`, `notification_reads`, `audit_log`, `daily_counters` |

Schema discipline worth citing in Chapter 3: `[1.54.0]` verified `schema.sql` against the live database by building a throwaway database from the file and diffing tables, columns, indexes **and** constraints — 30 tables, 254 columns, 121 indexes, 240 constraints, zero differences. (The live database carries additional indexes contributed by the 30 additive migration scripts, which is why its index count exceeds the 73 in the base file.)

Notable integrity constraints: `uq_payments_one_paid_per_visit` (one settled payment per visit), `uq_payments_gateway_session`, `chk_payment_method`, `chk_payment_status`, `chk_payment_amount >= 0`, `chk_payment_methods_kind`, a partial unique index enforcing one live HMO claim per test, plus uniqueness on queue tickets and receipt numbers.

### 3.2 Row-Level Security — ⚠️ **None exists**

**`grep -ciE 'ROW LEVEL SECURITY|CREATE POLICY' database/schema.sql` returns 0.**

There is no `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, no `CREATE POLICY`, and no per-tenant database role anywhere in the project.

This follows directly from the stack correction at the top. RLS is the mechanism you reach for under Supabase, where an untrusted browser client holds a JWT and talks to PostgREST directly — the database is the last line of defence because it is also the first one the client touches. **This system has no such exposure: the browser never holds database credentials and never issues SQL.** Every query originates in a repository behind an authenticated Express route.

**How to state this honestly in your defence:** the system implements *application-layer* row-level authorization rather than *database-layer* RLS, enforced at three distinct points:

1. **Route middleware** — `verifyToken` → `authorizeStaff` / `authorizeRoles` / `authorizePermissions`.
2. **Service-layer ownership checks** — `hmoService` verifies a Client owns the request; `paymentService.getReceipt` authorises staff on `billing:read` but a patient on ownership (deliberately in the service, because the two callers need different questions answered); `patientService` compares per-patient rather than resolving a user to a single patient.
3. **Service-layer department scoping** — `resultService.assertStaffAllowedCategory` restricts a modality technician to their own department's data.

This is a defensible architecture, and for a server-rendered API it is the conventional one. But it is **not** RLS, and the honest difference is that a bug in a repository query bypasses it, whereas a database policy would still hold. If a panelist specifically requires database-enforced RLS, that is a genuine gap rather than a terminology dispute.

### 3.3 Authentication

**JWT, `HS256`, implemented in `backend/src/middlewares/auth.js`:**

- `JWT_SECRET` is validated at boot — the backend **refuses to start** if it is blank, shorter than 32 characters, or a known example value.
- The algorithm is **pinned explicitly** (`{ algorithms: ['HS256'] }`) to foreclose RS256→HS256 confusion should the secret ever become a PEM or key object.
- **The token proves identity only.** Roles and permissions are *not* trusted from the token — they are re-read from the database on **every request**. The code documents why: a token carrying baked-in authority meant that granting a role did nothing until the user signed out and back in, and *revoking* one did nothing at all until the token expired — up to a full day. Deactivating an account did not lock anyone out either. The cost is one indexed lookup per authenticated request, and a cache is explicitly rejected as reintroducing the same staleness window in shorter form.
- **Four independent revocation checks per request:** account deleted → 401; account deactivated (`status === false`) → 403; token issued before `password_changed_at` → 401 (with a documented one-second slack for the whole-seconds `iat` vs millisecond timestamp mismatch); invalid or expired signature → 401.
- **Google OAuth:** `POST /api/auth/google` verifies the ID token via `google-auth-library`, then logs in or auto-creates a Client user.
- **Password reset:** tokenised via `password_reset_tokens` and delivered by email; a successful change invalidates all older sessions (`[1.16.0]`).
- **Account lockout** after repeated failed attempts (`[1.19.0]`).
- The frontend never catches 401 locally — `config/api.js` fires a global `auth:unauthorized` window event that `AuthContext` consumes to clear user state without breaking SPA navigation, and `AuthContext` re-reads `/auth/me` every 60 seconds and on tab focus so a permission change reaches a signed-in user without a re-login.

### 3.4 RBAC middleware

Three composable gates, applied **together**, in `backend/src/middlewares/auth.js`:

| Middleware | The question it answers |
|---|---|
| `authorizeStaff` | Is this a member of staff at all? (`isStaffUser` — holds any non-`Client` role.) The one boundary no permission tick may cross. |
| `authorizeRoles(...)` | Structural role gate, retained only on routes where a `Client` must be explicitly named. |
| `authorizePermissions(...)` | The delegable, matrix-driven layer. **SuperAdmin bypasses; Admin does not** — that single difference is what separates the two roles and what makes the matrix mean anything. |

**Three orthogonal axes, resolved server-side in `userRepository` so no caller can disagree with another:**

- **`roles`** — staff or patient. Structural, not editable from any screen.
- **`permissions`** — the role template **plus** that account's own grants, **minus** its revokes (`user_permissions`), with revoke applied last as a set difference so a conflict always resolves to *less* access.
- **`departments`** — the modalities implied by the account's roles plus `user_departments`. `null` means unrestricted (Admin/SuperAdmin) and is deliberately kept distinct from `[]`, meaning "none" — collapsing the two is how an access check ends up inverted.

**Coverage, measured:** 127 route definitions; **90 carry `authorizePermissions`** and **77 carry `authorizeStaff`**. There are **31 permissions** across 8 modules (Patients, Visits, Appointments, Tests, Results, Billing, HMO, Reports, Administration), seeded by `setupRbac.js`.

A design note worth citing: `authorizeStaff` **replaced hardcoded role lists on 45 routes** in `[1.20.0]`. Before that, `POST /payments` named `('SuperAdmin', 'Cashier')` explicitly, so granting a cashier's permission to Laboratory Staff saved successfully, reported success, and changed nothing — the matrix could not actually delegate, which is worse than having no matrix at all.

`verifyRbacWiring.js` is an automated consistency check asserting four invariants: every referenced permission exists; at least one staff role holds it (otherwise only SuperAdmin can reach the route); every explicitly named role on a route also holds the permission beside it; and every `permission:` in `frontend/src/config/navigation.js` is one the API actually enforces — which is what guarantees the sidebar cannot advertise a screen the API will refuse.

### 3.5 Other security controls

| Control | Implementation |
|---|---|
| Password hashing | `bcryptjs`, kept outside `withTransaction` so a pooled connection is not held during slow work |
| Security headers | `helmet` (CSP disabled) |
| CORS | Restricted to the configured `FRONTEND_URL`; `ETag` exposed and `If-None-Match` allowed, for revalidation |
| Rate limiting | A global limiter plus a **tighter credential-endpoint limiter** that counts *failed* attempts only |
| Request body size | Explicit `express.json({ limit })` |
| Upload safety | MIME-derived extensions, random filenames, `assertInside` containment, 15 MB cap, authenticated ownership-checked download |
| PHI audit | `auditService.logPhiRead` on identified-patient reads — deliberately **not** on searches, worklists or queues, to keep the entries that matter from drowning in routine traffic |
| Audit retention | `pruneAuditLog.js` — PHI reads 2 years, everything else 7 years |
| Client-side cache | Revalidation validators held **in memory**, not via `Cache-Control`, and cleared on sign-out and on any 401 — so patient queues and result histories never reach the browser's on-disk HTTP cache, where they would outlive a logout and be shared between two accounts on one reception terminal |
| Logging | `winston` + `morgan` |
| Secrets | `.env` gitignored and untracked; the SMTP App Password lives only in that file — never in source, git, logs, or docs |

---

## 4. GAP & BEYOND-SCOPE SUMMARY

### 4.1 Missing baseline features

| Gap | Severity | Effort to close |
|---|---|---|
| **Report export to file (CSV / Excel / PDF)** | **High** — the only outright unmet baseline item | **Low.** `reportService` already returns clean aggregate arrays; add a CSV serializer and `Content-Disposition: attachment` to 2–3 endpoints |
| Database-level RLS | Medium **if** your written chapters claim Supabase or RLS; otherwise **not a defect** — see §3.2 | Rewrite the chapter, or add PostgreSQL policies plus per-request DB roles (substantial) |
| Automated tests below the E2E layer | Low against the proposal, but likely to be asked at defence | Medium — 47 Playwright specs exist; there are **no unit tests** and the backend has no test script |

Everything else in the baseline is implemented, and most of it well beyond the level the proposal described.

### 4.2 Beyond-scope work — features that exceed the original proposal

These are your strongest defence material. Each is real, working code rather than scaffolding.

**Access control**

1. **Fine-grained permission matrix** (31 permissions × 8 roles) with **per-account grants and revokes**, audited — well beyond "role-based access control".
2. **Department/modality scoping** as a third independent axis, with `null` (unrestricted) deliberately distinct from `[]` (none).
3. **Automated RBAC wiring verification** (`verifyRbacWiring.js`) asserting the sidebar and the API cannot disagree.
4. **Live authority resolution** — a revocation takes effect on the user's next request, not at token expiry.
5. **Per-action permission gating within a screen** (`[1.53.0]`) — a screen legitimately visible to someone holding only *some* of the permissions its controls need does not offer the controls that would 403.

**Clinical**

6. **Result versioning with amendment history** — an amendment supersedes rather than overwrites, with the full version chain queryable.
7. **Critical-value workflow** — flagging, an outstanding-criticals worklist, and a recorded callback acknowledgement.
8. **Recorded-by / released-by attribution split.**
9. **Result delivery tracking** — the system can prove a released report reached the patient.
10. **Composed test preparation** (`lib/preparation.js`) — rule-based rather than free text, and de-duplicated by meaning so a patient booking two ultrasounds is not shown the same instruction twice.

**Financial**

11. **Statutory Senior Citizen / PWD discounts** with correct RA 9994 / RA 10754 treatment, branching on the clinic's actual non-VAT registration (verified against its BIR service invoice).
12. **Package deals** expanded into per-component `visit_tests` rows, with the fixed price allocated proportionally so the components sum to the package price exactly and each one reaches its own department worklist.
13. **Period cash-book accounting** — collections bucketed by `paid_at`, reversals by `refunded_at`, reported side by side and never netted, so a closed day is never restated.
14. **Manual online-payment verification workflow** (publish → patient uploads proof → cashier verifies → real receipt through the existing money writer).
15. **Full PayMongo gateway integration**, dormant on configuration alone.
16. **Addressable printable receipt** (`?receipt=RCT-…`) with dual authorization paths — staff by permission, patient by ownership.
17. **HMO receivables reported separately from cash**, so the same peso is never counted twice.

**Operational**

18. **Automated day-before appointment reminders** carrying the preparation instructions — a direct countermeasure to the No-Show metric the system had counted since `[1.0.0]` with no tool against it.
19. **Per-date schedule overrides** layered on top of the weekly pattern.
20. **Provisional slot holds** for unpaid self-pay online bookings.
21. **Reschedule rather than cancel.**
22. **Data-retention jobs** for notifications, the audit log, and HMO card images.
23. **Patient archiving** that preserves clinical history.

**Engineering quality** *(worth citing — this is unusual at capstone level)*

24. **47 Playwright E2E specs** with self-cleaning global setup and teardown, so row counts are identical before and after a run and a seeded demo dataset survives testing.
25. **ETag revalidation caching** — a measured 47% traffic reduction, with an in-memory validator store deliberately chosen over `Cache-Control` for PHI safety.
26. **Strict four-layer backend architecture** (routes → controllers → services → repositories) with **no raw SQL outside repositories**.
27. **`AsyncLocalStorage` transaction management** — repositories need no `client` argument and cannot accidentally write outside the transaction they are in.
28. **Accessibility and theming system** — a reader-selectable text scale on a `rem`-based ramp, dark mode, `prefers-reduced-motion` handling with a deliberate spinner exemption, and an automated lint check (`checkFillRoles.js`) rejecting contrast-unsafe fill/ink pairings.
29. **30 idempotent additive migrations**, most supporting `--rollback`, so a live database can be upgraded without the destructive rebuild path.

### 4.3 Recommended priority order

1. **Add CSV export** to `/reports/summary`, `/reports/operations`, and `/reports/hmo-claims`. This closes the only outright baseline gap and is small and low-risk.
2. **Correct the Supabase/RLS claim** in your written chapters, or decide to implement real RLS. Do this *before* writing Chapter 3 — it is a factual mismatch a panelist can verify in thirty seconds.
3. **Enable the PayMongo sandbox.** Feature 1 becomes fully demonstrable with test keys and a webhook registration, with **no code change**.
4. **Extend Feature 5 to prediction.** You already store the median wait distribution; a per-patient ETA from queue position × observed service rate is a modest addition with a visible payoff, and it converts a "partially implemented" into an "implemented".
5. **Choose the remaining advanced features deliberately.** Features 2 (DICOM), 3 (HL7), and 4 (HMO eligibility) are each substantial, and two are externally blocked — DICOM needs a modality that actually exports `.dcm`, and HMO eligibility needs an insurer API that Philippine HMOs do not generally publish. Feature 6 (PWA) is the cheapest remaining win: a manifest, a service worker, and a cached shell would make the app installable and let it survive a dropped clinic connection.

---

*Generated from static analysis of the codebase at commit `9692ce2` on branch `main`.*
