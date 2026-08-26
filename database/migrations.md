# Database Migration & Schema History

## [1.53.0] - 2026-08-26 (What the review found)

No new feature. An architecture review of `[1.50.0]`..`[1.52.0]` — commissioned before the work and
lost to a session limit partway through, then run retrospectively — found three defects that a
228-passing suite did not, plus several smaller ones. This is the fix.

### The suite was green because it tested the wrong layer

Worth recording before the defects themselves. The specs asserted API payloads and the presence of
a grid; they never drove the two buttons a technician presses. The first version of the regression
test written for the worst defect below **passed with the bug still in place**, because it posted
to the API while the bug lives in the hook behind the button. It drives the browser now, and was
verified by reverting the fix and watching it fail.

### F1 — a released result that saved nothing

`useResultEntry.js`. `[1.52.0]` relaxed `validate()` so a laboratory form with a filled grid and an
empty COMMENT box is a legal save. Its silent partner was `release()`, still guarding on
`if (findings)`. A technician who filled a Urinalysis, left the comment blank and pressed
**Authorize & Release Result** got a success toast, the patient got a "results are ready" email, and
**nothing was written** — the typed values were discarded when the dialog closed.

On an amendment it was worse: the release POST succeeded against the OLD stored version, the
certificate printed the edited values, and the database kept the previous ones. The printed document
and the record disagreed, and no amendment reason was recorded.

One predicate now serves both. Two predicates that must agree is a bug waiting for someone to edit
one of them, which is exactly what happened.

### F2 and F3 — one document, three data shapes

`[1.50.0]` extracted `ResultReport` so the clinic's copy and the patient's copy could not drift.
`[1.52.0]` then fed it from three different queries, and two of them lacked the columns the new
layout reads:

- **The patient's copy** came from `findResultsByPatientId`, which selected no `birthdate`, `sex`,
  `patient_type_name` or `discipline` — so Birthday, Sex and Patient Type printed blank and the
  letterhead carried **no title at all**.
- **The just-released certificate** — the copy handed across the counter — was rebuilt from form
  state, which carries no signatories, no discipline and no section headings. It printed
  "DO NOT ACKNOWLEDGE THE RESULT WITHOUT THE OFFICIAL SEAL" above **no signatures**, as a flat list.
  The same result viewed one screen away showed all three.

The certificate re-reads the stored row after release now, and the history query carries the header
block. The failure had simply moved from three renderings to three data shapes.

### F4 — a form that changed shape between patients

`showReference` was computed from the values recorded rather than from the form. Only 2 of
Urinalysis's 14 fields carry a reference range, so a Urinalysis where microscopy was not recorded
printed a **three-column** sheet and the next patient's printed four. Derived from the field set
now. Fecalysis — the one form in the workbook with no reference column — was right by accident and
is right by rule.

### F5 — a suppressed TSH stored as zero

`result_measurements.value_1` was `NUMERIC(7,2)`, sized when every field was a measurement in
centimetres. `[1.52.0]` put laboratory analytes on it, and Postgres **rounds rather than errors**: a
TSH of 0.004 mIU/L stored as `0.00`, and 0.001 and 0.009 became the same number. The value that
reads as "undetectable" is the clinically decisive one. Now `NUMERIC(10,4)`, and the rollback
refuses to narrow the column if any stored value would lose precision.

### F6 — a unique constraint that did not constrain

`uq_signatory UNIQUE (category_id, full_name, role_caption)` was commented "Re-running the seed must
not duplicate them." NULLs are DISTINCT in a Postgres unique constraint, so two identical **global**
signatories — the `category_id IS NULL` case, which is the one meaning "signs every report" — were
both accepted. A partial unique index covers it.

### Smaller, same commit

- **F7** Signatory order had no tiebreaker. Which name prints on the left of a signed clinical
  document must not be whatever the planner returns.
- **F8** A report with no `discipline` — every X-ray test, 2D Echo, any laboratory test outside the
  22 seeded sets — printed **no title**. Restored. And 2D Echo takes the ultrasound SHAPE now, since
  it is performed by Ultrasound Staff and 18 historical visit_tests still point at the category.
- **F10** `mergeMeasurements` trusted its client's payload shape. A bare value wrote an all-NULL row
  and died on a raw CHECK violation; an empty string reached NUMERIC and 500'd; an empty
  `value_text` wrote a row that passed the CHECK and printed as a blank line — the exact thing that
  CHECK exists to prevent.
- **F12** The discipline join had no `is_active` filter, so a deactivated field set kept printing
  its heading on reports whose grid had gone.
- **The report names who released it again.** The `[1.52.0]` rewrite dropped `released_by`. The
  seeded signatories are the clinic's standing attestation; they are not a record of who authorised
  THIS report, and the query had carried that all along.
- **`first_name` on a result row now means the patient**, not the releasing user — `[1.52.0]`
  changed that silently by widening the query. Aliased so the next reader is not caught.

### Also fixed: a test that depended on the demo data it was not testing

`workflow-context.spec.js` asserted that SOME seeded worklist row carried a referring physician.
That made it a test of the demo dataset: the seeded tickets are released over a day of suite runs,
and once the last one was gone it failed with "element not found" — which reads exactly like a code
regression and cost real time to diagnose as depletion. Both worklist tests build their own paid
ticket now and assert against a row they created, so the assertion is exact and the failure honest.

### Still open — needs the owner, not a developer

The report prints **a fixed pair of seeded names on every Laboratory result**, including an external
consultant pathologist with his PRC licence number attached automatically to results he may never
have seen. The photograph the owner sent is sufficient authority for the DATA — the names and
numbers are correct — but not for the BEHAVIOUR. One written line from the clinic, and ideally from
Dr. Lamayra, that both names are to print automatically on every laboratory result the system
issues, belongs on file before this reaches a real patient.

Separately escalated: `findResultsByPatientId` has no released-state filter, so a patient calling
`GET /api/results/history/...` directly can read a result recorded but not yet authorised. The UI
hides it; the API does not. Pre-existing — `findings` was already exposed this way — but `[1.50.0]`
added measurements to that payload and `[1.52.0]` added signatories, so a third feature has now
widened the same hole.

## [1.52.0] - 2026-08-26 (The form the clinic actually prints)

Two schema additions (`node src/scripts/migrateLabResultForms.js`, `--rollback` reverses it), 22
laboratory field sets, and a report that reproduces the clinic's own sheet rather than
approximating it.

### What was wrong

[1.50.0] built structured entry and seeded it for **Ultrasound only**, and printed a generic
report. The clinic's requirement is narrower and more literal than that: a technician opens Record
Findings, the fields for THAT test are already laid out, they type only the results, and the
printout looks like the document they issue today. Their Urinalysis form settles what that means —
a four-column sheet, `TEST | RESULT | UNIT | REFERENCE RANGE`, with section headings grouping the
analytes under a discipline heading, a COMMENT box, a disclaimer, and a two-signatory footer
carrying PRC licence numbers.

Three things were missing: **sections**, **laboratory field sets**, and **the signatory block**.

### `section`, and why it is a column rather than a convention

"A section owns everything until the next section" is the obvious rule and it is wrong on the
clinic's own CBC. `RDW-CV` prints two rows below `Basophils`, after the `Differential Count` block,
and is not a differential parameter. A convention would file it under the wrong heading on every
CBC they ever issue. An explicit nullable column cannot, and the renderer emits a heading by
comparing against the previous row, so a field with no section simply closes the group.

`result_field_sets.discipline` joins it — `CLINICAL MICROSCOPY`, `HEMATOLOGY`,
`CLINICAL CHEMISTRY`, `SEROLOGY/IMMUNOLOGY` — because the form prints one above its panel title.

### 22 laboratory field sets, 63 fields, transcribed not invented

Every label, unit, section and reference range comes from the clinic's own workbook. Coverage
against the 23-test Laboratory catalogue: **22 seeded, 1 not**.

**Almost everything is `text`, not `number`.** A laboratory RESULT column carries `YELLOW`,
`NEGATIVE`, `FEW`, `0-2` and `1.010` — often on one sheet. A numeric input would refuse three of
those five. Only analytes that are numeric on every observed sheet are `number`.

**Sex-conditional ranges print both halves**, exactly as the clinic's CBC does. One field, not
two: the technician records one haemoglobin value, and the patient's sex decides only which half
of the printed range the reader applies. Splitting it would ask for the same measurement twice —
and would have violated `UNIQUE (field_set_id, code)`.

**Fecalysis has no reference-range column at all** — the only sheet in 38 without one — so the
column is dropped when nothing in a set carries a range, rather than printing an empty one.

### The signatory block

A laboratory report carries **two** named signatories with PRC licence numbers. An ultrasound
report carries one radiologist and, in 1,113 archived reports, no licence number anywhere. So the
block differs by category, which is why `clinic_signatories` is keyed by one.

Not on `users`: the pathologist is an external consultant who signs the report and has no account,
and `users` has no credential column by design. Not env config like the TIN either — the clinic's
own forms supply both names and both numbers on 36 of 38 sheets, and a table lets them be corrected
from a screen rather than by editing `.env` and restarting.

`prc_license` is nullable and **not defaulted**. The radiologist's is blank because the corpus
contains none, and a blank prints nothing rather than a plausible-looking number — the same rule
`lib/clinic.js` applies to the TIN.

### `findings` is no longer the only proof a result exists

A laboratory form has no narrative; the clinic's sheet carries only a COMMENT box. Demanding prose
to save a Urinalysis whose fourteen fields are filled is friction that buys nothing, so a completed
grid is proof enough on its own. A test with **no** field set is unchanged and still requires the
text, which is what keeps `result-versioning.spec.js` and `laboratory.spec.js` green.

### Clinic identity corrected against the printed form

The system printed `Bugo, Cagayan de Oro, Philippines 9000`. Their own result form prints
`National Highway, Diesto Building, Bugo, Cagayan de Oro City, Misamis Oriental, 9000`, plus a
`LABORATORY • ULTRASOUND • X-RAY` services line the system had no field for. The printed document
is the authority: a report whose address differs from the clinic's letterhead is one nobody can
rely on. `CLINIC_SERVICES` joins the existing env-configurable identity.

Their form separates the three services with a **REGISTERED SIGN** — a Wingdings bullet that lost
its symbol font — so it currently prints `LABORATORY ® ULTRASOUND ® X-RAY`. Reproduced here as the
bullet it was meant to be.

### Open questions the clinic must answer

Recorded rather than guessed at, and reported by the seed on every run:

1. **FBS upper bound: 99.0 or 100.0.** The standalone forms print `70.0 - 100.0`; the two combined
   chemistry panels print `70.0-99.0`, for the same analyte. Seeded from the standalone form
   because that is the form this catalogue test corresponds to.
2. **OGTT 75g has two forms** with different reference semantics — one normal-range, one captioned
   `GESTATIONAL DIABETES` whose values are diagnostic thresholds of the opposite polarity. Seeded
   from the plain form; the gestational one needs its own catalogue test.
3. **Thyroid units.** The workbook prints `miu/L`, `nmo/L`, `pmo/L`. Seeded as `mIU/L`, `nmol/L`,
   `pmol/L` — the SI forms — because these are character omissions rather than clinical judgements,
   and printing a malformed unit on a new system perpetuates an error. One line each to revert.
4. **`Hct Hgb` prints haemoglobin in `g/L`** where every CBC sheet prints `g/dl`, with identical
   numbers. One of the two is wrong.
5. **Examiner caption.** The same person is captioned `Medical Technologist` on 21 sheets and
   `Examiner` on 17, with no discernible rule. The clinic's current form settles it as
   `Medical Technologist`.
6. **Disclaimer policy.** 28 sheets require a physical seal; 8 say the report is electronically
   signed and needs no signature. These say opposite things. Seeded with the 28-sheet majority.
7. **HIV Screening has no form in the workbook** — zero occurrences across every shared string.
   Nothing seeded.
8. **BUN.** The only standalone sheet is captioned `( POST )`. The plain analyte is seeded from the
   combined panels; the caption is not carried.

## [1.51.0] - 2026-08-26 (Three answers, and three fabricated numbers removed)

One constraint change (`node src/scripts/migrateBiophysicalScore.js`, `--rollback` reverses it),
seed data, and a correction to `resultTemplates.js`. Researched against published guidance before
deciding, because two of the three questions were about what NOT to build.

### X-ray stays on free text, and that is the finding

The clinic's archive holds **two** X-ray reports against a **24-test** X-ray catalogue, both Chest
PA, one dated 2013. Their five-line anatomic order (lungs, heart, aorta, diaphragm/costophrenic
sulci, "the rest") is not idiosyncratic — RSNA's own approved chest-radiograph templates model a
plain film the same way, as ordered region slots whose options are complete canned sentences with
no numeric fields at all. So the pattern is real.

It still does not justify building. `result_measurements` is a MEASUREMENTS model — `NUMERIC(7,2)`
plus a 120-character text column — and RSNA's canned sentences routinely run past 170 characters.
There is no options table, and `ResultReport.jsx` renders measurements as a right-aligned
`tabular-nums` table with a reference-note column, which is simply the wrong shape for prose. More
decisively: two exemplars evidence the skeleton and one normal sentence per region. RSNA's
equivalent carries roughly eight options per region, so building it means **inventing about forty
clinical sentences** — which is the thing [1.50.0] already refused to do.

ACR's practice parameter does not require it either. Its reporting section is explicitly headed
"the following is a **suggested** format", and its only instruction for findings is to use
appropriate terminology. Standardised templates "**may**" be used. No DOH or PhilHealth instrument
prescribes report structure. There is no forcing function.

### Three fabricated clinical numbers removed from `resultTemplates.js`

These are paste-able boilerplate one click from a real patient's report, and each carried a number
that was invented here:

- **`XRAY_CHEST`** was four bullets in the wrong order using terms the radiologist does not write
  ("Osseous structures", "cardiac silhouette"). Replaced with the clinic's own five lines,
  transcribed from an archived report.
- **`PELVIC_US`** contained a fabricated uterus measurement, `(5.2 x 4.1 x 3.8 cm)`. [1.50.0] gave
  Pelvic Ultrasound a field set, so a technician pasting this would put a made-up uterus size in
  the narrative while the Measurements block above carried the real one: **two numbers for one
  organ on one report, with no way to tell which was measured.** A live inconsistency [1.50.0]
  introduced.
- **`CBC_NORMAL`** pasted a fabricated patient value beside a reference range that is not this
  clinic's. Their own workbook reads `Male: 13.7-16.7 / Female: 11.7-14.5`, sex-conditional and
  narrower than the one that shipped.

A template is a starting point for prose. It must never carry a number that could be read as a
measurement.

### Endometrial thickness is now a field — with no threshold

Promoted onto `tvs` and `pelvic_gyn`. It is the most standardised measurement in gynaecologic
ultrasound: IETA exists specifically to standardise how it is acquired, and the SRU/ACOG 4mm
cut-off has a >99% negative predictive value for endometrial cancer in postmenopausal bleeding.
Measured against the corpus, **313 of 416 reports (75%)** carry a number explicitly bound to the
endometrium — median 0.76 cm — living only inside a prose sentence where nothing can query it.

`reference_note` is deliberately **NULL**, and the reasoning is worth keeping. The 4mm figure is
conditional on a population this schema does not hold: it is scoped to postmenopausal women *with
bleeding*. For asymptomatic postmenopausal women the literature says the threshold is not known and
ROC work suggests roughly 11mm; premenopausally there is no cut-off at all, since the endometrium
cycles from 1-4mm to 18mm. A `result_fields` row carries neither menopausal nor symptom status, so
any single printed note would be wrong for most of this clinic's TVS patients.

This keeps the `reference_note` rule coherent: it mirrors what is printed on the clinic's own form
(as `N.V. = 5.0 - 25.0 gms` does for the prostate) and never imports literature.

### BPS and Pregnancy Evaluation are different things

The clinic's owner confirmed they are not the same product, and the corpus shows why. **"Pregnancy
Evaluation"** is the study — 17 reports of fetal biometry. **BPS** is a *scoring block appended
inside* one, present in only 2 of those 17: `FT`, `FM`, `FBM`, `AFI`, each 0 or 2. That is Manning's
biophysical profile, and the billing world separates them the same way the catalogue already does —
`BPS` and `BPS w/ NST` are two products because the totals mean different things, /8 against /10.

Two field sets, therefore, not one with an optional NST field: a score of 8 presented as though it
were out of 10 reads as a worse result than it is. `BPS_SUM` totals only the components the set
itself defines, and **refuses to total an incomplete profile** — reporting 4/8 when two components
were never assessed would look like a poor score rather than an unfinished study.

`chk_result_fields_derivation` had to widen to admit `BPS_SUM`; the rollback refuses while any
field still declares it, since narrowing the constraint under live rows would leave data the schema
rejects.

### Two things deliberately not built

**"Pregnancy Evaluation" has no catalogue row**, so the clinic performs the study and cannot bill it
by name. That needs a **price**, and a fabricated price is precisely what `seedRealCatalogue.js`
refuses to invent. Reported in the seed's outstanding block.

**The per-fetus repeating group.** Sized honestly this time: **8 of 17 Pregnancy Evaluations are
twins — 47%**, not the fraction of a percent it looks like against the whole corpus. So it is
required before biometry can be seeded at all, and it is not small: `mergeMeasurements` is keyed on
field code alone, and per-fetus means recasting the carry-forward rule onto a composite key — the
most safety-critical function in the feature. It also raises a question with no current answer: if
version 1 recorded two fetuses and version 2 submits one, is the missing block "carry forward" or
"erase"? Getting that wrong silently retains a demised fetus's biometry on a live report.

### Hadlock stays out, and the research strengthened the case

Gestational age and estimated fetal weight remain **entered**, transcribed from the scanner.
"Hadlock" is a family of a dozen-odd equations rather than one, so reproducing it means guessing
which the scanner is configured for — and guessing wrong prints a number that disagrees with the
sheet the technician is copying from, wearing this system's authority. The AIUM parameter is also
explicit that a pregnancy should NOT be redated after an accurate earlier scan, which is exactly
what recomputing GA on every scan does. And it states that even the best weight prediction carries
errors up to 15%, so computing EFW to the gram implies an accuracy the method does not have.

The corpus's per-parameter ages matching Hadlock closely is evidence the **scanner** emits them.
The scanner is the measuring instrument; this system is the record.

## [1.50.0] - 2026-08-26 (A result is a form, not a paragraph)

### The screens

**One document, three screens.** `components/ResultReport.jsx` renders the clinical report for the
technician's just-released certificate, the staff read-back and the patient's own copy. Three
hand-rolled renderings existed before, and they had drifted: two hardcoded the clinic's name, the
read-back printed no letterhead at all, and only the patient's copy showed the referring physician.
The requirement — *record once, and that is what the patient prints* — cannot be met by three
renderings that agree only by coincidence.

**`components/diagnostic/MeasurementGrid.jsx`** renders the fields, and appears **only when the API
returns a field set**. That is a data-driven switch rather than a category branch, so Laboratory and
X-ray dialogs are byte-identical to what they were, and turning a modality on later is seed data.

Every input in the grid is an `<input>`, never a `<textarea>`. `laboratory.spec.js` drives the
findings box with a bare `page.locator('textarea')`, so a second one anywhere in that dialog breaks
two of its tests with a strict-mode violation — from a file that never mentions the grid. A spec now
asserts the count is exactly one.

**Derived values are not computed in the browser.** A live prostate weight as the axes are typed
would be nicer, and it would put a second copy of clinical arithmetic in the frontend.
`moneyRange.js` exists because two copies of a money rule drifted apart within one commit.

**The reset discipline extends to measurements.** `release()` saves whatever is in state before
releasing, so `openRelease` clearing `findings` but not the grid would write the PREVIOUS patient's
measurements onto this patient's report moments before it is emailed. All three openers clear both.


Four tables, no data. Ultrasound only — see the scope note at the end.

Reverse with `node src/scripts/migrateResultFieldSets.js --rollback`. **It refuses while any
measurement exists unless `--force` is also passed**, because unlike [1.45.0]'s rollback — which
dropped a grouping and left the money intact — this one destroys clinical values a technician
entered, and nothing else in the database holds them.

