# Handoff: bring the paper's diagrams up to date with the system

Written 2026-10-19, after [1.132.0] (commit `1a66524`). For the next Claude Code agent working in
this repo. CLAUDE.md and the project memory load on their own; this file is what they do not say.

## 1. The task

The capstone paper's diagrams in `docs/diagrams/` were last brought up to date at [1.104.0] (the
flowcharts, use cases and DFDs; [1.103.0] was the last full check against the system) and at
[1.112.0] (the ERD, regenerated only). The system has changed a lot since (see
`database/migrations.md` [1.105.0] to [1.132.0]), and several figures now show things the system no
longer does: refunds, no-shows, cancelling, X-ray uploading and emailing reports, a release that
emails the patient, a QR pass before payment.

Do it the way [1.103.0] did, and read that entry first: checked rather than asserted, comparing
every screen name, route and permission in the figures with `frontend/src/config/navigation.js`
and the API, so that a figure names screens exactly as the sidebar does.

Make every figure say what the system does today, **built the same way the existing ones are**.
Do not redesign the look or the layout rules. Change content only, plus whatever layout a new step
genuinely needs.

## 2. How the diagrams are built (read before touching anything)

- `docs/diagrams/buildDiagrams.cjs` writes all five `.drawio` files from the specs inside it
  (`SUPER_ADMIN_FLOW`, `ADMIN_FLOW`, `RECEPTIONIST_FLOW`, `CASHIER_FLOW`, `departmentFlow()`,
  `CLIENT_FLOW`, `USE_CASES`, `DFD0`, `dfd0Context()`, `DFD1`, `STORES`, `P`, `SHEETS`).
  **Change a diagram by changing its spec, never by editing the `.drawio`.** A regeneration
  overwrites the `.drawio` files completely.
- Checked on 2026-10-19: the committed flowcharts, use cases and DFD `.drawio` files are
  byte-identical to what the script generates. Nobody has hand-arranged them, so regenerating loses
  nothing. Check again before you start (generate into a scratch folder and `cmp`). If one differs,
  someone has edited it by hand: stop and ask Steven before overwriting.
- The ERD is read from the **live dev database** (`backend/.env`). No server is needed. Never run
  `migrateDb.js` (destructive). The dev database has every migration through [1.132.0] applied.
- `node docs/diagrams/checkDiagrams.cjs` must end **Clean**: no decision with fewer than two
  labelled exits, no dead end, no line through a box, no overlapping boxes, no long label
  (34 characters, or 42 on a use case). It is Clean today.
- Export: `exportPng.ps1` uses relative paths, so run it **from inside `docs/diagrams/`**:
  `cd docs/diagrams; powershell -ExecutionPolicy Bypass -File exportPng.ps1`. draw.io desktop is
  installed at `C:\Program Files\draw.io\draw.io.exe`. The PNG name comes from the page name, so
  renaming a page leaves the old PNG behind: delete it. `png/` is committed (36 files).
- **Look at every PNG you changed** (the Read tool shows images). The checker cannot see a label
  that reads wrong, a branch that makes no sense, or a step drawn twice.

### Rules the existing diagrams follow (keep all of them)

From CLAUDE.md ("The capstone paper's diagrams are generated") and Steven's past corrections:

- Black ink on white. No colour that means anything.
- **Flowcharts:** the paper's header (actor, Login, "Access Granted?", the landing screen) in one
  centred stack, with the "no" branch looping up the left back into Login. Every staff chart lands
  on **Today**, and each column opens with the screen it uses (Desk, Billing Queue, a worklist).
  Columns fan out from one shared bus. A side branch that rejoins goes into the **top** of its
  target, never its right edge. The Client chart is a `chain` (one sequence wrapped into columns),
  not a menu.
- **Say a thing once.** The Desk's walk-in path was once drawn three times, each ending in its own
  queue ticket, and Steven had it fixed. No step, actor or ticket appears twice in a chart.
- **DFDs:** the paper's box sizes (a modest process box, a SMALL actor, never a tall slab), one flow
  per line, one label per flow. Level 0 nests each flow in its own corridor, inputs above the boxes
  and outputs below. Level 1 has one small actor at the top left, processes numbered down the
  middle, stores down the right, and a track per flow in the left margin. Labels are pinned beside
  their process. **Never draw the same actor twice.**
