# Practice: debugging exercises and panel questions

Work through these **in order**; they get harder. For each exercise, use the eight steps from
`DEBUGGING_GUIDE.md` and write your answers down before opening the hints.

Every exercise uses **test accounts on your own PC** (`TEST_ACCOUNTS.md`). None of them asks you to
break the real system or delete data. Where an exercise needs a server stopped, you start it again
at the end.

> Answers are folded away. Click **Answer** only after you have tried, and written down what you think.

---

## Part A: debugging exercises

### Exercise 1: "The discount won't go through" (easy, frontend + backend)

**The report.** The cashier calls you over: *"I'm giving this patient the Senior Citizen discount.
I typed her OSCA ID, I click Apply, and it shows red text and won't apply. The system is broken!"*

**Set up (5 minutes).** The Billing Queue only shows today's patients, so make one:
1. Sign in as `receptionist@enlogada.com`, open **Desk**, click **Register Walk-In**.
2. Register an invented patient born in **1995**, add any one test.
3. Sign out. Sign in as `cashier@enlogada.com`, open **Billing Queue**, select that patient.
4. Choose **Senior Citizen**, type any ID number, click **Apply**.

**Your tasks**
1. What exactly does the screen say? (Observe)
2. Open the Network tab and click Apply again. Which request is sent? What status comes back? What
   is in the Response? (Read the error)
3. Find the line of code that produced that message. Which file and function? (Trace)
4. Is this a bug, a rule, bad data, or configuration? Why? (Cause)
5. What would you tell the cashier? Is there a case where the right fix is to change data? (Fix)
6. Explain it in two sentences, as if to the panel. (Explain)

<details><summary>Hint 1</summary>

Search the backend for a distinctive part of the red message with `Ctrl+Shift+F`, restricted to
`backend/src`.
</details>

<details><summary>Hint 2</summary>

The request is `POST /api/discounts/visit/<id>`. Follow it: `routes/discountRoutes.js` ->
`controllers/discountController.js` -> `services/discountService.js`.
</details>

<details><summary>Answer</summary>

- Screen: red text under the Apply row: *"The Senior Citizen discount is for patients 60 and over,
  and this patient's record says 31. If the birthdate is wrong, correct it on the patient's record first."*
  (The number is whatever age the birthdate you entered gives.)
- Network: `POST /api/discounts/visit/<id>` -> **400**, `message` = that sentence.
- Code: `backend/src/services/discountService.js`, `applyToVisit`, the block commented `[1.124.0]`:
  it calculates the age from `patients.birthdate` and throws a `ValidationError` under 60.
- Cause: **a rule working as designed** (RA 9994: the Senior Citizen discount is for 60 and over).
  It was added after a test found the system had given a Senior discount to an 11-year-old.
- Fix: no code change. If the patient really is 60+, the **data** is wrong: correct the birthdate
  on the patient's record, then apply again.
- Explanation: "It's not a bug: the server refuses a Senior discount when the patient's recorded
  age is under 60, which the law requires. Either the patient isn't eligible, or their birthdate on
  file is wrong and should be corrected first."
- Clean-up: cancel the practice visit at the Desk.
</details>

---

### Exercise 2: "Nobody can log in" (easy, configuration)

**The report.** *"I type the right email and password, click Sign In, and nothing happens."*

**Set up.** In the terminal running the backend, press `Ctrl+C` to stop it. Leave the frontend running.

**Your tasks**
1. Try to sign in. What do you see on screen?
2. What does the Network tab show for the sign-in request? Is there a status code at all?
3. What does that tell you, and which two places would you compare to confirm it?
4. Fix it and prove it is fixed.

<details><summary>Answer</summary>

- The request `POST http://localhost:5000/api/auth/login` shows **(failed)** /
  `net::ERR_CONNECTION_REFUSED`: no status code, because nothing answered.
- That means nothing is listening at that address. Compare the address the frontend calls
  (`frontend/src/config/api.js`: `VITE_API_BASE_URL`, or `http://localhost:5000/api`) with the
  port the backend prints when it starts ("Server running … on port 5000").
- Fix: start the backend (`cd backend && npm run dev`), sign in again, see 200.
- Real life: this exact symptom happened twice in one week on this project: once another project
  was using port 5000, and once the frontend and backend disagreed about the port.
</details>

---

### Exercise 3: "Kristine can't see the X-Ray History" (medium, roles)

**The report.** *"Kristine works in the laboratory. She says the X-Ray History screen is missing
from her sidebar, but the admin can see it. Fix her account."*

**Your tasks**
1. Sign in as `lab@enlogada.com`. What is in the sidebar? Now as `admin@enlogada.com`.
2. Find where the sidebar decides which screens to show. What decides whether X-Ray History appears?
3. Suppose someone calls the X-Ray results endpoint directly with Kristine's token. What stops them,
   and in which file?
