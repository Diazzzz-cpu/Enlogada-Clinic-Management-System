// @ts-check
import { test, expect, request } from 'playwright/test';

// Two features that both offer a number to a person, and must never be mistaken for deciding one.
// [1.62.0]
//
// ── Receipt scanning ────────────────────────────────────────────────────────────────────────
//
// OCR over a GCash/bank screenshot, to save the patient transcribing a thirteen-digit reference.
// The property worth a spec is what it does NOT do: it creates no submission, records no payment,
// and its output is a suggestion. [1.48.0] already established that the amount a patient CLAIMS is
// evidence rather than the amount charged; a machine reading of a claim is weaker still, and the
// day it starts writing anywhere is the day the least reliable number in the system became the
// most authoritative one.
//
// The duplicate check is the half with real value. A reference number is the clinic's only handle
// on a transfer that happened inside somebody else's system, and the same screenshot submitted
// twice is indistinguishable from two payments unless something looks.
//
// ── Queue estimates ─────────────────────────────────────────────────────────────────────────
//
// "You are number 12" does not answer the question the person holding the ticket is asking. The
// invariants here are the ones that make the answer safe to publish: the count only ever counts
// people genuinely in front, a visit past the desk gets no estimate at all rather than a zero, and
// the patient's screen and the receptionist's screen cannot disagree.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

