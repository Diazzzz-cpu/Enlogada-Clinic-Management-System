# System Audit Summary — Updated
## Web-Based Clinic Management System for Enlogada Ultrasound and Diagnostic Clinic

**Audit date:** 2026-08-28
**Codebase version:** `[1.62.0]` (per `database/migrations.md`)
**Supersedes:** `SYSTEM_AUDIT_SUMMARY.md`, which audited `[1.61.0]` and is kept in the repo as the pre-`[1.62.0]` baseline for a before/after comparison.
**Method:** Static analysis of routes, controllers, services, repositories, `database/schema.sql`, dependency manifests, and the frontend component tree. Every count below was re-measured against the current tree, not carried over.

### Measured scale

| Metric | Count | Change since `[1.61.0]` |
|---|---|---|
| Backend JS files / lines | 149 / 23,994 | +4 / +1,706 |
| Frontend JS+JSX files / lines | 182 / 28,065 | +6 / +1,139 |
| Database tables (in `schema.sql`) | 31 | unchanged |
| Indexes | 73 | unchanged |
| API route definitions | 129 | +2 |
| Routes gated by `authorizePermissions` | 77 | +1 |
| Routes gated by `authorizeStaff` | 62 | +2 |
| Seeded permission strings | 31 | unchanged |
| Seeded roles | 8 | unchanged |
| Additive migration scripts | 30 | unchanged |
| Playwright E2E spec files / tests | 49 / 295 | +2 / +17 |
| Report endpoints | 5 | +1 (`/reports/analytics`) |

**`[1.62.0]` added no schema change and no migration script.** All of it is reads over tables that already existed, which is why four features could ship at once with nothing to run on a live database.

---

## ⚠️ Stack correction — still the most important item in this document

Your brief describes the stack as **"React, Express.js, and Supabase (PostgreSQL)"**. The codebase does not use Supabase, and this has not changed.

- **Zero occurrences** of `supabase` anywhere in the repository — no `@supabase/supabase-js`, no client, no config, no reference in any `.js`, `.jsx`, `.json`, or `.md` file.
- The database layer is **raw PostgreSQL** through the `pg` driver (`backend/src/config/database.js`), with a self-managed connection pool and an `AsyncLocalStorage`-based `withTransaction` helper.
- The connection is a plain `DATABASE_URL` pointing at `postgresql://postgres:postgres@localhost:5432/enlogada_clinic` in `.env.example`.

**For your written chapters:** any statement that the system uses Supabase, Supabase Auth, or Supabase Row-Level Security is checkable and wrong. The accurate description is:

> *A self-hosted PostgreSQL database accessed through a layered Node.js/Express data-access tier, with authorization enforced in application middleware and the service layer.*

See §3.2 for how to present the absence of RLS honestly rather than as a gap.

---

## 1. BASELINE PROPOSAL SCOPE AUDIT

| # | Baseline requirement | Status |
|---|---|---|
| 1 | Patient Management & Registration | **Implemented** |
| 2 | Role-Based Access Control (6 role groups) | **Implemented** — exceeds proposal |
| 3 | Appointment Scheduling with QR Code Verification | **Implemented** |
| 4 | Diagnostic Results Management (Ultrasound / X-ray / Laboratory) | **Implemented** |
| 5 | Basic Payment Recording (Cash, GCash reference logging) | **Implemented** — substantially exceeds proposal |
| 6 | HMO Record & Transaction Logging | **Implemented** |
| 7 | Basic Administrative Reporting & Export | **Implemented** ✅ *(was the one gap; closed in `[1.62.0]`)* |

**All seven baseline requirements are now implemented.** The audit at `[1.61.0]` found exactly one outright gap — file export — and it is closed.

### 1.1 Patient Management & Registration — Implemented

**Evidence:** `patientRoutes.js`, `patientController.js`, `patientService.js`, `patientRepository.js`; tables `patients`, `patient_types`.

- Full CRUD surface: `POST /patients`, `GET /patients/search`, `GET /patients/:id`, `PUT /patients/:id`, `PATCH /patients/:id/archive`.
- **The guardian model is real, not implied.** `users` → `patients` is 1:N via `user_id`, so one account owns several patient profiles (a parent booking for dependants). The endpoint is deliberately plural — `GET /patients/my-profiles` — and ownership checks compare per-patient rather than resolving a user to a single patient.
- Walk-in registration is a single-pass flow (`WalkInRegistration.jsx`) issuing a queue ticket immediately.
- Archiving is soft (`[1.56.0]`) — a patient record is retired without destroying clinical history.
- Patient email on the record (`[1.60.0]`) so a walk-in can be sent their result.
- **Department scoping applies:** `patients:read_all_departments` separates staff who may search the full roster from those confined to their own modality.

### 1.2 Role-Based Access Control — Implemented (exceeds proposal)

**Evidence:** `backend/src/middlewares/auth.js`, `backend/src/scripts/setupRbac.js`; tables `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permissions`, `user_departments`.

All six proposed role groups exist, with the medical/diagnostic group split into three modality roles:

`SuperAdmin` · `Admin` · `Receptionist` · `Cashier` · `Laboratory Staff` · `Xray Staff` · `Ultrasound Staff` · `Client`

31 fine-grained permissions across 8 modules, with per-account grants **and** revokes. See §3.4 — this is materially more than "role-based access control" describes.

