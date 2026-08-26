/**
 * Quick-fill report templates, keyed by the department that would actually use them.
 *
 * They were once all shown to every console [UI/UX Phase 4] — Laboratory staff looking at an
 * X-Ray template. Keying them by category is what stops a technician pasting the wrong body of
 * boilerplate into a report and editing their way out of it.
 *
 * The text lives here rather than in a hook or a component because it is content, not behaviour:
 * a radiologist correcting the phrasing of a normal chest report should not have to read a state
 * machine to find it.
 */

// Values and reference ranges REMOVED. [1.51.0] This used to paste "Hemoglobin: 14.5 g/dL
// (Normal: 13.0 - 17.5)" — a fabricated patient value one click from a real report, beside a
// reference range that is not the clinic's. Their own workbook reads Male: 13.7-16.7 /
// Female: 11.7-14.5, which is sex-conditional and narrower. A template is a starting point for
// prose; it must never carry a number that could be mistaken for a measurement.
const CBC_NORMAL = `COMPLETE BLOOD COUNT (CBC):

IMPRESSION:
Normal Complete Blood Count parameters.`;

// The clinic's own wording, transcribed from an archived Chest PA report rather than written
// here. [1.51.0] The four bullets this replaced were invented, in a different order, and used
// terms ("Osseous structures", "cardiac silhouette") the radiologist does not. Five lines in a
// fixed anatomic order is also what RSNA's own chest-radiograph templates model, so the shape is
// not idiosyncratic — it is simply theirs.
const XRAY_CHEST = `Chest X-ray PA:
Lungs are clear.
Heart is not enlarged.
Aorta is not dilated.
Diaphragm and both costophrenic sulci are intact.
The rest of the visualized chest structures are unremarkable.

Impression: Normal chest radiograph.`;

// The fabricated uterus size that used to sit in this template was removed in [1.51.0]. Pelvic
// Ultrasound gained a measurement field set in [1.50.0], so a technician pasting this could put
// "5.2 x 4.1 x 3.8 cm" into the narrative while the Measurements block above it carried the real
// figure — two numbers for one organ on one report, and no way to tell which was measured.
const PELVIC_US = `PELVIC ULTRASOUND FINDINGS:
- Urinary bladder is well-distended with thin smooth walls.
- Uterus is normal in size and echotexture.
- Both ovaries display normal sonographic morphology without cystic or solid masses.
- No free fluid noted in the cul-de-sac.

IMPRESSION:
Normal Pelvic Ultrasound Evaluation.`;

// Normalised to LF on the way out. These are multi-line template literals, so on a checkout with
// core.autocrlf=true they carry CRLF while the committed blob carries LF — meaning the same
// template inserts different bytes on Windows and Linux. That matters because the text lands in
// test_results.findings: a textarea normalises CRLF to LF when the result is reopened, so saving
// an already-released report produces a version that differs from its predecessor on every line,
// demands an amendment reason, and re-emails the patient about a correction whose only change is
// line endings.
const lf = (text) => text.replace(/\r\n/g, '\n');

/** The template body for a key, or '' if the key is unknown. */
export const TEMPLATE_TEXT = {
  cbc_normal: lf(CBC_NORMAL),
  xray_chest: lf(XRAY_CHEST),
  pelvic_us: lf(PELVIC_US),
};

/** Which templates each department is offered. */
export const TEMPLATES_BY_CATEGORY = {
  Laboratory: [{ key: 'cbc_normal', label: '+ Normal CBC Template' }],
  Xray: [{ key: 'xray_chest', label: '+ Normal Chest X-Ray' }],
  Ultrasound: [{ key: 'pelvic_us', label: '+ Normal Pelvic Ultrasound' }],
};
