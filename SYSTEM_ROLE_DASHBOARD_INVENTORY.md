# SYSTEM ROLE & DASHBOARD INVENTORY
### Enlogada Ultrasound and Diagnostic Clinic — Web-Based Clinic Management System

**Generated:** 2026-08-28 · **Codebase version:** `[1.62.0]` · **Commit:** `9d6f75a` (branch `main`)
**Method:** Static extraction from source. Every route, permission, nav item and gate below was parsed out of the actual files — none is inferred from naming or from documentation.

---

## ⚠️ File-path note before you read

The paths in the audit request do not exist in this repository. The real locations are:

| Requested | Actual in this repo |
|---|---|
| `server/middleware/auth.js` | `backend/src/middlewares/auth.js` |
| `server/middleware/rbac.js` | *(no separate file — RBAC lives inside `middlewares/auth.js`)* |
| `server/config/permissions.js` | `backend/src/scripts/setupRbac.js` (seed) + the `permissions` DB table (runtime) |
| `src/App.jsx` | `frontend/src/App.jsx` ✅ exists |
| `src/routes/` | **does not exist — there is no router library** (see below) |
| `src/components/navigation/`, `src/components/Sidebar.jsx` | `frontend/src/config/navigation.js` + `frontend/src/components/SidebarLayout.jsx` |
| `scripts/verifyRbacWiring.js` | `backend/src/scripts/verifyRbacWiring.js` ✅ exists |

**There is no client-side router.** `App.jsx` performs manual, role-based conditional rendering from `user.roles` plus local `currentTab` / `activeNav` state. **Consequently there are no URL routes like `/admin/dashboard`.** Where this report says "landing destination" it means a **nav id** resolved through `defaultNavForRoles()`, not a URL. The only two deep links in the entire app are `?reset_token=` and `?receipt=RCT-…`.

---

## 1. Role & Permission Architecture

### 1.1 Roles (8, seeded in `database/schema.sql`)

```sql
INSERT INTO roles (name) VALUES
('SuperAdmin'), ('Admin'), ('Receptionist'), ('Cashier'),
('Laboratory Staff'), ('Xray Staff'), ('Ultrasound Staff'), ('Client');
```

There is **no enum** — roles are rows in a `roles` table, joined through `user_roles` (N:M). A user may hold several; the seeded `multirole@enlogada.com` holds Receptionist **and** Cashier.

**The one structural boundary:** `isStaffUser` in `backend/src/constants/roles.js` — "holds any role that is not `Client`". Deliberately defined as a negation rather than an allow-list, so adding an ECG Staff role later requires no edit.

### 1.2 Permissions — **31 distinct, across 8 modules**

| Module | Permissions |
|---|---|
| **Patients** (4) | `patients:create` · `patients:read` · `patients:read_all_departments` · `patients:update` |
| **Visits** (3) | `visits:create` · `visits:read` · `visits:update` |
| **Appointments** (5) | `appointments:create` · `appointments:read` · `appointments:update` · `appointments:cancel` · `appointments:reschedule` |
| **Tests** (3) | `tests:manage` · `tests:assign` · `tests:read_assigned` |
| **Results** (4) | `results:read` · `results:write` · `results:release` · `results:acknowledge_critical` |
| **Billing** (5) | `billing:read` · `billing:process` · `billing:submit_proof` · `billing:refund` · `billing:discount` |
| **HMO** (3) | `hmo:read` · `hmo:request` · `hmo:approve` |
| **Reports** (2) | `reports:view` · `audit:view` |
| **Administration** (2) | `staff:manage` · `rbac:manage` |

### 1.3 The authorization chain

```
Request
  │
  ├─ verifyToken ────────── JWT HS256 (algorithm pinned). Decodes identity ONLY.
  │                          Then, on EVERY request, from the database:
  │                            • account exists?          no  → 401
  │                            • account active?          no  → 403
  │                            • iat < password_changed_at?   → 401
  │                            • load roles / permissions / departments
  │
  ├─ authorizeStaff ─────── isStaffUser(req.user) — holds any non-Client role.
  │                          The line no permission tick may cross.
  │                          (62 routes)
  │
  ├─ authorizeRoles(...) ── Structural role list. Retained ONLY where a Client
  │                          must be explicitly named. (28 routes)
  │
  ├─ authorizePermissions() Matrix-driven, delegable layer.
  │                          SuperAdmin bypasses; Admin does NOT. (77 routes)
  │
  └─ Service layer ──────── Ownership + department scope (see §3)
```

