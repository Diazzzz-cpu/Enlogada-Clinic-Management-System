# Diagnostic Runbook

**For when something is broken and you have to find it.**

This system has five automated gates and 412 tests. Finding a fault here is a matter of running
things in the right order and reading which one goes red — not of reading code until you spot it.
Work down this page; do not skip to the seven-minute suite.

---

## 0. Before you believe any failure

Four things produce failures that look exactly like a broken system and are not. Rule them out
first, every time.

| Symptom | Cause | Fix |
|---|---|---|
| Everything fails, including tests unrelated to the change | A dev server is not running | Start **both**: `cd backend && npm run dev`, `cd frontend && npm run dev` |
| Scattered, unrelated failures late in a run | Rate limiter tripped (20,000 requests / 15 min in dev) | Restart the backend. The counter resets |
| Several unrelated specs go red at once, mid-run | A backend file was edited during the run — nodemon restarted and dropped in-flight requests | Re-run on a settled server before believing it |
| A "today" screen is empty and its spec fails | Seeded data is from a previous day | `node src/scripts/seedDemoScenario.js` (needs both servers) |
| A booking test times out at 30s, then passes on a re-run | **SMTP.** `POST /appointments` sends a real confirmation email through Gmail — measured at **~3s per booking**, and it spikes. Several bookings in one test can approach the timeout | Re-run. If it persists, unset `SMTP_USER` in `backend/.env` for the run — `sendEmail` skips cleanly when unconfigured |

**Booking specs own separate date bands, and a new one must claim its own.** `POST /appointments`
returns the EXISTING booking with 200 when the same patient re-submits the same date and time, so
two specs reaching for the same day silently share a visit — and an assertion about a *fresh*
booking then fails against one an earlier spec already paid for. Claimed so far:
`nthWorkingDay(120…151)` and `nthWorkingDay(170+)`. Never probe forward from tomorrow; that week
is where the demo seed lives.

**Watch the skip count, not just the pass count.** A security check that quietly did not run reads
exactly like one that passed. This has happened here: three ticket-release tests silently skipped
because a date helper resolved to a Sunday.

---

## 1. The order to run things

Fastest and most specific first. **Stop at the first red** — later stages will be noisier and tell
you less.

```bash
# ── 1. Pure logic. ~0.4s, no server, no database. ──────────────────────────────
cd backend && npm test                              # expect: 64 pass

# ── 2. Wiring checks. Seconds. Need the database only. ─────────────────────────
cd backend && node src/scripts/verifyRbacWiring.js  # expect: "All good", 0 warnings
cd backend && node src/scripts/verifyDiscountParity.js  # expect: "Exact parity"

# ── 3. Frontend logic + design gates. ~3s, no server. ──────────────────────────
cd frontend && npm run test:unit                    # expect: 30 pass
cd frontend && npm run lint                         # expect: 0 violations on both gates
cd frontend && npm run build                        # expect: clean build

# ── 4. Copy damage. Instant. ───────────────────────────────────────────────────
python scripts/prose_scan.py frontend/src           # expect: 0 prose damage

# ── 5. Behaviour. ~8 minutes. NEEDS BOTH SERVERS RUNNING. ──────────────────────
cd frontend && npx playwright test                  # expect: 318 pass
```

### Known-good baseline

| Check | Expected |
|---|---|
| Backend unit | **64 passed** |
| Frontend unit | **30 passed** |
| Playwright E2E | **318 passed** |
| `verifyRbacWiring` | `All good` — and **0 warnings** |
| `verifyDiscountParity` | `Exact parity` — 3,264 combinations |
| `checkFillRoles` | 198 files, **0 violations** |
| `checkContrast` | 44 token pairs, both themes, **0 violations** |
| `prose_scan` | **0 prose damage** |

Write today's numbers down before anyone touches anything. A diff against a known baseline is
worth more than any amount of reading.

---

## 2. Triage by the SHAPE of the failure

Before looking at any individual test, count how many failed and where. The shape narrows it
faster than the message does.

| Shape | Almost always means | Look at |
|---|---|---|
| **One test in one file** | A localised logic bug | The assertion names the rule. Start there |
| **Many tests, all in one spec file** | That one feature is broken | Find the feature in `.agents/TRACEABILITY.md` → its API and DATABASE cells |
| **Many spec files, all failing at sign-in** | Authentication, the token, or `/auth/me` | `middlewares/auth.js`, `contexts/AuthContext.jsx`, `config/api.js` |
| **Many spec files, failing on different things** | An API response shape changed, or CORS | `app.js` (CORS headers), `middlewares/errorHandler.js` (envelope) |
| **Everything, instantly** | A server is down or the database is unreachable | §0 |
| **Nothing fails but a screen looks wrong** | A design token or a `cn()` merge | `npm run lint`, then §4 |

---

## 3. What each gate proves, and what it cannot see

Knowing a gate's blind spot is as useful as knowing its coverage.

### `backend/npm test` — 64 unit tests
**Proves:** discount arithmetic against RA 9994 and the clinic's own non-VAT invoice; CSV
serialisation (RFC 4180, the UTF-8 BOM, empty-cell-not-zero, filename header injection); the error
hierarchy's compatibility with the ~166 legacy `error.statusCode =` sites; arrival-time arithmetic;
queue-estimate floors, rounding and caps; both OCR parser bugs that shipped; abnormal-value
detection.
**Cannot see:** anything needing a database, a server or a browser.

