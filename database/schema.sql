-- Database Schema for Enlogada Ultrasound and Diagnostic Clinic Management System
-- Database: PostgreSQL (Local/Supabase hosted)

-- Drop existing tables to allow clean recreation
DROP TABLE IF EXISTS daily_counters CASCADE;
DROP TABLE IF EXISTS discount_types CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS notification_reads CASCADE;
DROP TABLE IF EXISTS notification_events CASCADE;
DROP TABLE IF EXISTS clinic_schedule_overrides CASCADE;
DROP TABLE IF EXISTS clinic_operating_hours CASCADE;
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS test_results CASCADE;
DROP TABLE IF EXISTS hmo_request_tests CASCADE;
DROP TABLE IF EXISTS hmo_requests CASCADE;
DROP TABLE IF EXISTS hmo_providers CASCADE;
DROP TABLE IF EXISTS visit_tests CASCADE;
DROP TABLE IF EXISTS tests CASCADE;
DROP TABLE IF EXISTS test_categories CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS patient_visits CASCADE;
DROP TABLE IF EXISTS patients CASCADE;
DROP TABLE IF EXISTS patient_types CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- 1. Roles and RBAC
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    contact_number VARCHAR(20),
    status BOOLEAN DEFAULT TRUE,
    -- When the password last changed. verifyToken rejects any token issued before this, which is
    -- what makes "reset the password" actually end a stolen session — there is no server-side
    -- logout and the token lives in localStorage. See migrations.md [1.16.0].
    password_changed_at TIMESTAMP,
    -- Consecutive failed sign-ins, and when the resulting lock expires. The policy is
    -- deliberately forgiving (10 failures, 15 minutes, self-expiring) because a tight lockout is
    -- itself a denial of service against the clinic: anyone who can guess a staff address could
    -- take the front desk offline during the morning rush. See migrations.md [1.19.0].
    failed_login_count INT NOT NULL DEFAULT 0,
    last_failed_login_at TIMESTAMP,
    locked_until TIMESTAMP,
    avatar_path VARCHAR(255),
    avatar_mime_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_roles (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    role_id INT NOT NULL,
    assigned_by INT,
    starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id),
    CONSTRAINT fk_user_roles_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id),
    CONSTRAINT uq_user_role UNIQUE (user_id, role_id)
);

-- Fine-grained permissions (dynamic RBAC matrix). Data is seeded separately by
-- backend/src/scripts/setupRbac.js, which must be run after this schema is applied.
CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    module VARCHAR(50) NOT NULL,
    description TEXT
);

CREATE TABLE role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id)
);

-- Per-account exceptions to what the account's ROLES grant. [1.20.0]
--
-- role_permissions is a template: "a Cashier may do these things." That is the right default and
-- the wrong only option. A real clinic has one receptionist who also covers the till on Saturdays
-- and one lab tech who must not — and expressing that by editing the Cashier role changes it for
-- every cashier, while expressing it by inventing a "Receptionist (Weekend)" role multiplies the
-- roles until the matrix is unreadable.
--
-- So: effective permissions = (union of the account's role permissions) + grants - revokes.
--
-- `effect` carries both directions on purpose. A grant-only table cannot express "everything a
-- Cashier gets, except refunds," which is the more common request of the two and the one with
-- money attached.
CREATE TABLE user_permissions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    permission_id INT NOT NULL,
    effect VARCHAR(10) NOT NULL,
    -- Who made the exception and why, because an override is an unusual thing that someone will
    -- later need explained. Nullable reason: the UI asks but does not insist.
    granted_by INT,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_permissions_granted_by FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_user_permissions_effect CHECK (effect IN ('grant', 'revoke')),
    CONSTRAINT uq_user_permission UNIQUE (user_id, permission_id)
);

CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);

-- (user_departments lives further down, immediately after test_categories — it references that
-- table, and this file is applied top to bottom by migrateDb.js.)

-- Password reset tokens (Module 1: Authentication). Only the SHA-256 hash of the emailed
-- token is stored — never the raw token itself.
CREATE TABLE password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Patients (Only human profiles)
CREATE TABLE patient_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    user_id INT, -- Nullable if registered by receptionist as walk-in without a web account
    patient_type_id INT NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    birthdate DATE NOT NULL,
    sex VARCHAR(20) NOT NULL,
    address TEXT,
    contact_number VARCHAR(20),
    emergency_contact VARCHAR(100),
    -- Where this patient's RESULTS are sent. [1.60.0] The only address used to be users.email,
    -- reached through the NULLABLE user_id -- and reception registers walk-ins at the counter
    -- with no web account, which is how most patients here arrive. Measured the day this was
    -- added: 54 of 56 active patients had no address of any kind, so the delivery feature
    -- [1.59.0] had nowhere to send 40 released reports.
    --
    -- Not unique and not required. A household shares an inbox more often than not, and a UNIQUE
    -- would refuse the second child at the counter for no clinical reason; a patient entitled to
    -- their result is never turned away for not having email. Reads COALESCE this over the
    -- owning account's address -- see findPatientEmailByVisitTestId.
    email VARCHAR(255),
    -- Archived, not deleted. [1.56.0] NULL means active, which is every row without a backfill.
    -- A patient row is the parent of their visits, bills and results; deleting one would either
    -- fail on the foreign keys or take a clinical and financial history with it. Diagnostic
    -- records are retained for years, and a receipt already issued must stay explicable.
    --
    -- archived_by is who decided. Hiding a record from the roster the front desk searches all day
    -- is an editorial act on somebody's medical record, and "who did this" is the first question
    -- asked when a record cannot be found.
    archived_at TIMESTAMP,
    archived_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_patients_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_patients_type FOREIGN KEY (patient_type_id) REFERENCES patient_types(id),
    CONSTRAINT fk_patients_archived_by FOREIGN KEY (archived_by) REFERENCES users(id),
    CONSTRAINT chk_patients_sex CHECK (sex IN ('Male', 'Female'))
);