### What the clinic actually produces

Their own archive settles this. 1,113 real ultrasound reports, and every one opens the same way:

```
Findings:
    Measurements:      <- discrete, per-study numeric fields with units
    <narrative prose, one paragraph per organ>
Impression:
```

The measurement block is not prose and never was. `Right Liver Lobe = 15.81 cm`,
`Gallbladder = 7.09 x 2.21 x 1.67 cm`, `Prostate Gland = 3.42 x 3.46 x 3.22 cm ( wt.= 19.95 grams )`.
A technician retypes it into a free-text box today, and the archive shows the cost: **3.6–5.2% of
derived weights no longer match their own axes** — someone edited the measurements and never
recomputed. Measured independently: the ellipsoid coefficient is exactly 0.5236 in 94% of reports
and wrong in the rest. One file titled `whole abdomen-female- normal.doc` contains a chest X-ray.

The 1,117 files are named by *findings* (`fatty liver + cholecystitis`, `GS only + adnexal cyst`),
not by patient — only 5 of 1,117 carry a patient name. It is a template library maintained by
file-copy, and it is decaying.

### The four tables

- **`result_field_sets`** — one row per study (`whole_abdomen`, `hbt`, `tvs`, …), scoped by
  `category_id` so X-ray can be turned on later as seed data rather than a migration.
  `repeat_label` is non-NULL for exactly one set: a twin study duplicates its column block, and
  every other study in 1,113 reports is flat.
- **`result_fields`** — the field definitions. `value_kind` distinguishes a scalar from a
  `linear3` L×W×H triple, which is one row rather than three: three would lose the grouping, need
  an ordinal to restore the order, and triple the join.
- **`result_field_set_tests`** — which catalogue rows use which set. Deliberately **not** a
  `tests.field_set_id` column: `testRepository.updateTest` writes every column unconditionally,
  which is exactly how the Services Catalogue's status toggle used to wipe a test's `preparation`.
  A new `tests` column walks into the same trap; a separate table cannot be erased by a caller
  that never names it.
- **`result_measurements`** — the values.

### Three decisions that are load-bearing

**Values attach to the result VERSION, not the visit test.** `createResult` inserts a new
`test_results` row per save and copies nothing forward — which is why `resultService` has to
re-read and re-pass file metadata explicitly or an amendment wipes it. If measurements hung off
`visit_test_id`, an amendment would rewrite the superseded version's numbers *in place*, so the
amendment history would render v1's prose beside v2's figures. That destroys precisely what
[1.15.0] exists to preserve.

**The formula is stamped on the stored value, not read from code at render.** `derivation` travels
with the number. If a coefficient is ever corrected, new rows carry the new code and
already-released reports keep saying what they said — the same principle as [1.30.0]'s refusal to
restate a closed day. A `value_source` of `'override'` means a sonologist typed a figure the
formula disagrees with; it is kept exactly as typed. This system shows a clinician a
disagreement, it does not overrule one.

**Only three formulas, all evidenced by the corpus.** `ELLIPSOID_VOLUME` (π/6, verified at 0.5236
across 343 reports), `EDC_NAEGELE` (scan date + 280 − GA, median exactly 280), and `GA_FROM_MSD`
(MSD in mm + 25 — measured; **not** Hellman's +30, which fits this clinic's data terribly).
**Hadlock is deliberately absent.** Gestational age and estimated fetal weight come off the
scanner printout, the clinic's templates state no regression for either, and a fabricated
gestational age on a clinical report is not a rounding error.

### Nothing is NOT NULL at the value level

Every field in the corpus has a real absence rate — the thyroid's right lobe appears in 85% of
thyroid studies, and 18 of 405 whole abdomens carry neither pelvic organ (paediatric, or
post-hysterectomy). A NOT NULL the clinic's own practice violates does not get respected; it gets
a `0` typed into it, which is worse than a blank on a clinical document. `is_required` is advisory
— a UI hint, never a save-blocker.

The sex-conditional branch is real and total: of 405 whole abdomens, 194 carried a prostate, 193 a
uterus, and **zero carried both**. `applies_to_sex` sits on the field rather than splitting the
set in two, which would duplicate the five organs both branches share.

### Scope

**Ultrasound only.** The clinic's archive contains exactly **two** X-ray reports, both Chest PA,
against a 24-test X-ray catalogue. There is no evidence to build the other 23 from, and guessing
at a clinical form produces a document that looks official and is wrong. Laboratory has its own
field taxonomy (74 analytes, sex-conditional reference ranges) and is a later slice.

`schema.sql` is **not** updated, matching what `test_packages`, `payment_methods` and
`payment_submissions` already do — every table added since roughly [1.45.0] lives in its migration
script alone.

## [1.46.0] - 2026-08-25 (A fill and its foreground are two halves of one decision)

No schema change. Frontend only. Fixes the third recurrence of [1.45.0]'s bug shape, and adds the
check that makes the fourth fail at lint time instead of on screen.

### What was reported, and what was actually wrong

Two controls were unreadable in dark mode: the Active Queue's ticket number and Walk-In
Registration's Search button. Both were `bg-slate-900 text-white`. `--color-slate-900` is remapped
to `#eef2f6` for dark mode — near-white — so both rendered white on near-white, **1.12:1**.

The remap is right for the INK role and inverted for the FILL role, which is exactly [1.45.0]'s
finding about `brand-600/700`. The sweep found the same fault in six more places, two of them
worse than the two reported:

| | was | now |
|---|---|---|
| "Confirm Refund" (`CashierDashboard.jsx:190`) | **2.69**, hover 1.89 | 4.70, hover 6.29 |
| Critical-result tap-to-call (`CriticalCallbackDialog.jsx:51`) | **2.69** | 4.70 |
| Queue ticket (`ActiveQueuePanel.jsx:147`) | **1.12** | 15.87 |
| Search (`WalkInPanel.jsx:51`) | **1.12**, hover 1.31 | 15.87, hover 13.67 |
| `Button` `secondary` pressed (`button.jsx:27`) | **1.00** — white on white | 17.85 |
| `Badge` `secondary` / `destructive` | 1.12 / 2.69 | 15.87 / 4.70 |
| Public footer body text (`PublicFooter.jsx`) | **1.81** | 11.55 |

The refund button is the one that matters most: an irreversible, money-moving action whose label
was hardest to read at the moment of pressing it. Neither it nor the critical-callback button was
in the report.

### The root cause was in the dark-mode work itself

`--color-emphasis` exists precisely to solve this. [1.40.0] created it as the seam token for "the
dark counterpart to the primary button", correctly reasoned that it must invert with the ground,
and set its dark value to `#eef2f6` — while `button.jsx` kept a hardcoded `text-white`. The fill
flipped and its ink could not follow, because a literal has no theme.

`emphasis` was **the only fill token in the file shipped without a foreground**. `primary`,
`secondary`, `destructive`, `card` and `popover` all have one, and the dark block already flips
`card-foreground`/`popover-foreground` in lockstep. So the fix is the file's own existing idiom,
not a new one:

- `--color-emphasis-foreground`: `#ffffff` light, `#0f172a` dark, **defined next to the fill** so
  the two cannot drift apart again.
- `--color-destructive` promoted to a real ramp (`-hover`, `-active`, `-foreground`). Deliberately
  **absent from the dark block**: red carries its meaning by hue rather than by tonal distance, so
  it reads on both canvases, and inverting it would turn the one irreversible button in the app
  pale. Its value moved `#ef4444` → `#e11d48` — the old value had zero consumers and would have
  *lowered* light-mode contrast from 4.70 to 3.76.

All eight call sites now use a paired token. Two were hand-rolled bypasses of a primitive built
for exactly them: the Search button became `<Button variant="secondary">` and the refund button
`<Button variant="destructive">`, which also retires two [1.39.0] label-swap stragglers.

### The same fault, pointing the other way: ink on surfaces that never flip

A surface that is dark in BOTH themes must not carry themeable ink — the fourth appearance of this
(rail heroes in [1.40.0], `rail-accent` in [1.43.0], `.auth-panel` in [1.45.0]). `rail-ink-*`
exists for it, and the migration had been started and abandoned: `AboutUs.jsx:38` already used
`text-rail-ink-soft` on the line directly below a `border-gray-800` that was still broken.

Migrated: the whole public footer (body copy at 1.81:1, plus two `border-gray-800` hairlines that
were rendering at **12.45:1** — bright white slashes where a subtle seam belongs), the three public
banners, both `bg-rail` portal cards, and four `rail-gradient` heroes that a previous pass reported
as fixed and had missed.

### Twelve invisible skeletons

