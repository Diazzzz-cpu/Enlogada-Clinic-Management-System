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
const { LAB_FIELD_SETS, SIGNATORIES } = require('../constants/labResultForms');
// [1.125.0] The demo's reports are drawn on the clinic's own form, not as a page of text.
const { renderClinicReport } = require('./demoReportPdf');
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
  // Books at the desk and takes the payment there and then [1.132.0]: Receptionist and Cashier.
  desk: 'multirole@enlogada.com',
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

// Booked ahead at the front desk, and paid there and then: payment first [1.132.0].
const BOOKING_POOL = [
  { person: ['Jocelyn', 'Abaday', 'Female', '1987-08-08'], tests: ['Complete Blood Count (CBC)', 'Fasting Blood Sugar (FBS)'], time: '09:00', notes: 'Pre-employment requirement' },
  { person: ['Noel', 'Dumaguing', 'Male', '1974-10-10'], tests: ['Whole Abdomen'], time: '10:00', notes: 'Follow-up, gallbladder' },
  { person: ['Precious', 'Ramos', 'Female', '2001-01-05'], tests: ['Pelvic Ultrasound'], time: '08:30', notes: 'Referred by OB-GYN' },
  { person: ['Virgilio', 'Tan', 'Male', '1958-05-30'], tests: ['KUB / Prostate'], time: '09:30', notes: 'Frequent urination at night' },
  { person: ['Hazel', 'Quimbo', 'Female', '1992-07-12'], tests: ['Trans-vaginal (TVS)'], time: '13:00', notes: 'Early pregnancy check' },
  { person: ['Allan', 'Sumampong', 'Male', '1980-02-02'], tests: [/chest/i], time: '14:00', notes: 'Annual physical exam' },
];

// Two months of patients. [1.125.0] About sixty people, from names common around Bugo and Cagayan
// de Oro; most are seen once or twice, each always to the same record. Generated rather than
// listed so the pool can grow without a hand-typed table, and deterministic, so a reseed produces
// the same people. No surname here is used by today's patients, the bookings, the staff accounts,
// or the clinic's own sample report.
const HISTORY_FEMALE = ['Maria Luisa', 'Rowena', 'Teresita', 'Charlene', 'Lorna', 'Rhodora', 'Imelda', 'Janine',
  'Marivic', 'Rosalinda', 'Evangeline', 'Cherry Mae', 'Jennifer', 'Arlene', 'Nenita', 'Gloria', 'Liezl',
  'Kristine Joy', 'Divina', 'Milagros', 'Florencia', 'Aileen', 'Mylene', 'Sheila Mae', 'Rachelle', 'Cecilia',
  'Erlinda', 'Annabelle', 'Junalyn', 'Remedios'];
const HISTORY_MALE = ['Edgardo', 'Benjie', 'Randy', 'Alfredo', 'Jose', 'Glenn', 'Nestor', 'Wilfredo', 'Rogelio',
  'Danilo', 'Ramon', 'Rodrigo', 'Jerome', 'Romeo', 'Reynante', 'Cris John', 'Jessie', 'Arnold', 'Elmer',
  'Florencio', 'Manuel', 'Junrey', 'Kenneth', 'Leonardo', 'Vicente', 'Ariel', 'Dexter', 'Teodoro',
  'Eduardo', 'Marlon'];
const HISTORY_SURNAMES = ['Uy', 'Balili', 'Legaspi', 'Alcantara', 'Macaraeg', 'Obsioma', 'Dizon', 'Magno',
  'Gallardo', 'Manlangit', 'Sanchez', 'Lumacang', 'Caballero', 'Galarrita', 'Abellana', 'Tiu', 'Pacana',
  'Bacalso', 'Ladera', 'Jamisola', 'Cagas', 'Dablo', 'Paler', 'Sumalpong', 'Labis', 'Daligdig', 'Ompoc',
  'Lagura', 'Yamit', 'Pagara', 'Baculio', 'Villamor', 'Acenas', 'Tagupa', 'Elcano', 'Gumapac', 'Maglinte',
  'Lumayag', 'Cuizon', 'Pepito', 'Amora', 'Sagarino', 'Dumalagan', 'Lim', 'Chiong', 'Bendijo', 'Tabanao',
  'Velasco', 'Rosales', 'Gementiza', 'Bajao', 'Salvana', 'Montecillo', 'Lacson', 'Ranile', 'Cabanlit',
  'Neri-Sy', 'Pabualan', 'Ycong', 'Madrazo'];
const HISTORY_POOL = HISTORY_SURNAMES.map((surname, i) => {
  const female = i % 2 === 0;
  const first = (female ? HISTORY_FEMALE : HISTORY_MALE)[Math.floor(i / 2) % 30];
  // 1946 to 2007: every age the clinic sees, seniors included. Month and day vary with the index.
  const year = 1946 + ((i * 23) % 62);
  const month = String(((i * 5) % 12) + 1).padStart(2, '0');
  const day = String(((i * 11) % 28) + 1).padStart(2, '0');
  return [first, surname, female ? 'Female' : 'Male', `${year}-${month}-${day}`];
});

// Invented physicians, so "Referred by" is filled on some visits and empty on others — the honest
// picture, and the one that shows the rule working rather than a field always full or always blank.
const REFERRERS = [
  ['Dr. Amelia R. Santos', '0142887'],
  ['Dr. Benigno L. Cruz', '0098431'],
  ['Dr. Corazon M. Villanueva', '0176520'],
  ['Dr. Rogelio P. Abellanosa', '0121904'],
];