-- Discount catalogue. Senior Citizen and PWD are mandated by RA 9994 / RA 10754 (20% off
-- medical and diagnostic services); the same shape covers commercial discounts at no extra cost.
-- See migrations.md [1.14.0].
CREATE TABLE discount_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    percentage NUMERIC(5,2) NOT NULL,
    is_statutory BOOLEAN NOT NULL DEFAULT FALSE,  -- mandated by law; cannot be deactivated
    requires_id  BOOLEAN NOT NULL DEFAULT FALSE,  -- OSCA/PWD ID must be recorded on the visit
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_discount_percentage CHECK (percentage >= 0 AND percentage <= 100)
);

-- 3. Visits and Appointments
CREATE TABLE patient_visits (
    id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL,
    visit_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    notes TEXT,
    queue_number VARCHAR(50), -- Tracks the physical queue number generated for receptionist/cashier flow
    -- The doctor who requested the test. A diagnostic report goes back to them, so it needs a line
    -- naming them; the PRC licence number is what makes "Dr. Santos" unambiguous and is what an HMO
    -- asks for. Required on an HMO claim and for the 'Private' patient type (which means
    -- physician-referred at this clinic); optional for Self Pay. See migrations.md [1.23.0] for
    -- the case that rule deliberately leaves unenforced.
    referring_physician VARCHAR(150),
    referring_physician_prc VARCHAR(50),
    -- The discount ENTITLEMENT claimed for this visit. The amount actually deducted is
    -- snapshotted onto payments, so a receipt survives later catalogue edits.
    discount_type_id INT,
    discount_id_number VARCHAR(50),   -- OSCA / PWD ID presented
    discount_granted_by INT,
    discount_granted_at TIMESTAMP,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_visits_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
    CONSTRAINT fk_visits_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_visits_discount_type FOREIGN KEY (discount_type_id) REFERENCES discount_types(id),
    CONSTRAINT fk_visits_discount_granted_by FOREIGN KEY (discount_granted_by) REFERENCES users(id),
    CONSTRAINT chk_visits_type CHECK (visit_type IN ('Walk in', 'Appointment')),
    CONSTRAINT chk_visits_status CHECK (status IN ('Pending', 'Processing', 'Completed', 'Cancelled'))
);

CREATE TABLE appointments (
    id SERIAL PRIMARY KEY,
    patient_visit_id INT NOT NULL UNIQUE,
    appointment_reference VARCHAR(100) NOT NULL UNIQUE, -- Used for QR code generation and lookup
    scheduled_date DATE NOT NULL,
    scheduled_time TIME NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    notes TEXT,
    -- When the day-before reminder went out. NULL means it has not. Exists so the reminder sweep
    -- is safe to re-run, which is what makes it safe to schedule. See migrations.md [1.25.0].
    reminder_sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- When a provisional booking's claim on its slot lapses. NULL means the booking is
    -- permanent, which is every staff booking, every HMO booking and everything paid for.
    --
    -- Only a client's own self-pay booking awaiting an online payment is provisional. Capacity
    -- reads this alongside the status, so an abandoned checkout returns its slot at the exact
    -- moment the hold ends rather than holding it forever -- there is no sweeper, deliberately.
    -- See migrations.md [1.35.0] and src/constants/slotHold.js.
    held_until TIMESTAMP,
    CONSTRAINT fk_appointments_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id),
    CONSTRAINT chk_appointments_status CHECK (status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show'))
);

-- 4. Diagnostic Tests
CREATE TABLE test_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

-- Which modality's data an account may touch. [1.20.0]
--
-- Distinct from permissions, and the distinction is the point. A permission answers "may you
-- write a result?"; a department answers "whose results?" Collapsing the two means either one
-- permission per modality (results:write:laboratory, results:write:xray, …), which multiplies the
-- matrix, or no departmental containment at all — which is what the clinic had: any diagnostic
-- account could search any patient's records regardless of which room they work in.
--
-- An account's departments are derived from its roles by default (Laboratory Staff -> Laboratory;
-- see backend/src/constants/modality.js). Rows here ADD to that set, so covering the X-Ray room
-- for a week is one tick rather than a second role.
CREATE TABLE user_departments (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    category_id INT NOT NULL,
    granted_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_departments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_departments_category FOREIGN KEY (category_id) REFERENCES test_categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_departments_granted_by FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_user_department UNIQUE (user_id, category_id)
);

CREATE INDEX idx_user_departments_user ON user_departments(user_id);

CREATE TABLE tests (
    id SERIAL PRIMARY KEY,
    category_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    -- What the patient must do beforehand: fast for 8 hours, arrive with a full bladder, stop a
    -- medication. Free text, written by clinical staff in the words they already use. NULL means
    -- no preparation is needed, which is true of most Laboratory tests. See migrations.md
    -- [1.24.0] — a patient who is not told this makes a wasted trip and the slot is lost with them.
    preparation TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tests_category FOREIGN KEY (category_id) REFERENCES test_categories(id),
    CONSTRAINT chk_tests_price CHECK (price >= 0),
    CONSTRAINT uq_tests_category_name UNIQUE (category_id, name)
);

-- ── Package deals [1.45.0] ───────────────────────────────────────────────────────────────────
--
-- A package is NOT a `tests` row and cannot be: a row has one category_id, and that is what routes
-- work to a department worklist. Every bundle the clinic sells spans Laboratory AND Ultrasound, so
-- as a single row half the work would never reach the department that has to perform it.
--
-- At booking, packageService.attachPackages expands a package into one visit_tests row per
-- component, with the fixed price spread across them in proportion to their list prices and the
-- remainder on the largest — so the parts sum to the package price EXACTLY. That column is what
-- the visit subtotal, the discount base, the drawer and the per-department revenue report read.
CREATE TABLE test_packages (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    description TEXT,
    -- Retiring is not deleting: booked visits keep their price, the bundle just stops being
    -- offered. The server refuses to book a retired one.
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_test_packages_price CHECK (price >= 0)
);

