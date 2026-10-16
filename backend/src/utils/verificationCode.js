const crypto = require('crypto');

/**
 * The code on a released report that lets anyone check it is genuine. [1.126.0]
 *
 * A patient hands their report to an employer, a school or an HMO, and none of them can tell a real
 * one from an edited PDF. Each AUTHORISED version of a report gets a code of its own, printed with a
 * QR on the patient's copy; the public page at `?verify=CODE` says which clinic issued it, for which
 * test, on what date, and whether a correction has since replaced it.
 *
 * Ten characters of Crockford's base32 (no I, L, O or U, so nothing reads as another character),
 * 50 random bits. The clinic will issue thousands of codes, not billions, so a guess finds one about
 * once in a trillion tries, and the lookup's rate limit counts only misses. Stored without the dash;
 * shown and printed as ABCDE-12345 so it can be read out over the phone in two halves.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 10;
const CANONICAL = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** A new code, canonical form (no dash). */
function generateCode() {
  let code = '';
  for (let i = 0; i < LENGTH; i += 1) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

/**
 * Whatever a person typed or pasted, as a canonical code, or null when it cannot be one.
 *
 * Forgiving where a person is likely to slip: lower case, spaces and dashes, the letters O, I and L
 * for the digits they look like (Crockford's own rule), and a whole pasted link.
 */
function normalizeCode(input) {
  let text = String(input ?? '').trim();
  const fromLink = text.match(/[?&]verify=([^&#\s]+)/i);
  if (fromLink) text = decodeURIComponent(fromLink[1]);
  const code = text
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return CANONICAL.test(code) ? code : null;
}

/** ABCDE12345 -> ABCDE-12345 */
const formatCode = (code) => `${code.slice(0, 5)}-${code.slice(5)}`;

/** The page that checks it, on the clinic's own site. */
const verifyUrl = (code, frontendUrl) =>
  `${String(frontendUrl || '').replace(/\/+$/, '')}/?verify=${formatCode(code)}`;

/**
 * What digitalCopy() prints for a stored code, or null when the version has none (a report
 * released before codes existed and not yet backfilled), so the copy is still marked without one.
 */
const stampFor = (code, frontendUrl) =>
  (code ? { code: formatCode(code), url: verifyUrl(code, frontendUrl) } : null);

/**
 * "Maria Zoe", "Abao" -> "M. Z. A."
 *
 * Enough to match against the name printed on the report in someone's hand, and no more: a
 * verification link gets forwarded, and the page must not become a way to look up who had which
 * test.
 */
function patientInitials(firstName, lastName) {
  return [firstName, lastName]
    .join(' ')
    .split(/[\s.]+/)
    .map((part) => part.match(/\p{L}/u)?.[0])
    .filter(Boolean)
    .map((letter) => `${letter.toUpperCase()}.`)
    .join(' ');
}

module.exports = {
  generateCode, normalizeCode, formatCode, verifyUrl, stampFor, patientInitials, ALPHABET,
};
