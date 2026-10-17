# The files that matter most

You do not need to understand all ~440 code files. Learn these, in this order. For each one: what it
does, why it matters for debugging, and what goes wrong when it fails.

---

## The first five

### 1. `frontend/src/config/api.js`: the post office

**What it does.** Every request from the browser to the server goes through this one file. It:
- sets the server's address (`baseURL`): `VITE_API_BASE_URL` from `frontend/.env`, or
  `http://localhost:5000/api` if that is not set;
- attaches your sign-in token to every request (`Authorization: Bearer <token>`), read from the
  browser's `localStorage`;
- on any **401** answer, deletes the token and fires an `auth:unauthorized` event, which signs you out.

**Why it matters.** If the address is wrong, *nothing* works, and every screen looks broken at
once. This happened twice this week: the login failed because the app was calling a port where the
clinic's server was not running.

**When it fails, you see:** in the browser's Network tab, requests going to the wrong address, or
"ERR_CONNECTION_REFUSED" (nothing is listening there).

### 2. `frontend/src/App.jsx`: the traffic director

**What it does.** Decides which screen to show. There is no router library: App.jsx looks at who is
signed in (`user` from `AuthContext`) and which screen they chose (`activeNav`), and renders that
screen inside one shared sidebar (`StaffShellHost`). Public pages, the patient portal and the staff
consoles each have their own branch.

**Why it matters.** "I clicked X and got the wrong screen", or "a screen is missing for this role",
starts here, together with `frontend/src/config/navigation.js`, which lists every screen and who
may see it (`canSee`).

### 3. `backend/src/app.js`: the server's front door

**What it does.** Sets up the server in order:
1. security headers (`helmet`) and **CORS** (which web addresses may call this API:
   `FRONTEND_URL` plus `CORS_ORIGINS` from `backend/.env`);
2. reads JSON bodies;
3. logs every request (`morgan`) to the backend terminal;
4. **rate limits** (too many requests, or too many failed sign-ins, get a 429);
5. mounts every route file under `/api/...` (for example `app.use('/api/discounts', discountRoutes)`);
6. finally the **error handler**, which turns any error into a JSON answer.

**Why it matters.** It tells you which file handles a URL. `/api/discounts/...` lives in
`routes/discountRoutes.js`; `/api/results/...` in `routes/resultRoutes.js`; and so on.

### 4. `backend/src/middlewares/auth.js`: the security guard

**What it does.** Four checks used on almost every route:

| Function | Asks | Answers with, when it says no |
|---|---|---|
| `verifyToken` | Is there a valid sign-in token, for an account that still exists and is active? | **401** (no or bad token, password changed) or **403** (account deactivated) |
| `authorizeRoles(...)` | Does this person hold one of these roles? | **403** |
| `authorizeStaff` | Is this a member of staff, not a patient? | **403** |
| `authorizePermissions(...)` | Do they hold this permission (e.g. `billing:discount`)? SuperAdmin always passes. | **403** "Required permissions: …" |

**Why it matters.** Most "it works for the admin but not for the cashier" problems are answered
here. The 403 message names the permission that is missing.

### 5. `backend/src/middlewares/errorHandler.js` with `backend/src/errors/index.js`: the complaints desk

**What it does.** Every error, from any layer, ends up here. It:
- turns database errors into plain answers (`normalizeError` / `fromDatabaseError` in
  `errors/index.js`): bad input becomes 400, "doesn't exist" 404, "already exists" 409, with a
  sentence from `CONSTRAINT_MESSAGES` where one is known;
- logs it: a **WARN** line for 4xx (the user's mistake), an **ERROR** with the full stack for 5xx
  (our mistake);
- sends `{ status: 'error', statusCode, message }` to the browser.

**Why it matters.** The `message` in the Network tab's Response is usually the exact sentence a
service wrote. Search the code for that sentence and you have found the rule that refused you.

---

## The next tier

Learn these once the first five make sense.

| File | What it does |
|---|---|
| `frontend/src/contexts/AuthContext.jsx` | Holds who is signed in. `login()` posts to `/auth/login` and stores the token; it re-checks `/auth/me` every 60 seconds and when the tab regains focus. |
| `frontend/src/config/navigation.js` | Every screen in the sidebar, the console it opens and who may see it (`canSee`, `findNavItem`). |
| `frontend/src/components/SidebarLayout.jsx` | The staff shell: the sidebar, top bar, notifications bell, and the area screens draw into. |
| `frontend/src/hooks/useCheckout.js` | An example hook: the cashier's till (load the bill, apply a discount, take a payment). Most screens have a hook like this. |
| `frontend/src/lib/date.js` | Date helpers (`todayStr`, `formatDate`). Dates are a common source of bugs; see the debugging guide. |
| `backend/src/server.js` | Starts the server on `PORT` and stops it cleanly on a crash. |
| `backend/src/config/environment.js` | Reads `backend/.env` into one object (`env.PORT`, `env.FRONTEND_URL`, …) with defaults. |
| `backend/src/config/database.js` | The connection to PostgreSQL (`pool`), `db.query`, and `withTransaction` (several writes that must all succeed or all fail). In development it logs every SQL query it runs. |
| `backend/src/config/logger.js` | Writes logs to the backend terminal (not to a file). |
| `database/schema.sql` | The blueprint of every table, column, rule (CHECK) and index. |
| `backend/src/constants/` | Shared rules, written once: who counts as staff (`roles.js`), what a "released" HMO test is (`hmoEffectiveStatus.js`), money date ranges (`moneyRange.js`). |
| `backend/src/scripts/` | One-off tools: migrations, seeding demo data, checking permissions (`verifyRbacWiring.js`). |

---

## How to find the file for something you see on screen

1. **Search for the words on the screen.** In VS Code press `Ctrl+Shift+F` and type a label,
   heading or placeholder exactly as it appears, e.g. `OSCA / PWD ID number` (the box beside the
   till's discount **Apply** button). That finds the component: `components/cashier/CheckoutTerminal.jsx`.
   Pick distinctive words; a search for just `Apply` finds dozens of buttons.
2. **Find the request it sends.** In that component (or the hook it uses) look for `api.get(` /
   `api.post(`. The path, e.g. `/discounts/visit/...`, tells you the backend route file.
3. **Follow the route.** In `backend/src/routes/discountRoutes.js` the route names its controller
   function; the controller names its service function; the service names its repository function.
4. **For an error message:** search for its exact words. Every refusal in the backend is a sentence
   written in a service or controller.