`bg-slate-100`/`bg-gray-100` remaps to `#16212e`, which against a card's `#131c2b` is **1.05:1**.
Twelve loading placeholders across nine screens were invisible, silently reinstating the exact
failure `skeleton.jsx` documents: a panel that reads "nothing here" rather than "not yet", so
people conclude a queue is empty and leave a screen that is about to fill. No contrast rule covers
a decorative placeholder, so nothing else would have caught it. All twelve had bypassed the
`Skeleton` primitive; they now share one `--color-skeleton` token (1.68:1 on dark, matching light
mode's weight).

### Three more

- **Cut-out rings stopped cutting out.** The unread-count `ring-white` and the avatar's
  `border-white` are gaps matching the ground, not decoration; `white` never remaps, so both became
  bright halos on dark chrome. Now `ring-surface` / `border-surface`.
- **The payment QR had no white backing at all.** A QR is a machine-readable optical target — its
  contrast budget belongs to the scanner, not the theme. A transparent upload rendered dark-on-dark
  and would not scan, and `object-contain` letterboxed dark canvas into the quiet zone even for an
  opaque one. Now a fixed `#ffffff` with `p-2`. This is the only item here whose failure mode is a
  patient unable to pay.

### `scripts/checkFillRoles.js` — why a comment was not enough

`index.css` already carried a warning that this ramp "is NO LONGER MONOTONIC" and that misusing it
"will produce dark-on-dark". Four instances were then written anyway, one of them by the same pass
that wrote the warning. Prose does not stop this; a grep does.

The check bans `bg-{slate,gray}-{700,800,900,950}` and `bg-{rose,red}-{600,700,800}` outright.
Those shades are ink; every legitimate solid fill goes through a paired token. Making the rule
absolute keeps it context-free — no pairing analysis, no false positives — and it fails on the
fill you wrote rather than on the foreground you forgot. It also reads the dark block out of
`index.css` at runtime and warns about any *other* shade that block turns light while being used
as a fill, so it widens as that block grows rather than needing to be kept in sync by hand
(`prose_scan.py`'s `HOOKS` list is its eyesight, and that is a weakness worth not inheriting).

Wired into `npm run lint`. Verified by reintroducing both original bugs and confirming it fails.

### Known, still not fixed

Unchanged from [1.45.0]: the Google sign-in button (shadow DOM), the Recharts axis/grid/cursor
props, and two `lib/categories.js` chart colours below the 3:1 floor. Newly noted and left alone:
`ring-rose-300` on `wait-badge.jsx` is the one shade in a four-step severity ladder the dark block
does not remap, so the worst wait tier shouts louder than the other three — arguably correct, but
by accident. And `Receipt.jsx` on screen is a themed panel while the paper is pinned light, so a
cashier proofing it before printing is not previewing what prints; that is a product decision
rather than a defect.

## [1.49.0] - 2026-08-25 (Tell the patient, and let the cashier look back)

No schema change. The two gaps [1.48.2] left open.

### The patient is told, by email, because there is no other channel

**The patient portal has no notification bell.** An in-app notification addressed to a Client would
be a row written to a table nobody can ever see — so for a patient, email IS the channel and the
portal card is where they look it up afterwards.

That matters most in exactly this flow: the patient has paid and is waiting on something only the
clinic can do. Silence reads as "it did not go through", and the usual next step is paying twice.
So a decision now sends one of two mails:

  * **verified** — the pass is ready, with the receipt number and amount
  * **rejected** — with the reason, and how to send it again

The reason is the whole message. Requiring one at rejection ([1.48.0]) is only worth anything if it
reaches the person who has to act on it — otherwise it is a note the clinic writes to itself, which
is the failure [1.27.0] fixed for HMO refusals.

Both are sent AFTER the decision commits and neither can fail it: `sendEmail` already swallows
transport errors, and `notifyPatient` adds the same guarantee around the lookup. Verified against a
real client booking with SMTP off — the log shows a clean skip naming the recipient and subject.

The address comes from the account that OWNS the patient profile, never from `submitted_by`:
reception can file a claim on a patient's behalf, and mailing the receptionist that their payment
was rejected helps nobody.

### A settled submission stopped disappearing

Verified or rejected, it dropped out of the only screen that showed it. A cashier asked "did we take
that GCash payment yesterday?" had nowhere to look, and could not re-open the screenshot behind a
decision somebody else made — the receipt was in Transaction History, but the EVIDENCE for it was
nowhere.

`GET /payment-submissions/reviewed` and a **Recently Reviewed** panel: who decided, when, the
receipt number if it produced one, the reason if it did not, and the proof still openable. Gated on
`billing:read` rather than `billing:process` — looking is not taking money, and Admin oversees the
cash-up without being able to transact on it.

Bounded at 20 rather than paged: this answers "what happened recently", and anything older is a
question for the transaction history, which is built for it.

## [1.48.2] - 2026-08-25 (Catching a bad screenshot before the cashier does)

No schema change.

**The patient sees what they are about to send.** A thumbnail of the chosen file, its size, and a
line saying to check the reference and amount are readable — plus a remove button. This is the
cheapest possible place to catch an unreadable screenshot: at thumbnail size it is obvious, and
fixing it costs one click instead of a rejection, a phone call and a second upload. The guidance
("a screenshot from your banking app works better than a photo of the screen") is stated BEFORE the
file picker rather than in a rejection afterwards.

The object URL is revoked on replacement as well as on unmount, so picking three files in a row
does not leak two blobs for the life of the page.

**`backend/src/utils/money.js`.** The backend wrote money into notification text as
`₱${n.toFixed(2)}` at each site, so a cashier's bell read "₱13690.00" — legible only by counting
digits, which is the opposite of what a glanceable notification is for, and disagreeing with every
figure on screen. One formatter now, same locale and options as the frontend's `lib/currency.js`,
used by both notification sites so they cannot drift.

Verified that the cashier notification actually lands, rather than assuming the server call worked:
the bell goes 10 → 11 and reads "Proof of payment to review — Ref … awaiting verification".

## [1.48.1] - 2026-08-25 (The screens for it)

No schema change. The three screens [1.48.0]'s API was built for.

**SuperAdmin → Payment Methods** (a third tab beside the RBAC matrix and elevated accounts, which
is where the other two undelegatable capabilities already live). The account number is echoed back
in large tabular figures as it is typed, because a mistyped digit produces no error anywhere — the
money simply goes to a stranger — so the only defence is making it easy to read back against the
banking app it was copied from. A standing banner says every change is recorded against your name,
and a red line appears if every method is hidden, since "patients cannot pay online at all" is
invisible from a list that has rows in it.

**The patient's booking card** now shows the clinic's account, its QR, a copy button for the number
and an upload form — and the QR booking pass is issued only once payment is verified.

That last part reverses [1.23.0]'s rule, and the reasoning it reversed is worth keeping: the pass
used to require payment, that disabled the feature because the clinic could only take money at the
counter, so it was shown unpaid instead. **That premise is gone** — a patient can settle from home
now, so withholding the pass gives them something to do rather than stranding them. The reference is
still printed as TEXT on an unpaid booking, so the counter path never depended on the QR at all.

`amount_due` was added to the client's bookings query: a patient about to type a figure into a
banking app should not have to go and find it somewhere else.

**Cashier → Online Payments**, polling at 20s because a patient who has just paid is watching for
their pass and the cashier is the only thing between them and it. The queue puts what the patient
claims beside what the visit owes, and spells the mismatch out in words — "Approving records
₱1,450.00 as received" — because two numbers in adjacent columns is exactly the difference a tired
eye slides over at the end of a shift.

`ConfirmDialog` gained `children`, so a rejection can carry its reason field.

### One bug this introduced and caught

`payment_submissions.payment_id` references `payments`, so `purgeE2eData.js` deleting payments first
failed the constraint and **aborted the whole purge**. Surfaced as a "purge failed (non-fatal)" line
after a green spec run — which is exactly the shape of thing that gets skimmed past. Submissions are
deleted before payments now.

## [1.48.0] - 2026-08-25 (Pay into the clinic's own account, and a cashier checks it)

`node src/scripts/migratePaymentSubmissions.js` — additive, idempotent, `--rollback` reverses it.
Then `node src/scripts/setupRbac.js` for the new permission.

Online payment **without a gateway**. The patient pays into the clinic's own GCash or bank account,
uploads a screenshot with its reference number, and a cashier looks at it and approves. Deliberately
not PayMongo: the gateway path ([1.37.0]) stays in the codebase, dormant, and this needs no merchant
account and no publicly reachable webhook.

### Two tables, and why not one

`payment_methods` is what the clinic PUBLISHES — a GCash number, a bank account, a QR image.
`payment_submissions` is what a patient CLAIMS — "I sent ₱1,450, here is the screenshot".

`payments` is not extended, because `payments` is the money: every peso figure in the app is
aggregated from it, and `receipt_number` comes from `daily_counters` at the moment a real payment is
taken. An unverified claim is none of those things, and writing claims in there with an 'Unverified'
status would put them one missing WHERE clause away from counting as revenue — the exact class of
bug [1.30.0] spent a release fixing.

On approval the cashier's **existing** `processPayment` runs: same receipt number, same visit
release, same cash-up entry, same audit trail. A parallel "verified payment" writer would have been
a second way to take money, and the two would have drifted the first time either changed.

### The claimed amount is never trusted

Verified against a live visit: a claim of ₱50 on a ₱1,450 visit, approved by a cashier, produces a
payment of **₱1,450** — the figure comes from the recomputed bill, not from what the patient typed.

That is right for the ledger and wrong for the drawer, so the review queue now carries `amount_due`
beside `amount_claimed`. The cashier is the control, and a control needs both numbers side by side
rather than in two screens.

### `payment_methods.kind` is constrained to Cash / GCash / Bank

Not free text, which was the first shape. `payments.payment_method` is constrained to exactly those
three by `chk_payment_method` ([1.33.0]), and the drawer tiles and `findTransactionSummary` are
built on them — a fourth kind would either fail the constraint on approval or land in a bucket that
belongs to no tile and quietly vanish from the day's total. The clinic's own naming lives in
`label`: kind `Bank`, label `BPI Savings`.

### Who may do what

Publishing an account number is **SuperAdmin only**, matching `superAdminRoutes.js` and
deliberately not delegable by permission — it is where a patient's money is about to be sent, and a
wrong number here routes real payments to a stranger. Every write is audited with the old and new
number, because that is the only question anyone asks afterwards.

`billing:submit_proof` (new) covers filing a claim: Client, Receptionist, Cashier, Admin. Verifying
is `billing:process` — taking money, which stays with the cashier. Admin can file one and cannot
verify one, preserving the standing separation of duties.

### A hole in verifyRbacWiring, found by falling into it

The route parser read **one line at a time**, on the stated convention that every route fits on one.
A route written across several lines was therefore not examined at all. Caught when a route gated on
`billing:submit_proof` — a permission that did not exist — was reported as "All good", which is the
single thing that script exists to make impossible. It joins a `router.<verb>(...)` call across
lines on balanced parentheses now, and immediately reported the four real problems it had missed.

## [1.47.1] - 2026-08-25 (The demo seeder outlived the departments it named)

`seedDemoScenario.js` hardcoded all five categories in four places. Retiring 2D Echo and ECG in
[1.47.0] therefore left `catalogue['2D Echo'][0].id` reading a property of `undefined`, and the
seeder died with "Cannot read properties of undefined" — so the documented pre-demo step
(`resetDemoData.js --confirm` then `seedDemoScenario.js`) was broken by the change and nothing in
the suite covers it, because the seeder is tooling rather than app code.

It derives the list now: `OFFERED` is whichever categories actually have active priced services,
and the two places that named a specific one fall back to a category that exists. A demo seeder
that cannot run is worse than one covering fewer departments, and which departments the clinic
sells is not this script's fact to assert.

Found by running it, not by reading it — the same reason the pre-demo step is documented at all.

## [1.47.0] - 2026-08-25 (2D Echo and ECG retired; packages become editable)

No schema change.

### 2D Echo and ECG are not offered

The clinic confirmed it does not do them. Their three tests are **deactivated**, not deleted, and
the `test_categories` rows stay — 18 historical `visit_tests` point at them, and a past visit has to
keep being able to say what it was for. `modality.js`, the category colours and the portal's result
filters all keep their entries for the same reason. Removed from the public copy that advertised
them: the Home hero's service list, the About Us founding sentence, and the footer's services
column. The public price list and the booking picker read only active rows, so both dropped them on
their own.

`services-fold.spec.js` used ECG as its "small department" example in three assertions. Repointed to
Ultrasound — the property it tests (a layout tuned for the long department must not drop the others)
is unchanged; only the example was retired.

### Packages were read-only, which made them half a feature

`[1.45.0]` shipped `GET /api/packages` and nothing else. An admin who could already reprice every
individual test could not touch the bundle those tests are sold in — the only way to change a
package price or its contents was to edit `seedRealCatalogue.js` and re-run it.

Now `POST /packages`, `PUT/PATCH /packages/:id`, and `GET /packages/manage`, all behind
**`tests:manage`** — deliberately the same permission that governs pricing a test, because a package
IS a price. A separate permission would have to be granted alongside it every time, and the first
time somebody forgot there would be an admin who could reprice a test but not the bundle containing
it. Admin and SuperAdmin hold it; Reception and Client get 403.

Two guards on the server, not just the screen: a bundle of fewer than two tests is refused (that is
just a test), and a retired package cannot be booked.

### One bug caught before it shipped

The management listing was first a `?includeInactive=true` flag on the public route. That route runs
no `verifyToken`, so `req.user` is undefined even when a caller sends a perfectly good token — the
flag was **silently always false**, and the management screen would have shown an incomplete list
with nothing to indicate why. An authorisation decision needs middleware that actually runs, so it
is its own route now.

`packageRepository.update` COALESCEs per column, so a caller sending only `isActive` cannot blank
the description — the `testRepository.updateTest` trap, avoided in advance rather than after.

### The purge grew again

`packages.spec.js` creates a bundle to prove who may price one. Named `E2E …` and removed by
`purgeE2eData.js`, exactly as the catalogue fixtures now are — a package left behind is a fake deal
sitting in the admin catalogue and, if it were still active, on the public price list.

### A correction

The handwriting beside the package panel is a list of **individual prices**, not a breakdown of
Package E — this repo had it the wrong way round. Package E keeps its printed ₱2,050. "HIV 500" is
loaded. Two remain open and are printed by the seed script every run: "TVS-300" contradicts the 2025
ultrasound sheet's printed ₱700 (the printed figure was loaded), and "PB-1,200" is an abbreviation
this repo cannot resolve.

## [1.46.0] - 2026-08-24 (Test data that looks like a clinic)

No schema change. Test tooling only.

### The catalogue was silting up, in a place people look

`catalogue-partial-update.spec.js` mints a throwaway test to prove a status toggle does not wipe a
test's preparation text, and **deactivates** it rather than deleting. `purgeE2eData.js` scopes by
the throwaway email domain and the run window — it never touched `tests` — so one row was left
behind on **every single run, forever**.

They are not hidden either. They sit in the admin Services Catalogue as
`E2E Preparation Guard 1787594770405`, which is what somebody sees when they open that screen to
change a price. Twenty-one had accumulated before this was noticed; five more appeared during the
day's work. The purge now removes them, and only ever removes rows nothing references — a fixture a
surviving visit still points at stays, because deleting it would change what a past bill says it
was for.

### Fixtures are named after people now

`E2E Pkg1786480428`, `Reyes-17863726459464828`, `M9 Fixture1786…`. Those are real rows in a real
database while the suite runs — they sit in the Active Queue, the billing queue and patient search,
so anyone opening the app mid-run sees a clinic full of garbage, and a demo that overlaps a test
run looks broken. It also made the seeded demo data and the test data look like two different
products.

`tests/e2e/helpers/people.js` hands out realistic Filipino names from a ~2,500-combination pool,
remembering what it has issued and re-rolling on a repeat, falling back to a compound surname
("Santos-Villanueva") rather than a visible escape hatch. The uniqueness that used to live in the
NAME now lives in the **email**, where nobody has to read it.

### What identifies a fixture, now that the name does not

Nothing in the automatic teardown ever used the name — `purgeE2eData.js` scopes by the
`@enlogada-e2e.test` domain and the run's start timestamp, and walk-in fixtures (which have no
account) are caught as parentless patients created inside that window. Both are name-independent.

`cleanE2eData.js` is the exception: it is the manual tool for a database that has already silted
up, and it **did** match on the old name shapes. It gained the reserved contact number `09000000000`
(no Philippine mobile prefix is 0900, so no live patient can collide) and keeps the old patterns
for the historical rows — removing them would strand those permanently.

### One spec deliberately keeps a synthetic name

`revalidation.spec.js` filters the queue to a surname that **must not exist yet**, so the empty
result can be cached with its ETag and then overturned. A realistic surname drawn from a pool could
already belong to a seeded demo patient, and the precondition would silently not hold. It keeps
`Revalidate<timestamp>`, with the reason recorded beside it.

### A trap this surfaced

`laboratory.spec.js` asserted `` `M9 ${patient.last_name}` `` — the fixture's first name hard-coded
into five assertions, a second source of truth for a fact the fixture already carries. It broke the
moment the fixture stopped being called "M9". They read `patient.first_name` now.

## [1.45.0] - 2026-08-24 (The real price list, and the package deals)

`node src/scripts/migrateTestPackages.js` — additive, idempotent, `--rollback` reverses it.
Then `node src/scripts/seedRealCatalogue.js --confirm` to load the data.

### The rest of the price list

The catalogue held real prices for Laboratory only; Ultrasound and X-Ray were still demo figures.
Transcribed from the clinic's own laminated sheets, including the handwritten amendments:

    Ultrasound   4 demo rows  ->  14 real services   (2025 sheet)
    Xray         3 demo rows  ->  24 real services   (both printed pages)
    Laboratory  22 unchanged, + HIV Screening

Demo rows whose real equivalent is on a sheet were **renamed and repriced in place**, because
`visit_tests.price_at_time` snapshots the sale price and historical rows point at those ids. Demo
rows with no equivalent were **deactivated, never deleted** — deleting orphans the visits that used
them, and leaving them bookable sells a service at a price the clinic never set. Three were
deactivated (Abdominal Ultrasound, Breast Ultrasound, Abdominal X-Ray) and each is named in the
script's summary so the clinic can re-enable it with a real price.

### Packages: why they are not a `tests` row

The five bundles (A–E, ₱1,450–₱2,400) had never existed in the system, so reception was adding the
components one at a time and the patient paid the **sum of the parts** — always more than the
package. Package A is ₱1,450; its components at list are ₱1,650.

A package cannot be a `tests` row, because a row has one `category_id` and that is what routes work
to a department worklist. Every one of these spans Laboratory *and* Ultrasound, so as a single row
half the work would never reach the department that has to do it.

So `test_packages` + `test_package_items`, and at booking a package **expands into one
`visit_tests` row per component** — exactly as if reception had added them individually. Every
downstream screen keeps working unchanged, because it is looking at ordinary visit_tests.

### The allocation, which is the only real logic

The fixed price is spread across the components in proportion to their list prices, with the
rounding remainder placed on the largest, so the parts sum to the whole **exactly**:

    Package A ₱1,450, components at list ₱1,650
      Pelvic Ultrasound 500 -> 439.39     CBC              180 -> 158.18
      HIV Screening     500 -> 439.39     Hepa B Screening 190 -> 166.97
      Blood Typing      190 -> 166.97     Urinalysis        90 ->  79.10
                                                           sum = 1450.00

Exactness matters because `price_at_time` is what every downstream total reads — the visit
subtotal, the statutory discount base, the cashier's drawer, and `reportRepository`'s per-department
revenue share. Proportional rather than even, so the department that did the ₱500 of work is
credited with it.

The alternative — one line at the package price plus a discount line — was rejected: it puts the
whole bundle in one department's revenue and leaves the other showing work it did for nothing.

`visit_tests.package_id` records which bundle a line came from, so the terminal and the receipt can
say "Package A" once rather than listing six components at prices that look arbitrary alone
(₱158.18 for a CBC invites a question the cashier cannot answer).

### HIV, and the arithmetic that caught the error

HIV Screening is on no printed sheet. Loaded first at ₱0.00, which made the totals absurd — **four
of the five packages cost MORE than their own components**. The clinic confirmed the handwritten
"HIV 500" on the package panel, and at ₱500 every bundle becomes a real saving (A +200, B +190,
C +190, D +50, E +590). The seed script now refuses to be quiet about this: it totals every package
against its components and prints a loud warning for any that is upside down.

### Two bugs found by testing rather than by reading

- **`attachTests` short-circuits to `[]` on an empty `testIds`**, which for a package-only booking
  discarded the rows just written and reported "0 test(s) added" for a visit carrying six. The
  attach path re-reads the visit now instead of trusting what it inserted.
- **The seed script was not idempotent.** The first run renames "Chest X-Ray (PA)" to "Chest PA";
  the second looks up the old alias, fails, plans an INSERT and dies on `uq_tests_category_name` —
  rolling back the whole run. It looks up the canonical name first and falls back to the alias.

Packages attach BEFORE loose tests in both booking paths. Both writes are `ON CONFLICT DO NOTHING`
against `uq_visit_tests_visit_test`, so for a test that is both inside a bundle and picked
individually, whichever lands first sets the price — and the package's allocated share is the one
that must survive, or the bundle quietly costs more than its fixed price.

## [1.45.0] - 2026-08-24 (A ramp remapped for one role is still live in the other)

No schema change. Frontend only. Follows [1.44.0]; fixes defects in [1.40.0]'s dark mode found by
reading the merged stylesheet rather than by any test — nothing in the suite asserts a colour, so
all of this passed 200 green tests while being visibly broken.

### The mistake, stated once, because it caused most of the list

The dark block remaps `--color-brand-600/700` and `--color-azure-600` to *lighter* values, and the
comment beside them says why: "ink lightens; the light ramp darkens". That is correct for ink. It
is wrong for the same token used as a **fill**, and both roles are live:

```
bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700   <- button.jsx, the default variant
```

So in dark mode every primary button got *lighter* when hovered (white on `#81a570`, **2.30:1**)
and lighter still while held down (white on `#acc4a1`, **1.60:1** — the label vanishes under the
cursor). That is Take Payment, Release Result and Confirm Booking. The fill role is now pinned
back to the light ramp: hover **5.64:1**, active **7.66:1**, and pressing something still darkens
it, which is what the gesture means in either theme. Same fault and same fix for `hover:bg-azure-600`
on the Services CTA (2.60 -> 6.60).

### A fixed-dark surface must not follow the ramp

`.auth-panel` does not flip — like the rail, it is dark in both themes. Three of its four text
elements used azure as ink, so remapping azure took the eyebrow, all three trust points and the
address footnote to roughly **1.1:1**: invisible. The tokens are rebound on `.auth-panel` itself
rather than by matching generated class names, which also covers the opacity variants
(`text-azure-100/80`) and anything added there later. Now 5.25-6.57:1.

This is the third time this shape of bug has appeared (the rail heroes in [1.40.0], `rail-accent`
in [1.43.0]). **If a surface is dark in both themes, ink on it is not themeable.**

### Tailwind emits one class per variant, and `divide-*` is not `border-*`

`.border-[#e6ebf1]` never matches `.hover:border-[#e6ebf1]`, and `divide-y` compiles to a selector
of its own — measured against the built CSS, v4 emits `:where(.divide-[#eef2f6]>:not(:last-child))`,
**not** the v3 `> :not([hidden]) ~ :not([hidden])` shape. The first version of this fix used the v3
shape: valid CSS, matching nothing. Covered now, each verified present in `dist/`:
`divide-[#eef2f6]` (4 admin panels), `hover:border-[#e6ebf1]`, `bg-[#e6ebf1]` (the gridline fill on
Cashier Monitoring), `bg-white/95` (the checkout terminal's sticky header — one file away from the
`/85` rule written for exactly this).

### The rest

- **`.alert-*` kept its pale rings.** The rims are `box-shadow: inset`, and `.alert` declares no
  `border` at all — so [1.40.0]'s `border-color` override was a no-op on all four tones. The
  sign-in error alert wore a pink pastel ring on a dark tint. Now overrides `box-shadow`.
- **Stacked table cards were literal `#fff`.** An element selector on `<tr>`, unreachable by the
  `.bg-white` class override, so below 639px every card list rendered `#eef2f6` ink on white — on
  the phone width the block exists to serve.
- **The crash screen was unreadable.** `text-[#192534]` heading and a retry button hovering to
  `#67803c` from the retired ramp, on the one screen shown when everything else has already failed.
- **The travelling tab pill matched its own card.** `bg-white` and `.auth-card` both resolve to
  `--color-surface`, and its shadow is an arbitrary literal inlined at build time, so the indicator
  [1.44.0] is built around disappeared. It is lighter than the card now, as it is in light mode.
- **`text-brand-800`** had no dark value (1.40:1 on the permissions-matrix callout). Now 11.78:1.
- **`shadow-raised`** was not in [1.40.0]'s elevation rewrite, so the hover lift silently stopped
  existing; `hover:border-azure-200` failed on the same cards at the same moment, leaving service
  cards with no hover state at all. Both fixed.
- **The focus ring** was a literal `#0a71a9` at **1.90:1** on the dark canvas — the app's only
  focus indicator, and the last affordance that should thin out. Now `#549cc3`, **6.17:1**.

Every ratio above is computed, not estimated. All 14 override selectors were checked against the
built CSS to confirm they match a class Tailwind actually emits.

### Known, deliberately not fixed here

Three need component changes rather than CSS and are left for a decision:

- **The Google sign-in button** is `theme="outline"`, rendered by Google's own widget inside shadow
  DOM. No stylesheet can reach it, so it stays a white slab in a dark card. Needs `theme` driven
  off `data-theme`.
- **Chart axes, gridlines and the hover cursor** are Recharts SVG props (`stroke="#f1f5f9"`,
  `cursor={{ fill: '#f8fafc' }}`), unreachable by any class override. On a dark card the gridline
  becomes the loudest thing in the chart.
- **The categorical chart palette** (`lib/categories.js`) is five fixed hexes; two fall below the
  3:1 non-text floor against the dark card. Its prose still claims the palette "passes all of
  them", which was true against one surface and is not with two.

## [1.44.0] - 2026-08-24 (The sign-in page, actually redesigned)

No schema change. Frontend only.

[1.43.0] recoloured this page and moved a toggle, and called that a redesign. It was not. This is
the pass that reads published guidance first and then changes the structure.

### The form had no surface, and that was the whole problem

Established practice for an auth screen is a compact card with a soft shadow, so the task stands
out from the page. This page deliberately had none — [1.23.0]'s reasoning was "the column IS the
card" — and that single decision is why it read as unfinished no matter what the panel beside it
did. A bare form on flat white gives the eye nothing to land on.

So: `.auth-card`, a white card with a soft shadow, sitting on `.auth-ground` — a very lightly
tinted surface carrying an azure and a green wash. White-on-white gave the card nothing to
separate from.

### The motion was wrong in three specific ways

Micro-interactions read as responsive in the **120–220ms** band; past that they read as animation
you are waiting for.

- **The mode swap was 320ms and always slid in from the right.** Going *back* to Sign In therefore
  travelled the same direction as leaving it, so the motion contradicted the navigation. It is
  directional now (`authSwapFwd` / `authSwapBack`) and 260ms.
- **The toggle blinked.** A white background jumped from one button to the other. It is one pill
  that *travels*, 220ms, transform-only so it composites — the indicator leads, the form follows,
  and the two read as a single movement.
- **A rejection had no motion at all.** A wrong password now shakes the alert: horizontal
  oscillation, which is physically a head-shake. It rides **alongside** the red border, the icon
  and the message, never instead of them — motion says nothing to a screen reader or to anyone
  with reduced motion on, and the blanket `prefers-reduced-motion` rule correctly kills it while
  the border and text still carry the whole message. Keyed on a rejection *count*, because two
  wrong passwords in a row set the same error string and React would otherwise keep the element
  and not replay.

### Focus is one colour and one idea, at two scales

The global `:focus-visible` outline was green while the interactive colour is now azure. Both are
azure now, and a text field draws a soft inner ring instead of an offset outline — a 2px outline
*around* a bordered input plus the input's own focus border is two rings on one control.

### A layout trap worth writing down

The Google button takes a pixel width only. Without `min-w-0` and `overflow-hidden` on its slot,
an oversized button sets that slot's min-content width, which pushes the card, which pushes the
page — and the ResizeObserver then measures the *inflated* width and can never converge. Measured:
a 390px phone scrolled 22px sideways. Clipped, the slot's width is dictated by the card, the
measurement is honest, and it self-corrects. Verified at 1440, 768, 390 and 360, both modes.

## [1.43.0] - 2026-08-24 (A front door worth walking through)

No schema change. Frontend only.

### The sign-in panel was muddy, and that was a token being used out of place

The dark column used `.rail-gradient`, which washes **green and azure** over near-black. That is
correct for a hero band sitting under a page of white content — it is chrome, seen in a strip.
Filling half the sign-in screen with it produced a large field where the two hues meet and go
muddy, which is the opposite of what a clinic's front door should look like.

`.auth-panel` is **one hue** — the logo's azure — walked from `#0a71a9` to `#052f47` along a single
diagonal, with a soft white light-source high on the panel for depth. A single hue cannot go muddy;
it only gets darker.

### The mode switch was in the wrong place, so the transition had nothing to hold

Getting from sign-in to register was a text link at the very bottom of the form, *below* the Google
button — so somebody who arrived on the wrong one scrolled past an entire form before finding out
there was another. The two modes are peers, so they are now a segmented control at the top: it
states both, says which one you are on, and gives the swap something to actually transition
between. The two bottom links are gone, being the same action said twice in the worse place.

The swap animation is its own keyframe (`animate-auth-swap`, 320ms with a little lateral travel)
rather than the generic panel fade. A form *replacing* another form is a different motion from a
panel appearing.

The panel content was trimmed too: it carried a headline, three paragraphs and a full address
block, reading as a wall beside a five-field form. Contact details are a footnote now — and the
address **wraps instead of truncating**, because "Misamis Orient…" is not a shorter address, it is
a wrong one, and it is the only thing on the page telling somebody where to turn up.

### Large is the default text size, and the public pages lost the control

The size control was clutter on a marketing header — a utility toggle at full strength competing
with the navigation and the primary call to action. But the *reason* it existed still applies to
the people reading those pages, and they are the least likely to go hunting for a setting.

So the control is off the public header entirely, and `DEFAULT_ID` is `large`: everyone gets the
comfortable size until they say otherwise. Staff keep the control on their own consoles and the
portal, where somebody working a full shift may want the denser layout back.

Swept for overflow at the new default across Home, Services, About and sign-in at 1440 and 390,
plus all five consoles: clean everywhere.

`text-scale.spec.js` was rewritten to match — it drove the widget on a public page, which no longer
has one. The hierarchy check now arrives with a stored preference instead, since what it tests is
the CSS ramp and that has to hold where there is no widget. Its `cn()` guard is expressed against
the root size rather than a fixed 10px, so it keeps testing the token rather than today's default.

## [1.42.0] - 2026-08-24 (The type scale was being deleted on its way to the DOM)

No schema change. Frontend only. One line of real change, and it moves every screen in the app.

### What was wrong

`cn()` is `twMerge(clsx(...))`. tailwind-merge decides which of two conflicting classes wins by
parsing the class NAME against its own model of Tailwind — and it knows nothing about this
project's `@theme` block. For the `text-*` prefix it guessed wrong in the worst available
direction: `text-micro` is a font size, tailwind-merge cannot tell "micro" from a colour name,
filed it under text-colour, and then

    cn('… text-micro font-semibold …', 'text-slate-500')

resolved the two as conflicting colours and **dropped the size entirely**.

Measured on the cashier's Collections strip: the metric label asked for `text-micro` (10px) and
rendered at **16px inherited**. That is why every metric card across every console had a label
louder than the figure it labels — the component was correct, the class never arrived.

All seven custom sizes behaved this way, in every component reaching for `cn()` alongside a text
colour, which is most of `components/ui/`. Custom shadows had a quieter version of the same fault:
unrecognised, so `shadow-float` and `shadow-sm` did not conflict and BOTH applied.

### Why it appeared now

Honest accounting: [1.38.0] introduced it. The app previously wrote these sizes as arbitrary
values (`text-[13px]`), and tailwind-merge parses `[13px]` as a length and correctly files it as a
font size. Converting 85 of those to named tokens is right — `rem` tokens scale with the reader's
text-size setting and pinned pixels do not — but it walked straight into this, and the failure is
silent in both directions: the class is right there in the JSX, and the build is happy.

    text-[13px] text-slate-700   ->  text-[13px] text-slate-700    (kept)
    text-note   text-slate-700   ->  text-slate-700                (size gone)

### The fix

`cn()` uses `extendTailwindMerge` with the theme keys registered, so tailwind-merge resolves them
as what they are. Verified in both directions — `text-sm text-note` → `text-note`, and
`text-note text-sm` → `text-sm`.

Colours needed no entry: an unknown `bg-*`/`text-*`/`border-*` colour already merges correctly,
because colour is tailwind-merge's fallback guess. That is the same fallback that broke the sizes.

**Adding a token to a non-colour `@theme` namespace now means adding it to `lib/utils.js` in the
same commit**, or it works everywhere except the components that use `cn()`.

### The guard

`text-scale.spec.js` gains a case that reads the *computed* size of a real metric label off a live
console. Nothing catches this by reading source — the class is present in the JSX and absent from
the DOM — so the only honest check is measuring what the browser ended up with. Verified by
reverting `cn()` to plain `twMerge`: expected 10, received 16.

## [1.41.0] - 2026-08-23 (The palette comes off the logo)

No schema change. Frontend only.

### The identity was half the logo

Sampled from `Enlogada_Mark.png` itself rather than chosen: the artwork is **49% blue and 49%
green** by pixel area, and its single most common colour is `#0a71a9`. The UI had been built on
the green half alone — and on an approximation of it at that. Three things followed:

- **`--color-azure-*` added**, anchored on `#0a71a9` verbatim. This is the clinical half of the
  identity and it had no presence in the interface at all. It also solves an accessibility problem
  the green could not: white on `azure-500` measures **5.32:1** and passes WCAG AA outright, where
  white on the old `brand-500` was **3.59:1** and failed — the standing workaround being to reach
  for `brand-600` on public pages.
- **`--color-brand-*` re-anchored on `#53843b`**, the logo's actual green, replacing `#769046` — a
  lighter, more olive green that approximated the mark rather than matching it. Contrast improves
  from 3.59:1 to 4.44:1 as a side effect. The four remaining hard-coded `#769046` values (the RBAC
  checkbox accent, the revenue chart, the Laboratory category colour, the focus ring) moved with it.
- **`--color-marine-*`** for the logo's deep navy `#1d407d`, distinct from `--color-rail`, which is
  near-black slate and stays the app shell.
- **`.rail-gradient` rebuilt from the logo's own two colours.** It had been washing green over
  `#34466b` — a navy retired as a token months ago that survived only here, hard-coded. Five hero
  surfaces improved from that one change.

White carries the rest. It is the dominant surface on every public page, and the auth split is now
a white column against a dark one rather than grey against near-black.

### Services page: the layout was fighting the data

Three columns, one card per department. Laboratory has 22 tests and ECG has one, so the row
rendered a wall of text beside a card that was 90% empty — column height decided by whichever
department happened to have the most tests, which is not a decision anyone made.

Each department is a full-width section now and its tests flow in a responsive grid inside it. A
one-test department is one tidy row; a twenty-two-test one is a block. Added a search box, because
the list is 32 items and somebody arriving here wants one specific test and its price, and a
closing call to action, because the page answered "what does it cost" and never "so what now".

### Sign-in: a full-bleed split

It was `max-w-6xl` + `items-center`, so both columns floated in a band of empty canvas. Each half
owns its full height now. Two real bugs fell out of looking at it:

- **No branding at all below `lg`.** The reassurance panel is `hidden lg:block`, so on every phone
  the sign-in page showed nothing but a bare form — on the one screen a patient reaches before
  they have any context about who they are handing their details to.
- **A 2px horizontal scroll at 390px.** Google's button takes a pixel width only and was
  hard-coded to 360; with the page's own `px-4` that needs 392. It is measured from its slot now,
  so it matches the Sign In button at every width and cannot go stale when the column changes.

### The text-size control was wrong on a public page

It shipped as a visible segmented control — an icon and three `A`s in a bordered box — which is a
utility toggle sitting at full strength in a marketing header, competing with the navigation and
the primary call to action. It is a single icon button with a popover now: same three choices, one
click to reach them, none of the weight when nobody is looking for it. Each row in the menu is
drawn at the size it selects, so the choice previews itself.

## [1.40.0] - 2026-08-23 (Screens arrive rather than appear)

No schema change. Frontend only.

A screen fades up as it arrives, in both shells — `SidebarLayout` for staff and `DashboardLayout`
for the portal.

The whole question with this is what triggers it, because four of these consoles poll every few
seconds and a transition hung off a re-render would strobe the entire page at the poll interval.
It is keyed on the active screen instead: a CSS animation replays on mount, and that subtree mounts
on navigation and only on navigation. `SidebarLayout` already had `<ErrorBoundary key={activeNav}>`
for an unrelated reason, so the hook was there.

Measured both ways rather than assumed — parked on the polling Active Queue for 22 seconds: 0
replays. Navigating: exactly 1. Same result on the portal.

## [1.39.0] - 2026-08-23 (A button that says it is working, and a spinner that actually spins)

No schema change. Frontend only.

### The reduced-motion rule was freezing every loading spinner

`prefers-reduced-motion: reduce` applied `animation-duration: 0.01ms` and
`animation-iteration-count: 1` to `*`. On a spinner that is not a slowdown — it completes one
rotation instantly and then **stops, permanently**. Measured with the preference on, `animate-spin`
computed to `1e-05s` / `1 iteration`.

So for anyone who had asked their OS for less motion, every loading indicator in the app — the boot
screen, the patient portal, the services page, the admin panels, avatar upload — was a static ring.
Which is the single worst thing a loading indicator can be, because a frozen spinner does not read
as "loading", it reads as "hung".

`.animate-spin` is now exempted and runs at half speed instead. The exemption is deliberately
narrow and was verified as such: with `reduce` on, the spinner computes to `2s / infinite` while the
decorative `pulse-glow` is still correctly killed at `1e-05s / 1`. A progress indicator is not what
the preference is asking about — the concern is vestibular, which means large-area movement,
parallax and zoom, not a 16px ring.

### `<Button loading>`

43 buttons were each hand-rolling `{submitting ? 'Saving...' : 'Save'}`. Three problems with that:

- **The copy had drifted.** `'Saving...'` in eight places and `'Saving…'` in four — the same word
  with two different ellipsis characters, rendering side by side on different screens. Plus a
  `ConfirmDialog` that said "Please wait..." on every destructive action in the app.
- **A static string gives no sign of life**, so a slow request and a hung one look identical.
- **The label grew mid-click**, reflowing the row and moving whatever sat beside it out from under
  the cursor at the exact moment somebody was clicking.

`loading` now supplies a spinner, the disable and `aria-busy`, and **the label stays put**. It
matters most on `ConfirmDialog`, used by nine screens: that dialog confirms a refund, a
cancellation or a released report, and replacing its label with "Please wait..." threw away the one
thing the person needed to still be able to read — which of those they had just agreed to.

Converted the eight `<Button>` submit sites (sign in, register, forgot/reset password, reschedule,
patient correction, patient search, staff account creation) and normalised the remaining
hand-rolled labels onto one ellipsis character.

### Success that was indistinguishable from cancelling

A dialog that closes on success looks exactly like a dialog that was dismissed. Two did precisely
that, and both had just written something real:

- **Reschedule** now names the slot back — the only confirmation the patient gets that it took the
  time they picked rather than the one the dialog opened on.
- **Patient correction** now names the patient. It is opened from a list of forty; a bare "Saved"
  confirms nothing worth confirming.

The three HMO decisions on Service Requests also toast now. The panel did re-render with the new
status, but this is a three-step handoff — reception raises the claim, an Admin decides it, the
cashier bills on the outcome — and the person deciding needs to know the decision was *recorded*,
not merely displayed.

Left alone deliberately: `BookingDialog` already shows a confirmation screen carrying the reference
code, `WalkInRegistration` already prints the queue ticket number, and marking a notification read
should stay silent. Adding a toast to any of those is noise on top of better feedback.

## [1.38.0] - 2026-08-23 (The reader decides how big the text is)

No schema change. Frontend only.

### What was added

A three-position text size control — Normal / Large / Larger — in the staff console header, the
patient portal header and the public header, including the phone drawer. The choice is written to
`localStorage` and applied to `<html>` as a root font size before React mounts, so it survives a
reload and does not flash the default size first.

It is offered before sign-in as well as after, because the screens a patient reaches first — the
sign-in form and the booking pages — are the ones where they have no account to carry a preference
on. Percentages of the browser's own root size, not fixed pixels, so somebody who has already
raised their default in the OS keeps that as their baseline and this multiplies it instead of
quietly overriding it.

### The part that was actually load-bearing: 85 pixel-pinned font sizes

Scaling the root only works because every size in the app is a `rem`. Eighty-five of them were
not — `text-[13px]` in 46 places, `text-[15px]` in 17, and the rest — and those do not merely fail
to grow. They **invert the hierarchy**, because 13px sits between `text-fine` (12px) and
`text-sm` (14px):

        token           at 100%      at 125%
        text-fine        12px         15px      <- overtakes
        text-[13px]      13px         13px      <- pinned, now the SMALLEST
        text-sm          14px       17.5px

Three tokens were added to cover the sizes that had none (`--text-nano` 9px, `--text-note` 13px,
`--text-lead` 15px), the other pinned values already had exact token equivalents, and all 85 sites
were swapped. Every swap is the same computed pixel size at the default root, so nothing about the
app's current appearance changed — the diff is identity at 100% and only means something above it.

Nine fixed-width containers that box scaling text were converted the same way (`w-[248px]` ->
`w-[15.5rem]` for the sidebar rail, the date fields, the notification tray, the truncation caps).
The sidebar was the visible one: at Larger its labels had truncated to "Walk-In Registr…" and
"Appointment C…" because the rail was pinned while its own labels grew. Icon and divider sizes
(`w-[3px]`, `w-[13px]`) stay in px deliberately — they are decoration, and growing them with the
reading size makes the chrome heavier without making anything easier to read.

### Why this has a spec

`text-scale.spec.js`. The setting itself is easy to eyeball; the invariant is not. The 86th
pixel-pinned size will look perfect in every screenshot taken at the default size and only misbehave
for the users who changed it — which is to say, only for the people the feature exists for. The
spec asserts `fine < note < sm` at all three scales, and it was verified by injecting both failures
(a `text-[13px]` on a live element, and a px-valued token) and confirming it goes red on each.

## [1.37.0] - 2026-08-23 (Both halves of the gateway, or neither)

No schema change.

### Half-configured meant charging a patient and recording nothing

`isConfigured()` tested `PAYMONGO_SECRET_KEY` alone, while `verifyWebhookSignature` verifies
against `PAYMONGO_WEBHOOK_SECRET` — a different value, from a different screen in PayMongo's
dashboard, displayed once when a human creates the webhook.

With the key set and the webhook secret blank: the UI offered GCash, the patient really was
charged, every delivery was rejected 401 through PayMongo's entire retry schedule, the payment
stayed `Pending`, the visit was never released, and nobody was notified. Money taken, nothing
recorded, and no error surfaced anywhere. Having one secret and not the other is the ordinary way
to get this wrong, not an exotic one — they are obtained at different moments.

`isConfigured()` now requires both, so the half-configured state simply leaves online payment off
and the clinic keeps taking counter payments, which is a supported and documented configuration.
`startupAdvisory` names the missing half at boot; it is not a startup failure, because refusing to
boot over a payment option would take the whole clinic down to report something the front desk
works around all day.

### A card that said two things at once

`BookingPass` rendered "Payment due at the counter" gated on `is_paid` alone, so with the gateway
on it appeared on the same card as the Pay with GCash buttons. Now gated on there being no online
option.

### Activation is configuration, verified

Audited end to end: no feature flag, no hardcoded `false`, no commented-out route, and the raw-body
handling the HMAC needs is already mounted app-wide ahead of the routes. Every activation step is
`.env`, infrastructure, or an action inside PayMongo's dashboard — the ordered list is now in
CLAUDE.md. The only step no code can take is creating the webhook itself.

---

## [1.36.0] - 2026-08-22 (The clinic's clock is 12-hour)

No schema change. Display only — every stored time stays 24-hour.

`scheduled_time` is a Postgres TIME, the availability grid emits zero-padded `"HH:MM"`, and the
reschedule endpoint validates that shape, so formatting happens on the way into a sentence and
never on the way into a query or a response field. `formatTime12` in `frontend/src/lib/date.js`,
mirrored by `backend/src/constants/clockFormat.js`.

Written out rather than routed through `toLocaleTimeString` for two reasons: the stored value is a
bare `"HH:MM"` with no date and `new Date("09:30")` is Invalid Date, so a Date would have to be
fabricated around it — which is where UTC-vs-local errors get in; and `hour: 'numeric'` renders
24-hour on an en-GB browser, so the clinic's clock would have depended on a machine's regional
settings. Midnight and noon are the cases a hand-rolled version gets wrong (`h % 12` renders both
as `0`); both are covered.

### The backend was quoting a different time from the screen

`appointmentEmailService`'s `readableTime` was `.slice(0, 5)`, so the confirmation email said
`09:30` while the appointment card said `9:30 AM` — one appointment, two times. Four notification
and audit strings had the same split. All now share the formatter.

### Five locale sites were not 12-hour at all

`Receipt.jsx`, `ResultsTab.jsx`, `AdminDashboard.jsx` and `formatDateTime` used
`hour: '2-digit'`/`'numeric'` with an undefined locale, which is 12-hour on en-US and **24-hour on
en-GB**. Pinned with `hour12: true`.

### Tests decoupled from presentation

`reschedule-ui.spec.js` clicked a slot button by its rendered label and `hmo-card-review.spec.js`
matched an anchored `/^\d{2}:\d{2}$/`. Slot buttons now carry `data-testid={`slot-${time}`}` with
the 24-hour value and the tests select on that — the same rule CLAUDE.md states for class names,
applied to text. Also fixed `CheckInPanel`, the one site that had been rendering `09:00:00`.

---

## [1.35.0] - 2026-08-22 (A booking holds its slot; it does not take it)

Run `node src/scripts/migrateSlotHold.js` (`--rollback` reverses it).

### What was broken

`POST /appointments` writes the appointment before payment is ever discussed, and capacity was
`status <> 'Cancelled'` and nothing else — no capacity query joined `payments`. A slot was taken
the instant a booking existed, paid or not, and exactly one thing could give it back: a human
cancelling it.

So a patient who opened GCash and closed the tab held 11:30 **forever**. Nothing released it:
there is no cron or scheduler in this project, none of the three retention passes touches
`appointments`, `cancelPendingGatewayPayments` updates the `payments` table alone, and the webhook
understands only `checkout_session.payment.paid` — a failed or expired session is answered with
`{ handled: false }` and 200. `cleanE2eData.js`'s own header already recorded the consequence:
every bookable day filled within three days of test runs.

### One nullable column, and NULL means permanent

`appointments.held_until`. Nothing is back-filled, so every existing booking keeps meaning exactly
what it meant. Only a **client's own self-pay booking awaiting online payment** is provisional; the
three exclusions are each a case where the booking is already real — a staff booking (the patient
is at the desk), an HMO booking (settled at the clinic by design, so it must never be conditional
on an online payment that will never happen), and a clinic with no gateway configured (the
instruction is "pay at the counter", and a slot expiring while the patient travels in would be
worse than the bug being fixed).

**Note the consequence of that last one: with no `PAYMONGO_SECRET_KEY` the hold never engages and
every booking is permanent, exactly as before.** It becomes live when a real key is configured.

### Expiry is evaluated at READ time, not swept

There is no reaper job and adding one would be worse: a sweeper reopens the slot at the next sweep
rather than when the hold ends, which is the same bug with a shorter fuse. `held_until >
CURRENT_TIMESTAMP` sits in the capacity predicate, so the slot returns at the exact instant the
hold lapses, with nothing scheduled that can fail. The abandoned row is left as the record of an
attempt rather than deleted.

The predicate lives in `src/constants/slotHold.js` because **three** queries answer "is this slot
taken" — the availability grid, the booking-time check and the reschedule-time check. They agreed
before only by spelling the same string three times, and a term added to two of them is how a
patient is shown a free slot and then refused it.

### Paying after the hold lapsed

`confirmHold` is unconditional on the hold still being alive. If the patient took longer than the
window and the slot was resold, the money has still moved — refusing to honour the booking does not
give it back, the same reasoning `forceSettleGatewayPayment` is built on. The appointment stands
and staff are notified that the slot is overbooked.

Hold window: 15 minutes, refreshed each time checkout is reopened, so a patient who is actually
paying never loses their slot to the clock — only one who has stopped.

---

## [1.34.0] - 2026-08-22 (A calendar the app actually owns)

No schema change.

### Why the native picker had to be replaced rather than styled

The calendar behind `<input type="date">` is drawn by the browser outside the document, so no CSS
reaches it. Replacing it is the only way to change it.

What was NOT replaced is the important half: the `<input type="date">` stays. The value remains a
bare ISO `YYYY-MM-DD`, so every caller, form and test that reads or fills it is unchanged; `min`
and `max` keep being enforced natively as a backstop; `required` keeps participating in form
validation; and on a phone tapping the field still opens the OS picker, which beats a 280px grid
at 390px. All 17 date inputs migrated — 4 birthdates (month/year dropdowns, and `max=today`, which
none of them carried, on a field that re-interprets released results), 1 booking picker, 12 range
filters (which got Today / Last 7 / Last 30 presets, usually the actual question).

### Firefox: the glyph cannot be hidden, so we stay out of the way

Measured in Firefox 153, not assumed: `::-moz-calendar-picker-indicator` and
`::-moz-calendar-button` are both **discarded by the parser** as unrecognised selectors, and
`appearance: textfield` leaves the glyph untouched. Mozilla bugs 1830890 and 1812397 are open.
Covering it was tried and rejected too — Firefox draws its glyph inline after the date text
(~x=380 in a 150px field), not flush right where our trigger sits (x=405).

So: where the glyph can be removed we own the picker completely; where it cannot, `DateField`
renders nothing custom and the field behaves exactly as the browser intends. One icon either way.
Feature-detected via `CSS.supports('selector(::-webkit-calendar-picker-indicator)')`, never
sniffed — Playwright's Firefox reports an *AppleWebKit* user-agent, so a UA test answers this
question wrongly on the very browser it is about.

### Escape closes the innermost thing

Radix registers its Escape handler on the document in the CAPTURE phase when a dialog mounts —
before any popover inside it exists — so a later listener can never run first, whatever phase it
uses. One press therefore closed the whole booking dialog while a calendar was open on top of it.
Radix skips its own dismiss when the callback defaultPrevents, so `DialogContent` now defers while
`[data-datefield-open]` is present. Covered in `mobile-patient.spec.js`.

### Clicking the field opens the calendar

`onClick`, deliberately not `onMouseDown` + `preventDefault`: preventing the default is what would
stop the caret being placed and the segment selected, which is the typing this is meant to leave
alone. Gated to `pointer: fine`, so a phone keeps its OS picker rather than stacking two.

**Accessibility cost, stated rather than hidden:** ARIA in HTML permits no `role` and no
`aria-expanded` on `input type=date`, and the APG combobox pattern that carries them requires
`type="text"` — which this design rejects for the four reasons above. A screen-reader user
clicking the field would otherwise get a dialog opening silently. A polite live region announces
it. That is mitigation, not a cure; icon-only opening is the stricter alternative, and is what
Firefox itself concluded in bug 1804879.

### Fixed on the way through

- `AddProfileDialog` and `EditProfileDialog` both rendered `id="clientdashboard-birthdate"` — two
  dialogs, one DOM id, making `htmlFor` ambiguous.
- Two Per-Staff Workload inputs on Reports had no accessible name at all: no label, no
  `aria-label`, no id.
- `ticket-release-gating.spec.js` probed "tomorrow" with `toISOString()`, the UTC bug this project
  documents. Before 08:00 Manila that returns today; after, tomorrow. Run on a Saturday it probed
  Sunday, the one closed day, and three release-gating tests skipped — silently, reported only as
  "3 skipped". It now probes forward for a day the clinic is actually open.

---

## [1.33.0] - 2026-08-22 (Only the methods the clinic can settle)

Run `node src/scripts/migratePaymentMethods.js` (`--rollback` restores the previous vocabulary).

### PayMaya is gone

The clinic owner holds no PayMaya merchant account, so offering it was offering a way to pay
that nobody could collect. Removed from the counter buttons, the online gateway, the e-wallet
bucket and `chk_payment_method`.

### The migration refuses rather than converts

A CHECK constraint cannot be narrowed while a row violates it, and there are exactly two ways
past that — one of them is rewriting a receipt to claim it was paid by a method the patient did
not use. Which method a real receipt should say is not a question a script can answer, so it
names the offending rows and stops. Same stance `migrateClaimIntegrity.js` takes on two live
claims for one test.

**`NOT VALID` is the wrong tool here**, and specifically dangerous. It skips the initial scan but
Postgres still enforces the constraint on every later UPDATE:

- A `'Pending'` gateway row for a PayMaya checkout started before the change. PayMongo delivers
  `checkout_session.payment.paid`, `markGatewayPaymentPaid` UPDATEs, the CHECK re-evaluates
  against the new row version and raises `23514`. Only `23505` is caught, so the webhook 500s,
  PayMongo redelivers, and it fails identically forever — the patient charged, no receipt. Worse,
  `getNextReceiptNumber()` runs *before* that UPDATE and the counter never rewinds, so every
  redelivery burns a receipt number: a widening gap in the official sequence, which is the exact
  thing `daily_counters` exists to prevent.
- A historical `'Paid'` PayMaya receipt a cashier later needs to reverse. `updatePaymentStatus`
  is an UPDATE; same violation, and the refund becomes impossible.

So: no violating row, or no migration. Verified by running it against the seeded data first — it
refused, named all nine receipts, and changed nothing.

### One vocabulary, not six

`backend/src/constants/paymentMethods.js` is now the single definition, and the CHECK constraint
is built from it. It previously lived in six places that had no way of knowing about each other:
an inline SQL literal in the summary's e-wallet bucket, a hard-coded JSX array in the cashier
terminal, a caption string, the gateway map, `schema.sql`, and two seeder rotations.

Restoring PayMaya later is one line in that constant, one in `frontend/src/lib/paymentMethods.js`,
and `migratePaymentMethods.js --rollback`. The module asserts at load that every method lands in
exactly one cash-up tile and that every gateway key is a valid method — the first because the
Cash/E-Wallet/Bank tiles are asserted to sum to the collected total, the second because a gateway
key is written straight into `payments.payment_method` and would otherwise violate the constraint
at settlement, after the patient had been charged.

### A Method filter on Cashier Monitoring

Applied in SQL, filtering the list **and** the summary. Filtering in the browser would have been
one line and wrong: the per-cashier cards reduce the row list, and they sit in the same grid as
`summary.collected`, which is aggregated over the whole range — so a client-side filter moves one
and not the other. `lib/collections.js` records that mismatch shipping on this screen once
already. An unrecognised method is rejected with 400 rather than ignored: on a money screen,
silently returning everything reads as "the clinic took nothing that way".

### A booking can no longer be made in the past

`SlotPicker` has carried `min={todayStr()}` all along, but that is a browser hint — it does not
survive a typed value everywhere, and it does not exist for anything talking to the API. Nothing
on the server compared the date to today, so `POST /appointments` would create a real visit and a
real appointment for last week, occupying a slot on a day that has already happened. Guarded now
on all three paths that matter: create, reschedule (the only other writer of `scheduled_date`),
and availability — which answers "closed" for a past day so the screen never offers a slot the
API would refuse.

Inclusive of today: the elapsed part of today is already handled in `getAvailableSlots`, and
refusing today outright would refuse a walk-in booked for this afternoon.

---

## [1.32.0] - 2026-08-22 (The other half of the cash book)

No schema change. `migrateRefundTimestamp.js` gained a better backfill and is safe to re-run —
it corrects a fabricated date in place — but nothing new is added to any table.

### The fix landed in one of two repositories

[1.30.0] moved `paymentRepository` to a period cash book and left `reportRepository` on
`payment_status = 'Paid'` over a `paid_at` range. Two consequences, and the second is worse than
the first:

1. **They disagreed about the same day.** One 550.00 receipt paid and reversed today: the
   cashier's strip read 550.00 collected, the operations report's "Takings" panel read 0.00.
2. **The regression [1.30.0] is named for survived in the half that gets PRINTED.** `getBillingTotals`
   still bucketed everything by `paid_at`, so reversing an older receipt still silently reduced a
   day that had already been printed and filed.

`getRevenueTrend`, `getPaymentMethodBreakdown` and `getSalesByService` restated closed days the
same way. All four now read their predicates from `src/constants/moneyRange.js`, which
`paymentRepository` also uses — one definition, because two drifted apart within a single commit
of each other.

`getSalesByService` had to move in the same change as `getBillingTotals`: `operations-report.spec.js`
asserts the sum of that breakdown reconciles to the collected figure, and two bases break it the
moment anything is reversed.

### Two coupled defects in `getBillingTotals`

- No `receipt_number IS NOT NULL`.
- `refunds`/`refunded` counted `'Refunded'` only, so a receipt a staff member VOIDED — status
  `'Cancelled'`, a real reversal — was reported by the cashier's summary and by nothing at all
  here. Its amount also fell out of `collected`, under-reporting both sides at once, and the panel
  hides the stat when it is zero: a day of nothing but voids showed no reversal at all.

They cancelled, which is why neither was visible. Fixing either alone makes abandoned gateway
checkouts — money never taken — report as refunds. One change, not two.

### Backfilled from the audit trail

[1.30.0] set `refunded_at = paid_at` for existing reversals, recorded at the time as a real gap
because `payments` has no `updated_at`. But `audit_log` carries a `payment.refunded` /
`payment.cancelled` entry for every reversal, and its `created_at` is the real moment — reading it
states nothing new, it moves a fact from the table that recorded it to the table that needs it.
Retention is ~7 years for non-PHI actions (`pruneAuditLog.js`), longer than any cash-up looks back.

Two passes now: the audit trail first, then `paid_at` for whatever it cannot account for, with the
counts reported separately so the difference is never invisible. The pass also **corrects** a row
already carrying the fabricated date (`refunded_at = paid_at` exactly — never true of a real
reversal), which closes the round-trip weakness noted in [1.30.0]: rolling back and reapplying used
to overwrite a true reversal date permanently.

### A resurrected receipt counted as money returned, forever

`forceSettleGatewayPayment` flips a `'Cancelled'` row back to `'Paid'` when the patient completed a
checkout we had written off. It did not clear `refunded_at`, and the `reversed` figure keys on
`refunded_at IS NOT NULL` *without* testing `payment_status` — so the receipt was reported as
handed back on a day it was actually taken, for as long as the row existed.

### The cross-day case finally has a test

Every test in `cashup-reversals.spec.js` settled and reversed inside one test body, so both dates
landed on the same day — the case that was never broken. Reaching the broken one needs a receipt
older than today, which no API can produce. `backend/src/scripts/e2eBackdatePayment.js` ages one,
refusing anything that is not an E2E-created receipt and refusing to run under
`NODE_ENV=production` at all. Verified the new test fails against the pre-[1.30.0] semantics before
trusting it.

### Getting the correction onto a database that already ran [1.30.0]

There is no automatic path, and that was checked rather than assumed: this project has no
migration ledger table, no npm lifecycle hooks, no nodemon config, no active git hooks, and
`server.js` opens a port and nothing else. Running the backfill at boot was the obvious idea and
is the wrong one — `audit_log` has no index on `action`, the backfill aggregates over every
'payment'-typed row in a table documented as reaching ~300,000 rows a year, the migration scripts
use `db.pool.connect()` under a stated assumption that they run alone, and `statement_timeout` is
15s. This file already records what happened the one time schema work hid inside a script that ran
for another reason.

So the cheap half of the question is asked at boot and the expensive half is not.
`src/config/startupAdvisory.js` counts rows where `refunded_at = paid_at` to the microsecond — the
signature of the old backfill, never true of a real reversal — and logs the command to fix them.
It touches only `payments`, uses the partial index so it scans reversals alone, never throws, and
says nothing when there is nothing to say.

The instruction in CLAUDE.md also moved. It sat inside the migration block, under a header scoping
that block to "any database created before [1.29.0]" — so the databases this applies to, which are
by definition newer, would correctly skip past it. It is now stated above that gate.

### Screens

`counted_in_collected` is now returned per row, because which rows make up `collected` depends on
the range and only the query knows it: the list matches on **either** date, so it holds receipts
taken earlier and only reversed inside the range. `lib/collections.js` reads that flag — its
`payment_status === 'Paid'` test was wrong in both directions and made two breakdowns sum to
`collected - reversed` while a card in the same grid showed `collected`.

Two captions asserted the opposite of what the code now does and were corrected: "Receipts
Settled … N more issued, then reversed" (they are counted, and on a same-day reversal they are not
"more"), and Cashier Monitoring's "not in collections". A **Net in Drawer** figure was added to the
collections strip and the shift panel, shown only when something was reversed: `reversed` is
reported beside `collected` and never subtracted from it, which left the cashier doing that
subtraction in their head against the cash in front of them.

