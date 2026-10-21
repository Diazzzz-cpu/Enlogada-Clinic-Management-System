# Portal access for walk-in patients: how to use it

For the front desk (Receptionists) and Admins. Added in [1.136.0].

A walk-in patient has no portal account. This feature lets the clinic invite them (or the family
member who manages their records) to the patient portal. Once they accept, their record, with
every visit, released report and receipt, including the ones from before today, is in their
account. Every visit says how it came about: **Walk-in at the clinic**, **Booked online** or
**Booked by the clinic**.

If the patient only wants today's report and does not want an account, nothing new is needed:
the department releases the report and uses **Email to patient**, as before.

---

## Who can do what

| | Receptionist | Admin | SuperAdmin | Cashier / departments |
|---|---|---|---|---|
| See a record's portal access | Yes | Yes | Yes | No |
| Send, resend or withdraw an invitation | Yes | Yes | Yes | No |
| Unlink a record from an account | No | Yes | Yes | No |

The permissions are **"Invite a patient… to the portal"** (`patients:invite`) and **"Take a
patient record out of a portal account"** (`patients:unlink`). SuperAdmin can move them on
**Access Control → Who sees what**, row **Portal access**.

---

## 1. Inviting a patient at the desk

You can start from either place:

- **Right after registering a walk-in** on the Desk: the green "Walk-In registered" message has an
  **Invite to the portal** button.
- **Any time later**, from **Patient Records**: find the patient, then press **Portal access** on
  their row.

Then, in the **Portal access** window:

1. **Email address.** It shows the address on the record, if there is one. Change it if the
   patient gives another. If the record has no address yet, this one is saved to it, so released
   reports can be emailed there too.
2. **Whose address is this?**
   - **"[Patient]'s own"**: the patient's own email.
   - **"A family member who manages their records"**: a son or daughter, a grandchild, a spouse
     and so on. Type their **name** and choose **what they are to the patient**.
   - For a patient **under 18**, the second choice reads **"Their parent or guardian"**.
3. **Who agreed?** This is asked only for a family member's address, when the patient is 18 or
   over:
   - **The patient said yes, here at the clinic**
   - **The patient said yes by phone.** Confirm their name and birthdate on the call first.
   - **The patient cannot decide; this family member is responsible for them**, for example
     advanced dementia.

   For a patient under 18, the parent or guardian agrees, and the window says so.
4. **Read the yellow box out loud** to the patient (or the parent or guardian), word for word. It
   tells them whoever signs in with that address will see the visits, reports and receipts,
   including earlier ones.
5. Tick **"They said yes"**, then press **Send invitation**.

The window then shows **"Invitation sent to … Works until …"**. The invitation lasts **14 days**.

### Things the window will tell you

- **"That address belongs to a staff account"**: you can't send a record to a staff email. Ask
  for the patient's or the family's own address.
- **"An account already uses this address"**: that's fine. The person signs in instead of signing
  up and accepts the record there.
- **"It already holds N profiles. Is it really [patient]'s own?"**: the address belongs to someone
  who already manages other family members. If so, choose **"A family member who manages their
  records"** instead.
- **"You unlinked this record recently, so another member of staff sends its next invitation"**:
  see the two-person rule in section 4.

### Examples

| Situation | Whose address | Who agreed |
|---|---|---|
| Juan, 34, gives his own Gmail | Juan's own | (nothing more to ask) |
| Lola Pedro, 78, no email; her daughter will manage it. Lola is at the counter and says "si Inday na'y bahala" | A family member: daughter | The patient said yes, here at the clinic |
| Lola is at home; her daughter asks at the desk | A family member: daughter | Call Lola, check her name and birthdate: **said yes by phone** |
| Ana brings her 8-month-old for a CBC | Their parent or guardian (Ana) | Parent or guardian (automatic) |
| A grandson of 15 helps Lola make **her own** Gmail on the spot | Lola's own | (nothing more to ask) |
| Jun's wife wants his results at her Gmail, but Jun isn't here and can't be reached | **Don't send.** Jun must say yes himself, in person or by phone. | |

The helper's or manager's age is never asked. Only the **patient's** age decides who agrees.

---

## 2. Looking after an invitation

Open **Portal access** on the patient's row again:

- **Send again**: emails the same invitation again and restarts its 14 days. Wait a minute
  between sends. It can be sent 4 times in all.
- **Withdraw invitation**: cancels it. Use this for a wrong address.
- **Use another address**: send a new invitation, which replaces the old one.

What the window may say about the last invitation:

| It says | Meaning | What to do |
|---|---|---|
| Invitation sent … Works until … | Waiting for them to accept | Nothing, or Send again |
| … ran out unused | 14 days passed | Send a new invitation |
| … could not be emailed | The clinic's email isn't working right now | Try again later |
| … said this record is not someone they know | The person at that address declined | Check the address with the patient |
| … was locked after three wrong dates of birth | Someone at that address guessed wrong 3 times | Check the address and birthdate, then send a new one |
| In the portal account of … | Accepted | Nothing. The record is in their portal. |

---

## 3. What the patient (or family member) does

Tell them this at the counter:

1. Look for the email from the clinic: "Your invitation to the … patient portal".
2. Open the portal and **create an account with that same email address**, or **sign in** if you
   already have one. Google sign-in with that address works too. A new account gets a 6-digit code
   by email to confirm the address.
3. On **Home**, under **Needs your attention**, you'll see **"A record is waiting: [first name and
   initial]"**. Press **Review**.
4. Enter the patient's **date of birth**, as the clinic has it, and press **Add to my account**.
5. The record now appears as a profile, marked **From the clinic** under **Profile → Family on
   this account**. The **Visits** tab shows the walk-in visit as **Walk-in at the clinic**,
   **Results** shows the released reports (digital copies), and **Payments** shows the receipts.

Notes:
- An older account that never confirmed its email is first asked to **Confirm your email** with a
  6-digit code. Only after that does the portal say whose record is waiting.
- If they already added the same person by hand, the portal warns them. They can **Add as a
  separate profile** or cancel.
- **Not someone I know** declines the invitation, and the desk sees that.
- The invitation email contains no results and no secret link. Someone who isn't expecting it can
  simply ignore it.

---

## 4. Unlinking a record (Admin only)

Unlink takes a record out of the portal account that holds it. **Nothing is deleted.** Visits,
reports and receipts stay on the record, which becomes a walk-in record again and can be invited
afresh.

**When to use it:**

- **The wrong patient was invited.** For example, the wrong one of two "Maria Santos" records.
  This is a privacy incident; tell the clinic's Data Protection Officer.
- **Someone else has got into the account.**
- **The patient no longer agrees** to that account seeing their record. For example, a separated
  spouse.
- **Another family member is taking over.** For example, the daughter has moved abroad and the
  son now manages Lola's records.
- **The patient wants their own account.** For example, a child who is now 18.

**When not to use it:**

| Request | Do this instead |
|---|---|
| Stop emailing results | Just don't send. Emailing is the department's choice each time. |
| Wrong name or birthdate | Patient Records → **Correct** |
| "Delete my data" | Refer to the Data Protection Officer. A record can be archived, not deleted. |
| Forgot password | Password reset from the sign-in page |

**How:** Patient Records → find the patient → **Unlink** on their row.

1. The window shows which account holds the record and, in yellow, anything **still open** (a
   visit in progress, an unpaid visit today, a booking, an online payment waiting to be checked,
   an HMO decision still to come).
2. **Why?** Choose a reason.
   - **Urgent** reasons (wrong account, account compromised, the patient no longer agrees) work
     even when something is still open.
   - **Planned** reasons (another family member, the patient's own account, something else) are
     greyed out until everything open is finished or moved. That way a family member isn't cut
     off from a booking they paid for.
3. **What happened**: at least 10 characters. This goes to the Activity Log and is not shown to
   the family.
4. If the record's email is that account's address, choose **Clear it** (released reports will no
   longer be emailed there) or **Keep it**. For a wrong account or a compromised account you must
   clear it.
5. Press **Unlink record**.

**What happens next:**

- The account can no longer see the record from its very next click. No sign-out is needed.
- The account holder gets a short email: "A patient record was removed from your account". It
  gives no name and no reason.
- After an urgent unlink, the window lists what was still open. **Give that list to the Desk** and
  tell the patient.
- Reports already emailed, or copies already viewed or saved, **can't be recalled**. Tell the
  patient that plainly.

### The two-person rule

For **30 days** after you unlink a record, **you** can't send that record's next invitation.
Another member of staff must, usually the Receptionist with the patient at the desk. The rule
applies to everyone, SuperAdmin included. It stops one person from quietly moving a patient's
results into an inbox they control.

---

## 5. What is recorded

Every step is in the **Activity Log**: invitation sent, sent again, withdrawn, declined, locked
after wrong dates of birth, accepted, record linked, record unlinked (with the reason), and
"confirmed their email".

## 6. For whoever runs the server

- Run once on an existing database: `node src/scripts/migratePatientInvitations.js`, then
  `node src/scripts/setupRbac.js`. `--rollback` reverses the migration.
- Outbound email must be configured (`SMTP_*` in `backend/.env`). Without it, invitations are
  refused with "The clinic can't send email right now".
- `FRONTEND_URL` is the portal address the invitation email points to.
- In production: at most 5 invitation emails to one address a day, and 50 invitations per staff
  member a day (`INVITE_DAILY_CAP` to change the second).