### 1.3 Appointment Scheduling with QR Code Verification — Implemented

**Evidence:** `appointmentRoutes.js`, `appointmentService.js`, `scheduleService.js`; tables `appointments`, `patient_visits`, `clinic_operating_hours`, `clinic_schedule_overrides`.

- **QR generation:** `BookingPass.jsx` encodes the appointment reference via `qrcode` into a data-URL. Degrades gracefully — the reference is always printed as text below, so a failed encode falls back to manual entry.
- **QR scanning:** `QrScanner.jsx` uses `html5-qrcode` on the Receptionist console, feeding the decoded value straight to `GET /appointments/verify/:reference` (gated on `appointments:read`). A scan and a manual entry resolve through the identical lookup.
- **Security choice worth citing:** the QR encodes *only* the appointment reference — nothing sensitive — and the reference is useless without an authenticated receptionist.
- **New in `[1.62.0]`:** the booking pass now also shows the patient's **estimated wait and how many people are ahead of them** — see Feature 5.
- **Depth beyond the proposal:** weekly operating-hours pattern with per-date overrides (`[1.57.0]`), slot capacity enforcement, atomic booking, reschedule-rather-than-cancel, day-before reminders carrying preparation instructions, and a 15-minute provisional slot hold for unpaid self-pay online bookings (`[1.35.0]`).

### 1.4 Diagnostic Results Management — Implemented

**Evidence:** `resultRoutes.js` (13 endpoints), `resultService.js`, `resultRepository.js`; tables `test_results`, `visit_tests`, `test_categories`, `tests`.

- Per-modality worklists, department-scoped in the service layer via `assertStaffAllowedCategory`.
- Upload → record → **release** as separate gated actions (`results:write` vs `results:release`).
- **Attribution split** (`[1.12.0]`): `recorded_by` and `released_by` stored separately.
- **Versioned reports** (`[1.15.0]`): an amendment supersedes rather than overwrites; `is_current` flags the live version, with the full chain queryable.
- **Critical values:** flagging, an outstanding-criticals worklist, a recorded callback acknowledgement.
- **Hardened file handling:** PDF/JPEG/PNG only, 15 MB cap; stored filename is random hex plus an extension derived from the *validated* MIME type, never the client's filename, with a containment re-check (`assertInside`). Files stream back through an authenticated, ownership-checked route.
- **Delivery is recorded** (`[1.59.0]`) and the report is emailed with findings in the body **and** as an attachment (`[1.61.0]`).

### 1.5 Basic Payment Recording — Implemented (substantially exceeds proposal)

**Evidence:** `paymentRoutes.js`, `paymentService.js`, `paymentRepository.js`, `constants/moneyRange.js`; tables `payments`, `payment_methods`, `payment_submissions`, `daily_counters`.

- Settlement methods constrained to `Cash`, `GCash`, `Bank`. **PayMaya was deliberately removed** in `[1.33.0]` — the clinic holds no PayMaya merchant account, so offering it was offering a way to pay nobody could collect. If your proposal names PayMaya, this is a scope decision to explain, not a gap.
- **Reference logging is a full manual-verification workflow, not a text field** (`[1.48.0]`): SuperAdmin publishes the clinic's own GCash/bank details and QR; the patient uploads a screenshot plus reference; a cashier verifies. Approval routes through the *existing* `paymentService.processPayment`, so it earns a real receipt number, the visit release and the cash-up entry — never a parallel money writer. The claimed amount is evidence only; the recomputed bill is charged.
- **New in `[1.62.0]`:** the reference number and amount can now be **read off the screenshot automatically**, with a duplicate check — see Feature 1.
- Receipt numbers and queue tickets come from `daily_counters` via `INSERT … ON CONFLICT DO UPDATE … RETURNING` — never `COUNT(*) + 1`, which races and rewinds.
- Statutory Senior Citizen / PWD discounts with correct non-VAT treatment (`CLINIC_VAT_REGISTERED=false`).
- Refunds and voids carry their own `refunded_at` so a closed day is never restated (`[1.30.0]` / `[1.32.0]`).
- Printable receipt at its own address (`?receipt=RCT-…`, `[1.52.0]`), authorised in the service layer — staff by `billing:read`, a patient by ownership.

### 1.6 HMO Record & Transaction Logging — Implemented

**Evidence:** `hmoRoutes.js` (10 endpoints), `hmoService.js`; tables `hmo_providers`, `hmo_requests`, `hmo_request_tests`.

- Provider registry; three-step claim workflow (reception raises → Admin decides → cashier is explicitly notified).
- **Two independent decision axes, both recorded:** `hmo_requests.status` (whole claim) and `hmo_request_tests.approval_status` (per line) — an HMO routinely clears a claim while refusing one line, so neither column alone is the answer.
- **Decision trail** (`[1.27.0]`): a refusal must record *why* and *who*.
- **Card evidence** with a retention pruner, because an insurance card is not a medical record.
- **Accounting correctness:** `GET /reports/hmo-claims` reports `approved` / `pending` / `refused` *beside* `collected` and never nets or sums them — an approved claim is a receivable, and folding it into revenue reports the same peso twice. **Now also exportable as CSV, with that caveat written into the file's own header block** so it survives being copied into a summary.

### 1.7 Administrative Reporting & Export — ✅ Implemented (`[1.62.0]`)

