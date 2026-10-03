/**
 * Seeds a realistic clinic dataset — enough for every role to have real work on screen, and
 * enough history behind it that the reporting screens have something to plot.
 *
 * Built for demonstrating and manually exercising the system after `resetDemoData.js`.
 *
 * Two passes, for a reason:
 *
 *   TODAY goes through the real HTTP API. Queue numbers, receipt numbers, ticket-release gating,
 *   discount arithmetic and status transitions are all produced by the same code paths a real
 *   visit uses. Seeding straight into the tables would create rows the application itself could
 *   never have produced, which is exactly the kind of test data that makes a demo lie.
 *
 *   HISTORY is created the same way and then BACKDATED with a direct UPDATE, because the API
 *   always stamps the current time and there is no legitimate endpoint that says "this happened
 *   last Tuesday". Without history the revenue trend, the staff-workload report and the
 *   date-range screens are all empty, which makes them look broken rather than new.
 *
 * What it creates reads like a real week at a clinic in Bugo, Cagayan de Oro. [1.89.0]
 *   - The people are invented and ordinary. Each has ONE patient record, and a returning patient
 *     comes back to it rather than being registered again, which Patient Records would show.
 *   - Addresses are barangays around the clinic, and every patient has a number of their own.
 *   - Every result form is filled in, inside the clinic's own printed reference ranges, and every
 *     imaging study carries a written report ending in its impression. A handful are abnormal, as
 *     a real week's are.
 *   - Today's visits are spread across the clinic's day in the order they arrived, so the waits
 *     and turnaround read as minutes rather than "0m".
 *   No patient has an email address, so nothing this script does can send one.
 *
 * Why this matters day to day: every "today" screen — the active queue, today's collections, the
 * modality worklists — filters on the current date. Seed on Monday and demo on Tuesday and they
 * are all legitimately empty. Re-run this before a demo; it only ever adds, so pair it with
 * `resetDemoData.js --confirm` for a clean slate.
 *
 * Requires both dev servers running.
 *   node src/scripts/seedDemoScenario.js
 */
const db = require('../config/database');
// The vocabulary, not a copy of it: a seeder that invents a method the CHECK constraint
// rejects fails halfway through, leaving a half-built demo. [1.33.0]
const { COUNTER_METHODS, CASH_METHOD } = require('../constants/paymentMethods');
const logger = require('../config/logger');

const API = process.env.E2E_API_URL ? `${process.env.E2E_API_URL}/api` : 'http://localhost:5000/api';
const PASSWORD = 'Password123!';

const STAFF = {
  receptionist: 'receptionist@enlogada.com',
  cashier: 'cashier@enlogada.com',
  lab: 'lab@enlogada.com',
  xray: 'xray@enlogada.com',
  ultrasound: 'ultrasound@enlogada.com',
  admin: 'admin@enlogada.com',
};

// ── Who comes in ─────────────────────────────────────────────────────────────────────────────
// Invented people with ordinary names, because a demo full of "Test Patient 1" (or of national
// heroes, which is what this list used to be) tells you nothing about how the screens read with
// real data — column widths, truncation and sort order all behave differently.

const CITY = 'Cagayan de Oro City';
const PLACES = [
  `Purok 2, Bugo, ${CITY}`, `Zone 4, Bugo, ${CITY}`, `Puerto, ${CITY}`, `Agusan, ${CITY}`,
  `Tablon, ${CITY}`, `Cugman, ${CITY}`, `Gusa, ${CITY}`, `Lapasan, ${CITY}`, `Macasandig, ${CITY}`,
  `Carmen, ${CITY}`, `Kauswagan, ${CITY}`, `Balulang, ${CITY}`, `Bulua, ${CITY}`,
  'Poblacion, Tagoloan, Misamis Oriental', 'Katipunan, Villanueva, Misamis Oriental',
  'Poblacion, Jasaan, Misamis Oriental',
];
const PREFIXES = ['0917', '0918', '0927', '0935', '0945', '0956', '0966', '0977', '0998', '0908'];
const phone = (i, salt = 0) =>
  `${PREFIXES[(i * 3 + salt) % PREFIXES.length]}${String((3141593 + (i + 1) * 7919 + salt * 104729) % 10000000).padStart(7, '0')}`;

// Seen today, in the order they arrive. Kept apart from the history pool so nobody is handed a
// second visit while their first is still in the queue.
const TODAY_POOL = {
  actub: ['Josephine', 'Actub', 'Female', '1971-05-09'],
  sabal: ['Arnel', 'Sabal', 'Male', '1984-08-15'],
  borja: ['Leah', 'Borja', 'Female', '1985-01-22'],
  llamas: ['Gemma', 'Llamas', 'Female', '1968-12-01'],
  velez: ['Dominador', 'Velez', 'Male', '1953-02-12'],
  pabillore: ['Jonathan', 'Pabillore', 'Male', '1979-12-03'],
  villareal: ['Ernesto', 'Villareal', 'Male', '1961-09-02'],
  ebarle: ['Maricel', 'Ebarle', 'Female', '1993-02-27'],
  jamis: ['Mark Anthony', 'Jamis', 'Male', '1990-10-14'],
  yap: ['Ramil', 'Yap', 'Male', '1982-03-17'],
  lagbas: ['Cristina', 'Lagbas', 'Female', '1997-03-30'],
  chaves: ['Analyn', 'Chaves', 'Female', '1999-09-19'],
  ocampo: ['Susana', 'Ocampo', 'Female', '1964-06-06'],
  dagondon: ['Marites', 'Dagondon', 'Female', '1988-06-11'],
  bacarrisas: ['Reynaldo', 'Bacarrisas', 'Male', '1956-11-21'],
  maglangit: ['Rodel', 'Maglangit', 'Male', '1976-07-07'],
  tagailo: ['Kevin', 'Tagailo', 'Male', '2003-04-25'],
};

// Booked ahead by the front desk.
const BOOKING_POOL = [
  { person: ['Jocelyn', 'Abaday', 'Female', '1987-08-08'], tests: ['Complete Blood Count (CBC)', 'Fasting Blood Sugar (FBS)'], time: '09:00', notes: 'Pre-employment requirement' },
  { person: ['Noel', 'Dumaguing', 'Male', '1974-10-10'], tests: ['Whole Abdomen'], time: '10:00', notes: 'Follow-up, gallbladder' },
  { person: ['Precious', 'Ramos', 'Female', '2001-01-05'], tests: ['Pelvic Ultrasound'], time: '08:30', notes: 'Referred by OB-GYN' },
  { person: ['Virgilio', 'Tan', 'Male', '1958-05-30'], tests: ['KUB / Prostate'], time: '09:30', notes: 'Frequent urination at night' },
  { person: ['Hazel', 'Quimbo', 'Female', '1992-07-12'], tests: ['Trans-vaginal (TVS)'], time: '13:00', notes: 'Early pregnancy check' },
  { person: ['Allan', 'Sumampong', 'Male', '1980-02-02'], tests: [/chest/i], time: '14:00', notes: 'Annual physical exam' },
];

// Two weeks of returning patients. Each comes back about once a week, to the same record.
const HISTORY_POOL = [
  ['Maria Luisa', 'Uy', 'Female', '1966-03-14'], ['Edgardo', 'Balili', 'Male', '1962-08-29'],
  ['Rowena', 'Legaspi', 'Female', '1983-11-11'], ['Benjie', 'Alcantara', 'Male', '1991-04-04'],
  ['Teresita', 'Macaraeg', 'Female', '1955-07-19'], ['Randy', 'Obsioma', 'Male', '1987-09-09'],
  ['Charlene', 'Dizon', 'Female', '1995-12-24'], ['Alfredo', 'Magno', 'Male', '1950-01-15'],
  ['Lorna', 'Gallardo', 'Female', '1972-10-02'], ['Jose', 'Manlangit', 'Male', '1969-06-23'],
  ['Rhodora', 'Sanchez', 'Female', '1978-04-30'], ['Glenn', 'Lumacang', 'Male', '1989-05-05'],
  ['Imelda', 'Caballero', 'Female', '1960-09-09'], ['Nestor', 'Galarrita', 'Male', '1965-11-30'],
  ['Janine', 'Abellana', 'Female', '2000-08-18'], ['Wilfredo', 'Tiu', 'Male', '1957-02-28'],
];