// ── What a laboratory report says ────────────────────────────────────────────────────────────
// Normal adult values, inside the clinic's own printed ranges (the `note` on each line of
// constants/labResultForms.js). Anything not listed here is placed inside its printed range
// instead. Text results are written the way the clinic's sheets print them. [1.109.0] They are
// printed INTO the sample report PDF, which is where a real result's values live: the system no
// longer stores typed values.
const NUMBERS = {
  // Complete blood count. The differential adds up to 100.
  wbc: 7.2, rbc: { Male: 5.02, Female: 4.46 }, hemoglobin: { Male: 14.8, Female: 12.9 },
  hematocrit: { Male: 44.1, Female: 38.6 }, mcv: 88.4, mch: 29.6, mchc: 33.4, platelet_count: 268,
  neutrophils: 58, lymphocytes: 32, monocytes: 6, eosinophils: 3, basophils: 1, rdw_cv: 12.8,
  // Lipids, consistent with each other: LDL = cholesterol - HDL - triglycerides / 5.
  cholesterol: 186, triglycerides: 132, hdl: 48, ldl: 111.6, vldl: 26.4, chol_hdl_ratio: 3.9,
  fbs: 88, first_hour: 152, second_hour: 118,
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

/** The clinic's laboratory form for a service, by its catalogue name, or null. */
const labFormFor = (testName) => LAB_FIELD_SETS.find((f) => f.tests.includes(testName)) || null;

/** A value the caller fixed, in either the plain or the old `{ value_1 }` shape. */
const plain = (v) => (v && typeof v === 'object' ? v.value_1 ?? v.value_text : v);

/**
 * The rows of a laboratory report, as the clinic's sheet prints them: label, result, unit and the
 * printed reference range, each under its section. `overrides` fixes a value, which is how an
 * abnormal result is written. [1.125.0] Rows rather than lines of text, because demoReportPdf.js
 * lays them out in the form's own TEST / RESULT / UNIT / REFERENCE RANGE columns.
 */
function labReportRows(form, sex, seed, overrides = {}) {
  const nudge = 1 + (((seed * 37) % 7) - 3) / 100;   // within ±3%, so no two reports match exactly
  const position = 0.35 + ((seed * 13) % 31) / 100;  // somewhere in the middle of a printed range
  const rows = [];
  for (const f of form.fields) {
    const code = f.code;
    let value = plain(overrides[code]);
    if (value === undefined && f.kind === 'text') {
      value = (form.name === 'Fecalysis' ? FECALYSIS[code] : undefined)
        ?? TEXT[code]
        ?? (code === 'blood_type' ? BLOOD_TYPES[seed % BLOOD_TYPES.length] : undefined);
    }
    if (value === undefined) {
      const known = NUMBERS[code];
      const base = known && typeof known === 'object' ? known[sex] : known;
      value = base === undefined
        ? withinRange(f.note, sex, position)
        : (EXACT.has(code) ? base : (base * nudge).toFixed(decimalsOf(base)));
    }
    if (value === null || value === undefined) continue;
    rows.push({ section: f.section || null, label: f.label, value: String(value), unit: f.unit || '', note: f.note || '' });
  }
  return rows;
}

/**
 * Who signs for a department, from the clinic's forms. X-ray is read by the clinic's radiologist,
 * whose caption reads RADIOLOGIST/SONOLOGIST; the forms name no separate X-ray signatory.
 */
const signatoriesFor = (category) => SIGNATORIES
  .filter((sig) => sig.category === (category === 'Xray' ? 'Ultrasound' : category))
  .sort((a, b) => a.order - b.order);

// Which written report an ultrasound service gets. These were the names of its typed form.
const ULTRASOUND_REPORT = {
  'HBT': 'Hepatobiliary Tree', 'Liver / Biliary Tree': 'Liver', 'Upper Abdomen': 'Upper Abdomen',
  'Whole Abdomen': 'Whole Abdomen', 'Lower Abdomen': 'Lower Abdomen', 'KUB / Prostate': 'KUB and Prostate',
  'Thyroid': 'Thyroid and Neck', 'Trans-vaginal (TVS)': 'Transvaginal', 'Pelvic Ultrasound': 'Pelvic',
  'Scrotum': 'Scrotum', 'BPS': 'Biophysical Profile', 'BPS w/ NST': 'Biophysical Profile with NST',
  'Chest Ultrasound': 'Chest', 'Transrectal': 'Transrectal',
};

// Written reports for imaging, ending in the impression the way the clinic's reports do.
const para = (...parts) => parts.filter(Boolean).join('\n\n');
const LIVER_NORMAL = 'The liver is normal in size with smooth borders and a homogeneous parenchymal echopattern. No focal lesion is seen. The intrahepatic ducts and the common bile duct are not dilated.';
const LIVER_FATTY = 'The liver is normal in size with smooth borders. The parenchymal echopattern is diffusely increased, with fair visualisation of the portal vein walls and the diaphragm. No focal lesion is seen. The bile ducts are not dilated.';
const GALLBLADDER = 'The gallbladder is adequately distended with a thin wall and no intraluminal echoes.';
const KIDNEYS = 'Both kidneys are normal in size and echopattern, with good corticomedullary differentiation. No calculi or hydronephrosis.';
const BLADDER = 'The urinary bladder is adequately filled with smooth walls and no intraluminal echoes.';

// Abnormal findings a real month brings, by variant. [1.125.0]
const GALLSTONES = 'The gallbladder is adequately distended. Multiple echogenic foci with posterior acoustic shadowing are seen within its lumen, the largest measuring 0.9 cm. The wall is not thickened.';
const KIDNEY_STONE = 'Both kidneys are normal in size. A 0.6 cm echogenic focus with posterior acoustic shadowing is seen in the lower pole of the right kidney. No hydronephrosis.';
const BIG_PROSTATE = 'The prostate gland is enlarged, measuring 4.8 x 4.1 x 3.9 cm with an estimated weight of 40 grams. Its echopattern is homogeneous, with no focal lesion.';

function imagingReport(test, sex, variant) {
  const name = ULTRASOUND_REPORT[test.name] || '';
  const liver = variant === 'fatty' ? LIVER_FATTY : LIVER_NORMAL;
  const gallbladder = variant === 'gallstones' ? GALLSTONES : GALLBLADDER;
  const kidneys = variant === 'kidneyStone' ? KIDNEY_STONE : KIDNEYS;
  const abdomenImpression = variant === 'fatty' ? 'MILD FATTY INFILTRATION OF THE LIVER.'
    : variant === 'gallstones' ? 'CHOLELITHIASIS.'
      : variant === 'kidneyStone' ? 'NEPHROLITHIASIS, RIGHT.' : null;
  switch (name) {
    case 'Chest':
      return para('No pleural effusion is seen on either side. The visualised lung bases show normal sliding with A-lines.',
        'No subpleural consolidation is seen.', 'IMPRESSION:\nNO PLEURAL EFFUSION.');
    case 'Transrectal':
      return para(variant === 'prostate' ? BIG_PROSTATE : 'The prostate gland is normal in size, measuring 3.6 x 3.0 x 2.8 cm, with a homogeneous echopattern. No focal lesion.',
        'The seminal vesicles are symmetric and unremarkable.',
        `IMPRESSION:\n${variant === 'prostate' ? 'PROSTATOMEGALY, ESTIMATED WEIGHT 40 GRAMS.' : 'NORMAL TRANSRECTAL ULTRASOUND OF THE PROSTATE.'}`);
    case 'Whole Abdomen':
      return para(liver, `${gallbladder} The pancreas and spleen are unremarkable.`, kidneys,
        sex === 'Male'
          ? `${BLADDER} The prostate gland is not enlarged and has a homogeneous echopattern.`
          : `${BLADDER} The uterus is normal in size. No adnexal mass is seen.`,
        `IMPRESSION:\n${abdomenImpression || 'NORMAL WHOLE ABDOMINAL ULTRASOUND.'}`);
    case 'Upper Abdomen':
      return para(liver, `${gallbladder} The pancreas and spleen are unremarkable.`, kidneys,
        `IMPRESSION:\n${abdomenImpression || 'NORMAL UPPER ABDOMINAL ULTRASOUND.'}`);
    case 'Hepatobiliary Tree':
    case 'Liver':
      return para(liver, `${gallbladder} The spleen is not enlarged.`,
        `IMPRESSION:\n${abdomenImpression || 'NORMAL HEPATOBILIARY ULTRASOUND.'}`);
    case 'Lower Abdomen':
      return para(KIDNEYS, BLADDER,
        sex === 'Male' ? 'The prostate gland is not enlarged.' : 'The uterus and cervix are normal in size and echopattern.',
        'IMPRESSION:\nNORMAL LOWER ABDOMINAL ULTRASOUND.');
    case 'KUB and Prostate':
      return para(kidneys, `${BLADDER} Post-void residual urine is not significant.`,
        sex === 'Male' ? (variant === 'prostate' ? BIG_PROSTATE : 'The prostate gland is not enlarged and has a homogeneous echopattern. No calcifications.') : null,
        `IMPRESSION:\n${variant === 'kidneyStone' ? 'NEPHROLITHIASIS, RIGHT.'
          : variant === 'prostate' && sex === 'Male' ? 'PROSTATOMEGALY, ESTIMATED WEIGHT 40 GRAMS.'
            : sex === 'Male' ? 'NORMAL KUB-PROSTATE ULTRASOUND.' : 'NORMAL KUB ULTRASOUND.'}`);
    case 'Thyroid and Neck':
      return variant === 'thyroidNodule'
        ? para('Both thyroid lobes are normal in size. A 0.8 x 0.6 cm well-defined, solid, hypoechoic nodule is seen in the right lobe, with no microcalcification. The left lobe and the isthmus are unremarkable.',
          'No enlarged cervical lymph nodes.', 'IMPRESSION:\nSOLITARY NODULE, RIGHT THYROID LOBE (TI-RADS 3). Suggest follow-up ultrasound in 12 months.')
        : para('Both thyroid lobes are normal in size with a homogeneous echopattern. No nodule or cyst is seen. The isthmus is not thickened.',
          'No enlarged cervical lymph nodes.', 'IMPRESSION:\nNORMAL THYROID ULTRASOUND.');
    case 'Pelvic':
    case 'Transvaginal':
      if (variant === 'pregnancy') {
        return para('A single gestational sac is seen within the uterine cavity, containing a live embryo with cardiac activity of 152 beats per minute.',
          'The crown-rump length measures 2.1 cm, corresponding to 8 weeks and 6 days age of gestation. No subchorionic haemorrhage. Both ovaries are unremarkable.',
          'IMPRESSION:\nSINGLE LIVE INTRAUTERINE PREGNANCY, 8 WEEKS 6 DAYS AGE OF GESTATION BY CRL.');
      }
      if (variant === 'pregnancy2') {
        return para('Single live intrauterine pregnancy in cephalic presentation. The fetal heart rate is 148 beats per minute.',
          'The biparietal diameter and femur length correspond to 20 weeks 3 days age of gestation. The placenta is posterior, grade I, with no previa. The amniotic fluid is adequate.',
          'IMPRESSION:\nSINGLE LIVE INTRAUTERINE PREGNANCY, CEPHALIC, 20 WEEKS 3 DAYS AGE OF GESTATION BY FETAL BIOMETRY.');
      }
      if (variant === 'myoma') {
        return para('The uterus is anteverted and enlarged, with a 3.2 x 2.8 cm well-defined hypoechoic mass in the posterior myometrium. The endometrium is regular.',
          'Both ovaries are normal in size and appearance. No free fluid in the cul-de-sac.',
          'IMPRESSION:\nUTERINE MYOMA, INTRAMURAL, POSTERIOR.');
      }
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
  if (/apico/i.test(test.name)) {
    return para('The lung apices are clear. No apical density or cavity is seen.',
      'The visualised bony structures are intact.', 'IMPRESSION:\nNEGATIVE APICO-LORDOTIC VIEW.');
  }
  if (/spine|lumb|cervical|thorac/i.test(test.name)) {
    return variant === 'spondylosis'
      ? para('Marginal osteophytes are seen along the anterior vertebral bodies. The disc spaces are preserved. The pedicles are intact.',
        'No compression deformity or listhesis.', 'IMPRESSION:\nSPONDYLOSIS.')
      : para('The vertebral bodies are normal in height and alignment. The disc spaces are preserved. The pedicles are intact.',
        'No fracture or listhesis.', 'IMPRESSION:\nNORMAL SPINE.');
  }
  if (/knee/i.test(test.name)) {
    return variant === 'osteoarthritis'
      ? para('Narrowing of the medial joint space with marginal osteophytes and subchondral sclerosis. No fracture or dislocation.',
        'The soft tissues are unremarkable.', 'IMPRESSION:\nDEGENERATIVE OSTEOARTHRITIS OF THE KNEE.')
      : para('The bones of the knee are intact. The joint spaces are preserved. No fracture or dislocation.',
        'IMPRESSION:\nNORMAL KNEE.');
  }
  if (/sinus|waters|pns/i.test(test.name)) {
    return variant === 'sinusitis'
      ? para('Haziness with mucosal thickening is seen in both maxillary sinuses. The frontal and ethmoid sinuses are clear. The nasal septum is midline.',
        'IMPRESSION:\nBILATERAL MAXILLARY SINUSITIS.')
      : para('The paranasal sinuses are well aerated. The nasal septum is midline.', 'IMPRESSION:\nNORMAL PARANASAL SINUSES.');
  }
  if (/abdomen/i.test(test.name)) {
    return para('The bowel gas pattern is nonspecific. No dilated bowel loops or air-fluid levels. No free air under the hemidiaphragms.',
      'The psoas shadows and the visualised bones are unremarkable.', 'IMPRESSION:\nNONSPECIFIC BOWEL GAS PATTERN.');
  }
  if (/chest/i.test(test.name)) {
    if (variant === 'cardiomegaly') {
      return para('The lung fields are clear. The cardiac silhouette is enlarged, with a cardiothoracic ratio of 0.58.',
        'The hemidiaphragms and the costophrenic sulci are intact. Atheromatous aorta.',
        'IMPRESSION:\nCARDIOMEGALY. ATHEROMATOUS AORTA.');
    }
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

// The same, as multipart: `fields` are strings (an array value repeats as `name[]`), `files` are
// { field: { name, type, buffer } }. A patient's booking carries the doctor's request. [1.106.0]
const callMultipart = async (path, { token, fields = {}, files = {} }) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => form.append(`${name}[]`, String(v)));
    else if (value !== undefined && value !== null) form.append(name, String(value));
  }
  for (const [name, file] of Object.entries(files)) {
    form.append(name, new Blob([file.buffer], { type: file.type }), file.name);
  }
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${json.message || text.slice(0, 140)}`);
  return json;
};

/**
 * A doctor's request for a demo booking, as a one-page PDF. [1.106.0]
 *
 * Every online booking carries one now, and the seed books online as the demo patient. Written
 * out by hand because the backend has no PDF library and this needs nothing but lines of text in
 * Helvetica: a valid file with a correct xref, which every browser's viewer opens. The doctor and
 * the licence number are invented, like every person the seed creates.
 */
function doctorRequestPdf({ patientName, testName, date }) {
  const lines = [
    'Dr. Ramon C. Villanueva, MD',
    'Internal Medicine - Clinic Hours Mon-Sat 9:00-3:00',
    'Bugo, Cagayan de Oro City',
    '',
    `Name: ${patientName}`,
    `Date: ${date}`,
    '',
    'Rx: Please do the following:',
    `    ${testName}`,
    '',
    'Clinical impression: routine check-up, for evaluation',
    '',
    '',
    '______________________________',
    'Ramon C. Villanueva, MD',
    'PRC Lic. No. 0098213',
  ];
  const esc = (s) => String(s).replace(/[\\()]/g, (c) => `\\${c}`);
  const content = ['BT', '/F1 11 Tf', '40 540 Td', '15 TL', ...lines.map((l, i) => `${i ? 'T* ' : ''}(${esc(l)}) Tj`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

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
      records.set(key, { patient, sex, seed: i + 1, birthdate });
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
  const packages = (await call('/packages')).data.packages || [];
  const makeVisit = async ({
    person, category, test, tests: wanted = null, packageCodes = [], patientTypeName = 'Self Pay',
    referrerIndex = null, notes = '', date = null,
  }) => {
    const { patient, sex, seed, birthdate } = await patientFor(person, patientTypeName);

    // 'Private' and HMO both require one, so those callers must supply an index.
    const referrer = referrerIndex === null ? null : pick(REFERRERS, referrerIndex);

    // [1.125.0] Several tests on one visit, and package deals, the way people actually come in: a
    // pre-employment panel is four tests, an annual physical eight.
    const chosen = (wanted || (category ? [[category, test]] : []))
      .map(([c, t]) => (t && typeof t === 'object' && t.id ? t : findTest(c, t)));
    const packageIds = packageCodes.map((code) => packages.find((pk) => pk.code === code)?.id).filter(Boolean);

    // [1.129.0] A visit carries its tests from the start: one request, one transaction.
    const visit = (await call('/visits', {
      method: 'POST', token: tok.receptionist,
      body: {
        patientId: patient.id, visitType: 'Walk in', notes,
        referringPhysician: referrer?.[0], referringPhysicianPrc: referrer?.[1],
        testIds: [...new Set(chosen.map((t) => t.id))], packageIds,
      },
    })).data.visit;
    const attached = (await call(`/tests/visit-tests/${visit.id}`, { token: tok.receptionist })).data.visitTests;
    const items = attached.map((vt) => {
      const t = tests.find((x) => x.id === vt.test_id);
      return { visitTestId: vt.id, test: t, category: offered(t.category_name) };
    });
    const first = items.find((it) => chosen[0] && it.test.id === chosen[0].id) || items[0];

    return {
      patient, sex, seed, birthdate, visit, items, referrer, patientTypeName, date,
      test: first.test, visitTestId: first.visitTestId, category: first.category,
      price: attached.reduce((sum, vt) => sum + parseFloat(vt.price_at_time), 0),
    };
  };

  const payFor = async (v, method = 'Cash') => {
    const bill = (await call(`/payments/bill/${v.visit.id}`, { token: tok.cashier })).data.bill;
    return (await call('/payments', {
      method: 'POST', token: tok.cashier,
      body: { patientVisitId: v.visit.id, paymentMethod: method, amount: parseFloat(bill.totalAmount) },
    })).data.payment;
  };

  // How the clinic's form names a patient's type. [1.125.0]
  const FORM_PATIENT_TYPE = { 'Self Pay': 'WALK-IN', HMO: 'HMO', Private: 'PRIVATE' };

  /** "IMPRESSION:\n..." split off the written report, for the form's own Impression block. */
  const splitImpression = (text) => {
    const at = String(text || '').lastIndexOf('IMPRESSION:');
    return at < 0 ? [String(text || ''), ''] : [text.slice(0, at).trim(), text.slice(at + 'IMPRESSION:'.length).trim()];
  };

  /**
   * The report a department attaches, on the clinic's form. [1.125.0] A laboratory service prints
   * its sheet's rows; imaging prints the written report and its impression. `comment` fills the
   * form's Comment line.
   */
  const reportPdf = (v, { text, values, comment, date } = {}) => {
    const form = v.category === 'Laboratory' ? labFormFor(v.test.name) : null;
    const imaging = v.category === 'Ultrasound' || v.category === 'Xray';
    const [body, impression] = imaging ? splitImpression(text) : ['', ''];
    const exam = v.category === 'Ultrasound'
      ? `${(ULTRASOUND_REPORT[v.test.name] || v.test.name)} ultrasound`
      : v.test.name;
    return renderClinicReport({
      patient: { name: `${v.patient.last_name}, ${v.patient.first_name}`, birthdate: v.birthdate, sex: v.sex },
      date: date || v.date || new Date(),
      patientType: FORM_PATIENT_TYPE[v.patientTypeName] || 'WALK-IN',
      physician: v.referrer?.[0] || '',
      lab: form
        ? { discipline: form.discipline, title: form.name, rows: labReportRows(form, v.sex, v.seed * 31 + (v.visit.id % 97), values) }
        : null,
      narrative: imaging ? { title: v.category === 'Xray' ? 'RADIOGRAPHIC REPORT' : 'ULTRASOUND REPORT', exam, body, impression } : null,
      comment: form ? (comment ?? text ?? '') : (comment || ''),
      signatories: signatoriesFor(v.category),
    });
  };

  const postResult = async (v, form) => {
    const res = await fetch(`${API}/results/${v.visitTestId}`, {
      method: 'POST', headers: { Authorization: `Bearer ${modalityToken[v.category]}` }, body: form,
    });
    if (!res.ok) throw new Error(`record findings -> ${res.status} ${(await res.text()).slice(0, 160)}`);
    return (await res.json()).data.result;
  };

  /**
   * Records a result the way the department would: the report document attached, and for imaging
   * the written report as its findings. `values` fixes laboratory values, `variant` picks an
   * abnormal imaging report, and `findings` replaces the written text entirely.
   */
  const recordFindings = async (v, { findings, values, variant, remarks } = {}) => {
    const imaging = v.category === 'Ultrasound' || v.category === 'Xray';
    const hasForm = v.category === 'Laboratory' && labFormFor(v.test.name);
    const text = findings ?? (imaging ? imagingReport(v.test, v.sex, variant) : (hasForm ? '' : 'Within normal limits.'));

    const body = new FormData();
    if (text) body.append('findings', text);
    if (remarks) body.append('remarks', remarks);
    // Every result carries its report, not only the imaging ones. [1.94.0]
    //
    // This attached a PDF for Ultrasound and X-ray and left Laboratory with findings text alone,
    // which was right while findings WERE the report. A release now requires the document, so the
    // old shape would have stopped the seeder dead on the first laboratory visit — and, worse for
    // a demo, shown the clinic a system where half the results have nothing to open.
    const pdf = await reportPdf(v, { text, values });
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
    // A corrected result carries a CORRECTED document. [1.94.0] Without this the amendment would
    // inherit the original file and the demo would show an "amendment" whose report is identical
    // to the one it replaced — which is exactly the empty-amendment problem the clinic should not
    // be shown, and which the real workflow avoids by attaching the new report.
    const pdf = await reportPdf(v, { text: findings, values, comment: v.category === 'Laboratory' ? findings : remarks });
    body.append(
      'file',
      new Blob([pdf], { type: 'application/pdf' }),
      `${v.category.toLowerCase()}-report-${v.patient.last_name.toLowerCase().replace(/\s+/g, '-')}-corrected.pdf`
    );
    return postResult(v, body);
  };

  const release = async (v) =>
    (await call(`/results/${v.visitTestId}/release`, { method: 'POST', token: modalityToken[v.category] })).data.result;

  // X-ray gives its results through its own system [1.129.0]: its exam is marked done, never reported here.
  const NO_REPORT = new Set(['Xray']);
  const markDone = async (v) =>
    call(`/results/test-status/${v.visitTestId}`, {
      method: 'PATCH', token: modalityToken[v.category], body: { status: 'Completed' },
    });

  /** Every test on a visit resulted by its own department; `byTest` holds options per test name. */
  const recordVisit = async (v, byTest = {}) => {
    for (const item of v.items) {
      if (!NO_REPORT.has(item.category)) await recordFindings({ ...v, ...item }, byTest[item.test.name] || {});
    }
  };
  const releaseVisit = async (v) => {
    for (const item of v.items) {
      if (NO_REPORT.has(item.category)) await markDone({ ...v, ...item });
      else await release({ ...v, ...item });
    }
  };

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

  // 2. A chest X-ray, done. [1.129.0] X-ray results are given by the X-ray department's own
  // system, so the exam is marked done on its worklist and no report is kept here.
  {
    const v = await makeVisit({ person: TODAY_POOL.borja, category: 'Xray', test: /chest/i, referrerIndex: 2, notes: 'Cough for two weeks' });
    await payFor(v, 'GCash');
    await markDone(v);
    today.push({ ...v, stage: 'released' });
    note(v, 'chest X-ray done (the result comes from the X-ray department)');
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
      values: { cholesterol: 186 },
      reason: 'Cholesterol transcribed as 286; corrected to 186 against the analyser printout',
    });
    await release(v);
    today.push({ ...v, stage: 'released' });
    note(v, 'AMENDED lipid profile (v2), released');
  }

  // 3. A markedly abnormal result, released. The clinic does not call panic values back — the
  // reference range printed beside the figure is what flags it, and the report goes to the
  // doctor who asked for the test.
  {
    // Names a referrer, which is the point of the scenario: a result this far out of range is
    // read by the requesting physician, so that field has to be populated.
    const v = await makeVisit({ person: TODAY_POOL.velez, category: 'Laboratory', test: 'Fasting Blood Sugar (FBS)', referrerIndex: 0, notes: 'Known diabetic, missed medicines' });
    await payFor(v, 'Cash');
    await recordFindings(v, {
      values: { fbs: 452 },
      findings: 'Markedly elevated fasting blood sugar. A repeat run on the same specimen confirms the value. For physician review.',
    });
    await release(v);
    today.push({ ...v, stage: 'released' });
    note(v, 'markedly high fasting blood sugar released to the referring physician');
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

  // ── HISTORY: two months of finished visits, then backdated [1.125.0] ─────────────────────
  // Without this the revenue trend, staff workload and every date-range report are empty, which
  // reads as broken rather than new. About sixty people over sixty days, one to four visits a day,
  // each visit a mix the clinic really sees, about one in six with something out of range.
  const historical = [];
  // The database's own clock, so the notifications this history raises can be found again below.
  const historyStartedAt = (await db.query('SELECT clock_timestamp() AS t')).rows[0].t;
  const L = (name) => ['Laboratory', name];
  const CBC = L('Complete Blood Count (CBC)');
  const UA = L('Urinalysis');
  const FBS = L('Fasting Blood Sugar (FBS)');
  const LIPID = L('Lipid Profile');
  const CREA = L('Creatinine');
  const BUA = L('Blood Uric Acid (BUA)');
  const SGPT = L('SGPT');
  const ageOf = (birthdate) => {
    const b = new Date(`${birthdate}T12:00:00`);
    const now = new Date();
    return now.getFullYear() - b.getFullYear() - (now < new Date(now.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
  };
  // Why people come, what they are sent for, and who it suits. `sick` is the version of the visit
  // with something out of range, keyed by test name.
  const VISIT_KINDS = [
    { weight: 2, notes: 'Pre-employment requirement', tests: [CBC, UA, L('Stool Exam'), ['Xray', 'Chest PA']], fits: (a) => a >= 18 && a <= 45,
      sick: { 'Stool Exam': { values: { ova_of_parasites: 'ASCARIS LUMBRICOIDES 1-2', consistency: 'SOFT' } } } },
    { weight: 1, notes: 'Annual physical exam', tests: [CBC, FBS, LIPID, CREA, BUA, SGPT, UA, ['Xray', 'Chest PA']], fits: (a) => a >= 30,
      sick: { 'Lipid Profile': { values: { cholesterol: 252, triglycerides: 205, hdl: 40, ldl: 171.0, vldl: 41.0, chol_hdl_ratio: 6.3 } },
        'Chest PA': { variant: 'cardiomegaly' } } },
    { weight: 2, notes: 'Diabetic, maintenance follow-up', tests: [FBS, L('HbA1c'), CREA], fits: (a) => a >= 40, referred: true,
      sick: { 'Fasting Blood Sugar (FBS)': { values: { fbs: 162 } }, HbA1c: { values: { hba1c: 7.9 } } } },
    { weight: 2, notes: 'Hypertensive, routine monitoring', tests: [LIPID, FBS, CREA, BUA], fits: (a) => a >= 40, referred: true,
      sick: { 'Lipid Profile': { values: { cholesterol: 268, triglycerides: 221, hdl: 38, ldl: 185.8, vldl: 44.2, chol_hdl_ratio: 7.1 } },
        'Blood Uric Acid (BUA)': { values: { bua: 8.3 } } } },
    { weight: 2, notes: 'Painful urination', tests: [UA, CBC], fits: () => true,
      sick: { Urinalysis: { values: { appearance: 'TURBID', protein: 'TRACE', wbc: '15-20', rbc: '2-4', bacteria: 'MANY', epithelial_cells: 'MODERATE' } },
        'Complete Blood Count (CBC)': { values: { wbc: 12.6, neutrophils: 74, lymphocytes: 18, monocytes: 5, eosinophils: 2, basophils: 1 } } } },
    { weight: 1, notes: 'Fever for three days', tests: [CBC, L('Clotting Time / Bleeding Time (CT BT)')], fits: () => true, referred: true,
      sick: { 'Complete Blood Count (CBC)': { values: { wbc: 3.6, platelet_count: 96, neutrophils: 42, lymphocytes: 48, monocytes: 7, eosinophils: 2, basophils: 1 } } } },
    { weight: 2, notes: 'Neck swelling, for evaluation', tests: [L('TSH'), L('FT4'), ['Ultrasound', 'Thyroid']], fits: (a) => a >= 20, referred: true,
      sick: { TSH: { values: { tsh: 6.9 } }, FT4: { values: { ft4: 10.4 } }, Thyroid: { variant: 'thyroidNodule' } } },
    { weight: 4, notes: 'Upper abdominal pain on and off', tests: [['Ultrasound', 'Whole Abdomen']], fits: () => true,
      sick: { 'Whole Abdomen': { variant: 'fatty' } } },
    { weight: 3, notes: 'Right upper quadrant pain after fatty meals', tests: [['Ultrasound', 'HBT'], SGPT], fits: (a) => a >= 25,
      sick: { HBT: { variant: 'gallstones' }, SGPT: { values: { sgpt_alt: 68 } } } },
    { weight: 3, notes: 'Flank pain', tests: [['Ultrasound', 'KUB / Prostate'], UA, CREA], fits: () => true, referred: true,
      sick: { 'KUB / Prostate': { variant: 'kidneyStone' }, Urinalysis: { values: { rbc: '10-15' } } } },
    { weight: 3, notes: 'Prenatal check-up', packages: ['A'], fits: (a, sex) => sex === 'Female' && a >= 19 && a <= 38, referred: true,
      always: { 'Pelvic Ultrasound': { variant: 'pregnancy2' } } },
    { weight: 2, notes: 'Missed period, for confirmation', tests: [['Ultrasound', 'Trans-vaginal (TVS)'], CBC, UA], fits: (a, sex) => sex === 'Female' && a >= 19 && a <= 40, referred: true,
      always: { 'Trans-vaginal (TVS)': { variant: 'pregnancy' } } },
    { weight: 3, notes: 'Irregular menstruation', tests: [['Ultrasound', 'Pelvic Ultrasound']], fits: (a, sex) => sex === 'Female' && a >= 20 && a <= 55,
      sick: { 'Pelvic Ultrasound': { variant: 'myoma' } } },
    { weight: 1, notes: 'Low back pain', tests: [['Xray', 'Lumbo-Sacral APL (LS)']], fits: (a) => a >= 35,
      sick: { 'Lumbo-Sacral APL (LS)': { variant: 'spondylosis' } } },
    { weight: 1, notes: 'Knee pain on walking', tests: [['Xray', 'Knee APL'], BUA], fits: (a) => a >= 45,
      sick: { 'Knee APL': { variant: 'osteoarthritis' }, 'Blood Uric Acid (BUA)': { values: { bua: 7.9 } } } },
    { weight: 1, notes: 'Recurring headache and colds', tests: [['Xray', 'Paranasal Sinuses (PNS)']], fits: () => true,
      sick: { 'Paranasal Sinuses (PNS)': { variant: 'sinusitis' } } },
    { weight: 2, notes: 'Cough for two weeks', tests: [['Xray', 'Chest PA'], CBC], fits: () => true, referred: true,
      sick: { 'Chest PA': { variant: 'pneumonia' } } },
    { weight: 2, notes: 'Frequent urination at night', tests: [['Ultrasound', 'KUB / Prostate'], UA], fits: (a, sex) => sex === 'Male' && a >= 50, referred: true,
      sick: { 'KUB / Prostate': { variant: 'prostate' } } },
    { weight: 1, notes: 'Health certificate requirement', tests: [L('Hepatitis B Screening'), L('HIV Screening'), L('VDRL / Syphilis')], fits: (a) => a >= 18 && a <= 50 },
    { weight: 1, notes: 'Blood donation screening', tests: [L('Blood Typing'), CBC], fits: (a) => a >= 18 && a <= 55 },
    { weight: 2, notes: 'Epigastric pain and bloating', tests: [['Ultrasound', 'Upper Abdomen']], fits: (a) => a >= 18,
      sick: { 'Upper Abdomen': { variant: 'gallstones' } } },
    { weight: 2, notes: '33 weeks pregnant, fetal well-being', tests: [['Ultrasound', 'BPS']], fits: (a, sex) => sex === 'Female' && a >= 19 && a <= 38, referred: true },
    { weight: 1, notes: 'Painless scrotal swelling', tests: [['Ultrasound', 'Scrotum']], fits: (a, sex) => sex === 'Male' && a >= 15 },
  ].filter((kind) => (kind.tests || []).every(([c]) => OFFERED.includes(c)));

  // A deck with each kind as many times as its weight, walked with a stride coprime to its length
  // so every card is reached. Stepping 5 through 20 kinds reached only four of them, which made the
  // history mostly annual physicals and chest X-rays at an ultrasound clinic. [1.125.0]
  const KIND_DECK = VISIT_KINDS.flatMap((kd) => Array(kd.weight || 1).fill(kd));
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const STRIDE = [11, 13, 17, 19, 23, 29].find((n) => gcd(n, KIND_DECK.length) === 1);

  const providers = (await call('/hmo/providers', { token: tok.receptionist })).data.providers;
  const HISTORY_DAYS = 60;
  const VISITS_PER_DAY = [2, 3, 1, 3, 2, 4, 2, 3, 1, 2];
  let k = 0;
  for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
    // The clinic is closed on Sundays and shuts at noon on Saturdays, so the history keeps to the
    // days and hours it is open. [1.90.0]
    const day = new Date();
    day.setDate(day.getDate() - daysAgo);
    const weekday = day.getDay();
    if (weekday === 0) continue;
    const perDay = weekday === 6 ? Math.min(2, VISITS_PER_DAY[daysAgo % 10]) : VISITS_PER_DAY[daysAgo % 10];
    for (let i = 0; i < perDay; i++, k++) {
      // Stride 7 through the pool: everyone is seen before anyone returns, about a month apart.
      const person = HISTORY_POOL[(k * 7) % HISTORY_POOL.length];
      const age = ageOf(person[3]);
      const start = (k * STRIDE) % KIND_DECK.length;
      const kind = [...KIND_DECK.slice(start), ...KIND_DECK.slice(0, start)].find((kd) => kd.fits(age, person[2]));
      const sick = (k * 7) % 6 === 0;
      // One member in eight carries HMO cover; their visits are claimed and approved before the till.
      const hmoMember = ((k * 7) % HISTORY_POOL.length) % 8 === 3 && providers.length > 0;
      const referred = hmoMember || kind.referred || k % 3 === 0;

      const v = await makeVisit({
        person, tests: kind.tests || [], packageCodes: kind.packages || [],
        patientTypeName: hmoMember ? 'HMO' : 'Self Pay', referrerIndex: referred ? k : null,
        notes: kind.notes, date: day,
      });

      if (hmoMember) {
        const claim = (await call('/hmo/request', {
          method: 'POST', token: tok.receptionist,
          body: { hmoProviderId: providers[0].id, memberNumber: `1CH-${String(204310 + k * 37).padStart(7, '0')}`, visitTestIds: v.items.map((it) => it.visitTestId) },
        })).data;
        const claimId = claim.request?.id || claim.hmoRequest?.id;
        await call(`/hmo/request/${claimId}/approve`, {
          method: 'PUT', token: tok.admin, body: { approvalCode: `LOA-${day.getFullYear()}-${String(31000 + k * 13)}` },
        });
      } else if (age >= 60 && senior && k % 2 === 0) {
        // Statutory discounts for the seniors, so the BIR register has months behind it.
        await call(`/discounts/visit/${v.visit.id}`, {
          method: 'POST', token: tok.cashier, body: { discountTypeId: senior.id, idNumber: `OSCA-04${String(10000 + k * 97).slice(-5)}` },
        });
      } else if (pwd && k % 23 === 11) {
        await call(`/discounts/visit/${v.visit.id}`, {
          method: 'POST', token: tok.cashier, body: { discountTypeId: pwd.id, idNumber: `PWD-10-4305-${String(1000 + k * 7).padStart(7, '0')}` },
        });
      }

      await payFor(v, k % 4 === 1 ? 'GCash' : k % 9 === 0 ? 'Bank' : CASH_METHOD);
      await recordVisit(v, { ...(kind.always || {}), ...(sick ? (kind.sick || {}) : {}) });
      await releaseVisit(v);
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
          WHERE visit_test_id IN (SELECT id FROM visit_tests WHERE patient_visit_id = $1)`,
        [h.visit.id, shift, arrival, waitToPay + releaseAfter]
      );
      // An X-ray exam marked done [1.129.0], at the time its report would have been released.
      await db.query(
        `UPDATE visit_tests
            SET performed_at = (CURRENT_DATE - $2::interval) + make_interval(hours => $3, mins => $4)
          WHERE patient_visit_id = $1 AND performed_at IS NOT NULL`,
        [h.visit.id, shift, arrival, waitToPay + releaseAfter]
      );
      // An HMO claim is filed at the desk and approved before the patient reaches the till.
      await db.query(
        `UPDATE hmo_requests
            SET created_at    = (CURRENT_DATE - $2::interval) + make_interval(hours => $3, mins => 1),
                approved_date = (CURRENT_DATE - $2::interval) + make_interval(hours => $3, mins => 3)
          WHERE id IN (SELECT hrt.hmo_request_id FROM hmo_request_tests hrt
                         JOIN visit_tests vt ON vt.id = hrt.visit_test_id
                        WHERE vt.patient_visit_id = $1)`,
        [h.visit.id, shift, arrival]
      );
    }
  });

  // The staff were told about all of this weeks ago, as it happened. [1.125.0] Raised now, two
  // months of payments, releases and HMO approvals sat unread on every bell (99+), which no clinic
  // opens its morning to. Today's notifications stay.
  await db.query(
    'DELETE FROM notification_reads WHERE event_id IN (SELECT id FROM notification_events WHERE created_at >= $1)',
    [historyStartedAt]
  );
  await db.query('DELETE FROM notification_events WHERE created_at >= $1', [historyStartedAt]);

  // ── Patient feedback [1.112.0] ────────────────────────────────────────────────────────────
  // The paper forms reception typed in for the fortnight's walk-ins, as the clinic's own form
  // reads: mostly MAAYO, a few OKAY LANG, and two DILI MAAYO worth following up. Comments are
  // what patients write on the slip, in Cebuano. One patient left the name blank. Ratings are in
  // question order; null leaves that row unticked, as patients do.
  const FEEDBACK = [
    { ratings: [3, 3, 3, 3], comment: 'Salamat kaayo, paspas ang serbisyo ug buotan ang mga staff.' },
    { ratings: [3, 2, 3, 3], comment: 'Medyo dugay ang result sa ultrasound pero okay ra.' },
    { ratings: [3, 3, 3, 2], comment: 'Limpyo ang clinic. Ang CR lang kulang ug tissue.' },
    { ratings: [3, 3, 3, 3], comment: null },
    { ratings: [2, 3, 3, 1], comment: 'Walay tubig sa CR pag-abot nako sa buntag.' },
    { ratings: [3, 3, 3, 3], comment: 'Very accommodating ang receptionist. Thank you!' },
    { ratings: [3, 3, 2, null], comment: 'Init kaayo sa waiting area, dugangan unta ug electric fan.', nameHidden: true },
    { ratings: [3, 1, 3, 3], comment: 'Na-delay ug usa ka adlaw ang akong result.' },
    { ratings: [3, 3, 3, 3], comment: 'Maayo kaayo ang pag-atiman sa akong mama.' },
    { ratings: [3, 3, 3, 3], comment: 'Klaro kaayo ang pag-explain sa sonologist.' },
    { ratings: [3, 2, 3, 3], comment: 'Taas ang pila sa buntag pero dali ra ang result.' },
    { ratings: [3, 3, 3, 3], comment: null, nameHidden: true },
    { ratings: [2, 3, 3, 3], comment: 'Sana mas daghan pa ang lingkuranan sa waiting area.' },
    { ratings: [3, 3, 3, 3], comment: 'Nindot ang serbisyo, mobalik ko diri.' },
    { ratings: [3, 3, 2, 3], comment: 'Okay ra tanan, medyo init lang.' },
    { ratings: [3, 3, 3, 3], comment: 'Thank you sa pag-assist sa akong lolo.' },
    { ratings: [1, 3, 3, 3], comment: 'Dugay ko na-entertain sa counter.' },
    { ratings: [3, 3, 3, 3], comment: 'Paspas ang X-ray ug buotan ang radtech.' },
  ];
  const feedbackQuestions = (await call('/feedback/questions', { token: tok.receptionist })).data.questions;
  const rated = historical.filter((_, i) => i % 3 !== 2).slice(0, FEEDBACK.length);
  for (const [i, h] of rated.entries()) {
    const f = FEEDBACK[i];
    const answers = Object.fromEntries(
      feedbackQuestions.map((q, n) => [q.id, f.ratings[n]]).filter(([, rating]) => rating)
    );
    await call(`/feedback/visits/${h.visit.id}/paper`, {
      method: 'POST', token: tok.receptionist,
      body: { answers, comment: f.comment, language: 'ceb', nameHidden: Boolean(f.nameHidden) },
    });
  }
  // Handed back at the end of the visit, so typed in that afternoon rather than today.
  await db.query(
    `UPDATE patient_visits SET feedback_submitted_at = created_at + INTERVAL '3 hours'
      WHERE id = ANY($1::int[])`,
    [rated.map((h) => h.visit.id)]
  );

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
    try {
      // Two bookings, because the booking has two states worth seeing side by side: one still to
      // be paid (payment first: it holds its slot for the payment window, then is released) and
      // one already settled online, with its QR pass.
      const bookings = [
        { label: 'waiting to be paid (its slot is held for the payment window)', pay: false },
        { label: 'prepaid', pay: true },
      ];
      // Deliberately a test that NEEDS preparation — a Fasting Blood Sugar if the catalogue has
      // one. It was Laboratory[0], which is a CBC and needs nothing, so the seeded booking
      // showed no preparation note anywhere and the feature was invisible in a demo. FBS is
      // also the honest example: it is exactly the test somebody books online and then forgets
      // to fast for.
      const labTest = catalogue.Laboratory.find((t) => t.preparation) || catalogue.Laboratory[0];
      // On the next two open days, so the two passes read as two visits rather than one day's.
      let offset = 2;
      for (const plan of bookings) {
        let slotDate = null;
        let slots = [];
        for (let tries = 0; !slots.length && tries < 7; tries++, offset++) {
          slotDate = nextDay(new Date(), offset);
          slots = await openSlots(slotDate, client);
        }
        if (!slots.length) break;
        // [1.106.0] A patient's booking carries the doctor's signed request, which names the test.
        const booking = (await callMultipart('/appointments', {
          token: client,
          // The test goes with the booking: a booking with none is refused. [1.124.0]
          fields: { patientId: profiles[0].id, scheduledDate: dateStr(slotDate), scheduledTime: slots[0], testIds: [labTest.id] },
          files: {
            doctorRequest: {
              name: 'doctor-request.pdf',
              type: 'application/pdf',
              buffer: doctorRequestPdf({
                patientName: `${profiles[0].first_name} ${profiles[0].last_name}`,
                testName: labTest.name,
                date: dateStr(new Date()),
              }),
            },
          },
        })).data.appointment;
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

  // The front desk books ahead for patients at the counter, who pay there and then [1.132.0]. Two
  // of them later TODAY when the day still has room, so the Desk has bookings to check in; the
  // rest over the next working days.
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
      const booked = b.tests.map((t) => findTest(t instanceof RegExp ? 'Xray' : (/Abdomen|Pelvic|KUB|Trans/.test(t) ? 'Ultrasound' : 'Laboratory'), t));
      const amount = booked.reduce((sum, t) => sum + parseFloat(t.price), 0);
      await call('/appointments', {
        method: 'POST', token: tok.desk,
        body: {
          patientId: patient.id, scheduledDate: dateStr(date), scheduledTime: time, notes: b.notes,
          testIds: booked.map((t) => t.id),
          payment: { paymentMethod: i % 3 === 2 ? 'GCash' : 'Cash', amount },
        },
      });
      stages.push(`${b.person[0]} ${b.person[1]} — booked for ${dateStr(date)} ${time.slice(0, 5)} at the front desk, paid`);
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
      (SELECT COUNT(*)::int FROM test_results WHERE version > 1) AS amended,
      (SELECT COUNT(*)::int FROM appointments) AS appointments,
      (SELECT COUNT(*)::int FROM patient_visits WHERE feedback_submitted_at IS NOT NULL) AS feedback
  `);
  const c = counts.rows[0];

  logger.info('');
  logger.info("Today's workflow:");
  for (const line of stages) logger.info(`   • ${line}`);
  logger.info('');
  logger.info(`   patients            ${c.patients}`);
  logger.info(`   visits today        ${c.visits_today}   (${c.visits_total} including 60 days of history)`);
  logger.info(`   paid today          ${c.paid_today}   —  PHP ${c.revenue_today}`);
  logger.info(`   amended results     ${c.amended}`);
  logger.info(`   appointments        ${c.appointments}`);
  logger.info(`   feedback forms      ${c.feedback}`);
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
        await db.query('UPDATE visit_tests SET performed_at = $2 WHERE id = $1 AND performed_at IS NOT NULL', [v.visitTestId, reported]);
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