CREATE TABLE test_package_items (
    id SERIAL PRIMARY KEY,
    package_id INT NOT NULL,
    test_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_package_items_package FOREIGN KEY (package_id) REFERENCES test_packages(id) ON DELETE CASCADE,
    CONSTRAINT fk_package_items_test FOREIGN KEY (test_id) REFERENCES tests(id),
    -- One line per test per bundle. Listing a test twice would double its allocated share.
    CONSTRAINT uq_package_items UNIQUE (package_id, test_id)
);

CREATE INDEX idx_package_items_package ON test_package_items (package_id);
CREATE INDEX idx_package_items_test ON test_package_items (test_id);

CREATE TABLE visit_tests (
    id SERIAL PRIMARY KEY,
    patient_visit_id INT NOT NULL,
    test_id INT NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    price_at_time NUMERIC(10,2) NOT NULL, -- Captures price of the test at the moment of booking/visit
    remarks TEXT,
    -- Which bundle this line came from, when it came from one. [1.45.0] NULL for a test picked
    -- individually. What makes the allocated share traceable back to the package that set it.
    package_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_visit_tests_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id),
    CONSTRAINT fk_visit_tests_test FOREIGN KEY (test_id) REFERENCES tests(id),
    CONSTRAINT fk_visit_tests_package FOREIGN KEY (package_id) REFERENCES test_packages(id),
    -- 'Waiting for Release': the modality has performed the exam and recorded findings, but the
    -- result has not yet been authorised/released to the patient. Sits between 'Processing'
    -- (released to the modality, exam not yet done) and 'Completed' (result released).
    CONSTRAINT chk_visit_tests_status CHECK (status IN ('Pending', 'Approved', 'Processing', 'Waiting for Release', 'Completed', 'Cancelled')),
    CONSTRAINT chk_visit_tests_price CHECK (price_at_time >= 0),
    CONSTRAINT uq_visit_tests_visit_test UNIQUE (patient_visit_id, test_id)
);

-- 5. HMO Integrations (Manual Record Keeping)
CREATE TABLE hmo_providers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE hmo_requests (
    id SERIAL PRIMARY KEY,
    hmo_provider_id INT NOT NULL,
    -- Two different identifiers, deliberately separate. [1.28.0] approval_code is the LOA the HMO
    -- issues when it approves this particular claim; member_number is printed on the patient's
    -- card and identifies them to the provider permanently. Reception used to type both into
    -- approval_code through one box labelled "Card / LOA Number", so a member number was filed as
    -- an approval code on a claim nobody had approved. member_number is also the only place that
    -- number survives: it was previously legible only inside the card photo, and pruneHmoCards
    -- deletes those after 180 days while the claim is kept for seven years.
    approval_code VARCHAR(100),
    member_number VARCHAR(100),
    status VARCHAR(50) DEFAULT 'Pending',
    -- Why a claim was turned down, and who recorded the decision. [1.28.0] `chk_hmo_status` has
    -- allowed 'Rejected' since [1.0.0] with no route able to set it, so a refused claim could only
    -- be approved anyway or left Pending forever. No decided_at column: approved_date above is the
    -- same fact, and two timestamps that must agree eventually will not.
    decision_reason TEXT,
    decided_by INT,
    request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_date TIMESTAMP,
    -- Evidence for the claim. A client booking online attaches a photo of their HMO card; a
    -- receptionist filing the same claim at the desk has the physical card in hand instead, and
    -- is recorded as the verifier. The CHECK below requires one or the other.
    card_file_path VARCHAR(255),
    card_original_name TEXT,
    card_mime_type VARCHAR(100),
    card_size_bytes INT,
    card_uploaded_at TIMESTAMP,
    card_verified_by INT REFERENCES users(id),
    card_verified_at TIMESTAMP,
    card_purged_at TIMESTAMP, -- set when retention removes the image, so a purged card is
                              -- distinguishable from one that was never provided
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hmo_provider FOREIGN KEY (hmo_provider_id) REFERENCES hmo_providers(id),
    CONSTRAINT fk_hmo_requests_decided_by FOREIGN KEY (decided_by) REFERENCES users(id),
    CONSTRAINT chk_hmo_status CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
    -- card_purged_at counts as evidence-of-evidence: retention removes the image but the row
    -- must remain valid, and a purged card stays distinguishable from one never provided.
    CONSTRAINT chk_hmo_request_card_evidence
        CHECK (card_file_path IS NOT NULL OR card_verified_by IS NOT NULL OR card_purged_at IS NOT NULL)
);

-- Undecided claims, newest first — which is exactly what the Admin approval worklist opens on.
CREATE INDEX IF NOT EXISTS idx_hmo_requests_pending
    ON hmo_requests(request_date DESC)
    WHERE status = 'Pending';

CREATE TABLE hmo_request_tests (
    id SERIAL PRIMARY KEY,
    hmo_request_id INT NOT NULL,
    visit_test_id INT NOT NULL,
    approval_status VARCHAR(50) DEFAULT 'Pending',
    -- Why the HMO refused, who recorded it, and when. [1.27.0] The reason is the field the front
    -- desk actually needs: an approval explains itself, a refusal is a conversation at the counter
    -- about money the patient was not expecting to pay, and it used to live only in whatever the
    -- coordinator remembered. All nullable — a decision taken before this existed has no honest
    -- answer, and manufacturing one would put a false statement in the audit trail.
    decision_reason TEXT,
    decided_by INT,
    decided_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hmo_request_tests_request FOREIGN KEY (hmo_request_id) REFERENCES hmo_requests(id),
    CONSTRAINT fk_hmo_request_tests_visit_test FOREIGN KEY (visit_test_id) REFERENCES visit_tests(id),
    CONSTRAINT fk_hmo_request_tests_decided_by FOREIGN KEY (decided_by) REFERENCES users(id),
    CONSTRAINT chk_hmo_request_tests_status CHECK (approval_status IN ('Pending', 'Approved', 'Rejected')),
    CONSTRAINT uq_hmo_request_visit_test UNIQUE (hmo_request_id, visit_test_id)
);