// Invented physicians, so "Referred by" is filled on some visits and empty on others — the honest
// picture, and the one that shows the rule working rather than a field always full or always blank.
const REFERRERS = [
  ['Dr. Amelia R. Santos', '0142887'],
  ['Dr. Benigno L. Cruz', '0098431'],
  ['Dr. Corazon M. Villanueva', '0176520'],
  ['Dr. Rogelio P. Abellanosa', '0121904'],
];

// ── What a result form says ──────────────────────────────────────────────────────────────────
// Normal adult values, inside the clinic's own printed ranges (result_fields.reference_note).
// Anything not listed here is placed inside its printed range instead. Text results are written
// the way the clinic's sheets print them.
const NUMBERS = {
  // Complete blood count. The differential adds up to 100.
  wbc: 7.2, rbc: { Male: 5.02, Female: 4.46 }, hemoglobin: { Male: 14.8, Female: 12.9 },
  hematocrit: { Male: 44.1, Female: 38.6 }, mcv: 88.4, mch: 29.6, mchc: 33.4, platelet_count: 268,
  neutrophils: 58, lymphocytes: 32, monocytes: 6, eosinophils: 3, basophils: 1, rdw_cv: 12.8,
  // Lipids, consistent with each other: LDL = cholesterol - HDL - triglycerides / 5.
  cholesterol: 186, triglycerides: 132, hdl: 48, ldl: 111.6, vldl: 26.4, chol_hdl_ratio: 3.9,
  fbs: 88, first_hour: 152, second_hour: 118,
  // Ultrasound, in cm (the bladder in cc).
  right_liver_lobe: 13.4, left_liver_lobe: 6.9, spleen: 8.8, right_kidney_ct: 1.5, left_kidney_ct: 1.6,
  isthmus: 0.3, endometrial_thickness: 0.8, right_epididymal_head: 0.9, left_epididymal_head: 0.8,
  ub_prevoid_volume: 285, ub_postvoid_volume: 18,
  // A biophysical profile scores each component 0 or 2; the server totals them.
  fetal_tone: 2, fetal_movement: 2, fetal_breathing: 2, amniotic_fluid: 2, non_stress_test: 2,
};
const DIMENSIONS = {
  gallbladder: [6.8, 2.6, 2.4], right_kidney: [10.4, 4.6, 4.2], left_kidney: [10.8, 4.9, 4.4],
  prostate_gland: [3.6, 3.1, 2.9], uterus: [7.6, 4.3, 3.8], cervix: [3.1, 2.6, 2.4],
  right_ovary: [3.0, 2.1, 1.8], left_ovary: [2.8, 1.9, 1.7], right_thyroid_lobe: [4.6, 1.6, 1.5],
  left_thyroid_lobe: [4.4, 1.5, 1.4], right_testis: [4.2, 2.7, 2.3], left_testis: [4.1, 2.6, 2.2],
};
const TEXT = {
  specimen: 'RANDOM', color: 'YELLOW', appearance: 'CLEAR', glucose: 'NEGATIVE', protein: 'NEGATIVE',
  ph: '6.0', specific_gravity: '1.020', wbc: '0-2', rbc: '0-1', epithelial_cells: 'FEW',
  mucous_threads: 'FEW', amorphous_urates: 'RARE', bacteria: 'FEW', amorphous_phosphates: 'NONE',
  clotting_time: '5 minutes', bleeding_time: '2 minutes', hbsag_screening: 'NON-REACTIVE',
  syphilis_vdrl: 'NON-REACTIVE', hiv_screening: 'NON-REACTIVE',
};
const FECALYSIS = {
  color: 'BROWN', consistency: 'FORMED', wbc: '0-1', rbc: 'NONE', fat_globules: 'NONE',
  ova_of_parasites: 'NO OVA SEEN', amoeba: 'NONE SEEN', others: 'NONE',
};
const BLOOD_TYPES = ['O RH POSITIVE', 'A RH POSITIVE', 'B RH POSITIVE', 'O RH POSITIVE', 'AB RH POSITIVE'];
// Held exact rather than varied, because they only mean anything together.
const EXACT = new Set([
  'neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils',
  'cholesterol', 'triglycerides', 'hdl', 'ldl', 'vldl', 'chol_hdl_ratio',
  'fetal_tone', 'fetal_movement', 'fetal_breathing', 'amniotic_fluid', 'non_stress_test',
]);

const decimalsOf = (n) => (String(n).split('.')[1] || '').length;

/** A value inside a printed range: "70.0 - 100.0", "Male: 0.6-1.2 / Female: 0.5-1.0" or "<240.0". */
function withinRange(note, sex, position) {
  if (!note) return null;
  let text = note;
  const bySex = note.match(/Male:\s*([^/]+)\/\s*Female:\s*(.+)/i);
  if (bySex) text = sex === 'Female' ? bySex[2] : bySex[1];
  const range = text.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (range) {
    const [lo, hi] = [Number(range[1]), Number(range[2])];
    return (lo + (hi - lo) * position).toFixed(Math.max(decimalsOf(range[1]), decimalsOf(range[2]), 1));
  }
  const upper = text.match(/<\s*([\d.]+)/);
  if (upper) return (Number(upper[1]) * (0.55 + 0.2 * position)).toFixed(Math.max(decimalsOf(upper[1]), 1));
  return null;
}

/**
 * The measurements for one form, keyed by field code as POST /results expects.
 * Skips a derived field (the server works it out) and a field for the other sex (it refuses one).
 */
function fillForm(form, sex, seed, overrides = {}) {
  const nudge = 1 + (((seed * 37) % 7) - 3) / 100;   // within ±3%, so no two reports match exactly
  const position = 0.35 + ((seed * 13) % 31) / 100;  // somewhere in the middle of a printed range
  const out = {};
  for (const f of form.fields) {
    if (f.derivation) continue;
    if (f.applies_to_sex && f.applies_to_sex !== sex) continue;
    const code = f.code;
    if (f.value_kind === 'linear3') {
      const base = overrides[code] || DIMENSIONS[code];
      if (!base) continue;
      const [a, b, c] = base.map((n) => (n * nudge).toFixed(1));
      out[code] = { value_1: a, value_2: b, value_3: c };
    } else if (f.value_kind === 'text') {
      const value = overrides[code]
        ?? (form.name === 'Fecalysis' ? FECALYSIS[code] : undefined)
        ?? TEXT[code]
        ?? (code === 'blood_type' ? BLOOD_TYPES[seed % BLOOD_TYPES.length] : undefined);
      if (value) out[code] = { value_text: value };
    } else if (f.value_kind === 'number') {
      let value = overrides[code];
      if (value === undefined) {
        const known = NUMBERS[code];
        const base = known && typeof known === 'object' ? known[sex] : known;
        value = base === undefined
          ? withinRange(f.reference_note, sex, position)
          : (EXACT.has(code) ? base : (base * nudge).toFixed(decimalsOf(base)));
      }
      if (value !== null && value !== undefined) out[code] = { value_1: String(value) };
    }
  }
  return out;
}

// Written reports for imaging, ending in the impression the way the clinic's reports do.
const para = (...parts) => parts.filter(Boolean).join('\n\n');
const LIVER_NORMAL = 'The liver is normal in size with smooth borders and a homogeneous parenchymal echopattern. No focal lesion is seen. The intrahepatic ducts and the common bile duct are not dilated.';
const LIVER_FATTY = 'The liver is normal in size with smooth borders. The parenchymal echopattern is diffusely increased, with fair visualisation of the portal vein walls and the diaphragm. No focal lesion is seen. The bile ducts are not dilated.';
const GALLBLADDER = 'The gallbladder is adequately distended with a thin wall and no intraluminal echoes.';
const KIDNEYS = 'Both kidneys are normal in size and echopattern, with good corticomedullary differentiation. No calculi or hydronephrosis.';
const BLADDER = 'The urinary bladder is adequately filled with smooth walls and no intraluminal echoes.';