/**
 * A 1x1 PNG. Deliberately unreadable: it exercises the SOFT-FAILURE path, which is the one that
 * must never break the upload form. Rendering a realistic receipt would need an image toolkit this
 * suite does not have, and the parsing itself is covered by unit checks on the extractors.
 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('Receipt scanning', () => {
  let ctx;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `login failed for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };
  const scan = (token, { name = 'receipt.png', mimeType = 'image/png', buffer = TINY_PNG } = {}) =>
    ctx.post(`${API}/payments/scan-receipt`, {
      headers: auth(token),
      multipart: { proof: { name, mimeType, buffer } },
    });

  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx.dispose(); });

  test('an unreadable image is a successful answer, not an error', async () => {
    const token = await login('client@enlogada.com');
    const res = await scan(token);

    // 200, deliberately. "I could not read this" is a successful answer to "what can you read
    // here". A 4xx would fire the frontend's error branch and read to the patient as their upload
    // having failed, when in fact they simply type the reference in as they always did.
    expect(res.status()).toBe(200);

    const { scan: result } = (await res.json()).data;
    expect(result).toHaveProperty('reference_number');
    expect(result).toHaveProperty('amount');
    expect(result).toHaveProperty('is_duplicate');
    // Nothing was found, so nothing is claimed.
    expect(result.reference_number).toBeNull();
    expect(result.is_duplicate).toBe(false);
  });

  test('scanning creates nothing — no submission, no payment', async () => {
    const token = await login('client@enlogada.com');

    const before = await ctx.get(`${API}/payment-submissions/pending`, {
      headers: auth(await login('cashier@enlogada.com')),
    });
    const countBefore = (await before.json()).data.submissions.length;

    await scan(token);
    await scan(token);
    await scan(token);

    const after = await ctx.get(`${API}/payment-submissions/pending`, {
      headers: auth(await login('cashier@enlogada.com')),
    });
    expect((await after.json()).data.submissions.length).toBe(countBefore);
  });

  test('a PDF is refused with an instruction rather than a silent empty result', async () => {
    const token = await login('client@enlogada.com');
    const res = await scan(token, {
      name: 'receipt.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 not really'),
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    // It tells the patient what to do next. A PDF proof is legitimate and still uploadable; only
    // the SCAN cannot read it, and saying "unreadable" would send them to re-photograph a receipt
    // that was fine.
    expect(body.message).toMatch(/JPEG, PNG or WebP/i);
    expect(body.message).toMatch(/type the details in/i);
  });

  test('scanning answers to the same permission as submitting the proof', async () => {
    // Laboratory staff hold no billing:submit_proof, and a scan reveals what a receipt says.
    const lab = await login('lab@enlogada.com');
    expect((await scan(lab)).status()).toBe(403);

    const xray = await login('xray@enlogada.com');
    expect((await scan(xray)).status()).toBe(403);

    // A patient submitting their own proof may scan it — that is the whole use.
    const client = await login('client@enlogada.com');
    expect((await scan(client)).status()).toBe(200);

    // Reception may do it on a patient's behalf, matching POST /payment-submissions.
    const reception = await login('receptionist@enlogada.com');
    expect((await scan(reception)).status()).toBe(200);

    const anonymous = await ctx.post(`${API}/payments/scan-receipt`, {
      multipart: { proof: { name: 'r.png', mimeType: 'image/png', buffer: TINY_PNG } },
    });
    expect(anonymous.status()).toBe(401);
  });

  test('a request with no file says so', async () => {
    const token = await login('client@enlogada.com');
    const res = await ctx.post(`${API}/payments/scan-receipt`, { headers: auth(token), multipart: {} });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/image of the receipt is required/i);
  });
});

test.describe('Queue wait estimates', () => {
  let ctx;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `login failed for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx.dispose(); });

  test('the active queue carries a position and an estimate, and they are internally consistent', async () => {
    const token = await login('receptionist@enlogada.com');
    const res = await ctx.get(`${API}/visits/active?limit=200`, { headers: auth(token) });
    expect(res.status()).toBe(200);

    const { visits } = (await res.json()).data;
    test.skip(visits.length === 0, 'Need at least one active visit.');

    let previousPosition = 0;
    let previousAhead = -1;

    for (const v of visits) {
      // Position is a fact about the queue, computed over the whole active set — so it ascends
      // without gaps regardless of any filter or page applied on top of it.
      expect(Number(v.queue_position)).toBe(previousPosition + 1);
      previousPosition = Number(v.queue_position);

      expect(Number(v.patients_ahead)).toBeGreaterThanOrEqual(0);
      // Never decreases going down the queue: a later patient cannot have fewer people in front.
      expect(Number(v.patients_ahead)).toBeGreaterThanOrEqual(previousAhead);
      previousAhead = Number(v.patients_ahead);

      if (v.status === 'Pending') {
        // Nobody is ever told zero — the person at the front is next, not finished.
        expect(Number(v.estimated_wait_minutes)).toBeGreaterThanOrEqual(5);
        // Reported in five-minute steps, which is the model's actual precision. "About 20 minutes"
        // is an estimate a clinic can keep; "18 minutes" is a promise it cannot.
        expect(Number(v.estimated_wait_minutes) % 5).toBe(0);
        expect(['measured', 'default']).toContain(v.estimate_basis);
      } else {
        // Billed and released to a department. A front-desk estimate has nothing to say about
        // them, and a zero would read as "no wait" — a claim rather than an absence.
        expect(v.estimated_wait_minutes).toBeNull();
      }
    }

    // Only Pending predecessors count, so the last patient's head count is the number of Pending
    // visits strictly before them — never the raw queue length.
    const pending = visits.filter((v) => v.status === 'Pending');
    if (pending.length > 1) {
      const last = pending[pending.length - 1];
      expect(Number(last.patients_ahead)).toBe(pending.length - 1);
    }
  });

  test('the patient and the receptionist are shown the same number', async () => {
    const staff = await login('receptionist@enlogada.com');
    const client = await login('client@enlogada.com');

    const queue = (await (await ctx.get(`${API}/visits/active?limit=200`, { headers: auth(staff) })).json()).data.visits;
    const bookings = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(client) })).json()).data.bookings;

    const estimated = bookings.filter((b) => b.estimated_wait_minutes != null);
    test.skip(estimated.length === 0, 'Need a client booking in today\'s queue.');

    const byVisit = new Map(queue.map((v) => [v.id, v]));
    let compared = 0;

    for (const booking of estimated) {
      const staffRow = byVisit.get(booking.patient_visit_id);
      if (!staffRow) continue;
      compared += 1;
      // One service rate, one rounding, one estimate. Two independent calculations would disagree
      // within a minute of each other, and the patient would be reading one while the receptionist
      // read the other — worse than neither screen carrying a number at all.
      expect(Number(booking.patients_ahead)).toBe(Number(staffRow.patients_ahead));
      expect(Number(booking.estimated_wait_minutes)).toBe(Number(staffRow.estimated_wait_minutes));
    }

    expect(compared, 'no booking could be matched to a queue row').toBeGreaterThan(0);
  });

  test('a booking that is not in today\'s queue is given no estimate at all', async () => {
    const client = await login('client@enlogada.com');
    const bookings = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(client) })).json()).data.bookings;

    for (const b of bookings) {
      const inTodaysQueue = b.patients_ahead !== null && b.patients_ahead !== undefined;
      if (!inTodaysQueue) {
        // Absent, not zero. A "0 minute wait" on a booking three days out is absurd, and on a
        // cancelled one it is misleading.
        expect(b.estimated_wait_minutes ?? null).toBeNull();
      }
      // A cancelled or completed visit is never in the queue, whatever its date.
      if (b.visit_status === 'Cancelled' || b.visit_status === 'Completed') {
        expect(inTodaysQueue).toBeFalsy();
      }
    }
  });
});