- Labels short enough to read at a glance in a printed figure (the checker's limits).
- Steven wants anything that is now gone to be **gone** from the figures, not greyed out.

## 3. What changed in the system, and what each figure must now say

Verify each point against the code before drawing it (the screens under `frontend/src/pages/` and
the services under `backend/src/services/`). Where the code and this list disagree, the code wins,
and say so in your report. The suggested wording is a suggestion; keep labels within the limits.

### Gone from the system, so remove from every figure

| Gone | Since | Currently drawn in |
|---|---|---|
| Refunds / reversing a receipt | [1.121.0] | Cashier flowchart ("Reverse a receipt?" / "Record the refund"), Cashier use case ("Reverse a Payment"), Cashier DFD0 input "Refund details", Cashier DFD1 "Payments and refunds", Admin flowchart "Review takings and refunds" |
| Marking a no-show; cancelling a booking or visit | [1.131.0] | Receptionist flowchart ("Someone at the desk? / Mark a no-show"), Receptionist use case "Mark No-Show", Receptionist DFD0 input "No-show", Client use case "Reschedule or Cancel Booking" |
| X-ray uploading, releasing and emailing a report | [1.129.0] | X-Ray flowchart, use case, DFD0 and DFD1 all draw it like Laboratory |
| Releasing a result emails the patient | [1.113.0] | Lab and Ultrasound flowcharts ("Patient emailed the report" after release), use cases ("Release Result" «include» "Record Delivery"), DFD1 "Result emailed" as automatic |
| The patient downloading or printing a result | [1.113.0], [1.115.0] | Client flowchart "View or print result" |
| The QR pass at booking, before payment | [1.48.0] | Client flowchart "Get reference and QR" before "Pay now?" |
| The Analytics tab; CSV as the export | [1.111.0], [1.119.0] | Super Admin flowchart "View analytics" / "Export CSV", use cases "View System Analytics", "Export CSV", DFD0/1 "Analytics" |

### New since the figures were drawn, so add

**Payment first** ([1.123.0], [1.131.0], [1.132.0]). The rule Steven cares most about:
- A patient's self-pay booking holds its slot for the payment window (60 min). Paid in time (proof
  uploaded, checked by a cashier), it is kept and the QR pass appears. Not paid in time, the slot
  is released and the booking removed, and the patient is emailed.
- An HMO booking holds its slot until its own start time while an Admin decides the claim.
  Approved: kept, as if paid, pass shown. Refused: the patient gets the 60-minute window to pay.
  Undecided at the start time: released. The patient is emailed the decision.
- Unpaid walk-ins and unpaid bookings are **removed automatically** when their time is up
  (every 5 minutes, logged in the Activity Log). Nothing is "Cancelled" or a "No Show" any more.
- A paid receipt is final. No refunds, no void, no cancel. A paid booking is moved
  (rescheduled), never cancelled.
- A booking made by staff must be paid as it is made, but **there is no staff booking screen**
  (API and demo seed only). Do not draw a desk booking flow.

**Desk (Receptionist)** ([1.116.0], [1.123.0], [1.129.0], [1.130.0]):
- "Who's here?" finds today's booking (Check in), a record on file (Start visit) or nobody
  (Register Walk-In). **A visit is opened with its tests**: Start visit and registration ask
  for the tests first, and Confirm Check-In waits for a test. A new record matching one on file
  asks "Use the record on file" or "register someone new".
- A booking not paid in time cannot be checked in: start a walk-in instead.
- Below the queue: "Still to arrive today" (check in, reschedule), "From earlier days, still with
  a department", "Paid bookings nobody came for" (reschedule).
- Patient Records opens the patient's **file** (finished visits only); "Start a visit" goes to the
  Desk; a walk-in's record can be linked to the account they sign up with.
- Visit History: record a walk-in's **paper feedback form** on a finished visit ([1.112.0]).

**Cashier** ([1.122.0], [1.123.0]):
- Before taking money, the cashier confirms the **final tests** with the patient (a tick, because
  the receipt is final).
