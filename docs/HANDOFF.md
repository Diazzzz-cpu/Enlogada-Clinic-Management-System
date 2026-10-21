# Handoff: open threads

Last updated 2026-10-22, after [1.136.0]. For the next Claude Code agent working in this repo.
CLAUDE.md and the project memory load on their own; this file holds what they do not.

The diagram update this file used to brief is done: [1.133.0] made it and [1.134.0] checked it
against the code and corrected it (see `database/migrations.md`). The diagrams match the system as
of [1.132.0]. After the next change to a process, re-run the check [1.134.0] describes.

## Open threads

- **[1.136.0] Portal invitations for walk-ins are built** (see `docs/PORTAL_ACCESS_GUIDE.md` for the
  staff how-to, migrations.md for the design). On another database run
  `node src/scripts/migratePatientInvitations.js`, then `node src/scripts/setupRbac.js`. Planned with
  the `.agents` roles and reviewed by them after the build; every finding was fixed. Left as they
  are, deliberately:
  - The invitation caps (5 emails an address a day, 50 invitations a staff member a day) apply only
    under `NODE_ENV=production`, like the rate limiters. A deployment must set it.
  - Google sign-in cannot be driven by the suite. It marks the address verified (`googleLogin`);
    check it by hand once: sign in with Google using an invited address, and the record waits.
  - The family-consent rules were chosen with the user; the clinic's Data Protection Officer
    should confirm them (RA 10173), especially the phone path.
- **Joel (cashier@enlogada.com) holds the Receptionist role too**, unless Steven has unticked it on
  Staff Accounts or run `npm run demo` (which resets the demo accounts). While he does, seven E2E
  tests that take that account to be a cashier only fail. Last full run: 521 of 529 passed; the
  other failure was two random fixture patients sharing a name (`laboratory.spec.js`), which passes
  on its own.
- **Offered to Steven, not answered yet:** a "Book for a later day" button on the Desk (the API
  takes a staff booking with its payment; a screen would also need the senior/PWD discount before
  payment), and the patient's phone number on the Desk's "From earlier days" table.
- **A choice made without him, to confirm:** an HMO booking approved in part (some tests refused)
  is kept, and the refused tests are paid at the clinic.

## Running the E2E suite

Steven's own dev servers run on 5000/5173, so start your own and stop only those afterwards:

    # backend/
    PORT=5001 CORS_ORIGINS=http://localhost:5174,http://localhost:5173 FRONTEND_URL=http://localhost:5174 \
      APPOINTMENT_REMINDERS=off UNPAID_EXPIRY=off node src/server.js
    # frontend/
    VITE_API_BASE_URL=http://localhost:5001/api npx vite --port 5174 --strictPort
    # frontend/, the run itself
    E2E_SKIP_PURGE=1 E2E_API_URL=http://localhost:5001 E2E_BASE_URL=http://localhost:5174 npx playwright test

Check nobody is using the app first (the purge deletes what was created in the run's window), never
start two Playwright runs at once, and afterwards run
`node src/scripts/purgeE2eData.js --since=<first run's start> --dry-run`, then without `--dry-run`.
The timestamp columns are local time, so compare a UTC `--since` with `($1::timestamptz)::timestamp`
when you check by hand who wrote rows in the window.