-- At most ONE live claim per test. [1.31.0] uq_hmo_request_visit_test below stops a test being
-- listed twice inside one claim; nothing stopped the same test being claimed by two DIFFERENT
-- requests, and getBillingSummary had to defend against that at read time with a correlated
-- subquery or a JOIN would duplicate the line item and inflate the bill.
--
-- Partial rather than absolute, on purpose: if a provider refuses, re-claiming the same test with
-- a second provider is legitimate and is what a patient carrying two cards would expect. Rejected
-- rows stay free to accumulate because each carries a reason and a decider [1.27.0] — the answer
-- to "why am I being charged for this".
CREATE UNIQUE INDEX IF NOT EXISTS uq_hmo_one_live_claim_per_test
    ON hmo_request_tests (visit_test_id)
 WHERE approval_status <> 'Rejected';


-- Undecided rows only: the screen that reads these is "claims still waiting on a decision", and
-- decided rows are the overwhelming majority, read one claim at a time by id.
CREATE INDEX IF NOT EXISTS idx_hmo_request_tests_pending
    ON hmo_request_tests(hmo_request_id)
    WHERE approval_status = 'Pending';

-- 6. Results and Releasing
CREATE TABLE test_results (
    id SERIAL PRIMARY KEY,
    -- NOT unique: a test carries one row per VERSION. Exactly one of them is current, enforced by
    -- the partial unique index uq_test_results_current_per_test below. The old UNIQUE here is
    -- what made a correction overwrite the original — see migrations.md [1.15.0].
    visit_test_id INT NOT NULL,
    file_path TEXT,
    file_original_name TEXT,
    file_mime_type TEXT,
    file_size_bytes INT,
    findings TEXT,
    remarks TEXT,
    -- Two distinct actors, because recording findings and authorising their release are two
    -- distinct clinical events — that is exactly what the 'Waiting for Release' state exists
    -- for. A single column could only ever name one of them, and named the wrong one whenever
    -- they differed. See migrations.md [1.12.0].
    recorded_by INT,                                  -- who wrote the findings
    released_by INT NOT NULL,                         -- who authorised release to the patient
    released_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- when the findings were recorded
    authorised_at TIMESTAMP,                          -- when the release was authorised

    -- Amendment chain. A released report may be corrected, and the version it replaces must stay
    -- readable: the patient may already have acted on it, and a referring physician certainly
    -- may have. superseded_by points forward, version counts backward.
    version INT NOT NULL DEFAULT 1,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    superseded_by INT,
    amendment_reason TEXT,

    -- Critical (panic) values. The flag routes an urgent callback notification on release; the
    -- acknowledgement is the record that a human actually made contact, which is the part with
    -- medico-legal weight.
    is_critical BOOLEAN NOT NULL DEFAULT FALSE,
    critical_acknowledged_at TIMESTAMP,
    critical_acknowledged_by INT,
    critical_acknowledgement_note TEXT,

    -- Whether this report actually reached the patient. [1.59.0] Release has emailed the patient
    -- since the first version and recorded nothing about it, so "was she ever told?" had no
    -- answer anywhere. One row per VERSION turns out to be exactly right here: an amendment
    -- creates a new row, so a v2 correctly starts with emailed_at NULL -- the patient has been
    -- sent v1 and has NOT been sent v2, and the schema says so without anyone reasoning about it.
    --
    -- emailed_at records the last SUCCESSFUL send and nothing else, so IS NULL means "this report
    -- has never reached the patient" with no second reading. A failed attempt is reported to the
    -- technician at the time and recorded in audit_log; it must not touch a column whose whole
    -- value is being unambiguous.
    emailed_at TIMESTAMP,
    emailed_to VARCHAR(255),
    email_count INT NOT NULL DEFAULT 0,

    CONSTRAINT fk_results_superseded_by FOREIGN KEY (superseded_by) REFERENCES test_results(id),
    CONSTRAINT fk_results_critical_ack_by FOREIGN KEY (critical_acknowledged_by) REFERENCES users(id),
    CONSTRAINT fk_results_visit_test FOREIGN KEY (visit_test_id) REFERENCES visit_tests(id),
    CONSTRAINT fk_results_released_by FOREIGN KEY (released_by) REFERENCES users(id),
    CONSTRAINT fk_results_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id)
);

-- 7. Billing and Payments
-- ── Manual proof of payment [1.48.0] ─────────────────────────────────────────────────────────
--
-- The clinic takes online payment WITHOUT a gateway. SuperAdmin publishes its own GCash/bank
-- details and QR here; the patient pays, uploads a screenshot with the reference, and a cashier
-- verifies it. Approval runs the EXISTING paymentService.processPayment, so it gets a real receipt
-- number, the visit release and the cash-up entry — never a parallel money writer.
--
-- `kind` is constrained to the three buckets `payments` accepts, because that is what the approved
-- submission settles into. The clinic's own naming goes in `label`.
--
-- Publishing an account number is SuperAdmin ONLY and audited: it is where a patient's money is
-- sent, and a wrong number redirects real payments with no error anywhere.
CREATE TABLE payment_methods (
    id SERIAL PRIMARY KEY,
    kind VARCHAR(50) NOT NULL,
    label VARCHAR(120) NOT NULL,
    account_name VARCHAR(150),
    account_number VARCHAR(100),
    bank_name VARCHAR(120),
    instructions TEXT,
    qr_file_path VARCHAR(255),
    qr_original_name TEXT,
    qr_mime_type VARCHAR(100),
    qr_size_bytes INT,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_payment_methods_kind CHECK (kind IN ('Cash', 'GCash', 'Bank'))
);

CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    patient_visit_id INT NOT NULL,
    processed_by INT NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    reference_number VARCHAR(100),
    receipt_number VARCHAR(100), -- Explicitly added for cashier tracking
    amount NUMERIC(10,2) NOT NULL,
    payment_status VARCHAR(50) DEFAULT 'Paid',
    refund_reason TEXT,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- WHEN the receipt was reversed, which is a different day from when it was paid. [1.30.0]
    -- The cash-up buckets money taken IN by paid_at and money handed BACK by this column, so
    -- reversing an older receipt lands on the day the drawer is short instead of silently
    -- restating a day that has already been printed and filed. NULL for anything not reversed.
    refunded_at TIMESTAMP,
    -- Online payment gateway linkage (GCash / Maya via PayMongo hosted checkout). NULL for
    -- payments recorded at the counter by a cashier. A gateway payment is inserted as
    -- 'Pending' when checkout starts and only flips to 'Paid' when the signed
    -- 'checkout_session.payment.paid' webhook arrives — never from the browser redirect,
    -- which is attacker-controllable.
    gateway_provider VARCHAR(30),
    gateway_session_id VARCHAR(120),
    gateway_payment_id VARCHAR(120),
    -- Snapshot of the discount actually deducted. Deliberately NOT a reference to
    -- discount_types: a receipt is a historical record and must keep saying what it said even if
    -- the catalogue is renamed or re-rated. Same reasoning as visit_tests.price_at_time. This is
    -- also what the BIR statutory register reads.
    discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- VAT removed because the sale was VAT-EXEMPT (Senior Citizen / PWD at a VAT-registered
    -- clinic). With it the sale reconciles from this row alone:
    --   amount + discount_amount + vat_amount = the VAT-inclusive price the patient was quoted.
    -- See migrations.md [1.17.0].
    vat_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    discount_type_name VARCHAR(50),
    discount_id_number VARCHAR(50),
    CONSTRAINT chk_payments_discount_nonneg CHECK (discount_amount >= 0),
    CONSTRAINT chk_payments_vat_nonneg CHECK (vat_amount >= 0),
    CONSTRAINT fk_payments_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id),
    CONSTRAINT fk_payments_processed_by FOREIGN KEY (processed_by) REFERENCES users(id),
    -- The methods the clinic can actually settle. PayMaya was removed in [1.33.0] — the owner
    -- holds no PayMaya merchant account, so offering it was offering a way to pay that nobody
    -- could collect. Kept in step with backend/src/constants/paymentMethods.js, which builds
    -- this constraint via migratePaymentMethods.js; widen it there, not here.
    CONSTRAINT chk_payment_method CHECK (payment_method IN ('Cash', 'GCash', 'Bank')),
    CONSTRAINT chk_payment_status CHECK (payment_status IN ('Pending', 'Paid', 'Failed', 'Refunded', 'Cancelled')),
    CONSTRAINT chk_payment_amount CHECK (amount >= 0),
    CONSTRAINT uq_payments_gateway_session UNIQUE (gateway_session_id)
);

-- Webhook lookups resolve a checkout session back to its pending payment row.
CREATE INDEX idx_payments_gateway_session ON payments(gateway_session_id);

-- 8. Clinic Availability
-- The patient's claim that they have paid, and the cashier's decision on it. [1.48.0]
--
-- `amount_claimed` is EVIDENCE, never an instruction. Approval bills the recomputed visit total,
-- so a patient typing 50 on a ₱1,450 visit cannot produce a ₱50 payment even if a cashier
-- approves it — which is why the review queue shows amount_due beside amount_claimed.
--
-- `payment_id` links to the receipt approval produced. NULL until then, and NULL forever on a
-- rejection.
CREATE TABLE payment_submissions (
    id SERIAL PRIMARY KEY,
    patient_visit_id INT NOT NULL,
    payment_method_id INT,
    reference_number VARCHAR(100) NOT NULL,
    amount_claimed NUMERIC(10,2) NOT NULL,
    proof_file_path VARCHAR(255),
    proof_original_name TEXT,
    proof_mime_type VARCHAR(100),
    proof_size_bytes INT,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending',
    submitted_by INT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INT,
    reviewed_at TIMESTAMP,
    review_note TEXT,
    payment_id INT,
    CONSTRAINT fk_paysub_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id),
    CONSTRAINT fk_paysub_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
    CONSTRAINT fk_paysub_submitted_by FOREIGN KEY (submitted_by) REFERENCES users(id),
    CONSTRAINT fk_paysub_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id),
    CONSTRAINT fk_paysub_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
    CONSTRAINT chk_paysub_status CHECK (status IN ('Pending', 'Verified', 'Rejected')),
    CONSTRAINT chk_paysub_amount CHECK (amount_claimed >= 0)
);

-- One LIVE claim per visit, so two cashiers cannot take the same money twice. Partial, because a
-- rejected submission must not block the patient from trying again.
CREATE UNIQUE INDEX uq_paysub_one_live_per_visit
    ON payment_submissions (patient_visit_id) WHERE status = 'Pending';

CREATE INDEX idx_paysub_visit ON payment_submissions (patient_visit_id);
CREATE INDEX idx_paysub_method ON payment_submissions (payment_method_id);
CREATE INDEX idx_paysub_submitted_by ON payment_submissions (submitted_by);
CREATE INDEX idx_paysub_reviewed_by ON payment_submissions (reviewed_by);
CREATE INDEX idx_paysub_payment ON payment_submissions (payment_id);
-- The cashier's queue: pending only, newest first.
CREATE INDEX idx_paysub_pending ON payment_submissions (submitted_at) WHERE status = 'Pending';

