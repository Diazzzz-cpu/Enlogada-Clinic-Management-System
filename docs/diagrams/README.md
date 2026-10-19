# Capstone paper diagrams

The figures for *Design and Development of a Web-Based Clinic Management System for Enlogada
Ultrasound and Diagnostic Clinic*, drawn to match what the system actually does. The System
Architecture figure (Figure 2) is **not** here — it stays as it is in the paper.

Drawn in the style of a printed figure: draw.io, default shapes, black ink on white, the actor
icon for a flowchart header, a stick figure for a use case, nested flow corridors on the data flow
diagrams, and Workbench-style tables for the ERD. What changed is the content.

## Files

| File | Pages | Figures it replaces |
|---|---|---|
| `flowcharts.drawio` | 8 | the role flowcharts, plus a Super Admin chart the paper never had |
| `usecases.drawio` | 8 | the use case diagrams |
| `dfd-level0.drawio` | 9 | the per-actor Level 0 sheets, plus a context diagram showing all eight entities |
| `dfd-level1.drawio` | 8 | the per-actor Level 1 sheets |
| `erd.drawio` | 3 | the single ERD, split because 33 tables do not read on one page |
| `png/` | 36 | exports at scale 3 for placing in the paper |

## Regenerating

    node docs/diagrams/buildDiagrams.cjs

The flowcharts, use cases and data flow diagrams come from the specs inside that script. The ERD is
read from the live database, so it cannot drift from the schema: tables, columns, PostgreSQL types,
nullability, primary keys and foreign keys are all queried, and the script fails loudly if a table
is missing from one of the three sheets.

Checking the diagrams for missing decision branches, dead ends, crossings, overlaps and long labels:

    node docs/diagrams/checkDiagrams.cjs

Re-exporting the images (run from inside `docs/diagrams/`):

    powershell -ExecutionPolicy Bypass -File exportPng.ps1

## Two things that will bite

**draw.io's `-p` page index is one-based.** Passing `0` exports the first page without an error, so
a whole run comes out shifted by one and the files look fine until you read them.

**Never edit the `.drawio` files by hand.** Change the specs in `buildDiagrams.cjs`, run
`checkDiagrams.cjs` until it prints `Clean.`, and re-export the PNGs so the next regeneration never
throws work away.

## What these diagrams assert about the system

Worth knowing before a panelist asks, because each one differs from the old figures:

- There is no veterinary branch anywhere. Pet patients were removed from the system.
- A booking issues a reference and confirmation email first. A self-pay booking holds its slot for 60 minutes while the patient confirms final tests, pays via GCash or bank transfer, and uploads proof; an HMO booking waits for Admin's decision. The **QR booking pass** is issued only once the booking is paid or HMO-approved.
- The **queue ticket** is issued later, at check-in or walk-in registration at the Front Desk.
- Before taking payment, the cashier confirms the final list of tests with the patient and issues the **receipt** (never the queue number). There is no refund or receipt reversal in the system.
- Bookings and visits are never cancelled or marked no-show by hand. Unpaid bookings and unpaid visits expire automatically on a timer and log the expiry to the Activity Log; paid bookings that need another date are rescheduled.
- An Admin decides HMO claims (each with a 15-minute decision deadline) and generates four-tab A4/Excel reports, but cannot write or release a diagnostic result; the department does that.
- Laboratory and Ultrasound attach and authorise a report file, placing a marked digital copy with a verification code in the patient's portal. Emailing the report to the patient is an optional choice after release or from History, never automatic on release.
- X-Ray films are handed to the patient in a physical envelope at the clinic. X-Ray staff never upload, release, print, or email a report file in the system; they confirm and mark the exam done on the X-Ray Worklist (`performed_at` and `performed_by`).
- Results keep their history: an amendment releases a new version and the previous one stays on record.
- Patients can answer a visit feedback survey in the portal (or have a paper form recorded by the Receptionist from Visit History), and Admin / Super Admin manage the survey questions.

