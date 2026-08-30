const test = require('node:test');
const assert = require('node:assert/strict');

const E = require('../../src/errors');

/**
 * The domain error vocabulary, and the compatibility guarantee it rests on. [1.63.0]
 *
 * The whole design constraint is that these classes coexist with ~166 legacy call sites that still
 * build an Error and assign a statusCode by hand. If a class ever produced a different response
 * shape from the four lines it replaces, migration would become a big-bang rewrite behind 299 E2E
 * specs. That is what the compatibility test below pins down.
 */

const CASES = [
  ['ValidationError', 400],
  ['UnauthorizedError', 401],
  ['ForbiddenError', 403],
  ['NotFoundError', 404],
  ['ConflictError', 409],
  ['GoneError', 410],
  ['LockedError', 423],
  ['UpstreamServiceError', 502],
  ['ServiceUnavailableError', 503],
];

test('each error carries the status its name promises', () => {
  for (const [name, status] of CASES) {
    const err = new E[name]('probe');
    assert.equal(err.statusCode, status, name);
    assert.equal(err.message, 'probe', name);
    assert.equal(err.name, name);
    assert.ok(err instanceof Error);
    assert.ok(err instanceof E.AppError);
  }
});

test('a class is response-identical to the legacy idiom it replaces', () => {
  // The four lines this exists to replace:
  //   const error = new Error('Visit not found'); error.statusCode = 404; throw error;
  const legacy = Object.assign(new Error('Visit not found'), { statusCode: 404 });
  const modern = new E.NotFoundError('Visit not found');

  assert.equal(modern.message, legacy.message);
  assert.equal(modern.statusCode, legacy.statusCode);
});

test('the legacy shape is still recognised as operational', () => {
  // If it were not, errorHandler would redact the messages of ~166 call sites in production and
  // every one of them would start saying "Something went wrong".
  const legacy = Object.assign(new Error('Already paid.'), { statusCode: 409 });
  assert.equal(E.isOperationalError(legacy), true);
});

test('a programmer error is NOT operational, so its message is never shown', () => {
  assert.equal(E.isOperationalError(new Error('Cannot read properties of null')), false);
  assert.equal(E.isOperationalError(new TypeError('x is not a function')), false);
});

test('4xx messages are exposed, 5xx are not', () => {
  // A 4xx exists to tell the caller what to do differently, so it is safe to show. A 5xx message
  // is for us and may name internals.
  assert.equal(new E.NotFoundError('x').expose, true);
  assert.equal(new E.ConflictError('x').expose, true);
  assert.equal(new E.AppError('internal detail', 500).expose, false);
});

test('the two service errors expose deliberately, because the caller can act on them', () => {
  // "Online payment is not available, pay at the counter" is actionable; hiding it behind
  // "Something went wrong" implies breakage the clinic would then go looking for.
  assert.equal(new E.ServiceUnavailableError('Pay at the counter.').expose, true);
  assert.equal(new E.UpstreamServiceError('The provider did not respond.').expose, true);
});

test('401 and 403 are distinct, and the distinction matters', () => {
  // 401 means "we do not know who you are"; 403 means "we do, and the answer is no". Conflating
  // them sends a person to sign in again to fix something signing in cannot fix.
  assert.equal(new E.UnauthorizedError().statusCode, 401);
  assert.equal(new E.ForbiddenError().statusCode, 403);
});

test('normalizeError narrows anything a catch block can receive', () => {
  const fromString = E.normalizeError('something odd');
  assert.ok(fromString instanceof Error);
  assert.equal(fromString.statusCode, 500);

  const fromObject = E.normalizeError({ weird: true });
  assert.ok(fromObject instanceof Error);

  // An Error passes through untouched — identity, not a copy, so the stack is preserved.
  const original = new E.NotFoundError('kept');
  assert.equal(E.normalizeError(original), original);
});

test('every error has a default message, so none can render as empty', () => {
  for (const [name] of CASES) {
    const err = new E[name]();
    assert.ok(err.message.length > 0, `${name} must have a default message`);
  }
});

test('the stack starts at the throw site, not inside the error module', () => {
  // captureStackTrace omits the constructor, so a reader lands on the line that threw.
  const err = new E.ConflictError('probe');
  const firstFrame = String(err.stack).split('\n')[1] || '';
  assert.doesNotMatch(firstFrame, /errors[/\\]index\.js/);
});
