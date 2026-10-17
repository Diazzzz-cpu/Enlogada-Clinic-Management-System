# Learning progress

Updated after every practice session. Honest notes beat flattering ones: the point is to know what
to practise next.

## Starting point (2026-10-17)

- Level: beginner. Comfortable with basic programming ideas; not yet confident reading backend
  code, tracing a request, or fixing bugs alone.
- Goal: investigate and explain problems in this system in front of a panel, even when the fix is
  not immediately obvious.

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
| 1 | The discount won't go through | Assigned | |
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
- **Assigned:** Exercise 1.
- **Mistakes to learn from:** none yet.
- **Practise next:** Exercise 1, then stage 1 of the learning path.

## Concepts learned

(Add a line each time a concept clicks, in your own words.)

## Things I still find confusing

(Write them down; they are the next session's topics.)