---

## [1.31.0] - 2026-08-21 (One live claim per test; a dead column removed)

Run `node src/scripts/migrateClaimIntegrity.js` on any database created before this version
(`--rollback` reverses it).

### One live claim per test

`uq_hmo_request_visit_test (hmo_request_id, visit_test_id)` stopped a test being listed twice
inside **one** claim. Nothing stopped the same test being claimed by two **different** requests,
and `hmoService.createRequest` does not check either — two Pending claims, or a Pending beside an
Approved, were reachable through the ordinary UI.

That is not cosmetic. `paymentRepository.getBillingSummary` reads coverage with a correlated
subquery *specifically* to survive it: a plain LEFT JOIN would duplicate the line item and inflate
the bill subtotal. The schema permitted a state the biller had to defend against at read time.

The new index is deliberately **partial**, not absolute:

```sql
CREATE UNIQUE INDEX uq_hmo_one_live_claim_per_test
    ON hmo_request_tests (visit_test_id)
 WHERE approval_status <> 'Rejected';
```

"One claim per test, ever" would have been wrong. If a provider refuses, re-claiming the same test
with a second provider is legitimate and is what a patient carrying two cards expects. Rejected
rows stay free to accumulate because each carries a reason and a decider [1.27.0] — the answer to
"why am I being charged for this".

