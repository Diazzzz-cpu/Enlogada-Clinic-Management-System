# From a click to the database and back

How a request travels through the system, with three real examples. Every file and function named
here exists; open them beside this page.

---

## The words you need

| Word | Plain meaning |
|---|---|
| **Request** | A message the browser sends to the server: a method, an address, sometimes data. |
| **Method** | What kind of request: `GET` (read), `POST` (create or do something), `PUT`/`PATCH` (change), `DELETE` (remove). |
| **Endpoint / route** | An address on the server, e.g. `POST /api/auth/login`. |
| **JSON** | The text format the data travels in: `{ "email": "...", "password": "..." }`. |
| **Response** | The server's answer: a **status code** and usually JSON. |
| **Status code** | A three-digit number saying how it went: 2xx OK, 4xx your request was refused, 5xx the server failed. |
| **Token (JWT)** | A signed pass the server gives you at sign-in. The browser shows it on every request to prove who you are. |
| **Middleware** | A check that runs before the real work, like `verifyToken`. |
| **Repository** | The only kind of file allowed to talk SQL to the database. |
| **Transaction** | Several database changes that must all succeed or all be undone (`db.withTransaction`). |

---

## Example 1: signing in

```
LoginForm.jsx  --login(email, password)-->  AuthContext.jsx
                                               |  api.post('/auth/login', { email, password })
                                               v
                                   config/api.js  (adds nothing yet: no token before sign-in)
                                               |
                       POST http://localhost:5000/api/auth/login
                                               v
   app.js  --(rate limit: authLimiter counts failed sign-ins)-->  routes/authRoutes.js
                                               |  router.post('/login', authController.login)
                                               v
   controllers/authController.js  login()
        - email or password missing?  -> 400 "Email and password are required fields."
        - calls authService.login({ email, password })
                                               v
   services/authService.js  login()
        - userRepository.findByEmail(...)        no such account?  -> 401 "Invalid email or password"
        - account locked?                         -> 423 "Too many failed sign-in attempts…"
        - bcrypt.compare(password, password_hash) wrong?
              -> count the failure; at 10 in a row lock for 15 minutes
              -> 401 "Invalid email or password"   (same words on purpose: nobody can tell which part was wrong)
        - right?  -> clear the failures, return a session (token + user)
                                               v
   repositories/userRepository.js  findByEmail()   SELECT … FROM users …
                                               v
   back up the chain:  200 { status: "success", data: { token, user } }
                                               v
   AuthContext saves the token in localStorage('token') and sets `user`
   App.jsx sees a user and shows their first screen (Today, or the portal)
```

**Things to notice**
- An unknown email and a wrong password give the **same** answer. That is deliberate (security), not a bug.
- After sign-in, `config/api.js` reads that saved token and sends it with every request as
  `Authorization: Bearer …`. `middlewares/auth.js` `verifyToken` checks it on the server.

---

## Example 2: the cashier applies a Senior Citizen discount

```
components/cashier/CheckoutTerminal.jsx
   the discount type dropdown, the "OSCA / PWD ID number" box, and the Apply button
   onClick={checkout.applyDiscount}
                    |
                    v
hooks/useCheckout.js  applyDiscount()
   api.post(`/discounts/visit/${selectedVisit.id}`, { discountTypeId, idNumber })
                    |
     POST /api/discounts/visit/123     with  Authorization: Bearer <token>
                    v
routes/discountRoutes.js   router.post('/visit/:visitId',
                               verifyToken,                          -> 401 if not signed in
                               authorizeRoles(...DISCOUNT_GRANT_ROLES), -> 403 if the wrong role
                               authorizePermissions('billing:discount'), -> 403 if the permission is missing
                               discountController.applyToVisit)
                    v
controllers/discountController.js  applyToVisit()
   - no discountTypeId?  -> 400 "A discount type is required."
   - calls discountService.applyToVisit(visitId, { discountTypeId, idNumber }, req.user)
                    v
services/discountService.js  applyToVisit()     <- the business rules live here
   - the visit must exist                                 -> 404 "Visit not found"
   - the visit must not be paid yet                       -> 409 "This visit has already been paid, …"
   - the discount must exist and be switched on           -> 400
   - requires the OSCA/PWD ID number when the discount needs one   -> 400
   - Senior Citizen: works out the patient's age from their birthdate;
     under 60  -> 400 "The Senior Citizen discount is for patients 60 and over, and this patient's record says 34. …"
   - calls discountRepository.applyToVisit(...)
                    v
repositories/discountRepository.js  applyToVisit()
   UPDATE patient_visits
      SET discount_type_id = $2, discount_id_number = $3,
          discount_granted_by = $4, discount_granted_at = CURRENT_TIMESTAMP
    WHERE id = $1
                    v
200 { status: "success", … }   ->  useCheckout re-reads the bill (refreshBill) so the new total shows
   or
400 { status: "error", message: "…" }  ->  useCheckout puts the message in `discountError`,
                                            which CheckoutTerminal shows in red under the Apply row
```