**Measured coverage — parsed per route definition, not by grepping for the string:**

| | Count |
|---|---|
| Route definitions | **129** |
| Carry `authorizePermissions` | **77** |
| Carry `authorizeStaff` | **62** |
| Carry an explicit `authorizeRoles` list | **28** |
| Fully open (no `verifyToken`) | **13** |

> **Methodology note, because it changes the numbers.** A `grep -c authorizePermissions backend/src/routes/*.js` returns **91** — but that counts every *line mentioning* the string, including the `require(...)` import in each of the 19 route files and the explanatory comments. The per-route figure is **77**, and it is independently corroborated by `verifyRbacWiring.js`, which reports *"Checked 77 permission-gated route(s) — 61 decided by permission alone."* Any earlier document of mine quoting 90/91 or 77/79 was counting lines; these are the route counts.

**The 13 deliberately open routes** — all either pre-authentication or public reference data:

```
POST /api/auth/register | /login | /forgot-password | /reset-password | /google
GET  /api/clinic                     — clinic identity for the public header
GET  /api/tests | /categories | /:id — the public services catalogue
GET  /api/packages                   — active package deals
GET  /api/payment-methods            — published GCash/bank channels
GET  /api/schedule/public            — opening hours
POST /api/payments/gateway/webhook   — caller is PayMongo, not a user;
                                       HMAC over the raw body IS the authentication
```

**The single most important line:** `authorizePermissions` bypasses for **SuperAdmin only**. Admin does not bypass — that one difference is what makes the matrix mean anything, because while Admin bypassed, unticking a permission for Admin saved successfully and changed nothing.

### 1.4 Dynamic permission features

| Feature | Mechanism | Where |
|---|---|---|
| **Live DB re-check every request** | The token carries **no** roles or permissions. Both are re-read from `user_roles` / `role_permissions` on each call. A grant or revoke takes effect on the user's **next request** — no sign-out, nothing for the client to cooperate with. | `middlewares/auth.js` |
| **Per-account grants AND revokes** | `user_permissions` table. Effective set = role template **+** account grants **−** account revokes. Revoke applied **last** as a set difference, so a conflict always resolves to *less* access. | `userRepository` (`EFFECTIVE_PERMISSIONS`) |
| **Per-account department grants** | `user_departments`. Effective departments = roles-implied **∪** directly granted. Lets a lab tech cover X-Ray for a week without a second role. | `constants/modality.js` → `departmentsForUser` |
| **Tri-state department scope** | `null` = unrestricted (Admin/SuperAdmin) · `[]` = none · `[...]` = specific. `null` and `[]` are deliberately **not** conflated — collapsing them is how an access check ends up inverted. | same |
| **Session revocation on password change** | Token `iat` compared against `password_changed_at` (1s slack for the seconds-vs-milliseconds unit mismatch). | `middlewares/auth.js` |
| **Live propagation to the UI** | `AuthContext` re-reads `GET /auth/me` every 60s and on tab focus, so a matrix change reaches a signed-in user's sidebar without a re-login. | `frontend/src/contexts/AuthContext.jsx` |
| **Audited exceptions** | Per-account overrides are audited; role-template edits are not — a role change is visible in the matrix everyone reads, an exception applies to one person and is easy to forget. | `rbacService` |
| **Automated wiring check** | `verifyRbacWiring.js` — 4 invariants, incl. that every `permission:` in `navigation.js` is one the API actually enforces. Reads routes across lines (balanced-paren join), because a line-at-a-time read silently skipped multi-line `router.post(...)`. | `backend/src/scripts/` |