### `verifyRbacWiring.js`
**Proves:** every permission on a route exists; at least one staff role holds it; every role named
in `authorizeRoles` holds the route's permission; every role that *holds* it appears on the route
(warning, with a `// rbac-narrowing:` opt-out); every `permission:` in `navigation.js` is one the
API enforces.

> **Read the ROUTE COUNT, not just the verdict.** It prints
> `Checked 77 permission-gated route(s) — 61 decided by permission alone.`
> If a gate is deleted the script still says "All good" — with a **smaller number**. That number
> is the tamper signal.

### `verifyDiscountParity.js`
**Proves:** the strategy classes bill exactly what the previous inline branch billed, across 3,264
combinations / 16,320 field comparisons.
**Cannot see:** whether the *original* rule was right. That is what `discount.test.js` is for — it
asserts against the statute, not against the old code.

### `frontend/npm run lint`
Three gates in one command:
- **oxlint** — unused imports, undefined identifiers.
- **checkFillRoles** — an ink-only shade (`slate/gray-700…950`) used as a *fill*. Those invert in
  dark mode; this shipped white-on-white at 1.12:1 three times.
- **checkContrast** — every ink token against every surface it lands on, in **both** themes.

> **Blind spot, currently:** `checkContrast` tests `emphasis`, `destructive` and `rail` fill pairs.
> It does **not** test `primary`, which measures 4.44:1 with white text — below AA.

### `prose_scan.py`
**Proves:** no rename walked into English prose. Real damage it exists to catch:
*"Release CBC entry.findings for Juan Dela Cruz?"* on a clinical confirmation dialog.
**Blind spot:** its `HOOKS` list is its eyesight. A hook missing from that list is damage it cannot
see.

### `npx playwright test` — 318 E2E
**Proves:** RBAC boundaries, the money path, ticket-release gating, result versioning, printing,
revalidation, failure states, and the copy on several screens.
**Cannot see:** anything about performance. A `column::date` filter forcing a sequential scan
(measured: 50.7ms vs 0.84ms) passes every test in this suite.

---

## 4. If a professor deliberately broke something

Ranked by what is realistically done to a system to test a student, with the signature each leaves.

| What was broken | Signature | Where to look |
|---|---|---|
| A permission removed from a route | `verifyRbacWiring` still says "All good" but the **route count drops**; `rbac-enforcement.spec.js` / `api-authorization.spec.js` fail | `backend/src/routes/*.js` |
| A permission removed from a ROLE | Wiring check warns or errors; a role's screens 403 | `backend/src/scripts/setupRbac.js`, then re-seed |
| A discount rate or the VAT flag changed | `verifyDiscountParity` and `discount.test.js` both fail with exact figures | `discountService.js`, `CLINIC_VAT_REGISTERED` in `backend/.env` |
| A money aggregate changed | `cashup-reversals.spec.js`, `operations-report.spec.js` | `reportRepository.js`, `constants/moneyRange.js` |
| `is_current` dropped from a results query | `result-versioning.spec.js`; superseded findings appear beside live ones | `resultRepository.js` |
| A response envelope changed | Dozens of specs fail on different assertions | `middlewares/errorHandler.js`, controllers |
| A CORS header removed | Revalidation stops; CSV filenames break | `backend/src/app.js` — `exposedHeaders` |
| A design token deleted or renamed | Build fails, or `checkContrast` / `checkFillRoles` go red | `frontend/src/index.css`, `lib/utils.js` |
| A `@theme` token added without registering it in `cn()` | Class present in JSX, **absent from the DOM** — only a computed-style check sees it | `frontend/src/lib/utils.js` |
| Print layout broken | `receipt-print.spec.js` — the only thing that can see `@media print` | `frontend/src/lib/printArea.js` |
| A filter changed to `column::date` | **Nothing fails.** Only performance degrades | Repositories — look for `::date` on the left of a comparison |

---

## 5. Answering "why does this exist?"

Two documents, and they answer different questions.

| Question | Where |
|---|---|
| *Which requirement does this implement? Was it tested?* | `.agents/TRACEABILITY.md` — 62 feature rows, MODULE → … → TEST → APPROVAL |
| *Why is it built this way? What went wrong before?* | `CLAUDE.md` — the decisions, and the bugs that produced them |
| *What is the whole system?* | `CODEBASE_SYSTEM_OVERVIEW.md` |
| *What changed in this version?* | `database/migrations.md` |

**How to answer a "what breaks if I change this?" question in under a minute:**

1. Find the feature in `TRACEABILITY.md`.
2. Its **API** cell lists every endpoint that touches it.
3. Its **DATABASE** cell lists every table and column.
4. Its **TEST** cell names the spec — run only that: `npx playwright test <name>`.
5. Its **SECURITY** cell names the permission, so you know who is affected.

---

## 6. Recovering

```bash
# See what actually changed
git status
git diff

# Undo an uncommitted change to one file
git checkout -- path/to/file

# Find when a line was last changed, and why
git log -p --follow path/to/file | head -60
git log --oneline -20

# Rebuild the RBAC matrix from source (safe, idempotent)
cd backend && node src/scripts/setupRbac.js

# Reset demo data, then re-seed a realistic clinic day
cd backend && node src/scripts/resetDemoData.js --confirm
cd backend && node src/scripts/seedDemoScenario.js
```

**`migrateDb.js` is destructive** — it drops and recreates every table. Never run it to "fix"
something on a database with data you want.

---

*Baseline recorded at commit `fed16a1`. Re-measure and update the numbers in §1 whenever the suite
legitimately changes size — a stale baseline is worse than none, because it makes a real regression
look like a documentation error.*