4. Is this a bug? What would you say to the person who reported it?

<details><summary>Answer</summary>

- `frontend/src/config/navigation.js`: each item has a `permission` and, for department screens, a
  `department` (`'Xray'` for X-Ray History). `canSee` hides it from someone whose departments do not
  include X-ray. Admin and SuperAdmin are unrestricted.
- The server checks too: `assertStaffAllowedCategory` in `backend/src/services/resultService.js`
  answers **403** "You are not authorized to act on this test category."
- Not a bug: each department sees its own patients' results (patient privacy). If the clinic really
  wants her to cover X-ray, a SuperAdmin assigns the department to her account under
  **Super Admin -> One person**, which is recorded in the Activity Log. No code change.
</details>

---

### Exercise 4: "The patient can't open her report" (medium, files)

**The report.** A patient calls: *"I can see my result is released, but when I open it the portal
says I have to go to the clinic."*

**Your tasks**
1. Where is the message written? (Search for "given out at the clinic".)
2. What condition triggers it? Why would the clinic want that?
3. What is the status code, and why that one rather than 403 or 500?
4. What can the technician do so the patient can read it online?

<details><summary>Answer</summary>

- `backend/src/services/resultService.js`, `getResultFile`: for a patient (`isClient`), a report
  that is a Word document or spreadsheet is refused with **409**: *"This report is a Word document
  or spreadsheet, so it is given out at the clinic…"*.
- Why: a patient's copy is stamped DIGITAL COPY on every page (`backend/src/utils/digitalCopy.js`)
  against forgery, and a Word or Excel file cannot be stamped. Handing it over unstamped is what the
  rule prevents.
- 409 = "conflicts with the current state" (the file's type), not "you are not allowed" (403) and
  not a crash (500).
- Fix: attach the report as a **PDF** (amend the result), then the portal can stamp and show it.
</details>

---

### Exercise 5: "The till refuses to take the money" (medium, business rules)

**The report.** The cashier: *"The patient wants to pay in cash, I click Take Payment and it says
something about an HMO."*

**Your tasks**
1. Find the message. Which file? (Search "still waiting for the HMO's decision".)
2. Why would the clinic refuse cash here? What would go wrong if it accepted it?
3. What are the cashier's two choices, according to the message?

<details><summary>Answer</summary>

- `backend/src/services/paymentService.js`: a payment is refused while any test on the visit is
  waiting for the HMO's decision: *"… still waiting for the HMO's decision. Wait for it, or charge
  in full and withdraw the claim …"*
- Why: a paid receipt is final (there are no refunds). If the patient pays and the HMO later
  approves, the clinic has been paid twice for one test with no way to give it back.
- Choices: wait for the HMO's decision, or tick "charge in full and withdraw the claim", which
  closes the claim in the same step.
</details>

---

### Exercise 6: "A booking for next Saturday is refused" (medium, data + configuration)

**The report.** *"I tried to book next Saturday at 9 and it says the clinic is closed."*

**Your tasks**
1. Find the message ("The clinic is closed on the selected date").
2. Which two things decide a date's opening hours? (Look for `resolveDay` in
   `backend/src/services/appointmentService.js`.)
3. Where would an admin check or change them?

<details><summary>Answer</summary>

- `appointmentService.js`: `resolveDay` takes the **weekly pattern** (`clinic_operating_hours`) and
  lays any **date override** (`clinic_schedule_overrides`, e.g. a holiday) over it. A closed day
  is refused, with the override's note when there is one.
- An admin checks **Clinic Schedule**: is that date overridden as closed, or is Saturday closed in
  the weekly pattern? If it is, it is correct behaviour; if not, it is wrong data to correct there.
</details>

---

### Exercise 7: "The day's date is wrong before 8 am" (thinking exercise, dates)

**The report.** *"Early in the morning the Today screen shows yesterday's date in one place."*

**Your tasks**
1. Why would something be wrong only before 8 am in the Philippines?
2. Which JavaScript function is famous for this, and what does the project use instead?

<details><summary>Answer</summary>

- The Philippines is **UTC+8**. Before 8 am local time it is still the previous day in UTC.
- `new Date().toISOString()` gives the **UTC** date. The project builds "today" from local time in
  `frontend/src/lib/date.js` (`todayStr`), and on the backend lets the database decide the date
  (`CURRENT_DATE`). This exact bug shipped twice before those rules existed.
</details>

---

### Exercise 8: "The total doesn't match the list" (thinking exercise, money)

**The question.** Cashier Monitoring shows "Collected ₱95,672" for two months, but the table shows
only 20 receipts. Someone adds up those 20 and gets a much smaller number. Is the total wrong?