> ### 🔴 Finding — a matrix/route disagreement the verifier cannot see
>
> **The Cashier role holds `billing:submit_proof` in the seeded matrix, but is excluded by the `authorizeRoles` list on both routes that use it.**
>
> - `POST /api/payment-submissions` → `authorizeRoles('SuperAdmin','Admin','Receptionist','Client')`
> - `POST /api/payments/scan-receipt` → same list
>
> A Cashier therefore receives **403 from the role gate** despite holding the permission. `verifyRbacWiring.js` does not catch it because it checks only one direction — *"every named role holds the permission"* — not *"every role holding the permission is named"*.
>
> **This is probably harmless in practice** (a cashier *verifies* proofs via `billing:process`; submitting on a patient's behalf is a front-desk job) — but it is exactly the "matrix that lies" shape `[1.20.0]` was written to eliminate. Two clean resolutions: drop `billing:submit_proof` from `CASHIER`, or add `'Cashier'` to both role lists. **I have not changed it** — the intent is yours to decide.

---

## 2. Role-by-Role Dashboard Inventory

### 2.1 SuperAdmin

| | |
|---|---|
| **Target users** | The clinic owner / system custodian. One account. |
| **Console component** | `pages/admin/AdminDashboard.jsx` (+ `SuperAdminManagement.jsx`, `ServicesCatalog.jsx`) |
| **Landing destination** | `dashboard` — first reachable, since SuperAdmin owns no departmental screen |
| **Permissions** | **All 31.** `SuperAdmin: PERMISSIONS.map(p => p.name)` |

**Sidebar — Oversight group (all 11 `MAIN_NAV_ITEMS`):**

| Label | Icon | Nav id | Gate |
|---|---|---|---|
| Dashboard | `LayoutDashboard` | `dashboard` | role: Admin/SuperAdmin |
| Staff Accounts | `Users` | `staff` | `staff:manage` |
| Service Requests | `ClipboardList` | `service-requests` | `hmo:read` |
| Services Catalog | `FileText` | `services-cat` | `tests:manage` |
| Cashier Monitoring | `CreditCard` | `cashier-monitoring` | `billing:read` |
| Appointments | `Calendar` | `appointments-list` | `appointments:read` |
| Patient Records | `FolderKanban` | `patient-records` | `patients:read` |
| Clinic Schedule | `CalendarCog` | `clinic-schedule` | role only — *no `schedule:manage` permission exists* |
| Reports | `BarChart3` | `reports` | `reports:view` |
| Activity Log | `Activity` | `activity` | `audit:view` |
| **Super Admin** | `ShieldCheck` | `superadmin` | role: SuperAdmin + `rbac:manage` |

**Plus every operational group** (Front Desk, Billing, all six Diagnostics items) — `canSee()` returns `true` unconditionally for SuperAdmin, bypassing both the permission and department gates.

**Exclusive capabilities (SuperAdmin only):**

| Capability | Route | Why restricted |
|---|---|---|
| Edit the role-permission matrix | `PUT /api/rbac/roles/:roleId/permissions` | Deciding who may do what is the one thing separating SuperAdmin from a very capable Admin |
| Per-account grants/revokes | `PUT /api/rbac/users/:userId/overrides` | Audited |
| Per-account departments | `PUT /api/rbac/users/:userId/departments` | |
| Create/suspend elevated accounts | `POST /api/superadmin/accounts`, `PATCH /accounts/:id/status` | |
| **Publish the clinic's bank/GCash details + QR** | `POST /api/payment-methods`, `POST /:id/qr` | **This is where a patient's money is sent.** SuperAdmin only and audited. |

---

### 2.2 Admin (Clinic Manager)

| | |
|---|---|
| **Target users** | Clinic manager — oversight and configuration |
| **Console component** | `pages/admin/AdminDashboard.jsx` |
| **Landing destination** | `dashboard` |
| **Permissions** | **26 of 31** |

**Sidebar:** the same oversight group as SuperAdmin **minus "Super Admin"**, plus every operational screen its permissions reach (Front Desk ✅, Diagnostics history ✅ — but **not** the Billing Queue or the diagnostic worklists, see below).

**The exactly five permissions Admin does NOT hold** — computed as a set difference against all 31, not read off the list:

| Withheld | Consequence | Reason |
|---|---|---|
| `billing:process` | Cannot take a payment or verify an online proof | The reviewer of the cash-up must not also be the transactor |
| `results:write` | Cannot author findings | A `test_result` names the clinician who produced it |
| `results:release` | Cannot release a report to a patient | Releasing is a clinical act |
| `appointments:create` | Cannot originate a booking | Admin oversees bookings; reception and patients make them |
| `rbac:manage` | Cannot edit the matrix | The one thing separating Admin from a very capable Admin — i.e. SuperAdmin |

> Admin **does** hold `billing:read`, `billing:refund`, `billing:discount`, `billing:submit_proof`, `results:read` and `results:acknowledge_critical` — so it can oversee money and read clinical output, and reverse a receipt, without transacting or authoring.

> This is enforced by **not granting the permissions**, not by a hardcoded role list. A clinic that decides otherwise can tick the box; the default is unchanged, only the ability to override is new.

**Primary views & actions:** admin KPI dashboard with `RevenueTrendChart` + `CategoryVolumeChart`; Staff Accounts CRUD + password reset + activate/deactivate; Services Catalog (tests, prices, **packages**, `PreparationField` composer); HMO Service Requests (approve/reject **whole claims and individual lines**, with a mandatory reason); Cashier Monitoring; Appointments oversight; Patient Records (unrestricted — `departments === null`); Clinic Schedule (weekly pattern + per-date overrides); **Reports (6 tabs incl. the new Analytics)**; Activity Log.

**Key API bindings:**

```
GET   /api/reports/summary | /operations | /hmo-claims | /staff-workload | /analytics
                                                        → reports:view (except operations
                                                          & analytics, gated per-slice)
GET   /api/reports/*?format=csv                         → same gates, CSV export
GET   /api/admin/staff, POST, PATCH /staff/:id[/status|/password]  → staff:manage
GET   /api/admin/activity                               → audit:view
PUT   /api/hmo/request/:id/approve | /reject            → hmo:approve
PUT   /api/hmo/request-test/:id                         → hmo:approve
POST/PUT/PATCH /api/tests, /api/packages                → tests:manage
PUT   /api/schedule/week/:dayOfWeek, /overrides         → authorizeRoles(SuperAdmin, Admin)
PATCH /api/payments/:id/status                          → billing:refund
```

---

### 2.3 Receptionist (Front Desk)

| | |
|---|---|
| **Target users** | Front-desk staff |
| **Console component** | `pages/clinic/ReceptionistDashboard.jsx` |
| **Landing destination** | `reception-queue` — first destination *belonging* to a held role |
| **Permissions** | **18** |

**Sidebar — Front Desk group:**

| Label | Icon | Nav id | Permission | Panel |
|---|---|---|---|---|
| Active Queue | `Calendar` | `reception-queue` | `visits:read` | `ActiveQueuePanel` |
| Walk-In Registration | `UserPlus` | `reception-walkin` | `visits:create` | `WalkInPanel` → `WalkInRegistration` |
| Appointment Check-In | `QrCode` | `reception-checkin` | `appointments:update` | `CheckInPanel` |
| Visit History | `History` | `reception-history` | `visits:read` | `VisitHistoryPanel` |

*(Also sees Patient Records from the oversight group — `staffOnly` + `patients:read`.)*

**Primary actions & views:**
- **Active Queue** — live table, polls with ETag revalidation, "Call Queue Number" speaker button per row, status badges, search, pagination. **Now shows `~N min · M ahead` under each ticket** (`[1.62.0]`).
- **Walk-In Registration** — single-pass: patient search or create → attach tests → issue queue ticket. Prints the ticket.
- **Appointment Check-In** — `QrScanner` (`html5-qrcode`) → `GET /appointments/verify/:reference`; manual reference entry resolves identically.
- **Visit History** — date-ranged, server-paged.
- Statutory **Senior Citizen / PWD discount** at the desk when the ID is presented.
- **HMO pre-authorisation** — raises the claim (cannot decide it).
- **Files a proof of payment on a patient's behalf** — someone who paid online then rang the clinic. **Cannot verify one** — that is `billing:process`, and taking money stays with the cashier.

**Key API bindings:**

```
GET   /api/visits/active, /history, /:id       → visits:read
POST  /api/visits                              → visits:create
PUT|PATCH /api/visits/:id/status               → visits:update
GET   /api/appointments/verify/:reference      → appointments:read
PUT|PATCH /api/appointments/:id/status         → appointments:update
PUT   /api/appointments/:id/cancel|/reschedule → roles[...,Receptionist,Client] + appointments:cancel|reschedule
POST  /api/tests/visit-tests                   → tests:assign
POST|DELETE /api/discounts/visit/:visitId      → billing:discount
POST  /api/hmo/request                         → hmo:request
POST  /api/payment-submissions                 → billing:submit_proof
POST  /api/payments/scan-receipt               → billing:submit_proof   [1.62.0]
GET   /api/patients/search, /:id               → patients:read (+ read_all_departments)
```

**Key operational capabilities:** QR check-in · queue-ticket issuance from `daily_counters` (race-free, never rewinds) · **predictive wait-time display** · statutory discounts · HMO claim initiation · **OCR receipt scan on a patient's behalf**.

---

### 2.4 Cashier (Billing)

| | |
|---|---|
| **Target users** | Counter cashier |
| **Console component** | `pages/clinic/CashierDashboard.jsx` |
| **Landing destination** | `cashier-queue` |
| **Permissions** | **10** |

**Sidebar — Billing group:**

| Label | Icon | Nav id | Permission | Panel |
|---|---|---|---|---|
| Billing Queue | `Receipt` | `cashier-queue` | `billing:process` | `BillingQueuePanel` → `CheckoutTerminal` |
| Online Payments | `Wallet` | `cashier-payments` | **`billing:process`** | `OnlinePaymentsPanel` |
| Transaction History | `History` | `cashier-history` | `billing:read` | `TransactionHistoryPanel` |

> "Online Payments" is gated on `billing:process`, **not** `billing:read` — verifying a proof issues a receipt and releases the visit, so it carries the same authority as the counter till.

**Primary actions & views:** `CollectionsStrip` (today's takings by method) · `ShiftSummaryPanel` · **`CheckoutTerminal`** as a *pinned header* with the button outside the form reaching it via `form="checkout-form"` (a sticky footer measured at y=904 on a 900px viewport and never moved) · discount application · **refund/void with confirmation** · printable receipt at `?receipt=RCT-…` in a new tab.

**Key operational capabilities:**
- **Only role that can take money.** `POST /api/payments` → `billing:process`.
- **Manual online-payment verification** — approving runs the *existing* `paymentService.processPayment`, so it earns a real receipt number, the visit release and the cash-up entry. Never a parallel money writer.
- **Sees `amount_due` beside `amount_claimed`** — approving a ₱50 claim on a ₱1,450 visit records ₱1,450, and the drawer would be short with nothing on screen to say so.
- **Reversals are listed but not counted.** The log shows refunds; the peso figures come from a SQL `summary` over settled rows, never from reducing the list.

**Key API bindings:**

```
GET   /api/payments/bill/:visitId, /transactions, /visit/:visitId → billing:read
POST  /api/payments                                              → billing:process
PATCH /api/payments/:id/status                                   → billing:refund
GET   /api/payment-submissions/pending, /reviewed                → billing:read
POST  /api/payment-submissions/:id/verify | /reject              → billing:process
POST|DELETE /api/discounts/visit/:visitId                        → billing:discount
GET   /api/payments/receipt/:receiptNumber                       → service-layer authz
GET   /api/visits/active                                         → visits:read
```

> **Note on the Active Queue:** a Cashier holds `visits:read` and legitimately reaches it (knowing who is waiting is half of running a till), but holds **none** of `visits:create` / `tests:assign` / `hmo:request`. `[1.53.0]` gates each of those *actions* individually so the Cashier is offered none of them — a control that cannot work is worse than a missing one.

---

### 2.5 Laboratory Staff · Ultrasound Staff · Xray Staff (Diagnostic)

All three share **one console** and an **identical permission set** — they differ only in `departments`.

| | |
|---|---|
| **Console component** | `pages/clinic/DiagnosticDashboard.jsx` (one file, three departments) |
| **Landing destination** | `lab-ops` / `ultrasound-ops` / `xray-ops` respectively |
| **Permissions (6, `MODALITY`)** | `results:read` · `results:write` · `results:release` · `results:acknowledge_critical` · `patients:read` · `tests:read_assigned` |
| **Departments** | `['Laboratory']` · `['Ultrasound']` · `['Xray']` |

**Sidebar — Diagnostics group.** Each item carries **both** a permission and a `department`, so a technician sees only their own two rows:

| Label | Icon | Nav id | Permission | Department |
|---|---|---|---|---|
| Laboratory Worklist | `FlaskConical` | `lab-ops` | `results:write` | `Laboratory` |
| Laboratory History | `History` | `lab-history` | `results:read` | `Laboratory` |
| Ultrasound Worklist | `Stethoscope` | `ultrasound-ops` | `results:write` | `Ultrasound` |
| Ultrasound History | `History` | `ultrasound-history` | `results:read` | `Ultrasound` |
| X-Ray Worklist | `Scan` | `xray-ops` | `results:write` | `Xray` |
| X-Ray History | `History` | `xray-history` | `results:read` | `Xray` |

**Primary actions & views:** `WorklistPanel` (released tickets only) · `ResultEntryDialog` with `lib/resultTemplates.js` analyte templates (CBC with reference ranges) · file upload (PDF/JPEG/PNG, 15 MB) · `ResultViewerDialog` · `ResultHistoryPanel` · `CriticalCallbackDialog` · release-to-patient confirmation · email the report.

**Key operational capabilities:**
- **Versioned amendment chains** — an amendment **supersedes** rather than overwrites. `is_current` flags the live version; `GET /results/:visitTestId/versions` returns the full chain. Every read must filter on `is_current` or superseded findings appear beside live ones.
- **Recorded-by / released-by split** — two different people, two columns.
- **Critical values** — flag, outstanding-criticals worklist, recorded callback acknowledgement. *A critical value is deliberately **not** emailed to the patient — a panic value read alone is a clinical decision, not a delivery one.*
- **Worklist context** — patient age and sex on the row, because they band the reference range; plus the referring physician.
- **Cannot pull an un-released ticket.** `MODALITY_SETTABLE_TEST_STATUSES` excludes `'Processing'` — a ticket arrives already Processing, put there by the payment release.

**Key API bindings:**

```
GET   /api/results/pending/:category, /released/:category → results:read + DEPARTMENT
POST  /api/results/:visitTestId                          → results:write + department + release-state
PUT|PATCH /api/results/test-status/:visitTestId          → results:write
POST  /api/results/:visitTestId/release                  → results:release
POST  /api/results/:visitTestId/email                    → results:release
GET   /api/results/:visitTestId/versions                 → results:read
POST  /api/results/:visitTestId/acknowledge-critical     → results:acknowledge_critical
GET   /api/results/critical/outstanding                  → results:acknowledge_critical
GET   /api/tests/visit-tests/:visitId                    → tests:read_assigned
GET   /api/reports/operations                            → per-slice; gets diagnostics only
```

---

### 2.6 Client (Patient / Guardian)

| | |
|---|---|
| **Target users** | Patients, **and guardians booking for dependants** |
| **Console component** | `pages/portal/ClientDashboard.jsx` (+ `ClientProfile.jsx`) |
| **Landing destination** | `currentTab = 'dashboard'` — **no sidebar at all**; uses `DashboardLayout` / `PublicHeader` |
| **Permissions (14)** | *all additionally ownership-scoped in the service layer* |

**Portal tabs (not sidebar items):**

| Tab | Component | Contents |
|---|---|---|
| **Diagnostic Results** | `ResultsTab` | Released reports only, filter chips derived from what this patient actually has |
| **Appointments** | `AppointmentsTab` | `BookingPass` (QR + reference + queue ticket + **wait estimate**), preparation notes, reschedule/cancel, `PayBookingPanel` |
| **Payments** | `PaymentsTab` | Own payment history, receipt links |
| **Profile** | `ProfileTab` | Own + dependants' profiles, `AddProfileDialog`, `EditProfileDialog` |

**The guardian model is real, not implied.** `users` → `patients` is **1:N** via `user_id`. `GET /patients/my-profiles` is plural for exactly this reason, and every ownership check compares **per-patient** rather than resolving a user to a single patient.

**Key operational capabilities:**
- **Booking wizard** — `TestPicker` (departments + packages), `SlotPicker`, `ReferringPhysicianFields`, HMO card upload.
- **Booking pass** — QR encoding *only* the appointment reference (useless without an authenticated receptionist), plus the receipt number and a link to the printable receipt.
- **`[1.62.0]` — "About 20 minutes · 3 patients ahead of you"** on the pass, from the same shared service the receptionist's screen uses.
- **Pay from home** — upload a GCash/bank screenshot + reference; **`[1.62.0]` auto-OCR pre-fills the reference and amount** (only into fields left empty) and warns if that reference has been used before.
- **Email is the only channel that reaches a patient.** The portal has **no notification bell** — `notifyRoles` writes to staff, who have one in `SidebarLayout`; a Client does not, so an in-app notification addressed to one is a row nobody can ever see.

**Key API bindings — every one ownership-scoped:**

```
GET  /api/patients/my-profiles           → verifyToken only; scoped by user_id
GET  /api/appointments/my-bookings       → verifyToken only; scoped by patients.user_id
POST /api/appointments                   → verifyToken; assertClientOwnsPatient
PUT  /api/appointments/:id/cancel|/reschedule → roles[...Client] + perm; assertClientOwnsPatient
GET  /api/payments/my-payments           → verifyToken only; self-scoped
GET  /api/payments/receipt/:receiptNumber→ service-layer: staff by billing:read, Client by OWNERSHIP
POST /api/payment-submissions            → billing:submit_proof; assertClientOwnsVisit
POST /api/payments/scan-receipt          → billing:submit_proof
POST /api/hmo/request                    → hmo:request; assertClientOwnsVisitTests
GET  /api/results/history/:patientId     → results:read; ownership checked in controller
GET  /api/results/:visitTestId/file      → verifyToken; ownership-checked stream
```

> **`GET /hmo/requests` and `GET /hmo/request/:id` are `authorizeStaff`** — no permission tick can put a Client on the staff HMO screens, even though they hold `hmo:read`.

---

## 3. Department & Record Isolation Rules

### 3.1 Diagnostic compartmentalisation

**Source of truth:** `backend/src/constants/modality.js`

```js
STAFF_ROLE_TO_CATEGORIES = {
  'Laboratory Staff': ['Laboratory'],
  'Xray Staff':       ['Xray'],
  'Ultrasound Staff': ['Ultrasound'],
};

departmentsForUser(user):
  if roles include SuperAdmin | Admin  → return null      // unrestricted
  else → union(user_departments, role-implied categories) // e.g. ['Laboratory']
```

**Three enforcement layers, all required:**

**1. Service layer — the real gate.** `resultService.assertStaffAllowedCategory`:

```js
const departments = requestingUser.departments ?? departmentsForUser(requestingUser);
if (userCoversCategory(departments, categoryName)) return;   // null ⇒ always true
throw 403 'You are not authorized to act on this test category.';
```

**2. Per-record ownership, split into two guards** — and the split matters:

| Guard | Requires | Used for |
|---|---|---|
| `assertStaffMayReadVisitTest` | department scope only | **reads** |
| `assertStaffOwnsVisitTest` | department scope **+** visit is `'Processing'` | **writes** |

> Both reads originally used the *write* guard, so the technician who produced a report could no longer open it the instant the visit turned `Completed` — precisely when somebody rings to query the result. `[1.26.0]`

**3. Release-state gating.** Filtering the worklist hides un-released tickets, **but hiding is not enforcing**: a `visit_test` id is a small integer, and any diagnostic token could previously act on one the cashier had not yet released. Both checks now run on every state-changing modality operation.

**4. Report scoping.** `reportService.getOperationsReport` and `getAnalytics` filter `byCategory` / `outstanding` / `turnaroundSla` through `departmentsForUser` — **and this now extends to the CSV exports**, verified by spec: a Laboratory account's `operations.csv` contains Laboratory rows only, and omits Takings entirely rather than zeroing it.

**5. Patient search scoping.** Without `patients:read_all_departments`, a search returns only patients who have had work in the searcher's own department, and opening anyone else's record 404s. The screen states which departments it is showing, so a short list reads as scope rather than absence. `[1.21.0]`

### 3.2 Patient data ownership

**The rule:** `patients.user_id === req.user.userId`, compared **per patient profile**, never by resolving a user to one patient.

| Guard | File | Protects |
|---|---|---|
| `assertClientOwnsPatient` | `appointmentService.js:24` | booking, cancel, reschedule |
| `assertClientOwnsVisitTests` | `hmoService.js:72` | HMO claim creation |
| `assertClientOwnsVisit` | `paymentSubmissionService.js:34` | proof submission, proof read |
| inline `patient.user_id !== requestingUser.userId` | `paymentService.js:387` | receipt retrieval |
| inline | `paymentGatewayService.js:130` | gateway checkout |

**Two details worth citing:**

1. **`patients.user_id` is NULL for a walk-in** registered at the desk with no web account. Every ownership check must treat NULL as "not yours" rather than as a match — `hmoService` comments on this explicitly.
2. **`paymentService.getReceipt` authorizes in the SERVICE, not in route middleware**, because the two callers need different questions answered: **staff on `billing:read`, a Client on ownership**. Verified: own receipt 200, another patient's 403, technician 403.

**PHI read auditing.** `auditService.logPhiRead` records reads of an *identified patient's* records — deliberately **not** searches, worklists or queues. Staff refresh those constantly and the entries that matter would drown in traffic that is just people doing their job.

---

## 4. Summary Table

| Role | Landing (nav id) | Key Dashboard Views | Core Permissions | Key Actions |
|---|---|---|---|---|
| **SuperAdmin** | `dashboard` | All 11 oversight + all 13 operational screens | **All 31** | Edit the permission matrix · per-account grants/revokes/departments · create elevated accounts · **publish the clinic's bank/GCash details + QR** (audited) |
| **Admin** | `dashboard` | Admin KPIs · Staff Accounts · Services Catalog + Packages · Service Requests · Cashier Monitoring · Appointments · Patient Records · Clinic Schedule · **Reports (6 tabs)** · Activity Log | 25 — **no** `billing:process`, `results:write`, `results:release`, `rbac:manage` | Approve/reject HMO claims **and lines** · manage catalogue & prices · set opening hours + date overrides · refund · **all report CSV exports** |
| **Receptionist** | `reception-queue` | Active Queue · Walk-In Registration · Appointment Check-In · Visit History · Patient Records | 18 | **QR check-in** · issue queue tickets · attach tests · statutory SC/PWD discount · raise HMO claim · file proof on a patient's behalf · **OCR receipt scan** · sees **wait ETAs** |
| **Cashier** | `cashier-queue` | Billing Queue (`CheckoutTerminal`) · Online Payments · Transaction History · Collections strip · Shift summary | 10 | **The only role that takes money** · verify online proofs → real receipt · refund/void · apply discount · print receipt |
| **Laboratory Staff** | `lab-ops` | Laboratory Worklist · Laboratory History | 6 (`MODALITY`) | Record findings · upload report · **release** · amend (versioned chain) · flag & acknowledge critical values · email report |
| **Ultrasound Staff** | `ultrasound-ops` | Ultrasound Worklist · Ultrasound History | 6 (`MODALITY`) | *identical — differs only by `departments: ['Ultrasound']`* |
| **Xray Staff** | `xray-ops` | X-Ray Worklist · X-Ray History | 6 (`MODALITY`) | *identical — differs only by `departments: ['Xray']`* |
| **Client** | portal tab `results` *(no sidebar)* | Diagnostic Results · Appointments · Payments · Profile | 14 — **all ownership-scoped** | Book/reschedule/cancel · **QR booking pass + wait ETA** · pay from home with **OCR-assisted proof upload** · view own results & receipts · manage dependants' profiles |

---

## Appendix — Verification performed for this report

| Check | Result |
|---|---|
| `node backend/src/scripts/verifyRbacWiring.js` | **All good** — 77 permission-gated routes checked (corroborating the per-route count above), 15 sidebar permissions cross-checked against the API |
| Route/gate extraction | 129 routes parsed directly from `backend/src/routes/*.js` |
| Permission count | 31, extracted from `setupRbac.js` `PERMISSIONS` |
| Role count | 8, extracted from `database/schema.sql` seed |
| Nav items | 11 oversight + 13 operational, extracted from `navigation.js` |
| E2E suite | 295/295 passing, incl. `rbac-enforcement.spec.js`, `api-authorization.spec.js`, `department-scoping.spec.js`, `borrowed-screen-actions.spec.js` |

**One open item for you to decide:** the Cashier / `billing:submit_proof` disagreement in §1.4. It is a genuine matrix-vs-route inconsistency, it is invisible to the current verifier, and I have deliberately left it unchanged.

---

*Generated by static analysis of the codebase at commit `9d6f75a`, branch `main`, version `[1.62.0]`.*
