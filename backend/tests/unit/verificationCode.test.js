const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateCode, normalizeCode, formatCode, verifyUrl, stampFor, patientInitials, ALPHABET,
} = require('../../src/utils/verificationCode');

/**
 * The code on a released report. [1.126.0] What is at stake: a code that can be guessed, or one a
 * person cannot type back in from the paper.
 */

test('a code is ten characters of Crockford base32, nothing that reads as another character', () => {
  assert.equal(ALPHABET.length, 32);
  for (const banned of ['I', 'L', 'O', 'U']) assert.equal(ALPHABET.includes(banned), false);
  for (let i = 0; i < 500; i += 1) {
    const code = generateCode();
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{10}$/);
    assert.equal(normalizeCode(code), code);
  }
});

test('codes do not repeat across a large batch', () => {
  const seen = new Set();
  for (let i = 0; i < 20000; i += 1) seen.add(generateCode());
  assert.equal(seen.size, 20000);
});

test('what a person types is read the way they meant it', () => {
  assert.equal(normalizeCode('abcde-12345'), 'ABCDE12345');
  assert.equal(normalizeCode('  ABCDE 12345 '), 'ABCDE12345');
  // Crockford's own forgiveness: O for zero, I and L for one.
  assert.equal(normalizeCode('ABCDE-O2345'), 'ABCDE02345');
  assert.equal(normalizeCode('ABCDE-I2L45'), 'ABCDE12145');
  // A whole link pasted into the box.
  assert.equal(normalizeCode('https://clinic.example/?verify=ABCDE-12345'), 'ABCDE12345');
  assert.equal(normalizeCode('http://localhost:5173/?tab=x&verify=abcde-12345#top'), 'ABCDE12345');
});

test('anything that cannot be a code is refused, not looked up', () => {
  for (const bad of ['', null, undefined, 'nope', 'ABCDE-1234', 'ABCDE-123456', 'ABCDE-1234U', "' OR 1=1 --"]) {
    assert.equal(normalizeCode(bad), null, String(bad));
  }
});

test('printed with a dash, and linked to the clinic page', () => {
  assert.equal(formatCode('ABCDE12345'), 'ABCDE-12345');
  assert.equal(verifyUrl('ABCDE12345', 'https://clinic.example/'), 'https://clinic.example/?verify=ABCDE-12345');
  assert.deepEqual(stampFor('ABCDE12345', 'https://clinic.example'), {
    code: 'ABCDE-12345',
    url: 'https://clinic.example/?verify=ABCDE-12345',
  });
  // A version with no code is still marked, just without one.
  assert.equal(stampFor(null, 'https://clinic.example'), null);
});

test('the page names the patient by initials only', () => {
  assert.equal(patientInitials('Maria Zoe', 'Abao'), 'M. Z. A.');
  assert.equal(patientInitials('Ma. Luisa', 'Dela Cruz'), 'M. L. D. C.');
  assert.equal(patientInitials('Ñino', 'Ébano'), 'Ñ. É.');
  assert.equal(patientInitials('', ''), '');
});