- A test still waiting on an HMO decision: wait, or charge in full and withdraw the claim.
- An online proof waiting to be checked: no counter payment, go to Online Payments.
- Online Payments: proof matches → approve (a receipt is issued, the booking is kept); no →
  reject, the patient is emailed and gets the payment window again.
- Transaction History: takings and receipts, print a copy. No reversal.

**Admin** ([1.112.0], [1.119.0], [1.121.0], [1.132.0]):
- Service Requests: an HMO claim on a booking shows "decide by" (the booking's start). Approve
  (approval code) or refuse (a reason); the cashier is notified and, for a booking, the patient is
  emailed.
- Appointments: views bookings and their moves (no cancel, no no-show).
- Cashier Monitoring: takings per cashier (no refunds).
- Staff Accounts: add staff with **one or more roles**, change roles later ([1.129.0]).
- Reports: four tabs (Departments, Trends, HMO Claims, Staff Workload); each prints as an A4
  document and exports to Excel.
- Patient Feedback: the overview (printable) and the questions (Admin manages them).
- Archive / restore a patient record (Admin and Super Admin; refused while the patient has open work).

**Super Admin**: its chart already has access, staff, services, payment methods, the schedule,
reports and the Activity Log. Add Patient Feedback, change Reports as above, and add to Clinic
Schedule that closing a date or changing its hours lists the bookings it affects and emails those
patients, for the Desk to move them ([1.123.0]).

**Laboratory and Ultrasound** ([1.113.0], [1.114.0], [1.115.0], [1.126.0]):
- The worklist is one row per patient; their tests open beneath the name.
- Attach the report file (PDF, image, Word or Excel) → ready? no: save for later; yes: authorise and
  release. Releasing puts a **digital copy** (marked DIGITAL COPY, with a verification code and QR)
  in the patient's portal. It does **not** email.
- Emailing is a separate choice, offered after release and from History ("Email to patient?").
- History: search; a correction is released as a new version (with a new code); print or email.

**X-Ray** ([1.129.0]): the X-ray department gives results through its own system. The worklist's
one action is **Mark done** (confirmed), which completes the test, and the visit if nothing else is
outstanding. X-Ray History lists exams done and who did them. No upload, release or email.

**Client / Patient** ([1.106.0], [1.112.0], [1.113.0]–[1.115.0], [1.126.0], [1.130.0]–[1.132.0]):
- Booking: choose who pays. An HMO booking (or a Private patient) uploads the **doctor's request**,
  and an HMO booking the **HMO card**. Self-pay may attach the request.
- After booking: a reference and a confirmation email with preparation. Self-pay confirms the final
  tests, pays to the clinic's GCash/bank and uploads proof within the window. HMO waits for the
  decision. The **QR pass appears once paid or approved**.
- A reminder email arrives the evening before (automatic).
- The patient can **reschedule** (a reason is asked). No cancel.
- Results: a released report is viewed as a marked digital copy, not downloaded or printed; the
  original is collected at the clinic, and a copy can be emailed on request. X-ray results come
  from the X-ray department.
- After a finished visit, Home asks "How was your visit?" (feedback, [1.112.0]).

**Anyone** ([1.126.0]): a public page checks a report's verification code. See question 1 below.

### Figure by figure

- **Flowcharts (8 pages):** all eight change. X-Ray needs its own spec instead of
  `departmentFlow('X-Ray', …)`. The Client chain needs the payment-first branch and the pass after
  payment; watch the column lengths, the chain corridor and the 34-character limit.
- **Use cases (8 pages):** remove the gone cases above; add Reschedule Booking, Record Paper
  Feedback, Open Patient File (Receptionist), Confirm Final Tests (Cashier, «include» on
  Process Billing), Manage Feedback Questions / View Patient Feedback (Admin), Mark Exam Done
  (X-Ray), Answer Visit Feedback and Upload Doctor's Request (Client); make Email Result an
  «extend» of Release, not an «include».
- **DFD Level 0 (9 pages):** fix the inputs and outputs per actor to match (for example X-Ray in:
  "Exam marked done"; Client out: "Booking reference", "HMO decision", "Reminder email", "Digital
  copy of result"). The Context sheet's X-Ray label becomes something like "x-ray exams done".
- **DFD Level 1 (8 pages):** the X-Ray sheet loses D6 (Diagnostic Results) and writes D3. Feedback
  needs a home: the tables are `feedback_questions` and `visit_feedback_answers`, so either a new
  store (D10 Patient Feedback) or D3. Add it once and keep the numbering consistent across sheets.
  The emails the server sends by itself (reminders, booking released, HMO decision) belong to
  19.0 Send Emails.
- **ERD (3 pages):** just regenerate. It must report "33 of 33 tables drawn". New since the last
  run: `visit_tests.performed_at` / `performed_by` ([1.129.0]), `test_results.verification_code`
  ([1.126.0]). If it reports a table MISSING, add it to the right sheet in `SHEETS`.
- **`docs/diagrams/README.md`:** it says 36 tables (now 33), and its "What these diagrams assert"
  list needs the new facts (payment first, no refunds or cancelling, X-ray marked done, release
  does not email, the patient gets a marked digital copy). Fix the header comment in
  `buildDiagrams.cjs` too: it names `build-diagrams.cjs` and `export-png.cmd`, which do not exist.

### Questions for Steven (ask both at the start, together; do not decide them alone)

1. **Report verification** is a public feature with no account. Add a small external entity for it
   (for example "Report Holder") on the Context DFD only? Recommended: yes, Context only.
2. **The automatic jobs** (reminders every minute, unpaid bookings removed every 5 minutes) have no
   human actor. Recommended: show them as outputs to the Client ("Reminder email", "Booking
   released") and on the Activity Log, not as a new actor.

## 4. Finish the way this project finishes work

1. Before: `git fetch` and check for a teammate's commits (`git log HEAD..origin/main`).
2. Edit the specs, `node docs/diagrams/buildDiagrams.cjs`, `node docs/diagrams/checkDiagrams.cjs`
   until Clean, export the PNGs, read every changed PNG, fix, repeat.
3. Add an entry at the top of `database/migrations.md`, `## [1.133.0] - <date> (…)`, starting "No
   migration. Documentation only." like [1.103.0] and [1.104.0]: what each figure now says and why.
   Update the diagrams paragraph in CLAUDE.md only if a rule changed.
4. Commit as the repo's own git identity, with **no Co-Authored-By trailer** (Steven's rule: sole
   authorship on his capstone; it overrides any default attribution). Push straight to `main`.
5. Tell Steven, figure by figure, what changed and which PNGs to replace in the paper. He reads
   plain language; keep it short.

The app code is not part of this task. If drawing something shows a process that does not make
sense, report it to Steven rather than changing the system.

## 5. Other open threads from the last session (not part of the diagram task)

- **Joel (cashier@enlogada.com) still holds the Receptionist role too.** Seven E2E tests that take
  that account to be a cashier only fail until it is unticked on Staff Accounts, or `npm run demo`
  is run (which resets the demo accounts). Last full run: 521 of 529 passed; the other failure was
  two random fixture patients sharing a name (`laboratory.spec.js`), which passes on its own.
- **Offered to Steven, not answered yet:** a "Book for a later day" button on the Desk (the API
  takes a staff booking with its payment; a screen would also need the senior/PWD discount before
  payment), and the patient's phone number on the Desk's "From earlier days" table.
- **A choice made without him, to confirm:** an HMO booking approved in part (some tests refused)
  is kept, and the refused tests are paid at the clinic.
- E2E runs, if you need one: Steven's own dev servers run on 5000/5173, so start your own and stop
  only those afterwards. What the last session used:

      # backend/
      PORT=5001 CORS_ORIGINS=http://localhost:5174,http://localhost:5173 FRONTEND_URL=http://localhost:5174 \
        APPOINTMENT_REMINDERS=off UNPAID_EXPIRY=off node src/server.js
      # frontend/
      VITE_API_BASE_URL=http://localhost:5001/api npx vite --port 5174 --strictPort
      # frontend/, the run itself
      E2E_SKIP_PURGE=1 E2E_API_URL=http://localhost:5001 E2E_BASE_URL=http://localhost:5174 npx playwright test

  Check nobody is using the app first (the purge deletes what was created in the run's window),
  never start two Playwright runs at once, and afterwards run
  `node src/scripts/purgeE2eData.js --since=<first run's start> --dry-run`, then without `--dry-run`.