Verified in both directions before shipping: a second live claim while the first is Pending is
refused by the new index; a fresh claim once the first is Rejected is accepted.

The correlated subquery stays. A refused claim and its retry can coexist, so "exactly one row per
test" is still not something a JOIN may assume.

The migration refuses to run if any test already carries two live claims, naming them, rather than
picking one — which of two claims is real is a question for the HMO coordinator, and choosing here
would quietly decide who pays.

### Removed: `test_results.file_url`

Superseded by `file_path` when result files stopped being served statically and started streaming
through an authenticated, ownership-checked route. Carried since as a "nullable legacy fallback",
populated in **0 of 42 rows**, while still being selected in four queries, branched on in
`resultService`, and accepted as a field on the release endpoint — dead weight that read as a live
alternative to whoever met it next. The whole thread is gone: controller, service, repository.

The rollback restores the column but not its contents, which is honest rather than lossy: there
were none.

---

## [1.30.0] - 2026-08-21 (A reversal has its own date)

Run `node src/scripts/migrateRefundTimestamp.js` on any database created before this version
(`--rollback` reverses it).

### The problem

`payments` carried `refund_reason` but no timestamp, so a reversal had no date of its own and the
cash-up could only bucket it by `paid_at` — the day the money came **in**. Reversing a receipt
from an earlier day therefore did two wrong things at once. Measured against the seeded data
before the fix, reversing a ₱550.00 receipt paid on the 19th, on the 20th:

| | before | after |
|---|---|---|
| 19th `collected` | 4,830.00 → **4,280.00** | 4,830.00, unchanged |
| 20th `reversed` | **0.00** | 550.00 |

The first row is the worse of the two. Restating a closed day means yesterday's figure changes
after yesterday ended, so the cash-up sheet in the drawer and the screen disagree and neither is
wrong — there is no date on which the clinic can say what it took.

### The model

A period cash book, which is what a daily drawer is:

* `collected` — money taken **in** during the range, bucketed by `paid_at`, counted whatever
  happens to the receipt later.
* `reversed` — money handed **back** during the range, bucketed by `refunded_at`.
* the drawer — `collected - reversed`. Reported as two figures, never one: netting hides that a
  reversal happened, and a drawer short by a refund needs the refund named.

A receipt paid and refunded on the same day reads as 550 in and 550 out rather than as nothing
having happened, which is what the drawer actually did.

### Added
* `payments.refunded_at TIMESTAMP` — set on the way **into** `'Refunded'`/`'Cancelled'` and only
  once, so a status change cannot move a reversal to a later date.
* `idx_payments_refunded_at` — partial, `WHERE refunded_at IS NOT NULL`. Almost no payment is ever
  reversed, so the rest have no business in this index.

### Changed
* `findTransactionSummary` buckets collections and reversals on different columns (above).
* `findTransactions` matches the range on **either** date, so a receipt paid on the 19th and
  reversed on the 20th appears in both days' logs — as an issued receipt in one and as the
  reversal the cashier processed in the other. Without this the summary reported a `reversed`
  figure with no row behind it.

### Backfill
Existing reversed rows get `refunded_at = paid_at`. That is a guess and deliberately the
conservative one: it reproduces exactly what those rows did before, so no historical figure moves
when the migration runs. `payments` has no `updated_at` to do better with.

---

## [1.29.0] - 2026-08-18 (Index what grows; stop maintaining what nothing reads)

Run `node src/scripts/migrateIndexHygiene.js` on any database created before this version
(`--rollback` reverses it).

### Measured, not guessed
Against a same-shaped `audit_log` of 300,000 rows in a throwaway schema — roughly a year for this
clinic, since [1.19.0] made `audit_log` record PHI **reads** as well as writes:

| query | before | after |
|---|---|---|
| activity log, newest page | 87.3 ms (2 seq scans) | **0.9 ms** (0) |
| everything one member of staff touched | 58.0 ms (1 seq scan) | **5.8 ms** (0) |

The second is the query a breach investigation runs, and it is the reason the audit log exists.
At demo scale both are under a millisecond either way — which is precisely why this was measured
at volume rather than on the seeded data.

### Added
* Indexes on 11 foreign keys, all on tables that grow with clinic activity: `audit_log.actor_id`, `payments.processed_by`, `patient_visits.created_by` / `.discount_type_id` / `.discount_granted_by`, `patients.patient_type_id`, `test_results.critical_acknowledged_by` / `.superseded_by`, `hmo_requests.hmo_provider_id` / `.decided_by`, `hmo_request_tests.decided_by`.

### Removed
* `idx_audit_log_created_at` — duplicates `idx_audit_log_created`. A B-tree is scannable in both directions, so the ASC index already serves `ORDER BY created_at DESC`; confirmed by building the case in a scratch schema and reading the plan.
* `idx_payments_status` — duplicates `idx_payments_status_paid_at`, whose leading column is `payment_status`; confirmed the same way.

Both sat on growing tables, so each was charging a write on every audit entry and every payment to
serve reads another index already covered.

### Changed — two list endpoints now page at the database
* `GET /visits/history` and `GET /payments/transactions` accept `page` and `limit` and return `total` / `totalPages`. Both returned **every row in the range**; Visit History then rendered all of them with no footer at all, and Transaction History sliced fifteen out in JavaScript. Measured at 664 bytes a visit and 570 a payment, a year-wide range is a **3.6 MB** and a **2.0 MB** response respectively — to fill a fifteen-row table, on screens that poll. Page one now stays ~16 KB and ~8 KB whatever the range.
* `limit` is optional on both, so the callers that legitimately need the whole set — today's collections total, the cashier's metric strip, the sales-by-service report — are unchanged.
* `GET /appointments` and `GET /hmo/requests` page the same way — smaller (664 KB and 648 KB projected at a year) but the same shape: fetch everything, show fifteen.
* **`/auth/me` was checked and deliberately left alone.** It is polled every 60s per signed-in user — 1.8M calls a year — but it already answers a matching `If-None-Match` with a 0-byte 304, so the bandwidth is nil after the first call. The remaining cost is ~2.9 ms of database time per call, about 87 minutes a year, and removing it would mean caching permissions server-side against the documented guarantee that a permission change reaches a signed-in user within a minute. Not a trade worth making.

### Fixed
* `visitService.getVisitHistoryByDateRange` defaulted its dates with `new Date().toISOString().slice(0, 10)` — the **UTC** date, which in Philippine time is *yesterday* between midnight and 08:00. Opening Visit History early in the morning showed the previous day's visits and called them today's. The default is now `COALESCE($1::date, CURRENT_DATE)` in SQL, which is the server's local date and what every other date filter here compares against. CLAUDE.md records this bug shipping twice before; this was the third place.

### Deliberately NOT indexed
`user_roles.assigned_by`, `role_permissions.permission_id`, `user_permissions.*`,
`user_departments.*`. These are bounded by the number of staff and the number of permissions — a
couple of hundred rows that never grow with patient volume — and on a table that fits in a page or
two a sequential scan beats an index lookup. Indexing them would buy nothing and be paid for on
every write, which is the same mistake as the two indexes removed above.

---

## [1.28.0] - 2026-08-18 (The claim gets decided, and somebody is told)

Run `node src/scripts/migrateHmoClaimDecision.js` on any database created before this version
(`--rollback` reverses it, destroying the reasons and member numbers — it warns and counts first).

### Added
* `hmo_requests.decision_reason` (TEXT), `.decided_by` (FK → `users`) — why a claim was turned down and who recorded it. No `decided_at`: `approved_date` already holds that fact, and two timestamps that must agree eventually will not.
* `hmo_requests.member_number` (VARCHAR 100) — the patient's number with the provider. It had **nowhere to live**: the API accepted `memberNumber` and silently discarded it, so the number was legible only by opening the card photo — and `pruneHmoCards.js` deletes those after 180 days by design, while the claim itself is kept for seven years.
* `idx_hmo_requests_pending`, partial (`WHERE status = 'Pending'`) — the set the approval worklist opens on.
* `PUT /api/hmo/request/:id/reject` — same permission as approving. Saying no is the same authority as saying yes, and splitting them would let an account do one but not the other.

