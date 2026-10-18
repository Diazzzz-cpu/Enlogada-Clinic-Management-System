# How the Enlogada system works

A beginner's map of the whole system. Read this first, then the other files in this folder.

| File | Read it when |
|---|---|
| `SYSTEM_OVERVIEW.md` (this file) | You want the big picture |
| `IMPORTANT_FILES.md` | You want to know which files matter and why |
| `API_AND_DATABASE_FLOW.md` | You want to follow one click from the browser to the database and back |
| `DEBUGGING_GUIDE.md` | Something is broken and you need a method |
| `LIVE_DEBUGGING_CHEATSHEET.md` | You are in front of the panel and need the short version |
| `PRACTICE_QUESTIONS.md` | You want to practise |
| `LEARNING_PROGRESS.md` | You want to see what you have covered and what is next |

Deeper, more technical documents already exist at the top of the project. You do not need them yet:
`CODEBASE_SYSTEM_OVERVIEW.md` (the full technical description), `CLAUDE.md` (every rule and why it
exists) and `DIAGNOSTIC_RUNBOOK.md` (how to run and read the automated tests).

---

## 1. What the system is for

Enlogada is a diagnostic clinic in Bugo, Cagayan de Oro. It offers three services: **Laboratory**,
**Ultrasound** and **Digital X-Ray**. The system runs the path a patient takes through the clinic:

```
 Book online or walk in
        |
        v
 Front desk (the Desk)  ->  Billing Queue (cashier)  ->  Department worklist (lab / ultrasound / x-ray)
                                                                  |
                                                                  v
                                       Report released  ->  Patient portal / email  ->  Anyone can verify it
```

X-ray is the exception: the X-ray department gives its results through its own system, so its
worklist only marks an exam **done**. It still queues, bills and counts here.

It also keeps the money records (receipts, discounts, HMO claims), reports for the owner, patient
feedback, and an activity log of who did what.

**Who uses it.** Each person signs in and sees only the screens their role allows:

| Role | What they do | Their main screens |
|---|---|---|
| Receptionist | Registers walk-ins, checks in bookings | Desk, Visit History |
| Cashier | Takes payments, checks online payment proofs | Billing Queue, Online Payments, Transaction History |
| Laboratory / Ultrasound Staff | Does the test, attaches and releases the report | Worklist, History |
| X-ray Staff | Does the exam and marks it done (no report here) | X-Ray Worklist, X-Ray History |
| Admin | Manages the clinic: staff, services, reports | Reports, Staff Accounts, Services Catalog, and more |
| SuperAdmin | Everything Admin can, plus who-can-do-what | Super Admin |
| Client (patient) | Books, pays, reads their own results | The patient portal |

A member of staff can hold more than one role (a cashier who also covers the desk) and gets
everything each role allows; an Admin sets them on **Staff Accounts** → **Roles**.

Every member of staff lands on **Today** after signing in. The test accounts are listed in
`TEST_ACCOUNTS.md` at the top of the project.

---

## 2. The three parts of the system

Think of a restaurant:

| Restaurant | This system | Technology | Folder |
|---|---|---|---|
| The dining room, where customers see and order | **Frontend**: the screens in the browser | React (JavaScript), built by Vite | `frontend/` |
| The waiter who carries orders and food | **API requests**: messages between browser and server | HTTP + JSON, sent with Axios | `frontend/src/config/api.js` |
| The kitchen, where the work is done and rules are followed | **Backend**: the server | Node.js + Express | `backend/` |
| The pantry, where everything is stored | **Database** | PostgreSQL | `database/schema.sql` describes it |

The frontend **never** touches the database directly. It always asks the backend, and the backend
decides whether the request is allowed and correct.

```
  Browser (React)                     Server (Express)                      Database (PostgreSQL)
  ---------------                     ----------------                      ---------------------
  You click "Apply"   --- request -->  Is this person signed in?
                       POST /api/...    Are they allowed?
                       + token          Is the data valid?
                                        Run the business rule       --- SQL -->   UPDATE / SELECT
                                                                    <-- rows ---
                      <-- response ---  { status: "success", data }
  Screen updates                        or { status: "error", message }
```

