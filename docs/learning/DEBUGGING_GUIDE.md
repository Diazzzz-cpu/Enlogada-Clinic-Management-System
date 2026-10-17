# How to debug this system, step by step

## The method: eight steps, every time

```
Observe -> Reproduce -> Read the error -> Trace the code -> Find the cause -> Minimal fix -> Retest -> Explain
```

| Step | What you do | The question you answer |
|---|---|---|
| 1. **Observe** | Look at exactly what the user sees. Write it down word for word. | What is wrong, for whom, on which screen? |
| 2. **Reproduce** | Do it yourself with a test account (`TEST_ACCOUNTS.md`). | Can I make it happen again, on purpose? |
| 3. **Read the error** | Browser Console, Network tab (status + Response), backend terminal. | What did the system itself say? |
| 4. **Trace the code** | Follow the request: screen -> hook -> `api` call -> route -> controller -> service -> repository. | Which line made that decision? |
| 5. **Find the cause** | Decide: is it a **bug**, a **rule** working as designed, **bad data**, or **configuration**? | Why did it happen? |
| 6. **Minimal fix** | Change the smallest thing that fixes the cause. Do not rewrite the feature. | What is the one change? |
| 7. **Retest** | Repeat step 2. Then check the feature next to it still works, and run the tests. | Is it fixed, and did I break anything? |
| 8. **Explain** | Say it in two sentences: what caused it, what you changed. | Can I defend this fix? |

**Step 5 matters most.** Many "bugs" in this system are rules doing their job: a paid receipt
cannot be refunded, a Senior discount needs the patient to be 60, a booking cannot be made on a
day the clinic is closed. If it is a rule, the "fix" is explaining it, or correcting the data, not
changing code.

---

## Your tools, and what to look at in each

### Browser Developer Tools (press `F12`)

**Console tab.** Red lines are JavaScript errors in the browser. Read the first one; the rest are
often consequences. "Cannot read properties of undefined (reading 'x')" means the code expected data
that was not there: usually a request failed or returned a different shape.

**Network tab.** The most useful tool you have.
1. Open it **before** you click, and tick **Preserve log**.
2. Click the thing that fails.
3. Find the request (filter by `Fetch/XHR`). Red rows failed.
4. Click it and read:
   - **Headers**: the URL and method. Is it going to the right address (`localhost:5000/api/...`)?
   - **Payload**: what the browser sent. Is the data what you typed?
   - **Response**: what the server answered. Look for `message`.
   - **Status**: the code (see the table below).

If there is **no request at all**, the problem is in the browser: the button's code never called
the server (the button is disabled, a check in the hook stopped it, or a JavaScript error happened
first; look at the Console).

**Application tab -> Local Storage -> http://localhost:5173.** The `token` key is your sign-in. If it
is missing you are signed out. Deleting it signs you out.

### The backend terminal (where `npm run dev` runs)

Every request prints a line with its status. A refusal raised inside a service also prints a
WARN line with its message:

```
2026-10-17 09:15:02 [INFO]:  POST /api/discounts/visit/123 400 12.345 ms - 160
2026-10-17 09:15:02 [WARN]:  400 POST /api/discounts/visit/123 — The Senior Citizen discount is for patients 60 and over, …
```

Not every refusal gets a WARN line: the security checks in `middlewares/auth.js` (401/403) and a
few checks written directly in controllers answer straight away, so for those you only see the
status on the request line. The browser's Network tab always shows the message.

In development it also prints every SQL query (`[DEBUG]: Executing query: …`).
A **500** prints `[ERROR]` with a **stack trace**: the list of files and line numbers the error
passed through. Read from the top; the first line that names one of *our* files
(`backend/src/...`) is where to look.

### The database (pgAdmin 4, or psql)

pgAdmin 4 is installed with PostgreSQL 18 on this PC. Open the database named in `backend/.env`
(`DATABASE_URL`) and use the Query Tool. **Only run `SELECT` queries** while investigating:

```sql
-- the latest visits, newest first
SELECT id, queue_number, status, created_at FROM patient_visits ORDER BY id DESC LIMIT 10;

-- one patient's visits and tests
SELECT pv.id, pv.status, t.name, vt.status AS test_status
  FROM patient_visits pv
  JOIN visit_tests vt ON vt.patient_visit_id = pv.id
  JOIN tests t ON t.id = vt.test_id
 WHERE pv.patient_id = 7
 ORDER BY pv.id DESC;

-- what a result's versions look like
SELECT id, version, is_current, authorised_at FROM test_results WHERE visit_test_id = 123 ORDER BY version;
```

Never run `UPDATE`, `DELETE` or `DROP` on real data to "fix" something while investigating. If data
must change, do it through the app (it records who did it) or ask first.

---

## Procedures for common problems