### Changed
* **A claim can now be turned down.** `chk_hmo_status` has allowed `'Rejected'` since [1.0.0] and no route could set it, so a claim the provider refused had two outcomes in practice: approve it anyway, or leave it Pending forever — at the top of a worklist that filters on Pending, being reopened by every coordinator who scanned it. A refusal requires a reason.
* **Deciding a claim notifies the Cashier and Receptionist.** This was the missing step in the clinic's own workflow: reception raises, an Admin decides, the cashier bills what is left — and nothing connected the second to the third. Admins are not notified; they are the ones who just decided it. The message names the patient, not the claim id, because "Maria Santos — MediCard approved" is actionable at a counter and "HMO request #482" is a lookup.
* **A claim is decided once** (409 otherwise). Approving an already-rejected claim silently overwrote the refusal and its reason — the only record of why the patient was charged.
* **The approval worklist names the patient.** It carried provider, date and a count, so several claims from one provider on one day were identical rows and the only way to learn whose insurance you were approving was to open each in turn. It now also counts refusals, not just approvals: `1 / 2` could not distinguish a half-decided claim from one whose other half was refused.
* **Reception collects the member number and the LOA code as separate fields.** One box labelled "Card / LOA Number" wrote both into `approval_code` — the column an Admin fills on approval — so a member number was filed as an approval code against a claim nobody had approved.

---

## [1.27.0] - 2026-08-18 (Why the HMO said no)

Run `node src/scripts/migrateHmoDecisionTrail.js` on any database created before this version
(`--rollback` reverses it, destroying the reasons — it warns and counts first).

### Added
* `hmo_request_tests.decision_reason` (TEXT), `.decided_by` (FK → `users`), `.decided_at` — all nullable, nothing back-filled. A decision taken before today has no honest answer, and manufacturing one would put a false statement in the audit trail.
* `idx_hmo_request_tests_pending`, partial (`WHERE approval_status = 'Pending'`) — the only set anything queries in bulk. Decided rows are the overwhelming majority and are read one claim at a time, by id.
* `GET /payments/bill/:visitId` now reports `hmoPendingCount` / `hmoPendingAmount`, and each line item carries `hmoRejected` / `hmoDecisionReason`.

### Changed
* **A rejection now requires a reason**; an approval stores none. The refusal is the whole point of the record — an approval explains itself, a refusal is a conversation at the counter about money the patient was not expecting to pay. Until now that explanation lived only in whatever the coordinator remembered, so a dispute three days later had no answer.
* **An unrecognised decision word is a 400 that names the alternatives, not a 500.** The value went straight to `chk_hmo_request_tests_status`, so `'Denied'` — the word the providers themselves use, and therefore the first one any caller reaches for — surfaced as an unexplained server error.
* **A decision on a test that is not on the claim is a 404.** It returned 200 with an undefined body: the caller was told the decision had been recorded when no row had been touched.
* **The cashier's bill shows the refusal reason on the line it applies to,** and warns when part of the bill is riding on an undecided claim. An undecided claim covers nothing, so those tests are charged at full price — take the payment and the approval lands tomorrow, and the clinic owes a refund. Reported rather than blocked: some providers take days, and the patient cannot wait at the counter for one.

### Why
* An HMO decision moves money between the patient and the insurer, and this was the only such action in the system that could not say who recorded it. A payment names the cashier, a released result names the authoriser, a permission change names the SuperAdmin.

---

## [1.26.0] - 2026-08-17 (What happens after the money moves and the report goes out)

No schema change — every fix here is a query, a guard or a status transition. Recorded because
each one changes what the tables end up holding.

### Changed
* **A refund now recalls the visit from the modalities.** `visitRepository.recallVisitFromModalities` returns tests still in `Processing` to `Pending` and resets the visit — but only when no work has been done. A ticket already at `Waiting for Release` or `Completed` is left alone, because the work exists and the record of it must not be erased by a billing action.
* **A refund now requires a reason** (≥4 characters), recorded against the operator's account.
* **`findVisitReleaseStateByVisitTestId` also returns `vt.status`.** Two rules below need to distinguish "the report has gone out" from "the visit happens to be closed", and only the test's own status says that.
* **The result read guard is now separate from the write guard.** `assertStaffMayReadVisitTest` checks department scope only; `assertStaffOwnsVisitTest` additionally requires the ticket to have been released. Both reads (`getResultByVisitTestId`, `getVersionHistory`) were using the write guard, so the technician who produced a report lost access to it and to its version history the instant the visit completed.
* **The write guard accepts `Completed` as well as `Processing`.** A visit completes when its last result is released, so refusing writes from that moment made amending a released result impossible — which is the one thing result versioning [1.15.0] exists for, since a correction is nearly always found after the report has gone out. The alternative in practice was editing the row by hand, which keeps no history at all.
* **An amendment reason is required once the report has been released,** and only then. Re-saving a ticket still at `Waiting for Release` is drafting; demanding a justification for fixing your own typo fills the reason box with "typo" until it means nothing. The audit entry for a released amendment could previously read "no reason given" against a corrected medical report.
* **Amending a released result reopens the visit to `Processing`.** The ticket returns to `Waiting for Release`, but the modality worklist filters on `pv.status = 'Processing'` and the Released tab filters on `vt.status = 'Completed'` — so the amended ticket appeared on neither. The correction was accepted, shown as saved, and then reached nobody: the patient and the referring physician kept the wrong report. `releaseResult` closes the visit again once the corrected version goes out.

### Added
* `GET /api/results/critical/outstanding` — every released critical result still awaiting its callback. Deliberately **not** department-scoped: a potassium of 7.4 belongs to whoever can act on it, not to the room that produced it. Until now the only sign of a panic value was a badge on one department's worklist row, so one flagged near the end of a shift had nobody watching it.

---

## [1.25.0] - 2026-08-17 (Reminding people to turn up)

### Added
* `appointments.reminder_sent_at` — when the day-before reminder went out; NULL means it has not. One column, because the only thing the sweep needs to remember is whether it has already handled a row.
* `idx_appointments_pending_reminder`, partial (`WHERE reminder_sent_at IS NULL AND status = 'Pending'`) — which is exactly the query the job runs. Most rows are historical and already handled, so indexing them would be dead weight.

### Why
* `appointments.status` has carried 'No Show' since [1.0.0], so the clinic was already counting the problem and had nothing to do about it. A no-show is a slot that earns nothing and cannot be reassigned, because by the time you know, the day is gone.
* The reminder is also where the preparation instructions from [1.24.0] actually land. "Nothing to eat or drink except water for 8 hours" is actionable the evening before; at the moment of booking, possibly three weeks earlier, it is forgotten by definition.

### The design that matters
* **Safe to re-run, which is what makes it safe to schedule.** Rows are stamped once handled and the query only selects unstamped ones, so running it hourly is harmless. A job that cannot be run twice is one nobody dares automate, so it gets run by hand — which is to say not at all.
* The stamp is written even when the patient has **no email address**. A walk-in registered at the desk has no account; that is a permanent condition, not a transient failure, and leaving it unstamped would re-examine the same unreachable rows every night forever.
* It is **not** written when the send itself errors, so a transient SMTP failure is retried on the next run.
* Only 'Pending' appointments. 'Confirmed' means the patient is already checked in, and Cancelled / Completed / No Show are finished — reminding any of them is worse than not reminding.
* "Tomorrow" is never used in the copy. The job accepts any `--days` offset, and an email sent at 23:50 and read at 00:10 means two different dates to writer and reader. It names the day.
* Dates are computed in SQL (`CURRENT_DATE + `), per the standing rule: building "tomorrow" from a JS Date gives the UTC day, which in Philippine time is wrong every morning before 08:00.

### Migration
* `node src/scripts/migrateAppointmentReminders.js` — additive, idempotent, one transaction.
* Reversible, and the rollback is **safe**: it loses only the record of which reminders were sent, so the worst consequence is a patient reminded twice.
* Schedule `sendAppointmentReminders.js --confirm` daily in the evening.

---

## [1.24.0] - 2026-08-17 (Telling the patient what to do)

### Added
* `tests.preparation` — what the patient must do beforehand: fast for eight hours, arrive with a full bladder, stop a medication. Free text, written by clinical staff in the words they already use with patients. NULL means no preparation is needed, which is true of most Laboratory tests, so nothing is back-filled and the UI renders nothing rather than an empty instruction.

### Why
* A patient booking a Fasting Blood Sugar online was told nothing, anywhere — not on the services page, not while choosing tests, not on the confirmation, and not by email, because no booking email existed. They arrive unable to be tested, the slot is wasted, and the front desk absorbs the conversation. It is the most expensive kind of defect in a clinic system because the cost lands on the patient, the schedule and the staff at once, and among the cheapest to fix: the information existed and had nowhere to live.

### Also in this release (no schema change)
* **Booking confirmation, reschedule and cancellation emails.** The system previously sent exactly two emails — password reset and result release. Booking online produced an in-app notification for *staff* and nothing for the patient, so the only record was a confirmation screen that vanished with the tab, taking the reference the front desk asks for. `appointmentEmailService` sends all three; every one carries the reference, and the confirmation carries the preparation instructions, because that is the message the patient still has on the morning of the appointment.
* All three are sent after their transaction commits and cannot fail the operation: `sendEmail` swallows SMTP errors and each call site wraps it. A clinic with no SMTP configured gets a logged skip and a working booking.
* A walk-in registered at the desk has no account and no address; that is a quiet skip, not an error.

### Migration
* `node src/scripts/migrateTestPreparation.js` — additive, idempotent, one transaction.
* Reversible with `--rollback`, which **destroys the instructions** — this column is their only home. The script counts and warns before dropping, like [1.23.0].

---

## [1.23.0] - 2026-08-17 (The doctor who requested the test)

### Added
* `patient_visits.referring_physician` / `referring_physician_prc` — the requesting doctor, and the PRC licence number that makes the name unambiguous. On the visit, not the patient: a referral belongs to one episode of care, not to the person forever.
* `idx_patient_visits_referring_physician`, partial (`WHERE referring_physician IS NOT NULL`). Most visits have none, so a full index would be mostly dead weight; this answers "which visits did Dr. X send us", which is the question the data will actually be asked.
* `appointments:reschedule` was seeded in [1.22.1]; no new permission here. Run `node src/scripts/setupRbac.js` if you are catching up.

### Why
* A diagnostic report is not addressed to the patient alone — it goes back to the doctor who ordered the test, and there was nowhere to record who that was. The report named the clinic and the clinician who produced it, and had no line for the person the findings were for.

### The rule, and what it deliberately does not cover
* **Required on an HMO claim.** The LOA is issued against the referring physician; a claim that cannot name one is difficult to reimburse, and the clinic discovers that weeks later while chasing a patient who has long since gone home. Enforced in `hmoService`, not only in the booking controller, because `POST /hmo/request` reaches the same rule and reception filing a claim against an existing walk-in is the ordinary case.
* **Required for the `Private` patient type**, which at this clinic means "referred by a private physician" as opposed to a walk-in. Such a visit naming nobody is not a gap in the record; it is a record that contradicts itself.
* **Not required for Self Pay** — and this is a decision, not an oversight. It leaves one case knowingly unenforced: a self-paying walk-in can be given an X-ray with no requesting physician on file. Diagnostic radiography is normally performed on a licensed physician's request, and that is a radiation-safety matter which does not care who is paying. If the clinic's DOH / BHDT licensing says a request is mandatory, this rule is the wrong shape — the fix is a `requires_referral` flag per `test_categories` row, because the requirement is then about the modality rather than the payer. Written down so it stays revisitable.
* A claim filed later never overwrites a physician the visit already names. That name may already be on a released report, and two documents naming different doctors for one episode is worse than either.
* A PRC number submitted without a name is discarded. On its own it identifies nobody, and storing it would read as though the name had been lost rather than never given.

### Migration
* `node src/scripts/migrateReferringPhysician.js` — additive, idempotent, one transaction.
* Reversible: `node src/scripts/migrateReferringPhysician.js --rollback` — but **the rollback destroys data**. Unlike [1.22.0], whose dropped columns leave their card images on disk, these two columns are the only place the physician is stored, so dropping them discards every name recorded since the migration ran with nothing to restore from. Verified by rolling back and re-applying on a populated database: the re-applied schema reports zero. The script now counts and warns before it drops. Take a dump first if the data matters.
* Existing visits keep `NULL`. Back-filling a doctor nobody named would invent a referral.

### Consequences for fixtures
* Specs and `seedDemoScenario.js` used `Private` as a meaningless placeholder for fixture patients — often as the literal id `2`. That type means something now, so every such fixture began failing for naming no physician. All were switched to `Self Pay`, which is what an unpaid walk-in with no doctor and no coverage actually is, and resolved **by name** through `tests/e2e/helpers/patients.js` rather than by a seed-order id.

---

## [1.22.0] - 2026-08-17 (Evidence for an HMO claim)

Originally authored as `[1.13.0]` on a branch cut before [1.13.0]–[1.21.0] landed; renumbered on
merge. `migrateHmoCard.js` is unchanged by that — it is keyed to the columns it adds, not to the
number — but two `[1.13.0]` sections describing different tables would have made this file useless
as a history.

### Added
* `hmo_requests.card_file_path` / `card_original_name` / `card_mime_type` / `card_size_bytes` / `card_uploaded_at` — the photo of the patient's HMO card, attached during online booking. Server-generated filename, stored under `backend/uploads/hmo-cards/` (covered by the existing `backend/uploads/` gitignore entry). Never served statically: an HMO card carries a name, a member number and often a photo, so it is retrieved through an authenticated, ownership-checked route like diagnostic result files.
* `hmo_requests.card_verified_by` / `card_verified_at` — the staff member who confirmed the physical card at the desk. Reception is deliberately not required to photograph a card they are holding; they are required to be named. Derived from the request's own token, so no existing caller had to change.
* `hmo_requests.card_purged_at` — set when retention removes the image. Without it a purged card is indistinguishable from one that was never provided, and Admin cannot tell a policy working correctly from a gap in the record.
* `chk_hmo_request_card_evidence` — `CHECK (card_file_path IS NOT NULL OR card_verified_by IS NOT NULL OR card_purged_at IS NOT NULL)`. Every claim carries either an image, a named verifier, or a record that its image was purged under retention. The third arm is not optional: `NOT VALID` skips only the initial scan of historical rows, so without it the retention pass would violate the constraint the moment it nulled a client-uploaded card's path. The service layer enforces the same rule, but only the constraint covers routes and scripts that do not exist yet.
* `idx_hmo_requests_card_verified_by`, for staff-attestation reporting.
* Two permission grants to the **Client** role — `hmo:request` and `hmo:read`. Run `node src/scripts/setupRbac.js`. `POST /hmo/request` and `GET /hmo/request/:id/card` are patient-reachable, so under [1.20.0] they keep an explicit `authorizeRoles` list naming Client, and `verifyRbacWiring.js` requires every named role to hold the permission the route enforces. Both are ownership-scoped in `hmoService` exactly like the Client's other grants; neither reaches the staff HMO screens, which are `authorizeStaff` and therefore closed to a patient account whatever the matrix says.

### Why
* Online booking lets a client state HMO coverage themselves. A client can select a provider by mistake as easily as deliberately, and unlike a walk-in there is nobody at a desk to notice. The card photo is the evidence that makes the claim reviewable — it is not verification, and does not pretend to be: no Philippine HMO exposes an API that would let a clinic confirm a member number, so approval remains the existing manual Admin step.

### Migration
* `node src/scripts/migrateHmoCard.js` — additive and idempotent, runs in one transaction.
* The constraint is added **NOT VALID** deliberately. Rows predating this migration have neither an image nor a verifier, and back-filling a staff id to satisfy the check would invent an attestation nobody made. New and updated rows are enforced; history stays honestly incomplete.
* Reversible: `node src/scripts/migrateHmoCard.js --rollback` drops the constraint, the index and the columns in one transaction. Image files are left on disk, so a rollback loses the links but not the evidence.

---

## [1.21.0] - 2026-08-17 (Department-scoped patient records)

No schema change — run `node src/scripts/setupRbac.js` to seed one new permission.

**`patients:read_all_departments`.** The roster search was unconditional: two characters and any
staff token could page through every patient the clinic has ever registered. The name match *was*
the access control, and a name match is not an access control. `GET /patients/:id` had the
mirror-image problem — a role allow-list that excluded diagnostic staff outright, which was safe
but meant a lab tech could read a result and had no way to look up whose it was.

Both are now settled by one rule in `patientService.departmentScopeFor`: confine to the caller's
own departments unless they hold this permission. Seeded to SuperAdmin, Admin, Receptionist and
Cashier — the front office is clinic-wide by function and neither role implies a modality, so
scoping them would leave them able to find nobody. Diagnostic roles do not hold it, and a
SuperAdmin can grant it to an individual account on the Access Control screen.

An out-of-scope record answers **404, not 403**. A 403 confirms the record exists, and "does this
clinic have a patient called X" is precisely the question the scoping refuses. `api-authorization`
had asserted the old 403 and was updated with that reasoning.

The write path uses the same check — `updatePatientProfile` calls `getPatientById` rather than
repeating the rule — because birthdate and sex are the fields diagnostic reference ranges key off,
so editing another department's patient is a clinical-safety question, not only a privacy one.

Two consequences worth knowing:

- `GET /patients/search` now returns `departmentScope` alongside the results, and the screen prints
  it. A scoped result set and an empty clinic are otherwise indistinguishable.
- Opening Patient Records to all staff made it the first *reachable* nav item, so a lab tech was
  landing on the records search instead of their worklist. `defaultNavForRoles` now prefers the
  first destination that **belongs** to a role you hold. Reachable is not the same as home.

## [1.20.0] - 2026-08-17 (Per-account permissions and department assignment)

`node src/scripts/migrateAccountScopedRbac.js` — additive, safe to re-run.

**Why.** The role-permission matrix was the only way to say who may do what, and it was not the
thing actually being enforced. Every departmental route also carried a hardcoded role list
(`authorizeRoles('SuperAdmin', 'Cashier')` on `POST /payments`, the three modality roles on every
result route), and so did every sidebar item. Ticking `billing:process` for Laboratory Staff
therefore saved, reported success, and changed nothing: the nav item stayed hidden and the route
refused, because the lab role was not in either list. Somebody had granted access, believed it,
and stopped thinking about it — the worst failure mode an access control has.

**Tables.**

- `user_permissions (user_id, permission_id, effect, granted_by, reason)` — exceptions for one
  named account, in both directions. `effect` is `grant` or `revoke`; a grant-only table cannot
  express "everything a Cashier gets, except refunds", which is the more common request and the
  one with money attached. Unique on `(user_id, permission_id)`.
- `user_departments (user_id, category_id, granted_by)` — which modality's data an account may
  touch, beyond what its roles already imply. A separate axis from permissions on purpose:
  `results:write` says they may write a result, this says *whose*.

**Resolution**, in `userRepository`'s `EFFECTIVE_PERMISSIONS`, so login, `/auth/me` and the
per-request authority lookup cannot disagree:

```
permissions = (union of active role permissions) + grants − revokes
departments = modalities implied by roles + rows in user_departments   (null = unrestricted)
```

Revoke is applied last, as a set difference, so if a grant and a revoke ever coexisted for the
same pair the outcome would be *less* access rather than more.

**Route changes.** 45 routes now decide on permission alone, behind a new `authorizeStaff`
middleware that only asks "is this a member of staff at all". Routes whose role list includes
`Client` are untouched — those are the patient's own-data endpoints, and the staff/patient line is
the boundary being kept. `rbacRoutes` and `superAdminRoutes` keep their explicit `SuperAdmin` gate.

Six routes were gated on a role list with **no** permission at all (`GET /admin/activity`, four
appointment routes, the statutory register). Converting those blindly would have opened them to
every member of staff, so each was given the permission it should always have had first.

**No behaviour change on upgrade.** Both tables start empty, and `departmentsForUser` derives the
same departments the role mapping always implied. Every account keeps exactly the access it had.

## [1.19.0] - 2026-08-15 (Account lockout, PHI read auditing, audit retention)

Run: `node src/scripts/migrateLoginProtection.js` (additive, safe to re-run)

### Added — per-account lockout
[1.16.0]'s credential rate limiter is keyed by IP, so an attacker spreading attempts across addresses still had unlimited guesses at any one account. There was no per-account counter anywhere in the schema.

