# Database Migration & Schema History

## [1.132.0] - 2026-10-19 (Payment first, for every booking)

Run on an existing database: `node src/scripts/migrateHmoApprovalFirst.js`. Data only, no schema
change: a booking not yet checked in or paid whose claim is still undecided holds its slot until
its own start (one already past it is then released by the next sweep, and logged), and one from
today on whose claim was refused in full gets the payment window from now. No email is sent from
the migration. `--rollback` clears the holds of HMO bookings, so they take their slot for good again.
On the dev database it changed nothing (no HMO bookings).

Steven: "but our rule is payment first remember", about the two kinds of booking [1.131.0] still let
take a slot unpaid. His answers: a desk booking "Only if paid on the spot" (no holding), and an HMO
booking "HMO approval first".
- **A booking made at the desk is paid as it is made.** A staff `POST /appointments` with no HMO
  claim carries `payment: { paymentMethod, amount, referenceNumber? }` and is paid in the booking's
  own transaction through `paymentService.processPayment` (one receipt, the visit's bill checked
  against the amount as at the till); without it, 400. Booking needs `visits:create`,
  `tests:assign` and `billing:process` (an HMO booking `hmo:request` instead): Receptionist alone
  and Admin are refused 403, as is any department. Before this, POST /appointments checked no
  permission for staff at all. A patient sending `payment` with their own booking gets 400.
- **An HMO booking is kept once its HMO approves it.** It holds its slot until its own start while
  the claim waits. Approved (something covered, nothing still waiting): kept, as if paid. Refused
  in full: the payment window from the refusal, then released like any unpaid booking. Undecided at
  its start: released ("its HMO had not approved it by the time it was booked for"). The patient is
  emailed the HMO's answer. Service Requests shows "Booking: decide by …" on a claim with a booking
  waiting; the portal shows "Waiting for your HMO's approval" rather than a pay panel, a pass once
  approved ("Approved by your HMO"), and the pay panel once refused.
- **Fixed on the way:** the unpaid sweep read only each test's own HMO column, so a visit whose
  claim was refused as a whole looked like it was still waiting for good and was never removed.
  It reads `hmoEffectiveStatus` now, as the bill does. `amount_due` on the patient's bookings is
  now their share (less what the HMO approved), and `e2eReleaseTestDate.js` removes leftover
  bookings rather than marking them Cancelled.
- The demo seed's desk bookings are made by Rhea Tan (Receptionist + Cashier) and paid there.
- `payment-first.spec.js` (6 tests); `booking-atomicity`'s "an HMO booking is permanent" became
  "holds its slot until its own start"; `booking-queue` books as the patient (a desk booking is
  paid, so it goes straight to the departments at check-in).

## [1.131.0] - 2026-10-19 (Unpaid is temporary; paid is final; nothing is cancelled)

Run on an existing database: `node src/scripts/migrateUnpaidIsTemporary.js`. It removes every
visit that is Cancelled, or whose booking is Cancelled or a No Show, and that never had a receipt
(one Activity Log line each; on the dev database: 9, all closed by [1.130.0] hours before), drops
`patient_visits.closed_reason` / `closed_at`, and retires `appointments:cancel`. `--rollback` puts
the two columns back empty; removed visits are not restored. [1.130.0]'s `migrateVisitClosure.js`
is deleted, as what it added is gone. New setting `UNPAID_EXPIRY` (blank keeps it on);
[1.130.0]'s `DAY_CLOSE` is gone.

Steven, asking what "Cancelled" is for when there are no refunds: "our rule is a booking should be
paid first ... for the walkin once its processed no takebacks. walkin need to pay in order for
their test to continue so thats only temporary since they not paid yet and cancelled should be
removed same in the visit history". His answers: deleted for good with an Activity Log line; no
manual remove, only expiry; HMO and staff bookings removed after their day like any unpaid one
("still he need to come").
- **Unpaid is removed when its time is up**, every five minutes (`jobs/unpaidExpiryScheduler.js`,
  `removeExpiredUnpaid.js` to run it now): an unpaid walk-in after its day; an unpaid booking after
  its day (staff and HMO too); a patient's own booking once its time to pay runs out. Its tests,
  booking, proofs and uploaded files go with it; one Activity Log line stays ("Removed the booking
  APT-... for Oct 16 (name: tests): nobody came on Oct 16, and it was not paid."), and a released
  booking emails its patient. Never anything waiting on an HMO decision or an online proof to
  check, and never anything that ever had a receipt.
- **Nothing is cancelled or marked a no-show by hand.** The booking cancel route is gone (404), a
  booking's only manual status is check-in, a visit's Cancelled is refused (409) paid or not. The
  Desk's Cancel and "Mark as No-Show", the portal's Cancel, Visit History's and Appointments'
  Cancelled / No Show filters, the reception report's Cancelled count and the "Cancel a booking"
  switch on Who sees what are gone. The cancellation email is gone; a released booking has its own.
- [1.130.0]'s end-of-day close becomes this: it closed with a reason, and now removes.
- Specs free what they booked or opened unpaid with `removeUnpaid()` (`e2eRemoveUnpaid.js`, which
  refuses anything paid) instead of a cancel route.

## [1.130.0] - 2026-10-19 (Reminders send themselves; a visit asks for every permission it uses; what a day leaves open is closed)

Superseded by [1.131.0] the same day: its `migrateVisitClosure.js` (`patient_visits.closed_reason`
and `closed_at`) and the `DAY_CLOSE` setting are gone, and [1.131.0]'s migration drops the columns.
Still here: `APPOINTMENT_REMINDERS` (on when blank).

**What an earlier day leaves open.** Steven: "check if everything that all processes MAKE SENSE",
over Visit History showing walk-ins from Oct 16 and 17 still "Pending". Measured on the dev
database: 7 unpaid walk-ins from earlier days and 3 bookings whose day had passed, all 'Pending'
for good. Today's queue is today's, and so is the till's, so nothing could pay for them or serve
them, and Visit History read them as waiting.
- The server closes them (`jobs/dayCloseScheduler.js`, every half hour; `closeEarlierDays.js` runs
  it now): an unpaid walk-in becomes Cancelled, "Not paid by the end of Oct 16, 2026"; an unpaid
  booking nobody came for becomes a No Show, its visit "No show on Oct 16, 2026". Each is in the
  Activity Log by "System (end of day)". First run on the dev database: 6 walk-ins and 3 no-shows;
  the seventh walk-in waits on an HMO decision and was left, as anything waiting on someone is.
- Never anything paid. A paid booking nobody came for is listed on the Desk, "Paid bookings nobody
  came for", with Reschedule: with no refunds, it is moved.
- A No Show marked by hand closes its visit too; it used to stay 'Pending'.
- Visit History and the patient's record say why a visit closed, under its status.
- A booking not paid within its time to pay released its slot ([1.123.0]) but was still listed in
  "Still to arrive" with Check in, where the desk could seat it on top of whoever took the slot.
  It is named under the table instead ("not paid in time, so the slot was released; if they come,
  start a walk-in visit") and check-in refuses it.
- Everything else checked consistent: no finished visit with an unfinished test, no payment on a
  cancelled visit, no unpaid work at a department, no Processing visit with every test done.

**A patient moving a booking not paid in time.** Steven: "how about if patient side will
reschedule?" The portal said "This booking wasn't paid in time ... Book again" and still offered
Reschedule, and the move landed with its lapsed hold: a booking on a slot it did not hold, which
could not be paid (a late proof is refused) and could not be checked in. Moving it is choosing a
time again, so the new slot is now held for a fresh time to pay (the gateway's window, or the
manual one), and the portal says "Reschedule it to choose a time again, then pay before the new
deadline". A booking still inside its time to pay keeps its deadline when moved. The rest of a
patient's move already held: only a waiting booking moves, with a reason; not into the past, an
hour already gone today, a closed day or past the 365-day horizon; the desk is notified and the
patient emailed; the reminder is re-planned from the move; a paid booking keeps its payment.

**"PM" on a line of its own.** Visit History's Date column broke "Oct 18, 2026, 7:35 PM" before
"PM". `components/ui/date-time.jsx` keeps the date and the time each whole, so a narrow column
breaks only between them; used in every table that shows a date and time (Visit History, a
department's History, Transaction History, Cashier Monitoring, the Activity Log, report versions,
the verification page).

**Where a reschedule is seen.** Steven asked where. The patient moves a booking from the portal
(Appointments, "Moved · reason" on the card), the Desk from a booking's check-in card, and Admin's
Appointments screen lists the move and why. "Still to arrive" now shows it too ("Moved · reason")
and has its own Reschedule button on every row.

**Reminders are automatic.** Steven: send the reminder the day before, and when the appointment
is closer than that, at half the time left (30 minutes away: 15 minutes before; 2 hours away: 1
hour before), "if you have better logic for the caveat, let's implement that". Until now it was a
script someone had to schedule every evening ([1.25.0]). The server now sweeps every minute
(`jobs/reminderScheduler.js`), and `utils/reminderTiming.js` (11 unit tests) decides when:
- **The evening before, at 6:00 PM**, not 24 hours before. The reminder carries the preparation
  ("nothing to eat after 10 PM"), which is acted on the night before; 24 hours before an 8:00 AM
  appointment is 8:00 AM the day before.
- **Booked later than that: halfway** between the booking and the appointment, Steven's rule, with
  three guards. Never within 30 minutes of the booking: the confirmation went out at that moment
  with the same date, time and preparation, so a booking 30 minutes away gets no second email, and
  one 2 hours away is reminded an hour before. Never 9:00 PM to 7:00 AM: a halfway point at 3:00 AM
  for an 8:00 AM appointment moves to 7:00 AM. Never under 30 minutes before the appointment.
- **A moved booking is timed from its move**, which sends its own email and clears the reminder.
- **Late, not lost.** One that fell due while the server was off goes out at the next sweep, after
  7:00 AM, unless the appointment is under 15 minutes away; that is recorded as handled.
- Each reminder is claimed in the database before it is sent, so two servers sharing one database
  send it once, and a failed send is tried again after 10 minutes. Nothing sweeps while outbound
  mail is not configured.
- Appointment emails (confirmation, move, cancellation, reminder) now go to the account's address,
  else the address on the patient's own record, so a booking made at the desk reaches the patient.
- `sendAppointmentReminders.js` now shows the plan (each booking owed a reminder, when it is due,
  what a sweep would do now; `--json`), and `--confirm` runs one sweep by hand.

**Patient Records keeps the final status of every finished test.** Steven: "in patient records it
should record the final status of the patient". [1.108.0] made a patient's record the FINAL record
(released reports only, nothing pending); [1.129.0] then stopped X-ray reports, so every X-ray
dropped out of Patient Records altogether. A finished X-ray is part of the record again: it is
listed as "Done <date> by <name>", with "Result given by the X-Ray department" where a report
would have View and Print, and the roster reads "2 released · 1 X-ray done". Still nothing pending:
a test waiting at a department is not on the record until it is finished.

**The front desk's record is final too; work in progress is on the Desk.** Steven: "how about the
front desk side?", then, of a visit from the day before still "Processing": "patient record would
be like the final record not the processing status since its called record ... that part can be
showed in the desk". The desk opens a patient's FILE, not their reports.
- The file lists FINISHED visits only, each test with how it ended: Released <date>, Done <date>
  with "Result from the X-Ray department", or Cancelled. A visit still open is one line: "A visit
  from Oct 18 is still open, and goes on the record once it is finished. The Desk shows where it
  stands." `GET /visits/patient/:id` carries `tests` (status, first release, X-ray done) and
  `is_paid`; `lib/testProgress.js` words a test's state (7 unit tests).
- **The Desk shows earlier days' unfinished work.** Today's queue is today's, so the visit Steven
  found (paid at 7:44 PM on the 18th, none of its 8 tests started) was on no Desk screen: the Desk
  read "Nobody is waiting, 0 in a department". A table below the queue, "From earlier days, still
  with a department" (`GET /visits/carried-over`, `visits:read`), lists each with its tests and
  where each stands, oldest first, and only appears when there is any. 7 on the dev database.
- **Still to arrive is a table.** It was a row of name buttons in the Who's here box, eight and
  then "and N more", which Steven pointed out would be a wall of buttons on a busy day. It is now a
  table in the queue's style below it: time, patient and reference, category, booked tests, paid or
  not, and Check in (which opens the booking's card in the box, and scrolls to it), paged by 8.
  `GET /appointments` carries `patient_type_name`, `booked_test_names` and `is_paid` for it.

`npm run demo` now also puts each seeded account back to its one role. Joel (cashier@enlogada.com)
was given the Receptionist role on Staff Accounts to try it, which worked, and a reset would have
left him with both; the demo and the specs take him to be a cashier and nothing else.

**A visit asks for every permission it uses.** [1.129.0] made `POST /visits` register the patient,
open the visit and attach its tests in one request, but it still checked only `visits:create`. An
account given only "start visits" on the access grid could register patients and attach tests,
which `patients:create` and `tests:assign` were there to decide. The route now requires
`visits:create` and `tests:assign`, and registering a new patient with it requires
`patients:create`. The Desk shows Start visit and Register Walk-In by the same rule.
- On "Who sees what", the switch is now "Start a visit and give a queue ticket" (a NEW patient is
  "Register new patients", in Patient records), and the footer warns when a switch is on without
  what it needs: "Cashier can start a visit and give a queue ticket only with 'Add or remove tests
  on a visit' as well." Ticking it alone used to look like a grant and give nothing.
- A Cashier opening the Desk was told to "register someone new" with no button to do it, and read
  that as a fault (Joel Cabahug, Cashier only). The Desk now tells someone who can only read the
  queue that registering and check-in come with the Receptionist role, added on Staff Accounts.

Steven also asked whether the sidebar follows a person's access by itself. It does, and nothing
in this changes that: every screen and button is shown by the permissions the account holds (all
its roles, plus or minus its own exceptions), read again every minute and whenever the window
comes back into focus. `staff-roles.spec.js` checks it with a revoked permission.

## [1.129.0] - 2026-10-18 (Two roles at once; a visit is for something; X-ray is marked done)

Run on an existing database: `node src/scripts/migrateExamPerformed.js` (`--rollback` reverses
it). Two columns on `visit_tests`, `performed_at` and `performed_by` (FK to `users`,
`fk_visit_tests_performed_by`), with `idx_visit_tests_performed_at` (partial) and
`idx_visit_tests_performed_by`. Folded into `schema.sql`, and a database built from it matches the
live one on every new column, key and index.

Steven, practising with a Cashier who also had the Receptionist role: "it cant register a walk in
patient? i though if i assign roles in user automatically they will have access to that", then "when
i register a walk in patient even tho i didnt attach a test i can still register", "check the whole
system ... SEE IF THERES A PROCESS that doesnt make sense", and X-ray: keep it for the queue and the
bill, and keep counting its patients, but stop uploading and sending its results, because the X-ray
department has its own system.

**Two roles at once.** Access already followed every role an account holds: its permissions are the
union of its roles' templates, read again on each request (`verifyToken`). The account
`multirole@enlogada.com` (Receptionist and Cashier) registers walk-ins at the Desk. What was missing
was any way to GIVE someone a second role: Staff Accounts set one at creation and never again.
- Staff Accounts creates an account with one or more roles (checkboxes), and each row has **Roles**,
  which changes them. `PUT /admin/staff/:id/roles` (`staff:manage`), audited as
  `staff.roles_changed` with the roles before and after. Only the five front-line roles, and only on
  an account that holds nothing else, so an Admin cannot make anyone an Admin or touch one.
- The change reaches the person on their next request, and their sidebar within a minute.

**A visit is for something.** A walk-in could join the queue with no test, reach the till with a
₱0 bill, and never reach a department. Registration was three requests (record, visit, tests), so a
failure between them also left a record with no visit or a visit with no tests.
- `POST /visits` takes `testIds` / `packageIds`, and refuses a visit with neither (400). It can take
  a new patient (`patient`) too: the record, the visit, its ticket and its tests are one transaction,
  all or nothing.
- A new record matching one on file (same name, ignoring case and spacing, and same birthdate) is
  refused 409 with `details.possibleDuplicate`. The Desk shows "is already on file" with **Use the
  record on file** or **No, register someone new** (`confirmNewPatient`). The error handler now
  passes `details` through on a 4xx.
- **Start visit** and **Start another visit** ask what the visit is for, and Confirm waits for a test.
- The last test on a visit cannot be removed (409): cancelling the visit is how to drop everything,
  and the refusal says so. The Edit Tests dialog locks that line with the same reason.
- Visits opened empty before this stay possible to find: Today still lists "has no tests yet".

**X-ray is marked done, not reported.** `NO_REPORT_CATEGORIES` (`constants/modality.js`, mirrored in
`lib/categories.js`; change both) names the departments whose results are given outside this
system, and it is `['Xray']`.
- Upload, release and email of an X-ray result are refused on the server (409), whoever skips the
  screen. Reports released before this stay readable.
- The X-ray worklist's one action is **Mark done** (confirmed). `PATCH /results/test-status/:id`
  with `Completed` stamps `performed_at` / `performed_by`, completes the test, and completes the
  visit if nothing else is outstanding. A second time is 409.
- That endpoint used to let a technician set any status by hand, including Completed with no report
  at all. A department that issues reports is now refused (403): its tests finish by releasing.
- X-Ray History lists exams done ("Done", and who), with no delivery column, filter or Email.
- The portal says "Done. Your X-Ray result is given by the X-Ray department, not in this portal"
  rather than a report that would never come, and leaves X-ray out of Home's "Latest results".
  The public pages no longer promise X-ray results in the portal or by email.
- **Counted the same as a release**: Departments (done per department, and its turnaround from
  payment), Today's department table, and Staff Workload (credited to whoever marked it done). Sales
  by service already counted X-ray from the payment.
- The demo seed marks its X-rays done and no longer writes X-ray reports.

**Smaller things found on the way.**
- The "already on file" birthdate was a day early: a DATE reaches the browser as a UTC timestamp.
  The query returns it as text.
- Completing a visit by hand now says what completes it: its last report released, or an X-ray
  marked done.
- Today counted an X-ray left "Waiting for Release" from before as "ready to release"; it is an
  exam to mark done. Staff Workload, its printout and the turnaround table say that they count
  X-rays done beside reports released.
- About promised released results "reach your email ... with no second trip to collect a printout".
  Since [1.113.0] a copy is emailed on request and the original is handed over at the clinic; it
  now says so, and that X-ray results come from the X-ray department.

## [1.128.0] - 2026-10-17 (Clicks that stay put; lists that page where the data is)

No schema change; nothing to run. Steven: clicking the sidebar as an admin "reload like move", and
"make sure the whole system frontend side clicking make sense", and paging wherever data grows.

**The sidebar.** Measured on a SuperAdmin, 7 of 10 sidebar clicks rebuilt the whole shell: every
console drew its own, so crossing consoles threw it away. The rail's scroll jumped to the top (the
item just clicked moved out from under the mouse), the counts vanished and came back, and the page
slid up 6px. App now mounts one shell for the session (`StaffShellHost`); a console only fills its
content and its rail action. Also:
- a new screen opens at its top and fades in by opacity alone, staff and portal alike;
- a rail action coming or going above the list (the Desk's Register Walk-In, the till's) no longer
  shifts the list 54px under the mouse;
- the rail's buttons were a component declared inside the shell's render, so React replaced every
  one on every re-render (each click, the minute tick, each count refresh) and the button under the
  mouse lost its hover and focus. Two more such components (a report's patient rows, the profile
  form's required mark) were moved out too.

**Clicks, crawled.** Every staff screen as SuperAdmin, every portal tab and the public pages,
checked through React's own props for anything that reacts to a click without looking or acting
like a control, looks clickable and does nothing, has no name, or nests a button in a button. Two
found: the Active / Inactive switches on Services and HMO Providers were bare badges (now buttons,
as Packages and Payment Methods already were), and every date field's calendar button showed an
arrow cursor.

**Paging.**
- A department's **History** fetched the last 90 days, at most 200 reports, and paged those in the
  browser: a laboratory releasing more lost older reports from the screen without a word, and the
  footer's total was only what had been fetched. It pages at the server now (`page`), reaches
  every report, counts them all, and its search runs across all of them. Without `page` the
  endpoint answers as before.
- **Cashier Monitoring** downloaded every receipt in the chosen range to draw twenty, and added up
  each cashier's takings from them. It pages at the server; the per-cashier figures come from the
  summary (`byCashier=true`), on the same basis as Collected, so they still add up to it.
- The portal's **Results** tab and **Patient Feedback**'s forms (up to 500 in a range) now page on
  screen, like Appointments and Payments. The feedback printout still lists every form.

## [1.127.0] - 2026-10-17 (Which tests the HMO work was)

No schema change; nothing to run. Steven: the HMO Claims report could not say which tests were
sold under an HMO. It grouped by provider only (tests claimed, approved / pending / refused), and
Departments' sales by service mixes a covered test in with paid ones.

The report now carries a **By test** section on screen, in print, and in the Excel and CSV
exports: provider, test, department, times claimed, and approved / pending / refused. It reads the
same claim lines as the provider rows (`CLAIM_LINES` in `reportRepository`, one CTE body shared by
both queries), so a provider's tests always add up to its row; `hmo-claim-value.spec.js` checks
that. No counter takings per test: a payment belongs to a visit, not to one test on it. The
printed report still fits one A4 page.

## [1.126.0] - 2026-10-16 (Anyone can check a report is genuine; paying GCash from the same phone)

Run on an existing database: `node src/scripts/migrateReportVerification.js` (`--rollback`
reverses it). One column, `test_results.verification_code`, with `uq_test_results_verification_code`
and `chk_results_verification_code`; the script gives a code to every version already released
(259 on the dev database) and never replaces one already issued. Folded into `schema.sql`. One new
backend dependency, `qrcode` (the frontend already used it).

Steven's pick from the feature ideas (the "Now Serving" TV board was dropped: the clinic has no
screen for it).

- **A code per released report.** Releasing a version issues it a code of ten Crockford base32
  characters (no I, L, O or U), printed ABCDE-12345 (`utils/verificationCode.js`, unit-tested). An
  amendment's release issues a new one; the old version keeps its own.
- **On every copy the patient receives.** The digital copy's strip ([1.114.0]) now carries a QR and
  the code, with the note at its old size beside them (the strip is 88pt rather than 56pt). The QR is
  drawn as vector squares, so it is sharp in print and at any zoom, and clicking it in a PDF viewer
  opens the page. Checked by scanning the rendered page. The emailed report's body names the code
  too. The clinic's own original is untouched: staff are still served the stored file byte for byte.
- **`GET /api/verify/:code`, public.** It answers genuine, replaced (a correction was released after
  it, with the date) or not found, and states only the clinic, the test and department, the
  patient's INITIALS, the release date and the version. Never a finding or the file: a verification
  link gets forwarded. Misses are rate-limited (30 per 15 minutes in production, counting only
  failures, like the sign-in limiter), against 2^50 possible codes. Typing is forgiven: lower case,
  spaces, O for 0, I or L for 1, or a whole pasted link.
- **The page: `?verify=CODE`**, or "Verify a report" in the public footer. Open signed in or out.
  Not found says to call the clinic, not "forgery": a code misread off a creased print reads the
  same way.

**Paying with GCash from the phone it is on.** The QR on a phone screen cannot be scanned by that
phone. The pay panel now offers, on a phone, **Save QR** (the share sheet's "Save Image" where the
phone has one, a download otherwise) and **Open GCash** (an Android intent that falls back to the
Play Store when the app is missing; `gcash://` on an iPhone), with GCash's own instruction: tap QR,
then Upload, and choose the saved QR. A computer still says to scan with the phone. Opening GCash
with the amount and the clinic already filled in is only possible through a payment gateway; the
PayMongo path is built and switched off (see CLAUDE.md). The clinic's real GCash QR card is now
the published one (it was a 1x1 placeholder).

**A dark-mode heading that vanished.** The dark theme remaps each status ramp up to `-800`; 29
headings use `-900` (amber, emerald, rose) as their ink on their own tint, and those stayed
near-black on the dark tint: "This booking is paid", "Payment sent for checking", the verification
answer. `-900` is now remapped too, to the lightest ink of each.

## [1.125.0] - 2026-10-16 (Demo data that reads like the clinic's)

No schema change; nothing to run. One new optional setting: `DEMO_KEEP_ACCOUNTS` (backend `.env`).

Steven: the demo looked like test data, and the clinic's own report was there to copy. Its result
documents were a few lines of plain text on a blank page ending "Sample document generated by
seedDemoScenario.js".

- **The clinic's form.** `scripts/demoReportPdf.js` draws every demo report the way the clinic's
  photographed Complete Blood Count prints: logo and letterhead, the green and navy wave, Name /
  Birthday / Sex beside Date / Patient Type / Physician, the TEST / RESULT / UNIT / REFERENCE RANGE
  table under its discipline (each lab service from its sheet in `constants/labResultForms.js`),
  the Comment line, "DO NOT ACKNOWLEDGE THE RESULT WITHOUT THE OFFICIAL SEAL" and the department's
  signatories. Imaging prints its written report and impression in the same frame. A long form
  tightens its rows rather than running into the signatures. Each page carries a small line saying
  it is a demo record with a fictional patient, and there is no signature image and no seal. No
  detail of the real report Steven shared was copied.
- **Two months of patients.** About 60 generated people (names common around Bugo, ages 19 to 80)
  over 60 days: 85 patients and about 140 visits in all, most people seen twice. Each visit is a real
  mix (a pre-employment panel, an annual physical, a diabetic follow-up, a prenatal package, a
  single scan…), weighted so ultrasound leads; about one in six is abnormal (fatty liver,
  gallstones, a kidney stone, an enlarged prostate, a thyroid nodule, a myoma, early pregnancy,
  pneumonia, spondylosis, sinusitis, raised sugar and lipids). Seniors get the statutory discount,
  HMO members' claims are approved, and the history's notifications are removed, since the staff saw
  them weeks ago (an Admin opened to 99+ unread).
- **Your own account survives a reset.** `resetDemoData.js` keeps the accounts in
  `DEMO_KEEP_ACCOUNTS`; it used to delete everyone but the nine seeded accounts.
- **A booking not yet checked in reads "Not checked in"** on Visit History, the Desk queue and the
  Billing Queue, not an internal "V-25644".

**A real HMO bug, found while seeding.** The bill read only each test's own HMO status, so after an
Admin approved a whole claim the till still saw every test as Pending: no coverage, the cashier told
"The bill is ready to settle", and the payment refused over tests "still waiting for the HMO"
([1.123.0]); before that it charged the patient in full. `constants/hmoEffectiveStatus.js` is now the
one rule for the bill, the worklist and the HMO report: a refusal at either level wins, otherwise an
approval at either level covers the test. The report read a claim-level approval only, so a test
approved on its own line under an undecided claim read Pending there and covered at the till.

**And a second, in the Departments report.** Sales by service counted an HMO-covered test's full
price as takings, so once a covered visit was paid the breakdown summed to more than the drawer held
(₱11,690 over, on the new demo data). A covered test now shows its gross and no takings (it is a
receivable, on HMO Claims), and the discount is spread over the tests the patient paid for, as the
bill computes it. Over the demo's two months the breakdown sums to the ₱95,672.00 collected, exactly.

## [1.124.0] - 2026-10-16 (Every route, fed what it should refuse)

No schema change; nothing to run. Steven asked for the system to be broken on purpose before the
defense. Two probes ran against the live dev servers: every one of the 142 routes fed impossible
ids, dates, types, broken JSON and oversized text (4,387 requests), and the clinic's processes run
out of order, twice at once and by the wrong person. `process-rules.spec.js` holds what they found.

**About 1,400 crashes, one cause.** An id of `abc`, `9999999999999999999` or a date of
`2026-02-30` went straight to Postgres, which refused it, and the refusal came back as a 500 with
the database's own words ("invalid input syntax for type integer"). `errors.normalizeError` now
translates a Postgres error into the refusal it is: malformed input 400, a missing reference 404,
a duplicate 409 (two cashiers verifying one proof at once: the second now gets "This visit has
already been paid", not a 500), with plain messages per constraint (`CONSTRAINT_MESSAGES`).
Anything not about the input sent stays 500. Plus three `.trim()` calls on input that was not text.
After the fix the same 4,387 requests produce no 5xx. No route let a request in without a token, a
patient onto a staff route, or an Admin onto a SuperAdmin one.

**Rules the screens kept and the API did not:**
- **Booking checked the weekly pattern only.** A date the clinic CLOSED, with free slots, could be
  booked through the API; a date's changed hours or capacity applied to the picker, not to what
  was accepted. `resolveDay` is now the one answer for availability, booking and rescheduling.
  Also refused: a time off the slot grid (09:07), a time already gone today, a date more than 365
  days ahead (the picker stops there too), and a booking with no tests. Two bookings one day for
  the same patient stay allowed: fasting bloods at 8:00 and an ultrasound later is a real case.
- **A re-sent booking added its tests to a PAID visit** (the [1.55.0] leak by another door). Refused
  when it would add anything; an unchanged re-send still returns the booking.
- **Money:** no receipt for a cancelled visit or a visit with no tests (the till disables Take
  Payment and says why); an unknown payment method is a 400.
- **Visit status by hand:** Completed and Pending can no longer be set (an unpaid visit was set
  Completed; a cancelled one brought back to Pending); a cancelled or completed visit stays so, and
  takes no new tests. No visit for an archived patient, and no second unpaid visit for someone
  already waiting (the Desk refused it on screen only); a paid visit does not block the next.
- **Booking status by hand:** Cancelled, No Show and Completed are final (a cancelled booking could
  be checked in). No Show only on or after the booking's day and never after check-in; the Desk's
  card offers it only then. A booking checked in on another day is moved to today, freeing its old
  slot (`moveToTodayAtCheckIn`), and the card says so before check-in.
- **Online proof:** refused for a cancelled booking. A booking whose proof is waiting cannot be
  cancelled (the money has left the patient's account and a cancelled booking cannot be paid); the
  portal hides Cancel then (`has_pending_proof`).
- **HMO:** no claim on a paid, cancelled or completed visit.
- **Catalogue:** retired services cannot be added to a visit, booked, or put in a package; a
  service needs a name and a price from 0 to 1,000,000; an ACTIVE service only in a department the
  clinic runs (`DIAGNOSTIC_CATEGORIES`, mirrored as `OFFERED_CATEGORIES` in `lib/categories.js`). A
  probe's test in ECG brought ECG back onto the patient's booking picker as a department of one
  nameless test, and `catalogue-partial-update.spec.js` had been creating its fixture there on every
  run (it took `categories[0]`, which is ECG by name). The service form lists only those departments.
- **Patient records** (`validations/patientFields.js`, unit-tested): a real birthdate between
  1900 and today, a non-blank name of 100 characters at most, Male or Female, a phone number in
  digits.
- **Senior Citizen discount** needs a patient of 60 or over by the birthdate on file (RA 9994).
  One was granted to an 11-year-old.
- **Schedule overrides** for a past or impossible date are refused.
- **Results:** the test-status override takes only a real status, and a missing test is a 404, not
  "Test status updated".

`seedDemoScenario.js` now books its two portal bookings with their test. `hmo-card-review.spec.js`
booked 500 days out, which the horizon reads as a closed day, and had been skipping itself; it books
within the horizon now.

## [1.123.0] - 2026-10-16 (Processes that did not make sense once a receipt became final)

No schema change; nothing to run. One new optional setting: `BOOKING_PAYMENT_MINUTES` (default 60,
allowed 15–1440), how long a patient has to pay for a booking made online.

Steven asked for a review of the whole system for processes that do not make sense. With
[1.121.0] and [1.122.0] a paid receipt is final, which turned several older gaps into money or
patients going missing. Nine were found; all nine are fixed here, and `process-fixes.spec.js`
holds each one.

1. **An HMO claim approved after the patient paid in full.** The till allowed charging a test
   whose HMO decision was still pending, and the HMO could then approve it, so the patient paid and
   the insurer was billed for the same test. `POST /payments` now refuses (409) while a test on
   the visit waits on its HMO, unless the cashier ticks "charge in full and withdraw the claim":
   the pending lines are then closed in the same transaction as the payment
   (`withdrawPendingForVisit`: each line `Rejected`, which every report already reads as "the
   patient settles it", with the reason recorded; a claim left with nothing approved `Cancelled`). Approving a claim, or a line, on a paid visit
   is refused. The HMO report counts a `Cancelled` claim with the refused.
2. **Paying online and at the counter.** A patient could send a GCash proof and then pay cash at
   the counter, and the second payment had nowhere to go: one settled payment per visit. The till
   now refuses while a proof waits to be checked, names its reference and sends the cashier to
   Online Payments (the bill carries `pendingProof`, and Billing Queue shows it).
3. **Closing a date with bookings on it.** A closure, or new hours, left the bookings it no longer
   fits where they were, and nobody was told. `PUT /schedule/overrides` now answers with
   `affectedBookings` (everyone on a closed day; on an open one, everyone outside the new hours),
   and each patient with an address is emailed that the day changed and that the clinic will help
   them move. Clinic Schedule lists them (`GET /schedule/overrides/:date/bookings`,
   `AffectedBookingsDialog`) so the Desk can move each one. A lower capacity moves nobody: the
   bookings already taken stay, and it limits new ones.
4. **A paid booking marked No Show.** With no refunds, that kept the money and closed the booking
   for good. It is refused (409); a paid booking is moved to another day. The Desk hides No Show
   on it.
5. **"Open a new visit" that nobody could open.** Since [1.55.0] a paid visit's message said to open
   a new visit for extra tests, and the Desk refused a second visit to anyone already in today's
   queue. A PAID visit no longer blocks one: Who's here? says "Already has a paid visit today" and
   offers "Start another visit", with its own bill. An unpaid visit still blocks a second. The
   queue's search also matches a full name now: "Teresita Gatchalian" matched neither name on its
   own, so the box could offer a second visit to someone waiting.
6. **A walk-in who later signs up.** Nothing connected their record to their new account, so they
   added themselves again, never saw their earlier results online and appeared twice on Patient
   Records. Reception links the record to the account by the email the patient signed up with
   (`PUT /patients/:id/link-account`, `patients:update`, staff only), from the patient's file.
   Refused for a staff account and for a record already linked; audited
   (`patient.account_linked`). It does not merge two records that already exist.
7. **A Word or Excel report released silently.** A patient's copy must be marked DIGITAL COPY
   ([1.114.0]), and an Office file cannot be, so the portal refused it and Email to patient could
   not attach it, with nothing said when it was attached. The upload dialog now says so, while a
   PDF can still be attached instead.
8. **Archiving a patient who is in the building or booked.** Archiving takes a record off the
   roster and out of the Desk's search, which hid the patient from the people about to look for
   them. It is refused while they have a visit in progress, an unpaid walk-in today, or a booking
   from today on; the message says which.
9. **An unpaid online booking held its slot for good.** The clinic's rule is payment first, and
   only the PayMongo gateway's 15-minute hold ever released a slot, and the gateway is off. A
   self-pay booking a patient makes now holds its slot for the payment window whenever the clinic
   publishes a payment account. A proof sent in time keeps the slot until a cashier checks it; a
   proof sent after the window is refused ("wasn't paid in time"); a rejected proof gives the window
   again. The portal shows "Pay by …" and, once lapsed, that the slot was released. The day-before
   reminder skips a lapsed booking. Staff and HMO bookings still take their slot outright.

## [1.122.0] - 2026-10-16 (No void; the tests are confirmed before the money)

No schema change; nothing to run.

**No void.** The receipt void went with the refund route in [1.121.0]. One left was not called a
void: cancelling a visit that was already paid. It kept the payment as Paid and took the tests off
every worklist, so the clinic held money for nothing. A paid visit can no longer be cancelled, and a
paid booking can be moved but not cancelled (both answer 409, Admin included). The Desk hides the
Cancel on a paid visit (`is_paid` on the queue row), the portal hides it on a paid booking. An
unpaid visit or booking cancels as before.

**The tests are confirmed before the money.** Steven: a patient still deciding between tests should
not be charged for the wrong ones, now that a payment cannot be undone.
- **At the till**, the payment confirmation is "Are these the final tests?": every test and its
  price, the total and the method, what payment locks, and Take ₱X waits until the cashier ticks
  "The patient has confirmed these are their final tests." The tick resets each time it opens.
  (`components/cashier/PaymentConfirmDialog.jsx`)
- **In the portal**, the money leaves the patient's banking app before the clinic sees it, so the
  check comes first: the pay panel lists the booked tests (`booked_tests` on the patient's
  bookings, and the rows a new booking returns) and shows the clinic's account and the upload only
  after "These are the tests I want." A patient not sure yet is told they can pay at the counter.

`final-tests.spec.js` holds the till, the portal, and both refusals; `booking-pass-gating.spec.js`
ticks the box before it reads the account.

## [1.121.0] - 2026-10-16 (No refunds: a paid receipt is final)

No schema change. **Re-run `node src/scripts/setupRbac.js`** on any existing database: it retires
`billing:refund` (its grants and the permission row) through the RETIRED list.

Steven: a refund does not make sense for the clinic. As built it let a cashier take money and
hand it back with nobody else involved, a reprinted refunded receipt still read as a valid paid
receipt (one an HMO or an employer would reimburse), only a whole receipt could be reversed, and
nothing recorded how the money went back. So the feature is removed, not hidden:

- `PATCH /payments/:id/status` and everything behind it (`updatePaymentStatus` in the controller,
  service and repository, and `recallVisitFromModalities`, which only a refund called).
- `billing:refund`, from the Cashier and Admin templates and from the database.
- The Refund button in Transaction History, its dialog, `useRefund`, and the "Refund or void a
  payment" row on Who sees what.
- Every message that offered a reversal as the remedy. A paid visit's tests: "open a new visit".
  A paid visit's discount: it can no longer change. The receipt no longer says it is "required
  for any refund".

The HMO warning at the till changed meaning: a test still awaiting an HMO decision is billed in
full, and with no refund the cashier is told to wait for the decision rather than collect money
that cannot be given back.

Reversals recorded before this stay exactly as they were: `payment_status`, `refund_reason` and
`refunded_at` are unchanged, the cash book still reports them beside the takings, and the receipt
log still lists them, so every past day still reconciles. `cashup-reversals.spec.js` went with the
route it drove; `refunds-removed.spec.js` holds the removal.

## [1.120.0] - 2026-10-16 (My Account: the account beside the forms that change it)

No schema change; nothing to run.

**One narrow column became two.** Staff My Account was a single 42rem column of forms with the rest
of a desk screen empty. Now the profile card (the photo, the name, the role) sits on the left and the
forms on the right; on a phone they stack. The patient portal's My Account is built from the same
three parts (`components/account/`: `ProfileCard`, `PersonalDetailsPanel`, `PasswordPanel`), so the
two cannot drift; `AccountSettingsForm.jsx` is gone, and `AvatarUpload` moved into that folder.

- **Each fact once.** The card shows no email or number: the form beside it already does. The photo
  has one way to change it: the camera badge on the photo and the "Upload" link beside it were two
  controls doing the same thing. The portal's safety note no longer repeats that a new password
  signs you out elsewhere; the Password section says so.
- **Save only when something changed**, with "You have unsaved changes" beside it, and buttons
  that keep their label while saving (`<Button loading>`, CLAUDE.md [1.39.0]); both used to swap to
  "Saving…". The sign-in email is a plain read-only line with a lock, not a greyed-out input that
  looks broken.
- **The password is checked while it is typed:** Create Account's strength meter under the new
  password, and "Passwords match" or "Doesn't match yet" under the confirmation. Change Password
  waits until all three are filled.

`my-account.spec.js` holds it without changing a seeded account.

## [1.119.0] - 2026-10-16 (Reports export to Excel; Departments is takings and sales; one page each)

No schema change; nothing to run. No new dependency.

**Export downloads an Excel workbook, not a CSV.** Opened in Excel the CSV was one cramped grid:
every column at the default width ("Receipts I"), no bold, no money format, the sections run
together. A CSV cannot carry any of that. `utils/xlsxWriter.js` writes a real .xlsx (inline strings,
a fixed style sheet, a zip container from Node's own zlib) laid out like the printed report: the
clinic, the title, the period, when it was made, then numbered sections as bordered tables with
bold shaded headers and columns sized to their contents. Money stays a NUMBER in a "₱#,##0.00"
format, so a column still adds up, and each total row is a SUM formula over exactly its own rows.
Gridlines off; A4, fitted one page wide, with the report named in the printed footer.
`utils/reportXlsx.js` holds each report's layout; `reportExportFactory` registers it as the `xlsx`
serializer (`?format=xlsx`), after the service, so it can never show more than the JSON.
`?format=csv` is unchanged for anyone who scripts it. The button is "Export Excel"
(`components/ui/export-button.jsx`, `lib/downloadReport.js`, renamed from the CSV ones).
Excel opened the Departments file without a repair prompt; its automation was then blocked by the
copy's activation prompt, so the layout itself is held by `tests/unit/xlsxWriter.test.js`.

**Departments is takings and sales by service.** Steven: a department report does not need front
desk throughput or turnaround by department. Gone from the tab, its print and its workbook. Both are
still measured where they are used: turnaround on Today, the front desk on Visit History; the
operations endpoint still returns them for those screens.

**Every report fits its paper.** On Chrome, measured: Departments, Trends, HMO Claims and Staff
Workload are one A4 page each (Departments was three sheets in Steven's preview). Spacing is tighter,
explanatory notes that did not prevent a misreading are gone, and Trends prints its narrow two- and
three-column tables two to a row (`ReportColumns`). The signature block is kept with the section
before it (`break-before: avoid-page`), so a sheet is never only two signature lines: the last rows
come over with it. The top margin is claimed empty, so the browser's own date and title are not
printed over it, and while a report prints nothing but `<head>` and `<body>` may sit in `<html>`,
so a node an extension adds there cannot push out a blank sheet.

## [1.118.0] - 2026-10-15 (A printed report is noted by Jesie B. Enlogada; the final page footer)

No schema change; nothing to run.

**Noted by: JESIE B. ENLOGADA, Proprietor.** Steven named her. The title is the clinic's own: its
invoice booklet prints "JESIE B. ENLOGADA - Prop." under the trade name. The name and title are
clinic identity fields, `reportNotedBy` / `reportNotedByTitle` in `lib/clinic.js`, overridable with
`CLINIC_REPORT_NOTED_BY` / `CLINIC_REPORT_NOTED_BY_TITLE`. Deliberately not `CLINIC_PROPRIETOR`,
which prints on every receipt: who notes the reports can change without the receipts changing.

The signature block is now the usual form: "Prepared by:" and "Noted by:", room to sign, a line,
then the printed name in capitals and the title under it (the preparer's role, the proprietor's).

**The foot of every page, final:** on the left the clinic, the report, its period and
"Confidential" ("Enlogada Ultrasound & Diagnostic Clinic · HMO Claims Report · Sep 16 to Oct 15,
2026 · Confidential"); on the right "Page 1 of 2". Every sheet names its report, so a page separated
from the rest still says what it is. CSS cannot read that from the document (Chrome has no
`string-set`), so `printReport` writes it into `@page document` for the length of the print and
removes it after, cancelled or not; index.css keeps "clinic · Confidential" as the fallback. The
wording and the quote-escaping are unit-tested (`tests/unit/reportPrint.test.js`), and
`report-print.spec.js` checks the name, the title and the footer on all five reports.

## [1.117.0] - 2026-10-15 (Every report prints as a finished A4 document)

No schema change; nothing to run.

**Reports printed their screen, and Patient Feedback printed nothing.** Measured by rendering each
print to PDF: Departments had no title, letterhead or period; its tables carried
`break-inside: avoid`, so the long Sales by service table jumped to the next sheet and left most of
the first one blank; the right-hand columns ran off the paper; the app's date pickers and coloured
panels went to the printer. Trends printed charts whose two series are told apart only by colour.
HMO Claims and Staff Workload had no Print at all. Patient Feedback's Print handed `printElement` an
element that was not a `.print-area`, and the print stylesheet hides everything else: a blank sheet.

**One format, `components/reports/ReportDocument.jsx`, for all five.** The clinic's letterhead
(`useClinic`), the report's title, its period, when it was generated and by whom (`useAuth`), then
numbered sections of plain bordered tables with total rows, and a signature block ("Prepared by"
with the printed name, "Noted by" blank). Page numbers in the margin (`@page document`). Figures are
TABLES on paper, never charts: a clinic printer is usually black and white. Each tab's print is in
`components/reports/ReportPrints.jsx`, built from the figures the tab already fetched, and states
the period those figures are FOR (the last applied range, not the date boxes). Hidden on screen,
printed through `lib/reportPrint.js` `printReport` on A4, styled by `.report-doc` in index.css in
points, because paper does not follow the reader's text size. A report table may run across sheets
with its header repeated; a row never splits.

`printElement` now marks its copy `.print-area` whatever it is handed, so no caller can print a
blank sheet that way again. `report-print.spec.js` presses Print on all five under print media and
reads the sheet: visible, the only thing on the page, on A4, titled, dated, signed. Put the
Feedback bug back and it fails.

## [1.116.0] - 2026-10-15 (The front desk opens a patient's file from Patient Records)

No schema change; nothing to run.

**A name on Patient Records opens the patient for everyone now.** [1.108.0] gave the front desk and
the till the roster with no dropdown, so a receptionist could see that a patient had been here and
nothing more, and had to go to the Desk and type the name again to start their next visit. Whoever
cannot read results now opens the patient's FILE (`components/patients/PatientFile.jsx`):

- **Also on file**: address, email, emergency contact, and whether they have a portal account. Only
  what the row does not already show; the row has sex, birthdate, contact and type.
- **Visits**, newest first: date, ticket, walk-in or appointment, the tests it was for, and its
  status. Never a result: results stay with `results:read`.
- **Start a visit** (`visits:create`): opens the Desk with the patient's name in "Who's here?", where
  their record waits with Start visit. Not a visit created here, because the Desk is where a second
  visit for someone already in today's queue is refused. Someone already in it gets **Find at the
  Desk** and their ticket instead. A cashier sees the file without the button.

`GET /visits/patient/:id` (no other caller) now carries `test_names` and `in_todays_queue`, the
latter by the queue's own rule (`constants/queueMembership.js`). Opening the file reads
`GET /patients/:id`, which logs the PHI read as it always has.

`patient-records-final.spec.js` holds both: the front desk opens a file with no results and reaches
the Desk with the name found, and the till opens the same file with no way to start a visit.

## [1.115.0] - 2026-10-15 (One worklist row per patient; a patient views but does not print)

No schema change; nothing to run.

**A department's worklist is one row per patient.** It listed TESTS, so a patient in for six
laboratory tests filled six rows with the same ticket, name and wait. A visit with several tests is
now one row: its name is a button that opens the tests underneath, each with its own Attach Report
/ Release Result. Closed, the row says how many tests and which, and counts them by status in the
status's own badge ("4 Processing"). A visit with one test is the ordinary row it always was, which
is what every other worklist spec drives. Grouped by VISIT, not patient, because a visit is one
queue ticket. Paged by patient, so one person's tests never split across pages; the footer reads
"2 patients · 5 tests", since the sidebar badge and the two figures above the list count tests.
`lib/worklistGroups.js` (unit-tested) holds the rules; `StatusBadge` takes `children` to replace its
words while keeping its colour. On a phone a test is an indented card under its patient
(`tr[data-subrow]` in the stacked-table CSS), and an empty cell is left out of a card.

**A patient views a released report; they are no longer offered Print.** [1.113.0] took Download
away; the clinic's rule is that the original is printed and handed over at the clinic, so Print
goes too, from the viewer and from autoPrint. The viewer names the document "Digital copy" rather
than by the clinic's file name. The portal band, the FAQ and the result email stop saying "print".
A phone with no PDF viewer still has "Open in new tab", the only way to read it there.

**The DIGITAL COPY note is larger.** Two lines in a taller strip (56pt): "DIGITAL COPY" in 16pt
bold, then the sentence in 12pt. At 8pt on one line it was the smallest text on the page. The
portal summary's note is the same two lines.

`worklist-groups.spec.js` holds the worklist; `release-email-choice.spec.js` the viewer.

## [1.114.0] - 2026-10-15 (A patient's copy is marked DIGITAL COPY; the clinic keeps the original)

No schema change; nothing to run. One new backend dependency, `pdf-lib` 1.17.1 (pinned exactly):
run `npm install` in `backend/` after pulling.

**What reaches a patient is a copy, and says so.** A report opened in the portal or attached to an
email is the clinic's document marked DIGITAL COPY on every page, with a line beneath it: "For the
original with the official seal, please visit the clinic and ask for it." The staff side is served
the stored original, untouched, because that is what the clinic prints and seals. The point is
forgery: nothing a patient can save should pass for the clinic's document.

`utils/digitalCopy.js` does the marking, in memory, on every request; nothing marked is stored.
- **The note goes in a strip ADDED below each page**, never over it. A report ends in signatures
  and licence numbers, and the report keeps its own coordinates, so nothing the clinic printed is
  covered.
- **The watermark repeats diagonally across the whole page**, faint (22%) so every figure stays
  legible. A single stamp in the middle can be cropped or painted out with the area around it left
  clean; a pattern leaves no clean region to lift.
- **A JPEG or PNG report becomes a one-page PDF**, so a patient's copy is always a PDF, named
  "<test> (Digital Copy).pdf".
- **A Word document or spreadsheet cannot be marked, so it is refused**: 409 in the portal ("given
  out at the clinic"), 409 on Email to patient (attach it as a PDF to send it). A PDF that cannot be
  read is refused the same way. Never fall back to the unmarked file: that is the forgery this
  exists to stop.

It is a label, not a lock: `pdf-lib` cannot encrypt, and a determined person with a PDF editor can
work at the marks. The protection is that the sealed original only ever leaves the clinic by hand.

The portal's "Print official copy" button is gone. It printed the letterhead summary, not the
report, and called it official. The summary now reads "DIGITAL COPY · For the original…"; a patient
prints the marked report from View Report.

All 37 authorised reports in the dev database were marked without a failure before this shipped.
The spec fixtures were five-byte fake PDFs, which cannot be parsed, so `helpers/reportFile.js`
builds a real one-page PDF (`pdfReport`). `digital-copy.spec.js` holds who gets which file;
`backend/tests/unit/digitalCopy.test.js` holds the marking.

## [1.113.0] - 2026-10-15 (Releasing does not email; the portal views and prints, no download)

No schema change; nothing to run.

**Emailing a result is now a choice, not a side effect of releasing.** Not every patient wants a
medical report sent to them. `releaseResult` no longer calls `deliverResultEmail`; it authorises the
report, puts it in the portal and replies "it has not been emailed", with `patientEmail` so the
screen can offer the send. The panel after release now offers **Email to patient** (or says there is
no address); History's Email button is unchanged. Both use `POST /results/:id/email`, now the only
path that emails a result. History's "Not recorded" reads **Not sent**, and Today's "N released
reports not yet sent to the patient" is gone — under opt-in it would nag after every release.

**The patient portal offers View and Print, not Download.** The Download button beside a released
report and the viewer's Download and "Open in new tab" are hidden for a Client, and the PDF viewer
is asked to hide its own toolbar. A Word or Excel report, which no browser can show, tells the
patient to ask the clinic to email it. Removed with it: `lib/resultFile.js` and the portal's
`file_url` branch, dead since [1.31.0] dropped that column.

`release-email-choice.spec.js` holds both halves.

## [1.112.0] - 2026-10-14 (Patient feedback: the clinic's paper form, in the portal and at the desk)

Run on an existing database:

```bash
node src/scripts/migrateVisitFeedback.js        # --rollback reverses it
```

The clinic hands out a paper form: four questions, each ticked MAAYO / OKAY LANG / DILI MAAYO, and
a comment box. It is now in the system, asked once per FINISHED visit (status 'Completed').

| | |
|---|---|
| `feedback_questions` | the wording in Cebuano, Tagalog and English; order; on/off |
| `visit_feedback_answers` | visit × question → rating 3 / 2 / 1; PK on the pair |
| `patient_visits.feedback_*` | submitted_at, comment, channel (`portal` / `paper`), language, recorded_by, name_hidden |

Two tables is the floor with real foreign keys; everything that is one-per-visit is a column on the
visit, as the doctor's request is. An answered question cannot be deleted (RESTRICT) and its wording
is locked by the service; it can be turned off. Permissions: `feedback:manage` (Admin) and
`feedback:record` (Receptionist, Admin); the overview reads `reports:view`. The migration loads the
four questions from the paper form when there are none: the Cebuano is the form's, the Tagalog and
English are drafts for the clinic to confirm.

Screens: the portal's Home asks "How was your visit?" with a language switch; Visit History offers
reception "Record feedback" on a finished visit; Admin and SuperAdmin get **Patient Feedback**
(Overview, printable, and Questions). The demo seed adds nine paper forms from the fortnight's
walk-ins. `schema.sql` matches the live database at 33 tables; the ERD was regenerated.

The SuperAdmin demo account (`admin@enlogada.com`) is now named **Jesie Enlogada**, at the clinic's
request — in `seedUsers.js` for a fresh database and set directly on the existing one.

## [1.111.0] - 2026-10-14 (Reports has four tabs; the Activity Log leaves out migration archives)

No schema change; nothing to run.

**Reports: seven tabs became four.** Each removed tab repeated another screen:

| Removed | Already shown by |
|---|---|
| Today | the Today screen, where every Admin and SuperAdmin lands |
| Access Matrix | "Who sees what" on Access Control, which can also change it |
| Analytics | Departments (turnaround) and Trends (revenue); its arrivals by hour moved to Trends |

Left: **Departments**, **Trends**, **HMO Claims** (was "Claim Value") and **Staff Workload**.
`GET /reports/summary` now carries `hourlyArrivals` (and its CSV an "Arrivals by Hour of Day"
section), from the same query the Today screen reads. `GET /reports/analytics` stays, because Today
reads its turnaround and arrivals, but loses `revenueComparison`, which only the Analytics tab drew;
`previousPeriod` and `getRevenueTrendForRange` went with it.

**Activity Log.** [1.109.0] wrote 33 archive entries in one go, and they buried the real activity.
Entries whose action is in `ARCHIVE_ACTIONS` (`auditRepository`) are left out of the feed unless
"Show archived records" is ticked (`GET /admin/activity?archives=true`). They are never deleted:
on the clinic's database they are the only remaining copy of what the dropped tables held.

## [1.110.0] - 2026-10-14 (A report counts a release once it is authorised, and once per test)

Run on an existing database:

```bash
node src/scripts/migrateAuthorisedIndex.js       # --rollback reverses it
```

Three reports read `test_results.released_at` as the moment a report went out. It is stamped when
a result is SAVED, so:

- **Departments → Turnaround by department** (`getDiagnosticThroughput`) and **Analytics →
  Turnaround against target** (`getDepartmentTurnaroundPerformance`) counted drafts nobody had
  authorised, and timed every report to when it was typed rather than released;
- **Staff Workload** (`getDiagnosticWorkload`) credited people with drafts.

All three now read `authorised_at`, and count a test once, at its FIRST authorised version
(`FIRST_RELEASE` in `reportRepository`): a correction authorised weeks later is an amendment, not
weeks of turnaround or a second patient. The two turnaround reports stay on one basis, as [1.62.0]
requires. `idx_test_results_authorised_at` (partial, `WHERE authorised_at IS NOT NULL`) serves the
new date ranges. `report-release-basis.spec.js` holds it: a draft adds nothing, a release adds one,
a correction adds an amendment.

[1.109.0] was applied to the development database the same day: 31 tables, and `schema.sql`
matches it on tables, columns and indexes. The ERD was regenerated from it (`erd.drawio` and the
three `png/erd-*.png`); the other diagrams came out byte-identical.

## [1.109.0] - 2026-10-14 (The typed result forms are removed, tables and all: 36 tables become 31)

Run on an existing database:

```bash
node src/scripts/migrateRemoveResultForms.js            # refuses if a current result has typed values and no file
node src/scripts/migrateRemoveResultForms.js --force    # drop anyway (the values are archived either way)
node src/scripts/migrateRemoveResultForms.js --rollback # the tables back, with the signatories; not the values
```

Since [1.94.0] a result is its attached report file, and nothing in the product wrote to the typed
forms any more. Five tables go:

| Table | What it held |
|---|---|
| `result_field_sets` | the form for a test (CBC, Urinalysis, Whole Abdomen…) |
| `result_fields` | each line on a form, its unit and printed range |
| `result_field_set_tests` | which test used which form |
| `result_measurements` | the values typed into them |
| `clinic_signatories` | the names printed under a typed report |

**Nothing is lost, it is moved.** Before the drop, every result's typed values are written to
`audit_log` as one readable entry (`result.measurements_archived`, e.g. "Hemoglobin = 14.8 g/dl
(13.7-16.7)"), and each signatory as one entry (`clinic.signatory_archived`). `--rollback`
re-creates the tables and puts the signatories back from those entries; the forms and values stay
in `audit_log`.

**It refuses before it would empty a report.** A current result with typed values and no file
shows those values and nothing else, so the script counts them first and stops, naming each, unless
`--force` is given — the 2D Echo removal's rule, because a count taken on one database says nothing
about another. On the development database all 16 were the old demo seed's; the next
`npm run demo` replaces them with results that carry a report.

Code removed with the tables: `resultMeasurementRepository`, `constants/ultrasound.js`,
`mergeMeasurements` and its derivations, `GET /results/field-set/:id`, the typed grids and signature
footer in `ResultReport.jsx`, `seedResultFieldSets.js`, the five [1.50.0]-[1.64.0] form migrations,
and `ultrasound-measurements.spec.js` (its one surviving guard, a single file input in the entry
dialog, moved to `result-entry.spec.js`). `POST /results` now answers a `measurements` key with
400 rather than ignoring it. `constants/labResultForms.js` stays as the faithful copy of the
clinic's sheets: the demo seed prints its lines and the clinic's signatories into each sample PDF,
so the demo's documents read like the clinic's.

## [1.108.0] - 2026-10-14 (Patient Records is the final record, by permission; prints are logged)

No schema change; nothing to run.

- **Final results only.** Opening a patient lists their AUTHORISED reports, newest visit first, with
  View and Print. It used to list every test ordered, "Pending" ones included, in a dialog.
- **The roster's "released" count was counting drafts.** It read `released_at IS NOT NULL`, and
  `released_at` is stamped when a result is saved. It now counts tests with an authorised version,
  confined to the caller's departments so the count matches the list it opens.
- **The front desk and the till see who a patient is, not their results.** Their roster rows carry no
  `released_count` / `last_released_at`, `GET /results/history` stays closed to them, and the screen
  hides the Results column and the dropdown. "Open records" used to be offered to them and returned
  403.
- **Printing and saving a report are in the Activity Log** (`phi.read.result_print`,
  `phi.read.result_download`, via `POST /results/:visitTestId/copies`), beside opening it
  (`phi.read.result_file`, now worded "Opened the <test> report of <patient>").
- **The Complete / Still open filter is gone,** with its `recordStatus` parameter: a record is its
  released results, and work still outstanding is the worklists' and the Desk's business.

## [1.107.0] - 2026-10-14 (The doctor's request is required for an HMO booking, optional for self-pay)

No schema change; nothing to run.

[1.106.0] asked every booking a patient made for the doctor's signed request, self-pay included.
A patient paying for their own test is not asked for paperwork the clinic does not
need to bill it. `referralService.assertDoctorRequestIfRequired` now requires the paper exactly when
`referralRequirement` requires the visit to name its doctor:

- **An HMO claim** — the HMO approves the tests against it. Required, as before.
- **A Private patient** — the type means "a physician referred them", whoever pays. Required: the
  booking dialog no longer has a typed name, so the paper is the only way such a booking could
  satisfy the referral rule, and leaving it optional would have refused the booking at submit with
  a message about a field the patient cannot see.
- **Anyone else paying for themselves** — optional. They may still attach it, and the Desk shows
  "View doctor's request / notes" only when one is on file.

The dialog's step 2 now asks who pays FIRST, because that decides what else is asked, and marks the
upload required or "(optional)" to match. The pill reads "2. HMO & Doctor's Notes" and the field
"Doctor's Request / Doctor's Notes", because "doctor's notes" is what many patients call the paper;
the Desk button and Admin's Service Requests heading carry the same pair.

A patient cannot later claim HMO from the portal on a self-pay visit booked without the paper —
`POST /hmo/request` still refuses a patient's claim on a visit with none — but the portal has no
such screen; only the front desk files a claim later, and staff are exempt.

## [1.106.0] - 2026-10-12 (A booking carries the doctor's signed request, in place of typing it)

Run on an existing database:

```bash
node src/scripts/migrateDoctorRequest.js            # --rollback reverses it
```

Five columns on `patient_visits`, folded into `schema.sql`: `doctor_request_file_path`,
`_original_name`, `_mime_type`, `_size_bytes` and `_uploaded_at`. The file lives in
`uploads/doctor-requests`.

### Why

A patient booking online typed the doctor's name, the PRC number and free-text "Additional Clinical
Notes". The clinic performs a test on a doctor's request, and the signed paper says all three in the
doctor's own hand, so the booking now uploads the paper and the three typed fields are gone from the
patient's booking dialog. An HMO reads the same paper before it issues the LOA.

### The rule

Every booking a patient makes carries it, self-pay as well as HMO
(`referralService.assertDoctorRequestIfRequired`). Refused before the transaction, so the slot stays
free: "Please upload your doctor's signed request for these tests." Staff are exempt, as for the HMO
card: at the desk the patient hands the paper over in person. The HMO card is still the HMO's ID and
is still required for a claim; it was never a second upload.

A doctor's request on file satisfies the referring-physician rule ([1.23.0]) for an HMO claim and for
a Private patient, so `assertReferralIfRequired` takes `hasDoctorRequest`. A patient's own HMO claim
on the standalone `POST /hmo/request` needs the visit to carry one, so a booking the desk made for
them cannot be claimed from home without it. Desk rules are unchanged: reception still types the
physician on a walk-in and an HMO claim.

There is no CHECK constraint: every visit before today has none, and desk visits are exempt.

### Where it shows

- **Booking dialog**, step 2 ("Doctor's Request & HMO"): the doctor's request comes first, for every
  booking, then the optional HMO provider, then the LOA code and card photo for an HMO claim. Referring
  Physician and Additional Clinical Notes are removed. The page is downscaled to 2400px (the card's
  1600 blurs a signature). The dialog went from 527 to 392 lines, the card and the request sharing
  `useEvidenceFile` and `EvidenceUpload`.
- **The Desk**, on the booking card at check-in: "View doctor's request" shows it in place.
- **Service Requests**, Admin's claim review: under the HMO card, read from the visit.
- `GET /visits/:id/doctor-request` streams it: staff on `visits:read`, a patient only for their own
  visit (404 otherwise, as for payment proofs). `components/AttachedFile.jsx` renders it, and the
  card, on both screens.

### What the typed name still feeds

`patient_visits.referring_physician` is still read by the department worklist ("Ref:"), the legacy
report and the result email. An online booking no longer fills it, so those show no doctor for it
until somebody types one. Nothing on the Desk offers that yet.

### Retention and cleanup

The request is part of the visit's record, not insurance evidence, so `pruneHmoCards.js` never
touches it and nothing ages it out. `purgeE2eData.js` and `resetDemoData.js` sweep
`uploads/doctor-requests` for orphans, the reset with the card folder's 30-minute grace.
`seedDemoScenario.js` books online with a generated one-page PDF request from an invented doctor.

### A withdrawn draft

For an hour this was six columns on `hmo_requests`, required only for an HMO claim
(`migrateHmoDoctorRequest.js`, never committed). Self-pay needing it too moved it to the visit.
`migrateDoctorRequest.js` drops the draft's columns when empty and refuses if any holds a file.

### Tests

`tests/unit/referral.test.js` (new) pins both directions of the rule. `booking-atomicity.spec.js`
refuses a booking without the request and checks the slot, checks who may read it, and refuses an HMO
claim from home on a desk-made visit. `hmo-card-review.spec.js` and `front-desk.spec.js` check both
screens decode it. Every spec that books as a patient goes through `helpers/booking.js`
`appointmentForm()`, and every wizard submission through `helpers/portal.js` `attachDoctorRequest()`.

## [1.105.0] - 2026-10-12 (A move says why; the amount to pay is stated, not typed)

Run on an existing database:

```bash
node src/scripts/migrateRescheduleReason.js            # --rollback reverses it
```

Two columns on `appointments`, folded into `schema.sql`: `reschedule_reason VARCHAR(500)` and
`rescheduled_at TIMESTAMP`, both describing the LATEST move. Every move, with its reason, is also in
`audit_log`. The script fills `rescheduled_at` for earlier moves from their
`appointment.rescheduled` audit entries (11 on the dev database) and leaves their reason empty:
nobody was asked, and a guessed reason is the [1.32.0] mistake. Those rows read "no reason
recorded" on the staff Appointments screen.

### A reschedule must give a reason

`PUT /appointments/:id/reschedule` takes `reason` and refuses a blank one (400, "Say why the
appointment is being moved."), or one over 500 characters. The dialog offers five common reasons as
one tap each (Schedule conflict, Feeling unwell, Can't prepare in time, Transport problem, Clinic
asked to move it) and "Other", which needs words; Confirm stays disabled until there is one. The
same dialog serves the patient and reception moving a booking over the phone, so it is worded for
both. The reason is saved as the words chosen, so the list can change without touching a row.

It goes everywhere the move already went: the audit entry, the staff notification ("Reason: …"),
the patient's email, the patient's own booking card ("Moved · Feeling unwell") and the staff
Appointments screen.

### The patient no longer types the amount they sent

The proof-of-payment form had an editable "Amount sent" box under a sentence already stating the
figure, so a patient could send, and claim, something other than what the booking owes. The box is
gone; the amount sits beside the account number with a copy button (digits only, ready for a banking
app's amount field).

The API is unchanged: `amountClaimed` is still accepted and still only evidence. When it is
omitted, as the portal now omits it, the server records the visit's amount due, on the same
`SUM(price_at_time)` basis the patient was shown and the cashier's queue puts beside it. So a claim
from the portal never raises the cashier's "amount differs" flag; the flag still works for a claim
that states its own figure.

The screenshot reader used to fill the amount box. It now compares what it read with the amount due
and warns, without blocking, when they differ ("The amount does not match."), since the screenshot
is now the only place a short payment shows before a cashier opens it.

### Tests

`appointment-reschedule.spec.js` refuses a missing, blank and over-long reason and checks the
stored one; `reschedule-ui.spec.js` drives the reason picker; `manual-payment.spec.js` submits a
claim with no amount; `booking-pass-gating.spec.js` checks the panel shows the amount with a copy
button and no number box.

## [1.104.0] - 2026-10-12 (The department chart follows the report file, after the entry form changed)

No migration. Documentation only.

Merged Diazzzz-cpu's work, which had already landed the critical-value removal independently and
then merged mine. One of their changes moves a diagram: "The report is the document, not the
typing" took the templates, the measurement grid, Findings and Remarks out of the result entry
dialog, so a result IS the uploaded file, and the file is demanded at RELEASE rather than at save.
"Save Findings" became "Save for Later" because that is what it does.

The three department flowcharts said "Save findings" and "Release the result". They now read
Upload report file → Ready to release? → Authorise and release, with the no branch going to "Save
for later" — the two buttons the dialog actually offers — and correcting a released report on
History reads "Correct and re-notify", which is its button too.

**The ERD is unchanged and still right.** `result_field_sets`, `result_fields`,
`result_field_set_tests` and `result_measurements` are still in the database — the grid was
removed from the screen, not the tables from the schema — and the ERD is generated from the live
database, so it keeps drawing all 36.

## [1.103.0] - 2026-10-12 (The diagrams checked against the system, and the two places they disagreed)

No migration. Documentation only.

Steven asked whether the diagrams match the current system. Checked rather than asserted: the
committed `.drawio` files regenerate byte-identical, the ERD is read from the live database and
draws 36 of 36 tables, and every screen name, route and permission in the flowcharts, use cases
and DFDs was compared with `config/navigation.js` and the API. Two disagreements, both real:

- **Five charts skipped Today.** Since [1.77.0] every member of staff signs in to Today and opens
  their console from the sidebar; Super Admin and Admin said so and the Receptionist, Cashier and
  three department charts went straight from the access check to their console. They land on Today
  now, and each column opens with the screen it uses (Desk, Billing Queue, a worklist, a History),
  which also keeps a screen's name out of the other columns. The Desk's no-show moved inside the
  Desk column behind "Someone at the desk?", and amending a report moved to History, where the app
  offers Edit.
- **Four use cases did not name Today.** Admin, Receptionist and Cashier listed "View Today";
  Super Admin and the three departments did not, though they land there too. All eight staff
  actors name it now.

**The checker gained the fault that slipped past it.** Rerouting the no-show put a line straight
down through three boxes, and nothing complained: OVERLAP compares boxes with boxes and never
looks at a line. `checkDiagrams.cjs` now reports a line that passes through a box it is not
attached to, judging only the axis-aligned segments the build script fixes — a diagonal in the
file means draw.io is routing that stub itself and its real path is not in the file, so testing
its bounding box reports every box in a wide sweep (19 of them, on the first attempt).

Verified in both directions, which is the point of a checker: with the old routing put back it
reports the three crossings, and with the fix in place it reports none.

Checked: `checkDiagrams.cjs` clean on all 36 pages, and all 36 PNGs re-exported and distinct.

## [1.96.0] - 2026-10-04 (A report may be a Word document or a spreadsheet)

No migration and no setup step. `test_results.file_mime_type` is free text and already holds
whatever type was accepted.

### Why

The clinic's reports come out of more than one program: the laboratory analysers export
spreadsheets and the radiologist types into a word processor. Since [1.94.0] the attached file IS
the result, so accepting only PDF, JPEG and PNG meant a technician converting a report the clinic
had already produced — the double work [1.94.0] set out to remove.

### What is accepted

PDF, JPEG and PNG as before; Word documents (DOCX, DOC, ODT, RTF); spreadsheets (XLSX, XLS, ODS,
CSV). Macro-enabled Office files (DOCM, XLSM) are refused: a report has no reason to run code on the
patient's machine. The list lives in `backend/src/constants/reportFileTypes.js`, mirrored for the
instant check in the dialog by `frontend/src/lib/reportFileTypes.js`.

### Why the declared type is no longer enough on its own

It was enough for PDF and images because browsers report them consistently. Office files are not
like that: Windows reports a .csv as `application/vnd.ms-excel` whenever Excel is installed, and a PC
without Office can send a .docx or .xlsx with no type at all. So for those types three things
decide together: the extension (from the allowlist, never used raw to build a path), a label that
type is known to arrive with, and the saved file's contents. `upload.js` checks the contents after
multer writes the file and deletes a mismatch before anything records it, so an executable renamed
to report.docx is refused with "This file is not a valid Word (DOCX) file". The contents check now
covers PDF, JPEG and PNG as well; every existing fixture already carried a real header.

The stored type is the canonical one for the format, not the browser's label, so a CSV labelled as
an Excel file is saved, served and emailed as `text/csv`.

### Viewing and downloading

PDFs and images still open in the browser. Word, Excel and CSV reports are served as downloads
(`Content-Disposition: attachment`), because no browser renders them and a CSV shown inline is a
page of raw text. `ResultDocument` already offered "Download it to open in the right application"
for anything it cannot preview, and the result email already attached any stored type, so neither
needed a change.

### Tests

`result-file-types.spec.js` uploads genuine minimal .docx and .xlsx files (built in
`helpers/officeFiles.js`, which Word and Excel open) and a CSV, releases one to the patient, and
checks the headers and bytes they receive, plus the refusals. Unit tests pin both allowlists.

## [1.102.0] - 2026-10-07 (The flowcharts take the paper's own header)

No migration. Documentation only.

Steven, with Figure 4 (Cashier Side) from the paper: make the flowcharts that way.

The content was already right; the opening was not. The actor, Login and the access check sat in a
diagonal across the top left, with the landing screen off to their right, where the paper stacks
all four CENTRED above the columns: the actor and its name, Login, Access Granted? with the no
branch looping back up the left side into Login, then the landing screen, and only then the
columns. That is what the figures now draw.

The fan out of the landing screen is one shared BUS — down out of its bottom edge, across, and
down into each column head. Left to itself draw.io took the nearest perimeter point, so one branch
left the landing box by its left side, one by its bottom and one by its right, which reads as three
different kinds of thing when they are the same thing three times.

On a chained chart (the client's, which is one sequence wrapped into columns) the header is
centred over the FIRST column instead of the whole block: a fan reaching left across the other
columns would cross the link corridor that carries the chain.

Checked: `checkDiagrams.cjs` clean on all 36 pages, and all 36 PNGs re-exported and distinct.

## [1.101.0] - 2026-10-07 (Level 1 is one actor at the top left, with a track per flow)

No migration. Documentation only.

Steven, with a reference figure: follow that type for Level 1, and — on [1.100.0]'s attempt —
"the way u make the same actor but multiple what the hell". Fair. Repeating the actor beside each
process is a textbook convention, and it is also seven boxes with the same word in them, which is
not what the paper's figures look like.

The sheet is now the reference's shape: one small actor at the TOP LEFT, the processes numbered
down the middle, the data stores down the right.

What makes it readable is the left margin, where every flow to and from the actor runs. Each flow
gets a TRACK of its own there — a vertical line at its own x — rather than the single shared trunk
of the first version, which is what put ten labels on one line with nothing to say which process
each belonged to. Two rules keep the tracks from crossing: the lower the process, the further LEFT
its track, and a flow leaves the actor lower the further down it is going. Each label is pinned
beside its own process rather than floated along the path, because the paths differ in length by a
factor of ten and a label at the same fraction of each lands somewhere different every time — on
the first row it landed on top of another flow's track.

`Page.edge` takes `{at, dx, dy}` for a label pinned to one END of a path with a pixel offset; a
plain number still slides it along, which is what the flowcharts use.

Checked: `checkDiagrams.cjs` clean on all 36 pages, and all 36 PNGs re-exported and distinct.

## [1.100.0] - 2026-10-07 (The DFD actor is never drawn big; the routing does the work)

No migration. Documentation only.

Steven, on [1.99.0]'s Level 0: follow the paper's own type of diagramming, and do not make the
actor too big — then the same for Level 1. [1.99.0] had made both boxes as tall as the stack of
flows so every arrow could run straight across, which is readable and is also a slab with one word
in it where the paper has a small labelled rectangle.

The boxes go back to the paper's sizes and the ROUTING carries the clarity instead.

- **Level 0** is the original shape: a 420x170 process box, a 210x90 actor, flows routed around
  them. Every flow gets a corridor of its own, and the corridors are NESTED — the one furthest
  from the boxes starts furthest right on the actor and comes down furthest left on the system —
  so no two flows in a group ever cross. Inputs run above the boxes, outputs below, so the
  direction reads before the arrowhead does, and each label sits alone on its own corridor.
- **Level 1** draws the actor beside each process at its ordinary size, which is the standard way
  out of this problem and also what keeps every arrow short: the alternative, one box down the
  side of the sheet, is the slab Steven objected to, and the version before that ran every flow
  down a single trunk with ten labels on one vertical line. Both ends of a flow are read off the
  same absolute height, so the line is dead straight rather than carrying the small jog that comes
  of giving the shorter actor box its own even fractions. The foot of each sheet says the repeated
  actor and any repeated store are one actor and one store.

Checked: `checkDiagrams.cjs` clean on all 36 pages, and all 36 PNGs re-exported and distinct.

## [1.99.0] - 2026-10-07 (Diagrams: one flow one line, and one way through each role)

No migration. Documentation only.

Steven, reading the figures in draw.io: the arrows on the data flow diagrams do not show what is
related to what, and the role flowcharts have parts that are confusing and redundant.

**Both DFD levels now draw every flow as a straight horizontal line with its own label.** The
fault was the same on both, and it was the layout, not the content: a box 90 to 110 px tall had to
carry five to eleven flows, so each one left a single point, bent twice and ran the width of the
sheet to reach its own row. The labels floated over a comb of parallel lines, and nothing said
which label belonged to which arrow. Now the two boxes on a Level 0 sheet are as TALL as the stack
of flows, so each arrow leaves and lands at its own height; inputs sit above a gap and outputs
below it, and the arrowhead is the only thing that has to be read. On Level 1 the actor is one tall
box spanning the whole column of processes — before, every flow left it from one point and ran down
a single trunk, which put ten labels on one vertical line. A data store is drawn beside the process
that uses it, so those arrows are short too, and a sheet that draws one store twice says so at its
foot rather than leaving a reader to count two Appointments and Visits.

**The Receptionist chart drew the walk-in path three times.** "Booking today? no → Register as
walk-in", then a column for a patient already on file, then another for a new patient — each
ending in its own "Issue queue ticket". The Desk is ONE screen: a box that takes a name, a
reference or a scan, and the answer decides whether the next click is Check in or Register. So
there is one path now, the ticket is issued once on it, and registering is the no branch that
rejoins. It also stops claiming the receptionist releases the visit to the department: paying does
that, which is why the chart ends at "Send patient to the cashier" with the already-paid case
going straight through.

**The others, in the same spirit.** The Cashier's "Choose payment method" and "Enter cash and
change" became one step, and reversing a receipt moved under Transaction History, where the
receipt is found, instead of hanging off the landing screen as though a refund started from
nowhere. A department chart now says that saving and releasing are two acts — saving parks the
ticket in 'Waiting for Release' and nothing has left the department — and draws the patient's
email as the consequence of releasing rather than as another thing the technologist does. Admin
and Super Admin lost the steps that restated the step above them.

**A branch that rejoins now merges into the TOP of the step it rejoins**, down its own column and
across the gap above it. Entering from the right, which is the obvious way to draw it, put the line
through the box in between, and where the target was a decision it arrived at the very vertex that
decision's own branch leaves from — one arrowhead appearing to point into a diamond and out of it.

Checked: `checkDiagrams.cjs` clean on all 36 pages (no decision with one exit, no dead end, no
overlapping boxes, no label too long to read), and all 36 PNGs re-exported and distinct.

**If draw.io has one of these files open, close it without saving before pulling.** It holds the
copy it loaded, and saving would put the old drawing back.

## [1.98.0] - 2026-10-06 (The critical-value workflow is withdrawn from the system)

`node src/scripts/migrateRemoveCriticalValues.js` — `--rollback` restores the columns, empty.

Steven: the clinic is not responsible for telephoning a panic value back, so [1.96.0] took it out
of the paper's diagrams. That left the opposite problem — a Critical Callbacks tile on the
worklist, a "critical results to phone" row on Today and a callback dialog behind both, for a
workflow the clinic does not perform. A feature nobody will use is worse than a missing one: it
counts zero forever, and the first person who reads it as a promise is let down by it.

**Dropped:** `test_results.is_critical`, `.critical_acknowledged_at`, `.critical_acknowledged_by`
and `.critical_acknowledgement_note`, with `fk_results_critical_ack_by` and
`idx_test_results_critical_ack_by`; the `results:acknowledge_critical` permission (its role and
account grants cascade); `POST /results/:visitTestId/acknowledge-critical` and
`GET /results/critical/outstanding`; `CriticalCallbackDialog`, `useCriticalCallbacks`, the tile,
the Today descriptor `criticalNeed`, the entry dialog's flag, the version badge, and the `critical`
column of the diagnostic throughput report and its CSV.

**The flag is copied into `audit_log` before the drop.** A flag set on a released report is a
clinical statement somebody made about a real patient, and `--rollback` can restore the shape of
those columns but never their values. Every flagged row is written out as `result.critical_flag_retired`
naming the result, its version, when it was released and whether a callback had been recorded. One
row on this database; the entry is now the only record of it.

**What stayed, and why.** The `critical` notification severity remains in
`chk_notification_events_type` and in `notificationService.VALID_TYPES`, with the bell's rendering
for it. Severity belongs to the notification subsystem rather than to this feature, and the next
genuinely urgent event should not have to re-argue a CHECK constraint to say so. Nothing sends it
today. Abnormal-value highlighting (`lib/abnormalValues.js`, `FindingsText`) also stays: it marks a
figure outside the range printed beside it on the clinic's own form, which is a reading aid, not a
judgement — the comments that called it "not a substitute for the critical-value workflow" now say
what it is on its own terms.

`migrateIndexHygiene.js` [1.29.0] no longer creates `idx_test_results_critical_ack_by`. Removed
rather than guarded: a database old enough to need that script still has the column when it runs,
and one new enough not to have it was built from `schema.sql`, where the index no longer exists
either.

**Structured result entry is the other half of [1.97.0]'s open question, and it STAYS.** The field
sets, the laboratory grid and the two-signatory printed form are built from the clinic's own report
archive and do real work; the paper will carry one paragraph saying the system supports structured
entry and the clinic currently uploads its reports instead. That is a sentence in the paper, not a
migration.

Checked: 425 E2E (0 skipped, down from 430 — `critical-callback.spec.js` and five cases gone, one
added for an amended release), 81 backend unit, 107 frontend unit, lint, build, prose scan,
`verifyRbacWiring` (76 gated routes, 31 permissions), and `schema.sql` rebuilt into a throwaway
database and diffed against the live one: 36 tables, 328 columns, 144 indexes, 316 constraints,
identical but for four FK NAMES that predate this change (migration-created `*_fkey` against
schema.sql's explicit names).

## [1.97.0] - 2026-10-06 (The department uploads the report; the diagrams no longer show encoding)

No migration.

Steven: the departments will only upload the test or report, so typing the values into a form is
not part of the clinic's workflow. The diagrams now say upload:

- the department flowcharts step from "Perform test" to "Upload report file";
- the use cases read "Upload Laboratory / Ultrasound / X-Ray Report", and amending a released
  result is "Replace Released Report";
- the Level 0 inputs are report files, and Level 1 process 11.0 is "Upload Results", which no
  longer reads the result form from D6.

The upload path this describes is real: `POST /results/:visitTestId` takes multipart with a `file`
field, the bytes are stored outside the database under `uploads/results`, and the file is served
through an authenticated, ownership-checked route.

**What this leaves undocumented, for a decision.** The system also has structured result entry,
built from the clinic's own report archive: `result_field_sets`, `result_fields`,
`result_field_set_tests` and `result_measurements` (4 of the 36 tables, still on the ERD because it
is generated from the live database), ten seeded ultrasound field sets, the laboratory grid with
reference ranges and its two-signatory printed form, and two specs. Together with the critical-value
feature [1.96.0], the running app now does two sizeable things the paper will not describe. Either
they come out of the system, or the paper carries one short paragraph saying the system supports
them and the clinic does not use them. Left as built until Steven says which.

## [1.96.0] - 2026-10-06 (Critical-value callbacks out of the diagrams; the system still has them)

No migration.

Steven: the clinic is not responsible for calling a physician about a critical result, so it does
not belong in the paper. Removed from the diagrams:

- the "Critical value?" decision and its "Call doctor and log it" branch, in all three department
  flowcharts;
- "Record Critical Value Callback" from the Laboratory, Ultrasound and X-Ray use cases;
- the "Critical callback" flow into the three department Level 0 sheets, now "Report delivery".

**The ERD still shows four columns, and that is not an oversight.** It is generated from the live
database, where `test_results` still carries `is_critical`, `critical_acknowledged_at`,
`critical_acknowledged_by` and `critical_acknowledgement_note`, with one row flagged. Deleting them
from the drawing would make the ERD describe a database that does not exist.

The feature is also still in the running system: 29 files, the `results:acknowledge_critical`
permission, the callback dialog, the Critical Callbacks tile on Today, and `critical-callback.spec`.
Left alone pending Steven's decision — either it comes out of the system too (a migration to drop
the columns, the permission, the screens and the spec), or it stays and the paper says nothing about
it, which leaves a tile on Today that no figure explains.

## [1.95.0] - 2026-10-06 (A checker for the diagrams, and the three faults it found)

No migration. Documentation only.

Steven read the figures and found a decision with only a "yes" coming out of it. Reading 36 figures
by eye does not scale, so `docs/diagrams/checkDiagrams.cjs` now reads the generated files back and
reports what a reader would trip over: a diamond with fewer than two ways out or an unlabelled
branch, a step that leads nowhere, two boxes whose rectangles intersect, and a label too long to
take in at a glance. It exits non-zero, so it can gate a rebuild.

- **A decision with one exit is not a decision.** The Receptionist's "HMO patient?" had only a yes.
  It now carries a no ("Bill as self pay"), and "Booking today?" has a real no ("Register as
  walk-in") in place of a third branch labelled "scan", which was not an answer to the question.
- **The client flowchart said the patient did four things at once.** Its columns hung off the
  landing screen as parallel branches when they are one sequence: book, confirm, pay, collect. A
  chart can now declare `chain`, which links each column to the end of the one before it and sends
  only the last to End. The link leaves sideways into the gap between columns and climbs to a
  corridor above them; routed directly it climbed through every box of the column it was heading
  for.
- **A side branch rejoining the chain drew on top of the decision's own "no" line.** It leaves from
  the bottom of the side box and enters the next step from the right.

The checker's own first version was wrong in a way worth recording: one regex with optional groups
and lazy gaps returned undefined for whatever it skipped, so it reported every decision as having
no way out and 336 dead ends. Attributes are read one at a time now. A checker that cries wolf is
worse than none, because the real fault hides in the noise.

### Checked

- `node docs/diagrams/checkDiagrams.cjs`: 0 decisions with one way out, 0 dead ends, 0 overlapping
  boxes, 0 over-long labels, across all 36 pages.
- All 36 pages re-exported, 36 unique images.

## [1.94.0] - 2026-10-06 (The diagrams in black ink, with labels short enough to read)

No migration. Documentation only.

Steven: black ink, simplified text. Colour carried no meaning in these figures and only cost
contrast on a photocopy or a projector, and the labels were written as sentences, which a reader
has to decode at a glance.

- Everything is black on white: the blue flow labels, the blue ERD tables and the orange actor are
  gone. Type sizes up (14 in boxes, 12 on flows and in the ERD), boxes larger to match.
- Every label cut to a phrase: "Stamp arrival and issue today's queue ticket" is now "Issue queue
  ticket", "Compare amount claimed with amount due" is "Check amount due". Process and data store
  names shortened the same way.
- Three faults the exports showed, each fixed in the layout rather than by hand:
  - A column's last step ran along its own row to reach End, cutting through the boxes of every
    column to its right. Each column now drops to a clear corridor below the columns first.
  - The actor's name printed on top of the figure; it sits below it now.
  - Two flows between one process and one data store printed their labels in the same place
    ("DiTests and prices"). The anchors are staggered per store and the labels pulled back towards
    their own process.

## [1.93.0] - 2026-10-06 (The capstone paper's diagrams, generated from the system)

No migration. Documentation only, in `docs/diagrams/`.

The paper's figures described an earlier, smaller system: the client flowchart still asked whether
the patient was a human or a pet, the cashier issued the queue number, and the ERD showed 14 tables
against the 36 the database holds. They are redrawn in the same draw.io style as the originals, as
editable files plus exports.

- `buildDiagrams.cjs` writes five `.drawio` files: 8 role flowcharts (including a Super Admin chart
  the paper never had), 8 use case diagrams, 9 Level 0 sheets (the per-actor ones plus a context
  diagram), 8 Level 1 sheets, and the ERD across 3 sheets. `exportPng.ps1` exports all 36 pages.
- **The ERD is read from the live database** rather than transcribed: tables, columns, PostgreSQL
  types, nullability, primary keys and foreign keys. The script reports if a table is missing from
  the sheets, so a new table cannot quietly go undrawn.
- The System Architecture figure is deliberately not regenerated; it stays as drawn in the paper.
- What the new diagrams assert, each of which the old ones got wrong: there is no veterinary branch;
  a booking issues a reference and QR code while the queue ticket comes at check-in [1.92.0]; the
  cashier issues the receipt only; a rejected proof of payment ends the flow rather than reaching
  "record the payment"; an Admin decides HMO claims but cannot write or email a result.
- Processes are numbered from one master list (1.0–20.0) used across every Level 1 sheet, and the
  nine data stores name the real tables behind them.

### Checked

- All five files parse as XML; 36 pages, 36 unique PNG exports at scale 3.
- Every step in all eight flowcharts has an outgoing edge, checked by walking the generated XML, so
  no branch dead-ends by accident.
- 36 of 36 tables drawn across the three ERD sheets.
- Found while exporting: draw.io's `-p` page index is one-based, and passing `0` exports the first
  page with no error, which shifts a whole run by one. Both scripts and the README say so.
## [1.95.0] - 2026-10-03 (Critical-result callbacks are removed)

**Run `node src/scripts/setupRbac.js` once per environment.** It is the only step; there is no
schema migration.

### Why

The clinic produces clinical RESULTS and does not diagnose. A panic-value callback is an act of
clinical judgement they do not perform, so there was no call for them to make and nothing to
acknowledge. Asked directly, they said the function was unnecessary.

### What went

The checkbox on the entry dialog; the Critical Callbacks queue, its tile on the worklist and its
acknowledge flow; the "please contact the clinic" email that replaced the routine one; the critical
escalation notification to the front desk; Today's "results to phone" card; the critical column on
the diagnostic throughput report; and `results:acknowledge_critical` with all six of its grants.

Gated routes drop 78 -> 76. `GET /results/critical/outstanding` and
`POST /results/:visitTestId/acknowledge-critical` are gone.

### What stayed, and why

`is_critical`, `critical_acknowledged_at`, `critical_acknowledged_by` and
`critical_acknowledgement_note` keep their columns and their rows. Three results are flagged, one
carries a logged callback, and the audit log holds four entries naming who telephoned whom. That is
a record of a clinician judging a value dangerous and somebody acting on it; removing the feature
is not a reason to erase it. Nothing writes those columns any more and nothing displays them.

The notification severity styling in `SidebarLayout` also stays. It is generic rendering keyed on a
`type` value shared by all four severities, not part of this feature, and four historical
notifications still carry `critical`. Stripping a severity branch out of a shared component for
four rows is regression risk with no benefit.

### setupRbac learned to retire a permission

It adds and reconciles; it has never pruned, and its own comment says absence from the template is
not enough. So deleting the entry would have left the row and all six grants in every database that
had already run the old version — and a retired permission is worse than a stale grant, because it
appears on SuperAdmin's "Who sees what" grid as a capability somebody can tick while nothing checks
it.

`RETIRED` mirrors `REVOKED`: an explicit list, a stated reason per entry, applied on every run,
grants deleted before the permission row they reference. Verified on this database — six grants and
one permission row removed, 32 permissions down to 31, `verifyRbacWiring` still "All good".

### Caught during the removal

Deleting the column from `createResult`'s INSERT left `$11` behind in the VALUES list: 13
expressions against 12 columns, so every result write returned 500 with "INSERT has more
expressions than target columns". The E2E suite found it immediately. Worth recording because the
same shape of error is invisible to a syntax check and to lint.

## [1.94.0] - 2026-10-03 (A result is the report the clinic attached, not findings typed again)

No migration. No column added, dropped or altered.

### What the clinic asked for

Recording findings by typing them into the website is work done twice: they already produce a
report file for every diagnosis. The structured measurement grid, "Findings & Impression", "Remarks
/ Recommendations" and the Clinical Report Templates are removed. The file input that was already
on that dialog, marked Optional, is what a result now IS.

The data agreed before the decision did. Across 35 seeded field sets and 133 fields, exactly **4**
results in the database ever carried a structured measurement, while **84 of 90** already had a
file attached. The grid was built and not used.

### The rule

`RESULTS_REQUIRE_FILE` (default on, `=false` to revert without a deploy) refuses a RELEASE whose
current result has no `file_path`. Deliberately not a guard on recording: a technologist still
parks a ticket in 'Waiting for Release' while the report is produced, which is what that state is
for. The check reads the STORED result, so an amendment carrying no new upload passes on the file
it inherited — checking the upload would make every correction impossible.

### A patient is served the version that was AUTHORISED

`GET /results/:visitTestId/file` checked ownership and department and then streamed whichever
version was `is_current`. It never checked release. Two failures lived in that, pulling opposite
ways: an unreleased draft was reachable by the patient, and an amendment — which makes the
unreleased v2 current and reopens the visit — would, under a naive "must be released" gate, have
taken away the copy they had already been sent. `findLatestAuthorisedByVisitTestId` answers both.
Gated on `authorised_at`, never `released_at`, which carries DEFAULT CURRENT_TIMESTAMP and is never
null.

### What was kept, and why

- `findings` and `remarks` columns, and every READ path. 90 results carry findings text.
- `ResultReport.jsx` as the LEGACY renderer for results with measurements or no file. The generated
  certificate is no longer produced for new results.
- The measurement WRITE path (`mergeMeasurements`, the derivation pass,
  `GET /results/field-set/:visitTestId`). Unreachable from the product, retained: deleting the
  field-set lookup also deletes the "does not record structured measurements" 400, after which a
  `measurements` key would be silently ignored.
- `result_field_sets` / `result_fields` / `result_measurements` and all 35 seeded forms. Nothing
  was dropped; this change is reversible at the schema level because it touches no schema.

### Three screens that only knew findings

Critical Callbacks showed a findings snippet as the only context before a panic-value phone call;
it now names the attached report. It does NOT offer to open it: that queue is deliberately not
department-scoped because the front desk makes the call, while the file route IS scoped, and a
Receptionist belongs to no department — an open button there would 403 for the one role it serves.
The amendment timeline gated its expander on findings and would have shown empty rows. The worklist
says "Attach Report" where it said "Record Findings".

### Not executed

`seedDemoScenario.js` attached a PDF only for Ultrasound and X-ray, so the guard would have stopped
it on the first Laboratory visit. Every result now carries one, and `amend()` attaches a corrected
document rather than inheriting the original. **This was not run**: `npm run demo` chains
`resetDemoData --confirm`, which deletes the clinic's demo dataset, and the seeder has no dry run.
Exercise it on a disposable database before the next demo.

## [1.92.0] - 2026-09-15 (A booking joins the queue when the patient checks in)

No migration: `queue_number` was already nullable, and the unique ticket index skips NULL.

Steven's pick of the two fixes [1.90.0] left open. The other, counting a visit by its appointment
date, would have changed every "today" list and still needed a new ticket on the day.

- **What was wrong.** A booking joined the queue on the day it was MADE, with a ticket from that
  day's counter. Next week's bookings sat in today's Desk queue and at the till as "waiting". A
  booking made last week never joined the queue on its own day, so a patient who booked ahead and
  came in unpaid could not be found at the till, a department's worklist showed them waiting since
  the day they booked (and first in line), and the reports counted a wait of days.
- **Now.** Check-in (`appointmentService.updateStatus` to Confirmed) stamps the visit with the
  moment the patient arrived and gives it today's next ticket, in the same transaction as the
  status. Only the first check-in does it; confirming again keeps the place and the number. The
  reply carries the ticket, and the Desk says it ("Checked in with queue ticket 0021").
- A booking has no ticket until then. The booking confirmation, the pass and the emails say the
  number is given at the desk when you check in. The Desk's check-in and no-show dialogs and the
  staff notification for a new booking name it by its reference, and an online payment for one is
  described by its visit rather than as "Queue #null".
- **One rule for who is in the queue**, `constants/queueMembership.js`: opened today, Pending or
  Processing, and checked in if it came from a booking. The Desk and the till, the public "how busy"
  count and the patient's own "people ahead of you" all read it.
- The reception wait (check-in to payment) leaves out a visit paid before it joined the queue. A
  booking paid from home would otherwise count as a negative wait.
- The time a booking was made stays on the appointment row.

### Tests

- booking-queue.spec (new): a booking has no ticket and is in neither the queue nor the public
  count; check-in hands back today's ticket; the visit is then in the queue with it, starting now;
  and a second check-in keeps the same ticket.
- receipt-scan-queue.spec's "the patient and the receptionist are shown the same number" books and
  checks in its own booking. It relied on a booking already sitting in today's queue, which no
  longer happens by itself, so it would have been skipped.

### Checked

- The booking, check-in and queue specs (74) passed, then the full suite: 430 passed, 0 skipped.
  81 backend and 108 frontend unit tests, lint (with the fill-role and contrast checks), the build
  and prose_scan: clean.
- Each changed query run directly against the database: the Desk queue, the public count, the
  patient's own "people ahead" and the reception wait.

## [1.91.0] - 2026-09-15 (The patient portal's header spreads once the page scrolls, like the public site's)

No migration. Frontend only.

- [1.88.0] made the public site's floating header spread into a full-width bar once the page
  scrolls. The patient portal draws its own header (`PortalHeader`), and it kept floating as a pill
  12px below the top, with the page sliding past its sides and top. Steven: every header must
  spread. It now does, the same way: the header's side and top padding moves into the bar over
  300ms, so the logo, the tabs and the patient chip stay where they are, and the height does not
  change. The shadow goes with the float; the spread bar has a hairline under it. My Account uses
  the same layout, so it spreads too. The staff consoles' top bar was already a full-width bar.
- Both headers mark the bar `data-testid="header-bar"`, and `tests/e2e/helpers/header.js` checks
  that it floats at the top, meets the top edge and both sides once scrolled, and floats again
  back at the top. public-site.spec gains a test for it (Home at 1280), and portal-home.spec's
  phone test runs it at 390. [1.88.0] had shipped with no test.
- Found while writing that check: full width ends at the scrollbar. `html` has
  `scrollbar-gutter: stable` and a 10px scrollbar, so the page is 1270px wide on a 1280px viewport
  and the bar runs exactly to the scrollbar. The first version of the check compared with
  `clientWidth` (1280) and failed a header that was right.

### Checked

- portal-home.spec and public-site.spec: 20 passed. Lint (with the fill-role and contrast checks),
  108 frontend and 81 backend unit tests, the build and prose_scan: clean.
- The full suite: 429 passed, 0 skipped.

## [1.90.0] - 2026-09-15 (A report opened from History shows its values; the demo's numbers read true)

No migration.

### A report opened from History printed no values

- A department's History (Laboratory, X-Ray and Ultrasound History) opens each report from its list
  row, and the list query (`findReleasedByCategory`) carried no measurements, no signatories and no
  patient type. So a CBC opened there printed its heading and its comment and not one value, no
  signature block, and a blank "Patient Type". The patient's own history already attached all
  three. Nothing in the suite had a released result with measurements to open from History until
  the demo data filled the forms in, which is how it surfaced.
- `resultService.withReportParts` now attaches the measurements (one extra query for the whole
  list, never a join) and each category's signatories to both lists, and the list query selects
  the patient type and the result id the measurements hang from.
- ultrasound-measurements.spec's Urinalysis print test now also reads the department History and
  requires the form's values, both signatories and the patient type there.

### The demo's numbers and dates

- The seed paid for two weeks of history today and then backdated it, so a visit on the 3rd
  carried today's queue ticket (#0030) and a receipt dated today, and today's next receipt jumped
  to #0047. `renumberSeeded` gives the visits and receipts this run created the numbers their own
  days would have issued, without gaps and in the order things happened, and sets each day's
  counters to what is in use. It touches only the rows the run created, and never sets a counter
  below a number a surviving row holds.
- The history keeps to opening hours: nothing on a Sunday, mornings only on a Saturday, and each of
  a day's visits at its own hour.
- A booking for a later day is dated one to three open days back, during opening hours, the way
  people book ahead. Next week's bookings no longer sit in today's queue, or in the billing queue as
  "waiting" (the Desk read 20 in the queue, 8 of them for next week). A booking for later today
  keeps today's date, so it still checks in during a demo.

### Found, not changed

A booking made on an earlier day never joins the Desk queue or the till on its own day:
`visitRepository.findActiveVisits` counts visits created today, and check-in does not move the visit
to that day. An advance booking that arrives unpaid therefore cannot be found at the till. The same
root has the other side described above: a booking made today for next week counts as today. It is
a workflow decision (count a visit by its appointment date, or re-stamp it at check-in), left for
Steven.

### Checked

- A read of every day in the demo data: receipts and queue tickets run without gaps, each receipt
  carries its own day's date, and today's counters equal what is in use; every booking for a later
  day was made on an earlier day; today's queue holds only today's visits.
- The booking date query, run as if today were Monday the 14th, Tuesday the 15th, Saturday the
  19th and Monday the 21st: every date it picks is an open day inside opening hours, and a
  Saturday is always 09:00–11:00.
- The full suite: 428 passed, 0 skipped.

## [1.89.0] - 2026-09-15 (Demo data that reads like a real clinic)

No migration. Backend scripts and data only. Steven asked for the test records to go, and for
every record in the system to look real, so it can be demonstrated.

### What looked fake

- 64 hidden payment channels called "E2E GCash channel" and "E2E Bank channel" on SuperAdmin's
  Payment Methods, beside the clinic's real GCash account. manual-payment and proof-review publish
  two on every run and hide them afterwards, and nothing ever removed them.
- The demo accounts were "Super Admin", "Juan Cashier", "Doc Lab", "Sonya Ultrasound", "Xavier
  Ray", "Elena Client" and "Multi Role", names a report, the audit log and every sidebar repeat.
- The demo patients were national heroes (Andres Bonifacio, Emilio Aguinaldo …), registered
  again on every visit, all living in "Sta. Rosa, Laguna" with the phone number 09170000000.
- Result forms were empty: a CBC printed its grid with no values, because the seeder sent a
  sentence and no measurements.
- Every visit of the day was stamped in the same minute, so turnaround read 0 minutes.
- Leftovers of old test runs: the demo patient's record ("Updated Address 123, Test City"), her
  son's ("Noah Client", Quezon City) and an inactive HMO called "Test HMO Partner Renamed".

### What changed

- `purgeE2eData.js` removes the E2E payment channels each run publishes, once no proof names them.
- `resetDemoData.js` removes the E2E channels already built up, and restarts `daily_counters`, so
  a fresh demo's first patient is queue #001 rather than #037. That is safe only there: every
  number the counters issued belonged to a visit or payment the reset has just deleted.
- `seedUsers.js` gives each demo account an invented, ordinary name and number, and renames an
  account only while it still carries its placeholder. The Admin account, renamed by hand to
  "Jessie Uba", keeps its name.
- `seedDemoScenario.js`:
  - 40 invented people with ordinary names, addresses around Bugo and Cagayan de Oro, and a
    number each. One record per person: a returning patient comes back to it.
  - Every result form filled in, inside the clinic's own printed reference ranges; a written
    report ending in its impression for every scan and X-ray; and a few abnormal results, as in a
    real week: a raised sugar, a raised cholesterol, a fatty liver and a pneumonia.
  - Today's visits spread across clinic hours in the order they arrived, so waits and turnaround
    read in minutes, and the queue and receipt numbers rise with the arrival times.
  - Six bookings by the front desk over the next working days, beside the demo patient's two
    online ones.
  - No patient has an email address, so the seed cannot send one.
- The three old records were corrected by hand, and the old demo traffic and the E2E channels
  removed with `resetDemoData.js --confirm`, after a dry run and a full backup of the database.

### Kept, because it is real

The clinic's GCash account and its QR, the price list and Packages A–E, 1CoopHealth, the opening
hours, and the report signatories (Florence Mea D. Enlogada, RMT; Dr. Gerard L. Lamayra; Dr.
Renato M. Rivera Jr.).

### Before a demo

`npm run demo` from `backend/`, with both servers running. It runs `resetDemoData.js --confirm`,
then `seedUsers.js`, then `seedDemoScenario.js`. Every "today" screen reads the current date, so
run it on the day.

### Checked

- A survey of every table afterwards: no row carrying "E2E", the test email domain or the test
  phone number; one payment channel, the clinic's; nine accounts, every one named; 41 patients.
- The full suite: 428 passed, 0 skipped. Its first run failed 25 patient-portal specs, and the
  cause was not the code: the development server's library cache had gone stale (see CLAUDE.md,
  under the routing model). The same run showed the seed had to write a comment on the amended
  laboratory result, because result-version-timeline.spec reads the superseded version's findings.
- `npm run demo` was run again after the suite, so the data on the database is the seed's own and
  not what a test left.

## [1.88.0] - 2026-09-15 (The public header spreads into a full-width bar when the page scrolls)

No migration. Frontend only.

### What was wrong

The public site's header is a glass pill floating 12 px below the top edge and in from the sides.
Once the page scrolled, content slid up past its sides and top and ran into it: on a phone, "Why
patients choose Enlogada" sat against the pill's lower edge with its icon half under it. Steven
asked for it to spread out like an ordinary header once the page scrolls.

### What changed

- `PublicHeader`: at the top of a page it is the same floating pill. Once the page scrolls (12 px,
  `useScrolled`) it spreads over 300 ms into a full-width bar that meets the top and side edges,
  on the plain surface colour with a hairline under it.
- The logo and links do not move while it spreads: the header's side and top padding moves into
  the bar over the same 300 ms. Its height does not change either (the 12 px above the pill
  becomes 6 px above and below the bar), so a sticky header cannot nudge the page and flicker at
  the threshold.
- The phone menu keeps its side gutter once the bar has spread. Reduced motion turns the
  transition off.

### Checked

- Screenshots of Home at 1440 and 390 px, at the top and at three points down the page: the bar
  meets the edges, and nothing shows above or beside it.
- `npm run lint`, including the contrast check, is clean. The spread bar is the surface token, so
  its inks are the app's ordinary ones.
- public-site.spec and the full suite: 428 passed, 0 skipped.

## [1.87.0] - 2026-09-15 (A phone downloads the public site, not the whole app)

No migration. Frontend only.

### What was wrong

The app was built as one JavaScript file of about 1.5 MB. A visitor opening Home on a phone
downloaded every console, chart and admin screen, and the patient portal, before the page could
draw: 1,464 KB, and 407 KB even compressed, over a mobile connection.

### What changed

- `App.jsx` keeps the five public pages in the first file and fetches every other screen the first
  time someone opens it: sign-in, the patient portal, Today, the consoles, the admin screens, My
  Account and the receipt page. The build puts each in its own file.
- Moving between screens is a React transition (`startTransition`), so the screen being left stays
  on show while the next one's code arrives, rather than the app blinking to the loading screen.
  The loading screen appears only when there is nothing to keep on show, such as straight after
  signing in.
- `lib/lazyScreen.js`: a tab left open across a new deploy asks for a file the deploy replaced. The
  first such failure reloads the page once, which fetches the new build. If the file is still
  missing straight after, the error boundary says so, with its Reload button, instead of the page
  reloading forever.

### Measured

The production build, served locally, Home at 390 px:

| | Before | After |
|---|---|---|
| JavaScript files | 1 | 3 |
| Size | 1,464 KB | 398 KB |
| Compressed (gzip) | 407 KB | 124 KB |

Going on to Sign In adds 7 KB compressed. A signed-in user downloads what their own screens need,
the first time they open them.

### Tests

- Frontend unit: `lazyScreen.test.js`, 5 tests (108 in all). It reloads once, never twice, never
  when it has nowhere to remember that it did, and forgets once a screen loads.
- The production build, served locally, signed in as a patient on a phone and as the front desk,
  the cashier, the laboratory, an Admin and the Super Admin, each opening their screens: no page
  errors and no failed file requests.
- The full suite, with [1.85.0] and [1.86.0]: 428 passed, 0 skipped.

## [1.86.0] - 2026-09-15 (The tests stop emailing the demo accounts and stop leaving images behind)

No migration. Backend only.

### Email

- The suite already never mailed its throwaway `@enlogada-e2e.test` accounts. It did mail the
  seeded demo accounts: several specs book with `client@enlogada.com`, and in one day of runs the
  clinic's Gmail made 28 real sends to it. `enlogada.com` has no DNS record at all, so every one
  bounced. That spends the account's daily sending limit (it ran out once, on 2026-08-26) and
  counts against it with spam filters, which a patient pays for when their result lands in junk.
- `utils/fixtureRecipient.js` names both fixture domains, and `config/email.js` skips a send to
  either, before the configuration check. By domain, so a seeded account added later is covered.
  A list of addresses is never treated as a fixture, so a real recipient in one is never dropped.
- A skipped send is treated exactly as a send to a throwaway address always was.
- Production is unaffected unless the clinic registers enlogada.com. The seeded accounts would then
  be real addresses with a published password, so the two must change together.

### Upload files

- The E2E purge removed the orphaned files for results and HMO cards, but never looked in
  `uploads/payments`. 406 files had built up there, 405 of them copies of the suite's 70-byte proof
  image that nothing pointed at. It now sweeps `payments` and `avatars` too, under the same two
  rules: nothing references the file, and it was written during the run. The clinic's QR images
  share the payments folder and are in the referenced set, so a published QR is never touched.
- The 405 leftovers were removed once by hand, after a dry run showed each was unreferenced and
  byte-identical to the test image. The one file still in use was kept.

### Tests

- Backend unit: `fixtureRecipient.test.js`, 5 tests (81 in all). Both halves: a fixture is caught
  however it is written, and a real address, a look-alike or a list never is.
- The lockout, booking-email, result-delivery and payment-proof specs (45 tests) sent 0 real
  emails, skipped 5, and left the payments folder as they found it.

## [1.85.0] - 2026-09-15 (A sign-in lock that has run out starts the count again)

No migration. Backend only.

### What was wrong

Ten wrong passwords lock an account for fifteen minutes. When the lock ran out, the failure count
was not reset: it still stood at ten, so the first wrong password afterwards made it eleven and
locked the account for another fifteen minutes. The person most likely to make that slip is the one
who has just waited out the lock, and at the front desk the morning queue waits with them.

### What changed

- `userRepository.registerFailedLogin`: a failure after a lock has run out counts as the first of a
  new run, and the old lock is cleared. It is still one UPDATE, so two attempts arriving together
  cannot both read the same count.
- The rest is unchanged: ten wrong passwords lock the account, a correct one clears the count, and
  an administrator's password reset clears a lock.

### Tests

- login-protection.spec: a lock that has run out starts the count again. The test locks the
  account, runs the lock out with the new `e2eExpireLock.js` (test addresses only, refused in
  production), then checks that one wrong password answers 401 and the right one 200. Run against
  the old code, it failed: the right password got 423.

## [1.84.0] - 2026-09-15 (The clinic's own photographs on the public site)

No migration. Frontend only. The last step of the public-site plan (S7): the clinic sent photos.

### What changed

- **The Home header shows the clinic.** Its three slides are the ultrasound room, the X-ray room and
  the lit sign, in place of the colour wash that stood in for them. The sign comes last because its
  own lettering sits right behind the headline, and the first slide is the only one a visitor who
  asked for reduced motion ever sees. The rooms are portrait photos cropped to a wide screen, so
  each slide names the point to keep in view (`position`).
- **The logo card is a photo card.** `ClinicShowcase` replaces `LogoShowcase`: the fetal monitor
  beside the ultrasound machine on Home, and the lobby with the sign and the front desk on About.
  Each photo is described for screen readers, and the card still shows the logo when given none.
- **The photos are prepared for the web:** resized, saved as WebP (38–93 KB each) and bundled from
  `src/assets/clinic/`, so a changed photo gets a new file name and is never served stale.
  Re-encoding drops any metadata; none of the five carried a location.
- **The lobby TV is switched off** in its photo. It was showing a film, faces and subtitles included.
- **Left out on purpose:**
  - the reception photo with the MI Healthcare standee: the clinic no longer takes MI Healthcare,
    only 1CoopHealth
  - a photo on the Services page, which has no laboratory photo to match the other two departments.

### The scrim, measured

`checkContrast.js` reads colours from CSS and cannot see a photograph. The black gradient the hero
kept for photos was 20% at its lightest, and the X-ray room is white walls. It is now the clinic's
navy at 60%, deepening to 80% at the bottom where the text sits. Each piece of text was measured
against the brightest 5% of the pixels behind it, on every slide, at 1440 and 390 px and in dark
mode:

| Text | Needs | Lowest measured |
|---|---|---|
| Eyebrow | 4.5:1 | 5.41:1 |
| Headline | 3:1 | 7.25:1 |
| Gradient word | 3:1 | 4.11:1 |
| Subtitle | 4.5:1 | 5.97:1 |

### Tests

- public-site.spec: the header's photos and both photo cards load, and each card describes its
  photo.

The full suite: 427 passed, 0 skipped.

## [1.83.0] - 2026-09-15 (No sidebar counts on Today)

No migration. Frontend only. Steven's answer to the question left open since [1.77.0].

### What changed

- **The sidebar shows no counts while Today is open.** Today's "Needs you now" already states each
  number beside the button that deals with it, so "Billing Queue 4" in the rail next to "4 patients
  waiting to pay" was the same fact twice. Every other screen keeps its counts: there, the rail is
  the only thing saying people are waiting elsewhere.
- On Today the rail asks for none of its counts, so it sends none of their requests.

### Tests

- sidebar.spec: sign-in lands on Today with no count in the rail, and the Desk's count appears on
  the Desk, still the number the Desk shows.

The full suite: 426 passed, 0 skipped.

## [1.82.0] - 2026-09-15 (The patient portal, part 3: the tabs, restyled)

No migration. Frontend only. The last of the three portal commits.

### What changed

- **The tabs are plain panels**, the Flat colouring's one container, like the rest of the app:
  - Appointments is one panel with no heading of its own. The band already says Appointments, and
    "My Appointments" under it was the same name twice.
  - Results is one panel with a row per test, under an attached toolbar that no longer repeats the
    tab's name ("Diagnostic History" under "Results"). "View Certificate Report" is "View report".
  - Payments uses the standard panel header.
  - Profile is three panels: the patient's details (with Edit), the family on the account (with
    Add a profile) and HMO coverage. The HMO card was on the rail colour, a second dark block under
    the band.
- **One profile form.** `AddProfileDialog` and `EditProfileDialog` were the same eight fields in two
  copies that shared DOM ids. `ProfileFormDialog` (`mode="add"` or `"edit"`) replaces both, with ids
  of its own per mode. Its button keeps its label while it saves (`<Button loading>`) instead of
  turning into "Saving…".

### Tests

- portal-home: a new account adds its first patient from Profile through the one form, and the
  header chip then shows them.

The full suite: 426 passed, 0 skipped.

## [1.81.0] - 2026-09-15 (The patient portal, part 2: layout A2 and Home)

No migration. Frontend only. The second of the three portal commits: the layout Steven picked from
the gallery (A2), in the Flat colouring.

### What changed

- **A Home tab, first.** A band reading "Good morning, <name>", with Book a visit. Four tiles sit
  across its lower edge (Next visit, Results, Payments, Family), each opening its tab. Below them,
  "Needs your attention" lists what to pay, what to do before the next visit, or what could not be
  checked, and the latest results are marked New for 14 days after release. Every figure comes from
  the hooks the tabs already use (`lib/portalSummary.js`, unit-tested), and one whose read failed
  shows "—".
- **One list of tabs**: Home, Appointments, Results, Payments, Profile. It sits in the header on a
  screen 1280 px and wider, and in a bar fixed to the bottom of the screen below that. Only one is
  rendered, so each tab name is on the page once, and the page keeps room so the bar covers
  nothing.
- **The tab is remembered.** App holds it (`portalTab`), so My Account and back returns to it. It
  was an uncontrolled Tabs that reset on every page change.
- **A header pill** (`PortalHeader`) holds the logo, "Patient portal", the tabs on a wide screen, a
  "Viewing" chip that switches the patient (`PatientSwitcher`, still named "Active patient
  profile"), and an account button (`AccountMenu`: My Account, theme, text size, Sign out).
- **Each tab opens with a solid band** (`PortalBand`), then the one Refresh, then the tab. Flat: no
  gradient, glow or grid, and only rail ink on the band.
- **Renames:** "Diagnostic Results" is "Results", and "Book Schedule" is "Book a visit".
- **Profile** lists the family on the account and holds Add a profile, which was in a bar above
  every tab. The Viewing chip is the one switcher.
- **My Account** uses the portal's layout, with Back to the portal. The dark "Account Security" card
  is a plain note.
- **Removed:** `DashboardLayout`, `Navbar`, `WelcomeHero`, `ProfileBar`, and `MetricCard`'s dark
  variant, whose only user was the old hero.

### Tests

- `portal-home.spec.js` (new, 4 tests):
  - a new client's Home says what they owe, and its Pay button goes to the booking
  - at 390 px the tab bar sits on the bottom edge and covers nothing
  - the tab survives a trip to My Account and back
  - a failed bookings read shows "Couldn't check", never "None booked".
- `tests/unit/portalSummary.test.js` (new, 13 tests).
- `helpers/portal.js` carries the renames, so no spec changed for them.

The full suite: 425 passed, 0 skipped.

## [1.80.0] - 2026-09-15 (The patient portal, part 1: what was broken)

No migration. Frontend only. The first of the three commits that rebuild the patient portal as A2
in the Flat colouring, which Steven picked. This one fixes what was broken and leaves the layout
alone.

### What changed

- **A failed load of your appointments says so.** `useMyAppointments` logged the failure and
  carried on, so the Appointments tab told a patient holding a paid booking "No appointments booked
  yet." It now reads "Couldn't load your appointments", with Try again.
- **The Details button is gone.** It sat on every result not yet released and had no handler. The
  row now says the result is not released yet and will appear once the clinic releases it.
- **A receipt number on Payments opens the receipt**, at its own address in a new tab. It was
  printed as text. The server already checks that the receipt is the patient's.
- **One tab panel per tab.** Results, Appointments, Payments and Profile each wrapped themselves in
  a `TabsContent`, inside the one ClientDashboard already gave them.
- **The booking dialog names its steps once.** A numbered progress bar ("Select Tests", "Schedule &
  HMO") sat above pills naming the same two steps differently. The pills stay, because they also
  move between steps. The error box is the standard `.alert`.
- **Preparation is addressed to the patient** in their own dialog: "Before your visit". Reception
  still reads "Tell the patient before they leave" (`TestPicker`'s new `audience` prop).
- **Profile names the clinic's real HMO providers**, from the list the booking dialog offers,
  instead of "1CoopHealth" typed into the sentence.
- `data-testid="appointment-scheduled-time"` marks the scheduled time, so
  appointment-communication.spec.js's "the arrival time is never larger" check runs instead of
  skipping itself.

### Tests

- `tests/e2e/helpers/portal.js` (new): `PORTAL_TABS`, `openPortalTab(page, key)` and
  `openBooking(page)`. The nine specs that clicked a portal tab or "Book Schedule" by its words use
  it, so the renames in the next commit happen in one file.
- failure-states: a failed `/appointments/my-bookings` shows the error, not "none booked".
- payment: the receipt number is a link to `?receipt=` that opens in a new tab.
- booking-communication: the patient's dialog says "Before your visit", never "Tell the patient".

The full suite: 421 passed, 0 skipped.

## [1.79.0] - 2026-09-14 (The staff side, tidied)

No migration. Frontend only.

### What changed

- **One name per screen.** Every heading now matches the sidebar and the breadcrumb:
  - "Laboratory Operations Worklist" became "Laboratory Worklist" (the same for X-Ray and
    Ultrasound), and "Laboratory Result History" became "Laboratory History".
  - "Service & HMO Requests" became "Service Requests", "Clinic Services & Price Catalog" became
    "Services Catalog", "Clinic Reports" became "Reports", and "Super Admin Management" became
    "Super Admin".
  - Admin's breadcrumb reads the sidebar's own label from `config/navigation.js`, so "Appointments
    Oversight" and "Patient Records Oversight" are gone from the top bar. So does the diagnostic
    console's heading.
- **No eyebrow gives a group a second name.** Nine admin pages opened with "Administration",
  "Oversight" or "Operations" over their heading, while the sidebar calls the same group
  "Management". They are gone, as the Today eyebrow went in [1.77.0].
- **A count is said once, in the pager.** Service Requests read "1 request" above the list and
  "1 total" below it; Appointments, Activity Log, Laboratory History, Visit History, Transaction
  History and the Services Catalog did the same. The header and toolbar copies are gone. The
  catalogue's pager, which read only the word "services", now reads "Showing 1–15 of 66".
- **One Refresh on the Services Catalog.** Package Deals and HMO Providers each carried their own
  beneath the page's, which already reloads all three lists.
- **My Account has a heading.** It was the one staff screen with no `<h1>`.
- **The queue ticket is one badge everywhere.** The diagnostic worklist and history, Visit History
  and the Desk's booking card now use the same dark ticket as the Desk's queue
  (`<DataBadge variant="queue">`).
- **The worklist and the result history fail like every other list:** the standard error state
  with one Try again, instead of a line of red text with an underlined Retry.
- On those two screens the secondary lines use the muted ink that clears AA, and View Report is
  sized like the buttons beside it.
- **One person** no longer lists `tests:results_write`, the permission nothing checks, and its count
  leaves it out too.

### Tests

- `screen-names.spec.js` (new, 6 tests): each role's screens carry their sidebar name as both
  heading and breadcrumb, and My Account has a heading.
- The specs that asserted old headings follow the new ones: workflow-context, hmo-card-review and
  today.

The full suite: 420 passed, 0 skipped, across 63 spec files.

## [1.78.0] - 2026-09-14 (Access Control becomes "Who sees what")

No migration. Frontend only: the grid reads and writes the role templates through the same
endpoints the old screen used.

### What Steven asked for

Twice: "dont forget about the UI i want in assigning roles, the picture i attached". The picture was
section 3 of the decisions page: a row for each kind of information, a column for each kind of
staff, and in every cell a ✓, ◐ or – with a short sentence.

### What SuperAdmin sees now

- Super Admin opens on **Who sees what**. The rows are Patient records, Today's queue, Bookings,
  Money, HMO claims, Results and reports, Critical-result calls, Clinic reports, Services and
  prices, and Staff accounts. The columns are Front desk, Cashier, Lab / X-Ray / Ultrasound and
  Admin; "Each department" splits the three into columns of their own.
- Each cell has a mark (all, some or none of that row's permissions) and a sentence worked out from
  the switches, for example "See takings, refund, discount and send in online proofs; can't take
  payments".
- Opening a row shows one switch per permission per column, in plain words ("Refund or void a
  payment"). The departments' column moves all three together, and says "(differs by department)"
  when they do not match.
- Nothing is saved until Save. Until then the footer lists each change as a sentence ("Front desk
  can now refund or void a payment.") and warns when a change would leave something that only
  SuperAdmin could do. Discard puts every switch back.
- Changing who sees what (`rbac:manage`) is shown but locked: it is SuperAdmin's alone.
- **One person** keeps the per-account exceptions and extra departments, unchanged and still
  audited.

### How it is built

- `lib/whoSeesWhat.js` (pure, unit-tested): the rows and columns, the sentences, the marks and the
  list of changes. A permission no row names lands under "Other", so a new one is never unreachable.
- `hooks/useWhoSeesWhat.js`: the working copy. Save sends only the roles that changed, one
  `PUT /rbac/roles/:id/permissions` each; if one fails, the rest stay listed as unsaved.
- `components/admin/WhoSeesWhat.jsx` draws the grid. **Who sees what** and **One person** are two
  Super Admin tabs, and `RoleMatrix.jsx` draws whichever is open. `useAccessControl.js` now loads
  the matrix and edits one person.
- The screenshot pass found "Who sees what" said three times (the tab, a mode switch, the panel
  title). It is said once now, on the tab. It also found the Super Admin tab strip cut off on a
  phone ("Payment M"); the strip wraps now.
- One leftover permission, `tests:results_write`, is left off the grid. It is in the permissions
  table but no route, service or seed script refers to it and no role holds it; `results:write` is
  the one that gates recording findings. A switch for it would save and change nothing.

### Tests

- `access-grid.spec.js` (new, 7 tests):
  - the grid reads like the picture
  - a switch says in words what it will change, and Save changes the role on the server
  - Discard saves nothing, and the lone holder of a permission is warned about
  - `rbac:manage` has no switch
  - the departments move together and can be split
  - One person is still there
  - "Who sees what" is said once on the screen
- `tests/unit/whoSeesWhat.test.js` (10 tests).

The frontend unit tier grows to 90. The full suite: 414 passed, 0 skipped, across 62 spec files.

## [1.77.0] - 2026-09-14 (Every member of staff lands on Today)

No migration. Frontend only: no endpoint, permission or backend file changed.

### What Steven asked for

On the decisions page he chose "A and B": "Today" first in every staff sidebar, and the screen
sign-in lands on. Admin's Dashboard becomes Admin's Today, so an Admin has one home rather than two.
Permissions stay as they are.

### What Today shows

It answers two questions, in this order: what needs me now, and how is today going.

- **Needs you now.** One list for the whole screen, each row with the one button that deals with it:
  - a critical result to phone (front desk, departments, Admin): Record the call, on Today itself
  - a visit in the queue with no tests (front desk): Add tests, which opens the Desk with that
    visit's tests already open and the queue narrowed to the person
  - patients waiting to pay, and online payments to check (cashier): Open the till, Check them
  - a department's worklist, with the oldest ticket named: Open worklist
  - released reports whose email never went, where an address is on file: Open History, already
    filtered to "Not sent"
  - HMO requests waiting for a decision (Admin): Review

  When nothing waits, it says so and offers the person's own first screen instead.
- **How today is going**, by section:
  - Front desk: with the cashier (and the longest wait), in a department, visits today. Today's
    bookings as Arrived, Due, Late or No-show, with a Check in that opens that booking's card on the
    Desk. HMO requests waiting for Admin, for people in the building. Opening hours for the next 7
    days.
  - Cashier: today's takings laid out as a cash-up (Cash, GCash, Bank, Collected, Reversed,
    Discounts), with yesterday's whole-day total beside it, and the top services today.
  - A department, one component for all three: released today, median turnaround (with the target
    only if the clinic has set one), amended today.
  - Clinic (Admin and SuperAdmin): revenue today, the queue, online payments and reversals; each
    department's backlog, releases, median and target; arrivals by hour so far.

### The rules it keeps

- **Only what the person already holds.** Sections follow the person's own screens (`homeNavIds`,
  the departmental screens that are not borrowed), and the clinic's follows `reports:view`. Every
  read is an endpoint their own screens already call, on the same permission.
- **A fact appears once.** A count that is a need is never also a figure. A booking is on the
  bookings list, not also in "Needs you now". There is one "Needs you now" however many sections.
- **One Refresh.** A failed read says so where its figure or list would be, and "Needs you now"
  names what it could not check. There is no Try again beside each: they would all do what Refresh
  does.
- **Money comes from the summary.** Every peso is the transactions endpoint's SQL `summary`.
  "Yesterday" is the whole of yesterday, because "yesterday by now" would have to be added up from
  the receipt list, which a money figure must never be.

### How it is built

- `config/navigation.js`: `TODAY_ITEM` (`staffOnly`), `homeNavIds` and `landingNavForRoles`. The
  `dashboard` item is gone. `defaultNavForRoles` still means "my work".
- `App.jsx` lands on `landingNavForRoles`. `selectNav(id, intent)` carries what a Today button asked
  the next screen to do on arrival, acted on once: the Desk takes `verify`, `find` and `editTests`,
  a department's History takes `delivery`.
- `pages/Today.jsx`, `components/today/*`, `hooks/useTodayReads.js` (each read settles on its own)
  and `lib/today.js` (the rules, pure and unit-tested).
- The till's "paid today" rule moved into `lib/collections.js` as `paidVisitIds`, shared by the till,
  the sidebar's count and Today.
- `AdminDashboard.jsx` keeps only the management screens.

### Tests

- `today.spec.js` (new, 12 tests):
  - every role lands on Today, first in the rail, and an Admin has no Dashboard
  - Add tests opens the visit's tests on the Desk
  - a due booking checks in on the Desk's own card
  - Record the call opens on Today
  - Open History arrives filtered to Not sent
  - the cashier has one way to the till
  - an Admin sees the clinic, and Review opens Service Requests
  - the multirole account gets one "Needs you now" and both sections
- `failure-states.spec.js`: each role's Today over a 500 says what it could not check (4 tests).
- `mobile-patient.spec.js`: Today at 390 px for the front desk and the clinic (2 tests).
- `tests/unit/today.test.js` (18 tests).
- Specs that work on a screen other than Today now open it first, through `helpers/auth.js`
  `openScreen` and `signInTo`: laboratory, ultrasound-measurements, workflow-context, revalidation,
  walkin-registration, text-scale, front-desk, sidebar, result-delivery, and the critical-callback
  failure case.

The frontend unit tier grows to 80. The full suite: 407 passed, 0 skipped, in 10.3 minutes, across
61 spec files.

## [1.76.0] - 2026-09-14 (The staff sidebar earns its space)

No migration. Frontend only.

### What Steven asked for

He said the front desk's and the cashier's sidebar "looks lacking", and chose the "Useful" rail from
the gallery. Log out stays in the top bar, where it always was.

### What the rail shows now

- **Whether the clinic is open**: "Open now · Until 5:00 PM today", or "Closed now · Opens 8:00 AM
  tomorrow". It reads the schedule patients book against, including holiday closures and changed
  hours. A failed read shows nothing rather than "Closed". The rules are unit-tested in
  `clinicStatus.test.js`: 9 cases, including a Saturday half-day followed by a closed Sunday.
- **The screen's most-used action.**
  - Front desk: Register Walk-In. On a phone it stays in the page, because there the rail is behind
    the menu; it is on screen once at every width.
  - Cashier: Find a receipt, which opens a receipt by its number in a new tab.
  - Scan pass stays in the Who's here box; a copy in the rail would have been the same button twice.
- **A count beside each screen**: open visits on the Desk, patients waiting to pay, online payments
  to check, and tickets on each worklist.
  - Each is the number its screen shows, worked out the same way. The Billing Queue's count leaves
    out bookings already paid online, as the till does.
  - The counts are hidden from screen readers, so each button's name stays exactly its label.
  - A count that fails to load is left out, not shown as 0.
- **Patient Records moves under the person's own heading.** For everyone but Admin and SuperAdmin
  it was the only item under "Management", which made the front desk look as if it had been given a
  management screen.

### Not in this step

The "Today" item arrives with the Today screens, next. The gallery's Today summary in the rail is
left out on purpose: once Today is a screen, a summary in the rail would say the same things twice.

### Tests

`sidebar.spec.js` (new) checks:
- the status line
- Patient Records under Front Desk for a receptionist, and under Management for an Admin
- the Desk's count equals the Desk's own "in the queue", and the button keeps its name
- Register Walk-In appears once at desk width and once on a phone
- the cashier opens a receipt by its number

The frontend unit tier grows to 62. The full suite: 389 passed, 0 skipped, in 9.0 minutes, across 60
spec files. The run is longer than [1.75.0]'s 7.3 minutes because the sidebar now fetches its counts
on every screen the suite opens.

## [1.75.0] - 2026-09-14 (The front desk works from one Desk; the till is tidied)

No migration. Frontend only: no endpoint, permission or hook behaviour changed.

### What Steven asked for

From the clickable gallery he picked F1 for the front desk (one Desk screen) and C3 for the cashier
(the same screens, tidied). He asked that nothing already working break, the backend included.

### The Desk (F1)

One arrival used to need three screens: a returning patient was looked up on Walk-In Registration,
a booking was checked in on Appointment Check-In, and both were watched on the Active Queue. They
are one screen now, called **Desk**. The heading says "Desk" as the sidebar does, not "Front Desk":
that is the group, which a phone's top bar shows by itself, directly above the heading.

- **Who's here?** One box takes a name, a queue number or a booking reference, or a scanned pass.
  - A name shows today's bookings under it (Check in) and records on file (Start visit), and
    narrows the queue below to the same name.
  - A reference looks the booking up on Enter.
  - With nothing typed, the box lists today's bookings still to arrive.
- **A booking opens the old check-in card**: confirm, reschedule, or mark a no-show.
- **Someone already in today's queue is not offered a second visit.** Record rows wait until the
  queue has answered for the same name, so the button never appears before that check.
- **Registration opens in a side panel**, and the queue stays where it was. It is the same form (the
  `#wi-*` fields), and the panel is titled "Walk-In Registration".
- **The four counter cards became one line**: in the queue, not yet paid, in a department,
  walk-ins. The line hides while the queue is filtered, because the server counts the matches, not
  the day. The toolbar's "Showing N of M" appears only then; unfiltered it was the counts line and
  the pager saying the same number a second and third time.
- **A short name lists at most six records**, then "and N more", so two letters cannot push the
  queue off the screen.
- **The front desk has a list of today's bookings for the first time.** The API always served it
  (`GET /appointments`, behind `appointments:read`, which the desk holds); nothing on screen asked.

Nothing underneath changed: the same hooks, endpoints and confirmation dialogs. A Cashier, who reads
this queue but can neither check in nor start a visit, gets the queue with its own search and no
box, as before. `CheckInPanel.jsx` and `WalkInPanel.jsx` are gone. A stale `reception-walkin` or
`reception-checkin` falls back to the Desk.

Doubles found on screenshots and removed:
- the queue's empty state carried a second Register Walk-In button
- a booking's check-in showed two green boxes, both saying the patient was checked in
- today's bookings were listed in the box and counted again in the counts line
- the queue's total appeared three times

The one-line counts and totals also got their gap back: a `<p class="m-0">` had cancelled the
page's `space-y` margin, so both lines sat flush against the panel below.

### The till (C3)

- The heading says **Billing Queue**, as the sidebar does. "Cashier POS & Billing Terminal" was a
  third name for the same screen.
- The five collection cards became **one line**: Collected Today, receipts, cash, GCash and bank.
  Reversed and net-in-drawer appear only on a day with a reversal. Every rule from the cards is kept.
- The queue panel is headed "Waiting to pay".

### Email while developing

The run for [1.74.0] showed the suite mailing the seeded test accounts through the clinic's Gmail.
Steven chose to send from a different address while developing, so the clinic's own is untouched.
That is configuration only (`SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `backend/.env`); no code
changed.

### Tests

- `front-desk.spec.js` (new):
  - a record is found and started from the box
  - someone already in the queue is not offered a second visit
  - today's bookings open their check-in card; the spec serves the list, so it does not depend on
    the time of day
  - registration opens and closes beside the queue
  - the Cashier gets no box
- Updated for the new names and places: `walkin-registration`, `result-delivery`,
  `api-authorization`, `borrowed-screen-actions`, `failure-states`, `mobile-patient` and
  `revalidation`. `text-scale` now measures a laboratory tile, because the till has no cards left.
- `ui/sheet.jsx` is a new primitive: the side panel.

The full suite: 384 passed, 0 skipped, in 7.3 minutes, across 59 spec files.

## [1.74.0] - 2026-09-14 (Recording a critical call, and failures that no longer read as zero)

No migration. Frontend only.

### What Steven asked for

He asked to restructure the whole staff side, saying it "doesn't have dashboard" and "so many
lacking", and chose to fix what was broken first, then the staff screens, then the patient portal.
This is the first part. Nothing is redesigned here; the audit that came before the redesign found
these faults, and they are fixed on their own so the redesign starts from screens that tell the
truth.

### A critical-result call can be recorded

[1.15.0] built the callback log at the API (`POST /results/:id/acknowledge-critical`, audited, 409
on a second attempt), and [1.28.0] put a tile on every worklist counting the calls still owed, with
a dialog that said "record the call". Nothing on screen called the route. A call that was made
could not be written down, and the list only grew. Each row in the dialog now has a short note (who
was reached) and a Record the call button. The note is optional, as it is at the API. A 409 means
someone else recorded the call first, so it reads as done. The note is an `<input>`, not a
`<textarea>`, because `laboratory.spec.js` drives the result entry dialog with a bare
`page.locator('textarea')`.

### A failed load never reads as zero

[1.28.0] fixed six screens that showed a 500 as an empty list. The screens each role lands on
every morning were not among them:
- the till: "Collected Today ₱0.00" and "Nothing awaiting payment". Its two fetches shared one
  error, and the queue's success cleared a collections failure whichever order they answered in.
- the front desk: "Active Queue Visits 0" and "Showing 0 of 0".
- the worklists: "Awaiting Exam 0" and "Critical Callbacks 0, Nothing outstanding".
  `useCriticalCallbacks` turned any failure into an empty list, which is the most confident way to
  be wrong about a panic value.
- the History screens' report panels: a skeleton that never ended, or "Nothing sold in this range"
  beside "₱0.00 net".

A figure that could not load now reads "—", and the list beneath it says why, once, with one Try
again. The till's banner is gone for the same reason: it repeated the queue panel's message with a
second Retry. That is how the front desk's queue has always reported it. Takings and Sales by
service come from one request, so a failure is shown once, on Takings.

### Takings cover the list's dates

On Transaction History, Takings and Sales by service were a fixed 7 days under a header reading
"Settled payments in this range". On 13 Sep the list said 0 receipts while Takings said ₱17,200
from 25. The receipt list now loads them for its own dates, on opening and on Apply
(`useTransactionHistory`'s `onRangeLoad` calls `useOperationsReport`'s new `load`). The report also
ignores an answer that arrives after a newer request. The panels on Visit History and on the
departments' History screens keep their 7 days, and now say "last 7 days".

### No button that can only answer 403

An Admin reads every department's history but holds neither `results:write` nor `results:release`,
and History offered them Edit and Email. Both are now gated on the permission their own endpoint
demands, the [1.53.0] rule. On the worklist, Release is gated the same way; the worklist itself
already required `results:write` in the sidebar, so an Admin never reaches it.

### A booking no longer waits for its email

Found by the full run, not by the audit. Booking, cancelling and rescheduling each awaited their
email after the commit, so the patient's reply waited on Gmail. On an ordinary run that is 3–4
seconds a send. On 2026-09-14 one send took 44 seconds, and three specs (two in
`appointment-reschedule.spec.js`, one in `reschedule-ui.spec.js`) failed at their 90-second timeout
while each booking sat committed and correct. The three emails now go out after the reply
(`appointmentService`: `emailBookingConfirmation`, `sendCancellationNotice`, the new
`emailRescheduleNotice`), each with a `.catch`. Nothing else changes: the same email, to the same
address, still logged if it fails.

The run also showed that the suite sends real email through the clinic's Gmail to the seeded
`@enlogada.com` accounts, about 25 in one run. [1.50.0] stopped this for `@enlogada-e2e.test`; the
seeded accounts were left out. This entry does not change that; it is noted for a decision.

### The Acting-as note names the person

The chip's tooltip said "You hold Admin access, not Receptionist" to everyone, including the Cashier
it most often appears for. It now names the signed-in roles.

### Tests

- `failure-states.spec.js`: the three landing screens, and the callback dialog's error state. Each
  reloads after breaking the API, because a landing screen has already loaded once, successfully, by
  the time the route is intercepted.
- `critical-callback.spec.js` (new): a lab tech records the call from the worklist; the note reaches
  the record; a second attempt answers 409.
- `takings-range.spec.js` (new): the report is asked for the list's dates, on opening and on Apply.
- `borrowed-screen-actions.spec.js`: an Admin on Laboratory History gets View Report but not Edit or
  Email, the lab keeps both, and the API refuses the Admin; the Acting-as tooltip names the Cashier.
  Its queue checks now run against a visit of their own. An empty queue let the Cashier's "no Edit
  Tests" pass without testing anything, and failed the Receptionist's "keeps Edit Tests" whenever it
  ran before anyone had registered a patient that day.

The full suite: 379 passed, 0 skipped, in 7.0 minutes. Unit tiers 76 and 53.

## [1.73.0] - 2026-09-13 (Sign-up and password reset by emailed code)

Run: `node src/scripts/migrateAuthCodes.js` (additive, safe to re-run; `--rollback` reverses it).

### What Steven asked for

A 6-digit code emailed when someone signs up with an email and password, and forgot-password
"re-engineered a more secure way", with both on the sign-in card. His choices: the code is
required before the first sign-in (Google sign-ups skip it, and existing accounts are untouched),
and forgot-password becomes a code that works for 10 minutes with 5 tries, then a new password.

### A pending sign-up is not an account

`auth_codes` holds pending sign-ups and reset codes. A sign-up's details wait there, and the
`users` row is created only when the code is entered, so an unproven account never exists. Before
this, anyone could register someone else's address, and because Google sign-in links to any
account with the same email, the owner's first Google sign-in would have put them in an account
whose password a stranger knew. It also meant no `email_verified` column, no backfill, and no
change to staff creation, Google sign-in or the seed scripts.

### A code belongs to the browser that asked

Starting a sign-up or a reset gives the browser a ticket (32 random bytes, stored as SHA-256) and
emails a code (6 digits, stored as an HMAC keyed from the server secret, because a million codes
can be tried in a second against a plain hash). Finishing needs both, so a code sent for a
stranger's attempt cannot finish yours. Limits: 5 tries a code, 10 minutes, a new code after 60
seconds, 3 resends a ticket, 5 codes an address an hour, and a per-IP limiter that counts every
request to the three routes that send email. A guess is spent before the code is compared, and a
code is consumed by exactly one request.

### Forgot password says nothing about who has an account

Every address gets the same answer, in the same time, with a ticket that looks the same: the work
starts after the answer is decided and is not awaited. The link flow waited for a database write
and an SMTP round trip for real accounts only, which could be timed from outside. Its token was
also looked up and marked used in two statements, so two requests could both reset, and a reset
did not clear a lockout, was not audited and sent no notice. A reset now ends every session,
clears the lock, is audited as `auth.password_reset` and emails "your password was changed".
`password_reset_tokens` is dropped; an old link opens the forgot card with a notice and is taken out
of the address bar.

### One account per address

Emails were never normalised and matched case-sensitively, so `John@x` and `john@x` could be two
accounts, and a reset typed with different capitals silently found nobody. Every path that creates
or looks up an account normalises now (`validations/email.js`), and `uq_users_email_lower` makes it
a rule. The migration refuses to create that index when two accounts already differ only by case,
and lists them. On the development database it found none.

### The card

Forgot Password moved onto the back of the sign-in card, beside Create Account, and both gained a
code step: one real input drawn as six boxes (`CodeInput`, so paste, a phone's one-time-code
autofill and screen readers all work), a resend countdown, and "use a different email". A pending
sign-up survives a reload in sessionStorage, so fetching the code from another app does not lose
the form. The old ForgotPassword and ResetPassword pages are gone.

### Tests

The suite cannot read email (test addresses are never mailed) and codes are stored hashed, so
`e2eAuthCode.js` (test addresses only, never in production) puts a known code on the newest open
row, and `helpers/accounts.js` `registerClient()` signs up through the real endpoints with it. The
six specs that registered throwaway clients use it; `account-codes.spec.js` covers the rules above.
The three cleanup scripts delete `auth_codes` in place of the old table.

## [1.72.0] - 2026-09-12 (The public site, on the reference design)

No migration. The public pages are being rebuilt on the structure, layout and motion of the
reference site Steven chose (peak-review-center), in slices. This entry grows with each one.

### The colouring: today's palette, applied with more depth

Steven turned down the reference site's grey-and-gold palette, then five palettes independent of
the logo, and chose to keep today's (the logo's green and azure on slate) with "advanced
colouring". Nine options were built as a gallery with a Flat/Advanced switch and every one was
measured before he chose; A1, "Aurora", won. The layer is `.aurora` (a mesh-gradient hero),
`.text-gradient-aurora`, `.glass-pill`, `.edge-gradient`, `.wash-aurora`, and
`<Button variant="brand">` / `variant="glass"`. It adds no hue.

### The contrast gate measures it, and had not been measuring light mode

`checkContrast.js` now reads the `.aurora` and `.glass-pill` rules out of index.css and measures
each ink on the base and on every glow at its brightest, and the header's ink on the glass
composited over each. It caught the header opacity that looked best: at 0.74 the pill over the hero
composites to #c0c3c7 and its nav text is 4.24:1. It ships at 0.88. Both new checks were proven by
breaking them on purpose.

Writing them exposed an older fault in the gate. It read every `--color-*` in the file with the
last one winning, so the "light" theme was measured with the DARK block's values for every ink the
dark block remaps. Light mode was never actually checked for those inks. Each theme now reads only
the rules that define it. 46 checks became 116, and no real violation turned up.

### The header: a floating glass pill

The reference navbar over the Aurora: fixed over Home's full-height hero, sticky everywhere else,
tightening as the page scrolls. "Contact Us" opens the phone, email and address from
`useClinic()`; FAQ scrolls to Home's FAQ from any page (`handleNavigate(tab, { section })`); the
current page carries `aria-current`.

Measured at 390–1440px at the default text size and at Larger, because a patient's choice in the
portal carries over to these pages. The first cut overflowed the pill by 35px at 768 and by 109px
at 1024 under Larger text, and at 768 the wordmark ran under the Home link while the pill reported
no overflow at all — the brand was allowed to shrink. The desktop row now starts at 1024 and stays
compact until 1280, and the brand never shrinks, so a squeeze is measurable rather than silent.

`helpers/auth.js` found the phone menu with `header div.md:hidden`, a test tied to a breakpoint
class (CLAUDE.md: don't couple a test to a class name) and the one thing standing in the way of
that fix. It uses `data-testid="public-menu"` now.

### Home

A full-height Aurora hero whose lights drift between three positions every 10 s (a slide can move
a light, never brighten one, so every slide stays measured; pausable, and still under reduced
motion); the existing quick dock; why patients choose the clinic; the three departments; an About
teaser; how a visit works; the FAQ; a closing call to action. Sections reveal once on scroll with
the reference site's timings, in CSS. Reduced motion resets the stagger DELAY too — the blanket
rule does not — and print shows everything.

The FAQ's hours come from `GET /schedule/public`, so they follow Clinic Schedule rather than going
stale on the page. It does not promise a day-before reminder: that script only runs if the clinic
schedules it.

### The footer

Light, with a gradient hairline where the dark slab was. The clinic's contact details and Facebook
page come from `useClinic()`, so the footer, the header's Contact Us and the printed result form
cannot disagree about the address.

### Sign In and Create Account: one card that turns over

Four sign-in designs were built as a working gallery (a split page with a live Aurora panel, a
frosted card on the Aurora, a sliding panel, and a flip card), each clickable at desktop and phone
width, in both themes and with reduced motion, and each measured in every state before Steven
chose. He chose the flip card, with sign-up on one page.

The two forms are the two sides of one card. For the length of the 850ms turn both are mounted and
the one turning away is `inert`; when the turn ends it unmounts, so outside a turn the document
holds exactly one form, which is what `helpers/auth.js` relies on. App renders the page without a
`key`, so the header's Sign In and Create Account turn the card rather than rebuilding the page.
When the turn started on the card, focus moves to the side that arrives.

Found on the way: the account-created timer outlived the form, so leaving within two seconds of
registering pulled you back to Sign In. It is cleared on unmount now. And one trap the turn itself
set: the Google button's width was measured with getBoundingClientRect, which under a turning card
measures the projected shape, so a form mounted mid-turn would draw a half-width button that
nothing measures again. It reads `clientWidth`, the layout width, instead.

The new-password meter states one rule, the server's minimum of 8 characters, and treats length and
variety above it as advice. Its unit test reads `backend/src/validations/passwordPolicy.js`, so the
meter and the server cannot disagree without a test failing. The old two-column page's styles
(`.auth-panel`, its dark-mode rebinding, the sliding swap and the tab pill) went with it.

### Services, About, Privacy and Terms

The last four public pages in the old look, rebuilt from shared parts rather than copies of Home's
markup: `PageHero` (the Aurora band under the floating header, which these pages now float too),
`CtaBand` (the closing call to action, which Home uses as well), `LogoShowcase` (Home's About
panel, shared with About), `ClinicHours` (the live week, one component behind both the FAQ and
About) and `LegalDocument` (Privacy and Terms: readable sections with an "On this page" list on a
wide screen). The wording of the policy and the terms is unchanged.

Fixed on the way: About typed in the clinic's old short address, phone and email, so it disagreed
with the footer and the printed result form (it reads `useClinic()` now, and a spec compares it
with the footer); the legal pages typed in the email too; and the Services search box suggested
"ECG", which the clinic does not offer.

`public-site.spec.js` holds all five pages to one heading and no sideways scroll at phone width,
and checks a pausable hero that never moves under reduced motion, the FAQ by keyboard, Contact Us,
the legal pages' contents links, the footer's FAQ link from another page, and a price list that
never advertises ECG or 2D Echo. Also measured by hand at 390, 768 and 1440 px, in dark mode and at
the Larger text size: one h1 and no sideways scroll on every page.

### Still to come

Real photographs in the hero once the clinic supplies them.

## [1.71.0] - 2026-09-09 (A package may claim a component the visit already had)

No migration. One conflict clause, one dead file, and the open questions written down.

### The bundle could cost more than its own fixed price

`testRepository.addTestToVisit` wrote `ON CONFLICT DO NOTHING`. That is right for a retried booking
re-sending the same tests. It was wrong in one case, and the case cost money.

A package EXPANDS into one `visit_tests` row per component at an allocated share of its fixed price.
Attach a package to a visit that already carries one of those components as a LOOSE row, and
`DO NOTHING` skipped the package's cheaper share — the component kept its LIST price with
`package_id` NULL, permanently. Nothing ever repaired it: every other `UPDATE` on `visit_tests` sets
`status` and nothing else, and the bill is derived from `SUM(price_at_time)`.

    Package A   fixed 1,450   +200 if all components were pre-picked
    Package E   fixed 2,050   +590

Not reachable from booking, which submits once with packages attached first — that ordering is why
the single-call path was always correct. Reachable from **reception's assign-tests dialog**, where
reopening a visit to add work is the ordinary way to use it.

A package may now claim a loose row. Three conditions stop it doing something worse, and each is
load-bearing:

  * `visit_tests.package_id IS NULL` — never take a component from a DIFFERENT package. Two bundles
    sharing a test must not fight over one row.
  * `EXCLUDED.package_id IS NOT NULL` — only a PACKAGE claim may reprice. The same function inserts
    loose tests, and without this a re-added loose test would rewrite its own `price_at_time` to
    today's list price, restating a bill that column exists to freeze.
  * no `Paid` payment on the visit — never restate a bill the patient holds a receipt for.
    `testService.addTestsToVisit` already refuses on a paid visit, but `appointmentService`'s
    already-booked branch calls `packageService.attachPackages` DIRECTLY and bypasses that guard, so
    it could not be relied on from the repository.

All four behaviours were exercised against the live database in a rolled-back transaction before the
change was trusted, and the regression test was verified by restoring `DO NOTHING` and watching it
fail on "the package must claim the loose row".

### DiagnosticReport.jsx removed

Superseded by `ResultReport` in `[1.50.0]` and imported by zero files since. Deleting a component
that nothing renders is not a behaviour change; leaving it is a second answer to "what does a report
look like" for whoever finds it first.

### Open, and deliberately not decided here

Recorded so they live in the repository rather than in a chat log:

  * **14 laboratory services** exist as forms in the clinic's workbook with no catalogue row: PSA,
    Anti-HCV, Dengue NS1, Pregnancy Test, FOBT, SGOT, Albumin, Sodium, Potassium, Ionised Calcium,
    Phosphorus, OGTT 50, OGTT 100, standalone Hct/Hgb. Not added — that needs prices, and inventing
    them is what `[1.51.0]` removed from this repo.
  * **`Chest Ultrasound` and `Transrectal`** are the two active tests with no field set, so they
    print as prose. The clinic's document folder contains no template for either; writing one would
    be inventing clinical fields. Needs an exemplar.
  * **`migrateRemove2dEcho.js` stays unrun.** Measured 2026-09-09: **19** `visit_tests` still
    reference 2D Echo / ECG, so the script refuses — correctly. Upstream's "the count reached zero"
    is true of their database, not this one.
  * **`[1.50.0]` tags two unrelated changes** across the fork boundary — this fork's structured
    result entry, and upstream's 2D Echo removal. Renumbering rewrites references across released
    history, so it is offered to upstream as a question instead.
  * **The ultrasound templates are SABAL HOSPITAL's**, and the large ones are scanned images pasted
    into the document rather than text. The clinic confirmed everything prints as ENLOGADA, so the
    structure was copied and the letterhead was not; the images are out of scope.


## [1.64.0] - 2026-09-05 (The form decides its own footer, and HIV gets a form at all)

`node src/scripts/migrateResultSignatureMode.js` — additive, idempotent, `--rollback` reverses it.
Then `node src/scripts/seedResultFieldSets.js --confirm`.

Read out of the clinic's own workbook, `RESULT FORM FLORENCE MEA D. ENLOGADA.xlsx` — about 30 named
sheets, one per laboratory form.

### HIV Screening printed no table at all

It was the ONE active laboratory test with no field set. `ResultReport` renders the
TEST / RESULT / UNIT / REFERENCE RANGE table only when the test has a form; without one it falls
through to bare `COMMENT` and `REMARKS` prose. That fallback is *correct* for X-ray, which is
narrative and has no form in the workbook. It is wrong for a laboratory test, and it is what the
clinic photographed when they asked why the printed result looked so bare.

The workbook has no HIV sheet, so this form is **inferred and says so in the code**: its three
siblings — HBsAg Screening, VDRL/Syphilis, Anti-HCV Screening — are each one Serology row carrying
a text `"REACTIVE"` / `"NON-REACTIVE"`, no unit, no range. HIV takes that shape. Marked inferred so
nobody later mistakes it for a transcription and "corrects" a real form to match it.

### There are two footers, not one

The report hardcoded the seal note for every result. The workbook uses two, per form:

    NOTE: DO NOT ACKNOWLEDGE THE RESULT WITHOUT THE OFFICIAL SEAL      most forms
    ** THIS IS AN ELECTRONICALLY SIGNED REPORT. NO SIGNATURE IS REQUIRED.**   OGTT 50, OGTT 100,
                                                                             CT BT, Hct Hgb

Those sentences say **opposite** things about whether a signature is needed. Printing the wrong one
sends a patient to fetch a seal the clinic never intended to apply, or tells them none is coming
when one is. Of the forms this system actually stocks, only Clotting Time / Bleeding Time is
electronically signed.

The technologist's caption travels with it. The same person signs every report, but the workbook
captions her **Medical Technologist** on the chemistry and CBC forms and **Examiner** on Blood Type,
HBsAg, BUA, the OGTTs and CT BT. `clinic_signatories` holds one caption per CATEGORY and cannot
express that, so `technologist_caption` overrides it per form and NULL means "use the signatory's
own". Only the first signatory: the pathologist's caption never varies.

Defaults chosen so only the exceptions are written down — `seal` and the signatory's own caption are
the overwhelming majority, and the seal note is the more cautious of the two when a form is unknown.

### What was already right

Checked rather than assumed, after asserting otherwise earlier and being wrong: **CBC, Urinalysis
and Fecalysis already match the workbook field-for-field, in order** — including `RDW-CV` printing
outside the Differential Count block, and the sex-split ranges stored verbatim
(`Male: 13.7-16.7 / Female: 11.7-14.5`). The `FOR:` label above the signature block was already
there too. 22 of 23 laboratory tests already had their form. The gap was coverage, not correctness.

### Not done here, and why

The **ultrasound** templates in the same Drive folder are **SABAL HOSPITAL's**, not Enlogada's —
every one opens with that letterhead and is signed by a radiologist Enlogada does share. Which
letterhead belongs on Enlogada's own output is a question for the clinic, not a design decision, so
no ultrasound layout work was done. Note the system already credits that same sonologist in
`SIGNATORIES`, so only the institution name is open.

Fourteen laboratory services exist as forms in the workbook with no catalogue row — PSA, Anti-HCV,
Dengue NS1, Pregnancy Test, FOBT, SGOT, Albumin, Sodium, Potassium, Ionized Calcium, Phosphorus,
OGTT 50, OGTT 100, standalone Hct/Hgb. Reported to the clinic, not added: adding them means
inventing prices, which is what `[1.51.0]` was about removing.

The workbook also contains four **veterinary** sheets. They stay out — CLAUDE.md is unambiguous that
veterinary was removed deliberately.


## [1.63.0] - 2026-09-01 (A schema file that builds the database it describes)

No new migration script, and nothing to run on an existing database. Both fixes below are about
databases and screens that were built the *other* way.

### schema.sql did not declare five of its own tables

`migrateDb.js` builds the whole database from `database/schema.sql` — it is the documented way to
create one. Five tables were reachable only by running the migration scripts:

    result_field_sets   result_fields   result_field_set_tests
    result_measurements clinic_signatories

So a database created the documented way had no structured result entry at all: no field sets, no
measurements, no signatories. Every environment that worked, worked because it had been migrated
rather than built. Nothing in the suite covers it, because the suite runs against a database that
already exists.

The declarations are folded in after `test_results` — `result_measurements` references it, and the
field sets reference `tests` / `test_categories`, so that position satisfies every foreign key. They
are the composed final shape, not the first draft: `value_1..3` are `NUMERIC(10,4)` per `[1.53.0]`,
the derivation CHECK carries `BPS_SUM` per `[1.51.0]`, and `uq_signatory_global` is the partial index
that `[1.53.0]` added because NULLs are DISTINCT in a plain unique constraint.

Verified by building a throwaway database from the file and diffing it against the live one: 36
tables each way, no difference in either direction. Not by reading it — reading it is what missed
this for four releases.

### The reference-range column was decided by the values again

`[1.53.0]` established that the column belongs to the FORM, not to what happens to have been
recorded, and passed `fieldSet` into `ResultReport` to settle it. Only the entry dialog ever passed
it. `ResultViewerDialog` and the portal's `ResultsTab` pass none, so both fell back to
`measurements.some(m => m.reference_note)` — the exact heuristic that release replaced.

The visible failure is two copies of one document disagreeing: the clinic's just-released copy
prints four columns and the patient's copy of the same result prints three, under a component whose
docblock says they are the same document by requirement. Eight active field sets are partially
ranged, and Whole Abdomen is the worst at 1 of 11 — leave that one field blank and the patient's
copy silently loses the column.

Fixed in the repository rather than by threading the prop through two more components, so it cannot
drift again: both result queries already `LEFT JOIN result_field_sets`, so each gained a
`field_set_has_reference` flag. It is **NULL, not FALSE, when a test has no field set**, so the old
heuristic still decides that case instead of the column quietly answering "no".

No live occurrences today — checked — so this was latent, which is why 328/330 said nothing about it.
No E2E test can catch it either while the seeded data never produces a partially-ranged form; worth
seeding deliberately if the demo data is ever rebuilt.

### On the version number

This fork and upstream have both been numbering from the same range, and `[1.50.0]` already tags two
unrelated changes across the boundary. `[1.63.0]` is next after upstream's highest at time of
writing; happy to renumber if it collides.

## [1.62.0] - 2026-08-28 (Take the figures with you, read the receipt, name the wait)

**No schema change, and no migration script.** All four features are reads over tables that
already existed — nothing to run on a live database, which is the reason they could all ship at
once. New modules: `utils/csvExport.js`, `utils/reportCsv.js`, `services/receiptOcrService.js`,
`services/queueEstimateService.js`, and three chart components. One new dependency,
`tesseract.js`.

### The reports could be read and not taken

`/reports/summary`, `/reports/operations` and `/reports/hmo-claims` returned JSON to a screen, and
the only way to get a figure off that screen was to retype it or print the page. A printed page
cannot be reconciled against a drawer. `?format=csv` on any report endpoint — including
`/reports/staff-workload` and the new `/reports/analytics` — now returns the same figures as a
file.

Three properties this deliberately has. The **JSON path is untouched**: `wantsCsv` is false for a
missing parameter, an empty one, and anything that is not `csv`, so every existing caller gets
byte-identical responses. The **service runs first**, unchanged, and the format decision happens
after it returns — so a CSV export cannot see figures a JSON request could not, and the operations
report's per-slice permission checks apply exactly as before. And **validation precedes any
header**: a bad date range throws its 400 before `Content-Disposition` is written, because a
response that has begun as a file download cannot then become an error page.

Two decisions inside the serialiser look wrong at a glance and are not.

**Money is written as a bare `1450.00`, not `₱1,450.00`.** Matching what the screen shows would put
a currency symbol and a thousands separator in the cell, and Excel reads that as TEXT — the column
cannot be summed, sorted or charted, which is the entire reason somebody exports a CSV rather than
printing the page. The unit moves into the header instead: `Collected (PHP)`. This is the one place
in the codebase that deliberately does not use `formatCurrency`.

**The file opens with a UTF-8 BOM.** Excel on Windows assumes the system codepage for a `.csv`
unless one is present, so without it every `ñ` in a patient's name and every `₱` in a header
renders as mojibake — on the machines this clinic actually uses. `charset=utf-8` in the
Content-Type does not reach Excel; the file is opened from disk long after the header is gone.

`Content-Disposition` joined `ETag` in the CORS `exposedHeaders`. Without that the browser cannot
read the server's filename and every export saves as the endpoint name.

A NULL money column exports as an EMPTY cell, never `0.00`. `Number(null)` is 0 and
`Number.isFinite(0)` is true, so the obvious implementation states that the clinic collected
nothing rather than that nothing is recorded — the same false-confidence failure as the dashboard
that read "Today's Revenue ₱0.00" over a day that took ₱8,344.

### Reading the receipt so the patient does not have to type it

`POST /payments/scan-receipt` runs Tesseract over a GCash or bank screenshot and offers back the
reference number and amount, plus whether that reference has been seen before.

**It never decides money, and the shape of the file enforces that** — there is no write anywhere in
it. [1.48.0] settled that the amount a patient CLAIMS is evidence and never the amount charged; an
OCR pass is a third, weaker source — a guess about a claim about a payment. Letting it write would
quietly promote the least reliable number in the system to the most authoritative. What it actually
saves is transcribing thirteen digits off a phone screenshot, which is where the errors were: a
transposed digit is a payment nobody can later find.

**The duplicate check is the half with real value.** A reference number is the clinic's only handle
on a transfer that happened inside somebody else's system. The same screenshot submitted twice —
forwarded to a second visit, or re-sent because the patient was unsure it went through — is
indistinguishable from two genuine payments unless something looks, and nothing was looking,
because looking meant reading a number off an image and searching for it. BOTH tables are searched:
`payment_submissions` catches a claim already queued or decided, and `payments` catches one a
cashier settled at the counter. Checking only the first would miss the case that costs money.

The warning does not BLOCK. A repeated reference is usually a mistake but not always — a patient
correcting a rejected submission is re-sending the same one on purpose, and blocking would strand
them with no way forward. The cashier decides, as they already do for the amount.

Two bugs found by testing against a rendered receipt rather than by reading the regex. The
reference capture used `\s`, which matches a newline, so it ran off the end of the reference line
and swallowed the next: `Ref. No. E2E-1787890589109` followed by a date came back as
`E2E-1787890589109Aug28` — a plausible-looking reference matching no record, so the duplicate check
returned clean on exactly the receipt it was meant to catch. And a digits-only capture truncated
`GC-1787890589109` to its numeric tail, breaking the same check on every bank receipt. Horizontal
whitespace only now, and a token-aware clean that joins an OCR-split digit run but stops at the
next field otherwise.

The scan writes NOTHING to disk — `memoryStorage`, alone among the upload paths. Disk storage would
orphan a file for every scan including every abandoned one, which is most of them, mixed in with
real proofs and indistinguishable from them. An upload with no reader does not need a retention
policy; it needs to not exist.

### "You are number 12" is not an answer

The clinic has issued queue tickets since [1.0.0] and has never been able to answer the one
question every person holding one asks. `GET /visits/active` and `GET /appointments/my-bookings`
now both carry `patients_ahead` and `estimated_wait_minutes`, through one shared
`queueEstimateService` so the receptionist's screen and the patient's cannot disagree.

**The multiplier is a service RATE, not a wait**, and this is the whole correctness of it.
`getReceptionThroughput` already reports a median wait — check-in to billed — and on this clinic's
data that is 36 to 96 minutes. Multiplying it by the number of people ahead, which is the obvious
reading of "patients ahead × service duration", tells the fourth person in a queue they have a
four-hour wait. It is wrong because a wait already CONTAINS the queue: everyone waiting shares the
same forty minutes, they do not each add forty to the next person. What multiplies correctly is the
interval between consecutive patients being SERVED — `LAG` over each day's settlements, partitioned
by day so an overnight gap is never a sample, bounded to 0.5–60 minutes because an idle desk is not
a slow desk.

**It refuses to guess when it does not know.** Below ten observed gaps the measured median is
noise, and it falls back to a stated default with `estimate_basis: 'default'` in the payload. On
the current database that is exactly what happens — two usable gaps — and publishing a median of
two numbers to a waiting patient as "about 4 minutes" would be inventing precision the data cannot
support.

`patients_ahead` counts only PENDING predecessors. A 'Processing' visit has been billed and
released to a department; that person is no longer between this patient and the desk, and counting
them would inflate every estimate by the whole morning's completed work. A visit past the desk gets
no estimate at all rather than a zero — zero reads as "no wait", which is a claim rather than an
absence. Rounded to five minutes, floored at five, capped at ninety: "about 20 minutes" is an
estimate a clinic can keep and "18 minutes" is a promise it cannot.

### Two more questions the reports could not answer

`GET /reports/analytics` — turnaround against a target, arrivals by hour, and the revenue trend's
comparative overlay. Ungated at the route like `/operations`, with each slice gated inside the
service on `results:read` / `visits:read` / `billing:read`, and a caller holding none of the three
refused outright rather than handed an empty object.

**Turnaround is reported on two spans and neither is called just "turnaround".**
`getDiagnosticThroughput` already publishes a median measured from PAYMENT to release, on the
documented grounds that a visit registered at 8am and paid at 11am did not spend three hours in the
lab. Registration-to-release is what the PATIENT experienced and is the more useful figure for
asking where capacity goes. Both belong. What must not happen is a second query publishing a
different number under the SAME name on a screen beside the first — that is the [1.32.0] divergence
arriving by another door. So: `median_turnaround_minutes` is the department-owned span, identical
in basis to the existing report and verified equal to it; `median_total_minutes` is the whole
visit. A p90 is reported beside the median because a median hides its own tail by construction, and
a department can hold a 36-minute median while one report in ten takes two hours — it is the
two-hour patient who telephones.

Targets are a clinic SETTING, not a measurement: `TURNAROUND_TARGETS` in the environment, with
stated defaults. A department with no target is measured but not judged against a promise nobody
made, and its rate is NULL rather than 0 — "not measured" and "never hit the target" are different
facts.

Arrivals come from `generate_series` over the clinic's own operating hours, LEFT JOINed to the
data, so an hour with nobody in it draws a zero rather than vanishing. That distinction is the
point of the chart: a gap at 11am and a quiet 11am look identical once the row is simply absent,
and only one is worth acting on. Split walk-in against booked because a peak made of walk-ins is a
desk to staff and the same peak made of bookings is a schedule to change — opposite responses to an
identical bar.

The revenue overlay aligns the two periods by POSITION, not by date — day one against day one — so
the previous period's real date is carried through and named in the tooltip, or the reader could
not tell which day they were looking at.

### The chart palette was validated rather than chosen

`#53843b` and `#0a71a9`, the clinic's own two logo colours, run through a colour-blindness
validator against both theme surfaces: ΔE 18.7 protan, 19.2 normal vision, all checks pass in light
and dark. The instinct to lighten both for dark mode was tested and FAILS — the 400-level steps
fall below the chroma floor and land at ΔE 13.6 for normal vision, two series a fully sighted
reader cannot reliably separate. The same two steps are used in both themes, measured rather than
guessed. Tritan separation is 5.2, the weak axis for green/blue, which is why every chart using the
pair also carries a legend and names both series in its tooltip.

Median and p90 share a hue at two lightnesses — they are one distribution, and a categorical pair
would imply they are independent quantities. The target line is recessive slate, not amber: those
are reserved for states somebody must act on, and a benchmark is not a problem.

### Testing

`report-export.spec.js` (9) and `receipt-scan-queue.spec.js` (8) — 295 passing, up from 278.

One pre-existing flake fixed on the way. `booking-picker.spec.js` took the FIRST slot rather than
the first BOOKABLE one, on a quasi-random date nothing claimed; when that slot had been taken it
retried a disabled button for the full timeout. It failed once in a full-suite run and passed three
times in isolation afterwards, because `Date.now() % 30` had moved the date on — the exact
signature CLAUDE.md warns about under "a booking spec must claim its own slot", and a trap for
anyone who reads it as a regression in whatever they changed most recently.


## [1.61.0] - 2026-08-28 (Send the report, not a notice that one exists)

No schema change. One new module, `services/resultEmailTemplate.js`.

### The email announced a result instead of delivering one

Verified live to a real inbox: the message arrives, lands in the Inbox rather than Spam, correctly
branded. And it said only this — *"Your results are now available. You can view your results by
logging in to your account or by visiting the clinic."* A patient who reads it still has to make a
trip or a login to learn anything.

The clinic's own data said the report was sitting right there: **41 current results, 41 with
findings text, 40 with an uploaded PDF.**

The report travels now. **Both** in the body and as an attachment, not one or the other — an
attachment a patient cannot open on their phone is no report at all, and a body with no document
is not something a referring physician will accept. Those figures settle it: either alone would
have failed some patient.

The body carries a letterhead, then patient / age / sex / examination / department / date of
examination / date released / referring physician, then the findings and remarks. Age and sex are
there because they band the reference range a clinician reads the findings against, and the date
of the EXAMINATION because that is the clinically meaningful one — routinely not the day the
report was released.

### A critical value still does not travel

The one deliberate exception, and it is clinical rather than technical. A panic value read alone,
at night, with no clinician attached, is how a patient ends up frightened and unadvised — or worse,
reassured by a number they have misread. That email carries **no findings and no attachment**: it
says to contact the clinic, says plainly that the findings were left out on purpose and why, and
the report stays in the portal and at the counter where somebody can explain it. The clinic
telephones for these anyway, and `acknowledgeCritical` is the record that a human made contact.

This is a policy decision the clinic may reverse; it is one branch in `deliverResultEmail`.

### Three guards on the attachment, each of which has to hold

| | |
|---|---|
| **containment** | the path is rebuilt from `UPLOAD_ROOT` and re-checked with `resolve()`, the same rule the download route follows. `file_path` is server-generated random hex, never client input — but a stored value is still an input, and the cost of being wrong is emailing an arbitrary file off disk. Verified: a traversal path is refused. |
| **existence** | a row outlives its file after a restored database or a cleared uploads directory. Degrades to body-only rather than throwing and losing the send. |
| **size** | Gmail refuses over 25MB and fails the message as a whole. A report that will not send is worse than one with no attachment, because the patient then gets nothing. Capped at 20MB. |

Every failure returns null instead of throwing, for the same reason: the findings are in the body,
so the patient still receives their report.

The attachment is renamed for the PATIENT — `Blood Urea Nitrogen (BUN) - Juan Dela Cruz.pdf` rather
than whatever the technician's machine called it. `laboratory-report-de jesus.pdf` tells the
recipient nothing about which of their tests it is.

### Two smaller things this needed

**Everything interpolated is escaped.** Findings are free text written by a technician, and
`< 0.5 mmol/L` is an ordinary thing to write. Unescaped it becomes markup the mail client tries to
interpret, and the value silently disappears from the report.

**The letterhead comes from the same values as the receipt.** `CLINIC_NAME` / `ADDRESS` / `PHONE` /
`EMAIL` were set in `.env` and never exposed by `environment.js`, so the backend could not read
them. They now default to exactly what `frontend/src/lib/clinic.js` falls back to. Three sources
drifting apart is a document nobody can rely on — the reasoning `clinic.js` already sets out for
the printed receipt. TIN and business permit are deliberately absent: a diagnostic report is not a
BIR document.

Suite unchanged at 274, all passing.


## [1.60.0] - 2026-08-27 (An address to send it to)

`patients.email`, plus one partial index. `migratePatientEmail.js` (`--rollback` reverses it).
Folded into `schema.sql`; verified zero-drift at 271 columns, 127 indexes, 31 tables.

### The delivery feature had nowhere to deliver

[1.59.0] shipped the "Email Result" button and the record of what was sent. Measured immediately
afterwards, across all three modalities:

| | released results | with an address |
|---|---|---|
| Laboratory | 15 | **0** |
| X-Ray | 12 | **0** |
| Ultrasound | 13 | **0** |

Forty released reports and nowhere to send a single one of them.

The cause: the only address in the system was `users.email`, reached through `patients.user_id` —
and `user_id` is NULLABLE *precisely because* reception registers walk-ins at the counter without a
web account. That is how most of this clinic's patients arrive, so "no email on file" was never an
edge case; it was the norm, and the feature was unusable for exactly the people it was built for.
The migration measured it on the live database: **54 of 56 active patients had no address of any
kind.**

Forcing a walk-in to create a login before the clinic can email them a result is a worse clinic,
not a better database. Somebody at the counter can say their address in four seconds; they cannot
choose a password, confirm it and verify an inbox while a queue forms behind them.

### Which address wins

`COALESCE(NULLIF(p.email, ''), u.email)` — the patient record first, the owning account second.

The order matters because one account owns several patient profiles: a parent booking for
dependents, which is why `GET /patients/my-profiles` is plural. The account's address is the right
default for a dependent, since the parent is the one who booked. But an address typed onto a
specific patient's record is a deliberate statement about **that** patient and should win over an
inherited one. Falling back rather than replacing means no existing client-owned patient loses the
address they already had, and nothing was backfilled — copying `users.email` onto the row would
freeze a value that should follow the account when it changes, and create two places to correct
one typo.

Both reads resolve it identically. Two different answers in the list query and the send query is a
button that promises one address and uses another.

Not unique and not required. A household shares an inbox more often than not — a mother and two
children on one address is ordinary — and a UNIQUE would refuse the second child at the counter
for no clinical reason. Nor is it mandatory: a patient entitled to their result is never turned
away for not having email.

Asked for at **walk-in registration**, because that is the only moment the patient is standing in
front of somebody who can ask, and editable afterwards in **Patient Records**. An omitted field is
not an instruction to erase — `updatePatient` writes every column unconditionally, so without the
guard in the service a caller sending only the fields it cares about would blank the address a
patient's results go to. Same defect [1.54.0] found in the Services Catalogue, with a sharper
consequence.

### A calendar bug in the suite, found by the run that verified this

`appointment-reschedule.spec.js` failed four tests. Nothing in the application had changed; the
date had.

The spec computed two distinct days as `workingDay(150)` and `workingDay(151)` — "today + N, then
push off a weekend". On 2026-08-27, today+150 was Sunday 2027-01-24, which pushed to Monday
2027-01-25 — and today+151 *was* that Monday. `DAY_A === DAY_B`, so "move this booking to another
day" became "move it to the slot it already holds", and the tests failed on a perfectly correct
409.

This is the **second** time that helper shape has broken this spec. The first was the Saturday
case: the clinic opens 18 slots on a weekday and 8 on a Saturday, so a helper that skipped Sunday
alone silently halved the capacity a spec was claiming its way through.

`tests/e2e/helpers/dates.js` replaces all four copies with `nthWorkingDay(n)`, which counts
working days instead of offsetting into them. `nthWorkingDay(n)` and `nthWorkingDay(n + 1)` are
different days on every calendar — the property those specs were assuming and never had. Verified
over 250 consecutive values: zero adjacent collisions.

A test that passes or fails on the day of the week is worse than one that always fails, because
the morning goes on looking for a regression that is not there.

`result-delivery.spec.js` grows to 14 tests. Suite is 274.


## [1.59.0] - 2026-08-26 (Send the patient their result, and be able to say that you did)

`test_results.emailed_at` / `emailed_to` / `email_count`, plus one partial index.
`migrateResultDelivery.js` (`--rollback` reverses it). Folded into `schema.sql`; verified
zero-drift at 270 columns, 126 indexes, 31 tables.

### The feature that existed and could not be used

Releasing a result has emailed the patient since [1.0.0]. `releaseResult` builds the message,
calls `sendEmail`, and hands the technician an `emailStatus` toast. Then the toast fades and the
fact is gone, because **nothing was ever written down**. Three ordinary questions had no answer
anywhere in the system:

| | |
|---|---|
| "was this patient ever emailed?" | the release wrote `Completed` and `released_by`, and nothing about delivery |
| "she says it never arrived" | release is the only path that emails, it fires once, and it cannot be repeated |
| "which address did it go to?" | a patient who has since corrected their email had no way to be told |

Re-releasing was the only workaround available, and it is the wrong one: it writes a fresh
clinical authorisation for an event that did not happen a second time.

`POST /results/:visitTestId/email` closes it, gated on **`results:release`** rather than a
permission of its own -- whoever may authorise a report reaching a patient may put it in front of
them again, and a fresh `results:email` would be held by nobody until somebody remembered to grant
it, leaving the clinic with no answer to "I never got it". The service refuses anything not
already released, so this cannot become a side door around authorisation. Every manual send is
audited; the automatic one at release is not, because it is part of an act already recorded.

**`emailed_at` records the last SUCCESSFUL send and nothing else**, so `IS NULL` means "this report
has never reached the patient" with no second reading. Not backfilled, for the same reason [1.32.0]
replaced a fabricated refund date with the real one: every existing released result *was* emailed
by the code that has always done it, but we have no record of which succeeded, and writing a
plausible timestamp would be inventing delivery evidence for a medical report.

One row per VERSION turns out to be exactly right. An amendment creates a new `test_results` row,
so a v2 correctly starts with `emailed_at` NULL -- the patient has been sent v1 and has **not** been
sent v2, and the schema says so without anyone having to reason about it.

### Found while testing this: the clinic's mail quota was exhausted

The first live send failed. `verify()` proved the credentials and the connection were fine, so the
error was captured directly:

```
550-5.4.5 Daily user sending limit exceeded
```

The cause is ours. The E2E suite registers every throwaway account under `@enlogada-e2e.test` -- a
domain with **no MX record** -- and every booking confirmation and released result addressed to one
was a real SMTP send from the clinic's real Gmail account to nowhere. Two consequences, and the
second is worse than the first:

- **The quota is finite.** A free Gmail account allows a few hundred recipients a day. A couple of
  full suite runs and a demo seed exhaust it -- and a real patient's result fails to send with it.
- **Bounces cost sender reputation.** Repeated delivery failures to a nonexistent domain are
  exactly what spam filtering scores against a sender. That bill is not paid by the test suite; it
  is paid months later by a patient whose results quietly land in their junk folder.

`sendEmail` now suppresses any recipient on that domain and logs it. Scoped by RECIPIENT, not by
`NODE_ENV`: the suite runs against the development server in development mode, so an environment
check would not have caught it, and production behaviour is unchanged.

### Patient Records is a clinical roster, not a debtors list

The roster carried an amber "N unpaid" chip per patient. Whether a bill is settled is the Billing
Queue's question, and a clinical records screen that answers it reads as a list of debtors -- which
is exactly how it was reported. Removed from Patient Records; **kept in Reception's walk-in
lookup**, where it belongs and where it was originally added: at CHECK-IN, about to register
another visit, an outstanding balance is the point.

A **record status filter** replaces it -- All / Complete / Still open, filtered at the server, with
"complete" meaning all three at once: they have been in, every test has been seen through, and
nothing is unsettled. A filter and **not** the default, because this roster is also how the desk
finds a patient to correct a misspelt surname, how a record is archived, and how a technician
checks whose result they are holding. Defaulting to complete-only would make the screen unable to
find exactly the people the clinic is currently treating. The `open` clause is written as the
literal negation of the `complete` clause so the two cannot drift into overlapping or leaving a
gap; measured, 41 + 16 = 57.

The roster itself is now a proper `Table` -- sticky header, `stack` on mobile, one column each for
the patient, their details, the diagnostic work, the last visit and the last report -- matching the
diagnostic Test History, which was the better-looking screen and is the right shape for this one.

### Finding the ones nobody was told about

`idx_test_results_undelivered` had no reader when it was created. `GET /results/released/:category`
now takes `delivery=unsent|sent`, and the Test History carries the chips for it.

That filter is the reason the column was worth adding. Scanning a released list by eye for reports
that never went is not a thing anyone does, so without it the record would be a fact stored and
never used. It matters most straight after a mail outage, when the failures are a contiguous block
with no other way to identify them — which is exactly the state the clinic was in when the send
quota ran out. `unsent` deliberately does not mean "has no address": a report to a patient with a
perfectly good email that failed at release belongs in that pile, because that is the pile someone
has to work through.

The empty state speaks for the filter too. "No released results yet" over a department with plenty
of them, filtered to a set that happens to be empty, is a screen making a false claim about the
department — so `unsent` reads "Every released report has reached its patient", and `sent` says
plainly that anything released before this was recorded shows as unsent, meaning *unknown* rather
than *never told*.

`result-delivery.spec.js` covers all of it: 9 tests. Suite is 269.


## [1.58.0] - 2026-08-26 (Ask for a slice, and ask for it again)

No schema change. One new backend constant file, one new UI primitive, one new hook.

### Filtering on a column the table was already printing

Visit History has shown **Visit Type** and **Status** in their own columns since [1.0.0] and never
offered a way to ask for either. "Show me yesterday's walk-ins" — the ordinary question at a front
desk — meant reading 53 rows and counting by eye. Transaction History had the identical gap on
**Payment Method**, on the screen used to reconcile a cash drawer against a ticking clock.

Both now filter **at the server**. That is the property, not the chips: both lists are paged at the
database, so narrowing the 25 rows already fetched would filter one page and then print the count
of the whole range beside it — a screen reading *"53 visits"* over a list of four. The COUNT runs
on the same WHERE as the list.

`method` was already accepted by `GET /payments/transactions`; nothing on screen had ever sent it.
`visitType` and `status` are new all the way down, allow-listed in `visitService` against
`constants/visits.js`, which mirrors `chk_visits_type` and `chk_visits_status`.

**An unrecognised filter is dropped, not applied.** Passing a typo through to SQL matches nothing
and renders an empty screen — and an empty screen is indistinguishable from a clinic that saw
nobody. Payment method is the deliberate exception and returns 400: those are the cash-up buckets,
and a caller naming one that does not exist has made a mistake worth reporting.

**The money case has a rule of its own.** `summary` narrows with `method` and deliberately does not
narrow with `search`. A method is a real partition of the drawer — "Cash collected ₱17,690" against
the cash filter *is* the figure being counted — while a name typed to find one receipt is a lookup
and must not move the day's totals. Measured: 17,690 + 7,840 + 8,270 = 33,800, and 24 + 11 + 12 =
47, both reconciling exactly to the unfiltered day.

### A screen that fetched once and then sat

Four screens polled. The rest fetched on mount and showed that reading indefinitely — and nobody
closes a browser between patients, so an admin was routinely reading a queue as it stood hours
earlier, with nothing on screen to say so.

`RefreshButton` + `useFreshness` now cover eleven screens. **The timestamp is the half that
matters**: a screen that can be refreshed still cannot be trusted unless it says how old what you
are reading is. `useFreshness` observes an existing hook's loading flag rather than owning a fetch,
so no data hook changed — the alternative was adding `lastUpdated` to a dozen of them, where the
one that later forgets to stamp it reports stale data as fresh. It stamps only on a *successful*
read, because a confidently wrong "Updated 15:32" over a five-hour-old queue is the exact thing it
exists to prevent.

Two fixes fell out of the sweep:

- **`ServicesCatalog`'s Refresh reloaded one of the three lists it shows.** A package or an HMO
  provider added elsewhere stayed missing from a screen the reader had just deliberately
  refreshed — worse than no button, because it answers the question wrongly.
- **`PatientRecordsOversight`** — a refresh wired to the bare `load()` would have reset to page 1.
  A refresh that loses your place is a navigation.

### Two patient-facing screens were reporting a failure as an absence

`useMyResultHistory` and `useMyPayments` both caught their error, called `console.error`, and
returned an empty array — so a failed request rendered **"No diagnostic requests found"** to a
patient who had just been emailed to say their result was ready, and **"No payments yet"** to a
patient holding a receipt. This is the omission `failure-states.spec.js` was written about, in the
two places it had been missed, and on the screens where it does the most damage. Both hooks now
carry `loading` and `error`, and both tabs render `tone="error"` — which looks deliberately unlike
empty — with a retry.

`filters-and-refresh.spec.js` covers all of it: 9 tests. Suite is 260.


## [1.57.0] - 2026-08-26 (The clinic can finally say when it is open)

`clinic_schedule_overrides` — the per-DATE layer. `migrateScheduleOverrides.js` (`--rollback`
reverses it). Folded into `schema.sql`; 31 tables now.

### The table that could be read and never written

`clinic_operating_hours` has existed since [1.0.0] and `appointmentService.getAvailableSlots` has
always read it — open/closed, the hours, the slot interval, how many bookings a slot holds. There
was no route and no screen. The clinic's own opening hours could be changed **only by someone with
a database client**, which in practice meant they were never changed at all.

So the honest answer to "can an administrator cap bookings for a date, or edit the availability
times?" was **no**, on both counts, and had been for the life of the project.

### Two layers, and the split is the design

| | |
|---|---|
| the WEEKLY PATTERN | one row per weekday. What the clinic does most weeks. |
| per-DATE OVERRIDES | what it does on one specific day instead. |

Every override field except the date is NULLABLE, and NULL means *keep the weekday's answer*. A
closure is therefore one row saying `is_open = false` and nothing else; halving capacity for one
Saturday does not restate its opening hours.

The mistake the split exists to prevent is closing next Thursday by editing the Thursday row — and
closing every Thursday from now on. `clinic-schedule.spec.js` asserts exactly that: after an
override closes one date, the same weekday seven days later is still open.

### Three things that had to be got right

**A capacity of 0 is a real value.** "Open, but taking no online bookings today" is a thing a
clinic means. Every read of these columns is `??`, never `||` — with `||` that deliberate zero
falls through to the weekday's number and every slot comes back free, which is the opposite of
what was asked for.

**The date is the date.** A DATE column arrives from node-postgres as a JS Date at *local*
midnight, and `toISOString()` then reports the UTC date — the day before, in PHT. Measured while
building this: closing `2026-11-24` replied *"2026-11-23 is now closed"*. The functional behaviour
was already right; only the confirmation lied, which is the worse failure of the two, because the
administrator reads it and believes the wrong day is shut. `override_date` is now formatted in SQL
(`TO_CHAR`) and travels as a string, and the default "from" for the list is `CURRENT_DATE` decided
by Postgres. This is the third recurrence of the rule in CLAUDE.md.

**A closure warns; it does not refuse.** The clinic genuinely does need to close a day it has
already taken bookings for — a radiographer falls ill. Refusing would leave them unable to say so
in the system at all. What it must never do is close the day *silently*, so `setOverride` returns
`affectedBookings` and both the API message and the toast name the count.

### What the patient sees, and when

`GET /api/schedule/public` is unauthenticated, like `GET /tests` and `GET /packages` — a clinic's
opening hours are on its front door. It carries the week and the upcoming exceptions, and
deliberately **not** capacity: how many patients an hour the clinic can take is operational, and
what the patient needs is whether a slot is free, which the grid already answers slot by slot.

`Calendar` gained a generic `unavailable` map (`{ 'YYYY-MM-DD': 'reason' }`) so closed dates are
greyed and struck through **before** the patient picks one, each carrying its reason as `title` and
`aria-label`. Overrides are applied after the weekday rule and win, so a clinic opening specially
on a Sunday is not greyed out by its own pattern. `SlotPicker` then names the reason on the closed
day, on a fully-booked day (previously eighteen struck-through buttons and no explanation), and
above a shortened grid.

### Authorization

Reading is **any signed-in staff member** — reception is asked "are we open on the 30th?" all day,
and making them guess because the answer lives behind an admin screen is how a patient gets told
the wrong thing. Writing is **Admin and SuperAdmin, by role**, with no permission beside it:
minting `schedule:manage` would mean a permission held by nobody until somebody remembered to grant
it, while the opening hours sat unchangeable. Deciding when the clinic opens is the same tier as
pricing and staffing, both already Admin's. Every write is audited.

## [1.53.0] - 2026-08-26 (What the review found)

No new feature. An architecture review of `[1.50.0]`..`[1.52.0]` — commissioned before the work and
lost to a session limit partway through, then run retrospectively — found three defects that a
228-passing suite did not, plus several smaller ones. This is the fix.

### The suite was green because it tested the wrong layer

Worth recording before the defects themselves. The specs asserted API payloads and the presence of
a grid; they never drove the two buttons a technician presses. The first version of the regression
test written for the worst defect below **passed with the bug still in place**, because it posted
to the API while the bug lives in the hook behind the button. It drives the browser now, and was
verified by reverting the fix and watching it fail.

### F1 — a released result that saved nothing

`useResultEntry.js`. `[1.52.0]` relaxed `validate()` so a laboratory form with a filled grid and an
empty COMMENT box is a legal save. Its silent partner was `release()`, still guarding on
`if (findings)`. A technician who filled a Urinalysis, left the comment blank and pressed
**Authorize & Release Result** got a success toast, the patient got a "results are ready" email, and
**nothing was written** — the typed values were discarded when the dialog closed.

On an amendment it was worse: the release POST succeeded against the OLD stored version, the
certificate printed the edited values, and the database kept the previous ones. The printed document
and the record disagreed, and no amendment reason was recorded.

One predicate now serves both. Two predicates that must agree is a bug waiting for someone to edit
one of them, which is exactly what happened.

### F2 and F3 — one document, three data shapes

`[1.50.0]` extracted `ResultReport` so the clinic's copy and the patient's copy could not drift.
`[1.52.0]` then fed it from three different queries, and two of them lacked the columns the new
layout reads:

- **The patient's copy** came from `findResultsByPatientId`, which selected no `birthdate`, `sex`,
  `patient_type_name` or `discipline` — so Birthday, Sex and Patient Type printed blank and the
  letterhead carried **no title at all**.
- **The just-released certificate** — the copy handed across the counter — was rebuilt from form
  state, which carries no signatories, no discipline and no section headings. It printed
  "DO NOT ACKNOWLEDGE THE RESULT WITHOUT THE OFFICIAL SEAL" above **no signatures**, as a flat list.
  The same result viewed one screen away showed all three.

The certificate re-reads the stored row after release now, and the history query carries the header
block. The failure had simply moved from three renderings to three data shapes.

### F4 — a form that changed shape between patients

`showReference` was computed from the values recorded rather than from the form. Only 2 of
Urinalysis's 14 fields carry a reference range, so a Urinalysis where microscopy was not recorded
printed a **three-column** sheet and the next patient's printed four. Derived from the field set
now. Fecalysis — the one form in the workbook with no reference column — was right by accident and
is right by rule.

### F5 — a suppressed TSH stored as zero

`result_measurements.value_1` was `NUMERIC(7,2)`, sized when every field was a measurement in
centimetres. `[1.52.0]` put laboratory analytes on it, and Postgres **rounds rather than errors**: a
TSH of 0.004 mIU/L stored as `0.00`, and 0.001 and 0.009 became the same number. The value that
reads as "undetectable" is the clinically decisive one. Now `NUMERIC(10,4)`, and the rollback
refuses to narrow the column if any stored value would lose precision.

### F6 — a unique constraint that did not constrain

`uq_signatory UNIQUE (category_id, full_name, role_caption)` was commented "Re-running the seed must
not duplicate them." NULLs are DISTINCT in a Postgres unique constraint, so two identical **global**
signatories — the `category_id IS NULL` case, which is the one meaning "signs every report" — were
both accepted. A partial unique index covers it.

### Smaller, same commit

- **F7** Signatory order had no tiebreaker. Which name prints on the left of a signed clinical
  document must not be whatever the planner returns.
- **F8** A report with no `discipline` — every X-ray test, 2D Echo, any laboratory test outside the
  22 seeded sets — printed **no title**. Restored. And 2D Echo takes the ultrasound SHAPE now, since
  it is performed by Ultrasound Staff and 18 historical visit_tests still point at the category.
- **F10** `mergeMeasurements` trusted its client's payload shape. A bare value wrote an all-NULL row
  and died on a raw CHECK violation; an empty string reached NUMERIC and 500'd; an empty
  `value_text` wrote a row that passed the CHECK and printed as a blank line — the exact thing that
  CHECK exists to prevent.
- **F12** The discipline join had no `is_active` filter, so a deactivated field set kept printing
  its heading on reports whose grid had gone.
- **The report names who released it again.** The `[1.52.0]` rewrite dropped `released_by`. The
  seeded signatories are the clinic's standing attestation; they are not a record of who authorised
  THIS report, and the query had carried that all along.
- **`first_name` on a result row now means the patient**, not the releasing user — `[1.52.0]`
  changed that silently by widening the query. Aliased so the next reader is not caught.

### Also fixed: a test that depended on the demo data it was not testing

`workflow-context.spec.js` asserted that SOME seeded worklist row carried a referring physician.
That made it a test of the demo dataset: the seeded tickets are released over a day of suite runs,
and once the last one was gone it failed with "element not found" — which reads exactly like a code
regression and cost real time to diagnose as depletion. Both worklist tests build their own paid
ticket now and assert against a row they created, so the assertion is exact and the failure honest.

### Still open — needs the owner, not a developer

The report prints **a fixed pair of seeded names on every Laboratory result**, including an external
consultant pathologist with his PRC licence number attached automatically to results he may never
have seen. The photograph the owner sent is sufficient authority for the DATA — the names and
numbers are correct — but not for the BEHAVIOUR. One written line from the clinic, and ideally from
Dr. Lamayra, that both names are to print automatically on every laboratory result the system
issues, belongs on file before this reaches a real patient.

Separately escalated: `findResultsByPatientId` has no released-state filter, so a patient calling
`GET /api/results/history/...` directly can read a result recorded but not yet authorised. The UI
hides it; the API does not. Pre-existing — `findings` was already exposed this way — but `[1.50.0]`
added measurements to that payload and `[1.52.0]` added signatories, so a third feature has now
widened the same hole.

## [1.52.0] - 2026-08-26 (The form the clinic actually prints)

Two schema additions (`node src/scripts/migrateLabResultForms.js`, `--rollback` reverses it), 22
laboratory field sets, and a report that reproduces the clinic's own sheet rather than
approximating it.

### What was wrong

[1.50.0] built structured entry and seeded it for **Ultrasound only**, and printed a generic
report. The clinic's requirement is narrower and more literal than that: a technician opens Record
Findings, the fields for THAT test are already laid out, they type only the results, and the
printout looks like the document they issue today. Their Urinalysis form settles what that means —
a four-column sheet, `TEST | RESULT | UNIT | REFERENCE RANGE`, with section headings grouping the
analytes under a discipline heading, a COMMENT box, a disclaimer, and a two-signatory footer
carrying PRC licence numbers.

Three things were missing: **sections**, **laboratory field sets**, and **the signatory block**.

### `section`, and why it is a column rather than a convention

"A section owns everything until the next section" is the obvious rule and it is wrong on the
clinic's own CBC. `RDW-CV` prints two rows below `Basophils`, after the `Differential Count` block,
and is not a differential parameter. A convention would file it under the wrong heading on every
CBC they ever issue. An explicit nullable column cannot, and the renderer emits a heading by
comparing against the previous row, so a field with no section simply closes the group.

`result_field_sets.discipline` joins it — `CLINICAL MICROSCOPY`, `HEMATOLOGY`,
`CLINICAL CHEMISTRY`, `SEROLOGY/IMMUNOLOGY` — because the form prints one above its panel title.

### 22 laboratory field sets, 63 fields, transcribed not invented

Every label, unit, section and reference range comes from the clinic's own workbook. Coverage
against the 23-test Laboratory catalogue: **22 seeded, 1 not**.

**Almost everything is `text`, not `number`.** A laboratory RESULT column carries `YELLOW`,
`NEGATIVE`, `FEW`, `0-2` and `1.010` — often on one sheet. A numeric input would refuse three of
those five. Only analytes that are numeric on every observed sheet are `number`.

**Sex-conditional ranges print both halves**, exactly as the clinic's CBC does. One field, not
two: the technician records one haemoglobin value, and the patient's sex decides only which half
of the printed range the reader applies. Splitting it would ask for the same measurement twice —
and would have violated `UNIQUE (field_set_id, code)`.

**Fecalysis has no reference-range column at all** — the only sheet in 38 without one — so the
column is dropped when nothing in a set carries a range, rather than printing an empty one.

### The signatory block

A laboratory report carries **two** named signatories with PRC licence numbers. An ultrasound
report carries one radiologist and, in 1,113 archived reports, no licence number anywhere. So the
block differs by category, which is why `clinic_signatories` is keyed by one.

Not on `users`: the pathologist is an external consultant who signs the report and has no account,
and `users` has no credential column by design. Not env config like the TIN either — the clinic's
own forms supply both names and both numbers on 36 of 38 sheets, and a table lets them be corrected
from a screen rather than by editing `.env` and restarting.

`prc_license` is nullable and **not defaulted**. The radiologist's is blank because the corpus
contains none, and a blank prints nothing rather than a plausible-looking number — the same rule
`lib/clinic.js` applies to the TIN.

### `findings` is no longer the only proof a result exists

A laboratory form has no narrative; the clinic's sheet carries only a COMMENT box. Demanding prose
to save a Urinalysis whose fourteen fields are filled is friction that buys nothing, so a completed
grid is proof enough on its own. A test with **no** field set is unchanged and still requires the
text, which is what keeps `result-versioning.spec.js` and `laboratory.spec.js` green.

### Clinic identity corrected against the printed form

The system printed `Bugo, Cagayan de Oro, Philippines 9000`. Their own result form prints
`National Highway, Diesto Building, Bugo, Cagayan de Oro City, Misamis Oriental, 9000`, plus a
`LABORATORY • ULTRASOUND • X-RAY` services line the system had no field for. The printed document
is the authority: a report whose address differs from the clinic's letterhead is one nobody can
rely on. `CLINIC_SERVICES` joins the existing env-configurable identity.

Their form separates the three services with a **REGISTERED SIGN** — a Wingdings bullet that lost
its symbol font — so it currently prints `LABORATORY ® ULTRASOUND ® X-RAY`. Reproduced here as the
bullet it was meant to be.

### Open questions the clinic must answer

Recorded rather than guessed at, and reported by the seed on every run:

1. **FBS upper bound: 99.0 or 100.0.** The standalone forms print `70.0 - 100.0`; the two combined
   chemistry panels print `70.0-99.0`, for the same analyte. Seeded from the standalone form
   because that is the form this catalogue test corresponds to.
2. **OGTT 75g has two forms** with different reference semantics — one normal-range, one captioned
   `GESTATIONAL DIABETES` whose values are diagnostic thresholds of the opposite polarity. Seeded
   from the plain form; the gestational one needs its own catalogue test.
3. **Thyroid units.** The workbook prints `miu/L`, `nmo/L`, `pmo/L`. Seeded as `mIU/L`, `nmol/L`,
   `pmol/L` — the SI forms — because these are character omissions rather than clinical judgements,
   and printing a malformed unit on a new system perpetuates an error. One line each to revert.
4. **`Hct Hgb` prints haemoglobin in `g/L`** where every CBC sheet prints `g/dl`, with identical
   numbers. One of the two is wrong.
5. **Examiner caption.** The same person is captioned `Medical Technologist` on 21 sheets and
   `Examiner` on 17, with no discernible rule. The clinic's current form settles it as
   `Medical Technologist`.
6. **Disclaimer policy.** 28 sheets require a physical seal; 8 say the report is electronically
   signed and needs no signature. These say opposite things. Seeded with the 28-sheet majority.
7. **HIV Screening has no form in the workbook** — zero occurrences across every shared string.
   Nothing seeded.
8. **BUN.** The only standalone sheet is captioned `( POST )`. The plain analyte is seeded from the
   combined panels; the caption is not carried.

## [1.51.0] - 2026-08-26 (Three answers, and three fabricated numbers removed)

One constraint change (`node src/scripts/migrateBiophysicalScore.js`, `--rollback` reverses it),
seed data, and a correction to `resultTemplates.js`. Researched against published guidance before
deciding, because two of the three questions were about what NOT to build.

### X-ray stays on free text, and that is the finding

The clinic's archive holds **two** X-ray reports against a **24-test** X-ray catalogue, both Chest
PA, one dated 2013. Their five-line anatomic order (lungs, heart, aorta, diaphragm/costophrenic
sulci, "the rest") is not idiosyncratic — RSNA's own approved chest-radiograph templates model a
plain film the same way, as ordered region slots whose options are complete canned sentences with
no numeric fields at all. So the pattern is real.

It still does not justify building. `result_measurements` is a MEASUREMENTS model — `NUMERIC(7,2)`
plus a 120-character text column — and RSNA's canned sentences routinely run past 170 characters.
There is no options table, and `ResultReport.jsx` renders measurements as a right-aligned
`tabular-nums` table with a reference-note column, which is simply the wrong shape for prose. More
decisively: two exemplars evidence the skeleton and one normal sentence per region. RSNA's
equivalent carries roughly eight options per region, so building it means **inventing about forty
clinical sentences** — which is the thing [1.50.0] already refused to do.

ACR's practice parameter does not require it either. Its reporting section is explicitly headed
"the following is a **suggested** format", and its only instruction for findings is to use
appropriate terminology. Standardised templates "**may**" be used. No DOH or PhilHealth instrument
prescribes report structure. There is no forcing function.

### Three fabricated clinical numbers removed from `resultTemplates.js`

These are paste-able boilerplate one click from a real patient's report, and each carried a number
that was invented here:

- **`XRAY_CHEST`** was four bullets in the wrong order using terms the radiologist does not write
  ("Osseous structures", "cardiac silhouette"). Replaced with the clinic's own five lines,
  transcribed from an archived report.
- **`PELVIC_US`** contained a fabricated uterus measurement, `(5.2 x 4.1 x 3.8 cm)`. [1.50.0] gave
  Pelvic Ultrasound a field set, so a technician pasting this would put a made-up uterus size in
  the narrative while the Measurements block above carried the real one: **two numbers for one
  organ on one report, with no way to tell which was measured.** A live inconsistency [1.50.0]
  introduced.
- **`CBC_NORMAL`** pasted a fabricated patient value beside a reference range that is not this
  clinic's. Their own workbook reads `Male: 13.7-16.7 / Female: 11.7-14.5`, sex-conditional and
  narrower than the one that shipped.

A template is a starting point for prose. It must never carry a number that could be read as a
measurement.

### Endometrial thickness is now a field — with no threshold

Promoted onto `tvs` and `pelvic_gyn`. It is the most standardised measurement in gynaecologic
ultrasound: IETA exists specifically to standardise how it is acquired, and the SRU/ACOG 4mm
cut-off has a >99% negative predictive value for endometrial cancer in postmenopausal bleeding.
Measured against the corpus, **313 of 416 reports (75%)** carry a number explicitly bound to the
endometrium — median 0.76 cm — living only inside a prose sentence where nothing can query it.

`reference_note` is deliberately **NULL**, and the reasoning is worth keeping. The 4mm figure is
conditional on a population this schema does not hold: it is scoped to postmenopausal women *with
bleeding*. For asymptomatic postmenopausal women the literature says the threshold is not known and
ROC work suggests roughly 11mm; premenopausally there is no cut-off at all, since the endometrium
cycles from 1-4mm to 18mm. A `result_fields` row carries neither menopausal nor symptom status, so
any single printed note would be wrong for most of this clinic's TVS patients.

This keeps the `reference_note` rule coherent: it mirrors what is printed on the clinic's own form
(as `N.V. = 5.0 - 25.0 gms` does for the prostate) and never imports literature.

### BPS and Pregnancy Evaluation are different things

The clinic's owner confirmed they are not the same product, and the corpus shows why. **"Pregnancy
Evaluation"** is the study — 17 reports of fetal biometry. **BPS** is a *scoring block appended
inside* one, present in only 2 of those 17: `FT`, `FM`, `FBM`, `AFI`, each 0 or 2. That is Manning's
biophysical profile, and the billing world separates them the same way the catalogue already does —
`BPS` and `BPS w/ NST` are two products because the totals mean different things, /8 against /10.

Two field sets, therefore, not one with an optional NST field: a score of 8 presented as though it
were out of 10 reads as a worse result than it is. `BPS_SUM` totals only the components the set
itself defines, and **refuses to total an incomplete profile** — reporting 4/8 when two components
were never assessed would look like a poor score rather than an unfinished study.

`chk_result_fields_derivation` had to widen to admit `BPS_SUM`; the rollback refuses while any
field still declares it, since narrowing the constraint under live rows would leave data the schema
rejects.

### Two things deliberately not built

**"Pregnancy Evaluation" has no catalogue row**, so the clinic performs the study and cannot bill it
by name. That needs a **price**, and a fabricated price is precisely what `seedRealCatalogue.js`
refuses to invent. Reported in the seed's outstanding block.

**The per-fetus repeating group.** Sized honestly this time: **8 of 17 Pregnancy Evaluations are
twins — 47%**, not the fraction of a percent it looks like against the whole corpus. So it is
required before biometry can be seeded at all, and it is not small: `mergeMeasurements` is keyed on
field code alone, and per-fetus means recasting the carry-forward rule onto a composite key — the
most safety-critical function in the feature. It also raises a question with no current answer: if
version 1 recorded two fetuses and version 2 submits one, is the missing block "carry forward" or
"erase"? Getting that wrong silently retains a demised fetus's biometry on a live report.

### Hadlock stays out, and the research strengthened the case

Gestational age and estimated fetal weight remain **entered**, transcribed from the scanner.
"Hadlock" is a family of a dozen-odd equations rather than one, so reproducing it means guessing
which the scanner is configured for — and guessing wrong prints a number that disagrees with the
sheet the technician is copying from, wearing this system's authority. The AIUM parameter is also
explicit that a pregnancy should NOT be redated after an accurate earlier scan, which is exactly
what recomputing GA on every scan does. And it states that even the best weight prediction carries
errors up to 15%, so computing EFW to the gram implies an accuracy the method does not have.

The corpus's per-parameter ages matching Hadlock closely is evidence the **scanner** emits them.
The scanner is the measuring instrument; this system is the record.

## [1.50.0] - 2026-08-26 (A result is a form, not a paragraph)

### The screens

**One document, three screens.** `components/ResultReport.jsx` renders the clinical report for the
technician's just-released certificate, the staff read-back and the patient's own copy. Three
hand-rolled renderings existed before, and they had drifted: two hardcoded the clinic's name, the
read-back printed no letterhead at all, and only the patient's copy showed the referring physician.
The requirement — *record once, and that is what the patient prints* — cannot be met by three
renderings that agree only by coincidence.

**`components/diagnostic/MeasurementGrid.jsx`** renders the fields, and appears **only when the API
returns a field set**. That is a data-driven switch rather than a category branch, so Laboratory and
X-ray dialogs are byte-identical to what they were, and turning a modality on later is seed data.

Every input in the grid is an `<input>`, never a `<textarea>`. `laboratory.spec.js` drives the
findings box with a bare `page.locator('textarea')`, so a second one anywhere in that dialog breaks
two of its tests with a strict-mode violation — from a file that never mentions the grid. A spec now
asserts the count is exactly one.

**Derived values are not computed in the browser.** A live prostate weight as the axes are typed
would be nicer, and it would put a second copy of clinical arithmetic in the frontend.
`moneyRange.js` exists because two copies of a money rule drifted apart within one commit.

**The reset discipline extends to measurements.** `release()` saves whatever is in state before
releasing, so `openRelease` clearing `findings` but not the grid would write the PREVIOUS patient's
measurements onto this patient's report moments before it is emailed. All three openers clear both.


Four tables, no data. Ultrasound only — see the scope note at the end.

Reverse with `node src/scripts/migrateResultFieldSets.js --rollback`. **It refuses while any
measurement exists unless `--force` is also passed**, because unlike [1.45.0]'s rollback — which
dropped a grouping and left the money intact — this one destroys clinical values a technician
entered, and nothing else in the database holds them.

### What the clinic actually produces

Their own archive settles this. 1,113 real ultrasound reports, and every one opens the same way:

```
Findings:
    Measurements:      <- discrete, per-study numeric fields with units
    <narrative prose, one paragraph per organ>
Impression:
```

The measurement block is not prose and never was. `Right Liver Lobe = 15.81 cm`,
`Gallbladder = 7.09 x 2.21 x 1.67 cm`, `Prostate Gland = 3.42 x 3.46 x 3.22 cm ( wt.= 19.95 grams )`.
A technician retypes it into a free-text box today, and the archive shows the cost: **3.6–5.2% of
derived weights no longer match their own axes** — someone edited the measurements and never
recomputed. Measured independently: the ellipsoid coefficient is exactly 0.5236 in 94% of reports
and wrong in the rest. One file titled `whole abdomen-female- normal.doc` contains a chest X-ray.

The 1,117 files are named by *findings* (`fatty liver + cholecystitis`, `GS only + adnexal cyst`),
not by patient — only 5 of 1,117 carry a patient name. It is a template library maintained by
file-copy, and it is decaying.

### The four tables

- **`result_field_sets`** — one row per study (`whole_abdomen`, `hbt`, `tvs`, …), scoped by
  `category_id` so X-ray can be turned on later as seed data rather than a migration.
  `repeat_label` is non-NULL for exactly one set: a twin study duplicates its column block, and
  every other study in 1,113 reports is flat.
- **`result_fields`** — the field definitions. `value_kind` distinguishes a scalar from a
  `linear3` L×W×H triple, which is one row rather than three: three would lose the grouping, need
  an ordinal to restore the order, and triple the join.
- **`result_field_set_tests`** — which catalogue rows use which set. Deliberately **not** a
  `tests.field_set_id` column: `testRepository.updateTest` writes every column unconditionally,
  which is exactly how the Services Catalogue's status toggle used to wipe a test's `preparation`.
  A new `tests` column walks into the same trap; a separate table cannot be erased by a caller
  that never names it.
- **`result_measurements`** — the values.

### Three decisions that are load-bearing

**Values attach to the result VERSION, not the visit test.** `createResult` inserts a new
`test_results` row per save and copies nothing forward — which is why `resultService` has to
re-read and re-pass file metadata explicitly or an amendment wipes it. If measurements hung off
`visit_test_id`, an amendment would rewrite the superseded version's numbers *in place*, so the
amendment history would render v1's prose beside v2's figures. That destroys precisely what
[1.15.0] exists to preserve.

**The formula is stamped on the stored value, not read from code at render.** `derivation` travels
with the number. If a coefficient is ever corrected, new rows carry the new code and
already-released reports keep saying what they said — the same principle as [1.30.0]'s refusal to
restate a closed day. A `value_source` of `'override'` means a sonologist typed a figure the
formula disagrees with; it is kept exactly as typed. This system shows a clinician a
disagreement, it does not overrule one.

**Only three formulas, all evidenced by the corpus.** `ELLIPSOID_VOLUME` (π/6, verified at 0.5236
across 343 reports), `EDC_NAEGELE` (scan date + 280 − GA, median exactly 280), and `GA_FROM_MSD`
(MSD in mm + 25 — measured; **not** Hellman's +30, which fits this clinic's data terribly).
**Hadlock is deliberately absent.** Gestational age and estimated fetal weight come off the
scanner printout, the clinic's templates state no regression for either, and a fabricated
gestational age on a clinical report is not a rounding error.

### Nothing is NOT NULL at the value level

Every field in the corpus has a real absence rate — the thyroid's right lobe appears in 85% of
thyroid studies, and 18 of 405 whole abdomens carry neither pelvic organ (paediatric, or
post-hysterectomy). A NOT NULL the clinic's own practice violates does not get respected; it gets
a `0` typed into it, which is worse than a blank on a clinical document. `is_required` is advisory
— a UI hint, never a save-blocker.

The sex-conditional branch is real and total: of 405 whole abdomens, 194 carried a prostate, 193 a
uterus, and **zero carried both**. `applies_to_sex` sits on the field rather than splitting the
set in two, which would duplicate the five organs both branches share.

### Scope

**Ultrasound only.** The clinic's archive contains exactly **two** X-ray reports, both Chest PA,
against a 24-test X-ray catalogue. There is no evidence to build the other 23 from, and guessing
at a clinical form produces a document that looks official and is wrong. Laboratory has its own
field taxonomy (74 analytes, sex-conditional reference ranges) and is a later slice.

`schema.sql` is **not** updated, matching what `test_packages`, `payment_methods` and
`payment_submissions` already do — every table added since roughly [1.45.0] lives in its migration
script alone.

## [1.46.0] - 2026-08-25 (A fill and its foreground are two halves of one decision)

No schema change. Frontend only. Fixes the third recurrence of [1.45.0]'s bug shape, and adds the
check that makes the fourth fail at lint time instead of on screen.

### What was reported, and what was actually wrong

Two controls were unreadable in dark mode: the Active Queue's ticket number and Walk-In
Registration's Search button. Both were `bg-slate-900 text-white`. `--color-slate-900` is remapped
to `#eef2f6` for dark mode — near-white — so both rendered white on near-white, **1.12:1**.

The remap is right for the INK role and inverted for the FILL role, which is exactly [1.45.0]'s
finding about `brand-600/700`. The sweep found the same fault in six more places, two of them
worse than the two reported:

| | was | now |
|---|---|---|
| "Confirm Refund" (`CashierDashboard.jsx:190`) | **2.69**, hover 1.89 | 4.70, hover 6.29 |
| Critical-result tap-to-call (`CriticalCallbackDialog.jsx:51`) | **2.69** | 4.70 |
| Queue ticket (`ActiveQueuePanel.jsx:147`) | **1.12** | 15.87 |
| Search (`WalkInPanel.jsx:51`) | **1.12**, hover 1.31 | 15.87, hover 13.67 |
| `Button` `secondary` pressed (`button.jsx:27`) | **1.00** — white on white | 17.85 |
| `Badge` `secondary` / `destructive` | 1.12 / 2.69 | 15.87 / 4.70 |
| Public footer body text (`PublicFooter.jsx`) | **1.81** | 11.55 |

The refund button is the one that matters most: an irreversible, money-moving action whose label
was hardest to read at the moment of pressing it. Neither it nor the critical-callback button was
in the report.

### The root cause was in the dark-mode work itself

`--color-emphasis` exists precisely to solve this. [1.40.0] created it as the seam token for "the
dark counterpart to the primary button", correctly reasoned that it must invert with the ground,
and set its dark value to `#eef2f6` — while `button.jsx` kept a hardcoded `text-white`. The fill
flipped and its ink could not follow, because a literal has no theme.

`emphasis` was **the only fill token in the file shipped without a foreground**. `primary`,
`secondary`, `destructive`, `card` and `popover` all have one, and the dark block already flips
`card-foreground`/`popover-foreground` in lockstep. So the fix is the file's own existing idiom,
not a new one:

- `--color-emphasis-foreground`: `#ffffff` light, `#0f172a` dark, **defined next to the fill** so
  the two cannot drift apart again.
- `--color-destructive` promoted to a real ramp (`-hover`, `-active`, `-foreground`). Deliberately
  **absent from the dark block**: red carries its meaning by hue rather than by tonal distance, so
  it reads on both canvases, and inverting it would turn the one irreversible button in the app
  pale. Its value moved `#ef4444` → `#e11d48` — the old value had zero consumers and would have
  *lowered* light-mode contrast from 4.70 to 3.76.

All eight call sites now use a paired token. Two were hand-rolled bypasses of a primitive built
for exactly them: the Search button became `<Button variant="secondary">` and the refund button
`<Button variant="destructive">`, which also retires two [1.39.0] label-swap stragglers.

### The same fault, pointing the other way: ink on surfaces that never flip

A surface that is dark in BOTH themes must not carry themeable ink — the fourth appearance of this
(rail heroes in [1.40.0], `rail-accent` in [1.43.0], `.auth-panel` in [1.45.0]). `rail-ink-*`
exists for it, and the migration had been started and abandoned: `AboutUs.jsx:38` already used
`text-rail-ink-soft` on the line directly below a `border-gray-800` that was still broken.

Migrated: the whole public footer (body copy at 1.81:1, plus two `border-gray-800` hairlines that
were rendering at **12.45:1** — bright white slashes where a subtle seam belongs), the three public
banners, both `bg-rail` portal cards, and four `rail-gradient` heroes that a previous pass reported
as fixed and had missed.

### Twelve invisible skeletons

`bg-slate-100`/`bg-gray-100` remaps to `#16212e`, which against a card's `#131c2b` is **1.05:1**.
Twelve loading placeholders across nine screens were invisible, silently reinstating the exact
failure `skeleton.jsx` documents: a panel that reads "nothing here" rather than "not yet", so
people conclude a queue is empty and leave a screen that is about to fill. No contrast rule covers
a decorative placeholder, so nothing else would have caught it. All twelve had bypassed the
`Skeleton` primitive; they now share one `--color-skeleton` token (1.68:1 on dark, matching light
mode's weight).

### Three more

- **Cut-out rings stopped cutting out.** The unread-count `ring-white` and the avatar's
  `border-white` are gaps matching the ground, not decoration; `white` never remaps, so both became
  bright halos on dark chrome. Now `ring-surface` / `border-surface`.
- **The payment QR had no white backing at all.** A QR is a machine-readable optical target — its
  contrast budget belongs to the scanner, not the theme. A transparent upload rendered dark-on-dark
  and would not scan, and `object-contain` letterboxed dark canvas into the quiet zone even for an
  opaque one. Now a fixed `#ffffff` with `p-2`. This is the only item here whose failure mode is a
  patient unable to pay.

### `scripts/checkFillRoles.js` — why a comment was not enough

`index.css` already carried a warning that this ramp "is NO LONGER MONOTONIC" and that misusing it
"will produce dark-on-dark". Four instances were then written anyway, one of them by the same pass
that wrote the warning. Prose does not stop this; a grep does.

The check bans `bg-{slate,gray}-{700,800,900,950}` and `bg-{rose,red}-{600,700,800}` outright.
Those shades are ink; every legitimate solid fill goes through a paired token. Making the rule
absolute keeps it context-free — no pairing analysis, no false positives — and it fails on the
fill you wrote rather than on the foreground you forgot. It also reads the dark block out of
`index.css` at runtime and warns about any *other* shade that block turns light while being used
as a fill, so it widens as that block grows rather than needing to be kept in sync by hand
(`prose_scan.py`'s `HOOKS` list is its eyesight, and that is a weakness worth not inheriting).

Wired into `npm run lint`. Verified by reintroducing both original bugs and confirming it fails.

### Known, still not fixed

Unchanged from [1.45.0]: the Google sign-in button (shadow DOM), the Recharts axis/grid/cursor
props, and two `lib/categories.js` chart colours below the 3:1 floor. Newly noted and left alone:
`ring-rose-300` on `wait-badge.jsx` is the one shade in a four-step severity ladder the dark block
does not remap, so the worst wait tier shouts louder than the other three — arguably correct, but
by accident. And `Receipt.jsx` on screen is a themed panel while the paper is pinned light, so a
cashier proofing it before printing is not previewing what prints; that is a product decision
rather than a defect.

## [1.49.0] - 2026-08-25 (Tell the patient, and let the cashier look back)

No schema change. The two gaps [1.48.2] left open.

### The patient is told, by email, because there is no other channel

**The patient portal has no notification bell.** An in-app notification addressed to a Client would
be a row written to a table nobody can ever see — so for a patient, email IS the channel and the
portal card is where they look it up afterwards.

That matters most in exactly this flow: the patient has paid and is waiting on something only the
clinic can do. Silence reads as "it did not go through", and the usual next step is paying twice.
So a decision now sends one of two mails:

  * **verified** — the pass is ready, with the receipt number and amount
  * **rejected** — with the reason, and how to send it again

The reason is the whole message. Requiring one at rejection ([1.48.0]) is only worth anything if it
reaches the person who has to act on it — otherwise it is a note the clinic writes to itself, which
is the failure [1.27.0] fixed for HMO refusals.

Both are sent AFTER the decision commits and neither can fail it: `sendEmail` already swallows
transport errors, and `notifyPatient` adds the same guarantee around the lookup. Verified against a
real client booking with SMTP off — the log shows a clean skip naming the recipient and subject.

The address comes from the account that OWNS the patient profile, never from `submitted_by`:
reception can file a claim on a patient's behalf, and mailing the receptionist that their payment
was rejected helps nobody.

### A settled submission stopped disappearing

Verified or rejected, it dropped out of the only screen that showed it. A cashier asked "did we take
that GCash payment yesterday?" had nowhere to look, and could not re-open the screenshot behind a
decision somebody else made — the receipt was in Transaction History, but the EVIDENCE for it was
nowhere.

`GET /payment-submissions/reviewed` and a **Recently Reviewed** panel: who decided, when, the
receipt number if it produced one, the reason if it did not, and the proof still openable. Gated on
`billing:read` rather than `billing:process` — looking is not taking money, and Admin oversees the
cash-up without being able to transact on it.

Bounded at 20 rather than paged: this answers "what happened recently", and anything older is a
question for the transaction history, which is built for it.

## [1.48.2] - 2026-08-25 (Catching a bad screenshot before the cashier does)

No schema change.

**The patient sees what they are about to send.** A thumbnail of the chosen file, its size, and a
line saying to check the reference and amount are readable — plus a remove button. This is the
cheapest possible place to catch an unreadable screenshot: at thumbnail size it is obvious, and
fixing it costs one click instead of a rejection, a phone call and a second upload. The guidance
("a screenshot from your banking app works better than a photo of the screen") is stated BEFORE the
file picker rather than in a rejection afterwards.

The object URL is revoked on replacement as well as on unmount, so picking three files in a row
does not leak two blobs for the life of the page.

**`backend/src/utils/money.js`.** The backend wrote money into notification text as
`₱${n.toFixed(2)}` at each site, so a cashier's bell read "₱13690.00" — legible only by counting
digits, which is the opposite of what a glanceable notification is for, and disagreeing with every
figure on screen. One formatter now, same locale and options as the frontend's `lib/currency.js`,
used by both notification sites so they cannot drift.

Verified that the cashier notification actually lands, rather than assuming the server call worked:
the bell goes 10 → 11 and reads "Proof of payment to review — Ref … awaiting verification".

## [1.48.1] - 2026-08-25 (The screens for it)

No schema change. The three screens [1.48.0]'s API was built for.

**SuperAdmin → Payment Methods** (a third tab beside the RBAC matrix and elevated accounts, which
is where the other two undelegatable capabilities already live). The account number is echoed back
in large tabular figures as it is typed, because a mistyped digit produces no error anywhere — the
money simply goes to a stranger — so the only defence is making it easy to read back against the
banking app it was copied from. A standing banner says every change is recorded against your name,
and a red line appears if every method is hidden, since "patients cannot pay online at all" is
invisible from a list that has rows in it.

**The patient's booking card** now shows the clinic's account, its QR, a copy button for the number
and an upload form — and the QR booking pass is issued only once payment is verified.

That last part reverses [1.23.0]'s rule, and the reasoning it reversed is worth keeping: the pass
used to require payment, that disabled the feature because the clinic could only take money at the
counter, so it was shown unpaid instead. **That premise is gone** — a patient can settle from home
now, so withholding the pass gives them something to do rather than stranding them. The reference is
still printed as TEXT on an unpaid booking, so the counter path never depended on the QR at all.

`amount_due` was added to the client's bookings query: a patient about to type a figure into a
banking app should not have to go and find it somewhere else.

**Cashier → Online Payments**, polling at 20s because a patient who has just paid is watching for
their pass and the cashier is the only thing between them and it. The queue puts what the patient
claims beside what the visit owes, and spells the mismatch out in words — "Approving records
₱1,450.00 as received" — because two numbers in adjacent columns is exactly the difference a tired
eye slides over at the end of a shift.

`ConfirmDialog` gained `children`, so a rejection can carry its reason field.

### One bug this introduced and caught

`payment_submissions.payment_id` references `payments`, so `purgeE2eData.js` deleting payments first
failed the constraint and **aborted the whole purge**. Surfaced as a "purge failed (non-fatal)" line
after a green spec run — which is exactly the shape of thing that gets skimmed past. Submissions are
deleted before payments now.

## [1.48.0] - 2026-08-25 (Pay into the clinic's own account, and a cashier checks it)

`node src/scripts/migratePaymentSubmissions.js` — additive, idempotent, `--rollback` reverses it.
Then `node src/scripts/setupRbac.js` for the new permission.

Online payment **without a gateway**. The patient pays into the clinic's own GCash or bank account,
uploads a screenshot with its reference number, and a cashier looks at it and approves. Deliberately
not PayMongo: the gateway path ([1.37.0]) stays in the codebase, dormant, and this needs no merchant
account and no publicly reachable webhook.

### Two tables, and why not one

`payment_methods` is what the clinic PUBLISHES — a GCash number, a bank account, a QR image.
`payment_submissions` is what a patient CLAIMS — "I sent ₱1,450, here is the screenshot".

`payments` is not extended, because `payments` is the money: every peso figure in the app is
aggregated from it, and `receipt_number` comes from `daily_counters` at the moment a real payment is
taken. An unverified claim is none of those things, and writing claims in there with an 'Unverified'
status would put them one missing WHERE clause away from counting as revenue — the exact class of
bug [1.30.0] spent a release fixing.

On approval the cashier's **existing** `processPayment` runs: same receipt number, same visit
release, same cash-up entry, same audit trail. A parallel "verified payment" writer would have been
a second way to take money, and the two would have drifted the first time either changed.

### The claimed amount is never trusted

Verified against a live visit: a claim of ₱50 on a ₱1,450 visit, approved by a cashier, produces a
payment of **₱1,450** — the figure comes from the recomputed bill, not from what the patient typed.

That is right for the ledger and wrong for the drawer, so the review queue now carries `amount_due`
beside `amount_claimed`. The cashier is the control, and a control needs both numbers side by side
rather than in two screens.

### `payment_methods.kind` is constrained to Cash / GCash / Bank

Not free text, which was the first shape. `payments.payment_method` is constrained to exactly those
three by `chk_payment_method` ([1.33.0]), and the drawer tiles and `findTransactionSummary` are
built on them — a fourth kind would either fail the constraint on approval or land in a bucket that
belongs to no tile and quietly vanish from the day's total. The clinic's own naming lives in
`label`: kind `Bank`, label `BPI Savings`.

### Who may do what

Publishing an account number is **SuperAdmin only**, matching `superAdminRoutes.js` and
deliberately not delegable by permission — it is where a patient's money is about to be sent, and a
wrong number here routes real payments to a stranger. Every write is audited with the old and new
number, because that is the only question anyone asks afterwards.

`billing:submit_proof` (new) covers filing a claim: Client, Receptionist, Cashier, Admin. Verifying
is `billing:process` — taking money, which stays with the cashier. Admin can file one and cannot
verify one, preserving the standing separation of duties.

### A hole in verifyRbacWiring, found by falling into it

The route parser read **one line at a time**, on the stated convention that every route fits on one.
A route written across several lines was therefore not examined at all. Caught when a route gated on
`billing:submit_proof` — a permission that did not exist — was reported as "All good", which is the
single thing that script exists to make impossible. It joins a `router.<verb>(...)` call across
lines on balanced parentheses now, and immediately reported the four real problems it had missed.

## [1.47.1] - 2026-08-25 (The demo seeder outlived the departments it named)

`seedDemoScenario.js` hardcoded all five categories in four places. Retiring 2D Echo and ECG in
[1.47.0] therefore left `catalogue['2D Echo'][0].id` reading a property of `undefined`, and the
seeder died with "Cannot read properties of undefined" — so the documented pre-demo step
(`resetDemoData.js --confirm` then `seedDemoScenario.js`) was broken by the change and nothing in
the suite covers it, because the seeder is tooling rather than app code.

It derives the list now: `OFFERED` is whichever categories actually have active priced services,
and the two places that named a specific one fall back to a category that exists. A demo seeder
that cannot run is worse than one covering fewer departments, and which departments the clinic
sells is not this script's fact to assert.

Found by running it, not by reading it — the same reason the pre-demo step is documented at all.

## [1.47.0] - 2026-08-25 (2D Echo and ECG retired; packages become editable)

No schema change.

### 2D Echo and ECG are not offered

The clinic confirmed it does not do them. Their three tests are **deactivated**, not deleted, and
the `test_categories` rows stay — 18 historical `visit_tests` point at them, and a past visit has to
keep being able to say what it was for. `modality.js`, the category colours and the portal's result
filters all keep their entries for the same reason. Removed from the public copy that advertised
them: the Home hero's service list, the About Us founding sentence, and the footer's services
column. The public price list and the booking picker read only active rows, so both dropped them on
their own.

`services-fold.spec.js` used ECG as its "small department" example in three assertions. Repointed to
Ultrasound — the property it tests (a layout tuned for the long department must not drop the others)
is unchanged; only the example was retired.

### Packages were read-only, which made them half a feature

`[1.45.0]` shipped `GET /api/packages` and nothing else. An admin who could already reprice every
individual test could not touch the bundle those tests are sold in — the only way to change a
package price or its contents was to edit `seedRealCatalogue.js` and re-run it.

Now `POST /packages`, `PUT/PATCH /packages/:id`, and `GET /packages/manage`, all behind
**`tests:manage`** — deliberately the same permission that governs pricing a test, because a package
IS a price. A separate permission would have to be granted alongside it every time, and the first
time somebody forgot there would be an admin who could reprice a test but not the bundle containing
it. Admin and SuperAdmin hold it; Reception and Client get 403.

Two guards on the server, not just the screen: a bundle of fewer than two tests is refused (that is
just a test), and a retired package cannot be booked.

### One bug caught before it shipped

The management listing was first a `?includeInactive=true` flag on the public route. That route runs
no `verifyToken`, so `req.user` is undefined even when a caller sends a perfectly good token — the
flag was **silently always false**, and the management screen would have shown an incomplete list
with nothing to indicate why. An authorisation decision needs middleware that actually runs, so it
is its own route now.

`packageRepository.update` COALESCEs per column, so a caller sending only `isActive` cannot blank
the description — the `testRepository.updateTest` trap, avoided in advance rather than after.

### The purge grew again

`packages.spec.js` creates a bundle to prove who may price one. Named `E2E …` and removed by
`purgeE2eData.js`, exactly as the catalogue fixtures now are — a package left behind is a fake deal
sitting in the admin catalogue and, if it were still active, on the public price list.

### A correction

The handwriting beside the package panel is a list of **individual prices**, not a breakdown of
Package E — this repo had it the wrong way round. Package E keeps its printed ₱2,050. "HIV 500" is
loaded. Two remain open and are printed by the seed script every run: "TVS-300" contradicts the 2025
ultrasound sheet's printed ₱700 (the printed figure was loaded), and "PB-1,200" is an abbreviation
this repo cannot resolve.

## [1.46.0] - 2026-08-24 (Test data that looks like a clinic)

No schema change. Test tooling only.

### The catalogue was silting up, in a place people look

`catalogue-partial-update.spec.js` mints a throwaway test to prove a status toggle does not wipe a
test's preparation text, and **deactivates** it rather than deleting. `purgeE2eData.js` scopes by
the throwaway email domain and the run window — it never touched `tests` — so one row was left
behind on **every single run, forever**.

They are not hidden either. They sit in the admin Services Catalogue as
`E2E Preparation Guard 1787594770405`, which is what somebody sees when they open that screen to
change a price. Twenty-one had accumulated before this was noticed; five more appeared during the
day's work. The purge now removes them, and only ever removes rows nothing references — a fixture a
surviving visit still points at stays, because deleting it would change what a past bill says it
was for.

### Fixtures are named after people now

`E2E Pkg1786480428`, `Reyes-17863726459464828`, `M9 Fixture1786…`. Those are real rows in a real
database while the suite runs — they sit in the Active Queue, the billing queue and patient search,
so anyone opening the app mid-run sees a clinic full of garbage, and a demo that overlaps a test
run looks broken. It also made the seeded demo data and the test data look like two different
products.

`tests/e2e/helpers/people.js` hands out realistic Filipino names from a ~2,500-combination pool,
remembering what it has issued and re-rolling on a repeat, falling back to a compound surname
("Santos-Villanueva") rather than a visible escape hatch. The uniqueness that used to live in the
NAME now lives in the **email**, where nobody has to read it.

### What identifies a fixture, now that the name does not

Nothing in the automatic teardown ever used the name — `purgeE2eData.js` scopes by the
`@enlogada-e2e.test` domain and the run's start timestamp, and walk-in fixtures (which have no
account) are caught as parentless patients created inside that window. Both are name-independent.

`cleanE2eData.js` is the exception: it is the manual tool for a database that has already silted
up, and it **did** match on the old name shapes. It gained the reserved contact number `09000000000`
(no Philippine mobile prefix is 0900, so no live patient can collide) and keeps the old patterns
for the historical rows — removing them would strand those permanently.

### One spec deliberately keeps a synthetic name

`revalidation.spec.js` filters the queue to a surname that **must not exist yet**, so the empty
result can be cached with its ETag and then overturned. A realistic surname drawn from a pool could
already belong to a seeded demo patient, and the precondition would silently not hold. It keeps
`Revalidate<timestamp>`, with the reason recorded beside it.

### A trap this surfaced

`laboratory.spec.js` asserted `` `M9 ${patient.last_name}` `` — the fixture's first name hard-coded
into five assertions, a second source of truth for a fact the fixture already carries. It broke the
moment the fixture stopped being called "M9". They read `patient.first_name` now.

## [1.45.0] - 2026-08-24 (The real price list, and the package deals)

`node src/scripts/migrateTestPackages.js` — additive, idempotent, `--rollback` reverses it.
Then `node src/scripts/seedRealCatalogue.js --confirm` to load the data.

### The rest of the price list

The catalogue held real prices for Laboratory only; Ultrasound and X-Ray were still demo figures.
Transcribed from the clinic's own laminated sheets, including the handwritten amendments:

    Ultrasound   4 demo rows  ->  14 real services   (2025 sheet)
    Xray         3 demo rows  ->  24 real services   (both printed pages)
    Laboratory  22 unchanged, + HIV Screening

Demo rows whose real equivalent is on a sheet were **renamed and repriced in place**, because
`visit_tests.price_at_time` snapshots the sale price and historical rows point at those ids. Demo
rows with no equivalent were **deactivated, never deleted** — deleting orphans the visits that used
them, and leaving them bookable sells a service at a price the clinic never set. Three were
deactivated (Abdominal Ultrasound, Breast Ultrasound, Abdominal X-Ray) and each is named in the
script's summary so the clinic can re-enable it with a real price.

### Packages: why they are not a `tests` row

The five bundles (A–E, ₱1,450–₱2,400) had never existed in the system, so reception was adding the
components one at a time and the patient paid the **sum of the parts** — always more than the
package. Package A is ₱1,450; its components at list are ₱1,650.

A package cannot be a `tests` row, because a row has one `category_id` and that is what routes work
to a department worklist. Every one of these spans Laboratory *and* Ultrasound, so as a single row
half the work would never reach the department that has to do it.

So `test_packages` + `test_package_items`, and at booking a package **expands into one
`visit_tests` row per component** — exactly as if reception had added them individually. Every
downstream screen keeps working unchanged, because it is looking at ordinary visit_tests.

### The allocation, which is the only real logic

The fixed price is spread across the components in proportion to their list prices, with the
rounding remainder placed on the largest, so the parts sum to the whole **exactly**:

    Package A ₱1,450, components at list ₱1,650
      Pelvic Ultrasound 500 -> 439.39     CBC              180 -> 158.18
      HIV Screening     500 -> 439.39     Hepa B Screening 190 -> 166.97
      Blood Typing      190 -> 166.97     Urinalysis        90 ->  79.10
                                                           sum = 1450.00

Exactness matters because `price_at_time` is what every downstream total reads — the visit
subtotal, the statutory discount base, the cashier's drawer, and `reportRepository`'s per-department
revenue share. Proportional rather than even, so the department that did the ₱500 of work is
credited with it.

The alternative — one line at the package price plus a discount line — was rejected: it puts the
whole bundle in one department's revenue and leaves the other showing work it did for nothing.

`visit_tests.package_id` records which bundle a line came from, so the terminal and the receipt can
say "Package A" once rather than listing six components at prices that look arbitrary alone
(₱158.18 for a CBC invites a question the cashier cannot answer).

### HIV, and the arithmetic that caught the error

HIV Screening is on no printed sheet. Loaded first at ₱0.00, which made the totals absurd — **four
of the five packages cost MORE than their own components**. The clinic confirmed the handwritten
"HIV 500" on the package panel, and at ₱500 every bundle becomes a real saving (A +200, B +190,
C +190, D +50, E +590). The seed script now refuses to be quiet about this: it totals every package
against its components and prints a loud warning for any that is upside down.

### Two bugs found by testing rather than by reading

- **`attachTests` short-circuits to `[]` on an empty `testIds`**, which for a package-only booking
  discarded the rows just written and reported "0 test(s) added" for a visit carrying six. The
  attach path re-reads the visit now instead of trusting what it inserted.
- **The seed script was not idempotent.** The first run renames "Chest X-Ray (PA)" to "Chest PA";
  the second looks up the old alias, fails, plans an INSERT and dies on `uq_tests_category_name` —
  rolling back the whole run. It looks up the canonical name first and falls back to the alias.

Packages attach BEFORE loose tests in both booking paths. Both writes are `ON CONFLICT DO NOTHING`
against `uq_visit_tests_visit_test`, so for a test that is both inside a bundle and picked
individually, whichever lands first sets the price — and the package's allocated share is the one
that must survive, or the bundle quietly costs more than its fixed price.

## [1.45.0] - 2026-08-24 (A ramp remapped for one role is still live in the other)

No schema change. Frontend only. Follows [1.44.0]; fixes defects in [1.40.0]'s dark mode found by
reading the merged stylesheet rather than by any test — nothing in the suite asserts a colour, so
all of this passed 200 green tests while being visibly broken.

### The mistake, stated once, because it caused most of the list

The dark block remaps `--color-brand-600/700` and `--color-azure-600` to *lighter* values, and the
comment beside them says why: "ink lightens; the light ramp darkens". That is correct for ink. It
is wrong for the same token used as a **fill**, and both roles are live:

```
bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700   <- button.jsx, the default variant
```

So in dark mode every primary button got *lighter* when hovered (white on `#81a570`, **2.30:1**)
and lighter still while held down (white on `#acc4a1`, **1.60:1** — the label vanishes under the
cursor). That is Take Payment, Release Result and Confirm Booking. The fill role is now pinned
back to the light ramp: hover **5.64:1**, active **7.66:1**, and pressing something still darkens
it, which is what the gesture means in either theme. Same fault and same fix for `hover:bg-azure-600`
on the Services CTA (2.60 -> 6.60).

### A fixed-dark surface must not follow the ramp

`.auth-panel` does not flip — like the rail, it is dark in both themes. Three of its four text
elements used azure as ink, so remapping azure took the eyebrow, all three trust points and the
address footnote to roughly **1.1:1**: invisible. The tokens are rebound on `.auth-panel` itself
rather than by matching generated class names, which also covers the opacity variants
(`text-azure-100/80`) and anything added there later. Now 5.25-6.57:1.

This is the third time this shape of bug has appeared (the rail heroes in [1.40.0], `rail-accent`
in [1.43.0]). **If a surface is dark in both themes, ink on it is not themeable.**

### Tailwind emits one class per variant, and `divide-*` is not `border-*`

`.border-[#e6ebf1]` never matches `.hover:border-[#e6ebf1]`, and `divide-y` compiles to a selector
of its own — measured against the built CSS, v4 emits `:where(.divide-[#eef2f6]>:not(:last-child))`,
**not** the v3 `> :not([hidden]) ~ :not([hidden])` shape. The first version of this fix used the v3
shape: valid CSS, matching nothing. Covered now, each verified present in `dist/`:
`divide-[#eef2f6]` (4 admin panels), `hover:border-[#e6ebf1]`, `bg-[#e6ebf1]` (the gridline fill on
Cashier Monitoring), `bg-white/95` (the checkout terminal's sticky header — one file away from the
`/85` rule written for exactly this).

### The rest

- **`.alert-*` kept its pale rings.** The rims are `box-shadow: inset`, and `.alert` declares no
  `border` at all — so [1.40.0]'s `border-color` override was a no-op on all four tones. The
  sign-in error alert wore a pink pastel ring on a dark tint. Now overrides `box-shadow`.
- **Stacked table cards were literal `#fff`.** An element selector on `<tr>`, unreachable by the
  `.bg-white` class override, so below 639px every card list rendered `#eef2f6` ink on white — on
  the phone width the block exists to serve.
- **The crash screen was unreadable.** `text-[#192534]` heading and a retry button hovering to
  `#67803c` from the retired ramp, on the one screen shown when everything else has already failed.
- **The travelling tab pill matched its own card.** `bg-white` and `.auth-card` both resolve to
  `--color-surface`, and its shadow is an arbitrary literal inlined at build time, so the indicator
  [1.44.0] is built around disappeared. It is lighter than the card now, as it is in light mode.
- **`text-brand-800`** had no dark value (1.40:1 on the permissions-matrix callout). Now 11.78:1.
- **`shadow-raised`** was not in [1.40.0]'s elevation rewrite, so the hover lift silently stopped
  existing; `hover:border-azure-200` failed on the same cards at the same moment, leaving service
  cards with no hover state at all. Both fixed.
- **The focus ring** was a literal `#0a71a9` at **1.90:1** on the dark canvas — the app's only
  focus indicator, and the last affordance that should thin out. Now `#549cc3`, **6.17:1**.

Every ratio above is computed, not estimated. All 14 override selectors were checked against the
built CSS to confirm they match a class Tailwind actually emits.

### Known, deliberately not fixed here

Three need component changes rather than CSS and are left for a decision:

- **The Google sign-in button** is `theme="outline"`, rendered by Google's own widget inside shadow
  DOM. No stylesheet can reach it, so it stays a white slab in a dark card. Needs `theme` driven
  off `data-theme`.
- **Chart axes, gridlines and the hover cursor** are Recharts SVG props (`stroke="#f1f5f9"`,
  `cursor={{ fill: '#f8fafc' }}`), unreachable by any class override. On a dark card the gridline
  becomes the loudest thing in the chart.
- **The categorical chart palette** (`lib/categories.js`) is five fixed hexes; two fall below the
  3:1 non-text floor against the dark card. Its prose still claims the palette "passes all of
  them", which was true against one surface and is not with two.

## [1.44.0] - 2026-08-24 (The sign-in page, actually redesigned)

No schema change. Frontend only.

[1.43.0] recoloured this page and moved a toggle, and called that a redesign. It was not. This is
the pass that reads published guidance first and then changes the structure.

### The form had no surface, and that was the whole problem

Established practice for an auth screen is a compact card with a soft shadow, so the task stands
out from the page. This page deliberately had none — [1.23.0]'s reasoning was "the column IS the
card" — and that single decision is why it read as unfinished no matter what the panel beside it
did. A bare form on flat white gives the eye nothing to land on.

So: `.auth-card`, a white card with a soft shadow, sitting on `.auth-ground` — a very lightly
tinted surface carrying an azure and a green wash. White-on-white gave the card nothing to
separate from.

### The motion was wrong in three specific ways

Micro-interactions read as responsive in the **120–220ms** band; past that they read as animation
you are waiting for.

- **The mode swap was 320ms and always slid in from the right.** Going *back* to Sign In therefore
  travelled the same direction as leaving it, so the motion contradicted the navigation. It is
  directional now (`authSwapFwd` / `authSwapBack`) and 260ms.
- **The toggle blinked.** A white background jumped from one button to the other. It is one pill
  that *travels*, 220ms, transform-only so it composites — the indicator leads, the form follows,
  and the two read as a single movement.
- **A rejection had no motion at all.** A wrong password now shakes the alert: horizontal
  oscillation, which is physically a head-shake. It rides **alongside** the red border, the icon
  and the message, never instead of them — motion says nothing to a screen reader or to anyone
  with reduced motion on, and the blanket `prefers-reduced-motion` rule correctly kills it while
  the border and text still carry the whole message. Keyed on a rejection *count*, because two
  wrong passwords in a row set the same error string and React would otherwise keep the element
  and not replay.

### Focus is one colour and one idea, at two scales

The global `:focus-visible` outline was green while the interactive colour is now azure. Both are
azure now, and a text field draws a soft inner ring instead of an offset outline — a 2px outline
*around* a bordered input plus the input's own focus border is two rings on one control.

### A layout trap worth writing down

The Google button takes a pixel width only. Without `min-w-0` and `overflow-hidden` on its slot,
an oversized button sets that slot's min-content width, which pushes the card, which pushes the
page — and the ResizeObserver then measures the *inflated* width and can never converge. Measured:
a 390px phone scrolled 22px sideways. Clipped, the slot's width is dictated by the card, the
measurement is honest, and it self-corrects. Verified at 1440, 768, 390 and 360, both modes.

## [1.43.0] - 2026-08-24 (A front door worth walking through)

No schema change. Frontend only.

### The sign-in panel was muddy, and that was a token being used out of place

The dark column used `.rail-gradient`, which washes **green and azure** over near-black. That is
correct for a hero band sitting under a page of white content — it is chrome, seen in a strip.
Filling half the sign-in screen with it produced a large field where the two hues meet and go
muddy, which is the opposite of what a clinic's front door should look like.

`.auth-panel` is **one hue** — the logo's azure — walked from `#0a71a9` to `#052f47` along a single
diagonal, with a soft white light-source high on the panel for depth. A single hue cannot go muddy;
it only gets darker.

### The mode switch was in the wrong place, so the transition had nothing to hold

Getting from sign-in to register was a text link at the very bottom of the form, *below* the Google
button — so somebody who arrived on the wrong one scrolled past an entire form before finding out
there was another. The two modes are peers, so they are now a segmented control at the top: it
states both, says which one you are on, and gives the swap something to actually transition
between. The two bottom links are gone, being the same action said twice in the worse place.

The swap animation is its own keyframe (`animate-auth-swap`, 320ms with a little lateral travel)
rather than the generic panel fade. A form *replacing* another form is a different motion from a
panel appearing.

The panel content was trimmed too: it carried a headline, three paragraphs and a full address
block, reading as a wall beside a five-field form. Contact details are a footnote now — and the
address **wraps instead of truncating**, because "Misamis Orient…" is not a shorter address, it is
a wrong one, and it is the only thing on the page telling somebody where to turn up.

### Large is the default text size, and the public pages lost the control

The size control was clutter on a marketing header — a utility toggle at full strength competing
with the navigation and the primary call to action. But the *reason* it existed still applies to
the people reading those pages, and they are the least likely to go hunting for a setting.

So the control is off the public header entirely, and `DEFAULT_ID` is `large`: everyone gets the
comfortable size until they say otherwise. Staff keep the control on their own consoles and the
portal, where somebody working a full shift may want the denser layout back.

Swept for overflow at the new default across Home, Services, About and sign-in at 1440 and 390,
plus all five consoles: clean everywhere.

`text-scale.spec.js` was rewritten to match — it drove the widget on a public page, which no longer
has one. The hierarchy check now arrives with a stored preference instead, since what it tests is
the CSS ramp and that has to hold where there is no widget. Its `cn()` guard is expressed against
the root size rather than a fixed 10px, so it keeps testing the token rather than today's default.

## [1.42.0] - 2026-08-24 (The type scale was being deleted on its way to the DOM)

No schema change. Frontend only. One line of real change, and it moves every screen in the app.

### What was wrong

`cn()` is `twMerge(clsx(...))`. tailwind-merge decides which of two conflicting classes wins by
parsing the class NAME against its own model of Tailwind — and it knows nothing about this
project's `@theme` block. For the `text-*` prefix it guessed wrong in the worst available
direction: `text-micro` is a font size, tailwind-merge cannot tell "micro" from a colour name,
filed it under text-colour, and then

    cn('… text-micro font-semibold …', 'text-slate-500')

resolved the two as conflicting colours and **dropped the size entirely**.

Measured on the cashier's Collections strip: the metric label asked for `text-micro` (10px) and
rendered at **16px inherited**. That is why every metric card across every console had a label
louder than the figure it labels — the component was correct, the class never arrived.

All seven custom sizes behaved this way, in every component reaching for `cn()` alongside a text
colour, which is most of `components/ui/`. Custom shadows had a quieter version of the same fault:
unrecognised, so `shadow-float` and `shadow-sm` did not conflict and BOTH applied.

### Why it appeared now

Honest accounting: [1.38.0] introduced it. The app previously wrote these sizes as arbitrary
values (`text-[13px]`), and tailwind-merge parses `[13px]` as a length and correctly files it as a
font size. Converting 85 of those to named tokens is right — `rem` tokens scale with the reader's
text-size setting and pinned pixels do not — but it walked straight into this, and the failure is
silent in both directions: the class is right there in the JSX, and the build is happy.

    text-[13px] text-slate-700   ->  text-[13px] text-slate-700    (kept)
    text-note   text-slate-700   ->  text-slate-700                (size gone)

### The fix

`cn()` uses `extendTailwindMerge` with the theme keys registered, so tailwind-merge resolves them
as what they are. Verified in both directions — `text-sm text-note` → `text-note`, and
`text-note text-sm` → `text-sm`.

Colours needed no entry: an unknown `bg-*`/`text-*`/`border-*` colour already merges correctly,
because colour is tailwind-merge's fallback guess. That is the same fallback that broke the sizes.

**Adding a token to a non-colour `@theme` namespace now means adding it to `lib/utils.js` in the
same commit**, or it works everywhere except the components that use `cn()`.

### The guard

`text-scale.spec.js` gains a case that reads the *computed* size of a real metric label off a live
console. Nothing catches this by reading source — the class is present in the JSX and absent from
the DOM — so the only honest check is measuring what the browser ended up with. Verified by
reverting `cn()` to plain `twMerge`: expected 10, received 16.

## [1.41.0] - 2026-08-23 (The palette comes off the logo)

No schema change. Frontend only.

### The identity was half the logo

Sampled from `Enlogada_Mark.png` itself rather than chosen: the artwork is **49% blue and 49%
green** by pixel area, and its single most common colour is `#0a71a9`. The UI had been built on
the green half alone — and on an approximation of it at that. Three things followed:

- **`--color-azure-*` added**, anchored on `#0a71a9` verbatim. This is the clinical half of the
  identity and it had no presence in the interface at all. It also solves an accessibility problem
  the green could not: white on `azure-500` measures **5.32:1** and passes WCAG AA outright, where
  white on the old `brand-500` was **3.59:1** and failed — the standing workaround being to reach
  for `brand-600` on public pages.
- **`--color-brand-*` re-anchored on `#53843b`**, the logo's actual green, replacing `#769046` — a
  lighter, more olive green that approximated the mark rather than matching it. Contrast improves
  from 3.59:1 to 4.44:1 as a side effect. The four remaining hard-coded `#769046` values (the RBAC
  checkbox accent, the revenue chart, the Laboratory category colour, the focus ring) moved with it.
- **`--color-marine-*`** for the logo's deep navy `#1d407d`, distinct from `--color-rail`, which is
  near-black slate and stays the app shell.
- **`.rail-gradient` rebuilt from the logo's own two colours.** It had been washing green over
  `#34466b` — a navy retired as a token months ago that survived only here, hard-coded. Five hero
  surfaces improved from that one change.

White carries the rest. It is the dominant surface on every public page, and the auth split is now
a white column against a dark one rather than grey against near-black.

### Services page: the layout was fighting the data

Three columns, one card per department. Laboratory has 22 tests and ECG has one, so the row
rendered a wall of text beside a card that was 90% empty — column height decided by whichever
department happened to have the most tests, which is not a decision anyone made.

Each department is a full-width section now and its tests flow in a responsive grid inside it. A
one-test department is one tidy row; a twenty-two-test one is a block. Added a search box, because
the list is 32 items and somebody arriving here wants one specific test and its price, and a
closing call to action, because the page answered "what does it cost" and never "so what now".

### Sign-in: a full-bleed split

It was `max-w-6xl` + `items-center`, so both columns floated in a band of empty canvas. Each half
owns its full height now. Two real bugs fell out of looking at it:

- **No branding at all below `lg`.** The reassurance panel is `hidden lg:block`, so on every phone
  the sign-in page showed nothing but a bare form — on the one screen a patient reaches before
  they have any context about who they are handing their details to.
- **A 2px horizontal scroll at 390px.** Google's button takes a pixel width only and was
  hard-coded to 360; with the page's own `px-4` that needs 392. It is measured from its slot now,
  so it matches the Sign In button at every width and cannot go stale when the column changes.

### The text-size control was wrong on a public page

It shipped as a visible segmented control — an icon and three `A`s in a bordered box — which is a
utility toggle sitting at full strength in a marketing header, competing with the navigation and
the primary call to action. It is a single icon button with a popover now: same three choices, one
click to reach them, none of the weight when nobody is looking for it. Each row in the menu is
drawn at the size it selects, so the choice previews itself.

## [1.40.0] - 2026-08-23 (Screens arrive rather than appear)

No schema change. Frontend only.

A screen fades up as it arrives, in both shells — `SidebarLayout` for staff and `DashboardLayout`
for the portal.

The whole question with this is what triggers it, because four of these consoles poll every few
seconds and a transition hung off a re-render would strobe the entire page at the poll interval.
It is keyed on the active screen instead: a CSS animation replays on mount, and that subtree mounts
on navigation and only on navigation. `SidebarLayout` already had `<ErrorBoundary key={activeNav}>`
for an unrelated reason, so the hook was there.

Measured both ways rather than assumed — parked on the polling Active Queue for 22 seconds: 0
replays. Navigating: exactly 1. Same result on the portal.

## [1.39.0] - 2026-08-23 (A button that says it is working, and a spinner that actually spins)

No schema change. Frontend only.

### The reduced-motion rule was freezing every loading spinner

`prefers-reduced-motion: reduce` applied `animation-duration: 0.01ms` and
`animation-iteration-count: 1` to `*`. On a spinner that is not a slowdown — it completes one
rotation instantly and then **stops, permanently**. Measured with the preference on, `animate-spin`
computed to `1e-05s` / `1 iteration`.

So for anyone who had asked their OS for less motion, every loading indicator in the app — the boot
screen, the patient portal, the services page, the admin panels, avatar upload — was a static ring.
Which is the single worst thing a loading indicator can be, because a frozen spinner does not read
as "loading", it reads as "hung".

`.animate-spin` is now exempted and runs at half speed instead. The exemption is deliberately
narrow and was verified as such: with `reduce` on, the spinner computes to `2s / infinite` while the
decorative `pulse-glow` is still correctly killed at `1e-05s / 1`. A progress indicator is not what
the preference is asking about — the concern is vestibular, which means large-area movement,
parallax and zoom, not a 16px ring.

### `<Button loading>`

43 buttons were each hand-rolling `{submitting ? 'Saving...' : 'Save'}`. Three problems with that:

- **The copy had drifted.** `'Saving...'` in eight places and `'Saving…'` in four — the same word
  with two different ellipsis characters, rendering side by side on different screens. Plus a
  `ConfirmDialog` that said "Please wait..." on every destructive action in the app.
- **A static string gives no sign of life**, so a slow request and a hung one look identical.
- **The label grew mid-click**, reflowing the row and moving whatever sat beside it out from under
  the cursor at the exact moment somebody was clicking.

`loading` now supplies a spinner, the disable and `aria-busy`, and **the label stays put**. It
matters most on `ConfirmDialog`, used by nine screens: that dialog confirms a refund, a
cancellation or a released report, and replacing its label with "Please wait..." threw away the one
thing the person needed to still be able to read — which of those they had just agreed to.

Converted the eight `<Button>` submit sites (sign in, register, forgot/reset password, reschedule,
patient correction, patient search, staff account creation) and normalised the remaining
hand-rolled labels onto one ellipsis character.

### Success that was indistinguishable from cancelling

A dialog that closes on success looks exactly like a dialog that was dismissed. Two did precisely
that, and both had just written something real:

- **Reschedule** now names the slot back — the only confirmation the patient gets that it took the
  time they picked rather than the one the dialog opened on.
- **Patient correction** now names the patient. It is opened from a list of forty; a bare "Saved"
  confirms nothing worth confirming.

The three HMO decisions on Service Requests also toast now. The panel did re-render with the new
status, but this is a three-step handoff — reception raises the claim, an Admin decides it, the
cashier bills on the outcome — and the person deciding needs to know the decision was *recorded*,
not merely displayed.

Left alone deliberately: `BookingDialog` already shows a confirmation screen carrying the reference
code, `WalkInRegistration` already prints the queue ticket number, and marking a notification read
should stay silent. Adding a toast to any of those is noise on top of better feedback.

## [1.38.0] - 2026-08-23 (The reader decides how big the text is)

No schema change. Frontend only.

### What was added

A three-position text size control — Normal / Large / Larger — in the staff console header, the
patient portal header and the public header, including the phone drawer. The choice is written to
`localStorage` and applied to `<html>` as a root font size before React mounts, so it survives a
reload and does not flash the default size first.

It is offered before sign-in as well as after, because the screens a patient reaches first — the
sign-in form and the booking pages — are the ones where they have no account to carry a preference
on. Percentages of the browser's own root size, not fixed pixels, so somebody who has already
raised their default in the OS keeps that as their baseline and this multiplies it instead of
quietly overriding it.

### The part that was actually load-bearing: 85 pixel-pinned font sizes

Scaling the root only works because every size in the app is a `rem`. Eighty-five of them were
not — `text-[13px]` in 46 places, `text-[15px]` in 17, and the rest — and those do not merely fail
to grow. They **invert the hierarchy**, because 13px sits between `text-fine` (12px) and
`text-sm` (14px):

        token           at 100%      at 125%
        text-fine        12px         15px      <- overtakes
        text-[13px]      13px         13px      <- pinned, now the SMALLEST
        text-sm          14px       17.5px

Three tokens were added to cover the sizes that had none (`--text-nano` 9px, `--text-note` 13px,
`--text-lead` 15px), the other pinned values already had exact token equivalents, and all 85 sites
were swapped. Every swap is the same computed pixel size at the default root, so nothing about the
app's current appearance changed — the diff is identity at 100% and only means something above it.

Nine fixed-width containers that box scaling text were converted the same way (`w-[248px]` ->
`w-[15.5rem]` for the sidebar rail, the date fields, the notification tray, the truncation caps).
The sidebar was the visible one: at Larger its labels had truncated to "Walk-In Registr…" and
"Appointment C…" because the rail was pinned while its own labels grew. Icon and divider sizes
(`w-[3px]`, `w-[13px]`) stay in px deliberately — they are decoration, and growing them with the
reading size makes the chrome heavier without making anything easier to read.

### Why this has a spec

`text-scale.spec.js`. The setting itself is easy to eyeball; the invariant is not. The 86th
pixel-pinned size will look perfect in every screenshot taken at the default size and only misbehave
for the users who changed it — which is to say, only for the people the feature exists for. The
spec asserts `fine < note < sm` at all three scales, and it was verified by injecting both failures
(a `text-[13px]` on a live element, and a px-valued token) and confirming it goes red on each.

## [1.37.0] - 2026-08-23 (Both halves of the gateway, or neither)

No schema change.

### Half-configured meant charging a patient and recording nothing

`isConfigured()` tested `PAYMONGO_SECRET_KEY` alone, while `verifyWebhookSignature` verifies
against `PAYMONGO_WEBHOOK_SECRET` — a different value, from a different screen in PayMongo's
dashboard, displayed once when a human creates the webhook.

With the key set and the webhook secret blank: the UI offered GCash, the patient really was
charged, every delivery was rejected 401 through PayMongo's entire retry schedule, the payment
stayed `Pending`, the visit was never released, and nobody was notified. Money taken, nothing
recorded, and no error surfaced anywhere. Having one secret and not the other is the ordinary way
to get this wrong, not an exotic one — they are obtained at different moments.

`isConfigured()` now requires both, so the half-configured state simply leaves online payment off
and the clinic keeps taking counter payments, which is a supported and documented configuration.
`startupAdvisory` names the missing half at boot; it is not a startup failure, because refusing to
boot over a payment option would take the whole clinic down to report something the front desk
works around all day.

### A card that said two things at once

`BookingPass` rendered "Payment due at the counter" gated on `is_paid` alone, so with the gateway
on it appeared on the same card as the Pay with GCash buttons. Now gated on there being no online
option.

### Activation is configuration, verified

Audited end to end: no feature flag, no hardcoded `false`, no commented-out route, and the raw-body
handling the HMAC needs is already mounted app-wide ahead of the routes. Every activation step is
`.env`, infrastructure, or an action inside PayMongo's dashboard — the ordered list is now in
CLAUDE.md. The only step no code can take is creating the webhook itself.

---

## [1.36.0] - 2026-08-22 (The clinic's clock is 12-hour)

No schema change. Display only — every stored time stays 24-hour.

`scheduled_time` is a Postgres TIME, the availability grid emits zero-padded `"HH:MM"`, and the
reschedule endpoint validates that shape, so formatting happens on the way into a sentence and
never on the way into a query or a response field. `formatTime12` in `frontend/src/lib/date.js`,
mirrored by `backend/src/constants/clockFormat.js`.

Written out rather than routed through `toLocaleTimeString` for two reasons: the stored value is a
bare `"HH:MM"` with no date and `new Date("09:30")` is Invalid Date, so a Date would have to be
fabricated around it — which is where UTC-vs-local errors get in; and `hour: 'numeric'` renders
24-hour on an en-GB browser, so the clinic's clock would have depended on a machine's regional
settings. Midnight and noon are the cases a hand-rolled version gets wrong (`h % 12` renders both
as `0`); both are covered.

### The backend was quoting a different time from the screen

`appointmentEmailService`'s `readableTime` was `.slice(0, 5)`, so the confirmation email said
`09:30` while the appointment card said `9:30 AM` — one appointment, two times. Four notification
and audit strings had the same split. All now share the formatter.

### Five locale sites were not 12-hour at all

`Receipt.jsx`, `ResultsTab.jsx`, `AdminDashboard.jsx` and `formatDateTime` used
`hour: '2-digit'`/`'numeric'` with an undefined locale, which is 12-hour on en-US and **24-hour on
en-GB**. Pinned with `hour12: true`.

### Tests decoupled from presentation

`reschedule-ui.spec.js` clicked a slot button by its rendered label and `hmo-card-review.spec.js`
matched an anchored `/^\d{2}:\d{2}$/`. Slot buttons now carry `data-testid={`slot-${time}`}` with
the 24-hour value and the tests select on that — the same rule CLAUDE.md states for class names,
applied to text. Also fixed `CheckInPanel`, the one site that had been rendering `09:00:00`.

---

## [1.35.0] - 2026-08-22 (A booking holds its slot; it does not take it)

Run `node src/scripts/migrateSlotHold.js` (`--rollback` reverses it).

### What was broken

`POST /appointments` writes the appointment before payment is ever discussed, and capacity was
`status <> 'Cancelled'` and nothing else — no capacity query joined `payments`. A slot was taken
the instant a booking existed, paid or not, and exactly one thing could give it back: a human
cancelling it.

So a patient who opened GCash and closed the tab held 11:30 **forever**. Nothing released it:
there is no cron or scheduler in this project, none of the three retention passes touches
`appointments`, `cancelPendingGatewayPayments` updates the `payments` table alone, and the webhook
understands only `checkout_session.payment.paid` — a failed or expired session is answered with
`{ handled: false }` and 200. `cleanE2eData.js`'s own header already recorded the consequence:
every bookable day filled within three days of test runs.

### One nullable column, and NULL means permanent

`appointments.held_until`. Nothing is back-filled, so every existing booking keeps meaning exactly
what it meant. Only a **client's own self-pay booking awaiting online payment** is provisional; the
three exclusions are each a case where the booking is already real — a staff booking (the patient
is at the desk), an HMO booking (settled at the clinic by design, so it must never be conditional
on an online payment that will never happen), and a clinic with no gateway configured (the
instruction is "pay at the counter", and a slot expiring while the patient travels in would be
worse than the bug being fixed).

**Note the consequence of that last one: with no `PAYMONGO_SECRET_KEY` the hold never engages and
every booking is permanent, exactly as before.** It becomes live when a real key is configured.

### Expiry is evaluated at READ time, not swept

There is no reaper job and adding one would be worse: a sweeper reopens the slot at the next sweep
rather than when the hold ends, which is the same bug with a shorter fuse. `held_until >
CURRENT_TIMESTAMP` sits in the capacity predicate, so the slot returns at the exact instant the
hold lapses, with nothing scheduled that can fail. The abandoned row is left as the record of an
attempt rather than deleted.

The predicate lives in `src/constants/slotHold.js` because **three** queries answer "is this slot
taken" — the availability grid, the booking-time check and the reschedule-time check. They agreed
before only by spelling the same string three times, and a term added to two of them is how a
patient is shown a free slot and then refused it.

### Paying after the hold lapsed

`confirmHold` is unconditional on the hold still being alive. If the patient took longer than the
window and the slot was resold, the money has still moved — refusing to honour the booking does not
give it back, the same reasoning `forceSettleGatewayPayment` is built on. The appointment stands
and staff are notified that the slot is overbooked.

Hold window: 15 minutes, refreshed each time checkout is reopened, so a patient who is actually
paying never loses their slot to the clock — only one who has stopped.

---

## [1.34.0] - 2026-08-22 (A calendar the app actually owns)

No schema change.

### Why the native picker had to be replaced rather than styled

The calendar behind `<input type="date">` is drawn by the browser outside the document, so no CSS
reaches it. Replacing it is the only way to change it.

What was NOT replaced is the important half: the `<input type="date">` stays. The value remains a
bare ISO `YYYY-MM-DD`, so every caller, form and test that reads or fills it is unchanged; `min`
and `max` keep being enforced natively as a backstop; `required` keeps participating in form
validation; and on a phone tapping the field still opens the OS picker, which beats a 280px grid
at 390px. All 17 date inputs migrated — 4 birthdates (month/year dropdowns, and `max=today`, which
none of them carried, on a field that re-interprets released results), 1 booking picker, 12 range
filters (which got Today / Last 7 / Last 30 presets, usually the actual question).

### Firefox: the glyph cannot be hidden, so we stay out of the way

Measured in Firefox 153, not assumed: `::-moz-calendar-picker-indicator` and
`::-moz-calendar-button` are both **discarded by the parser** as unrecognised selectors, and
`appearance: textfield` leaves the glyph untouched. Mozilla bugs 1830890 and 1812397 are open.
Covering it was tried and rejected too — Firefox draws its glyph inline after the date text
(~x=380 in a 150px field), not flush right where our trigger sits (x=405).

So: where the glyph can be removed we own the picker completely; where it cannot, `DateField`
renders nothing custom and the field behaves exactly as the browser intends. One icon either way.
Feature-detected via `CSS.supports('selector(::-webkit-calendar-picker-indicator)')`, never
sniffed — Playwright's Firefox reports an *AppleWebKit* user-agent, so a UA test answers this
question wrongly on the very browser it is about.

### Escape closes the innermost thing

Radix registers its Escape handler on the document in the CAPTURE phase when a dialog mounts —
before any popover inside it exists — so a later listener can never run first, whatever phase it
uses. One press therefore closed the whole booking dialog while a calendar was open on top of it.
Radix skips its own dismiss when the callback defaultPrevents, so `DialogContent` now defers while
`[data-datefield-open]` is present. Covered in `mobile-patient.spec.js`.

### Clicking the field opens the calendar

`onClick`, deliberately not `onMouseDown` + `preventDefault`: preventing the default is what would
stop the caret being placed and the segment selected, which is the typing this is meant to leave
alone. Gated to `pointer: fine`, so a phone keeps its OS picker rather than stacking two.

**Accessibility cost, stated rather than hidden:** ARIA in HTML permits no `role` and no
`aria-expanded` on `input type=date`, and the APG combobox pattern that carries them requires
`type="text"` — which this design rejects for the four reasons above. A screen-reader user
clicking the field would otherwise get a dialog opening silently. A polite live region announces
it. That is mitigation, not a cure; icon-only opening is the stricter alternative, and is what
Firefox itself concluded in bug 1804879.

### Fixed on the way through

- `AddProfileDialog` and `EditProfileDialog` both rendered `id="clientdashboard-birthdate"` — two
  dialogs, one DOM id, making `htmlFor` ambiguous.
- Two Per-Staff Workload inputs on Reports had no accessible name at all: no label, no
  `aria-label`, no id.
- `ticket-release-gating.spec.js` probed "tomorrow" with `toISOString()`, the UTC bug this project
  documents. Before 08:00 Manila that returns today; after, tomorrow. Run on a Saturday it probed
  Sunday, the one closed day, and three release-gating tests skipped — silently, reported only as
  "3 skipped". It now probes forward for a day the clinic is actually open.

---

## [1.33.0] - 2026-08-22 (Only the methods the clinic can settle)

Run `node src/scripts/migratePaymentMethods.js` (`--rollback` restores the previous vocabulary).

### PayMaya is gone

The clinic owner holds no PayMaya merchant account, so offering it was offering a way to pay
that nobody could collect. Removed from the counter buttons, the online gateway, the e-wallet
bucket and `chk_payment_method`.

### The migration refuses rather than converts

A CHECK constraint cannot be narrowed while a row violates it, and there are exactly two ways
past that — one of them is rewriting a receipt to claim it was paid by a method the patient did
not use. Which method a real receipt should say is not a question a script can answer, so it
names the offending rows and stops. Same stance `migrateClaimIntegrity.js` takes on two live
claims for one test.

**`NOT VALID` is the wrong tool here**, and specifically dangerous. It skips the initial scan but
Postgres still enforces the constraint on every later UPDATE:

- A `'Pending'` gateway row for a PayMaya checkout started before the change. PayMongo delivers
  `checkout_session.payment.paid`, `markGatewayPaymentPaid` UPDATEs, the CHECK re-evaluates
  against the new row version and raises `23514`. Only `23505` is caught, so the webhook 500s,
  PayMongo redelivers, and it fails identically forever — the patient charged, no receipt. Worse,
  `getNextReceiptNumber()` runs *before* that UPDATE and the counter never rewinds, so every
  redelivery burns a receipt number: a widening gap in the official sequence, which is the exact
  thing `daily_counters` exists to prevent.
- A historical `'Paid'` PayMaya receipt a cashier later needs to reverse. `updatePaymentStatus`
  is an UPDATE; same violation, and the refund becomes impossible.

So: no violating row, or no migration. Verified by running it against the seeded data first — it
refused, named all nine receipts, and changed nothing.

### One vocabulary, not six

`backend/src/constants/paymentMethods.js` is now the single definition, and the CHECK constraint
is built from it. It previously lived in six places that had no way of knowing about each other:
an inline SQL literal in the summary's e-wallet bucket, a hard-coded JSX array in the cashier
terminal, a caption string, the gateway map, `schema.sql`, and two seeder rotations.

Restoring PayMaya later is one line in that constant, one in `frontend/src/lib/paymentMethods.js`,
and `migratePaymentMethods.js --rollback`. The module asserts at load that every method lands in
exactly one cash-up tile and that every gateway key is a valid method — the first because the
Cash/E-Wallet/Bank tiles are asserted to sum to the collected total, the second because a gateway
key is written straight into `payments.payment_method` and would otherwise violate the constraint
at settlement, after the patient had been charged.

### A Method filter on Cashier Monitoring

Applied in SQL, filtering the list **and** the summary. Filtering in the browser would have been
one line and wrong: the per-cashier cards reduce the row list, and they sit in the same grid as
`summary.collected`, which is aggregated over the whole range — so a client-side filter moves one
and not the other. `lib/collections.js` records that mismatch shipping on this screen once
already. An unrecognised method is rejected with 400 rather than ignored: on a money screen,
silently returning everything reads as "the clinic took nothing that way".

### A booking can no longer be made in the past

`SlotPicker` has carried `min={todayStr()}` all along, but that is a browser hint — it does not
survive a typed value everywhere, and it does not exist for anything talking to the API. Nothing
on the server compared the date to today, so `POST /appointments` would create a real visit and a
real appointment for last week, occupying a slot on a day that has already happened. Guarded now
on all three paths that matter: create, reschedule (the only other writer of `scheduled_date`),
and availability — which answers "closed" for a past day so the screen never offers a slot the
API would refuse.

Inclusive of today: the elapsed part of today is already handled in `getAvailableSlots`, and
refusing today outright would refuse a walk-in booked for this afternoon.

---

## [1.32.0] - 2026-08-22 (The other half of the cash book)

No schema change. `migrateRefundTimestamp.js` gained a better backfill and is safe to re-run —
it corrects a fabricated date in place — but nothing new is added to any table.

### The fix landed in one of two repositories

[1.30.0] moved `paymentRepository` to a period cash book and left `reportRepository` on
`payment_status = 'Paid'` over a `paid_at` range. Two consequences, and the second is worse than
the first:

1. **They disagreed about the same day.** One 550.00 receipt paid and reversed today: the
   cashier's strip read 550.00 collected, the operations report's "Takings" panel read 0.00.
2. **The regression [1.30.0] is named for survived in the half that gets PRINTED.** `getBillingTotals`
   still bucketed everything by `paid_at`, so reversing an older receipt still silently reduced a
   day that had already been printed and filed.

`getRevenueTrend`, `getPaymentMethodBreakdown` and `getSalesByService` restated closed days the
same way. All four now read their predicates from `src/constants/moneyRange.js`, which
`paymentRepository` also uses — one definition, because two drifted apart within a single commit
of each other.

`getSalesByService` had to move in the same change as `getBillingTotals`: `operations-report.spec.js`
asserts the sum of that breakdown reconciles to the collected figure, and two bases break it the
moment anything is reversed.

### Two coupled defects in `getBillingTotals`

- No `receipt_number IS NOT NULL`.
- `refunds`/`refunded` counted `'Refunded'` only, so a receipt a staff member VOIDED — status
  `'Cancelled'`, a real reversal — was reported by the cashier's summary and by nothing at all
  here. Its amount also fell out of `collected`, under-reporting both sides at once, and the panel
  hides the stat when it is zero: a day of nothing but voids showed no reversal at all.

They cancelled, which is why neither was visible. Fixing either alone makes abandoned gateway
checkouts — money never taken — report as refunds. One change, not two.

### Backfilled from the audit trail

[1.30.0] set `refunded_at = paid_at` for existing reversals, recorded at the time as a real gap
because `payments` has no `updated_at`. But `audit_log` carries a `payment.refunded` /
`payment.cancelled` entry for every reversal, and its `created_at` is the real moment — reading it
states nothing new, it moves a fact from the table that recorded it to the table that needs it.
Retention is ~7 years for non-PHI actions (`pruneAuditLog.js`), longer than any cash-up looks back.

Two passes now: the audit trail first, then `paid_at` for whatever it cannot account for, with the
counts reported separately so the difference is never invisible. The pass also **corrects** a row
already carrying the fabricated date (`refunded_at = paid_at` exactly — never true of a real
reversal), which closes the round-trip weakness noted in [1.30.0]: rolling back and reapplying used
to overwrite a true reversal date permanently.

### A resurrected receipt counted as money returned, forever

`forceSettleGatewayPayment` flips a `'Cancelled'` row back to `'Paid'` when the patient completed a
checkout we had written off. It did not clear `refunded_at`, and the `reversed` figure keys on
`refunded_at IS NOT NULL` *without* testing `payment_status` — so the receipt was reported as
handed back on a day it was actually taken, for as long as the row existed.

### The cross-day case finally has a test

Every test in `cashup-reversals.spec.js` settled and reversed inside one test body, so both dates
landed on the same day — the case that was never broken. Reaching the broken one needs a receipt
older than today, which no API can produce. `backend/src/scripts/e2eBackdatePayment.js` ages one,
refusing anything that is not an E2E-created receipt and refusing to run under
`NODE_ENV=production` at all. Verified the new test fails against the pre-[1.30.0] semantics before
trusting it.

### Getting the correction onto a database that already ran [1.30.0]

There is no automatic path, and that was checked rather than assumed: this project has no
migration ledger table, no npm lifecycle hooks, no nodemon config, no active git hooks, and
`server.js` opens a port and nothing else. Running the backfill at boot was the obvious idea and
is the wrong one — `audit_log` has no index on `action`, the backfill aggregates over every
'payment'-typed row in a table documented as reaching ~300,000 rows a year, the migration scripts
use `db.pool.connect()` under a stated assumption that they run alone, and `statement_timeout` is
15s. This file already records what happened the one time schema work hid inside a script that ran
for another reason.

So the cheap half of the question is asked at boot and the expensive half is not.
`src/config/startupAdvisory.js` counts rows where `refunded_at = paid_at` to the microsecond — the
signature of the old backfill, never true of a real reversal — and logs the command to fix them.
It touches only `payments`, uses the partial index so it scans reversals alone, never throws, and
says nothing when there is nothing to say.

The instruction in CLAUDE.md also moved. It sat inside the migration block, under a header scoping
that block to "any database created before [1.29.0]" — so the databases this applies to, which are
by definition newer, would correctly skip past it. It is now stated above that gate.

### Screens

`counted_in_collected` is now returned per row, because which rows make up `collected` depends on
the range and only the query knows it: the list matches on **either** date, so it holds receipts
taken earlier and only reversed inside the range. `lib/collections.js` reads that flag — its
`payment_status === 'Paid'` test was wrong in both directions and made two breakdowns sum to
`collected - reversed` while a card in the same grid showed `collected`.

Two captions asserted the opposite of what the code now does and were corrected: "Receipts
Settled … N more issued, then reversed" (they are counted, and on a same-day reversal they are not
"more"), and Cashier Monitoring's "not in collections". A **Net in Drawer** figure was added to the
collections strip and the shift panel, shown only when something was reversed: `reversed` is
reported beside `collected` and never subtracted from it, which left the cashier doing that
subtraction in their head against the cash in front of them.

---

## [1.31.0] - 2026-08-21 (One live claim per test; a dead column removed)

Run `node src/scripts/migrateClaimIntegrity.js` on any database created before this version
(`--rollback` reverses it).

### One live claim per test

`uq_hmo_request_visit_test (hmo_request_id, visit_test_id)` stopped a test being listed twice
inside **one** claim. Nothing stopped the same test being claimed by two **different** requests,
and `hmoService.createRequest` does not check either — two Pending claims, or a Pending beside an
Approved, were reachable through the ordinary UI.

That is not cosmetic. `paymentRepository.getBillingSummary` reads coverage with a correlated
subquery *specifically* to survive it: a plain LEFT JOIN would duplicate the line item and inflate
the bill subtotal. The schema permitted a state the biller had to defend against at read time.

The new index is deliberately **partial**, not absolute:

```sql
CREATE UNIQUE INDEX uq_hmo_one_live_claim_per_test
    ON hmo_request_tests (visit_test_id)
 WHERE approval_status <> 'Rejected';
```

"One claim per test, ever" would have been wrong. If a provider refuses, re-claiming the same test
with a second provider is legitimate and is what a patient carrying two cards expects. Rejected
rows stay free to accumulate because each carries a reason and a decider [1.27.0] — the answer to
"why am I being charged for this".

Verified in both directions before shipping: a second live claim while the first is Pending is
refused by the new index; a fresh claim once the first is Rejected is accepted.

The correlated subquery stays. A refused claim and its retry can coexist, so "exactly one row per
test" is still not something a JOIN may assume.

The migration refuses to run if any test already carries two live claims, naming them, rather than
picking one — which of two claims is real is a question for the HMO coordinator, and choosing here
would quietly decide who pays.

### Removed: `test_results.file_url`

Superseded by `file_path` when result files stopped being served statically and started streaming
through an authenticated, ownership-checked route. Carried since as a "nullable legacy fallback",
populated in **0 of 42 rows**, while still being selected in four queries, branched on in
`resultService`, and accepted as a field on the release endpoint — dead weight that read as a live
alternative to whoever met it next. The whole thread is gone: controller, service, repository.

The rollback restores the column but not its contents, which is honest rather than lossy: there
were none.

---

## [1.30.0] - 2026-08-21 (A reversal has its own date)

Run `node src/scripts/migrateRefundTimestamp.js` on any database created before this version
(`--rollback` reverses it).

### The problem

`payments` carried `refund_reason` but no timestamp, so a reversal had no date of its own and the
cash-up could only bucket it by `paid_at` — the day the money came **in**. Reversing a receipt
from an earlier day therefore did two wrong things at once. Measured against the seeded data
before the fix, reversing a ₱550.00 receipt paid on the 19th, on the 20th:

| | before | after |
|---|---|---|
| 19th `collected` | 4,830.00 → **4,280.00** | 4,830.00, unchanged |
| 20th `reversed` | **0.00** | 550.00 |

The first row is the worse of the two. Restating a closed day means yesterday's figure changes
after yesterday ended, so the cash-up sheet in the drawer and the screen disagree and neither is
wrong — there is no date on which the clinic can say what it took.

### The model

A period cash book, which is what a daily drawer is:

* `collected` — money taken **in** during the range, bucketed by `paid_at`, counted whatever
  happens to the receipt later.
* `reversed` — money handed **back** during the range, bucketed by `refunded_at`.
* the drawer — `collected - reversed`. Reported as two figures, never one: netting hides that a
  reversal happened, and a drawer short by a refund needs the refund named.

A receipt paid and refunded on the same day reads as 550 in and 550 out rather than as nothing
having happened, which is what the drawer actually did.

### Added
* `payments.refunded_at TIMESTAMP` — set on the way **into** `'Refunded'`/`'Cancelled'` and only
  once, so a status change cannot move a reversal to a later date.
* `idx_payments_refunded_at` — partial, `WHERE refunded_at IS NOT NULL`. Almost no payment is ever
  reversed, so the rest have no business in this index.

### Changed
* `findTransactionSummary` buckets collections and reversals on different columns (above).
* `findTransactions` matches the range on **either** date, so a receipt paid on the 19th and
  reversed on the 20th appears in both days' logs — as an issued receipt in one and as the
  reversal the cashier processed in the other. Without this the summary reported a `reversed`
  figure with no row behind it.

### Backfill
Existing reversed rows get `refunded_at = paid_at`. That is a guess and deliberately the
conservative one: it reproduces exactly what those rows did before, so no historical figure moves
when the migration runs. `payments` has no `updated_at` to do better with.

---

## [1.29.0] - 2026-08-18 (Index what grows; stop maintaining what nothing reads)

Run `node src/scripts/migrateIndexHygiene.js` on any database created before this version
(`--rollback` reverses it).

### Measured, not guessed
Against a same-shaped `audit_log` of 300,000 rows in a throwaway schema — roughly a year for this
clinic, since [1.19.0] made `audit_log` record PHI **reads** as well as writes:

| query | before | after |
|---|---|---|
| activity log, newest page | 87.3 ms (2 seq scans) | **0.9 ms** (0) |
| everything one member of staff touched | 58.0 ms (1 seq scan) | **5.8 ms** (0) |

The second is the query a breach investigation runs, and it is the reason the audit log exists.
At demo scale both are under a millisecond either way — which is precisely why this was measured
at volume rather than on the seeded data.

### Added
* Indexes on 11 foreign keys, all on tables that grow with clinic activity: `audit_log.actor_id`, `payments.processed_by`, `patient_visits.created_by` / `.discount_type_id` / `.discount_granted_by`, `patients.patient_type_id`, `test_results.critical_acknowledged_by` / `.superseded_by`, `hmo_requests.hmo_provider_id` / `.decided_by`, `hmo_request_tests.decided_by`.

### Removed
* `idx_audit_log_created_at` — duplicates `idx_audit_log_created`. A B-tree is scannable in both directions, so the ASC index already serves `ORDER BY created_at DESC`; confirmed by building the case in a scratch schema and reading the plan.
* `idx_payments_status` — duplicates `idx_payments_status_paid_at`, whose leading column is `payment_status`; confirmed the same way.

Both sat on growing tables, so each was charging a write on every audit entry and every payment to
serve reads another index already covered.

### Changed — two list endpoints now page at the database
* `GET /visits/history` and `GET /payments/transactions` accept `page` and `limit` and return `total` / `totalPages`. Both returned **every row in the range**; Visit History then rendered all of them with no footer at all, and Transaction History sliced fifteen out in JavaScript. Measured at 664 bytes a visit and 570 a payment, a year-wide range is a **3.6 MB** and a **2.0 MB** response respectively — to fill a fifteen-row table, on screens that poll. Page one now stays ~16 KB and ~8 KB whatever the range.
* `limit` is optional on both, so the callers that legitimately need the whole set — today's collections total, the cashier's metric strip, the sales-by-service report — are unchanged.
* `GET /appointments` and `GET /hmo/requests` page the same way — smaller (664 KB and 648 KB projected at a year) but the same shape: fetch everything, show fifteen.
* **`/auth/me` was checked and deliberately left alone.** It is polled every 60s per signed-in user — 1.8M calls a year — but it already answers a matching `If-None-Match` with a 0-byte 304, so the bandwidth is nil after the first call. The remaining cost is ~2.9 ms of database time per call, about 87 minutes a year, and removing it would mean caching permissions server-side against the documented guarantee that a permission change reaches a signed-in user within a minute. Not a trade worth making.

### Fixed
* `visitService.getVisitHistoryByDateRange` defaulted its dates with `new Date().toISOString().slice(0, 10)` — the **UTC** date, which in Philippine time is *yesterday* between midnight and 08:00. Opening Visit History early in the morning showed the previous day's visits and called them today's. The default is now `COALESCE($1::date, CURRENT_DATE)` in SQL, which is the server's local date and what every other date filter here compares against. CLAUDE.md records this bug shipping twice before; this was the third place.

### Deliberately NOT indexed
`user_roles.assigned_by`, `role_permissions.permission_id`, `user_permissions.*`,
`user_departments.*`. These are bounded by the number of staff and the number of permissions — a
couple of hundred rows that never grow with patient volume — and on a table that fits in a page or
two a sequential scan beats an index lookup. Indexing them would buy nothing and be paid for on
every write, which is the same mistake as the two indexes removed above.

---

## [1.28.0] - 2026-08-18 (The claim gets decided, and somebody is told)

Run `node src/scripts/migrateHmoClaimDecision.js` on any database created before this version
(`--rollback` reverses it, destroying the reasons and member numbers — it warns and counts first).

### Added
* `hmo_requests.decision_reason` (TEXT), `.decided_by` (FK → `users`) — why a claim was turned down and who recorded it. No `decided_at`: `approved_date` already holds that fact, and two timestamps that must agree eventually will not.
* `hmo_requests.member_number` (VARCHAR 100) — the patient's number with the provider. It had **nowhere to live**: the API accepted `memberNumber` and silently discarded it, so the number was legible only by opening the card photo — and `pruneHmoCards.js` deletes those after 180 days by design, while the claim itself is kept for seven years.
* `idx_hmo_requests_pending`, partial (`WHERE status = 'Pending'`) — the set the approval worklist opens on.
* `PUT /api/hmo/request/:id/reject` — same permission as approving. Saying no is the same authority as saying yes, and splitting them would let an account do one but not the other.

### Changed
* **A claim can now be turned down.** `chk_hmo_status` has allowed `'Rejected'` since [1.0.0] and no route could set it, so a claim the provider refused had two outcomes in practice: approve it anyway, or leave it Pending forever — at the top of a worklist that filters on Pending, being reopened by every coordinator who scanned it. A refusal requires a reason.
* **Deciding a claim notifies the Cashier and Receptionist.** This was the missing step in the clinic's own workflow: reception raises, an Admin decides, the cashier bills what is left — and nothing connected the second to the third. Admins are not notified; they are the ones who just decided it. The message names the patient, not the claim id, because "Maria Santos — MediCard approved" is actionable at a counter and "HMO request #482" is a lookup.
* **A claim is decided once** (409 otherwise). Approving an already-rejected claim silently overwrote the refusal and its reason — the only record of why the patient was charged.
* **The approval worklist names the patient.** It carried provider, date and a count, so several claims from one provider on one day were identical rows and the only way to learn whose insurance you were approving was to open each in turn. It now also counts refusals, not just approvals: `1 / 2` could not distinguish a half-decided claim from one whose other half was refused.
* **Reception collects the member number and the LOA code as separate fields.** One box labelled "Card / LOA Number" wrote both into `approval_code` — the column an Admin fills on approval — so a member number was filed as an approval code against a claim nobody had approved.

---

## [1.27.0] - 2026-08-18 (Why the HMO said no)

Run `node src/scripts/migrateHmoDecisionTrail.js` on any database created before this version
(`--rollback` reverses it, destroying the reasons — it warns and counts first).

### Added
* `hmo_request_tests.decision_reason` (TEXT), `.decided_by` (FK → `users`), `.decided_at` — all nullable, nothing back-filled. A decision taken before today has no honest answer, and manufacturing one would put a false statement in the audit trail.
* `idx_hmo_request_tests_pending`, partial (`WHERE approval_status = 'Pending'`) — the only set anything queries in bulk. Decided rows are the overwhelming majority and are read one claim at a time, by id.
* `GET /payments/bill/:visitId` now reports `hmoPendingCount` / `hmoPendingAmount`, and each line item carries `hmoRejected` / `hmoDecisionReason`.

### Changed
* **A rejection now requires a reason**; an approval stores none. The refusal is the whole point of the record — an approval explains itself, a refusal is a conversation at the counter about money the patient was not expecting to pay. Until now that explanation lived only in whatever the coordinator remembered, so a dispute three days later had no answer.
* **An unrecognised decision word is a 400 that names the alternatives, not a 500.** The value went straight to `chk_hmo_request_tests_status`, so `'Denied'` — the word the providers themselves use, and therefore the first one any caller reaches for — surfaced as an unexplained server error.
* **A decision on a test that is not on the claim is a 404.** It returned 200 with an undefined body: the caller was told the decision had been recorded when no row had been touched.
* **The cashier's bill shows the refusal reason on the line it applies to,** and warns when part of the bill is riding on an undecided claim. An undecided claim covers nothing, so those tests are charged at full price — take the payment and the approval lands tomorrow, and the clinic owes a refund. Reported rather than blocked: some providers take days, and the patient cannot wait at the counter for one.

### Why
* An HMO decision moves money between the patient and the insurer, and this was the only such action in the system that could not say who recorded it. A payment names the cashier, a released result names the authoriser, a permission change names the SuperAdmin.

---

## [1.26.0] - 2026-08-17 (What happens after the money moves and the report goes out)

No schema change — every fix here is a query, a guard or a status transition. Recorded because
each one changes what the tables end up holding.

### Changed
* **A refund now recalls the visit from the modalities.** `visitRepository.recallVisitFromModalities` returns tests still in `Processing` to `Pending` and resets the visit — but only when no work has been done. A ticket already at `Waiting for Release` or `Completed` is left alone, because the work exists and the record of it must not be erased by a billing action.
* **A refund now requires a reason** (≥4 characters), recorded against the operator's account.
* **`findVisitReleaseStateByVisitTestId` also returns `vt.status`.** Two rules below need to distinguish "the report has gone out" from "the visit happens to be closed", and only the test's own status says that.
* **The result read guard is now separate from the write guard.** `assertStaffMayReadVisitTest` checks department scope only; `assertStaffOwnsVisitTest` additionally requires the ticket to have been released. Both reads (`getResultByVisitTestId`, `getVersionHistory`) were using the write guard, so the technician who produced a report lost access to it and to its version history the instant the visit completed.
* **The write guard accepts `Completed` as well as `Processing`.** A visit completes when its last result is released, so refusing writes from that moment made amending a released result impossible — which is the one thing result versioning [1.15.0] exists for, since a correction is nearly always found after the report has gone out. The alternative in practice was editing the row by hand, which keeps no history at all.
* **An amendment reason is required once the report has been released,** and only then. Re-saving a ticket still at `Waiting for Release` is drafting; demanding a justification for fixing your own typo fills the reason box with "typo" until it means nothing. The audit entry for a released amendment could previously read "no reason given" against a corrected medical report.
* **Amending a released result reopens the visit to `Processing`.** The ticket returns to `Waiting for Release`, but the modality worklist filters on `pv.status = 'Processing'` and the Released tab filters on `vt.status = 'Completed'` — so the amended ticket appeared on neither. The correction was accepted, shown as saved, and then reached nobody: the patient and the referring physician kept the wrong report. `releaseResult` closes the visit again once the corrected version goes out.

### Added
* `GET /api/results/critical/outstanding` — every released critical result still awaiting its callback. Deliberately **not** department-scoped: a potassium of 7.4 belongs to whoever can act on it, not to the room that produced it. Until now the only sign of a panic value was a badge on one department's worklist row, so one flagged near the end of a shift had nobody watching it.

---

## [1.25.0] - 2026-08-17 (Reminding people to turn up)

### Added
* `appointments.reminder_sent_at` — when the day-before reminder went out; NULL means it has not. One column, because the only thing the sweep needs to remember is whether it has already handled a row.
* `idx_appointments_pending_reminder`, partial (`WHERE reminder_sent_at IS NULL AND status = 'Pending'`) — which is exactly the query the job runs. Most rows are historical and already handled, so indexing them would be dead weight.

### Why
* `appointments.status` has carried 'No Show' since [1.0.0], so the clinic was already counting the problem and had nothing to do about it. A no-show is a slot that earns nothing and cannot be reassigned, because by the time you know, the day is gone.
* The reminder is also where the preparation instructions from [1.24.0] actually land. "Nothing to eat or drink except water for 8 hours" is actionable the evening before; at the moment of booking, possibly three weeks earlier, it is forgotten by definition.

### The design that matters
* **Safe to re-run, which is what makes it safe to schedule.** Rows are stamped once handled and the query only selects unstamped ones, so running it hourly is harmless. A job that cannot be run twice is one nobody dares automate, so it gets run by hand — which is to say not at all.
* The stamp is written even when the patient has **no email address**. A walk-in registered at the desk has no account; that is a permanent condition, not a transient failure, and leaving it unstamped would re-examine the same unreachable rows every night forever.
* It is **not** written when the send itself errors, so a transient SMTP failure is retried on the next run.
* Only 'Pending' appointments. 'Confirmed' means the patient is already checked in, and Cancelled / Completed / No Show are finished — reminding any of them is worse than not reminding.
* "Tomorrow" is never used in the copy. The job accepts any `--days` offset, and an email sent at 23:50 and read at 00:10 means two different dates to writer and reader. It names the day.
* Dates are computed in SQL (`CURRENT_DATE + `), per the standing rule: building "tomorrow" from a JS Date gives the UTC day, which in Philippine time is wrong every morning before 08:00.

### Migration
* `node src/scripts/migrateAppointmentReminders.js` — additive, idempotent, one transaction.
* Reversible, and the rollback is **safe**: it loses only the record of which reminders were sent, so the worst consequence is a patient reminded twice.
* Schedule `sendAppointmentReminders.js --confirm` daily in the evening.

---

## [1.24.0] - 2026-08-17 (Telling the patient what to do)

### Added
* `tests.preparation` — what the patient must do beforehand: fast for eight hours, arrive with a full bladder, stop a medication. Free text, written by clinical staff in the words they already use with patients. NULL means no preparation is needed, which is true of most Laboratory tests, so nothing is back-filled and the UI renders nothing rather than an empty instruction.

### Why
* A patient booking a Fasting Blood Sugar online was told nothing, anywhere — not on the services page, not while choosing tests, not on the confirmation, and not by email, because no booking email existed. They arrive unable to be tested, the slot is wasted, and the front desk absorbs the conversation. It is the most expensive kind of defect in a clinic system because the cost lands on the patient, the schedule and the staff at once, and among the cheapest to fix: the information existed and had nowhere to live.

### Also in this release (no schema change)
* **Booking confirmation, reschedule and cancellation emails.** The system previously sent exactly two emails — password reset and result release. Booking online produced an in-app notification for *staff* and nothing for the patient, so the only record was a confirmation screen that vanished with the tab, taking the reference the front desk asks for. `appointmentEmailService` sends all three; every one carries the reference, and the confirmation carries the preparation instructions, because that is the message the patient still has on the morning of the appointment.
* All three are sent after their transaction commits and cannot fail the operation: `sendEmail` swallows SMTP errors and each call site wraps it. A clinic with no SMTP configured gets a logged skip and a working booking.
* A walk-in registered at the desk has no account and no address; that is a quiet skip, not an error.

### Migration
* `node src/scripts/migrateTestPreparation.js` — additive, idempotent, one transaction.
* Reversible with `--rollback`, which **destroys the instructions** — this column is their only home. The script counts and warns before dropping, like [1.23.0].

---

## [1.23.0] - 2026-08-17 (The doctor who requested the test)

### Added
* `patient_visits.referring_physician` / `referring_physician_prc` — the requesting doctor, and the PRC licence number that makes the name unambiguous. On the visit, not the patient: a referral belongs to one episode of care, not to the person forever.
* `idx_patient_visits_referring_physician`, partial (`WHERE referring_physician IS NOT NULL`). Most visits have none, so a full index would be mostly dead weight; this answers "which visits did Dr. X send us", which is the question the data will actually be asked.
* `appointments:reschedule` was seeded in [1.22.1]; no new permission here. Run `node src/scripts/setupRbac.js` if you are catching up.

### Why
* A diagnostic report is not addressed to the patient alone — it goes back to the doctor who ordered the test, and there was nowhere to record who that was. The report named the clinic and the clinician who produced it, and had no line for the person the findings were for.

### The rule, and what it deliberately does not cover
* **Required on an HMO claim.** The LOA is issued against the referring physician; a claim that cannot name one is difficult to reimburse, and the clinic discovers that weeks later while chasing a patient who has long since gone home. Enforced in `hmoService`, not only in the booking controller, because `POST /hmo/request` reaches the same rule and reception filing a claim against an existing walk-in is the ordinary case.
* **Required for the `Private` patient type**, which at this clinic means "referred by a private physician" as opposed to a walk-in. Such a visit naming nobody is not a gap in the record; it is a record that contradicts itself.
* **Not required for Self Pay** — and this is a decision, not an oversight. It leaves one case knowingly unenforced: a self-paying walk-in can be given an X-ray with no requesting physician on file. Diagnostic radiography is normally performed on a licensed physician's request, and that is a radiation-safety matter which does not care who is paying. If the clinic's DOH / BHDT licensing says a request is mandatory, this rule is the wrong shape — the fix is a `requires_referral` flag per `test_categories` row, because the requirement is then about the modality rather than the payer. Written down so it stays revisitable.
* A claim filed later never overwrites a physician the visit already names. That name may already be on a released report, and two documents naming different doctors for one episode is worse than either.
* A PRC number submitted without a name is discarded. On its own it identifies nobody, and storing it would read as though the name had been lost rather than never given.

### Migration
* `node src/scripts/migrateReferringPhysician.js` — additive, idempotent, one transaction.
* Reversible: `node src/scripts/migrateReferringPhysician.js --rollback` — but **the rollback destroys data**. Unlike [1.22.0], whose dropped columns leave their card images on disk, these two columns are the only place the physician is stored, so dropping them discards every name recorded since the migration ran with nothing to restore from. Verified by rolling back and re-applying on a populated database: the re-applied schema reports zero. The script now counts and warns before it drops. Take a dump first if the data matters.
* Existing visits keep `NULL`. Back-filling a doctor nobody named would invent a referral.

### Consequences for fixtures
* Specs and `seedDemoScenario.js` used `Private` as a meaningless placeholder for fixture patients — often as the literal id `2`. That type means something now, so every such fixture began failing for naming no physician. All were switched to `Self Pay`, which is what an unpaid walk-in with no doctor and no coverage actually is, and resolved **by name** through `tests/e2e/helpers/patients.js` rather than by a seed-order id.

---

## [1.22.0] - 2026-08-17 (Evidence for an HMO claim)

Originally authored as `[1.13.0]` on a branch cut before [1.13.0]–[1.21.0] landed; renumbered on
merge. `migrateHmoCard.js` is unchanged by that — it is keyed to the columns it adds, not to the
number — but two `[1.13.0]` sections describing different tables would have made this file useless
as a history.

### Added
* `hmo_requests.card_file_path` / `card_original_name` / `card_mime_type` / `card_size_bytes` / `card_uploaded_at` — the photo of the patient's HMO card, attached during online booking. Server-generated filename, stored under `backend/uploads/hmo-cards/` (covered by the existing `backend/uploads/` gitignore entry). Never served statically: an HMO card carries a name, a member number and often a photo, so it is retrieved through an authenticated, ownership-checked route like diagnostic result files.
* `hmo_requests.card_verified_by` / `card_verified_at` — the staff member who confirmed the physical card at the desk. Reception is deliberately not required to photograph a card they are holding; they are required to be named. Derived from the request's own token, so no existing caller had to change.
* `hmo_requests.card_purged_at` — set when retention removes the image. Without it a purged card is indistinguishable from one that was never provided, and Admin cannot tell a policy working correctly from a gap in the record.
* `chk_hmo_request_card_evidence` — `CHECK (card_file_path IS NOT NULL OR card_verified_by IS NOT NULL OR card_purged_at IS NOT NULL)`. Every claim carries either an image, a named verifier, or a record that its image was purged under retention. The third arm is not optional: `NOT VALID` skips only the initial scan of historical rows, so without it the retention pass would violate the constraint the moment it nulled a client-uploaded card's path. The service layer enforces the same rule, but only the constraint covers routes and scripts that do not exist yet.
* `idx_hmo_requests_card_verified_by`, for staff-attestation reporting.
* Two permission grants to the **Client** role — `hmo:request` and `hmo:read`. Run `node src/scripts/setupRbac.js`. `POST /hmo/request` and `GET /hmo/request/:id/card` are patient-reachable, so under [1.20.0] they keep an explicit `authorizeRoles` list naming Client, and `verifyRbacWiring.js` requires every named role to hold the permission the route enforces. Both are ownership-scoped in `hmoService` exactly like the Client's other grants; neither reaches the staff HMO screens, which are `authorizeStaff` and therefore closed to a patient account whatever the matrix says.

### Why
* Online booking lets a client state HMO coverage themselves. A client can select a provider by mistake as easily as deliberately, and unlike a walk-in there is nobody at a desk to notice. The card photo is the evidence that makes the claim reviewable — it is not verification, and does not pretend to be: no Philippine HMO exposes an API that would let a clinic confirm a member number, so approval remains the existing manual Admin step.

### Migration
* `node src/scripts/migrateHmoCard.js` — additive and idempotent, runs in one transaction.
* The constraint is added **NOT VALID** deliberately. Rows predating this migration have neither an image nor a verifier, and back-filling a staff id to satisfy the check would invent an attestation nobody made. New and updated rows are enforced; history stays honestly incomplete.
* Reversible: `node src/scripts/migrateHmoCard.js --rollback` drops the constraint, the index and the columns in one transaction. Image files are left on disk, so a rollback loses the links but not the evidence.

---

## [1.21.0] - 2026-08-17 (Department-scoped patient records)

No schema change — run `node src/scripts/setupRbac.js` to seed one new permission.

**`patients:read_all_departments`.** The roster search was unconditional: two characters and any
staff token could page through every patient the clinic has ever registered. The name match *was*
the access control, and a name match is not an access control. `GET /patients/:id` had the
mirror-image problem — a role allow-list that excluded diagnostic staff outright, which was safe
but meant a lab tech could read a result and had no way to look up whose it was.

Both are now settled by one rule in `patientService.departmentScopeFor`: confine to the caller's
own departments unless they hold this permission. Seeded to SuperAdmin, Admin, Receptionist and
Cashier — the front office is clinic-wide by function and neither role implies a modality, so
scoping them would leave them able to find nobody. Diagnostic roles do not hold it, and a
SuperAdmin can grant it to an individual account on the Access Control screen.

An out-of-scope record answers **404, not 403**. A 403 confirms the record exists, and "does this
clinic have a patient called X" is precisely the question the scoping refuses. `api-authorization`
had asserted the old 403 and was updated with that reasoning.

The write path uses the same check — `updatePatientProfile` calls `getPatientById` rather than
repeating the rule — because birthdate and sex are the fields diagnostic reference ranges key off,
so editing another department's patient is a clinical-safety question, not only a privacy one.

Two consequences worth knowing:

- `GET /patients/search` now returns `departmentScope` alongside the results, and the screen prints
  it. A scoped result set and an empty clinic are otherwise indistinguishable.
- Opening Patient Records to all staff made it the first *reachable* nav item, so a lab tech was
  landing on the records search instead of their worklist. `defaultNavForRoles` now prefers the
  first destination that **belongs** to a role you hold. Reachable is not the same as home.

## [1.20.0] - 2026-08-17 (Per-account permissions and department assignment)

`node src/scripts/migrateAccountScopedRbac.js` — additive, safe to re-run.

**Why.** The role-permission matrix was the only way to say who may do what, and it was not the
thing actually being enforced. Every departmental route also carried a hardcoded role list
(`authorizeRoles('SuperAdmin', 'Cashier')` on `POST /payments`, the three modality roles on every
result route), and so did every sidebar item. Ticking `billing:process` for Laboratory Staff
therefore saved, reported success, and changed nothing: the nav item stayed hidden and the route
refused, because the lab role was not in either list. Somebody had granted access, believed it,
and stopped thinking about it — the worst failure mode an access control has.

**Tables.**

- `user_permissions (user_id, permission_id, effect, granted_by, reason)` — exceptions for one
  named account, in both directions. `effect` is `grant` or `revoke`; a grant-only table cannot
  express "everything a Cashier gets, except refunds", which is the more common request and the
  one with money attached. Unique on `(user_id, permission_id)`.
- `user_departments (user_id, category_id, granted_by)` — which modality's data an account may
  touch, beyond what its roles already imply. A separate axis from permissions on purpose:
  `results:write` says they may write a result, this says *whose*.

**Resolution**, in `userRepository`'s `EFFECTIVE_PERMISSIONS`, so login, `/auth/me` and the
per-request authority lookup cannot disagree:

```
permissions = (union of active role permissions) + grants − revokes
departments = modalities implied by roles + rows in user_departments   (null = unrestricted)
```

Revoke is applied last, as a set difference, so if a grant and a revoke ever coexisted for the
same pair the outcome would be *less* access rather than more.

**Route changes.** 45 routes now decide on permission alone, behind a new `authorizeStaff`
middleware that only asks "is this a member of staff at all". Routes whose role list includes
`Client` are untouched — those are the patient's own-data endpoints, and the staff/patient line is
the boundary being kept. `rbacRoutes` and `superAdminRoutes` keep their explicit `SuperAdmin` gate.

Six routes were gated on a role list with **no** permission at all (`GET /admin/activity`, four
appointment routes, the statutory register). Converting those blindly would have opened them to
every member of staff, so each was given the permission it should always have had first.

**No behaviour change on upgrade.** Both tables start empty, and `departmentsForUser` derives the
same departments the role mapping always implied. Every account keeps exactly the access it had.

## [1.19.0] - 2026-08-15 (Account lockout, PHI read auditing, audit retention)

Run: `node src/scripts/migrateLoginProtection.js` (additive, safe to re-run)

### Added — per-account lockout
[1.16.0]'s credential rate limiter is keyed by IP, so an attacker spreading attempts across addresses still had unlimited guesses at any one account. There was no per-account counter anywhere in the schema.

**The policy is deliberately forgiving, and that is the design decision worth recording.** A tight lockout is itself a denial of service *against the clinic*: anyone who can guess `receptionist@enlogada.com` — and the address format is guessable — could fail five logins at 08:00 and take the front desk offline during the morning rush. That is a worse outcome than the attack it prevents. So:

* **10** consecutive failures, not 3 or 5;
* **15 minutes**, and it **expires on its own** — nobody has to be phoned;
* a single successful login resets the counter, so ordinary mistyping never accumulates;
* an administrator resetting the password clears it immediately, since they have usually just verified the person in front of them.

The increment is a single `UPDATE` with the threshold check inside it — a read-then-write would under-count exactly when the account is being attacked. A lockout is audit-logged and raises a `warning` notification to Admin/SuperAdmin, because it is either an attack in progress or a staff member about to be blocked from working, and both want someone to know.

The refusal names the lockout rather than returning the generic "invalid email or password". That does confirm the account exists — a deliberate trade, since the rate limiter already bounds enumeration and the alternative is a staff member whose password is correct being told it is wrong, retrying, extending their own lock, and escalating.

### Added — PHI read auditing
All nine existing audit call sites were on *writes*. Nothing recorded who **read** a patient record, so after the mass-read hole closed in the first pass there would have been no way to scope a breach notification — the only trace was a morgan line on stdout, which is not retained. The Data Privacy Act expects an establishment to be able to say who accessed what.

Logged: viewing an identified patient's demographics, their diagnostic history, and downloading a report file. Keyed on the **patient**, since "who accessed this person's data?" is the only question this table is asked during an incident — with `idx_audit_log_entity_created` to serve exactly that.

**Deliberately not logged:** searches, worklists and queues. Staff refresh those constantly, and recording them would bury the entries that matter under traffic that is just people doing their job — the same fan-out mistake that took `notification_reads` to 255,540 rows. Client self-access is also excluded; nobody investigates a patient reading their own results. A spec pins both halves.

### Added — audit retention
`audit_log` has never had retention, and PHI reads change its growth profile completely. `pruneAuditLog.js` uses two windows because the entries answer different questions: **2 years** for PHI reads (high volume, value drops once the period is reviewed) and **7 years** for everything else (refunds, discounts, amendments, account changes — low volume, and matching how long the financial records they describe must be kept). Both overridable; dry-run by default.

### Fixed — `audit_log.actor_id` blocked deleting any user who had ever acted
The table's own comment says `actor_name` is denormalized "since the log must remain legible even if the actor's account is later deleted" — but the foreign key beside it was `NO ACTION`, which made that deletion impossible. The stated intent and the constraint contradicted each other.

This surfaced the moment lockouts and PHI reads started writing entries: **the E2E purge began failing** with `violates foreign key constraint "audit_log_actor_id_fkey"` and left test data behind, quietly undoing the guarantee that a run leaves the demo dataset exactly as it found it. Now `ON DELETE SET NULL` — never `CASCADE`, because deleting a user must not erase the record of what they did.

---

## [1.18.0] - 2026-08-15 (Date predicates that can actually use an index)

Run: `node src/scripts/migrateQueryPerformance.js` (additive, safe to re-run)

### Fixed — every date-ranged screen was doing a sequential scan
Eleven queries filtered on `column::date BETWEEN …` or `column::date = CURRENT_DATE`. **A B-tree index cannot serve a predicate on an expression**, so `idx_patient_visits_created` — added in [1.11.0] specifically for this — was never once used. The active queue sequentially scanned every visit ever recorded, on every load, for both the front desk and the cashier.

All eleven are rewritten as half-open ranges on the raw column (`col >= $1::date AND col < ($2::date + 1)`), which is exactly equivalent and lets a plain B-tree apply.

### Added
`payments.paid_at`, `visit_tests.created_at` and `test_results.released_at` had **no index at all**, and between them they carry the entire reporting suite, the cashier's transaction log and the diagnostic history. Added, plus composites for the predicates those screens actually use (`payments(payment_status, paid_at)`, `patient_visits(status, created_at)`), and an `ANALYZE` so the planner uses them immediately rather than after autovacuum next runs.

The index and the rewrite are useless apart, which is why they ship together.

### Measured, not assumed
On a throwaway database seeded with **219,000 payments** (three years at ~200/day), fetching one month of transactions:

| | plan | time | blocks read |
|---|---|---|---|
| `::date` cast | Seq Scan | 50.7 ms | 1,611 |
| half-open range | Index Scan | **0.84 ms** | 249 |

**60× faster, 6× fewer blocks**, with the date now inside the `Index Cond` rather than a post-filter. On the current demo dataset both forms are a seq scan and always will be — five rows fit in one page, and Postgres is right to prefer that — which is exactly why this had to be measured at volume instead of eyeballed locally.

### Fixed — the released-results list was unbounded
`findReleasedByCategory` had no `LIMIT` and no date bound, and selects `findings`/`remarks`, which are unbounded `TEXT`. It backs the "Released" tab, hit on every visit to that screen. At 30 laboratory tests a day that is 7,500 rows of full clinical narrative in one response after a year, 22,500 after three — for a screen that shows ten at a time. Now defaults to the last 90 days with a hard `LIMIT`, both overridable via query string and **clamped server-side** (an unclamped `limit` would let any staff member pull the department's whole history in one request).

### Also
The receptionist's **"Print Queue Ticket" produced a blank page** — a bare `window.print()` on a view with no `.print-area`, so the CSS hid everything. It now renders a real slip: the queue number at 64px for reading across a waiting room, the patient's name, visit type and time, and which departments to proceed to. Both icon-only buttons on that row also gained `aria-label`s; `title` alone is not a reliable accessible name and is invisible on touch.

---

## [1.17.0] - 2026-08-15 (VAT-exempt treatment for statutory discounts)

Run: `node src/scripts/migrateVatExemption.js` (additive, safe to re-run)

### Completes the open question from [1.14.0]
That release shipped the statutory discount as a flat 20% and said so explicitly: correct for a non-VAT establishment, an understatement for a VAT-registered one, pending confirmation of the clinic's BIR registration. **Enlogada is VAT-registered**, so the flat calculation was wrong.

RA 9994 and RA 10754 make a sale to a senior citizen or PWD **VAT-exempt**, and the order of operations is fixed by statute — it is not the intuitive one:

```
VAT-inclusive price          1,000.00
less 12% VAT                  -107.14     (1000 - 1000/1.12)
----------------------------------------
VAT-exempt sale                892.86
less 20% discount             -178.57     (20% of the VAT-EXEMPT base, not of the price)
----------------------------------------
Amount due                     714.29
```

A flat 20% off the price gives **800.00**, so seniors and PWDs were being **overcharged by ₱85.71 per ₱1,000**, and the clinic was understating the deduction it could claim. Discounting before removing VAT would also mean charging a VAT-exempt patient VAT on part of the sale.

Only **statutory** discounts get this treatment — a promo or corporate rate is an ordinary discount on a VAT-inclusive price and carries no exemption, so `discount_types.is_statutory` drives the branch rather than the percentage.

### Added
* `payments.vat_amount` — the VAT removed, snapshotted like the discount. With it the sale reconciles from the payment row alone: `amount + discount_amount + vat_amount = the VAT-inclusive price the patient was quoted`.
* `CLINIC_VAT_REGISTERED` (default `true`) and `VAT_RATE` (default `0.12`) in `backend/.env`, documented in `.env.example`.
* The bill and the receipt now show **Less VAT (12%)** and **VAT-Exempt Sale** as their own lines. BIR requires a VAT-exempt sale to be presented that way rather than folded into a single discount figure, and a patient comparing the shelf price to what they paid needs the difference explained.
* The statutory register reports `vatExemptSalesTotal` and `vatTotal` alongside gross, discount and net — the figures a senior/PWD register is actually filed with. Its `gross_amount` now adds the VAT back, so a row ties to the quoted price.

### Not backfilled, deliberately
Existing payments keep `vat_amount = 0`. Every one of them either carried no statutory discount or was computed the flat way, and restating historical rows to claim a VAT treatment they were not issued under would be worse than leaving them alone — those receipts are already in patients' hands.

### Rounding
Each figure is rounded to centavos and the balance is derived from the rounded parts, so the three components always sum exactly to the gross. `processPayment` rejects a submitted amount differing by more than a centavo, so an arithmetic disagreement here would surface as a payment the cashier cannot complete rather than as a rounding footnote.

### Test note
`discounts.spec.js` asserted the flat calculation and legitimately went red on this change. It now pins the statutory order, checks every centavo reconciles, and asserts explicitly that the flat figure is *not* what gets charged.

---

## [1.16.0] - 2026-08-15 (Session revocation, credential rate limiting, JWT secret guard)

Run: `node src/scripts/migrateSessionRevocation.js` (additive, safe to re-run)

### Fixed — resetting a password did nothing to a stolen session
"Reset the password" is the standard response to a stolen token, and it had no effect on the attacker. The token lives in `localStorage`, so XSS, a shared reception workstation, or a token captured from a log is enough to lift one. `updatePasswordHash` wrote only the hash, `verifyToken` checked only the signature, the account's existence and its `status`, and there is no server-side logout route. **The lifted token kept full access to patient records until it expired on its own** — which the deployed `.env` set to seven days.

`users.password_changed_at` closes it: `verifyToken` rejects any token issued before it. This costs nothing extra, because `verifyToken` already loads the user row on every request ([1.11.0]) — no denylist, no shared state between instances.

Every password path goes through `updatePasswordHash` (self-service change, emailed reset, and an administrator resetting a staff password), so revocation cannot be skipped by one of them.

Two details worth knowing:
* **`changePassword` now returns a replacement token**, and `AuthContext` stores it. Without that, changing your own password would sign you out one request later — the revocation is aimed at the *other* device, not the person doing the changing.
* **The check allows one second of slack.** A JWT's `iat` is whole seconds while `password_changed_at` carries milliseconds, so a token minted in the same second as the change can look up to 999ms older than it is; with no slack the replacement token would reject itself. One second is far below any realistic attack window. It also means a test has to age its tokens past a second for the assertion to mean anything — the spec says so explicitly.

Backfilled from `updated_at` rather than `NOW()`: stamping "now" would claim every password had just changed and sign the whole clinic out, and leaving it NULL would make the check inert.

### Added — a tighter bucket for credential endpoints
The rate limiter was one shared allowance across all 84 routes: 100 per 15 minutes in production (so an attacker's guessing also consumed the clinic's own budget) and 20,000 everywhere else, which is no limit at all for password guessing. There is no failed-login counter or account lockout in the schema, so nothing else slowed credential stuffing.

`/api/auth/login`, `/forgot-password` and `/reset-password` now carry a second limiter with `skipSuccessfulRequests: true` — staff signing in all morning never touch it, while wrong guesses accumulate immediately. It is keyed by IP, so a distributed attack still evades it: this raises the cost, it does not replace account lockout, which needs its own schema change and is still open.

### Added — the server refuses to start with a guessable JWT secret
`.env.example` shipped `JWT_SECRET=supersecretkeyreplaceinproduction`, and the setup instructions say to base `.env` on it. Any deployment that copied the file without editing that line was signing tokens with a string published in this repository — and since authority is read from the database for whatever `userId` a token names ([1.11.0]), an attacker signing `{ userId: 1 }` receives the seeded SuperAdmin's full role set. Presence was the only check.

Startup now rejects a blank secret, a known example value, or anything shorter than 32 characters, and `.env.example` ships the key **blank** with `openssl rand -hex 32` in the comment. `JWT_EXPIRES_IN` there is now `1d` rather than `7d`, matching the code default it was silently overriding.

---

## [1.15.1] - 2026-08-15 (Online payments that were taken but never recorded)

No schema change — service and repository only.

### Fixed — an online payment could be taken and recorded nowhere
`createCheckoutSession` cancelled the visit's in-flight gateway session **before** calling PayMongo, and only inserted the replacement row **after** the provider responded. Two ways that lost money:

1. **The ordinary double-click.** A patient opens the checkout tab, goes back, and clicks Pay again. The second call marked session S1 `Cancelled` and created S2 — but S1's tab was still open and still payable. If the patient completed *that* one, PayMongo charged them and fired the webhook for S1. `markGatewayPaymentPaid` is `WHERE gateway_session_id = $1 AND payment_status = 'Pending'`, S1 was `Cancelled`, so zero rows updated, and the handler reported `{ handled: true, alreadySettled: true }` with a 200. **The patient was charged, no `Paid` row existed, the visit was never released to any department, and nobody was told.**
2. **A provider failure.** If the PayMongo call threw or was rejected, the previous session had already been cancelled and no new row was written — same orphaned-tab exposure.

The cancel and the insert now happen together, in one transaction, *after* PayMongo returns a session id. That narrows the window to the moments between the provider minting a session and the commit, where the worst case is a second live session rather than a live session with no row behind it.

### Fixed — the webhook could not tell a redelivery from a lost payment
`if (!settled) return { handled: true, alreadySettled: true }` conflated "PayMongo retried an event we already processed" (normal, must not double-release) with "we cancelled this session out from under the payer" (money taken, nothing recorded). The handler now re-reads the row:

* already `Paid` → genuine redelivery, still idempotent;
* `Cancelled`/`Failed` → **the money moved anyway**. Logged at error level, settled through `forceSettleGatewayPayment`, and staff are notified to verify against the provider dashboard. Refusing to record it does not give the money back; it just means the clinic holds an unrecorded payment and the patient waits for an exam nobody can see.
* the settle hits `uq_payments_one_paid_per_visit` → the visit was **also** paid at the counter. That is a genuine double charge needing a refund, so it is *not* recorded as a second payment: it raises a `critical` notification and returns `requiresRefund`. Verified: exactly one `Paid` row survives.

### Also fixed
`getNextReceiptNumber()` was called before knowing whether the update would succeed, so every webhook redelivery burned a receipt number. Now that receipt numbers come from a counter that never rewinds ([1.13.0]), that punched permanent gaps in the official sequence. The handler checks for an already-`Paid` row first and mints a number only when it is going to use one. Verified: a redelivery leaves the counter unchanged.

---

## [1.15.0] - 2026-08-15 (Result versioning and critical-value flagging)

Run: `node src/scripts/migrateResultVersioning.js` (additive, safe to re-run)

### Fixed — a correction destroyed the original
`test_results` carried `UNIQUE(visit_test_id)` and `createResult` was an `ON CONFLICT DO UPDATE`, so editing an already-released result overwrote findings, remarks and file metadata **in place**. A radiology report issued to a patient could be silently rewritten with nothing anywhere recording what it originally said, and the audit entry noted only *that* a correction happened — never what changed, and the previous text no longer existed to compare against.

That is indefensible for a diagnostic report. The patient may have acted on the first version, and a referring physician certainly may have.

Each save now writes a **new row with an incremented version**. The previous row is marked `is_current = FALSE` and points at its replacement through `superseded_by`, so the chain is walkable in both directions. `amendment_reason` is required by the UI on an amendment, and the audit entry now names both versions and the reason.

### Fixed — a panic value released like a routine result
A critical result went out with the same silent "your results are ready" email as a normal CBC. `is_critical` is set by whoever records the findings and, on release, routes an urgent notification (with the patient's phone number) to Receptionist/Admin/SuperAdmin, and replaces the patient email with one asking them to contact the clinic. `critical_acknowledged_at` / `_by` / `_note` record the callback actually being made — the flag is the cheap half; the evidence that a human made contact is the part with medico-legal weight.

### Added
* `test_results.version` / `is_current` / `superseded_by` / `amendment_reason`.
* `test_results.is_critical` / `critical_acknowledged_at` / `critical_acknowledged_by` / `critical_acknowledgement_note`.
* Partial unique index `uq_test_results_current_per_test ON test_results(visit_test_id) WHERE is_current` — replaces the old `UNIQUE(visit_test_id)`, keeping "exactly one current result per test" (the invariant that UNIQUE was really protecting) while allowing history.
* `GET /api/results/:visitTestId/versions` (amendment history, department-scoped like every other result read) and `POST /api/results/:visitTestId/acknowledge-critical` (callback log — deliberately open to Receptionist, since the front desk usually makes the call and a callback that cannot be recorded by whoever made it does not get recorded).
* `'critical'` added to `chk_notification_events_type`.

### Watch out for
**Every reader of `test_results` must filter on `is_current`.** A `LEFT JOIN test_results` without it repeats the parent row once per amendment and shows superseded findings beside live ones. All five existing readers were updated (`findReleasedByCategory`, `findResultsByPatientId`, `findResultByVisitTestId`, `markReleased`, and `reportRepository.getDiagnosticWorkload` — the last would otherwise have inflated a clinician's throughput every time somebody corrected a report). A spec asserts lists never repeat a row per version.

`markReleased` in particular needed it: without the filter it stamped the releasing user onto *every* superseded version, rewriting the attribution of reports authorised by someone else at an earlier time — destroying exactly the history versioning was added to keep.

### Also found while building this
`notification_events.type` was CHECKed to `('info','success','warning')` and `notificationService` **silently coerces** anything else to `'info'`. The critical escalation was therefore arriving in the notification bell looking exactly like "New Appointment Booked". Nothing errored and nothing was lost, which is precisely why it would never have been noticed. `'critical'` is now a real severity, the notification list renders it distinctly (red, with an icon, not colour alone), and an unknown type is logged rather than downgraded in silence.

---

## [1.14.0] - 2026-08-15 (Statutory Senior Citizen / PWD discounts)

Run: `node src/scripts/migrateDiscounts.js` (additive, safe to re-run)

### Added
* `discount_types` catalogue, seeded with the two discounts mandated by **RA 9994** (Senior Citizen) and **RA 10754** (PWD) at 20%. Modelled generally rather than as two hardcoded cases, because the same shape covers the commercial discounts a clinic also needs (corporate, employee, promo) at no extra cost. `is_statutory` marks the two that exist by law: they require the holder's ID to be recorded, and are not meant to be deactivated.
* `patient_visits.discount_type_id` / `discount_id_number` / `discount_granted_by` / `discount_granted_at` — the **entitlement** claimed for a visit. It lives on the visit because the bill is computed per visit and the cashier must see the discounted total *before* taking any money.
* `payments.discount_amount` / `discount_type_name` / `discount_id_number` — an immutable **snapshot** of what was actually deducted. Deliberately not a foreign key: a receipt is a historical record and must keep saying what it said even if the catalogue is later renamed or re-rated, exactly as `visit_tests.price_at_time` does for prices. The statutory register reads from here, so it reflects money that actually changed hands.
* `GET /api/discounts` (catalogue), `POST|DELETE /api/discounts/visit/:visitId` (grant/remove, audit-logged), and `GET /api/discounts/register` (Admin/SuperAdmin only) — the separate register BIR expects for mandated discounts, with per-type totals. Refunded rows are listed but excluded from the totals: a reversed sale is not a discount the clinic granted.

### Why this mattered more than a missing feature
The clinic could not lawfully bill a senior citizen or PWD — the only occurrence of the word "discount" anywhere in the app was a mislabel on the HMO coverage line. The practical consequence is not that seniors paid full price; it is that cashiers work around it, by editing the catalogue price or taking the difference in cash and out of the system. Either one destroys the receipt trail that every other control in this codebase depends on.

### Decisions worth knowing
* **The discount base is the patient's out-of-pocket amount** (subtotal − approved HMO coverage), not the gross subtotal. A statutory discount reduces what the *patient* pays; applying it to amounts an insurer is settling would discount somebody else's money and understate the HMO receivable.
* **VAT is deliberately not modelled.** For a VAT-registered establishment the statute requires the 12% VAT to be stripped first and the 20% applied to the VAT-exempt base; for a non-VAT establishment it is a flat 20%. This system has no VAT decomposition anywhere — `tests.price` is a single figure with no tax component — so the flat percentage is correct for a non-VAT clinic and understates the discount for a VAT-registered one. Which applies depends on the clinic's BIR registration, so it is flagged in `discountService.computeDiscount` rather than silently assumed.
* **A discount cannot be changed once the visit is paid** (409). Changing it afterwards would disagree with the receipt already issued and with the register, and there is no re-bill path; a correction goes through the existing refund flow.

### Fixed
* **Receipt numbers carried the wrong date for eight hours of every day.** The date portion was formatted in JavaScript with `new Date().toISOString()` — which is UTC — while the sequence came from Postgres `CURRENT_DATE`, which is the server's local date. In Philippine time (UTC+8) a payment taken at 01:00 on the 15th was stamped `RCT-20260814-…` from the 15th's counter. Both halves now come from the same row in one statement, so they cannot disagree. With `uq_payments_receipt_number` in place from [1.13.0] this had also become a *failed payment* rather than a silent mis-dating, since the stamp reappeared the next morning.
* The same UTC-vs-local bug in four frontend screens (`todayStr` defined separately in each), which made "Today's Revenue" and the default History ranges show *yesterday* between midnight and 08:00. Now one shared `frontend/src/lib/date.js` built from local getters.
* The cashier's **"Print Receipt" produced a blank page** — `index.css` hides `body *` and reveals only `.print-area`, and the receipt modal never carried the class. On the one document a patient actually leaves with.

---

## [1.13.0] - 2026-08-14 (Concurrency-safe numbering, billing uniqueness, real transactions)

Run: `node src/scripts/migrateDataIntegrity.js` (additive, safe to re-run)

### Fixed
* **`schema.sql` could not be applied at all.** `test_results` declared `fk_results_recorded_by` twice on consecutive lines. PostgreSQL rejects a duplicate constraint name (42710), and `migrateDb.js` submits the file as a single statement — so the implicit transaction rolled back *everything*, including the `DROP TABLE`s at the top. The existing dev database predates the line, which is why nobody hit it; the first person to provision staging or production would have got a hard stop and zero tables. Now verified by applying the file to a throwaway database (22 tables, 25 foreign keys).
* **Queue numbers and receipt numbers were generated by `SELECT COUNT(*) … + 1`** followed by a separate INSERT, with nothing enforcing uniqueness behind them. Two receptionists registering at the same moment issued the same ticket; two cashiers settling at the same moment issued the same official receipt number. Both also had a no-concurrency trigger: counting *surviving rows* rather than *issuances* meant cancelling a visit, or refunding a payment, rewound the sequence and reissued a number already handed to someone.
* **The same visit could be charged twice** — `hasPaidPayment()` then INSERT, with no constraint behind it. A double-clicked "Confirm Payment" or a retry after a network blip took the money twice, and because the pre-check then returned true the duplicate was never flagged. Both rows counted toward revenue reporting.

### Added
* `daily_counters (counter_date, counter_name, last_number)` — one atomic per-day sequence, shared by queue tickets and receipts. Issued via `INSERT … ON CONFLICT DO UPDATE … RETURNING`, which takes a row lock so concurrent callers serialise. Seeded from existing visits and payments so numbering continues rather than restarting and colliding with numbers already in circulation.
* Unique index `uq_patient_visits_daily_queue` on `(created_at::date, queue_number)`.
* Unique index `uq_payments_receipt_number` on `receipt_number`.
* Partial unique index `uq_payments_one_paid_per_visit` on `payments(patient_visit_id) WHERE payment_status = 'Paid'` — a visit may still accumulate cancelled/failed gateway attempts and a refunded row, but only one settled charge.
* `db.withTransaction(fn)` in `config/database.js`. Uses `AsyncLocalStorage` so every query issued underneath it — at any call depth, through any repository, across any await — joins the same connection automatically. Chosen over threading a `client` argument through 100+ call sites in 14 repositories because that change fails *silently*: miss one and the write quietly commits outside the transaction, which is the exact bug the transaction was added to prevent. Nested calls join the transaction in progress rather than opening a second one.
* Connection pool bounds and timeouts (`max`, `connectionTimeoutMillis`, server-side `statement_timeout`) plus an idle-client error handler, so a database hiccup no longer takes the process down.

### Changed
* Multi-write flows are now atomic: client and staff account creation (previously could leave a user with valid credentials and no role — able to log in, landing nowhere, invisible to Admin's staff list because that query inner-joins `user_roles`, and unrecoverable because the email is taken), password reset (previously could change the password without consuming the token, leaving a live reset link in an inbox), result release, HMO request creation, appointment cancellation, and role-permission edits.
* Role grants now honour `starts_at` / `expires_at`. Both columns have existed since [1.0.0] and nothing ever read them, so a deliberately time-bounded grant never actually ended. This was the one revocation path that [1.11.0]'s per-request authorization did not already cover.

---

## [1.12.0] - 2026-08-14 (Separate result recording from result release)

### Added
* `test_results.recorded_by` — the staff member who wrote the findings. Backfilled from `released_by`, which is accurate for every pre-existing row since only the upload path ever set it.
* `test_results.authorised_at` — when release was authorised. The existing `released_at` is set on INSERT (i.e. when findings were recorded) and is deliberately left as-is rather than redefined underneath code that already reads it.
* `idx_test_results_recorded_by`, for per-staff workload reporting.

### Why
* `releaseResult()` was handed the releasing user's id by its controller and then silently dropped it — only the findings-upload path ever wrote `released_by`. A column named "released by" was therefore recording whoever last *typed the findings*. This is invisible while one person performs both steps, and exactly wrong the moment they are two people — which is the case the workflow is built around, since recording findings and authorising their release are separate events and `'Waiting for Release'` exists as a state precisely to separate them.
* Found while testing a temporarily-granted role: a Laboratory user borrowing Ultrasound access recorded findings, the Ultrasound staff released them, and the record credited the Laboratory user with the release.

### Migration
* `node src/scripts/migrateResultAttribution.js` — additive and idempotent.

## [1.11.0] - 2026-08-14 (Foreign-key and status indexes)

### Added
* 23 indexes covering every foreign key on the visit chain (`patients.user_id`, `patient_visits.patient_id`, `visit_tests.patient_visit_id`, `test_results.visit_test_id`, `payments.patient_visit_id`, `appointments.patient_visit_id`, the HMO join table, `user_roles`, `role_permissions`, `notification_reads.event_id`, `password_reset_tokens.user_id`, `tests.category_id`) and the status/date columns behind the queue screens (`patient_visits.status`, `visit_tests.status`, `payments.payment_status`, `appointments.status`, `appointments(scheduled_date, scheduled_time)`, `patient_visits.created_at`, `test_results.released_by`, `notification_events.created_at`).

### Why
* PostgreSQL indexes PRIMARY KEY and UNIQUE columns automatically but **not** foreign keys. The schema had three indexes in total, all added recently for specific features, so every join across the visit chain and every queue filter was a sequential scan — and each delete of a parent row scanned the entire child table to check for references. Invisible on a small database; it surfaces after a year of real visits as screens that were instant becoming slow together.

### Migration
* `node src/scripts/migrateIndexes.js` — additive and idempotent (`CREATE INDEX IF NOT EXISTS`), safe to re-run. `schema.sql` carries the same statements for fresh installs. A column missing on an older database is logged and skipped rather than aborting the run.

## [1.10.0] - 2026-08-12 (Ticket Release Gating + Online Payment Gateway)

### Changed
* `visit_tests.chk_visit_tests_status` widened to allow **`'Waiting for Release'`**: the state between `'Processing'` (released to a modality, exam not yet performed) and `'Completed'` (result released to the patient). Recording findings and releasing them are two distinct clinical events and now have two distinct states, both visible to the front desk.

### Added
* `payments.gateway_provider`, `payments.gateway_session_id`, `payments.gateway_payment_id` — links a payment row to an online GCash/Maya checkout session (PayMongo hosted checkout). NULL for counter payments. Plus `uq_payments_gateway_session` (UNIQUE) and `idx_payments_gateway_session`, which the webhook uses to resolve a session back to its pending payment.
* A gateway payment is inserted as `payment_status = 'Pending'` when the patient is redirected, and only flips to `'Paid'` when a signature-verified `checkout_session.payment.paid` webhook arrives. The browser's return to `success_url` is never trusted — it is a plain URL the patient can navigate to directly.

### Migration
* Applied additively by **`backend/src/scripts/migrateTicketFlow.js`** (idempotent, runs in a single transaction, safe to re-run) rather than by `migrateDb.js`, which is destructive and would discard accumulated seed/test data. Same approach as [1.5.0] through [1.9.0]. `schema.sql` remains canonical for fresh installs and already carries every change above.

```bash
cd backend && node src/scripts/migrateTicketFlow.js
```

### Behavioural consequence (no schema change, but load-bearing)
* `resultRepository.findPendingByCategory` now joins `patient_visits` and requires `pv.status = 'Processing'`. Previously it filtered on `visit_tests.status` alone and never looked at the parent visit, so a ticket appeared on a modality worklist the instant a client attached tests during online booking — before confirmation, before payment, and even for cancelled visits.

## [1.9.0] - 2026-08-12 (UI/UX Modernization Phase 8: profile avatar upload)

### Added
* `users.avatar_path VARCHAR(255)`, `avatar_mime_type VARCHAR(100)` (both nullable) — backs a real profile-photo upload on the My Account/Profile page, available to every role (self-service only, no admin-on-behalf-of upload). Reuses the multer disk-storage pattern from [1.7.0] (`backend/uploads/avatars/`, server-generated filename keyed on the uploading user's own ID + random hex, never the client-submitted name). `GET /auth/me/avatar` streams the file back through an authenticated route (never `express.static`) since profile photos aren't public. Uploading a new photo deletes the previous file from disk (best-effort, doesn't fail the request if cleanup fails); `DELETE /auth/me/avatar` removes it entirely, falling back to the existing initials-circle UI.
* Deliberately self-only and profile-page-scoped: the existing initials-circle avatars elsewhere in the app (sidebar user-info block, public header user chip) are unchanged — replacing those with the uploaded photo everywhere they appear was judged a separate, larger UI sweep beyond this phase's "My Account" scope.
* Applied additively directly against the live dev database, same as [1.6.0]-[1.8.0]. `schema.sql` updated to match for fresh installs. New `backend/uploads/avatars/` directory covered by the existing `backend/uploads/` gitignore entry from [1.7.0].

## [1.8.0] - 2026-08-11 (Feature Gap Plan Phase D: audit trail, staff workload, patient lookup context)

### Added
* `audit_log(id, actor_id → users.id, actor_name, action, entity_type, entity_id, description, created_at)`, plus `idx_audit_log_created_at`. `actor_name` is denormalized (not just a join to `users`) so a log entry stays legible even if the actor's account is later renamed or removed — it's a record of what happened, not a live view of current user data. Backs a new `GET /admin/activity` endpoint and Admin/SuperAdmin "Activity" page. Scoped to the sensitive actions already built this session — payment refund/cancel, staff password reset/status toggle, HMO provider create/update, result corrections — rather than instrumenting every write path in the app.
* No new columns needed for staff workload (Reception check-ins grouped by `patient_visits.created_by`, Diagnostic releases grouped by `test_results.released_by`) or patient-lookup financial context (`patients.searchPatients` gained correlated-subquery visit/unpaid counts) — both reuse existing columns.
* Applied additively directly against the live dev database, same as [1.7.0]/[1.6.0]. `schema.sql` updated to match for fresh installs.

## [1.7.0] - 2026-08-11 (Feature Gap Plan Phase B: real diagnostic result file upload)

### Added
* `test_results.file_path TEXT`, `file_original_name TEXT`, `file_mime_type TEXT`, `file_size_bytes INT` — this is the headline finding from the original gap-analysis pass: releasing a diagnostic result never actually stored a file, only `file_url` (a free-text string a staff member had to fill in with a link to somewhere else). These columns back a real upload, handled by `multer` (disk storage, `backend/uploads/results/`, server-generated filenames — never the client-submitted name, closing off path traversal). `file_url` is kept as-is (nullable) as a legacy/graceful fallback; new uploads populate the four new columns instead and leave `file_url` null.
* New `GET /results/:visitTestId/file` — authenticated, ownership-checked (reuses `assertStaffOwnsVisitTest` for staff, the same Client-owns-this-patient check `resultController.getPatientHistory` already performs) file download route. Deliberately not served via `express.static` — these are PHI, and a public static path would make every file reachable by anyone who guesses or leaks a URL.
* Applied additively (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) directly against the live dev database, same as [1.6.0]/[1.5.0], to avoid discarding accumulated seed/test data. `schema.sql` updated to match for fresh installs. `backend/uploads/` is gitignored — uploaded files are local/instance state, not source.

## [1.6.0] - 2026-08-11 (Feature Gap Plan Phase A: refund/void, HMO provider management)

### Added
* `payments.refund_reason TEXT` (nullable) — captures why a payment was moved to `Refunded`/`Cancelled` via the new `PATCH /payments/:id/status` endpoint. The status values themselves (`Refunded`, `Cancelled`) already existed in `payments.payment_status`'s CHECK constraint since the [1.0.0] baseline; no endpoint ever set them until this phase.
* `hmo_providers.is_active BOOLEAN DEFAULT TRUE` — backs the new provider CRUD (`POST`/`PUT /hmo/providers`). Providers are deactivated, not deleted, since `hmo_requests` holds a `NOT NULL` FK to `hmo_provider_id` and a hard delete would either fail or orphan historical requests.
* Applied additively (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) directly against the live dev database, same as [1.4.0]/[1.3.0], to avoid discarding accumulated seed/test data. `schema.sql` updated to match for fresh installs.

## [1.5.0] - 2026-08-10 (Module 18: Notification — normalization refinement)

### Changed
* Replaced the single `notifications(id, user_id, title, message, type, is_read, created_at)` table from [1.4.0] with two tables: `notification_events(id, title, message, type, created_at)` and `notification_reads(id, event_id → notification_events.id ON DELETE CASCADE, user_id → users.id ON DELETE CASCADE, is_read, UNIQUE(event_id, user_id))`, plus `idx_notification_reads_user (user_id, is_read)`.
* Reason: the original design inserted one full row (duplicating `title`/`message`/`type`/`created_at`) per broadcast recipient. That's not a formal normal-form violation (each row is fully determined by its own single-column key), but it duplicates event content N times per broadcast with no single place to correct it — a genuine event/read-state entity split. This shape separates the event (written once, immutable) from who has read it (per-user, mutable).
* No API contract change — `GET /notifications`/`PATCH /notifications/:id/read`/`PATCH /notifications/read-all` return the identical JSON shape as before (`notificationRepository.js` joins the two tables and aliases columns back to the original flat shape), so `notificationService.js`, the controller, routes, and the frontend needed zero changes. Applied additively/replacively on the live dev DB (old `notifications` table dropped — held only disposable test data from Module 18's own verification).

## [1.4.0] - 2026-08-10 (Module 18: Notification)

### Added
* `notifications(id, user_id → users.id ON DELETE CASCADE, title, message, type CHECK IN ('info','success','warning'), is_read, created_at)`, plus `idx_notifications_user_created (user_id, created_at DESC)`. Backs the real notification center behind `SidebarLayout.jsx`'s previously-static mock list. A broadcast-to-role event (e.g. "a new appointment was booked") fans out into one row per recipient user at insert time, rather than one shared row per event — each recipient gets an independent read state instead of racing to mark a shared row read.
* Applied additively (`CREATE TABLE IF NOT EXISTS`) directly against the live dev database rather than via a full `migrateDb.js` re-create, to avoid discarding the substantial accumulated seed/test data from Modules 1–17. `schema.sql` is still the canonical source of truth for fresh installs.

## [1.3.0] - 2026-08-10 (Module 1: Authentication — Password Reset)

### Added
* `password_reset_tokens(id, user_id → users.id ON DELETE CASCADE, token_hash UNIQUE, expires_at, used_at, created_at)` — supports the forgot-password/reset-password flow (`POST /api/auth/forgot-password`, `POST /api/auth/reset-password`). Only a SHA-256 hash of the emailed token is persisted. Tokens are single-use (`used_at`) and expire after 1 hour; a new request deletes any prior unused tokens for that user.
* This closes the "Forgot password?" dead-button gap and the Google-OAuth-only-account login gap documented in `.agents/MODULE_SCOPE.md`'s Known Gaps — a Google-created account can now obtain a real, usable password via reset.


This file tracks all structural changes, migrations, and updates made to the PostgreSQL schema.

## Canonical database initialization sequence

Run these three scripts from `backend/`, in this exact order, against a fresh database:

```bash
node src/scripts/migrateDb.js     # (re)creates all tables from database/schema.sql, incl. permissions/role_permissions — destructive, drops/recreates
node src/scripts/setupRbac.js     # seeds permissions + role_permissions data (requires the tables above to already exist)
node src/scripts/seedUsers.js     # seeds one demo user per role
```

There is no single combined command — this is a deliberate three-step sequence, not an oversight. `migrateDb.js` owns structure only; `setupRbac.js` and `seedUsers.js` own data.

---

## [1.2.0] - 2026-08-10

### Fixed
* **RBAC schema/migration drift**: `permissions` and `role_permissions` were previously created ad hoc by `backend/src/scripts/setupRbac.js` (`CREATE TABLE IF NOT EXISTS`), entirely outside `schema.sql`/`migrateDb.js`, and undocumented here. Consequence: re-running `migrateDb.js` (`DROP TABLE roles CASCADE`) silently dropped `role_permissions`' foreign-key constraint to `roles` without recreating it (`CREATE TABLE IF NOT EXISTS` is a no-op once the table exists), leaving stale `role_id` values with no enforced referential integrity.
* `permissions` and `role_permissions` are now created by `schema.sql` itself (in the "Roles and RBAC" section, right after `user_roles`), with proper `DROP TABLE ... CASCADE` entries at the top of the file alongside every other table. They are now dropped and recreated together with `roles` on every `migrateDb.js` run, so the FK relationship can never be left orphaned.
* `setupRbac.js` no longer creates these tables (removed its `CREATE TABLE IF NOT EXISTS` statements) — it is now a pure data-seeding script with an explicit precondition that `migrateDb.js` has already been run. Its seed data (13 permissions, per-role mappings) is unchanged.

---

## [1.1.0] - 2026-08-09

### Added
* Created `clinic_operating_hours` table (per-weekday open/close window, slot granularity, and per-slot capacity) to drive dynamic appointment availability.
* Seeded default operating hours: Mon-Fri 08:00-17:00, Sat 08:00-12:00 (30-minute slots), Sunday closed.
* Added `GET /api/appointments/availability?date=YYYY-MM-DD` endpoint (new `scheduleRepository`) returning bookable time slots for a given date, computed from `clinic_operating_hours` minus already-booked, non-cancelled `appointments` rows.

### Changed
* `appointmentService.createAppointment` now performs a transactional, capacity-aware conflict check (Postgres advisory lock + row count against `max_concurrent_bookings`) before inserting an appointment, rejecting out-of-hours or already-full slots with HTTP 409.

---

## [1.0.0] - 2026-08-05 (Baseline)

### Added
* Created baseline [schema.sql](file:///c:/Users/Steven/Desktop/Enlogada%20Clinic%20Management%20System/database/schema.sql).
* Configured core tables: `roles`, `users`, `user_roles`, `patient_types`, `patients`, `patient_visits`, `appointments`, `test_categories`, `tests`, `visit_tests`, `hmo_providers`, `hmo_requests`, `hmo_request_tests`, `test_results`, and `payments`.
* Seeded default static values for Roles, Patient Types, Test Categories, and initial HMO Providers.

### Changed from Initial Draft
* **Removed Pet support**: Excluded `is_pet`, `species`, and `breed` details from `patients` as the clinic has finalized that they only handle human patients.
* **Added `queue_number` column** to `patient_visits` to support front desk and cashier workflow.
* **Added `appointment_reference` column** to `appointments` to support QR code generation/lookup.
* **Added `receipt_number` column** to `payments` to track cashier receipt issuance.
* **Enforced Referential Integrity**: Added missing foreign keys for audit trail fields pointing back to `users(id)`:
  * `patient_visits(created_by)`
  * `payments(processed_by)`
  * `test_results(released_by)`
  * `user_roles(assigned_by)`