<details><summary>Answer</summary>

- No. The table is **one page** of 20 receipts (paged at the server). The total comes from the
  server's `summary`, calculated in SQL over **every** receipt in the date range
  (`paymentRepository.findTransactionSummary`).
- The rule in this project: a money total never comes from the rows on the screen. Adding up a
  page totals only that page.
</details>

---

### Exercise 9: follow a search through every layer (harder, code reading)

**The task.** In **Laboratory History**, typing a patient's surname finds their old reports, even
from months ago. Trace exactly how.

1. Which hook sends the request, and what parameters does it send?
2. Why does the search wait a moment after you stop typing before it asks the server?
3. Which repository function runs the search, and which columns does it search?
4. Why does the footer's total stay correct when you are on page 3?

<details><summary>Answer</summary>

1. `frontend/src/hooks/useDiagnosticWorklist.js`, `fetchReleased`: `GET /api/results/released/Laboratory`
   with `page`, `limit` (10), `search`, and `delivery` when filtered.
2. A **debounce** of 300 ms (`historySearch`): one request when you pause, not one per keystroke.
3. `backend/src/repositories/resultRepository.js`, `findReleasedByCategory`: an `ILIKE` on the
   patient's name (both orders), the test name and the queue number.
4. The query returns `COUNT(*) OVER()` (every matching row before `LIMIT`) as `total_count`;
   the service turns it into `total` and `totalPages`.
</details>

---

### Exercise 10: read a 500 (harder, backend)

**The question.** A screen shows "Something went wrong", and the Network tab shows **500**. The
backend terminal shows `[ERROR]` followed by about 15 lines starting with `at …`.

1. What are those lines called, and how do you read them?
2. Why does the browser show "Something went wrong" instead of the real message in production?
3. What is the difference between a 400 and a 500, from the point of view of "whose fault"?

<details><summary>Answer</summary>

1. A **stack trace**: the chain of function calls the error passed through, newest first. Read
   down until the first line in *our* code (`backend/src/...`); that file and line is where to look.
2. `middlewares/errorHandler.js` hides 5xx messages outside development, because they can reveal
   internals. The full error is only in the server's log.
3. 4xx: the request was refused (the user's data, rights or timing). 5xx: the server failed to
   handle a request it should have handled: our bug, or a lost database connection.
</details>

---

## Part B: questions a panel may ask

Practise answering out loud in two or three sentences. Then open the model answer.

1. **"Where is the login handled, from the button to the database?"**
   <details><summary>Model answer</summary>`LoginForm.jsx` calls `login()` in `AuthContext.jsx`, which posts to `/api/auth/login`. The route goes to `authController.login`, then `authService.login`, which looks the user up with `userRepository.findByEmail`, checks the password with bcrypt, counts failures and locks after 10, and returns a token. The browser stores the token and sends it with every later request.</details>

2. **"Why can't a cashier open the Reports screen?"**
   <details><summary>Model answer</summary>Reports needs the `reports:view` permission. The sidebar hides it (`canSee` in `navigation.js`), and the server refuses it with 403 in the route (`authorizePermissions('reports:view')`). The server check is the one that matters; hiding the button is just good manners.</details>

3. **"Why do you check permissions on the server if the screen already hides the button?"**
   <details><summary>Model answer</summary>Anyone can send a request without our screens (with a browser tool or a script). The screen is a convenience; the server is the lock.</details>

4. **"Explain the relationship between patients, visits and tests."**
   <details><summary>Model answer</summary>One patient has many visits (`patient_visits.patient_id`). One visit has many tests (`visit_tests.patient_visit_id`), each with the price at the time. Each test can have a report in `test_results`, with one row per version.</details>

5. **"What happens if the server crashes halfway through releasing a result?"**
   <details><summary>Model answer</summary>The three writes (test status, result release, visit status) run inside `db.withTransaction`, so either all are saved or none are. You never get a test marked Completed with an unreleased report.</details>

6. **"How do you know your fix works and didn't break something else?"**
   <details><summary>Model answer</summary>I repeat the steps that showed the bug and see the right result, check the neighbouring feature by hand, then run the unit tests and the end-to-end spec for that feature. The project has about 250 unit tests and about 500 end-to-end tests.</details>

7. **"What is a limitation of your system?"**
   <details><summary>Model answer</summary>Online checkout through a gateway is built but switched off until the clinic has a merchant account; today patients pay to the clinic's GCash and upload proof for a cashier to check. HMO claims are recorded by staff, not exchanged with the insurer's system.</details>

8. **"Why is the error for a wrong password the same as for an unknown email?"**
   <details><summary>Model answer</summary>So nobody can use the sign-in form to find out which email addresses have accounts. It's deliberate, not a vague error.</details>
