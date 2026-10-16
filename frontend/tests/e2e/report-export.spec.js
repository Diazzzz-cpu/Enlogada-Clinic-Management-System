// @ts-check
import { test, expect, request } from 'playwright/test';

// Exporting a report as a file, and the two things that can go wrong with one. [1.62.0]
//
// The reports were readable and not extractable: the only way to get a figure off the screen was
// to retype it or print the page, and a printed page cannot be reconciled against a drawer.
//
// Two failure modes are worth a spec, and they pull in opposite directions:
//
//   1. The export shows MORE than the caller may see. `/reports/operations` assembles itself from
//      whichever slices the caller's permissions allow, and a second output format is exactly
//      where that kind of check gets forgotten — the JSON path would still look correct while the
//      CSV quietly handed a technician the day's takings.
//
//   2. The export changes the JSON. Every dashboard, and most of this suite, reads these same
//      endpoints without a `format` parameter. They must be byte-for-byte unaffected.
//
// The BOM assertion is not pedantry. Without it Excel on Windows — which is what this clinic
// actually opens these in — reads the file as the system codepage, and every ñ in a patient's
// name and every ₱ in a header renders as mojibake.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const RANGE = { startDate: '2026-01-01', endDate: '2030-01-01' };
const QS = `startDate=${RANGE.startDate}&endDate=${RANGE.endDate}`;

