// @ts-check
import { test, expect, request } from 'playwright/test';

/**
 * Updating a service must not delete the fields the caller did not mention.
 *
 * `testRepository.updateTest` writes every column unconditionally. The Services Catalogue's
 * status toggle sent only categoryId, name, price and isActive — so every activate/deactivate
 * silently wiped that test's patient preparation.
 *
 * Reproduced on Fasting Blood Sugar before the fix: one toggle deleted "Nothing to eat or drink
 * except water for 8 hours". That sentence is not decoration — [1.25.0] puts it in the
 * day-before appointment reminder, so the patient is reminded of a fasting test with no
 * instruction to fast, eats breakfast, and the visit is wasted. Nobody would connect that back
 * to an admin having toggled a service off and on again a week earlier.
 *
 * `isActive` had the same shape from the other end: the controller defaulted an absent value to
 * `true`, so a PUT that did not mention it quietly re-activated a service someone had
 * deliberately taken off the public booking form.
 *
 * The distinction that makes a partial update safe is `undefined` (not sent — keep it) versus
 * `''`/`null` (sent — clear it), and the last test here is the one that stops the fix going too
 * far: an admin who empties the preparation box must still be able to empty it.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5050';
const API = `${BACKEND_URL}/api`;
const ADMIN = { email: 'admin@enlogada.com', password: 'Password123!' };

const PREP = 'E2E: nothing to eat or drink except water for 8 hours.';

test.describe('a partial service update keeps what it did not mention', () => {
  let apiContext;
  let headers;
  let testId;
  let original;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    const login = await apiContext.post(`${API}/auth/login`, { data: ADMIN });
    headers = { Authorization: `Bearer ${(await login.json()).data.token}` };

    // Its own service, so a failing run cannot leave the clinic's catalogue altered.
    const cats = await apiContext.get(`${API}/tests/categories`, { headers });
    // Laboratory, not categories[0]: that is ECG by name, a department the clinic does not offer,
    // where an active service is refused. [1.124.0]
    const category = (await cats.json()).data.categories.find((c) => c.name === 'Laboratory');
    const created = await apiContext.post(`${API}/tests`, {
      headers,
      data: {
        categoryId: category.id,
        name: `E2E Preparation Guard ${Date.now()}`,
        price: 500,
        preparation: PREP,
      },
    });
    expect(created.status()).toBe(201);
    original = (await created.json()).data.test;
    testId = original.id;
  });

  test.afterAll(async () => {
    if (testId) {
      await apiContext.put(`${API}/tests/${testId}`, {
        headers,
        data: { categoryId: original.category_id, name: original.name, price: 500, isActive: false },
      });
    }
    await apiContext.dispose();
  });

  const read = async () => {
    const res = await apiContext.get(`${API}/tests?includeInactive=true`, { headers });
    return (await res.json()).data.tests.find((t) => t.id === testId);
  };

  test('toggling the status keeps the preparation instructions', async () => {
    const before = await read();
    expect(before.preparation).toBe(PREP);

    // Exactly the payload the Services Catalogue status toggle sends.
    const res = await apiContext.put(`${API}/tests/${testId}`, {
      headers,
      data: {
        categoryId: before.category_id,
        name: before.name,
        price: parseFloat(before.price),
        isActive: !before.is_active,
      },
    });
    expect(res.ok()).toBe(true);

    const after = await read();
    expect(after.is_active).toBe(!before.is_active);
    // The regression this file exists for: this used to be null.
    expect(after.preparation).toBe(PREP);
  });

  test('an update that does not mention isActive leaves it alone', async () => {
    // The service is currently deactivated by the test above.
    const before = await read();
    expect(before.is_active).toBe(false);

    const res = await apiContext.put(`${API}/tests/${testId}`, {
      headers,
      data: { categoryId: before.category_id, name: before.name, price: 650 },
    });
    expect(res.ok()).toBe(true);

    const after = await read();
    expect(parseFloat(after.price)).toBe(650);
    // Not re-activated behind the admin's back.
    expect(after.is_active).toBe(false);
    expect(after.preparation).toBe(PREP);
  });

  test('an explicitly empty preparation still clears it', async () => {
    const before = await read();
    const res = await apiContext.put(`${API}/tests/${testId}`, {
      headers,
      data: {
        categoryId: before.category_id,
        name: before.name,
        price: parseFloat(before.price),
        preparation: '',
      },
    });
    expect(res.ok()).toBe(true);

    // "Keep what was not sent" must not become "you can never remove this".
    const after = await read();
    expect(after.preparation).toBeNull();
  });
});