**Things to notice**
- The **security** checks are in the route. The **business rules** are in the service. The **SQL**
  is in the repository. When something is refused, the message tells you which kind of check it was.
- `$1`, `$2` in the SQL are **placeholders**. The values are sent separately, so a patient called
  `O'Brien` or a malicious input cannot break the SQL. Never build SQL by gluing strings together.

---

## Example 3: a laboratory technician releases a report

```
hooks/useResultEntry.js
   api.post(`/results/${activeTest.visit_test_id}/release`)
                    v
routes/resultRoutes.js   router.post('/:visitTestId/release', verifyToken, authorizeStaff,
                                     authorizePermissions('results:release'), resultController.releaseResult)
                    v
services/resultService.js  releaseResult()
   - the result exists and has its report file attached        (else 400)
   - db.withTransaction(async () => {          <- three writes that must succeed together
        testRepository.updateVisitTestStatus(visitTestId, 'Completed')
        resultRepository.markReleased(visitTestId, releasedBy, generateCode())
              -> sets authorised_at (the moment it was released) and a verification code
        if nothing else on the visit is outstanding:
           visitRepository.updateVisitStatus(visitId, 'Completed')
     })
   - after the transaction: notify the front desk and admins
                    v
200 with the result, isAmendment, patientEmail and verificationCode
```

**Why a transaction.** If the server failed halfway, without it the test could say "Completed"
while the report says "not released". With it, either all three changes happen or none do.

---

## How the tables connect (the ones you will meet most)

```
patients ──< patient_visits ──< visit_tests ──< test_results
                 │                    │
                 │                    └── tests ── test_categories
                 ├──< payments
                 ├──  appointments
                 └──  hmo_requests ──< hmo_request_tests
users ──< patients        users ──< user_roles >── roles ──< role_permissions >── permissions
```

`──<` means "one to many": one patient has many visits; one visit has many tests.

Two rules about `test_results` that trip people up:
1. **It keeps every version of a report.** A correction adds a new row and marks the old one
   `is_current = false`. When you look at "the" report, filter on `is_current = true`.
2. **"Released" means `authorised_at` is filled in, not `released_at`.** `released_at` is set when
   the report is first SAVED, even as a draft. The column name is misleading; the code uses
   `authorised_at`.

---

## Status codes in this system, and where they come from

| Code | Means | Usually comes from |
|---|---|---|
| 200 / 201 | OK / created | the controller's `res.status(200).json(…)` |
| 304 | Not modified: the browser's copy is still right | Express's ETag check; `config/revalidationCache.js` reuses the old data |
| 400 | Your data was refused (missing, invalid, or against a rule) | a controller check, a service `ValidationError`, or a database rule translated by `errors/index.js` |
| 401 | Not signed in, or the sign-in expired | `verifyToken`, or a wrong password at login. **The app signs you out on any 401** (`config/api.js`). |
| 403 | Signed in, but not allowed | `authorizeRoles` / `authorizeStaff` / `authorizePermissions`, or an ownership check in a service ("This result does not belong to your account") |
| 404 | It does not exist: a wrong id, or a wrong address | a service (`NotFoundError`), or Express itself for an unknown URL (then the response is an **HTML page**, not JSON: check the address) |
| 409 | It clashes with the current state (already paid, already exists, still in use) | a service `ConflictError` or a unique constraint |
| 423 | The account is locked after too many failed sign-ins | `authService.login` |
| 429 | Too many requests | the rate limiters in `app.js` |
| 500 | The server itself failed | a bug, a lost database connection, or a mistake in our SQL. The backend terminal shows the full error. |