**The policy is deliberately forgiving, and that is the design decision worth recording.** A tight lockout is itself a denial of service *against the clinic*: anyone who can guess `receptionist@enlogada.com` — and the address format is guessable — could fail five logins at 08:00 and take the front desk offline during the morning rush. That is a worse outcome than the attack it prevents. So:

* **10** consecutive failures, not 3 or 5;
* **15 minutes**, and it **expires on its own** — nobody has to be phoned;
* a single successful login resets the counter, so ordinary mistyping never accumulates;
* an administrator resetting the password clears it immediately, since they have usually just verified the person in front of them.

The increment is a single `UPDATE` with the threshold check inside it — a read-then-write would under-count exactly when the account is being attacked. A lockout is audit-logged and raises a `warning` notification to Admin/SuperAdmin, because it is either an attack in progress or a staff member about to be blocked from working, and both want someone to know.

The refusal names the lockout rather than returning the generic "invalid email or password". That does confirm the account exists — a deliberate trade, since the rate limiter already bounds enumeration and the alternative is a staff member whose password is correct being told it is wrong, retrying, extending their own lock, and escalating.

### Added — PHI read auditing
All nine existing audit call sites were on *writes*. Nothing recorded who **read** a patient record, so after the mass-read hole closed in the first pass there would have been no way to scope a breach notification — the only trace was a morgan line on stdout, which is not retained. The Data Privacy Act expects an establishment to be able to say who accessed what.

Logged: viewing an identified patient's demographics, their diagnostic history, and downloading a report file. Keyed on the **patient**, since "who accessed this person's data?" is the only question this table is asked during an incident — with `idx_audit_log_entity_created` to serve exactly that.

**Deliberately not logged:** searches, worklists and queues. Staff refresh those constantly, and recording them would bury the entries that matter under traffic that is just people doing their job — the same fan-out mistake that took `notification_reads` to 255,540 rows. Client self-access is also excluded; nobody investigates a patient reading their own results. A spec pins both halves.

### Added — audit retention
`audit_log` has never had retention, and PHI reads change its growth profile completely. `pruneAuditLog.js` uses two windows because the entries answer different questions: **2 years** for PHI reads (high volume, value drops once the period is reviewed) and **7 years** for everything else (refunds, discounts, amendments, account changes — low volume, and matching how long the financial records they describe must be kept). Both overridable; dry-run by default.

### Fixed — `audit_log.actor_id` blocked deleting any user who had ever acted
The table's own comment says `actor_name` is denormalized "since the log must remain legible even if the actor's account is later deleted" — but the foreign key beside it was `NO ACTION`, which made that deletion impossible. The stated intent and the constraint contradicted each other.

This surfaced the moment lockouts and PHI reads started writing entries: **the E2E purge began failing** with `violates foreign key constraint "audit_log_actor_id_fkey"` and left test data behind, quietly undoing the guarantee that a run leaves the demo dataset exactly as it found it. Now `ON DELETE SET NULL` — never `CASCADE`, because deleting a user must not erase the record of what they did.

---

## [1.18.0] - 2026-08-15 (Date predicates that can actually use an index)

Run: `node src/scripts/migrateQueryPerformance.js` (additive, safe to re-run)

### Fixed — every date-ranged screen was doing a sequential scan
Eleven queries filtered on `column::date BETWEEN …` or `column::date = CURRENT_DATE`. **A B-tree index cannot serve a predicate on an expression**, so `idx_patient_visits_created` — added in [1.11.0] specifically for this — was never once used. The active queue sequentially scanned every visit ever recorded, on every load, for both the front desk and the cashier.

All eleven are rewritten as half-open ranges on the raw column (`col >= $1::date AND col < ($2::date + 1)`), which is exactly equivalent and lets a plain B-tree apply.

### Added
`payments.paid_at`, `visit_tests.created_at` and `test_results.released_at` had **no index at all**, and between them they carry the entire reporting suite, the cashier's transaction log and the diagnostic history. Added, plus composites for the predicates those screens actually use (`payments(payment_status, paid_at)`, `patient_visits(status, created_at)`), and an `ANALYZE` so the planner uses them immediately rather than after autovacuum next runs.

The index and the rewrite are useless apart, which is why they ship together.

### Measured, not assumed
On a throwaway database seeded with **219,000 payments** (three years at ~200/day), fetching one month of transactions:

| | plan | time | blocks read |
|---|---|---|---|
| `::date` cast | Seq Scan | 50.7 ms | 1,611 |
| half-open range | Index Scan | **0.84 ms** | 249 |

**60× faster, 6× fewer blocks**, with the date now inside the `Index Cond` rather than a post-filter. On the current demo dataset both forms are a seq scan and always will be — five rows fit in one page, and Postgres is right to prefer that — which is exactly why this had to be measured at volume instead of eyeballed locally.