CREATE TABLE clinic_operating_hours (
    id SERIAL PRIMARY KEY,
    day_of_week SMALLINT NOT NULL UNIQUE, -- 0=Sunday .. 6=Saturday
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    open_time TIME,
    close_time TIME,
    slot_interval_minutes SMALLINT NOT NULL DEFAULT 30,
    max_concurrent_bookings SMALLINT NOT NULL DEFAULT 1,
    CONSTRAINT chk_operating_hours_day CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT chk_operating_hours_times CHECK (
      is_open = FALSE OR (open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time)
    )
);

-- What the clinic does on ONE specific date, instead of what its weekday says. [1.57.0]
--
-- The weekly pattern above cannot express "closed this Thursday" or "half capacity on the 30th",
-- and editing the weekday row to say so would change every Thursday forever. So: one row per
-- overridden date, with every field except the date NULLABLE. NULL means "keep the weekday's
-- answer", which is why closing a day is a single row carrying is_open=false and nothing else,
-- and why every read of these columns uses ?? rather than || -- a capacity of 0 is a real,
-- deliberate value meaning "open, but taking no online bookings today".
--
-- `note` is shown to the PATIENT on the booking screen. A closed day with no reason reads as a
-- broken website; "Closed -- Holy Week" reads as a clinic that is shut.
CREATE TABLE clinic_schedule_overrides (
    id SERIAL PRIMARY KEY,
    override_date DATE NOT NULL UNIQUE,
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    open_time TIME,
    close_time TIME,
    slot_interval_minutes INT,
    max_concurrent_bookings INT,
    note VARCHAR(200),
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_schedule_override_creator FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT chk_schedule_override_interval CHECK (slot_interval_minutes IS NULL OR slot_interval_minutes BETWEEN 5 AND 240),
    CONSTRAINT chk_schedule_override_capacity CHECK (max_concurrent_bookings IS NULL OR max_concurrent_bookings >= 0),
    -- Both times or neither. Half a range is not a schedule, and the slot builder would read the
    -- missing half from the weekday and produce a window nobody chose.
    CONSTRAINT chk_schedule_override_times CHECK (
      (open_time IS NULL AND close_time IS NULL)
      OR (open_time IS NOT NULL AND close_time IS NOT NULL AND close_time > open_time)
    )
);

-- Serves the admin list, which reads forward from today. The per-date lookup on the booking path
-- is already served by the UNIQUE on override_date.
CREATE INDEX idx_schedule_overrides_date ON clinic_schedule_overrides (override_date DESC);

-- 9. Notifications (Module 18). Split into two tables rather than one flat, per-recipient
-- table: an event (title/message/type) is a fact that exists once and never changes; who has
-- read it is a separate, per-user, mutable fact. Flattening both into one row per recipient
-- (the original design) duplicated the event text N times per broadcast and offered no single
-- place to correct it. This shape avoids that duplication and matches the real entities.
CREATE TABLE notification_events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'info',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_notification_events_type CHECK (type IN ('info', 'success', 'warning', 'critical'))
);

