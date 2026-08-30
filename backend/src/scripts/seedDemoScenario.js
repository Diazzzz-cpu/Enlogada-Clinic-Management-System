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
 * Why this matters day to day: every "today" screen — the active queue, today's collections, the
 * modality worklists — filters on the current date. Seed on Monday and demo on Tuesday and they
 * are all legitimately empty. Re-run this before a demo; it is idempotent in the sense that it
 * only ever adds, so pair it with `resetDemoData.js --confirm` for a clean slate.
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

// Filipino names, because a demo full of "Test Patient 1" tells you nothing about how the screens
// read with real data — column widths, truncation and sort order all behave differently.
const PEOPLE = [
  ['Maria', 'Delacruz', 'Female', '1958-03-12'], ['Jose', 'Ramirez', 'Male', '1972-07-04'],
  ['Ana', 'Bautista', 'Female', '1990-11-23'],   ['Ramon', 'Villanueva', 'Male', '1965-01-30'],
  ['Liwayway', 'Manalo', 'Female', '1948-09-17'],['Andres', 'Bonifacio', 'Male', '1983-05-08'],
  ['Corazon', 'Aquino', 'Female', '1954-01-25'], ['Emilio', 'Aguinaldo', 'Male', '1995-03-22'],
  ['Josefa', 'Llanes', 'Female', '1961-12-02'],  ['Apolinario', 'Mabini', 'Male', '1977-06-14'],
  ['Gabriela', 'Silang', 'Female', '1988-08-19'],['Melchora', 'Aquino', 'Female', '1943-04-06'],
  ['Diego', 'Silang', 'Male', '1969-10-11'],     ['Teresa', 'Magbanua', 'Female', '1992-02-28'],
  ['Marcelo', 'Del Pilar', 'Male', '1956-11-05'],['Trinidad', 'Tecson', 'Female', '1975-07-21'],
  ['Juan', 'Luna', 'Male', '1986-09-13'],        ['Gregoria', 'De Jesus', 'Female', '1951-05-09'],
  ['Antonio', 'Luna', 'Male', '1980-01-18'],     ['Leona', 'Florentino', 'Female', '1997-04-27'],
];

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

  let personIndex = 0;
  const nextPerson = () => pick(PEOPLE, personIndex++);

  // A handful of real-looking referrers, so the "Referred by" line on a report is populated on
  // some visits and empty on others — which is the honest picture, and the one that shows the
  // rule working rather than a field that is either always full or always blank.
  const REFERRERS = [
    ['Dr. Amelia R. Santos', '0142887'],
    ['Dr. Benigno L. Cruz', '0098431'],
    ['Dr. Corazon M. Villanueva', '0176520'],
  ];

  /**
   * Registers a walk-in and attaches one test from `category`. Returns the ids and price.
   *
   * Defaults to Self Pay. It used to default to 'Private', which was a harmless label until
   * [1.23.0] made 'Private' mean "a physician referred them" — at which point every seeded visit
   * would have been refused for naming no doctor. Most of these are ordinary walk-ins, which is
   * what Self Pay describes; pass `referrerIndex` for the ones that should carry a referral.
   */
  const makeVisit = async ({
    category, patientTypeName = 'Self Pay', testIndex = 0, referrerIndex = null,
  }) => {
    const [firstName, lastName, sex, birthdate] = nextPerson();
    const patient = (await call('/patients', {
      method: 'POST', token: tok.receptionist,
      body: {
        patientTypeId: typeId(patientTypeName), firstName, lastName, birthdate, sex,
        address: 'Sta. Rosa, Laguna', contactNumber: '09170000000', emergencyContact: '09171111111',
      },
    })).data.patient;

    // 'Private' and HMO both require one, so those callers must supply an index.
    const referrer = referrerIndex === null ? null : pick(REFERRERS, referrerIndex);

    const visit = (await call('/visits', {
      method: 'POST', token: tok.receptionist,
      body: {
        patientId: patient.id, visitType: 'Walk in', notes: `${category} — walk-in`,
        referringPhysician: referrer?.[0], referringPhysicianPrc: referrer?.[1],
      },
    })).data.visit;

    const test = pick(catalogue[category], testIndex);
    const attached = (await call('/tests/visit-tests', {
      method: 'POST', token: tok.receptionist,
      body: { patientVisitId: visit.id, testIds: [test.id] },
    })).data.visitTests[0];

    return { patient, visit, test, visitTestId: attached.id, category, price: parseFloat(test.price) };
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

  const recordFindings = async (v, { findings, isCritical = false, attachFile = true }) => {
    const token = modalityToken[v.category];
    const form = new FormData();
    form.append('findings', findings);
    form.append('remarks', 'Clinical correlation recommended.');
    form.append('isCritical', String(isCritical));
    if (attachFile) {
      const pdf = makeSamplePdf(`${v.category} Report — ${v.patient.first_name} ${v.patient.last_name}`, findings);
      form.append(
        'file',
        new Blob([pdf], { type: 'application/pdf' }),
        `${v.category.toLowerCase()}-report-${v.patient.last_name.toLowerCase()}.pdf`
      );
    }
    const res = await fetch(`${API}/results/${v.visitTestId}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) throw new Error(`record findings -> ${res.status} ${(await res.text()).slice(0, 140)}`);
    return (await res.json()).data.result;
  };

  const release = async (v) =>
    (await call(`/results/${v.visitTestId}/release`, { method: 'POST', token: modalityToken[v.category] })).data.result;

  // ── TODAY: one visit at each stage of the workflow, per department ───────────────────────
  const today = [];
  const stages = [];

  // 1. Awaiting payment — sits in the cashier's billing queue.
  for (const category of ['Laboratory', 'Xray', 'Ultrasound']) {
    const v = await makeVisit({ category });
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — awaiting payment (${category})`);
  }

  // 2. A senior citizen and a PWD awaiting payment, so the statutory discount and its
  //    VAT-exempt arithmetic are visible on the cashier screen rather than hypothetical.
  for (const [d, label] of [[senior, 'Senior Citizen'], [pwd, 'PWD']]) {
    const v = await makeVisit({ category: offered('Ultrasound') });
    await call(`/discounts/visit/${v.visit.id}`, {
      method: 'POST', token: tok.cashier,
      body: { discountTypeId: d.id, idNumber: label === 'PWD' ? 'PWD-2026-0042' : 'OSCA-2026-0117' },
    });
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — awaiting payment, ${label} 20% + VAT-exempt`);
  }

  // 2b. The same two statutory discounts, but SETTLED — otherwise the BIR statutory register is
  //     empty, since it reads from payments rather than from entitlements. An empty register
  //     looks like the feature does not work.
  for (const [d, label, idNumber] of [[senior, 'Senior Citizen', 'OSCA-2026-0093'], [pwd, 'PWD', 'PWD-2026-0117']]) {
    const v = await makeVisit({ category: 'Ultrasound', testIndex: 1 });
    await call(`/discounts/visit/${v.visit.id}`, {
      method: 'POST', token: tok.cashier, body: { discountTypeId: d.id, idNumber },
    });
    const paid = await payFor(v, 'Cash');
    today.push(v);
    stages.push(
      `${v.patient.first_name} ${v.patient.last_name} — ${label} PAID: gross ${v.price.toFixed(2)}, ` +
        `less VAT ${paid.vat_amount}, less 20% ${paid.discount_amount} = ${paid.amount}`
    );
  }

  // 3. Paid and released — live on the modality worklists.
  //
  // These carry a referring physician. They are the tickets a technician actually looks at, and
  // the worklist now shows "Ref: Dr. …" beside the test — without one on any live ticket the
  // column is permanently blank and the feature is invisible in a demo. Varied by index so the
  // screen shows more than one name.
  for (const [i, category] of ['Laboratory', 'Xray', 'Ultrasound', 'ECG'].filter((c) => catalogue[c].length).entries()) {
    const v = await makeVisit({ category, testIndex: 1, referrerIndex: i });
    await payFor(v, pick(COUNTER_METHODS, today.length));
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — paid, on the ${category} worklist`);
  }

  // 4. Findings recorded, awaiting authorisation — the 'Waiting for Release' state.
  {
    const v = await makeVisit({ category: 'Laboratory', testIndex: 2 });
    await payFor(v, 'Cash');
    await recordFindings(v, { findings: 'Haemoglobin 13.4 g/dL. White cell count 7.2. Within normal limits.' });
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — findings recorded, awaiting release`);
  }

  // 5. A CRITICAL result, released and awaiting callback — the escalation path.
  {
    // Names a referrer: a critical value is called back to the requesting physician, so this is
    // the visit where that field most obviously has to be populated.
    const v = await makeVisit({ category: 'Laboratory', testIndex: 3, referrerIndex: 1 });
    await payFor(v, 'Cash');
    await recordFindings(v, {
      findings: 'Potassium 7.1 mmol/L. CRITICALLY HIGH — repeat sample confirms. Urgent review required.',
      isCritical: true,
    });
    await release(v);
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — CRITICAL result released, callback outstanding`);
  }

  // 6. An AMENDED result — two versions, so the amendment history has something in it.
  {
    // An amendment is re-issued to whoever received the first version, so it needs a referrer.
    const v = await makeVisit({ category: 'Xray', testIndex: 2, referrerIndex: 2 });
    await payFor(v, 'GCash');
    await recordFindings(v, { findings: 'No acute cardiopulmonary findings.' });
    const token = modalityToken[v.category];
    const form = new FormData();
    form.append('findings', 'Minimal left basal atelectasis. No consolidation. Heart size normal.');
    form.append('remarks', 'Corrected on senior radiologist review.');
    form.append('amendmentReason', 'Initial report missed a basal finding on re-review');
    form.append('isCritical', 'false');
    await fetch(`${API}/results/${v.visitTestId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    await release(v);
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — AMENDED X-ray report (v2), released`);
  }

  // 7. Fully completed — shows in released history and patient records.
  for (const category of ['Ultrasound', 'Laboratory']) {
    const v = await makeVisit({ category, testIndex: 3 });
    await payFor(v, 'Cash');
    await recordFindings(v, { findings: `${category} study completed. No abnormality detected.` });
    await release(v);
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — ${category} completed and released`);
  }

  // 8. An HMO patient with a pending pre-authorisation, for the Service Requests screen.
  {
    // Carries a referring physician: an HMO claim requires one [1.23.0], and this is the visit
    // the Service Requests screen opens, so it is also where Admin sees the field populated.
    const v = await makeVisit({
      category: 'Ultrasound', patientTypeName: 'HMO', testIndex: 2, referrerIndex: 0,
    });
    const providers = (await call('/hmo/providers', { token: tok.receptionist })).data.providers;
    await call('/hmo/request', {
      method: 'POST', token: tok.receptionist,
      body: { hmoProviderId: providers[0].id, approvalCode: 'LOA-2026-88213', visitTestIds: [v.visitTestId] },
    });
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — HMO pre-auth pending (${providers[0].name})`);
  }

  // ── HISTORY: two weeks of completed, paid visits, then backdated ─────────────────────────
  // Without this the revenue trend, staff workload and every date-range report are empty, which
  // reads as broken rather than new.
  const historical = [];
  const CATEGORIES = OFFERED;
  for (let daysAgo = 14; daysAgo >= 1; daysAgo--) {
    // Two or three visits a day, varying so the trend line is not a flat bar.
    const perDay = 2 + (daysAgo % 2);
    for (let i = 0; i < perDay; i++) {
      const category = pick(CATEGORIES, daysAgo + i);
      const v = await makeVisit({ category, testIndex: i });
      await payFor(v, pick([CASH_METHOD, ...COUNTER_METHODS], daysAgo + i));
      await recordFindings(v, { findings: `${category} study. No abnormality detected.` });
      await release(v);
      historical.push({ ...v, daysAgo });
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
      // inside the hour, a scan needs the room and a radiographer, an echo needs reporting.
      const TURNAROUND_MINUTES = { Laboratory: 45, ECG: 25, Xray: 70, Ultrasound: 95 };
      const arrival = 8 + (h.daysAgo % 8);                       // 08:00-15:00 arrival
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

  // ── Appointments: today, upcoming, and a no-show ─────────────────────────────────────────
  const client = await login('client@enlogada.com');
  const profiles = (await call('/patients/my-profiles', { token: client })).data.patients;
  if (profiles.length > 0) {
    const slotDate = new Date();
    slotDate.setDate(slotDate.getDate() + 2);
    const dateStr = `${slotDate.getFullYear()}-${String(slotDate.getMonth() + 1).padStart(2, '0')}-${String(slotDate.getDate()).padStart(2, '0')}`;
    try {
      const slots = (await call(`/appointments/availability?date=${dateStr}`, { token: client })).data.slots || [];
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
          body: { patientId: profiles[0].id, scheduledDate: dateStr, scheduledTime: slots[i].time || slots[i], notes: 'Online booking' },
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
        stages.push(`${profiles[0].first_name} ${profiles[0].last_name} — online appointment ${dateStr}, ${plan.label} (QR booking pass)`);
      }
    } catch (err) {
      logger.warn(`  appointment booking skipped: ${err.message}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────────────────
  const counts = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM patient_visits WHERE created_at::date = CURRENT_DATE) AS visits_today,
      (SELECT COUNT(*)::int FROM patient_visits) AS visits_total,
      (SELECT COUNT(*)::int FROM payments WHERE payment_status = 'Paid' AND paid_at::date = CURRENT_DATE) AS paid_today,
      (SELECT COALESCE(SUM(amount),0)::numeric(10,2) FROM payments WHERE payment_status = 'Paid' AND paid_at::date = CURRENT_DATE) AS revenue_today,
      (SELECT COUNT(*)::int FROM test_results WHERE is_current AND is_critical) AS critical,
      (SELECT COUNT(*)::int FROM test_results WHERE version > 1) AS amended
  `);
  const c = counts.rows[0];

  logger.info('');
  logger.info("Today's workflow:");
  for (const line of stages) logger.info(`   • ${line}`);
  logger.info('');
  logger.info(`   visits today        ${c.visits_today}   (${c.visits_total} including 14 days of history)`);
  logger.info(`   paid today          ${c.paid_today}   —  PHP ${c.revenue_today}`);
  logger.info(`   critical results    ${c.critical}   awaiting callback`);
  logger.info(`   amended results     ${c.amended}`);
  logger.info('');
  logger.info('Every "today" screen filters on the current date, so re-run this before a demo.');
  logger.info('Frontend: http://localhost:5173');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Seeding failed: ${err.message}`);
  process.exit(1);
});