**Reporting** — five endpoints, all backed by genuine SQL aggregation (`PERCENTILE_CONT` medians, `FILTER` clauses, lateral joins, window functions):

| Endpoint | What it answers |
|---|---|
| `GET /reports/summary` | revenue trend, service volume, visit status, payment-method breakdown |
| `GET /reports/operations` | per-department takings, sales by service, front-desk throughput, turnaround, outstanding work |
| `GET /reports/hmo-claims` | claim value per provider, approved / pending / refused / collected |
| `GET /reports/staff-workload` | check-ins per reception staff, reports released per diagnostic staff |
| `GET /reports/analytics` **(new)** | turnaround vs target, arrivals by hour, comparative period revenue |

**Export** — `?format=csv` on **all five**, via `utils/csvExport.js` + `utils/reportCsv.js`. RFC 4180 compliant: quoted fields, doubled quotes, CRLF records, multi-section files with a titled header block.

Three implementation decisions worth citing, because each is the opposite of the obvious one and each has a measurable reason:

- **Money exports as a bare `1450.00`, not `₱1,450.00`.** Matching what the screen shows puts a currency symbol and thousands separator in the cell, and Excel reads that as **text** — the column cannot be summed, sorted or charted, which is the entire reason someone exports a CSV rather than printing the page. The unit moves into the header: `Collected (PHP)`. This is the one place in the codebase that deliberately does not use `formatCurrency`.
- **The file opens with a UTF-8 BOM.** Excel on Windows assumes the system codepage for a `.csv` unless one is present, so without it every `ñ` in a patient name and every `₱` in a header renders as mojibake — on the machines this clinic actually uses. `charset=utf-8` in the Content-Type never reaches Excel; the file is opened from disk long after the header is gone.
- **A NULL money value exports as an empty cell, never `0.00`.** `Number(null)` is `0` and passes `isFinite`, so the naive formatter states the clinic collected nothing rather than that nothing is recorded.

**Three safety properties, all verified by spec:**

1. **The JSON path is untouched.** Anything that is not `csv` — a missing parameter, an empty one, `format=json` — returns byte-identical responses. Every existing dashboard and spec is unaffected.
2. **An export can never see figures the JSON could not.** The service runs first, unchanged, and the format decision happens after it returns. The operations report's per-slice permission gating therefore applies identically: an Admin's export contains Takings, a Laboratory account's omits it entirely (not zeroed) and is scoped to Laboratory rows only.
3. **Validation precedes any header.** A bad date range throws its 400 before `Content-Disposition` is written, because a response that has begun as a file download cannot then become an error page.

**Still absent:** PDF and Excel export. `lib/printArea.js` provides browser printing of the reports and the receipt (`[1.52.0]`, with a real print-stylesheet spec behind it). If an adviser specifically wants PDF, that is the remaining export gap — but CSV is the format that is actually reconcilable in a spreadsheet, and it is the one that was missing.

---

## 2. RECOMMENDED UPGRADE AUDIT — the 7 advanced features

| # | Advanced feature | Status | Change |
|---|---|---|---|
| 1 | Automated Payment Verification | **Implemented** — both paths | ⬆ OCR added |
| 2 | DICOM Medical Viewer | **Not Started** | — |
| 3 | Laboratory Machine Ingestion (HL7) | **Not Started** | — |
| 4 | Automated HMO Eligibility & Co-Pay | **Not Started** (manual workflow complete) | — |
| 5 | Smart Queue Optimization | **Mostly Implemented** — prediction live, Telegram absent | ⬆ prediction added |
| 6 | Offline-First (PWA / SW / IndexedDB) | **Not Started** | — |
| 7 | Interactive BI Dashboards | **Implemented** | ⬆ extended |

**Score: 3 of 7 implemented or substantially implemented, 4 not started** — up from 1 of 7 at `[1.61.0]`.

### Feature 1 — Automated Payment Verification → ✅ **Implemented (both paths)**

**Path A — PayMongo gateway: fully built, dormant by configuration only.**

`backend/src/services/paymentGatewayService.js` is a complete, production-shaped integration:

- Real hosted Checkout Session creation against `POST {PAYMONGO_API_BASE}/checkout_sessions`, HTTP Basic auth with the secret key as username.
- Correct centavo conversion using `Math.round` — the code notes that truncating `parseFloat('1234.56') * 100` (`123455.99999999999` in binary floating point) would silently undercharge by one centavo.
- **Webhook receiver** at `POST /api/payments/gateway/webhook`, deliberately unauthenticated and signature-verified, handling `checkout_session.payment.paid` and `payment.paid`.
- Creates a `Pending` payments row keyed to the checkout session — **never** `Paid` — settling only on verified webhook delivery. `uq_payments_gateway_session` prevents duplicate settlement.
- **Fails safe:** `isConfigured()` requires *both* secrets. With only one, the clinic keeps taking counter payments and logs which half is missing — the alternative was charging a patient and recording nothing.

Sandbox activation needs **no code change**: drop `sk_test_…` into `PAYMONGO_SECRET_KEY`, register a webhook, paste its signing secret.

> **Defence caveat:** the `paymongo` npm SDK is **not** a dependency — the integration calls the REST API with native `fetch`. A panelist grepping `package.json` will find nothing. Point them at `paymentGatewayService.js`.

