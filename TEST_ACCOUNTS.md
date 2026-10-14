# Test Accounts

Seeded by `backend/src/scripts/seedUsers.js` — one account per role, for local development only.

**Password for every account:** `Password123!`

| Role | Name | Email |
|---|---|---|
| SuperAdmin | Jesie Enlogada | admin@enlogada.com |
| Admin | Liza Emano | clinicadmin@enlogada.com |
| Receptionist | Maria Santos | receptionist@enlogada.com |
| Cashier | Joel Cabahug | cashier@enlogada.com |
| Laboratory Staff | Kristine Neri | lab@enlogada.com |
| Ultrasound Staff | Angela Roa | ultrasound@enlogada.com |
| Xray Staff | Paolo Dagondon | xray@enlogada.com |
| Client | Elena Cabrera | client@enlogada.com |
| Receptionist **+** Cashier | Rhea Tan | multirole@enlogada.com |

## Notes

- Re-run `node src/scripts/seedUsers.js` from `backend/` to recreate any of these if they're ever deleted — it skips accounts that already exist, and renames one still carrying its first placeholder name ("Doc Lab", "Juan Cashier" and so on) `[1.89.0]`. An account renamed since, through Staff Accounts, keeps its name: on the development database the Admin reads "Jessie Uba".
- The names and phone numbers are invented; none belongs to the clinic's staff. The names printed at the foot of a report are the clinic's real signatories, from `clinic_signatories`.
- Nothing is ever emailed to these addresses: `enlogada.com` does not exist, and `backend/src/utils/fixtureRecipient.js` skips a send to it `[1.86.0]`. Test email with an address you can read.
- These credentials are dev-only seed data, already present in plain text in `seedUsers.js` itself — not a new secret exposure, just a faster reference than reading the script.
- SuperAdmin and Admin have different capabilities in a few places (e.g. the RBAC/permission matrix under Super Admin Management), so testing "the admin experience" may need both accounts depending on what you're checking.
- `multirole@enlogada.com` holds **two** operational roles and exists to demonstrate combined-role
  access: signing in shows both the Front Desk and Billing sidebar groups, and both consoles open.
  It is not created by `seedUsers.js` — recreate it by inserting two `user_roles` rows for the same
  user. Use it whenever changing navigation or role gating; a single-role account cannot reveal the
  class of bug where the sidebar offers a screen the router refuses to open.