function imagingReport(form, test, sex, variant) {
  const name = form?.name || '';
  const liver = variant === 'fatty' ? LIVER_FATTY : LIVER_NORMAL;
  const abdomenImpression = variant === 'fatty' ? 'MILD FATTY INFILTRATION OF THE LIVER.' : null;
  switch (name) {
    case 'Whole Abdomen':
      return para(liver, `${GALLBLADDER} The pancreas and spleen are unremarkable.`, KIDNEYS,
        sex === 'Male'
          ? `${BLADDER} The prostate gland is not enlarged and has a homogeneous echopattern.`
          : `${BLADDER} The uterus is normal in size. No adnexal mass is seen.`,
        `IMPRESSION:\n${abdomenImpression || 'NORMAL WHOLE ABDOMINAL ULTRASOUND.'}`);
    case 'Upper Abdomen':
      return para(liver, `${GALLBLADDER} The pancreas and spleen are unremarkable.`, KIDNEYS,
        `IMPRESSION:\n${abdomenImpression || 'NORMAL UPPER ABDOMINAL ULTRASOUND.'}`);
    case 'Hepatobiliary Tree':
    case 'Liver':
      return para(liver, `${GALLBLADDER} The spleen is not enlarged.`,
        `IMPRESSION:\n${abdomenImpression || 'NORMAL HEPATOBILIARY ULTRASOUND.'}`);
    case 'Lower Abdomen':
      return para(KIDNEYS, BLADDER,
        sex === 'Male' ? 'The prostate gland is not enlarged.' : 'The uterus and cervix are normal in size and echopattern.',
        'IMPRESSION:\nNORMAL LOWER ABDOMINAL ULTRASOUND.');
    case 'KUB and Prostate':
      return para(KIDNEYS, `${BLADDER} Post-void residual urine is not significant.`,
        sex === 'Male' ? 'The prostate gland is not enlarged and has a homogeneous echopattern. No calcifications.' : null,
        `IMPRESSION:\n${sex === 'Male' ? 'NORMAL KUB-PROSTATE ULTRASOUND.' : 'NORMAL KUB ULTRASOUND.'}`);
    case 'Thyroid and Neck':
      return para('Both thyroid lobes are normal in size with a homogeneous echopattern. No nodule or cyst is seen. The isthmus is not thickened.',
        'No enlarged cervical lymph nodes.', 'IMPRESSION:\nNORMAL THYROID ULTRASOUND.');
    case 'Pelvic':
    case 'Transvaginal':
      return para('The uterus is anteverted, normal in size, with a homogeneous myometrial echopattern. The endometrium is thin and regular.',
        'Both ovaries are normal in size and appearance. No adnexal mass. No free fluid in the cul-de-sac.',
        `IMPRESSION:\nNORMAL ${name === 'Pelvic' ? 'PELVIC' : 'TRANSVAGINAL'} ULTRASOUND.`);
    case 'Scrotum':
      return para('Both testes are normal in size with a homogeneous echopattern. The epididymides are not enlarged. No hydrocele or varicocele.',
        'IMPRESSION:\nNORMAL SCROTAL ULTRASOUND.');
    case 'Biophysical Profile':
    case 'Biophysical Profile with NST':
      return para('Single live intrauterine pregnancy in cephalic presentation. The fetal heart rate is 144 beats per minute and regular.',
        'The placenta is fundal-anterior, grade II, with no previa. The amniotic fluid is adequate.',
        `IMPRESSION:\nSINGLE LIVE INTRAUTERINE PREGNANCY, CEPHALIC.\nBIOPHYSICAL SCORE ${name.endsWith('NST') ? '10/10' : '8/8'}, REASSURING.`);
    default:
      break;
  }
  if (/chest/i.test(test.name)) {
    return variant === 'pneumonia'
      ? para('Hazy densities are seen in the right lower lung field. The rest of the lung fields are clear.',
        'The heart is not enlarged. The hemidiaphragms and the costophrenic sulci are intact.',
        'IMPRESSION:\nPNEUMONIA, RIGHT LOWER LOBE. Suggest follow-up after treatment.')
      : para('The lung fields are clear. The heart is not enlarged.',
        'The hemidiaphragms and the costophrenic sulci are intact. The visualised bony thorax is unremarkable.',
        'IMPRESSION:\nNORMAL CHEST.');
  }
  return para('No fracture or dislocation is seen. The joint spaces are preserved and the soft tissues are unremarkable.',
    'IMPRESSION:\nNO RADIOGRAPHIC ABNORMALITY.');
}

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.message || text.slice(0, 140)}`);
  return json;
};

const login = async (email) =>
  (await call('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).data.token;

const pick = (arr, i) => arr[i % arr.length];
const dateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function main() {
  logger.info(`Seeding demo data against ${API}`);

  const tok = {};
  for (const [key, email] of Object.entries(STAFF)) tok[key] = await login(email);

  const types = (await call('/patients/types', { token: tok.receptionist })).data.patientTypes;
  const typeId = (name) => (types.find((t) => new RegExp(name, 'i').test(t.name)) || types[0]).id;

  const tests = (await call('/tests')).data.tests;
  const byCategory = (cat) => tests.filter((t) => t.category_name === cat && parseFloat(t.price) > 0);
  const catalogue = {
    Laboratory: byCategory('Laboratory'),
    Xray: byCategory('Xray'),
    Ultrasound: byCategory('Ultrasound'),
    ECG: byCategory('ECG'),
  };

  // What the clinic ACTUALLY sells today, derived rather than restated.
  //
  // These were hardcoded in four places, and [1.47.0] retired 2D Echo and ECG — so
  // `catalogue['2D Echo'][0].id` became a read of undefined and the whole seeder died with
  // "Cannot read properties of undefined". A demo seeder that cannot run is worse than one that
  // covers fewer departments, and the clinic's offering is not this script's to assert.
  const OFFERED = Object.keys(catalogue).filter((c) => catalogue[c].length > 0);
  if (OFFERED.length === 0) throw new Error('No active priced services — run seedRealCatalogue.js first.');
  /** A category that definitely has services, preferring the one asked for. */
  const offered = (preferred) => (catalogue[preferred]?.length ? preferred : OFFERED[0]);

  /** A service by its name on the price list (or a pattern), falling back to the first one. */
  const findTest = (category, wanted) => {
    const list = catalogue[offered(category)];
    return list.find((t) => (wanted instanceof RegExp ? wanted.test(t.name) : t.name === wanted)) || list[0];
  };

  // Preparation instructions on the tests that really need them [1.24.0], so a demo shows the
  // amber note in the booking wizard and the "Before your appointment" block in the confirmation
  // email. Matched by name fragment rather than by id — the catalogue is clinic-edited and ids
  // are not stable across a rebuild. Anything not matched keeps NULL, which is correct: most
  // Laboratory tests need nothing, and a note on every line would train patients to ignore them.
  const PREP = [
    [/fasting|fbs|glucose|lipid|cholesterol/i, 'Nothing to eat or drink except water for 8 hours before your appointment. Take your usual medicines unless your doctor says otherwise.'],
    [/pelvic|abdominal|kub|ultrasound/i, 'Drink 3–4 glasses of water an hour before your appointment and do not empty your bladder.'],
    [/x-?ray|chest/i, 'Please tell us before the scan if you are or might be pregnant. Leave jewellery at home.'],
  ];
  let prepped = 0;
  for (const t of tests) {
    const match = PREP.find(([re]) => re.test(t.name));
    if (!match || t.preparation) continue;
    await call(`/tests/${t.id}`, {
      method: 'PUT', token: tok.admin,
      body: { categoryId: t.category_id, name: t.name, price: t.price, isActive: t.is_active, preparation: match[1] },
    });
    prepped += 1;
  }
  if (prepped) logger.info(`Preparation instructions set on ${prepped} test(s).`);

  const discounts = (await call('/discounts', { token: tok.cashier })).data.discounts;
  const senior = discounts.find((d) => d.name === 'Senior Citizen');
  const pwd = discounts.find((d) => d.name === 'PWD');

  const modalityToken = { Laboratory: tok.lab, Xray: tok.xray, Ultrasound: tok.ultrasound, ECG: tok.admin };

  // The result form a service uses, read from the same tables the result entry screen reads.
  const formCache = new Map();
  const formFor = async (testId) => {
    if (!formCache.has(testId)) {
      const { rows } = await db.query(
        `SELECT fs.name AS set_name, f.code, f.value_kind, f.applies_to_sex, f.reference_note, f.derivation
           FROM result_field_set_tests fst
           JOIN result_field_sets fs ON fs.id = fst.field_set_id AND fs.is_active
           JOIN result_fields f ON f.field_set_id = fs.id AND f.is_active
          WHERE fst.test_id = $1
          ORDER BY f.display_order`,
        [testId]
      );
      formCache.set(testId, rows.length ? { name: rows[0].set_name, fields: rows } : null);
    }
    return formCache.get(testId);
  };

  // One record per person. A second visit reuses it, as the front desk would.
  let personCount = 0;
  const records = new Map();
  const patientFor = async ([firstName, lastName, sex, birthdate], patientTypeName = 'Self Pay') => {
    const key = `${firstName} ${lastName}`;
    if (!records.has(key)) {
      const i = personCount++;
      const patient = (await call('/patients', {
        method: 'POST', token: tok.receptionist,
        body: {
          patientTypeId: typeId(patientTypeName), firstName, lastName, birthdate, sex,
          address: pick(PLACES, i * 5), contactNumber: phone(i), emergencyContact: phone(i, 7),
        },
      })).data.patient;
      records.set(key, { patient, sex, seed: i + 1 });
    }
    return records.get(key);
  };

  /**
   * Registers a walk-in visit for `person` and attaches one service. Returns the ids and price.
   *
   * Defaults to Self Pay. It used to default to 'Private', which was a harmless label until
   * [1.23.0] made 'Private' mean "a physician referred them" — at which point every seeded visit
   * would have been refused for naming no doctor. Most of these are ordinary walk-ins, which is
   * what Self Pay describes; pass `referrerIndex` for the ones that should carry a referral.
   */
  const makeVisit = async ({ person, category, test, patientTypeName = 'Self Pay', referrerIndex = null, notes = '' }) => {
    const { patient, sex, seed } = await patientFor(person, patientTypeName);

    // 'Private' and HMO both require one, so those callers must supply an index.
    const referrer = referrerIndex === null ? null : pick(REFERRERS, referrerIndex);

    const visit = (await call('/visits', {
      method: 'POST', token: tok.receptionist,
      body: {
        patientId: patient.id, visitType: 'Walk in', notes,
        referringPhysician: referrer?.[0], referringPhysicianPrc: referrer?.[1],
      },
    })).data.visit;

    const chosen = test && typeof test === 'object' && test.id ? test : findTest(category, test);
    const attached = (await call('/tests/visit-tests', {
      method: 'POST', token: tok.receptionist,
      body: { patientVisitId: visit.id, testIds: [chosen.id] },
    })).data.visitTests[0];

    return {
      patient, sex, seed, visit, test: chosen, visitTestId: attached.id,
      category: offered(category), price: parseFloat(chosen.price),
    };
  };

  const payFor = async (v, method = 'Cash') => {
    const bill = (await call(`/payments/bill/${v.visit.id}`, { token: tok.cashier })).data.bill;
    return (await call('/payments', {
      method: 'POST', token: tok.cashier,
      body: { patientVisitId: v.visit.id, paymentMethod: method, amount: parseFloat(bill.totalAmount) },
    })).data.payment;
  };

  /**
   * A minimal, valid one-page PDF, built by hand rather than pulled from a fixture file.
   *
   * The seeded dataset had 40 results and not one attachment, so the report viewer — and the
   * whole "can this role open the document" question the department scoping exists to answer —
   * could not be exercised at all without someone manually uploading a file first.
   *
   * Hand-assembled because the alternatives are worse: a binary fixture in the repo is a blob
   * nobody can review, and a dependency for six lines of PostScript is not worth the supply
   * chain. The xref offsets are computed rather than hardcoded, so editing the text below cannot
   * silently produce a PDF that some readers reject and others tolerate.
   */
  const makeSamplePdf = (title, body) => {
    // A PDF's xref table is a list of BYTE offsets, so every length in this function has to be
    // measured in the same encoding the file is finally written in. The first version measured
    // with Buffer.byteLength(str) — which defaults to UTF-8 — and wrote with Buffer.from(str,
    // 'latin1'). An em dash is three bytes in the first and one in the second, so each one shifted
    // every subsequent offset by two and produced a file that opens as a blank page in some
    // readers and an error in others. Two defences: ASCII only, and every measurement explicitly
    // latin1.
    const LATIN1 = 'latin1';
    const len = (s) => Buffer.byteLength(s, LATIN1);
    // Escape the three characters that are structural inside a PDF string literal, and flatten
    // anything outside printable ASCII rather than trusting it to survive the round trip.
    const esc = (s) =>
      String(s)
        .replace(/[‐-―]/g, '-')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[^\x20-\x7E]/g, '?')
        .replace(/([()\\])/g, '\\$1');

    const lines = [
      'BT /F1 15 Tf 60 770 Td (' + esc('ENLOGADA ULTRASOUND & DIAGNOSTIC CLINIC') + ') Tj ET',
      'BT /F1 11 Tf 60 750 Td (' + esc(title) + ') Tj ET',
      ...String(body)
        .match(/.{1,88}(\s|$)/g)
        .map((line, i) => 'BT /F1 10 Tf 60 ' + (715 - i * 15) + ' Td (' + esc(line.trim()) + ') Tj ET'),
      'BT /F1 8 Tf 60 60 Td (' + esc('Sample document generated by seedDemoScenario.js - not a real clinical report.') + ') Tj ET',
    ];
    const content = lines.join('\n');

    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${len(content)} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((obj, i) => {
      offsets.push(len(pdf));
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xrefStart = len(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    return Buffer.from(pdf, LATIN1);
  };

  const postResult = async (v, form) => {
    const res = await fetch(`${API}/results/${v.visitTestId}`, {
      method: 'POST', headers: { Authorization: `Bearer ${modalityToken[v.category]}` }, body: form,
    });
    if (!res.ok) throw new Error(`record findings -> ${res.status} ${(await res.text()).slice(0, 160)}`);
    return (await res.json()).data.result;
  };

  /**
   * Records a result the way the department would: the form filled in, and for imaging a written
   * report with the document attached. `values` overrides individual fields, `variant` picks an
   * abnormal imaging report, and `findings` replaces the written text entirely.
   */
  const recordFindings = async (v, { findings, values, variant, remarks } = {}) => {
    const form = await formFor(v.test.id);
    const imaging = v.category === 'Ultrasound' || v.category === 'Xray';
    const text = findings ?? (imaging ? imagingReport(form, v.test, v.sex, variant) : (form ? '' : 'Within normal limits.'));

    const body = new FormData();
    if (text) body.append('findings', text);
    if (remarks) body.append('remarks', remarks);
    if (form) body.append('measurements', JSON.stringify(fillForm(form, v.sex, v.seed, values)));
    // Every result carries its report, not only the imaging ones. [1.94.0]
    //
    // This attached a PDF for Ultrasound and X-ray and left Laboratory with findings text alone,
    // which was right while findings WERE the report. A release now requires the document, so the
    // old shape would have stopped the seeder dead on the first laboratory visit — and, worse for
    // a demo, shown the clinic a system where half the results have nothing to open.
    const pdf = makeSamplePdf(`${v.test.name} - ${v.patient.first_name} ${v.patient.last_name}`, text);
    body.append(
      'file',
      new Blob([pdf], { type: 'application/pdf' }),
      `${v.category.toLowerCase()}-report-${v.patient.last_name.toLowerCase().replace(/\s+/g, '-')}.pdf`
    );
    return postResult(v, body);
  };

  /** A corrected version of a released or recorded result, with the reason the clinic requires. */
  const amend = async (v, { findings, values, reason, remarks }) => {
    const body = new FormData();
    if (findings) body.append('findings', findings);
    if (remarks) body.append('remarks', remarks);
    body.append('amendmentReason', reason);
    if (values) body.append('measurements', JSON.stringify(values));
    // A corrected result carries a CORRECTED document. [1.94.0] Without this the amendment would
    // inherit the original file and the demo would show an "amendment" whose report is identical
    // to the one it replaced — which is exactly the empty-amendment problem the clinic should not
    // be shown, and which the real workflow avoids by attaching the new report.
    const pdf = makeSamplePdf(
      `${v.test.name} (corrected) - ${v.patient.first_name} ${v.patient.last_name}`,
      findings || reason
    );
    body.append(
      'file',
      new Blob([pdf], { type: 'application/pdf' }),
      `${v.category.toLowerCase()}-report-${v.patient.last_name.toLowerCase().replace(/\s+/g, '-')}-corrected.pdf`
    );
    return postResult(v, body);
  };

  const release = async (v) =>
    (await call(`/results/${v.visitTestId}/release`, { method: 'POST', token: modalityToken[v.category] })).data.result;

  // ── TODAY: the clinic's day so far, created in the order people arrived ───────────────────
  // Created earliest first, so queue and receipt numbers rise with the arrival times set below.
  const today = [];
  const stages = [];
  const note = (v, text) => stages.push(`${v.patient.first_name} ${v.patient.last_name} — ${text}`);

  // 1. The first arrivals, already finished and released.
  {
    const v = await makeVisit({ person: TODAY_POOL.actub, category: 'Laboratory', test: 'Complete Blood Count (CBC)', notes: 'Annual physical exam' });
    await payFor(v, 'Cash');
    await recordFindings(v);
    await release(v);
    today.push({ ...v, stage: 'released' });
    note(v, 'CBC completed and released');
  }
  {
    const v = await makeVisit({ person: TODAY_POOL.sabal, category: 'Ultrasound', test: 'Whole Abdomen', notes: 'Upper abdominal pain on and off' });
    await payFor(v, 'GCash');
    await recordFindings(v, { variant: 'fatty' });
    await release(v);
    today.push({ ...v, stage: 'released' });
    note(v, 'whole abdomen released, mild fatty liver');
  }

  // 2. An AMENDED X-ray report — two versions, so the amendment history has something in it.
  {
    // An amendment is re-issued to whoever received the first version, so it needs a referrer.
    const v = await makeVisit({ person: TODAY_POOL.borja, category: 'Xray', test: /chest/i, referrerIndex: 2, notes: 'Cough for two weeks' });
    await payFor(v, 'GCash');
    await recordFindings(v);
    await amend(v, {
      findings: para('Minimal linear densities are seen in the left lung base. The rest of the lung fields are clear.',
        'The heart is not enlarged. The hemidiaphragms and the costophrenic sulci are intact.',
        'IMPRESSION:\nMINIMAL LEFT BASAL ATELECTASIS. NO CONSOLIDATION.'),
      remarks: 'Corrected on review by the radiologist.',
      reason: 'The first report missed a left basal finding seen on re-review',
    });
    await release(v);
    today.push({ ...v, stage: 'released' });
    note(v, 'AMENDED chest X-ray report (v2), released');
  }

  // 2b. And an amended LABORATORY result. [1.70.0]
  //
  // result-version-timeline.spec looks for one in LABORATORY — it drives the laboratory
  // technician's own history screen, which is where a lab amendment would be read back.
  {
    const v = await makeVisit({ person: TODAY_POOL.llamas, category: 'Laboratory', test: 'Lipid Profile', referrerIndex: 1, notes: 'Hypertension, maintenance medicines' });
    await payFor(v, 'Cash');
    // A comment on both versions as well as the grid (a laboratory form's COMMENT box is
    // `findings`): the superseded version keeps its findings, which is what
    // result-version-timeline.spec reads back and strikes through.
    await recordFindings(v, { values: { cholesterol: 286 }, findings: 'Elevated total cholesterol.' });
    await amend(v, {
      findings: 'Total cholesterol within the desirable level.',
      values: { cholesterol: { value_1: '186' } },
      reason: 'Cholesterol transcribed as 286; corrected to 186 against the analyser printout',
    });
    await release(v);
    today.push({ ...v, stage: 'released' });
    note(v, 'AMENDED lipid profile (v2), released');
  }

  // 3. A CRITICAL result, released and awaiting callback — the escalation path.
  {
    // Names a referrer: a critical value is called back to the requesting physician, so this is
    // the visit where that field most obviously has to be populated.
    const v = await makeVisit({ person: TODAY_POOL.velez, category: 'Laboratory', test: 'Fasting Blood Sugar (FBS)', referrerIndex: 0, notes: 'Known diabetic, missed medicines' });
    await payFor(v, 'Cash');
    await recordFindings(v, {
      values: { fbs: 452 },
      findings: 'Critically high fasting blood sugar. A repeat run on the same specimen confirms the value. For urgent physician review.',
    });
    await release(v);
    today.push({ ...v, stage: 'released' });
    note(v, 'CRITICAL fasting blood sugar released, callback outstanding');
  }

  // 4. Findings recorded, awaiting authorisation — the 'Waiting for Release' state.
  {
    const v = await makeVisit({ person: TODAY_POOL.pabillore, category: 'Laboratory', test: 'Fasting Blood Sugar (FBS)', notes: 'Company check-up' });
    await payFor(v, 'Cash');
    await recordFindings(v, { values: { fbs: 108 } });
    today.push({ ...v, stage: 'recorded' });
    note(v, 'fasting blood sugar recorded, awaiting release');
  }

  // 5. A senior citizen and a PWD, SETTLED — otherwise the BIR statutory register is empty, since
  //    it reads from payments rather than from entitlements. An empty register looks broken.
  for (const [person, d, label, idNumber, test] of [
    [TODAY_POOL.villareal, senior, 'Senior Citizen', 'OSCA-0412871', 'KUB / Prostate'],
    [TODAY_POOL.ebarle, pwd, 'PWD', 'PWD-10-4305-0001276', 'Pelvic Ultrasound'],
  ]) {
    const v = await makeVisit({ person, category: 'Ultrasound', test });
    await call(`/discounts/visit/${v.visit.id}`, {
      method: 'POST', token: tok.cashier, body: { discountTypeId: d.id, idNumber },
    });
    const paid = await payFor(v, 'Cash');
    today.push({ ...v, stage: 'paid' });
    note(v, `${label} PAID: gross ${v.price.toFixed(2)}, less VAT ${paid.vat_amount}, less 20% ${paid.discount_amount} = ${paid.amount}`);
  }

  // 6. Paid and released to the departments — live on the worklists.
  //
  // These carry a referring physician. They are the tickets a technician actually looks at, and
  // the worklist shows "Ref: Dr. …" beside the test — without one on any live ticket the column
  // is permanently blank and the feature is invisible in a demo.
  for (const [i, [person, category, test, notes]] of [
    [TODAY_POOL.jamis, 'Laboratory', 'Urinalysis', 'Burning sensation on urination'],
    [TODAY_POOL.yap, 'Xray', /chest/i, 'Pre-employment requirement'],
    [TODAY_POOL.lagbas, 'Ultrasound', 'BPS', '34 weeks pregnant, referred by OB-GYN'],
  ].entries()) {
    const v = await makeVisit({ person, category, test, referrerIndex: i, notes });
    await payFor(v, pick(COUNTER_METHODS, i));
    today.push({ ...v, stage: 'paid' });
    note(v, `paid, on the ${v.category} worklist`);
  }

  // 7. An HMO patient with a pending pre-authorisation, for the Service Requests screen.
  {
    // Carries a referring physician: an HMO claim requires one [1.23.0], and this is the visit
    // the Service Requests screen opens, so it is also where Admin sees the field populated.
    const v = await makeVisit({
      person: TODAY_POOL.chaves, category: 'Ultrasound', test: 'Thyroid', patientTypeName: 'HMO', referrerIndex: 3,
      notes: 'Neck swelling, for evaluation',
    });
    const providers = (await call('/hmo/providers', { token: tok.receptionist })).data.providers;
    await call('/hmo/request', {
      method: 'POST', token: tok.receptionist,
      body: { hmoProviderId: providers[0].id, approvalCode: 'LOA-2026-091534', visitTestIds: [v.visitTestId] },
    });
    today.push({ ...v, stage: 'waiting' });
    note(v, `HMO pre-auth pending (${providers[0].name})`);
  }

  // 8. The latest arrivals, awaiting payment — the cashier's billing queue. A senior and a PWD
  //    among them, so the statutory discount and its arithmetic are visible at the till.
  for (const [person, category, test, notes, discount] of [
    [TODAY_POOL.ocampo, 'Ultrasound', 'Whole Abdomen', 'Bloating after meals', [senior, 'OSCA-0398254']],
    [TODAY_POOL.dagondon, 'Laboratory', 'Complete Blood Count (CBC)', 'Easy fatigability', [pwd, 'PWD-10-4305-0002044']],
    [TODAY_POOL.bacarrisas, 'Xray', /chest/i, 'Annual physical exam', null],
    [TODAY_POOL.maglangit, 'Laboratory', 'Lipid Profile', 'Company check-up', null],
    [TODAY_POOL.tagailo, 'Laboratory', 'Blood Typing', 'Pre-employment requirement', null],
  ]) {
    const v = await makeVisit({ person, category, test, notes });
    if (discount) {
      await call(`/discounts/visit/${v.visit.id}`, {
        method: 'POST', token: tok.cashier, body: { discountTypeId: discount[0].id, idNumber: discount[1] },
      });
    }
    today.push({ ...v, stage: 'waiting' });
    note(v, `awaiting payment (${v.test.name})${discount ? `, ${discount[0].name}` : ''}`);
  }

  // Spread today's visits across the clinic's day, in the order they arrived. The API stamped
  // every one with the same minute, which reads as "everyone walked in at once" and gives every
  // department a turnaround of 0 minutes. Skipped before 9 a.m., when there is no day to spread.
  await retimeToday(today);

  // ── HISTORY: two weeks of completed, paid visits, then backdated ─────────────────────────
  // Without this the revenue trend, staff workload and every date-range report are empty, which
  // reads as broken rather than new. The same sixteen people come and go, about once a week each.
  const historical = [];
  const LAB_ROTATION = [
    'Complete Blood Count (CBC)', 'Fasting Blood Sugar (FBS)', 'Urinalysis', 'Lipid Profile', 'Creatinine',
    'Blood Uric Acid (BUA)', 'SGPT', 'HbA1c', 'Blood Typing', 'TSH', 'Stool Exam', 'Blood Urea Nitrogen (BUN)',
  ];
  const ULTRASOUND_ROTATION = {
    Male: ['Whole Abdomen', 'KUB / Prostate', 'Upper Abdomen', 'HBT', 'Thyroid'],
    Female: ['Pelvic Ultrasound', 'Whole Abdomen', 'Thyroid', 'Upper Abdomen', 'Trans-vaginal (TVS)'],
  };
  const HISTORY_CATEGORIES = ['Laboratory', 'Ultrasound', 'Laboratory', 'Xray', 'Ultrasound'].filter((c) => OFFERED.includes(c));
  // A few results out of range, as in any real week: a raised sugar, a raised cholesterol, a
  // fatty liver and a pneumonia. Keyed by the visit's position in the fortnight.
  const ABNORMAL = {
    4: { values: { fbs: 128 } },
    9: { values: { cholesterol: 258, triglycerides: 210, hdl: 41, ldl: 175.0, vldl: 42.0, chol_hdl_ratio: 6.3 } },
    12: { variant: 'fatty' },
    16: { variant: 'pneumonia' },
  };
  let k = 0;
  for (let daysAgo = 14; daysAgo >= 1; daysAgo--) {
    // The clinic is closed on Sundays and shuts at noon on Saturdays, so the history keeps to the
    // days and hours it is open. [1.90.0]
    const day = new Date();
    day.setDate(day.getDate() - daysAgo);
    const weekday = day.getDay();
    if (weekday === 0) continue;
    // Two or three visits a day, varying so the trend line is not a flat bar.
    const perDay = 2 + (daysAgo % 2);
    for (let i = 0; i < perDay; i++, k++) {
      const person = HISTORY_POOL[k % HISTORY_POOL.length];
      const category = pick(HISTORY_CATEGORIES, k);
      const test = category === 'Laboratory' ? pick(LAB_ROTATION, k)
        : category === 'Ultrasound' ? pick(ULTRASOUND_ROTATION[person[2]], k)
          : /chest/i;
      const v = await makeVisit({ person, category, test, referrerIndex: k % 3 === 0 ? k : null });
      await payFor(v, pick([CASH_METHOD, ...COUNTER_METHODS], daysAgo + i));
      await recordFindings(v, ABNORMAL[k] || {});
      await release(v);
      historical.push({ ...v, daysAgo, slot: i, saturday: weekday === 6 });
    }
  }

  // Backdate in one transaction. Everything above was created "now" by the API; this is the only
  // step that cannot go through it, because no endpoint legitimately says "this happened last
  // Tuesday" — and rightly so.
  await db.withTransaction(async () => {
    for (const h of historical) {
      const shift = `${h.daysAgo} days`;

      // Spread each visit across a plausible working day instead of collapsing it to the instant
      // the seeder ran. Turnaround and wait-time reporting measures the gap between these
      // timestamps, and a dataset where check-in, payment and release all share one second makes
      // every one of those figures read 0m — which looks like a broken metric rather than an
      // artificial fixture. Measured before this: every category reported "avg 0m median 0m".
      //
      // The numbers are per-modality and roughly what each actually takes: bloods come back
      // inside the hour, a scan needs the room and a radiographer.
      const TURNAROUND_MINUTES = { Laboratory: 45, ECG: 25, Xray: 70, Ultrasound: 95 };
      // 08:00-15:00 on a weekday, 08:00-10:00 on a Saturday; each of a day's visits at its own hour.
      const arrival = h.saturday ? 8 + ((h.daysAgo + h.slot) % 3) : 8 + ((h.daysAgo + h.slot * 3) % 8);
      const waitToPay = 4 + (h.daysAgo % 17);                    // a few minutes at the desk
      const turnaround = TURNAROUND_MINUTES[h.category] ?? 60;
      // ±25% jitter, deterministic per visit so a reseed is reproducible.
      const jitter = 1 + (((h.daysAgo * 7 + h.visit.id) % 50) - 25) / 100;
      const releaseAfter = Math.round(turnaround * jitter);

      await db.query(
        `UPDATE patient_visits
            SET created_at = (CURRENT_DATE - $2::interval) + make_interval(hours => $3),
                updated_at = (CURRENT_DATE - $2::interval) + make_interval(hours => $3)
          WHERE id = $1`,
        [h.visit.id, shift, arrival]
      );
      await db.query(
        `UPDATE visit_tests
            SET created_at = (CURRENT_DATE - $2::interval) + make_interval(hours => $3, mins => 2)
          WHERE patient_visit_id = $1`,
        [h.visit.id, shift, arrival]
      );
      await db.query(
        `UPDATE payments
            SET paid_at = (CURRENT_DATE - $2::interval) + make_interval(hours => $3, mins => $4)
          WHERE patient_visit_id = $1`,
        [h.visit.id, shift, arrival, waitToPay]
      );
      await db.query(
        `UPDATE test_results
            SET released_at    = (CURRENT_DATE - $2::interval) + make_interval(hours => $3, mins => $4),
                authorised_at  = (CURRENT_DATE - $2::interval) + make_interval(hours => $3, mins => $4)
          WHERE visit_test_id = $1`,
        [h.visitTestId, shift, arrival, waitToPay + releaseAfter]
      );
    }
  });

  // ── Appointments: the demo patient's online bookings, and the front desk's ────────────────
  const client = await login('client@enlogada.com');
  const profiles = (await call('/patients/my-profiles', { token: client })).data.patients;
  const openSlots = async (date, token, after = null) => {
    const slots = (await call(`/appointments/availability?date=${dateStr(date)}`, { token })).data.slots || [];
    return slots
      .filter((s) => s && s.available !== false)
      .map((s) => (typeof s === 'string' ? s : s.time))
      .filter((t) => t && (!after || t.slice(0, 5) > after));
  };
  const nextDay = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };

  if (profiles.length > 0) {
    const slotDate = nextDay(new Date(), 2);
    try {
      const slots = await openSlots(slotDate, client);
      // Two bookings, because the QR pass has two states worth seeing side by side: one still to
      // be paid at the counter (the common case in this clinic) and one already settled online.
      // With a single unpaid booking the pass was invisible for a long time — the display used to
      // require payment first — and the demo could not show the scanner having anything to read.
      const bookings = [
        { label: 'awaiting payment at the counter', pay: false },
        { label: 'prepaid', pay: true },
      ];
      for (const [i, plan] of bookings.entries()) {
        if (!slots[i]) break;
        const booking = (await call('/appointments', {
          method: 'POST', token: client,
          body: { patientId: profiles[0].id, scheduledDate: dateStr(slotDate), scheduledTime: slots[i], notes: 'Online booking' },
        })).data.appointment;
        // Deliberately a test that NEEDS preparation — a Fasting Blood Sugar if the catalogue has
        // one. It was Laboratory[0], which is a CBC and needs nothing, so the seeded booking
        // showed no preparation note anywhere and the feature was invisible in a demo. FBS is
        // also the honest example: it is exactly the test somebody books online and then forgets
        // to fast for.
        const labTest = catalogue.Laboratory.find((t) => t.preparation) || catalogue.Laboratory[0];
        await call('/tests/visit-tests', {
          method: 'POST', token: client,
          body: { patientVisitId: booking.patient_visit_id, testIds: [labTest.id] },
        });
        if (plan.pay) {
          const bill = (await call(`/payments/bill/${booking.patient_visit_id}`, { token: tok.cashier })).data.bill;
          await call('/payments', {
            method: 'POST', token: tok.cashier,
            body: { patientVisitId: booking.patient_visit_id, paymentMethod: 'GCash', amount: parseFloat(bill.totalAmount) },
          });
        }
        stages.push(`${profiles[0].first_name} ${profiles[0].last_name} — online appointment ${dateStr(slotDate)}, ${plan.label} (QR booking pass)`);
      }
    } catch (err) {
      logger.warn(`  appointment booking skipped: ${err.message}`);
    }
  }

  // The front desk books ahead for walk-ins who phone in. Two of them later TODAY when the day
  // still has room, so the Desk has bookings to check in; the rest over the next working days.
  const nowTime = new Date();
  const laterToday = `${String(nowTime.getHours() + 1).padStart(2, '0')}:${String(nowTime.getMinutes()).padStart(2, '0')}`;
  let dayOffset = 1;
  for (const [i, b] of BOOKING_POOL.entries()) {
    try {
      const { patient } = await patientFor(b.person);
      let date = null;
      let time = null;
      if (i < 2) {
        const todays = await openSlots(nowTime, tok.receptionist, laterToday);
        if (todays.length) { date = nowTime; time = todays[0]; }
      }
      for (let tries = 0; !date && tries < 7; tries++, dayOffset++) {
        const candidate = nextDay(nowTime, dayOffset);
        const slots = await openSlots(candidate, tok.receptionist);
        if (!slots.length) continue;                       // closed that day
        date = candidate;
        time = slots.find((t) => t.slice(0, 5) >= b.time) || slots[0];
        if (i % 2 === 1) dayOffset++;                     // about two bookings a day
      }
      if (!date) continue;
      const testIds = b.tests.map((t) => findTest(t instanceof RegExp ? 'Xray' : (/Abdomen|Pelvic|KUB|Trans/.test(t) ? 'Ultrasound' : 'Laboratory'), t).id);
      await call('/appointments', {
        method: 'POST', token: tok.receptionist,
        body: { patientId: patient.id, scheduledDate: dateStr(date), scheduledTime: time, notes: b.notes, testIds },
      });
      stages.push(`${b.person[0]} ${b.person[1]} — booked for ${dateStr(date)} ${time.slice(0, 5)} by the front desk`);
    } catch (err) {
      logger.warn(`  front-desk booking for ${b.person[0]} ${b.person[1]} skipped: ${err.message}`);
    }
  }

  // A booking for a later day was made on an earlier one. [1.90.0] The API stamps a booking with
  // today; moved one to three open days back, the way people book ahead. Since [1.92.0] a booking
  // joins the queue only when it is checked in, so this is about the dates the history and the
  // reports show, not about the queue. A booking for later TODAY keeps today's stamp.
  const seededPatients = [...records.values()].map((r) => r.patient.id);
  if (profiles.length > 0) seededPatients.push(profiles[0].id);
  const { rows: bookings } = await db.query(
    `SELECT a.id, a.patient_visit_id, (a.scheduled_date > CURRENT_DATE) AS ahead
       FROM appointments a JOIN patient_visits pv ON pv.id = a.patient_visit_id
      WHERE pv.patient_id = ANY($1) AND pv.created_at >= NOW() - interval '30 minutes'
      ORDER BY a.id`,
    [seededPatients]
  );
  const stampAppointment = (await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'created_at'`
  )).rowCount > 0;
  await db.withTransaction(async () => {
    for (const [i, b] of bookings.filter((row) => row.ahead).entries()) {
      // Made one to three OPEN days back (the clinic is closed on Sunday), inside that day's
      // opening hours, which end at noon on a Saturday. Picked in SQL, on the server's calendar.
      const { rows: [{ at }] } = await db.query(
        `SELECT to_char(day + make_interval(hours => CASE WHEN EXTRACT(DOW FROM day) = 6
                                                          THEN 9 + ($2::int % 3) ELSE 9 + $2::int END),
                        'YYYY-MM-DD HH24:MI:SS') AS at
           FROM (SELECT d::date AS day
                   FROM generate_series(CURRENT_DATE - 7, CURRENT_DATE - 1, interval '1 day') AS d
                  WHERE EXTRACT(DOW FROM d) <> 0
                  ORDER BY d DESC OFFSET $1 LIMIT 1) AS made`,
        [i % 3, i % 7]
      );
      await db.query(
        `UPDATE patient_visits SET created_at = $2::timestamp, updated_at = $2::timestamp WHERE id = $1`,
        [b.patient_visit_id, at]
      );
      if (stampAppointment) {
        await db.query(`UPDATE appointments SET created_at = $2::timestamp WHERE patient_visit_id = $1`, [
          b.patient_visit_id,
          at,
        ]);
      }
    }
  });

  // Every ticket and receipt this run issued, renumbered to the day it now belongs to.
  await renumberSeeded([
    ...today.map((v) => v.visit.id),
    ...historical.map((h) => h.visit.id),
    ...bookings.map((b) => b.patient_visit_id),
  ]);

  // ── Summary ──────────────────────────────────────────────────────────────────────────────
  const counts = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM patient_visits WHERE created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + 1) AS visits_today,
      (SELECT COUNT(*)::int FROM patient_visits) AS visits_total,
      (SELECT COUNT(*)::int FROM patients) AS patients,
      (SELECT COUNT(*)::int FROM payments WHERE payment_status = 'Paid' AND paid_at >= CURRENT_DATE AND paid_at < CURRENT_DATE + 1) AS paid_today,
      (SELECT COALESCE(SUM(amount),0)::numeric(10,2) FROM payments WHERE payment_status = 'Paid' AND paid_at >= CURRENT_DATE AND paid_at < CURRENT_DATE + 1) AS revenue_today,
      (SELECT COUNT(*)::int FROM test_results WHERE is_current AND is_critical) AS critical,
      (SELECT COUNT(*)::int FROM test_results WHERE version > 1) AS amended,
      (SELECT COUNT(*)::int FROM appointments) AS appointments
  `);
  const c = counts.rows[0];

  logger.info('');
  logger.info("Today's workflow:");
  for (const line of stages) logger.info(`   • ${line}`);
  logger.info('');
  logger.info(`   patients            ${c.patients}`);
  logger.info(`   visits today        ${c.visits_today}   (${c.visits_total} including 14 days of history)`);
  logger.info(`   paid today          ${c.paid_today}   —  PHP ${c.revenue_today}`);
  logger.info(`   critical results    ${c.critical}   awaiting callback`);
  logger.info(`   amended results     ${c.amended}`);
  logger.info(`   appointments        ${c.appointments}`);
  logger.info('');
  logger.info('Every "today" screen filters on the current date, so re-run this before a demo.');
  logger.info('Frontend: http://localhost:5173');
  process.exit(0);
}

/**
 * Sets today's arrival, payment and result times across the clinic's day so far. [1.89.0]
 *
 * Visits were created in arrival order, so the queue and receipt numbers already rise with these
 * times. The day runs from 08:00 to now (or to 17:00, if the seed runs after closing); with less
 * than an hour of it behind us there is nothing to spread and the API's own times stand.
 */
async function retimeToday(visits) {
  const now = new Date();
  const open = new Date(now); open.setHours(8, 0, 0, 0);
  const close = new Date(now); close.setHours(17, 0, 0, 0);
  const end = new Date(Math.min(now.getTime() - 3 * 60000, close.getTime()));
  const span = end.getTime() - open.getTime();
  if (span < 60 * 60000 || visits.length === 0) return;

  const TURNAROUND = { Laboratory: 40, Xray: 30, Ultrasound: 45 };
  const step = span / (visits.length + 1);
  const at = (ms) => new Date(Math.min(ms, end.getTime()));

  await db.withTransaction(async () => {
    for (const [i, v] of visits.entries()) {
      const arrival = at(open.getTime() + step * (i + 0.4));
      const paid = at(arrival.getTime() + Math.min(8 * 60000, step * 0.25));
      const turnaround = (TURNAROUND[v.category] ?? 40) * 60000 * (0.8 + ((i * 7) % 5) / 10);
      const reported = at(paid.getTime() + turnaround);

      await db.query('UPDATE patient_visits SET created_at = $2, updated_at = $2 WHERE id = $1', [v.visit.id, arrival]);
      // Cast, or Postgres reads `$2 + interval` as interval arithmetic and refuses the assignment.
      await db.query(`UPDATE visit_tests SET created_at = $2::timestamp + interval '2 minutes' WHERE patient_visit_id = $1`, [v.visit.id, arrival]);
      if (v.stage !== 'waiting') {
        await db.query('UPDATE payments SET paid_at = $2 WHERE patient_visit_id = $1', [v.visit.id, paid]);
      }
      if (v.stage === 'released') {
        await db.query(
          'UPDATE test_results SET released_at = $2, authorised_at = $2 WHERE visit_test_id = $1 AND released_at IS NOT NULL',
          [v.visitTestId, reported]
        );
      }
    }
  });
}

/** Rows grouped by `key`, in the order they came. */
const groupBy = (rows, key) => {
  const groups = new Map();
  for (const r of rows) groups.set(r[key], [...(groups.get(r[key]) || []), r]);
  return groups;
};

/**
 * Gives the visits this run created the queue tickets and receipt numbers their own days would
 * have issued. [1.90.0]
 *
 * The API numbers everything on the day it runs, so a visit backdated to the 3rd still carried
 * today's ticket #0030 and a receipt dated today, and today's next receipt jumped to #0047 past
 * numbers no longer in use. Each day is renumbered in the order things happened, after anything
 * already on that day that this run did not create, and the day's counters are set to what is now
 * in use, so the next ticket and receipt follow on.
 *
 * Only the rows this run created. A number handed to a real patient must never change, and a
 * counter is never set below a number a surviving row still holds.
 */
async function renumberSeeded(visitIds) {
  if (!visitIds.length) return;
  await db.withTransaction(async () => {
    const setCounter = (day, name, maxSql, params) => db.query(
      `INSERT INTO daily_counters (counter_date, counter_name, last_number)
       SELECT $1::date, '${name}', COALESCE((${maxSql}), 0)
       ON CONFLICT (counter_date, counter_name) DO UPDATE SET last_number = EXCLUDED.last_number`,
      [day, ...params]
    );

    // Queue tickets, by the day of the visit. Parked on a placeholder first, so no two rows ever
    // hold the same ticket on the same day while they move.
    const visits = (await db.query(
      `SELECT id, to_char(created_at, 'YYYY-MM-DD') AS day FROM patient_visits
        WHERE id = ANY($1) AND queue_number IS NOT NULL ORDER BY created_at, id`,
      [visitIds]
    )).rows;
    await db.query(
      `UPDATE patient_visits SET queue_number = 'S' || id WHERE id = ANY($1) AND queue_number IS NOT NULL`,
      [visitIds]
    );
    const maxTicket = `SELECT MAX(queue_number::int) FROM patient_visits
      WHERE created_at >= $1::date AND created_at < $1::date + 1 AND queue_number ~ '^[0-9]+$'`;
    for (const [day, list] of groupBy(visits, 'day')) {
      const base = Number((await db.query(`${maxTicket}`, [day])).rows[0].max) || 0;
      for (const [i, v] of list.entries()) {
        await db.query('UPDATE patient_visits SET queue_number = $2 WHERE id = $1', [v.id, String(base + i + 1).padStart(4, '0')]);
      }
      await setCounter(day, 'queue', maxTicket, []);
    }

    // Receipts, by the day they were paid, in the clinic's RCT-YYYYMMDD-NNNN form.
    const receipts = (await db.query(
      `SELECT id, to_char(paid_at, 'YYYY-MM-DD') AS day, to_char(paid_at, 'YYYYMMDD') AS stamp FROM payments
        WHERE patient_visit_id = ANY($1) AND receipt_number IS NOT NULL ORDER BY paid_at, id`,
      [visitIds]
    )).rows;
    await db.query(
      `UPDATE payments SET receipt_number = 'SEED-' || id WHERE patient_visit_id = ANY($1) AND receipt_number IS NOT NULL`,
      [visitIds]
    );
    const maxReceipt = `SELECT MAX(substring(receipt_number from '-([0-9]+)$')::int) FROM payments WHERE receipt_number LIKE $2`;
    for (const [day, list] of groupBy(receipts, 'day')) {
      const prefix = `RCT-${list[0].stamp}-`;
      const base = Number((await db.query(maxReceipt.replace('$2', '$1'), [`${prefix}%`])).rows[0].max) || 0;
      for (const [i, p] of list.entries()) {
        await db.query('UPDATE payments SET receipt_number = $2 WHERE id = $1', [p.id, `${prefix}${String(base + i + 1).padStart(4, '0')}`]);
      }
      await setCounter(day, 'receipt', maxReceipt, [`${prefix}%`]);
    }
  });
}

main().catch((err) => {
  logger.error(`Seeding failed: ${err.message}`);
  process.exit(1);
});
