// @ts-check
import { test, expect, request } from 'playwright/test';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { docxReport, xlsxReport, csvReport, executableBytes, MIME } from './helpers/officeFiles.js';

/**
 * Word, Excel and CSV reports. [1.96.0]
 *
 * The clinic's reports come out of the analysers as spreadsheets and out of the radiologist's word
 * processor as documents, so "Attach Report & Release Result" now accepts them alongside PDF and
 * images. These pin the parts a browser test would not show:
 *
 *   - a real .docx / .xlsx / .csv is accepted, saved as what it is, and released to the patient;
 *   - it downloads as a file rather than opening in the browser, because no browser renders it;
 *   - a .csv that Windows labels as an Excel file is still stored and served as CSV;
 *   - a file whose contents do not match its name is refused, and nothing of it is kept.
 *
 * Driven through the API, like result-file-access.spec.js, because the rules live on the server.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Report file types', () => {
  let ctx;
  let client, lab, reception, cashier;
  let ids = [];

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };
  const upload = (visitTestId, name, mimeType, buffer) => ctx.post(`${API}/results/${visitTestId}`, {
    headers: auth(lab),
    multipart: { file: { name, mimeType, buffer } },
  });
  const fileAs = (token, visitTestId) => ctx.get(`${API}/results/${visitTestId}/file`, { headers: auth(token) });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [client, lab, reception, cashier] = await Promise.all(
      ['client@enlogada.com', 'lab@enlogada.com', 'receptionist@enlogada.com', 'cashier@enlogada.com'].map(login)
    );

    // The seeded client's own patient, so the patient download can be exercised too.
    const profiles = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json())
      .data.patients || [];
    expect(profiles.length, 'the seeded client needs a patient profile').toBeGreaterThan(0);

    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: profiles[0].id, visitType: 'Walk in', notes: 'E2E report file types' },
    })).json()).data.visit;

    const labTests = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .filter((t) => t.category_name === 'Laboratory' && t.is_active)
      .slice(0, 3);
    expect(labTests.length, 'need three active laboratory tests').toBe(3);
    await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visit.id, testIds: labTests.map((t) => t.id) },
    });
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);

    ids = ((await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json())
      .data.visitTests || []).map((vt) => vt.id);
    expect(ids.length).toBe(3);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('a Word report is accepted and downloads as a Word file', async () => {
    const res = await upload(ids[0], 'CBC report.docx', MIME.docx, docxReport());
    expect(res.status(), await res.text()).toBe(201);

    const file = await fileAs(lab, ids[0]);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toContain('wordprocessingml.document');
    expect(file.headers()['content-disposition'], 'a browser cannot show a .docx, so it is a download')
      .toMatch(/^attachment; filename="CBC report\.docx"/);
  });

  test('an Excel report is released and reaches the patient intact', async () => {
    const workbook = xlsxReport();
    const res = await upload(ids[1], 'Lipid profile.xlsx', MIME.xlsx, workbook);
    expect(res.status(), await res.text()).toBe(201);

    const released = await ctx.post(`${API}/results/${ids[1]}/release`, { headers: auth(lab) });
    expect(released.status(), 'a spreadsheet counts as the report for release').toBe(200);

    const file = await fileAs(client, ids[1]);
    expect(file.status(), 'the released spreadsheet is the patient\'s').toBe(200);
    expect(file.headers()['content-type']).toContain('spreadsheetml.sheet');
    expect(file.headers()['content-disposition']).toMatch(/^attachment;/);
    expect(Buffer.compare(await file.body(), workbook), 'the patient receives the same bytes').toBe(0);
  });

  test('a CSV that Windows labels as an Excel file is still stored and served as CSV', async () => {
    const res = await upload(ids[2], 'Urinalysis.csv', 'application/vnd.ms-excel', csvReport());
    expect(res.status(), await res.text()).toBe(201);

    const file = await fileAs(lab, ids[2]);
    expect(file.headers()['content-type']).toContain('text/csv');
    expect(file.headers()['content-disposition']).toMatch(/^attachment; filename="Urinalysis\.csv"/);
  });

  test('a file whose contents do not match its name is refused, and the report is unchanged', async () => {
    const res = await upload(ids[2], 'report.docx', MIME.docx, executableBytes());
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain('not a valid Word (DOCX) file');

    const file = await fileAs(lab, ids[2]);
    expect(file.headers()['content-type'], 'the CSV attached earlier is still the report').toContain('text/csv');
  });

  test('macro-enabled and other unsupported files are refused before upload', async () => {
    for (const [name, type] of [
      ['report.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
      ['report.docm', 'application/vnd.ms-word.document.macroEnabled.12'],
      ['setup.exe', 'application/octet-stream'],
    ]) {
      const res = await upload(ids[0], name, type, executableBytes());
      expect(res.status(), name).toBe(400);
      expect((await res.json()).message, name).toContain('Unsupported file type');
    }
  });
});