test.describe('Report CSV export', () => {
  let ctx;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `login failed for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx.dispose(); });

  test('every report offers a CSV with the right headers and a UTF-8 BOM', async () => {
    const token = await login('clinicadmin@enlogada.com');

    const reports = [
      ['/reports/summary', 'clinic-summary'],
      ['/reports/operations', 'operations'],
      ['/reports/hmo-claims', 'hmo-claims'],
      ['/reports/staff-workload', 'staff-workload'],
      ['/reports/analytics', 'clinic-analytics'],
    ];

    for (const [path, name] of reports) {
      const res = await ctx.get(`${API}${path}?${QS}&format=csv`, { headers: auth(token) });
      expect(res.status(), `${path} should export`).toBe(200);

      const headers = res.headers();
      expect(headers['content-type']).toContain('text/csv');
      // `attachment`, not `inline` — an inline disposition renders the CSV in the tab instead of
      // saving it, which is not an export.
      expect(headers['content-disposition']).toContain('attachment');
      expect(headers['content-disposition']).toContain(`${name}-${RANGE.startDate}_to_${RANGE.endDate}.csv`);
      // Exposed to JavaScript, or the browser cannot read the filename off it and every download
      // is named after the endpoint.
      expect(headers['access-control-expose-headers']).toContain('Content-Disposition');
      // A point-in-time document containing patient figures must never be revalidated or reused.
      expect(headers['cache-control']).toContain('no-store');

      const body = await res.body();
      expect(body.subarray(0, 3), `${path} must start with a UTF-8 BOM`).toEqual(Buffer.from([0xEF, 0xBB, 0xBF]));

      const text = body.toString('utf8');
      expect(text).toContain('Enlogada Ultrasound and Diagnostic Clinic');
      expect(text).toContain(`${RANGE.startDate} to ${RANGE.endDate}`);
      // CRLF between records, per RFC 4180.
      expect(text).toContain('\r\n');
    }
  });

  test('asking for no format, or a format that is not csv, still returns the JSON it always did', async () => {
    const token = await login('clinicadmin@enlogada.com');

    for (const path of ['/reports/summary', '/reports/operations', '/reports/hmo-claims']) {
      const plain = await ctx.get(`${API}${path}?${QS}`, { headers: auth(token) });
      expect(plain.status()).toBe(200);
      const body = await plain.json();
      expect(body.status).toBe('success');
      expect(body.data.report).toBeTruthy();

      // Anything that is not "csv" means JSON. A caller that sends format=json, or format=xlsx by
      // mistake, gets the response it always got rather than a download or a 400.
      const other = await ctx.get(`${API}${path}?${QS}&format=json`, { headers: auth(token) });
      expect(other.status()).toBe(200);
      expect(other.headers()['content-type']).toContain('application/json');
      expect(await other.json()).toEqual(body);
    }
  });

  test('the export shows exactly what the caller is allowed to see, and no more', async () => {
    const admin = await login('clinicadmin@enlogada.com');
    const lab = await login('lab@enlogada.com');

    const adminCsv = await (await ctx.get(`${API}/reports/operations?${QS}&format=csv`, { headers: auth(admin) })).text();
    const labCsv = await (await ctx.get(`${API}/reports/operations?${QS}&format=csv`, { headers: auth(lab) })).text();

    // An Admin holds billing:read, so the money is there.
    expect(adminCsv).toContain('Takings');
    expect(adminCsv).toContain('Collected (PHP)');
    expect(adminCsv).toContain('Front Desk Throughput');

    // A laboratory account holds results:read and neither of the other two. The takings must be
    // ABSENT, not zeroed — a zero would tell a technician the clinic collected nothing.
    expect(labCsv).not.toContain('Takings');
    expect(labCsv).not.toContain('Collected (PHP)');
    expect(labCsv).not.toContain('Front Desk Throughput');
    expect(labCsv).toContain('Department Turnaround');

    // And department-scoped: a lab account sees its own room and not the others'.
    //
    // Asserted on the DATA ROWS, not on the file. A substring search for "Ultrasound" matches the
    // clinic's own name in the header block — "Enlogada Ultrasound and Diagnostic Clinic" — so the
    // obvious `not.toContain('Ultrasound')` fails on a correctly scoped export. A department only
    // ever appears as the first field of a row.
    const departmentsIn = (csv) => csv
      .split('\r\n')
      .map((line) => line.split(',')[0].replace(/^"|"$/g, ''))
      .filter((first) => ['Laboratory', 'Ultrasound', 'Xray'].includes(first));

    const labDepartments = new Set(departmentsIn(labCsv));
    expect(labDepartments.has('Laboratory')).toBeTruthy();
    expect(labDepartments.has('Ultrasound')).toBeFalsy();
    expect(labDepartments.has('Xray')).toBeFalsy();

    // The Admin is unrestricted, so the same read is not scoped for them — which is what shows the
    // filter above is the department rule doing its job rather than the data simply being thin.
    expect(new Set(departmentsIn(adminCsv)).size).toBeGreaterThan(1);
  });

  test('a patient cannot export a report at all', async () => {
    const client = await login('client@enlogada.com');

    for (const path of ['/reports/summary', '/reports/operations', '/reports/hmo-claims', '/reports/analytics']) {
      const res = await ctx.get(`${API}${path}?${QS}&format=csv`, { headers: auth(client) });
      expect(res.status(), `${path} must refuse a Client`).toBe(403);
      // Refused as JSON, never as a downloadable file — a 403 that arrives as an attachment is a
      // browser save dialog containing an error message.
      expect(res.headers()['content-type']).toContain('application/json');
    }

    const anonymous = await ctx.get(`${API}/reports/summary?${QS}&format=csv`);
    expect(anonymous.status()).toBe(401);
  });

  test('a bad date range is refused before any download begins', async () => {
    const token = await login('clinicadmin@enlogada.com');

    // The order matters: sendCsv writes Content-Disposition, and a response that has begun as a
    // file download cannot then become an error page. Validation runs in the service, before the
    // format is even considered.
    const res = await ctx.get(`${API}/reports/summary?startDate=2030-01-01&endDate=2026-01-01&format=csv`, { headers: auth(token) });
    expect(res.status()).toBe(400);
    expect(res.headers()['content-disposition']).toBeUndefined();
  });
});

test.describe('Clinic analytics', () => {
  let ctx;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `login failed for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx.dispose(); });

  test('turnaround is reported against a target, and agrees with the operations report', async () => {
    const token = await login('clinicadmin@enlogada.com');

    const analytics = (await (await ctx.get(`${API}/reports/analytics?${QS}`, { headers: auth(token) })).json()).data.report;
    const operations = (await (await ctx.get(`${API}/reports/operations?${QS}`, { headers: auth(token) })).json()).data.report;

    expect(Array.isArray(analytics.turnaroundSla)).toBeTruthy();
    test.skip(analytics.turnaroundSla.length === 0, 'Need at least one released result.');

    const byCategory = Object.fromEntries((operations.diagnostics?.byCategory || []).map((r) => [r.category_name, r]));

    for (const row of analytics.turnaroundSla) {
      // The same measurement on the same basis, published on two screens that sit beside each
      // other. Two queries answering "median turnaround" differently is the [1.32.0] divergence
      // arriving by another door, and it is the whole reason the end-to-end span is named
      // `median_total_minutes` rather than sharing this column's name.
      const ops = byCategory[row.category_name];
      if (ops) {
        expect(Number(row.median_turnaround_minutes), `${row.category_name} median must match /reports/operations`)
          .toBe(Number(ops.median_turnaround_minutes));
        expect(Number(row.released)).toBe(Number(ops.released));
      }

      // A distribution's 90th percentile is never below its median.
      expect(Number(row.p90_turnaround_minutes)).toBeGreaterThanOrEqual(Number(row.median_turnaround_minutes));
      // Registration-to-release contains payment-to-release, so it cannot be shorter.
      expect(Number(row.median_total_minutes)).toBeGreaterThanOrEqual(0);
      expect(Number(row.within_target)).toBeLessThanOrEqual(Number(row.released));
    }
  });

  test('arrivals cover every operating hour, so a quiet hour is a zero rather than a gap', async () => {
    const token = await login('clinicadmin@enlogada.com');
    const report = (await (await ctx.get(`${API}/reports/analytics?${QS}`, { headers: auth(token) })).json()).data.report;

    const hours = report.hourlyArrivals;
    expect(Array.isArray(hours)).toBeTruthy();
    expect(hours.length).toBeGreaterThan(0);

    // Contiguous and ascending — the generate_series is what guarantees an empty hour still draws
    // a bar, and a gap in this sequence means it has stopped doing that.
    for (let i = 1; i < hours.length; i += 1) {
      expect(Number(hours[i].hour)).toBe(Number(hours[i - 1].hour) + 1);
    }
    for (const h of hours) {
      expect(Number(h.total)).toBe(Number(h.walk_in) + Number(h.online));
    }
  });

  // [1.111.0] Arrivals by hour moved to Trends with the Analytics tab's removal, so the summary
  // carries them, and its file does too: an export holds what the screen shows.
  test('Trends carries arrivals by hour, in the JSON and in the file', async () => {
    const token = await login('clinicadmin@enlogada.com');
    const report = (await (await ctx.get(`${API}/reports/summary?${QS}`, { headers: auth(token) })).json()).data.report;
    expect(Array.isArray(report.hourlyArrivals)).toBeTruthy();
    for (const h of report.hourlyArrivals) {
      expect(Number(h.total)).toBe(Number(h.walk_in) + Number(h.online));
    }
    const csv = await (await ctx.get(`${API}/reports/summary?${QS}&format=csv`, { headers: auth(token) })).text();
    expect(csv).toContain('Arrivals by Hour of Day');
  });

  test('each analytics slice answers to its own permission', async () => {
    const lab = await login('lab@enlogada.com');
    const cashier = await login('cashier@enlogada.com');
    const client = await login('client@enlogada.com');

    const labReport = (await (await ctx.get(`${API}/reports/analytics?${QS}`, { headers: auth(lab) })).json()).data.report;
    // results:read — turnaround yes.
    expect(labReport.turnaroundSla).toBeTruthy();
    // [1.111.0] The revenue comparison went with the Analytics tab; nobody receives it.
    expect(labReport.revenueComparison).toBeUndefined();

    const cashierReport = (await (await ctx.get(`${API}/reports/analytics?${QS}`, { headers: auth(cashier) })).json()).data.report;
    // visits:read — arrivals yes; no results:read — turnaround must be absent, not empty.
    expect(cashierReport.hourlyArrivals).toBeTruthy();
    expect(cashierReport.turnaroundSla).toBeUndefined();
    expect(cashierReport.revenueComparison).toBeUndefined();

    // Holding none of the three is a refusal, not an empty report.
    const refused = await ctx.get(`${API}/reports/analytics?${QS}`, { headers: auth(client) });
    expect(refused.status()).toBe(403);
  });

  // [1.119.0] The Export button downloads Excel now: a CSV cannot carry column widths, bold or a
  // money format, and opened in Excel as one cramped grid. The workbook's contents are held by
  // backend/tests/unit/xlsxWriter.test.js; this holds that each report serves one, to staff only.
  test('every report the Reports tabs export comes as an Excel workbook', async () => {
    const token = await login('clinicadmin@enlogada.com');
    for (const [path, name] of [
      ['/reports/operations', 'departments-report'],
      ['/reports/summary', 'trends-report'],
      ['/reports/hmo-claims', 'hmo-claims-report'],
      ['/reports/staff-workload', 'staff-workload-report'],
    ]) {
      const res = await ctx.get(`${API}${path}?${QS}&format=xlsx`, { headers: auth(token) });
      expect(res.status(), `${path} should export`).toBe(200);
      expect(res.headers()['content-type']).toContain('spreadsheetml.sheet');
      expect(res.headers()['content-disposition'])
        .toBe(`attachment; filename="${name}-${RANGE.startDate}_to_${RANGE.endDate}.xlsx"`);
      expect(res.headers()['cache-control']).toContain('no-store');
      const body = await res.body();
      expect(body.subarray(0, 4).toString('latin1'), 'a zip, which is what an .xlsx is').toBe('PK' + String.fromCharCode(3, 4));
    }

    const client = await login('client@enlogada.com');
    const refused = await ctx.get(`${API}/reports/operations?${QS}&format=xlsx`, { headers: auth(client) });
    expect(refused.status(), 'a patient cannot export').toBe(403);
    expect(refused.headers()['content-type']).toContain('application/json');
  });
});