CREATE TABLE notification_reads (
    id SERIAL PRIMARY KEY,
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    CONSTRAINT fk_notification_reads_event FOREIGN KEY (event_id) REFERENCES notification_events(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_reads_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT uq_notification_reads_event_user UNIQUE (event_id, user_id)
);
CREATE INDEX idx_notification_reads_user ON notification_reads(user_id, is_read);

-- 10. Audit Log (Feature Gap Plan Phase D). Denormalized actor_name (rather than requiring a
-- join to users every time the log is read) since the log must remain legible even if the
-- actor's account is later deleted or renamed — it's a record of what happened, not a live
-- view of current user data. Scoped to the sensitive actions this phase's other work
-- introduced (payment status changes, staff account changes, HMO provider changes, result
-- corrections) rather than instrumenting every write in the app.
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    -- ON DELETE SET NULL so the log genuinely outlives the actor, which is what the note above
    -- claims. Previously NO ACTION, which made deleting such a user impossible and contradicted
    -- the very reason actor_name is denormalized. Never CASCADE: removing a user must not erase
    -- the record of what they did.
    actor_id INT REFERENCES users(id) ON DELETE SET NULL,
    actor_name VARCHAR(200) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT,
    description TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- No separate DESC index on audit_log(created_at): idx_audit_log_created below is ASC and a
-- B-tree is scannable in both directions, so it already serves ORDER BY created_at DESC. The
-- duplicate was costing a write on every audit row, and audit_log records PHI reads. [1.29.0]

-- Seed Initial Data
INSERT INTO roles (name) VALUES
('SuperAdmin'),
('Admin'),
('Receptionist'),
('Cashier'),
('Laboratory Staff'),
('Xray Staff'),
('Ultrasound Staff'),
('Client');

INSERT INTO patient_types (name) VALUES
('HMO'),
('Private'),
('Self Pay');

-- [1.50.0] '2D Echo' removed: the clinic does not offer it. 'ECG' is likewise not offered and its
-- tests are deactivated by seedRealCatalogue.js, but the CATEGORY row stays because historical
-- visit_tests may still point at it — a past visit has to keep being able to say what it was for.
INSERT INTO test_categories (name) VALUES
('Laboratory'),
('Xray'),
('Ultrasound'),
('ECG');

INSERT INTO hmo_providers (name) VALUES
('1CoopHealth');

-- Seed Diagnostic Tests (Human Patients Only)
INSERT INTO tests (category_id, name, price) VALUES
-- Laboratory Tests
(1, 'Complete Blood Count (CBC)', 350.00),
(1, 'Urinalysis', 150.00),
(1, 'Fasting Blood Sugar (FBS)', 200.00),
(1, 'Lipid Profile', 850.00),
(1, 'HbA1c', 750.00),
-- X-Ray Tests
(2, 'Chest X-Ray (PA)', 450.00),
(2, 'Chest X-Ray (AP/Lateral)', 650.00),
(2, 'Abdominal X-Ray', 550.00),
-- Ultrasound Tests
(3, 'Pelvic Ultrasound', 1200.00),
(3, 'Abdominal Ultrasound', 1500.00),
(3, 'Thyroid Ultrasound', 1000.00),
(3, 'Breast Ultrasound', 1200.00),
-- ECG Tests
(4, '12 Lead ECG', 480.00);

-- Seed Clinic Operating Hours (Mon-Fri 08:00-17:00, Sat 08:00-12:00, Sun closed, 30-min slots)
INSERT INTO clinic_operating_hours (day_of_week, is_open, open_time, close_time, slot_interval_minutes, max_concurrent_bookings) VALUES
(0, FALSE, NULL, NULL, 30, 1),
(1, TRUE, '08:00', '17:00', 30, 1),
(2, TRUE, '08:00', '17:00', 30, 1),
(3, TRUE, '08:00', '17:00', 30, 1),
(4, TRUE, '08:00', '17:00', 30, 1),
(5, TRUE, '08:00', '17:00', 30, 1),
(6, TRUE, '08:00', '12:00', 30, 1);

-- 11. Indexes on foreign keys and status columns ([1.11.0]).
--
-- PostgreSQL indexes PRIMARY KEY and UNIQUE columns automatically but NOT foreign keys. Without
-- these, every join across the visit chain and every queue filter is a sequential scan, and each
-- delete of a parent row scans the whole child table to check for references. Harmless on a small
-- database; it is the kind of thing that turns instant screens slow all at once after a year of
-- real visits. Mirrored by src/scripts/migrateIndexes.js for existing databases.
CREATE INDEX IF NOT EXISTS idx_patients_user ON patients(user_id);
CREATE INDEX IF NOT EXISTS idx_patient_visits_patient ON patient_visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visit_tests_visit ON visit_tests(patient_visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_tests_test ON visit_tests(test_id);
CREATE INDEX IF NOT EXISTS idx_test_results_visit_test ON test_results(visit_test_id);
CREATE INDEX IF NOT EXISTS idx_payments_visit ON payments(patient_visit_id);
CREATE INDEX IF NOT EXISTS idx_appointments_visit ON appointments(patient_visit_id);
CREATE INDEX IF NOT EXISTS idx_hmo_request_tests_request ON hmo_request_tests(hmo_request_id);
CREATE INDEX IF NOT EXISTS idx_hmo_request_tests_visit_test ON hmo_request_tests(visit_test_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_event ON notification_reads(event_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tests_category ON tests(category_id);
CREATE INDEX IF NOT EXISTS idx_patient_visits_status ON patient_visits(status);
CREATE INDEX IF NOT EXISTS idx_visit_tests_status ON visit_tests(status);
-- No single-column index on payments(payment_status): idx_payments_status_paid_at leads with
-- that column and therefore already serves a bare status filter. [1.29.0]
-- The cash-up's "what was reversed in this range" question; paid_at's index cannot serve it.
-- Partial: almost no payment is ever reversed, so the rest have no business in this index. [1.30.0]
CREATE INDEX IF NOT EXISTS idx_payments_refunded_at ON payments (refunded_at) WHERE refunded_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_date, scheduled_time);
-- The reminder sweep's own access path. Partial, because it only ever looks for bookings that are
-- still Pending and have not been reminded yet. Present in migrateAppointmentReminders.js but
-- missing here, so a database built fresh from this file lacked the index it is designed around.
CREATE INDEX IF NOT EXISTS idx_appointments_pending_reminder
    ON appointments (scheduled_date)
    WHERE reminder_sent_at IS NULL AND status = 'Pending';
CREATE INDEX IF NOT EXISTS idx_patient_visits_created ON patient_visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_released_by ON test_results(released_by);
CREATE INDEX IF NOT EXISTS idx_notification_events_created ON notification_events(created_at DESC);
-- "Who accessed this patient's data?" is the only question audit_log is asked during an incident,
-- so that is what this serves. The second supports the retention sweep (pruneAuditLog.js), which
-- matters now that PHI reads are logged and the table finally has a growth profile.
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_created ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at);

-- Foreign keys on the tables that grow with how busy the clinic is. [1.29.0] Measured on a
-- same-shaped audit_log of 300,000 rows — about a year here, since PHI reads are audited too:
-- the activity log's first page went 87.3ms -> 0.9ms, and "everything one member of staff
-- touched" — the query a breach investigation runs — went 58.0ms -> 5.8ms.
--
-- Deliberately NOT indexed: user_roles.assigned_by, role_permissions.permission_id,
-- user_permissions.*, user_departments.*. Those are bounded by the number of staff and the
-- number of permissions, a couple of hundred rows that never grow with patient volume, and on a
-- table that fits in a page or two a sequential scan beats an index lookup. Indexing them would
-- buy nothing and be paid for on every write — the same mistake as the two indexes removed above.
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_payments_processed_by ON payments(processed_by);
CREATE INDEX IF NOT EXISTS idx_patient_visits_created_by ON patient_visits(created_by);
CREATE INDEX IF NOT EXISTS idx_patient_visits_discount_type ON patient_visits(discount_type_id);
CREATE INDEX IF NOT EXISTS idx_patient_visits_discount_granted_by ON patient_visits(discount_granted_by);
CREATE INDEX IF NOT EXISTS idx_patients_type ON patients(patient_type_id);
CREATE INDEX IF NOT EXISTS idx_test_results_critical_ack_by ON test_results(critical_acknowledged_by);
CREATE INDEX IF NOT EXISTS idx_test_results_superseded_by ON test_results(superseded_by);
CREATE INDEX IF NOT EXISTS idx_hmo_requests_provider ON hmo_requests(hmo_provider_id);
CREATE INDEX IF NOT EXISTS idx_hmo_requests_decided_by ON hmo_requests(decided_by);
CREATE INDEX IF NOT EXISTS idx_hmo_request_tests_decided_by ON hmo_request_tests(decided_by);

-- =====================================================================================
-- Daily counters — see migrations.md [1.13.0]
--
-- Queue tickets and receipt numbers were previously derived from SELECT COUNT(*) + 1 and then
-- written by a separate INSERT. A read followed by an unrelated write is not a sequence: two
-- receptionists registering in the same moment issued the same ticket, and two cashiers settling
-- together issued the same official receipt number. Counting surviving rows rather than
-- issuances also meant a cancellation or a refund rewound the sequence and reissued a number
-- that had already been printed and handed to a patient.
--
-- One row per (day, counter), incremented by the database itself:
--   INSERT INTO daily_counters (counter_date, counter_name, last_number)
--   VALUES (CURRENT_DATE, 'queue', 1)
--   ON CONFLICT (counter_date, counter_name)
--   DO UPDATE SET last_number = daily_counters.last_number + 1
--   RETURNING last_number;
-- ON CONFLICT DO UPDATE takes a row lock, so concurrent callers serialise.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS daily_counters (
    counter_date DATE NOT NULL,
    counter_name TEXT NOT NULL,          -- 'queue' | 'receipt'
    last_number  INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (counter_date, counter_name),
    CONSTRAINT chk_daily_counters_nonneg CHECK (last_number >= 0)
);

-- Uniqueness the counters above are meant to guarantee, enforced by the database so a future
-- code path cannot quietly reintroduce a duplicate.
-- Statutory discounts mandated by RA 9994 (Senior Citizen) and RA 10754 (PWD).
INSERT INTO discount_types (name, percentage, is_statutory, requires_id)
VALUES ('Senior Citizen', 20.00, TRUE, TRUE),
       ('PWD',            20.00, TRUE, TRUE)
ON CONFLICT (name) DO NOTHING;

-- The statutory discount register BIR expects for mandated discounts.
CREATE INDEX IF NOT EXISTS idx_payments_discount_type
    ON payments (discount_type_name, paid_at) WHERE discount_type_name IS NOT NULL;

-- Exactly one CURRENT result per test. This replaces the old UNIQUE(visit_test_id), which
-- prevented any second version existing at all and so forced a correction to overwrite the
-- original in place.
CREATE UNIQUE INDEX IF NOT EXISTS uq_test_results_current_per_test
    ON test_results (visit_test_id) WHERE is_current;

-- Released reports the patient has not been sent. Partial, because that set is the minority and
-- always will be: the index covers the rows worth chasing, not the whole table.
CREATE INDEX IF NOT EXISTS idx_test_results_undelivered
    ON test_results (visit_test_id) WHERE is_current AND emailed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_test_results_visit_test_version
    ON test_results (visit_test_id, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_visits_daily_queue
    ON patient_visits ((created_at::date), queue_number) WHERE queue_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_receipt_number
    ON payments (receipt_number) WHERE receipt_number IS NOT NULL;
-- Partial on 'Paid': a visit may accumulate Cancelled/Failed gateway attempts and a Refunded row
-- alongside its one live payment, but never two settled charges.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_paid_per_visit
    ON payments (patient_visit_id) WHERE payment_status = 'Paid';

-- ── Indexes the later migrations added, folded back [1.54.0] ─────────────────────────────────
--
-- These existed only inside migrateQueryPerformance.js, migrateIndexHygiene.js and the feature
-- migrations that introduced their columns, so a database rebuilt from THIS file came up
-- functionally correct and measurably slower — with no error to say why. Ten of them were
-- missing; the whole point of the file being the source of truth is that this list matches.
--
-- Every one is on a raw column, never an expression: a B-tree cannot serve a predicate on
-- `col::date`, which is why the money and queue queries use half-open ranges. See CLAUDE.md.

-- The date-ranged screens: the cashier's cash-up, the reports, the visit history.
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments (paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status_paid_at ON payments (payment_status, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_visits_status_created ON patient_visits (status, created_at);
CREATE INDEX IF NOT EXISTS idx_visit_tests_created_at ON visit_tests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_released_at ON test_results (released_at DESC);

-- Foreign keys that grew with later features and had no index of their own.
CREATE INDEX IF NOT EXISTS idx_test_results_recorded_by ON test_results (recorded_by);
CREATE INDEX IF NOT EXISTS idx_hmo_requests_card_verified_by ON hmo_requests (card_verified_by);

-- Partial, because the rows that matter are a small minority of the table.
-- A held slot is released after 15 minutes [1.35.0]; the sweeper reads only rows that hold one.
CREATE INDEX IF NOT EXISTS idx_appointments_held_until
    ON appointments (held_until) WHERE held_until IS NOT NULL;
-- Most visits are self-pay walk-ins with no referrer [1.23.0].
CREATE INDEX IF NOT EXISTS idx_patient_visits_referring_physician
    ON patient_visits (referring_physician) WHERE referring_physician IS NOT NULL;
-- Most visit_tests are picked individually rather than as part of a bundle [1.45.0].
CREATE INDEX IF NOT EXISTS idx_visit_tests_package
    ON visit_tests (package_id) WHERE package_id IS NOT NULL;
-- Archived records are the minority and always will be, so this covers the rows the roster query
-- EXCLUDES rather than the whole table. [1.56.0]
CREATE INDEX IF NOT EXISTS idx_patients_archived
    ON patients (archived_at) WHERE archived_at IS NOT NULL;

-- Lookup by address, lowercased to match how the service stores it. Partial: only rows that have
-- one, which is the minority today and always the point of the index.
CREATE INDEX IF NOT EXISTS idx_patients_email
    ON patients (LOWER(email)) WHERE email IS NOT NULL;