### Fixed — the released-results list was unbounded
`findReleasedByCategory` had no `LIMIT` and no date bound, and selects `findings`/`remarks`, which are unbounded `TEXT`. It backs the "Released" tab, hit on every visit to that screen. At 30 laboratory tests a day that is 7,500 rows of full clinical narrative in one response after a year, 22,500 after three — for a screen that shows ten at a time. Now defaults to the last 90 days with a hard `LIMIT`, both overridable via query string and **clamped server-side** (an unclamped `limit` would let any staff member pull the department's whole history in one request).

### Also
The receptionist's **"Print Queue Ticket" produced a blank page** — a bare `window.print()` on a view with no `.print-area`, so the CSS hid everything. It now renders a real slip: the queue number at 64px for reading across a waiting room, the patient's name, visit type and time, and which departments to proceed to. Both icon-only buttons on that row also gained `aria-label`s; `title` alone is not a reliable accessible name and is invisible on touch.

---

## [1.17.0] - 2026-08-15 (VAT-exempt treatment for statutory discounts)

Run: `node src/scripts/migrateVatExemption.js` (additive, safe to re-run)

### Completes the open question from [1.14.0]
That release shipped the statutory discount as a flat 20% and said so explicitly: correct for a non-VAT establishment, an understatement for a VAT-registered one, pending confirmation of the clinic's BIR registration. **Enlogada is VAT-registered**, so the flat calculation was wrong.

RA 9994 and RA 10754 make a sale to a senior citizen or PWD **VAT-exempt**, and the order of operations is fixed by statute — it is not the intuitive one:

```
VAT-inclusive price          1,000.00
less 12% VAT                  -107.14     (1000 - 1000/1.12)
----------------------------------------
VAT-exempt sale                892.86
less 20% discount             -178.57     (20% of the VAT-EXEMPT base, not of the price)
----------------------------------------
Amount due                     714.29
```

A flat 20% off the price gives **800.00**, so seniors and PWDs were being **overcharged by ₱85.71 per ₱1,000**, and the clinic was understating the deduction it could claim. Discounting before removing VAT would also mean charging a VAT-exempt patient VAT on part of the sale.

Only **statutory** discounts get this treatment — a promo or corporate rate is an ordinary discount on a VAT-inclusive price and carries no exemption, so `discount_types.is_statutory` drives the branch rather than the percentage.

### Added
* `payments.vat_amount` — the VAT removed, snapshotted like the discount. With it the sale reconciles from the payment row alone: `amount + discount_amount + vat_amount = the VAT-inclusive price the patient was quoted`.
* `CLINIC_VAT_REGISTERED` (default `true`) and `VAT_RATE` (default `0.12`) in `backend/.env`, documented in `.env.example`.
* The bill and the receipt now show **Less VAT (12%)** and **VAT-Exempt Sale** as their own lines. BIR requires a VAT-exempt sale to be presented that way rather than folded into a single discount figure, and a patient comparing the shelf price to what they paid needs the difference explained.
* The statutory register reports `vatExemptSalesTotal` and `vatTotal` alongside gross, discount and net — the figures a senior/PWD register is actually filed with. Its `gross_amount` now adds the VAT back, so a row ties to the quoted price.

### Not backfilled, deliberately
Existing payments keep `vat_amount = 0`. Every one of them either carried no statutory discount or was computed the flat way, and restating historical rows to claim a VAT treatment they were not issued under would be worse than leaving them alone — those receipts are already in patients' hands.

### Rounding
Each figure is rounded to centavos and the balance is derived from the rounded parts, so the three components always sum exactly to the gross. `processPayment` rejects a submitted amount differing by more than a centavo, so an arithmetic disagreement here would surface as a payment the cashier cannot complete rather than as a rounding footnote.

### Test note
`discounts.spec.js` asserted the flat calculation and legitimately went red on this change. It now pins the statutory order, checks every centavo reconciles, and asserts explicitly that the flat figure is *not* what gets charged.

---

## [1.16.0] - 2026-08-15 (Session revocation, credential rate limiting, JWT secret guard)

Run: `node src/scripts/migrateSessionRevocation.js` (additive, safe to re-run)

### Fixed — resetting a password did nothing to a stolen session
"Reset the password" is the standard response to a stolen token, and it had no effect on the attacker. The token lives in `localStorage`, so XSS, a shared reception workstation, or a token captured from a log is enough to lift one. `updatePasswordHash` wrote only the hash, `verifyToken` checked only the signature, the account's existence and its `status`, and there is no server-side logout route. **The lifted token kept full access to patient records until it expired on its own** — which the deployed `.env` set to seven days.

`users.password_changed_at` closes it: `verifyToken` rejects any token issued before it. This costs nothing extra, because `verifyToken` already loads the user row on every request ([1.11.0]) — no denylist, no shared state between instances.

Every password path goes through `updatePasswordHash` (self-service change, emailed reset, and an administrator resetting a staff password), so revocation cannot be skipped by one of them.

Two details worth knowing:
* **`changePassword` now returns a replacement token**, and `AuthContext` stores it. Without that, changing your own password would sign you out one request later — the revocation is aimed at the *other* device, not the person doing the changing.
* **The check allows one second of slack.** A JWT's `iat` is whole seconds while `password_changed_at` carries milliseconds, so a token minted in the same second as the change can look up to 999ms older than it is; with no slack the replacement token would reject itself. One second is far below any realistic attack window. It also means a test has to age its tokens past a second for the assertion to mean anything — the spec says so explicitly.

Backfilled from `updated_at` rather than `NOW()`: stamping "now" would claim every password had just changed and sign the whole clinic out, and leaving it NULL would make the check inert.

### Added — a tighter bucket for credential endpoints
The rate limiter was one shared allowance across all 84 routes: 100 per 15 minutes in production (so an attacker's guessing also consumed the clinic's own budget) and 20,000 everywhere else, which is no limit at all for password guessing. There is no failed-login counter or account lockout in the schema, so nothing else slowed credential stuffing.

`/api/auth/login`, `/forgot-password` and `/reset-password` now carry a second limiter with `skipSuccessfulRequests: true` — staff signing in all morning never touch it, while wrong guesses accumulate immediately. It is keyed by IP, so a distributed attack still evades it: this raises the cost, it does not replace account lockout, which needs its own schema change and is still open.

### Added — the server refuses to start with a guessable JWT secret
`.env.example` shipped `JWT_SECRET=supersecretkeyreplaceinproduction`, and the setup instructions say to base `.env` on it. Any deployment that copied the file without editing that line was signing tokens with a string published in this repository — and since authority is read from the database for whatever `userId` a token names ([1.11.0]), an attacker signing `{ userId: 1 }` receives the seeded SuperAdmin's full role set. Presence was the only check.

Startup now rejects a blank secret, a known example value, or anything shorter than 32 characters, and `.env.example` ships the key **blank** with `openssl rand -hex 32` in the comment. `JWT_EXPIRES_IN` there is now `1d` rather than `7d`, matching the code default it was silently overriding.

---

## [1.15.1] - 2026-08-15 (Online payments that were taken but never recorded)

No schema change — service and repository only.

### Fixed — an online payment could be taken and recorded nowhere
`createCheckoutSession` cancelled the visit's in-flight gateway session **before** calling PayMongo, and only inserted the replacement row **after** the provider responded. Two ways that lost money:

1. **The ordinary double-click.** A patient opens the checkout tab, goes back, and clicks Pay again. The second call marked session S1 `Cancelled` and created S2 — but S1's tab was still open and still payable. If the patient completed *that* one, PayMongo charged them and fired the webhook for S1. `markGatewayPaymentPaid` is `WHERE gateway_session_id = $1 AND payment_status = 'Pending'`, S1 was `Cancelled`, so zero rows updated, and the handler reported `{ handled: true, alreadySettled: true }` with a 200. **The patient was charged, no `Paid` row existed, the visit was never released to any department, and nobody was told.**
2. **A provider failure.** If the PayMongo call threw or was rejected, the previous session had already been cancelled and no new row was written — same orphaned-tab exposure.

The cancel and the insert now happen together, in one transaction, *after* PayMongo returns a session id. That narrows the window to the moments between the provider minting a session and the commit, where the worst case is a second live session rather than a live session with no row behind it.

### Fixed — the webhook could not tell a redelivery from a lost payment
`if (!settled) return { handled: true, alreadySettled: true }` conflated "PayMongo retried an event we already processed" (normal, must not double-release) with "we cancelled this session out from under the payer" (money taken, nothing recorded). The handler now re-reads the row:

* already `Paid` → genuine redelivery, still idempotent;
* `Cancelled`/`Failed` → **the money moved anyway**. Logged at error level, settled through `forceSettleGatewayPayment`, and staff are notified to verify against the provider dashboard. Refusing to record it does not give the money back; it just means the clinic holds an unrecorded payment and the patient waits for an exam nobody can see.
* the settle hits `uq_payments_one_paid_per_visit` → the visit was **also** paid at the counter. That is a genuine double charge needing a refund, so it is *not* recorded as a second payment: it raises a `critical` notification and returns `requiresRefund`. Verified: exactly one `Paid` row survives.

### Also fixed
`getNextReceiptNumber()` was called before knowing whether the update would succeed, so every webhook redelivery burned a receipt number. Now that receipt numbers come from a counter that never rewinds ([1.13.0]), that punched permanent gaps in the official sequence. The handler checks for an already-`Paid` row first and mints a number only when it is going to use one. Verified: a redelivery leaves the counter unchanged.

---

## [1.15.0] - 2026-08-15 (Result versioning and critical-value flagging)

Run: `node src/scripts/migrateResultVersioning.js` (additive, safe to re-run)

### Fixed — a correction destroyed the original
`test_results` carried `UNIQUE(visit_test_id)` and `createResult` was an `ON CONFLICT DO UPDATE`, so editing an already-released result overwrote findings, remarks and file metadata **in place**. A radiology report issued to a patient could be silently rewritten with nothing anywhere recording what it originally said, and the audit entry noted only *that* a correction happened — never what changed, and the previous text no longer existed to compare against.

That is indefensible for a diagnostic report. The patient may have acted on the first version, and a referring physician certainly may have.

Each save now writes a **new row with an incremented version**. The previous row is marked `is_current = FALSE` and points at its replacement through `superseded_by`, so the chain is walkable in both directions. `amendment_reason` is required by the UI on an amendment, and the audit entry now names both versions and the reason.

### Fixed — a panic value released like a routine result
A critical result went out with the same silent "your results are ready" email as a normal CBC. `is_critical` is set by whoever records the findings and, on release, routes an urgent notification (with the patient's phone number) to Receptionist/Admin/SuperAdmin, and replaces the patient email with one asking them to contact the clinic. `critical_acknowledged_at` / `_by` / `_note` record the callback actually being made — the flag is the cheap half; the evidence that a human made contact is the part with medico-legal weight.

### Added
* `test_results.version` / `is_current` / `superseded_by` / `amendment_reason`.
* `test_results.is_critical` / `critical_acknowledged_at` / `critical_acknowledged_by` / `critical_acknowledgement_note`.
* Partial unique index `uq_test_results_current_per_test ON test_results(visit_test_id) WHERE is_current` — replaces the old `UNIQUE(visit_test_id)`, keeping "exactly one current result per test" (the invariant that UNIQUE was really protecting) while allowing history.
* `GET /api/results/:visitTestId/versions` (amendment history, department-scoped like every other result read) and `POST /api/results/:visitTestId/acknowledge-critical` (callback log — deliberately open to Receptionist, since the front desk usually makes the call and a callback that cannot be recorded by whoever made it does not get recorded).
* `'critical'` added to `chk_notification_events_type`.

### Watch out for
**Every reader of `test_results` must filter on `is_current`.** A `LEFT JOIN test_results` without it repeats the parent row once per amendment and shows superseded findings beside live ones. All five existing readers were updated (`findReleasedByCategory`, `findResultsByPatientId`, `findResultByVisitTestId`, `markReleased`, and `reportRepository.getDiagnosticWorkload` — the last would otherwise have inflated a clinician's throughput every time somebody corrected a report). A spec asserts lists never repeat a row per version.

`markReleased` in particular needed it: without the filter it stamped the releasing user onto *every* superseded version, rewriting the attribution of reports authorised by someone else at an earlier time — destroying exactly the history versioning was added to keep.

### Also found while building this
`notification_events.type` was CHECKed to `('info','success','warning')` and `notificationService` **silently coerces** anything else to `'info'`. The critical escalation was therefore arriving in the notification bell looking exactly like "New Appointment Booked". Nothing errored and nothing was lost, which is precisely why it would never have been noticed. `'critical'` is now a real severity, the notification list renders it distinctly (red, with an icon, not colour alone), and an unknown type is logged rather than downgraded in silence.

---

## [1.14.0] - 2026-08-15 (Statutory Senior Citizen / PWD discounts)

Run: `node src/scripts/migrateDiscounts.js` (additive, safe to re-run)

### Added
* `discount_types` catalogue, seeded with the two discounts mandated by **RA 9994** (Senior Citizen) and **RA 10754** (PWD) at 20%. Modelled generally rather than as two hardcoded cases, because the same shape covers the commercial discounts a clinic also needs (corporate, employee, promo) at no extra cost. `is_statutory` marks the two that exist by law: they require the holder's ID to be recorded, and are not meant to be deactivated.
* `patient_visits.discount_type_id` / `discount_id_number` / `discount_granted_by` / `discount_granted_at` — the **entitlement** claimed for a visit. It lives on the visit because the bill is computed per visit and the cashier must see the discounted total *before* taking any money.
* `payments.discount_amount` / `discount_type_name` / `discount_id_number` — an immutable **snapshot** of what was actually deducted. Deliberately not a foreign key: a receipt is a historical record and must keep saying what it said even if the catalogue is later renamed or re-rated, exactly as `visit_tests.price_at_time` does for prices. The statutory register reads from here, so it reflects money that actually changed hands.
* `GET /api/discounts` (catalogue), `POST|DELETE /api/discounts/visit/:visitId` (grant/remove, audit-logged), and `GET /api/discounts/register` (Admin/SuperAdmin only) — the separate register BIR expects for mandated discounts, with per-type totals. Refunded rows are listed but excluded from the totals: a reversed sale is not a discount the clinic granted.

### Why this mattered more than a missing feature
The clinic could not lawfully bill a senior citizen or PWD — the only occurrence of the word "discount" anywhere in the app was a mislabel on the HMO coverage line. The practical consequence is not that seniors paid full price; it is that cashiers work around it, by editing the catalogue price or taking the difference in cash and out of the system. Either one destroys the receipt trail that every other control in this codebase depends on.

### Decisions worth knowing
* **The discount base is the patient's out-of-pocket amount** (subtotal − approved HMO coverage), not the gross subtotal. A statutory discount reduces what the *patient* pays; applying it to amounts an insurer is settling would discount somebody else's money and understate the HMO receivable.
* **VAT is deliberately not modelled.** For a VAT-registered establishment the statute requires the 12% VAT to be stripped first and the 20% applied to the VAT-exempt base; for a non-VAT establishment it is a flat 20%. This system has no VAT decomposition anywhere — `tests.price` is a single figure with no tax component — so the flat percentage is correct for a non-VAT clinic and understates the discount for a VAT-registered one. Which applies depends on the clinic's BIR registration, so it is flagged in `discountService.computeDiscount` rather than silently assumed.
* **A discount cannot be changed once the visit is paid** (409). Changing it afterwards would disagree with the receipt already issued and with the register, and there is no re-bill path; a correction goes through the existing refund flow.

### Fixed
* **Receipt numbers carried the wrong date for eight hours of every day.** The date portion was formatted in JavaScript with `new Date().toISOString()` — which is UTC — while the sequence came from Postgres `CURRENT_DATE`, which is the server's local date. In Philippine time (UTC+8) a payment taken at 01:00 on the 15th was stamped `RCT-20260814-…` from the 15th's counter. Both halves now come from the same row in one statement, so they cannot disagree. With `uq_payments_receipt_number` in place from [1.13.0] this had also become a *failed payment* rather than a silent mis-dating, since the stamp reappeared the next morning.
* The same UTC-vs-local bug in four frontend screens (`todayStr` defined separately in each), which made "Today's Revenue" and the default History ranges show *yesterday* between midnight and 08:00. Now one shared `frontend/src/lib/date.js` built from local getters.
* The cashier's **"Print Receipt" produced a blank page** — `index.css` hides `body *` and reveals only `.print-area`, and the receipt modal never carried the class. On the one document a patient actually leaves with.

---

## [1.13.0] - 2026-08-14 (Concurrency-safe numbering, billing uniqueness, real transactions)

Run: `node src/scripts/migrateDataIntegrity.js` (additive, safe to re-run)

### Fixed
* **`schema.sql` could not be applied at all.** `test_results` declared `fk_results_recorded_by` twice on consecutive lines. PostgreSQL rejects a duplicate constraint name (42710), and `migrateDb.js` submits the file as a single statement — so the implicit transaction rolled back *everything*, including the `DROP TABLE`s at the top. The existing dev database predates the line, which is why nobody hit it; the first person to provision staging or production would have got a hard stop and zero tables. Now verified by applying the file to a throwaway database (22 tables, 25 foreign keys).
* **Queue numbers and receipt numbers were generated by `SELECT COUNT(*) … + 1`** followed by a separate INSERT, with nothing enforcing uniqueness behind them. Two receptionists registering at the same moment issued the same ticket; two cashiers settling at the same moment issued the same official receipt number. Both also had a no-concurrency trigger: counting *surviving rows* rather than *issuances* meant cancelling a visit, or refunding a payment, rewound the sequence and reissued a number already handed to someone.
* **The same visit could be charged twice** — `hasPaidPayment()` then INSERT, with no constraint behind it. A double-clicked "Confirm Payment" or a retry after a network blip took the money twice, and because the pre-check then returned true the duplicate was never flagged. Both rows counted toward revenue reporting.

### Added
* `daily_counters (counter_date, counter_name, last_number)` — one atomic per-day sequence, shared by queue tickets and receipts. Issued via `INSERT … ON CONFLICT DO UPDATE … RETURNING`, which takes a row lock so concurrent callers serialise. Seeded from existing visits and payments so numbering continues rather than restarting and colliding with numbers already in circulation.
* Unique index `uq_patient_visits_daily_queue` on `(created_at::date, queue_number)`.
* Unique index `uq_payments_receipt_number` on `receipt_number`.
* Partial unique index `uq_payments_one_paid_per_visit` on `payments(patient_visit_id) WHERE payment_status = 'Paid'` — a visit may still accumulate cancelled/failed gateway attempts and a refunded row, but only one settled charge.
* `db.withTransaction(fn)` in `config/database.js`. Uses `AsyncLocalStorage` so every query issued underneath it — at any call depth, through any repository, across any await — joins the same connection automatically. Chosen over threading a `client` argument through 100+ call sites in 14 repositories because that change fails *silently*: miss one and the write quietly commits outside the transaction, which is the exact bug the transaction was added to prevent. Nested calls join the transaction in progress rather than opening a second one.
* Connection pool bounds and timeouts (`max`, `connectionTimeoutMillis`, server-side `statement_timeout`) plus an idle-client error handler, so a database hiccup no longer takes the process down.

### Changed
* Multi-write flows are now atomic: client and staff account creation (previously could leave a user with valid credentials and no role — able to log in, landing nowhere, invisible to Admin's staff list because that query inner-joins `user_roles`, and unrecoverable because the email is taken), password reset (previously could change the password without consuming the token, leaving a live reset link in an inbox), result release, HMO request creation, appointment cancellation, and role-permission edits.
* Role grants now honour `starts_at` / `expires_at`. Both columns have existed since [1.0.0] and nothing ever read them, so a deliberately time-bounded grant never actually ended. This was the one revocation path that [1.11.0]'s per-request authorization did not already cover.

---

## [1.12.0] - 2026-08-14 (Separate result recording from result release)

### Added
* `test_results.recorded_by` — the staff member who wrote the findings. Backfilled from `released_by`, which is accurate for every pre-existing row since only the upload path ever set it.
* `test_results.authorised_at` — when release was authorised. The existing `released_at` is set on INSERT (i.e. when findings were recorded) and is deliberately left as-is rather than redefined underneath code that already reads it.
* `idx_test_results_recorded_by`, for per-staff workload reporting.

### Why
* `releaseResult()` was handed the releasing user's id by its controller and then silently dropped it — only the findings-upload path ever wrote `released_by`. A column named "released by" was therefore recording whoever last *typed the findings*. This is invisible while one person performs both steps, and exactly wrong the moment they are two people — which is the case the workflow is built around, since recording findings and authorising their release are separate events and `'Waiting for Release'` exists as a state precisely to separate them.
* Found while testing a temporarily-granted role: a Laboratory user borrowing Ultrasound access recorded findings, the Ultrasound staff released them, and the record credited the Laboratory user with the release.

### Migration
* `node src/scripts/migrateResultAttribution.js` — additive and idempotent.

## [1.11.0] - 2026-08-14 (Foreign-key and status indexes)

### Added
* 23 indexes covering every foreign key on the visit chain (`patients.user_id`, `patient_visits.patient_id`, `visit_tests.patient_visit_id`, `test_results.visit_test_id`, `payments.patient_visit_id`, `appointments.patient_visit_id`, the HMO join table, `user_roles`, `role_permissions`, `notification_reads.event_id`, `password_reset_tokens.user_id`, `tests.category_id`) and the status/date columns behind the queue screens (`patient_visits.status`, `visit_tests.status`, `payments.payment_status`, `appointments.status`, `appointments(scheduled_date, scheduled_time)`, `patient_visits.created_at`, `test_results.released_by`, `notification_events.created_at`).

### Why
* PostgreSQL indexes PRIMARY KEY and UNIQUE columns automatically but **not** foreign keys. The schema had three indexes in total, all added recently for specific features, so every join across the visit chain and every queue filter was a sequential scan — and each delete of a parent row scanned the entire child table to check for references. Invisible on a small database; it surfaces after a year of real visits as screens that were instant becoming slow together.

### Migration
* `node src/scripts/migrateIndexes.js` — additive and idempotent (`CREATE INDEX IF NOT EXISTS`), safe to re-run. `schema.sql` carries the same statements for fresh installs. A column missing on an older database is logged and skipped rather than aborting the run.

## [1.10.0] - 2026-08-12 (Ticket Release Gating + Online Payment Gateway)

### Changed
* `visit_tests.chk_visit_tests_status` widened to allow **`'Waiting for Release'`**: the state between `'Processing'` (released to a modality, exam not yet performed) and `'Completed'` (result released to the patient). Recording findings and releasing them are two distinct clinical events and now have two distinct states, both visible to the front desk.

### Added
* `payments.gateway_provider`, `payments.gateway_session_id`, `payments.gateway_payment_id` — links a payment row to an online GCash/Maya checkout session (PayMongo hosted checkout). NULL for counter payments. Plus `uq_payments_gateway_session` (UNIQUE) and `idx_payments_gateway_session`, which the webhook uses to resolve a session back to its pending payment.
* A gateway payment is inserted as `payment_status = 'Pending'` when the patient is redirected, and only flips to `'Paid'` when a signature-verified `checkout_session.payment.paid` webhook arrives. The browser's return to `success_url` is never trusted — it is a plain URL the patient can navigate to directly.

### Migration
* Applied additively by **`backend/src/scripts/migrateTicketFlow.js`** (idempotent, runs in a single transaction, safe to re-run) rather than by `migrateDb.js`, which is destructive and would discard accumulated seed/test data. Same approach as [1.5.0] through [1.9.0]. `schema.sql` remains canonical for fresh installs and already carries every change above.

```bash
cd backend && node src/scripts/migrateTicketFlow.js
```

### Behavioural consequence (no schema change, but load-bearing)
* `resultRepository.findPendingByCategory` now joins `patient_visits` and requires `pv.status = 'Processing'`. Previously it filtered on `visit_tests.status` alone and never looked at the parent visit, so a ticket appeared on a modality worklist the instant a client attached tests during online booking — before confirmation, before payment, and even for cancelled visits.

## [1.9.0] - 2026-08-12 (UI/UX Modernization Phase 8: profile avatar upload)

### Added
* `users.avatar_path VARCHAR(255)`, `avatar_mime_type VARCHAR(100)` (both nullable) — backs a real profile-photo upload on the My Account/Profile page, available to every role (self-service only, no admin-on-behalf-of upload). Reuses the multer disk-storage pattern from [1.7.0] (`backend/uploads/avatars/`, server-generated filename keyed on the uploading user's own ID + random hex, never the client-submitted name). `GET /auth/me/avatar` streams the file back through an authenticated route (never `express.static`) since profile photos aren't public. Uploading a new photo deletes the previous file from disk (best-effort, doesn't fail the request if cleanup fails); `DELETE /auth/me/avatar` removes it entirely, falling back to the existing initials-circle UI.
* Deliberately self-only and profile-page-scoped: the existing initials-circle avatars elsewhere in the app (sidebar user-info block, public header user chip) are unchanged — replacing those with the uploaded photo everywhere they appear was judged a separate, larger UI sweep beyond this phase's "My Account" scope.
* Applied additively directly against the live dev database, same as [1.6.0]-[1.8.0]. `schema.sql` updated to match for fresh installs. New `backend/uploads/avatars/` directory covered by the existing `backend/uploads/` gitignore entry from [1.7.0].

## [1.8.0] - 2026-08-11 (Feature Gap Plan Phase D: audit trail, staff workload, patient lookup context)

### Added
* `audit_log(id, actor_id → users.id, actor_name, action, entity_type, entity_id, description, created_at)`, plus `idx_audit_log_created_at`. `actor_name` is denormalized (not just a join to `users`) so a log entry stays legible even if the actor's account is later renamed or removed — it's a record of what happened, not a live view of current user data. Backs a new `GET /admin/activity` endpoint and Admin/SuperAdmin "Activity" page. Scoped to the sensitive actions already built this session — payment refund/cancel, staff password reset/status toggle, HMO provider create/update, result corrections — rather than instrumenting every write path in the app.
* No new columns needed for staff workload (Reception check-ins grouped by `patient_visits.created_by`, Diagnostic releases grouped by `test_results.released_by`) or patient-lookup financial context (`patients.searchPatients` gained correlated-subquery visit/unpaid counts) — both reuse existing columns.
* Applied additively directly against the live dev database, same as [1.7.0]/[1.6.0]. `schema.sql` updated to match for fresh installs.

## [1.7.0] - 2026-08-11 (Feature Gap Plan Phase B: real diagnostic result file upload)

### Added
* `test_results.file_path TEXT`, `file_original_name TEXT`, `file_mime_type TEXT`, `file_size_bytes INT` — this is the headline finding from the original gap-analysis pass: releasing a diagnostic result never actually stored a file, only `file_url` (a free-text string a staff member had to fill in with a link to somewhere else). These columns back a real upload, handled by `multer` (disk storage, `backend/uploads/results/`, server-generated filenames — never the client-submitted name, closing off path traversal). `file_url` is kept as-is (nullable) as a legacy/graceful fallback; new uploads populate the four new columns instead and leave `file_url` null.
* New `GET /results/:visitTestId/file` — authenticated, ownership-checked (reuses `assertStaffOwnsVisitTest` for staff, the same Client-owns-this-patient check `resultController.getPatientHistory` already performs) file download route. Deliberately not served via `express.static` — these are PHI, and a public static path would make every file reachable by anyone who guesses or leaks a URL.
* Applied additively (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) directly against the live dev database, same as [1.6.0]/[1.5.0], to avoid discarding accumulated seed/test data. `schema.sql` updated to match for fresh installs. `backend/uploads/` is gitignored — uploaded files are local/instance state, not source.

## [1.6.0] - 2026-08-11 (Feature Gap Plan Phase A: refund/void, HMO provider management)

### Added
* `payments.refund_reason TEXT` (nullable) — captures why a payment was moved to `Refunded`/`Cancelled` via the new `PATCH /payments/:id/status` endpoint. The status values themselves (`Refunded`, `Cancelled`) already existed in `payments.payment_status`'s CHECK constraint since the [1.0.0] baseline; no endpoint ever set them until this phase.
* `hmo_providers.is_active BOOLEAN DEFAULT TRUE` — backs the new provider CRUD (`POST`/`PUT /hmo/providers`). Providers are deactivated, not deleted, since `hmo_requests` holds a `NOT NULL` FK to `hmo_provider_id` and a hard delete would either fail or orphan historical requests.
* Applied additively (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) directly against the live dev database, same as [1.4.0]/[1.3.0], to avoid discarding accumulated seed/test data. `schema.sql` updated to match for fresh installs.

## [1.5.0] - 2026-08-10 (Module 18: Notification — normalization refinement)

### Changed
* Replaced the single `notifications(id, user_id, title, message, type, is_read, created_at)` table from [1.4.0] with two tables: `notification_events(id, title, message, type, created_at)` and `notification_reads(id, event_id → notification_events.id ON DELETE CASCADE, user_id → users.id ON DELETE CASCADE, is_read, UNIQUE(event_id, user_id))`, plus `idx_notification_reads_user (user_id, is_read)`.
* Reason: the original design inserted one full row (duplicating `title`/`message`/`type`/`created_at`) per broadcast recipient. That's not a formal normal-form violation (each row is fully determined by its own single-column key), but it duplicates event content N times per broadcast with no single place to correct it — a genuine event/read-state entity split. This shape separates the event (written once, immutable) from who has read it (per-user, mutable).
* No API contract change — `GET /notifications`/`PATCH /notifications/:id/read`/`PATCH /notifications/read-all` return the identical JSON shape as before (`notificationRepository.js` joins the two tables and aliases columns back to the original flat shape), so `notificationService.js`, the controller, routes, and the frontend needed zero changes. Applied additively/replacively on the live dev DB (old `notifications` table dropped — held only disposable test data from Module 18's own verification).

## [1.4.0] - 2026-08-10 (Module 18: Notification)

### Added
* `notifications(id, user_id → users.id ON DELETE CASCADE, title, message, type CHECK IN ('info','success','warning'), is_read, created_at)`, plus `idx_notifications_user_created (user_id, created_at DESC)`. Backs the real notification center behind `SidebarLayout.jsx`'s previously-static mock list. A broadcast-to-role event (e.g. "a new appointment was booked") fans out into one row per recipient user at insert time, rather than one shared row per event — each recipient gets an independent read state instead of racing to mark a shared row read.
* Applied additively (`CREATE TABLE IF NOT EXISTS`) directly against the live dev database rather than via a full `migrateDb.js` re-create, to avoid discarding the substantial accumulated seed/test data from Modules 1–17. `schema.sql` is still the canonical source of truth for fresh installs.

## [1.3.0] - 2026-08-10 (Module 1: Authentication — Password Reset)

### Added
* `password_reset_tokens(id, user_id → users.id ON DELETE CASCADE, token_hash UNIQUE, expires_at, used_at, created_at)` — supports the forgot-password/reset-password flow (`POST /api/auth/forgot-password`, `POST /api/auth/reset-password`). Only a SHA-256 hash of the emailed token is persisted. Tokens are single-use (`used_at`) and expire after 1 hour; a new request deletes any prior unused tokens for that user.
* This closes the "Forgot password?" dead-button gap and the Google-OAuth-only-account login gap documented in `.agents/MODULE_SCOPE.md`'s Known Gaps — a Google-created account can now obtain a real, usable password via reset.


This file tracks all structural changes, migrations, and updates made to the PostgreSQL schema.

## Canonical database initialization sequence

Run these three scripts from `backend/`, in this exact order, against a fresh database:

```bash
node src/scripts/migrateDb.js     # (re)creates all tables from database/schema.sql, incl. permissions/role_permissions — destructive, drops/recreates
node src/scripts/setupRbac.js     # seeds permissions + role_permissions data (requires the tables above to already exist)
node src/scripts/seedUsers.js     # seeds one demo user per role
```

There is no single combined command — this is a deliberate three-step sequence, not an oversight. `migrateDb.js` owns structure only; `setupRbac.js` and `seedUsers.js` own data.

---

## [1.2.0] - 2026-08-10

### Fixed
* **RBAC schema/migration drift**: `permissions` and `role_permissions` were previously created ad hoc by `backend/src/scripts/setupRbac.js` (`CREATE TABLE IF NOT EXISTS`), entirely outside `schema.sql`/`migrateDb.js`, and undocumented here. Consequence: re-running `migrateDb.js` (`DROP TABLE roles CASCADE`) silently dropped `role_permissions`' foreign-key constraint to `roles` without recreating it (`CREATE TABLE IF NOT EXISTS` is a no-op once the table exists), leaving stale `role_id` values with no enforced referential integrity.
* `permissions` and `role_permissions` are now created by `schema.sql` itself (in the "Roles and RBAC" section, right after `user_roles`), with proper `DROP TABLE ... CASCADE` entries at the top of the file alongside every other table. They are now dropped and recreated together with `roles` on every `migrateDb.js` run, so the FK relationship can never be left orphaned.
* `setupRbac.js` no longer creates these tables (removed its `CREATE TABLE IF NOT EXISTS` statements) — it is now a pure data-seeding script with an explicit precondition that `migrateDb.js` has already been run. Its seed data (13 permissions, per-role mappings) is unchanged.

---

## [1.1.0] - 2026-08-09

### Added
* Created `clinic_operating_hours` table (per-weekday open/close window, slot granularity, and per-slot capacity) to drive dynamic appointment availability.
* Seeded default operating hours: Mon-Fri 08:00-17:00, Sat 08:00-12:00 (30-minute slots), Sunday closed.
* Added `GET /api/appointments/availability?date=YYYY-MM-DD` endpoint (new `scheduleRepository`) returning bookable time slots for a given date, computed from `clinic_operating_hours` minus already-booked, non-cancelled `appointments` rows.

### Changed
* `appointmentService.createAppointment` now performs a transactional, capacity-aware conflict check (Postgres advisory lock + row count against `max_concurrent_bookings`) before inserting an appointment, rejecting out-of-hours or already-full slots with HTTP 409.

---

## [1.0.0] - 2026-08-05 (Baseline)

### Added
* Created baseline [schema.sql](file:///c:/Users/Steven/Desktop/Enlogada%20Clinic%20Management%20System/database/schema.sql).
* Configured core tables: `roles`, `users`, `user_roles`, `patient_types`, `patients`, `patient_visits`, `appointments`, `test_categories`, `tests`, `visit_tests`, `hmo_providers`, `hmo_requests`, `hmo_request_tests`, `test_results`, and `payments`.
* Seeded default static values for Roles, Patient Types, Test Categories, and initial HMO Providers.

### Changed from Initial Draft
* **Removed Pet support**: Excluded `is_pet`, `species`, and `breed` details from `patients` as the clinic has finalized that they only handle human patients.
* **Added `queue_number` column** to `patient_visits` to support front desk and cashier workflow.
* **Added `appointment_reference` column** to `appointments` to support QR code generation/lookup.
* **Added `receipt_number` column** to `payments` to track cashier receipt issuance.
* **Enforced Referential Integrity**: Added missing foreign keys for audit trail fields pointing back to `users(id)`:
  * `patient_visits(created_by)`
  * `payments(processed_by)`
  * `test_results(released_by)`
  * `user_roles(assigned_by)`