Ports when running on your PC:
- the screens: `http://localhost:5173`
- the API: `http://localhost:5000/api`

---

## 3. How a request is handled inside the backend

The backend is split into **layers**. Each layer has one job, like stations in a kitchen:

```
routes/        ->  controllers/      ->  services/          ->  repositories/       ->  PostgreSQL
"which URL?"       "read the request,    "the business          "the SQL, and only
 + security         call the service,     rules"                  the SQL"
 checks             send the answer"
```

Example, with real names (applying a Senior Citizen discount):

| Layer | File | Function |
|---|---|---|
| Route | `backend/src/routes/discountRoutes.js` | `POST /visit/:visitId`, with `verifyToken`, `authorizeRoles`, `authorizePermissions('billing:discount')` |
| Controller | `backend/src/controllers/discountController.js` | `applyToVisit` |
| Service | `backend/src/services/discountService.js` | `applyToVisit`: the rules (an ID number, age 60+ for Senior) |
| Repository | `backend/src/repositories/discountRepository.js` | `applyToVisit`: `UPDATE patient_visits SET discount_type_id = …` |

`API_AND_DATABASE_FLOW.md` walks through this one step by step.

---

## 4. How the frontend is organised

```
frontend/src/
  main.jsx            starts the app
  App.jsx             decides which screen to show (there is no router library; App.jsx does it)
  config/api.js       the one place every request to the server goes through
  config/navigation.js  the sidebar: every screen, and who may see it
  contexts/AuthContext.jsx  who is signed in
  pages/              whole screens (public, auth, portal, clinic, admin)
  components/         pieces of screens (buttons, tables, dialogs, panels)
  hooks/              the logic behind a screen, mostly "fetch this, keep it in state"
  lib/                small helpers (dates, money, rules)
```

A typical screen works like this:

```
Screen component (pages/ or components/)  -- uses -->  a hook (hooks/useSomething.js)
                                                            |
                                                            v
                                                  api.get / api.post (config/api.js)
                                                            |
                                                            v
                                                     the backend API
```

---

## 5. How the database is organised

The main tables, and how they link (an arrow means "belongs to"):

```
users  (a sign-in account)
  |
  +-- patients            (a person's record; one account can hold several, e.g. a parent and children)
        |
        +-- patient_visits     (one trip to the clinic: queue number, status, discount)
              |
              +-- visit_tests       (each test on that visit, with the price at the time)
              |     |
              |     +-- test_results     (the report; one row per VERSION, the live one has is_current = true)
              |
              +-- payments          (the receipt for the visit)
              +-- appointments      (if the visit was booked online)
              +-- hmo_requests      (if an insurer (HMO) is asked to cover it)

tests  ->  test_categories   (the price list: Laboratory, Ultrasound, Xray)
roles, permissions, user_roles, user_permissions   (who may do what)
audit_log                                          (who did what, and when)
```

The full list of 33 tables is in `database/schema.sql`, which is the blueprint the database is built from.

---

## 6. Running it on your PC

Two terminals, one for each server:

```bash
cd backend
npm run dev        # the API on port 5000; restarts itself when you save a backend file

cd frontend
npm run dev        # the screens on port 5173
```

Then open `http://localhost:5173`. Settings (database address, secrets) live in `backend/.env` and
`frontend/.env`. **Never show those files to anyone or paste them anywhere**: they hold passwords.

---

## 7. Things that are deliberately unfinished or limited

Be honest about these if asked:

- **Online card/GCash checkout (PayMongo)** is built but switched off: it needs a merchant account
  and keys. Patients pay to the clinic's GCash/bank instead and upload proof; a cashier checks it.
- **The verification QR** on a patient's report only works from another phone when the site is
  hosted online (or on the same Wi-Fi with `npm run dev:lan`). On `localhost` it only works on your PC.
- **HMO claims** are recorded by staff; the system does not talk to the insurers' own systems.
- **No refunds and no voids** on purpose: a paid receipt is final (the clinic's decision).