### "Nothing happens when I click the button"
1. Is the button **disabled**? (greyed out). Find it in the code and read its `disabled={…}` condition.
2. Network tab: did a request go out? If **no**, the code stopped in the browser: check the Console,
   and read the hook function the button calls (often it returns early, e.g. `if (!selectedVisit) return;`).
3. If **yes**, read its status and Response, and continue below.

### "The form won't save"
1. Network tab -> the request -> **Payload**: is every field there, with the right name?
2. **Response** `message`: copy it, search for it in `backend/src` (`Ctrl+Shift+F`). That finds
   the exact check that refused it.
3. Decide: wrong input (tell the user), a rule (explain it), or a bug (the check is wrong).

### By status code

| Code | First thing to check |
|---|---|
| **400** | The Response `message`. Search for it. It names the rule. |
| **401** | Are you signed in? Is `token` in Local Storage? Did the password change (that ends older sessions)? The app signs you out on any 401. |
| **403** | Which permission? The message says "Required permissions: …". Compare with the account's role in Super Admin -> Who sees what. `node src/scripts/verifyRbacWiring.js` checks the whole permission setup. |
| **404** | Is the **id** in the URL right? If the Response is an **HTML page** ("Cannot POST /api/…"), the **address** is wrong: a typo, or the wrong server on that port. |
| **409** | The data is in a state that forbids this (already paid, already exists). Read the message; usually correct behaviour. |
| **423** | The account is locked: 10 failed sign-ins locks it for 15 minutes. Wait, or an admin resets the password. |
| **429** | Too many requests. In development, restart the backend to reset the counter. |
| **500** | Our fault. Read the `[ERROR]` and stack trace in the backend terminal. |
| **(failed) / ERR_CONNECTION_REFUSED** | Nothing is listening at that address. Is the backend running? On which port? |
| **CORS error** in the Console | The backend refused the page's address. `FRONTEND_URL` / `CORS_ORIGINS` in `backend/.env` must include the address in your browser's bar. |

### "I can't log in"
1. Network tab -> `POST /api/auth/login`.
2. No response / connection refused -> the backend is not running, or the frontend calls the wrong
   port. Compare the URL with the port printed when the backend started ("Server running … on port 5000").
3. 401 -> wrong email/password (or the account is deactivated). 423 -> locked. 429 -> rate limit.
4. 200 but you bounce back to sign-in -> a later request answered 401; find it in the Network tab.

### "This role cannot see a screen / button"
1. Is the screen in the sidebar? `frontend/src/config/navigation.js` decides, through `canSee`
   (role, permission and department).
2. Is a button missing on a screen they can open? Screens hide actions the account's permissions
   would not allow (search the component for `hasPermission(`).
3. The server has the final word: the route's `authorizePermissions(...)` in `backend/src/routes/`.

### "The numbers are wrong" (reports, totals)
1. Write down the exact figure, screen, and date range.
2. Find the request in the Network tab; compare the Response with the screen. Same number? Then the
   backend computed it: find the query in `backend/src/repositories/` (`reportRepository.js`,
   `paymentRepository.js`).
3. Recalculate it yourself with a `SELECT` for the same date range.
4. Remember the money rules: totals come from the server's `summary`, never from adding up the rows
   on a page; an approved HMO claim is money **owed**, never takings.

### "The list is empty", or "search doesn't find it"
1. Is it a **today** screen? Data from yesterday will not show today. (Demo data: re-run `npm run demo`.)
2. Network tab: what did the request send (date range, `page`, `search`) and how many rows came back?
3. Is the list **paged**? Check the page number and the total in the footer.

### "Dates are a day off"
The Philippines is UTC+8. JavaScript's `toISOString()` gives the UTC date, which is *yesterday*
before 8 am here. The project uses `frontend/src/lib/date.js` (`todayStr`) for that reason. Look for
`toISOString()` near the bug.

### "The patient can't open their report"
Read the message. A Word or Excel report cannot be marked "DIGITAL COPY", so the portal refuses it
on purpose (409) and says to collect it at the clinic. The rule is in
`backend/src/services/resultService.js` (`getResultFile`).

### "It worked yesterday" / "it only breaks on my PC"
Configuration. Check, in order: both servers running, the ports, `backend/.env` and `frontend/.env`
(after changing `frontend/.env`, **restart** `npm run dev`; `VITE_…` values are read only at start),
the database is running.

---

## Safety rules

- Investigate with test accounts and the development database, never the clinic's live one.
- Read before you change. Change the smallest thing.
- Never paste the contents of `.env` files anywhere: they contain passwords.
- After a fix, run the tests: `cd backend && npm test`, `cd frontend && npm run test:unit`, and the
  related end-to-end spec (`cd frontend && npx playwright test tests/e2e/<name>.spec.js`).
- If you are not sure whether something is a bug or a rule, say so, and say how you would find out.
