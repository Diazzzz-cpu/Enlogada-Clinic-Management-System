# Learning progress

Updated after every practice session. Honest notes beat flattering ones: the point is to know what
to practise next.

## Starting point (2026-10-17)

- Level: beginner. Comfortable with basic programming ideas; not yet confident reading backend
  code, tracing a request, or fixing bugs alone.
- Goal: investigate and explain problems in this system in front of a panel, even when the fix is
  not immediately obvious.
- **The actual test format:** the instructor will break the system on purpose and ask for it to be
  fixed live. So the practice focus is **planted-bug drills**: a small deliberate break, found from
  its symptom, fixed with the smallest change, then explained. See "When someone has broken the
  code on purpose" in `DEBUGGING_GUIDE.md`.

## Planted-bug drills

Each drill is made on a local `practice/...` git branch that is never pushed, and thrown away after.

| # | Symptom given | Layer | Status | Notes |
|---|---|---|---|---|
| 1 | Applying any discount fails with "Could not apply the discount." | (found by you) | Started | |

## Learning path

Tick a stage when you can do its check without notes.

- [ ] **1. Run it and watch it.** Start both servers, sign in, and find `POST /api/auth/login` in
      the Network tab.
      *Check:* say what the status and the Response mean.
- [ ] **2. One request, browser side.** `config/api.js`, `AuthContext.jsx` (`login`), `App.jsx`.
      *Check:* explain where the token is kept and how it reaches the server.
- [ ] **3. The backend's front door.** `backend/src/app.js` and the `routes/` folder.
      *Check:* given a URL like `/api/payments/...`, open the right route file.
- [ ] **4. The four layers, with one feature.** The discount flow in `API_AND_DATABASE_FLOW.md`.
      *Check:* name the route, controller, service and repository function for it.
- [ ] **5. Errors and status codes.** `middlewares/errorHandler.js`, `errors/index.js`.
      *Check:* explain 400 vs 401 vs 403 vs 409 vs 500 with an example from this system.
- [ ] **6. Who may do what.** `middlewares/auth.js`, `frontend/src/config/navigation.js`.
      *Check:* explain why a cashier cannot open Reports, at both the screen and the server.
- [ ] **7. The database.** `database/schema.sql`, pgAdmin, read-only `SELECT`s.
      *Check:* draw patients -> visits -> tests -> results, and query one patient's visits.
- [ ] **8. The harder features.** Payments, HMO claims, result versions, reports.
      *Check:* explain why a paid receipt is final, and what `is_current` and `authorised_at` mean.
- [ ] **9. Tests as a safety net.** `npm test`, `npm run test:unit`, one Playwright spec.
      *Check:* run the tests for a feature you changed and read the result.

## Exercises (`PRACTICE_QUESTIONS.md`)

| # | Exercise | Status | Notes |
|---|---|---|---|
| 1 | The discount won't go through | Done (2026-10-17) | Found the rule from the message alone. Mixed up "bad data" and "bug" on the twist. |
| 2 | Nobody can log in | Not started | |
| 3 | Kristine can't see X-Ray History | Not started | |
| 4 | The patient can't open her report | Not started | |
| 5 | The till refuses to take the money | Not started | |
| 6 | A booking for Saturday is refused | Not started | |
| 7 | The date is wrong before 8 am | Not started | |
| 8 | The total doesn't match the list | Not started | |
| 9 | Follow a search through every layer | Not started | |
| 10 | Read a 500 | Not started | |

## Session log

### Session 1 (2026-10-17)
- **Covered:** the overview of the system, the five most important files, the five most likely
  trouble areas, the learning path.
- **Exercise 1, done.** Read the red message on screen, found the request in the Network tab
  (400), saw the Response `message` matched the screen, searched the backend for a fixed part of
  the message and landed on the age check in `backend/src/services/discountService.js`
  (`applyToVisit`). Called it a rule, correctly.
- **Mistakes to learn from:**
  - First guess was that the OSCA/PWD ID box showing was the bug. It is required by law: a
    Senior/PWD discount must record the ID number. Lesson: read the actual error before guessing.
  - The Network tab looked empty: the **Font** type filter was on. Use **Fetch/XHR** or **All**.
    Chrome's "Keep log" is the old "Preserve log".
  - Called "the record says 31 but the patient is really 65" a bug. It is **bad data**: the code
    is right, the birthdate on file is wrong. Test: fix the data; if it then works with no code
    change, it was bad data.
  - Described a 400 as "a bad request from the frontend". The request was fine; the server refused
    it because it breaks a rule. HTTP's name "Bad Request" is misleading.
- **Practise next:** the bug / rule / bad data / configuration quick check, then Exercise 2.

## Concepts learned

- A **400** means the server refused the request, usually because of a rule. It does not mean the
  system is broken.
- The frontend often just **repeats** the server's message (`setDiscountError(err.response?.data?.message …)`
  in `useCheckout.js`), so the sentence on screen can be searched for in `backend/src`.
- Search with words that never change: not names or numbers, which the code fills in (`${discount.name}`).
- `throw new ValidationError(…)` stops the work and becomes a 400 through `errorHandler.js`.
- Bug vs bad data: a bug is the code doing the wrong thing with correct data; bad data is the code
  doing the right thing with wrong data.
- A strong explanation: **what happened → where the rule is → why it exists → what to do.**

## Things I still find confusing

(Write them down; they are the next session's topics.)
