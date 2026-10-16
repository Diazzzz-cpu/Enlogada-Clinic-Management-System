// @ts-check
import { test, expect, request } from 'playwright/test';
import { selfPayTypeId } from './helpers/patients.js';

// The in-memory ETag cache. [1.26.0]
//
// Four screens poll to stay live, and a measured idle reception terminal made 240 requests and
// pulled ~1.5 MB an hour — roughly 500,000 requests and 3.2 GB a month across ten staff, almost
// all of it re-sending bytes the browser already had. Express was already emitting ETags and
// already answering a matching If-None-Match with a 0-byte 304; CORS simply never exposed the
// validator to JavaScript, so nothing asked.
//
// The bandwidth is not the risk. The risk is a cache that answers "nothing changed" when
// something did — a receptionist watching a queue that has silently stopped updating is far
// worse off than one on a slow connection. That is what this spec is for.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

async function signIn(page, email) {
  await page.goto('/');
  await page.getByText('Sign In', { exact: true }).first().click();
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.locator('button[type="submit"]').click();
}

test('the server exposes ETag to the browser and honours If-None-Match', async () => {
  // The two halves that were missing. Without exposedHeaders the frontend cannot read the
  // validator; without the 304 there would be nothing to gain by sending it.
  const ctx = await request.newContext();
  const login = await ctx.post(`${API}/auth/login`, {
    data: { email: 'receptionist@enlogada.com', password: PASSWORD },
  });
  const token = (await login.json()).data.token;
  const auth = { Authorization: `Bearer ${token}`, Origin: 'http://localhost:5173' };

  const first = await ctx.get(`${API}/notifications`, { headers: auth });
  expect(first.status()).toBe(200);

  const exposed = first.headers()['access-control-expose-headers'] || '';
  expect(exposed.toLowerCase(), 'ETag must be readable by JS or the cache can never fill').toContain('etag');

  const etag = first.headers().etag;
  expect(etag, 'Express should emit an ETag on JSON').toBeTruthy();

  const revalidated = await ctx.get(`${API}/notifications`, {
    headers: { ...auth, 'If-None-Match': etag },
  });
  expect(revalidated.status()).toBe(304);
  expect((await revalidated.body()).length).toBe(0);

  await ctx.dispose();
});

test('a change made elsewhere still reaches a polling screen', async ({ page }) => {
  // Declared here rather than passed on the command line: this test has to outlast a 30s poll
  // cycle, and a spec that only passes with an extra CLI flag is one that fails in the suite.
  test.setTimeout(120000);

  // The one that matters. The queue is cached and revalidated; if the cache ever answered from
  // memory without asking, this patient would never appear.
  const ctx = await request.newContext();
  const login = await ctx.post(`${API}/auth/login`, {
    data: { email: 'receptionist@enlogada.com', password: PASSWORD },
  });
  const recToken = (await login.json()).data.token;
  const auth = { Authorization: `Bearer ${recToken}` };

  await signIn(page, 'receptionist@enlogada.com');
  // Staff land on Today since [1.77.0]; the Desk's queue is the polled list under test.
  await page.getByRole('button', { name: 'Desk', exact: true }).first().click({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Desk', exact: true, level: 1 })).toBeVisible({ timeout: 15000 });

  const surname = `Revalidate${Date.now()}`;

  // Filter the queue to a surname that does not exist yet, and let that empty result be cached
  // with its ETag. This is a sharper test than watching the unfiltered queue, and immune to
  // pagination: the queue shows 25 a page and a full suite run leaves more visits than that, so
  // a new walk-in lands on page two and proves nothing. Here the poll URL carries the search
  // term, the cached answer is "no such patient", and the change has to overturn it.
  // The Desk's Who's here box is the queue's search since [1.75.0]; it narrows the same polled list.
  await page.getByRole('searchbox', { name: "Who's here?" }).fill(surname);
  await expect(page.getByText(/no .*(patients|visits|results)|nothing/i).first())
    .toBeVisible({ timeout: 15000 });

  // No need to wait out a poll cycle first: the search request that produced the empty result
  // has already stored its ETag, so the very next poll carries If-None-Match.
  const patient = await ctx.post(`${API}/patients`, {
    headers: auth,
    data: {
      patientTypeId: await selfPayTypeId(ctx, API, recToken),
      // Deliberately NOT a name from helpers/people.js, unlike every other fixture. This test
      // filters the queue to a surname that must not exist yet, so the empty result can be cached
      // with its ETag and then overturned. A realistic surname drawn from a pool could already
      // belong to a seeded demo patient, and the precondition would silently not hold.
      firstName: 'Corazon', lastName: surname,
      birthdate: '1990-01-01', sex: 'Female', contactNumber: '09170000000',
    },
  });
  expect(patient.status()).toBe(201);

  const visit = await ctx.post(`${API}/visits`, {
    headers: auth,
    data: { patientId: (await patient.json()).data.patient.id, visitType: 'Walk in', notes: '' },
  });
  expect(visit.status()).toBe(201);
  await ctx.dispose();

  // The queue polls every 30s. Waiting on the name rather than a fixed delay, with room for one
  // full cycle plus render. If the cache ever served its stale "no such patient" without asking
  // the server, this is where it would show.
  await expect(page.getByText(surname).first()).toBeVisible({ timeout: 45000 });
});
