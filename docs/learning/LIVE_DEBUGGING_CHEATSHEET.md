# Live debugging cheat sheet

One page. Keep it open during the demonstration.

## Say the method out loud

> "First I'll reproduce it. Then I'll read what the system says: the Network tab and the backend
> log. Then I'll trace the request through the layers to the line that decided it, and check
> whether it's a bug or a rule working as designed."

**Observe -> Reproduce -> Read the error -> Trace -> Cause -> Minimal fix -> Retest -> Explain**

## Start everything

```bash
cd backend  && npm run dev      # API      -> http://localhost:5000/api
cd frontend && npm run dev      # screens  -> http://localhost:5173
```
Backend started correctly when the terminal says `Server running in development mode on port 5000`
and `Database connected successfully`.

## Check first

1. Are **both** servers running? On the expected ports?
2. Network tab open **before** clicking, **Keep log** ticked (old name: Preserve log), filter on
   **Fetch/XHR** or **All**.
3. The request's **URL**, **status**, **Response `message`**.
4. The backend terminal line for that request (and WARN / ERROR under it).
5. Signed in as the right **role**? (`TEST_ACCOUNTS.md`)
6. Is it a **today** screen showing yesterday's data?

## Status codes

| | Meaning | Look at |
|---|---|---|
| 400 | Data refused | Response `message`, search it in `backend/src` |
| 401 | Not signed in / expired | Local Storage `token`; the app signs you out |
| 403 | Not allowed | "Required permissions: …"; the route's `authorizePermissions` |
| 404 | Not found | the id in the URL; an HTML response means a wrong address |
| 409 | Clashes with current state | usually correct behaviour, e.g. already paid |
| 423 | Account locked | 10 failed sign-ins, 15 minutes |
| 429 | Too many requests | restart the backend (development) |
| 500 | Our bug | `[ERROR]` + stack trace in the backend terminal |
| connection refused | Nothing listening | server not running / wrong port |
| CORS error | Address not allowed | `FRONTEND_URL`, `CORS_ORIGINS` in `backend/.env` |

## Where things live

| I see… | Look in… |
|---|---|
| a screen, a button, a label | `Ctrl+Shift+F` the exact text -> `frontend/src/pages/` or `components/` |
| what a screen fetches | its hook in `frontend/src/hooks/` -> `api.get` / `api.post` |
| every request's address and token | `frontend/src/config/api.js` |
| who may see a screen | `frontend/src/config/navigation.js` (`canSee`) |
| a URL like `/api/discounts/...` | `backend/src/routes/discountRoutes.js` |
| security checks | `backend/src/middlewares/auth.js` |
| the rule that refused me | search the message text -> `backend/src/services/` |
| the SQL | `backend/src/repositories/` |
| how errors become status codes | `backend/src/middlewares/errorHandler.js`, `backend/src/errors/index.js` |
| tables and columns | `database/schema.sql` |
| settings | `backend/.env`, `frontend/.env` (never show these) |

## The request path

```
Screen -> hook -> api.js -> /api/... -> route (security) -> controller (read request)
       -> service (rules) -> repository (SQL) -> PostgreSQL -> back up -> screen updates or shows message
```

## Tests

```bash
cd backend  && npm test                    # backend unit tests, under a second
cd frontend && npm run test:unit           # frontend unit tests, a few seconds
cd frontend && npx playwright test tests/e2e/<name>.spec.js   # one end-to-end spec (both servers running)
cd frontend && npm run lint                # code style + colour contrast checks
```

## Phrases that help

- "Let me reproduce it first so we're looking at the same thing."
- "The server answered 400 with this message; I'll search the code for that sentence."
- "This is a rule, not a bug: the clinic decided a paid receipt is final. Here's the line that enforces it."
- "I'll make the smallest change that fixes the cause, then rerun the test for this feature."
- "I don't know yet. Here's how I'd find out: …" (an honest plan beats a guess)