**Path B — OCR receipt reading: `tesseract.js@7.0.0`, `POST /payments/scan-receipt`.** *(new in `[1.62.0]`)*

`services/receiptOcrService.js` reads a GCash or bank screenshot and returns the reference number, the amount, and whether that reference has been seen before.

**The defining property: it never decides money — there is no write anywhere in the service.** `[1.48.0]` established that the amount a patient *claims* is evidence and never the amount charged; a machine reading of that claim is a third and weaker source — a guess about a claim about a payment. Letting it write would promote the least reliable number in the system to the most authoritative. It pre-fills only fields the patient left **empty**, so someone who has already typed their reference is never overwritten.

**The duplicate check is the half with real operational value.** A reference number is the clinic's only handle on a transfer that happened inside someone else's system. The same screenshot submitted twice — forwarded to a second visit, or re-sent because the patient was unsure it went through — was indistinguishable from two genuine payments, because nothing was looking. **Both tables are searched:** `payment_submissions` catches a claim already queued or decided, `payments` catches one a cashier settled at the counter. Checking only the first would miss the case that costs money. Matching is case- and whitespace-normalised.

The warning **does not block**. A repeated reference is usually a mistake but not always — a patient correcting a rejected submission is re-sending the same one on purpose. The cashier decides, as they already do for the amount.

**Two bugs found by testing against a rendered receipt rather than by reading the regex** — worth citing as methodology:

1. The capture used `\s`, which matches a newline, so it ran off the end of the reference line into the next: `Ref. No. E2E-1787890589109` followed by a date came back as `E2E-1787890589109Aug28` — a plausible-looking reference matching no record, so the duplicate check returned **clean on exactly the receipt it was built to catch**.
2. A digits-only capture truncated `GC-1787890589109` to its numeric tail, breaking the same check on every hyphenated bank reference.

Both fixed with horizontal-whitespace-only matching and a token-aware clean that joins an OCR-split digit run but stops at the next field otherwise. 10 parser cases plus 5 endpoint tests cover them.

**The scan persists nothing** — `memoryStorage`, alone among the upload paths. Disk storage would orphan a file for every scan including every abandoned one, which is most of them, mixed in with real proofs and indistinguishable from them. An upload with no reader does not need a retention policy; it needs to not exist.

### Feature 2 — DICOM Medical Viewer → **Not Started**

Zero traces. No `cornerstone-core`, `@cornerstonejs/core`, `dicom-parser`, `dcmjs`, or `ohif` in any manifest; no matching identifier in any source file.

The upload filter is the hard blocker: `RESULT_MIME_EXTENSIONS` in `backend/src/config/upload.js` admits **only** `application/pdf`, `image/jpeg`, `image/png`. A `.dcm` file (`application/dicom`) is rejected at the `fileFilter` with a 400 before reaching disk. Adding DICOM needs that map widened, a viewer component, and a storage/retention decision — `.dcm` studies are orders of magnitude larger than the current 15 MB cap.

**Externally constrained:** it also needs a modality that actually exports DICOM and a way to get files off it. Worth stating in your defence rather than leaving unexplained.

### Feature 3 — Laboratory Machine Ingestion (Dymind DF50 / HL7) → **Not Started**

Zero traces. No `hl7` or `simple-hl7` dependency; no `dymind` or `astm` identifier anywhere; no parser, no serial or TCP listener, no bridge service, no ingestion endpoint.

Result entry is manual — `ResultEntryDialog.jsx` with `lib/resultTemplates.js` supplying pre-formatted analyte templates (CBC with reference ranges, etc.). That template file is the closest thing present, and it is a typing aid, not an instrument interface.

### Feature 4 — Automated HMO Eligibility & Co-Pay Verification → **Not Started**

The HMO module (§1.6) is complete but **entirely human-decided**. There is no outbound call to any insurer API, no eligibility lookup, no coverage-percentage rule engine, no automatic co-pay computation.

The data model would support it — `hmo_providers`, `hmo_request_tests.approval_status` and the decision-trail columns are the right shape — but nothing populates them automatically.

**Realistically externally blocked:** Philippine HMOs do not generally expose eligibility APIs to third-party clinic software. State that explicitly rather than leaving it as an unexplained gap.

### Feature 5 — Smart Queue Optimization → **Mostly Implemented** *(prediction added in `[1.62.0]`)*

**Implemented:**

