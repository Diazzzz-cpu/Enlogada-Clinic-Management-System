# Capstone paper diagrams

The figures for *Design and Development of a Web-Based Clinic Management System for Enlogada
Ultrasound and Diagnostic Clinic*, drawn to match what the system actually does. The System
Architecture figure (Figure 2) is **not** here — it stays as it is in the paper.

Drawn the same way as the originals: draw.io, default shapes, black strokes on white, the orange
person for the actor in a flowchart, a stick figure for a use case, blue flow labels on the data
flow diagrams, and Workbench-style tables for the ERD. What changed is the content.

## Files

| File | Pages | Figures it replaces |
|---|---|---|
| `flowcharts.drawio` | 8 | the role flowcharts, plus a Super Admin chart the paper never had |
| `usecases.drawio` | 8 | the use case diagrams |
| `dfd-level0.drawio` | 9 | the per-actor Level 0 sheets, plus a context diagram showing all eight entities |
| `dfd-level1.drawio` | 8 | the per-actor Level 1 sheets |
| `erd.drawio` | 3 | the single ERD, split because 36 tables do not read on one page |
| `png/` | 36 | exports at scale 3 for placing in the paper |

## Regenerating

    node docs/diagrams/buildDiagrams.cjs

The flowcharts, use cases and data flow diagrams come from the specs inside that script. The ERD is
read from the live database, so it cannot drift from the schema: tables, columns, PostgreSQL types,
nullability, primary keys and foreign keys are all queried, and the script fails loudly if a table
is missing from one of the three sheets.

Re-exporting the images:

    powershell -ExecutionPolicy Bypass -File docs/diagrams/exportPng.ps1

## Two things that will bite

**draw.io's `-p` page index is one-based.** Passing `0` exports the first page without an error, so
a whole run comes out shifted by one and the files look fine until you read them.

**The layout is generated, not hand-placed.** Boxes are spaced generously so you can drag them in
draw.io without lines crossing. Rearranging is expected; just do it in the `.drawio` file and
re-export, so the next regeneration does not throw the work away. If you change what a diagram
*says*, change it in `buildDiagrams.cjs` instead.

## What these diagrams assert about the system

Worth knowing before a panelist asks, because each one differs from the old figures:

- There is no veterinary branch anywhere. Pet patients were removed from the system.
- A booking issues a reference and a QR code. The **queue ticket** comes later, at check-in.
- The cashier issues the **receipt**, never the queue number.
- Checking in stamps the arrival time and puts the visit in that day's queue.
- An Admin decides HMO claims but cannot write or email a result; the department does that.
- A rejected proof of payment ends the flow. It never reaches "record the payment".
- Results keep their history: an amendment is a new version and the old one stays readable.