- `patient_visits.queue_number` issued atomically from `daily_counters` — race-free, never rewinds.
- Live Active Queue polling that **revalidates** via `ETag` / `If-None-Match` rather than refetching (measured 47% traffic reduction).
- **Retrospective measurement:** `avg_wait_minutes` and `median_wait_minutes` in `getReceptionThroughput`, plus per-modality turnaround.
- ✅ **Predictive per-patient ETA** — `patients_ahead` and `estimated_wait_minutes` on `GET /visits/active` (staff queue) **and** `GET /appointments/my-bookings` (the patient's own booking pass), through one shared `queueEstimateService` so the two screens cannot disagree.

**The multiplier is a service RATE, not a wait — and this is the whole correctness of the feature.** The obvious reading of *patients-ahead × service-duration* is to reuse the existing median wait, which on this clinic's data is 36–96 minutes. That tells the fourth person in a queue they face a four-hour wait. It is wrong because **a wait already contains the queue**: everyone waiting shares the same forty minutes, they do not each add forty to the next person. What multiplies correctly is the interval between consecutive patients being **served** — `LAG` over each day's settlements, partitioned by day so an overnight gap is never a sample, bounded to 0.5–60 minutes because an idle desk is not a slow desk.

**It refuses to guess when it does not know.** Below ten observed gaps the measured median is noise and it falls back to a stated default, flagged as `estimate_basis: 'default'` in the payload. On the current database that is exactly what happens — two usable gaps — and publishing a median of two numbers to a waiting patient as "about 4 minutes" would invent precision the data cannot support.

Other invariants, all spec-covered: `patients_ahead` counts only **Pending** predecessors (a `Processing` visit has been billed and sent to a department, so that person is no longer between this patient and the desk); a visit past the desk gets `null` rather than `0`, because zero reads as "no wait" — a claim rather than an absence; the queue position is computed over the whole active set so filtering or paging never renumbers anyone; estimates are rounded to five minutes, floored at five and capped at ninety, because "about 20 minutes" is an estimate a clinic can keep and "18 minutes" is a promise it cannot.

**Still missing — Telegram Bot: entirely absent.** No `node-telegram-bot-api`, no `telegraf`, no bot token. Notification channels remain exactly two: in-app (`notification_events` / `notification_reads`, **staff only**) and email (`nodemailer` via Gmail SMTP, configured and working). Note the deliberate architectural decision recorded in the codebase — **the patient portal has no notification bell; email is the only channel that reaches a patient**, because a Client has no bell in which to read an in-app notification. A Telegram or SMS channel would be a genuine architectural addition, not a swap.

### Feature 6 — Offline-First Capabilities → **Not Started**

Definitively absent, confirmed four independent ways:

- `frontend/public/` contains only `favicon.svg` and `icons.svg` — **no `manifest.json`, no `sw.js`**.
- `frontend/index.html` has no manifest link and no service-worker registration.
- `frontend/vite.config.js` loads only `react`, `tailwindcss` and a path alias — **no `vite-plugin-pwa`, no `workbox`**.
- **Zero** occurrences of `indexedDB`, `navigator.onLine`, or `serviceWorker` in `frontend/src`.

The application is online-only. Every screen assumes a reachable API; there is no request queue, no local write buffer, no sync reconciliation.

**This is the cheapest remaining advanced feature** — a manifest, a service worker and a cached shell would make the app installable and let it survive a dropped clinic connection.

### Feature 7 — Interactive Business Intelligence Dashboards → ✅ **Implemented** *(extended in `[1.62.0]`)*

`recharts@3.10.1`, four chart components plus a shared theme module:

| Component | Form | What it answers |
|---|---|---|
| `RevenueTrendChart.jsx` | area + optional overlay line | takings per day, **with the previous period overlaid** |
| `CategoryVolumeChart.jsx` | horizontal bar | volume by department |
| `TurnaroundSlaChart.jsx` **(new)** | composed bar + reference line | median & p90 turnaround per department, against each department's own target |
| `PeakHoursArrivalChart.jsx` **(new)** | stacked bar | arrivals by hour, walk-in vs booked |

Backed by `GET /reports/analytics` with two new aggregations in `reportRepository.js`:

- `getDepartmentTurnaroundPerformance` — `PERCENTILE_CONT` median **and p90**, plus a within-target rate.
- `getHourlyPatientArrivals` — `EXTRACT(HOUR …)` split by `visit_type`, over `generate_series` of the clinic's own operating hours.

**Design decisions worth citing in a chapter:**

**A second query must never publish a different number under an existing column's name.** `getDiagnosticThroughput` already reports `median_turnaround_minutes` measured from **payment** to release, on the documented grounds that a visit registered at 8am and paid at 11am did not spend three hours in the lab. Registration-to-release is what the *patient* experienced and is the more useful figure for asking where capacity goes. Both belong — but publishing the second under the first's name, on a screen sitting beside it, is the `[1.32.0]` divergence arriving by another door. So `median_turnaround_minutes` keeps the department-owned basis (**verified equal to the existing report on all three departments**) and the end-to-end span is named `median_total_minutes`.

**A p90 is reported beside every median.** A median hides its own tail by construction: a department can hold a 36-minute median while one report in ten takes two hours, and it is the two-hour patient who telephones.

**Empty hours are kept, not dropped.** `generate_series` over the clinic's operating hours, LEFT JOINed to the data, so an hour with nobody in it draws a zero. A gap at 11am and a quiet 11am look identical once the row is simply absent, and only one is worth acting on.

**Targets are a clinic setting, not a measurement.** `TURNAROUND_TARGETS` in the environment (defaults: Laboratory 60, Ultrasound 45, X-Ray 30 minutes). A department with no target is measured but not judged, with a `NULL` rate rather than `0` — "not measured" and "never hit the target" are different facts.

**The chart palette was validated, not chosen.** `#53843b` and `#0a71a9` — the clinic's own two logo colours — were run through a colour-blindness validator against **both** theme surfaces: ΔE 18.7 protan, 19.2 normal vision, all checks pass in light and dark. The instinct to lighten both for dark mode was tested and **fails**: the 400-level steps fall below the chroma floor and land at ΔE 13.6, under the normal-vision threshold — two series a fully sighted reader cannot reliably separate. The same steps are therefore used in both themes, measured rather than guessed. Tritan separation is 5.2 (the weak axis for green/blue), which is why every chart using the pair also carries a legend and names both series in its tooltip: colour is never the only encoding. Median and p90 share one hue at two lightnesses because they are one distribution, and a categorical pair would imply they were independent quantities.

**Remaining honest limitations:** interactivity is date-range presets plus hover tooltips — clicking a chart segment does not cross-filter the screen, and there is no cohort or drill-down view.

---

## 3. DATABASE & SECURITY STATUS

### 3.1 Schema

Source of truth is `database/schema.sql` (984 lines, applied wholesale by `migrateDb.js`), with a human-readable change log in `database/migrations.md` at `[1.62.0]`. **31 tables, 73 indexes** — unchanged by `[1.62.0]`, which added no DDL.

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

**Schema discipline worth citing in Chapter 3:** `[1.54.0]` verified `schema.sql` against the live database by building a throwaway database from the file and diffing tables, columns, indexes **and** constraints — 30 tables, 254 columns, 121 indexes, 240 constraints, zero differences. (The live database carries extra indexes contributed by the 30 additive migration scripts, which is why its index count exceeds the 73 in the base file.)

Notable integrity constraints: `uq_payments_one_paid_per_visit` (one settled payment per visit), `uq_payments_gateway_session`, `chk_payment_method`, `chk_payment_status`, `chk_payment_amount >= 0`, `chk_payment_methods_kind`, a partial unique index enforcing one live HMO claim per test, plus uniqueness on queue tickets and receipt numbers.

### 3.2 Row-Level Security — ⚠️ **None exists** (and why that is defensible)

**`grep -ciE 'ROW LEVEL SECURITY|CREATE POLICY' database/schema.sql` returns 0.** No `ENABLE ROW LEVEL SECURITY`, no `CREATE POLICY`, no per-tenant database role anywhere.

This follows directly from the stack correction. RLS is the mechanism you reach for **under Supabase**, where an untrusted browser client holds a JWT and talks to PostgREST directly — the database is the last line of defence because it is also the first one the client touches. **This system has no such exposure: the browser never holds database credentials and never issues SQL.** Every query originates in a repository behind an authenticated Express route.

**How to state it in your defence:** the system implements *application-layer* row-level authorization rather than *database-layer* RLS, enforced at three distinct points:

1. **Route middleware** — `verifyToken` → `authorizeStaff` / `authorizeRoles` / `authorizePermissions`.
2. **Service-layer ownership checks** — `hmoService` verifies a Client owns the request; `paymentService.getReceipt` authorises staff on `billing:read` but a patient on **ownership**, deliberately in the service because the two callers need different questions answered; `patientService` compares per-patient rather than resolving a user to a single patient.
3. **Service-layer department scoping** — `resultService.assertStaffAllowedCategory` restricts a modality technician to their own department's data, and the same rule now scopes the operations and analytics reports **including their CSV exports**.

This is a defensible architecture and the conventional one for a server-rendered API. But it is **not** RLS, and the honest difference is that a bug in a repository query bypasses it whereas a database policy would still hold. If a panelist specifically requires database-enforced RLS, that is a genuine gap rather than a terminology dispute.

### 3.3 Authentication

**JWT, `HS256`, in `backend/src/middlewares/auth.js`:**

- `JWT_SECRET` validated at boot — the backend **refuses to start** if blank, under 32 characters, or a known example value.
- Algorithm **pinned explicitly** (`{ algorithms: ['HS256'] }`) to foreclose RS256→HS256 confusion should the secret ever become a PEM or key object.
- **The token proves identity only.** Roles and permissions are re-read from the database on **every request**. The code documents why: a token carrying baked-in authority meant granting a role did nothing until sign-out and back in, and *revoking* one did nothing at all until expiry — up to a full day. Deactivating an account did not lock anyone out either. Cost is one indexed lookup per request; a cache is explicitly rejected as reintroducing the same staleness window in shorter form.
- **Four independent revocation checks per request:** deleted account → 401; deactivated (`status === false`) → 403; token issued before `password_changed_at` → 401 (with a documented one-second slack for the whole-seconds `iat` vs millisecond timestamp mismatch); invalid or expired signature → 401.
- **Google OAuth:** `POST /api/auth/google` verifies the ID token via `google-auth-library`, then logs in or auto-creates a Client.
- **Password reset** tokenised via `password_reset_tokens`; a successful change invalidates all older sessions (`[1.16.0]`).
- **Account lockout** after repeated failed attempts (`[1.19.0]`).
- The frontend never catches 401 locally — `config/api.js` fires a global `auth:unauthorized` event that `AuthContext` consumes, and `AuthContext` re-reads `/auth/me` every 60s and on tab focus so a permission change reaches a signed-in user without re-login.

### 3.4 RBAC middleware

Three composable gates, applied **together**:

| Middleware | The question it answers |
|---|---|
| `authorizeStaff` | Is this a member of staff at all? (`isStaffUser` — holds any non-`Client` role.) The one boundary no permission tick may cross. |
| `authorizeRoles(...)` | Structural role gate, retained only where a `Client` must be explicitly named. |
| `authorizePermissions(...)` | The delegable, matrix-driven layer. **SuperAdmin bypasses; Admin does not** — that single difference separates the two roles and is what makes the matrix mean anything. |

**Three orthogonal axes, resolved server-side in `userRepository` so no caller can disagree with another:**

- **`roles`** — staff or patient. Structural, not editable from any screen.
- **`permissions`** — the role template **plus** that account's own grants **minus** its revokes, with revoke applied last as a set difference so a conflict always resolves to *less* access.
- **`departments`** — modalities implied by roles plus `user_departments`. `null` means unrestricted and is deliberately distinct from `[]`, "none" — collapsing the two is how an access check ends up inverted.

**Coverage, measured:** 129 route definitions; **77 carry `authorizePermissions`**, **62 carry `authorizeStaff`**, 28 carry an explicit `authorizeRoles` list, 13 are deliberately open. (Parsed per route definition. A bare `grep -c` returns 91/79 because it counts the `require` import line and comments too; 77 is corroborated by `verifyRbacWiring.js`.) 31 permissions across 8 modules, seeded by `setupRbac.js`.

**Design note worth citing:** `authorizeStaff` **replaced hardcoded role lists on 45 routes** in `[1.20.0]`. Before that, `POST /payments` named `('SuperAdmin', 'Cashier')` explicitly, so granting a cashier's permission to Laboratory Staff saved successfully, reported success, and changed nothing — the matrix could not actually delegate, which is worse than having no matrix at all.

`verifyRbacWiring.js` is an automated consistency check asserting four invariants: every referenced permission exists; at least one staff role holds it (otherwise only SuperAdmin can reach the route); every explicitly named role on a route also holds the permission beside it; and every `permission:` in `frontend/src/config/navigation.js` is one the API actually enforces — which is what guarantees the sidebar cannot advertise a screen the API will refuse. **It passes on the current tree, including the new `/payments/scan-receipt` route.**

### 3.5 Other security controls

| Control | Implementation |
|---|---|
| Password hashing | `bcryptjs`, kept outside `withTransaction` so a pooled connection is not held during slow work |
| Security headers | `helmet` (CSP disabled — this process serves only JSON and file downloads) |
| CORS | Restricted to the configured `FRONTEND_URL`; **`ETag` and `Content-Disposition`** exposed, `If-None-Match` allowed |
| Rate limiting | Global limiter plus a **tighter credential-endpoint limiter** counting *failed* attempts only |
| Request body size | Explicit `express.json({ limit })`, with raw bytes captured for webhook signature verification |
| Upload safety | MIME-derived extensions, random filenames, `assertInside` containment, size caps, authenticated ownership-checked download. **The OCR scan path uses `memoryStorage` and persists nothing.** |
| Export safety | CSV responses are `Cache-Control: no-store` — a point-in-time document of patient figures is never revalidated or reused |
| PHI audit | `auditService.logPhiRead` on identified-patient reads — deliberately **not** on searches, worklists or queues |
| Audit retention | `pruneAuditLog.js` — PHI reads 2 years, everything else 7 years |
| Client-side cache | Revalidation validators held **in memory**, not via `Cache-Control`, cleared on sign-out and on any 401 — so patient queues and result histories never reach the browser's on-disk HTTP cache, where they would outlive a logout and be shared between two accounts on one reception terminal |
| Logging | `winston` + `morgan` |
| Secrets | `.env` gitignored and untracked; the SMTP App Password lives only in that file |

---

## 4. GAP & BEYOND-SCOPE SUMMARY

### 4.1 Remaining gaps

| Gap | Severity | Effort |
|---|---|---|
| **Database-level RLS** | Medium **if** your chapters claim Supabase or RLS; otherwise **not a defect** — see §3.2 | Correct the chapter (trivial), or add PostgreSQL policies plus per-request DB roles (substantial) |
| **Unit tests** | Low against the proposal, likely to be asked at defence | Medium — 49 Playwright specs / 295 tests exist; there are **no unit tests** and the backend has no test script |
| **PDF / Excel export** | Low — CSV is the reconcilable format and it now exists | Medium — browser printing covers the "printed report" case today |
| **Advanced Features 2, 3, 4, 6** | Scope decision, not a defect | See §4.3 |

**No baseline proposal requirement is unimplemented.**

### 4.2 Beyond-scope work — features exceeding the original proposal

Your strongest defence material. Each is real, working code rather than scaffolding.

**Access control**

1. **Fine-grained permission matrix** (31 permissions × 8 roles) with **per-account grants and revokes**, audited.
2. **Department/modality scoping** as a third independent axis, `null` deliberately distinct from `[]`.
3. **Automated RBAC wiring verification** (`verifyRbacWiring.js`) asserting the sidebar and API cannot disagree.
4. **Live authority resolution** — revocation takes effect on the next request, not at token expiry.
5. **Per-action permission gating within a screen** (`[1.53.0]`) — a screen legitimately visible to someone holding only *some* of the permissions its controls need does not offer the controls that would 403.

**Clinical**

6. **Result versioning with amendment history** — supersede rather than overwrite, full chain queryable.
7. **Critical-value workflow** — flagging, outstanding-criticals worklist, recorded callback acknowledgement.
8. **Recorded-by / released-by attribution split.**
9. **Result delivery tracking**, with the report emailed in the body *and* as an attachment.
10. **Composed test preparation** (`lib/preparation.js`) — rule-based rather than free text, de-duplicated by meaning so a patient booking two ultrasounds is not shown one instruction twice.

**Financial**

11. **Statutory Senior Citizen / PWD discounts** with correct RA 9994 / RA 10754 treatment, branching on the clinic's actual non-VAT registration (verified against its BIR service invoice).
12. **Package deals** expanded into per-component `visit_tests` rows, price allocated proportionally so components sum to the package price exactly and each reaches its own department worklist.
13. **Period cash-book accounting** — collections bucketed by `paid_at`, reversals by `refunded_at`, side by side and never netted, so a closed day is never restated.
14. **Manual online-payment verification workflow**, now with **OCR assistance and cross-table duplicate detection**.
15. **Full PayMongo gateway integration**, dormant on configuration alone.
16. **Addressable printable receipt** (`?receipt=RCT-…`) with dual authorization paths.
17. **HMO receivables reported separately from cash**, with the caveat carried into the CSV export's own header.

**Operational**

18. **Automated day-before appointment reminders** carrying preparation instructions — a direct countermeasure to the No-Show metric counted since `[1.0.0]` with no tool against it.
19. **Per-date schedule overrides** on top of the weekly pattern.
20. **Provisional slot holds** for unpaid self-pay online bookings.
21. **Reschedule rather than cancel.**
22. **Data-retention jobs** for notifications, audit log, and HMO card images.
23. **Patient archiving** preserving clinical history.
24. **Predictive queue ETAs** shown identically to staff and patient from one shared service.

**Engineering quality** *(unusual at capstone level — worth citing)*

25. **49 Playwright E2E specs / 295 tests** with self-cleaning global setup and teardown, so row counts are identical before and after a run and a seeded demo dataset survives testing.
26. **ETag revalidation caching** — measured 47% traffic reduction, in-memory validator store deliberately chosen over `Cache-Control` for PHI safety.
27. **Strict four-layer backend architecture** (routes → controllers → services → repositories) with **no raw SQL outside repositories**.
28. **`AsyncLocalStorage` transaction management** — repositories need no `client` argument and cannot accidentally write outside their transaction.
29. **Accessibility and theming system** — reader-selectable text scale on a `rem`-based ramp, dark mode, `prefers-reduced-motion` with a deliberate spinner exemption, automated lint check rejecting contrast-unsafe fill/ink pairings.
30. **Validated data-visualisation palette** — colour-blindness checked against both theme surfaces, with the rejected alternative documented.
31. **30 idempotent additive migrations**, most supporting `--rollback`.

### 4.3 Recommended priority order

1. **Correct the Supabase/RLS claim** in your written chapters. The single highest-value item — a factual mismatch a panelist can verify in thirty seconds. §3.2 gives the accurate wording.
2. **Enable the PayMongo sandbox** if you want Feature 1's gateway half demonstrable live. Test keys plus a webhook registration, **no code change**.
3. **Set real turnaround targets.** `TURNAROUND_TARGETS` in `backend/.env`. The current values are stated defaults nobody at the clinic has agreed, and on current data Ultrasound hits 7.7% and X-Ray 8.3% — figures you do not want on a projector unexplained.
4. **Consider Feature 6 (PWA)** as the next advanced feature. It is the cheapest remaining one: a manifest, a service worker and a cached shell.
5. **Features 2 (DICOM), 3 (HL7) and 4 (HMO eligibility) are scope decisions, not oversights.** Two are externally blocked — DICOM needs a modality that exports `.dcm`, HMO eligibility needs an insurer API Philippine HMOs do not publish. Say so explicitly; an unexplained "Not Started" reads worse than a reasoned exclusion.
6. **Optional: add unit tests** for the pure logic — `discountService.computeBreakdown`, `csvExport` formatters, the OCR extractors, `queueEstimateService.estimateFor`. All four are already deterministic, dependency-free functions.

---

## Appendix — what changed in `[1.62.0]`

Four features, no schema change, no migration script. Full reasoning in `database/migrations.md`.

| Area | Change |
|---|---|
| Export | `?format=csv` on all five report endpoints; `utils/csvExport.js`, `utils/reportCsv.js`; `Content-Disposition` added to CORS `exposedHeaders` |
| OCR | `tesseract.js`; `POST /payments/scan-receipt`; `services/receiptOcrService.js`; cross-table duplicate lookup; auto-scan wired into the patient's upload form |
| Queue | `services/queueEstimateService.js`; `getMedianServiceMinutes`; queue-position window function; estimates on the staff queue and the patient booking pass |
| BI | `GET /reports/analytics`; `getDepartmentTurnaroundPerformance`, `getHourlyPatientArrivals`; `TurnaroundSlaChart`, `PeakHoursArrivalChart`, `chartTheme.js`; comparative overlay on `RevenueTrendChart`; new Analytics tab |
| Tests | `report-export.spec.js` (9), `receipt-scan-queue.spec.js` (8); one pre-existing flake fixed in `booking-picker.spec.js` |
| Config | `TURNAROUND_TARGETS` (optional) in `backend/.env.example` |

**Verification performed:** 295/295 E2E tests passing (up from 278), frontend lint + fill-role check clean, production build clean, prose scan clean, `verifyRbacWiring.js` passing, and the new turnaround medians cross-checked as exactly equal to the existing operations report on all three departments.

---

*Generated from static analysis of the codebase at commit `91893bf` on branch `main`, version `[1.62.0]`.*
