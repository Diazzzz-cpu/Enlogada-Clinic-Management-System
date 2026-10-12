const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertReferralIfRequired,
  assertDoctorRequestIfRequired,
} = require('../../src/services/referralService');

/**
 * Who must name the requesting doctor, and how. [1.106.0]
 *
 * A patient booking online stopped typing the doctor's name: they upload the doctor's signed
 * request instead, and that paper has to satisfy every rule the typed name used to — the HMO's
 * LOA and the Private patient type — or an HMO booking from home could never be made. These pin
 * both directions, so the paper never becomes optional for a patient by accident and the typed
 * name never becomes the only way through.
 */

const refused = (fn) => assert.throws(fn, (err) => err.statusCode === 400);

test('an HMO claim needs the doctor named, by a typed name or by the signed request', () => {
  refused(() => assertReferralIfRequired({ hasHmoClaim: true }));
  refused(() => assertReferralIfRequired({ hasHmoClaim: true, referringPhysician: '   ' }));
  assertReferralIfRequired({ hasHmoClaim: true, referringPhysician: 'Dr. Ana Reyes' });
  assertReferralIfRequired({ hasHmoClaim: true, hasDoctorRequest: true });
});

test('a Private patient is one a physician referred, and the request says who', () => {
  refused(() => assertReferralIfRequired({ patientTypeName: 'Private' }));
  assertReferralIfRequired({ patientTypeName: 'Private', hasDoctorRequest: true });
});

test('a Self Pay visit at the desk needs neither', () => {
  assertReferralIfRequired({ patientTypeName: 'Self Pay' });
});

test("a patient's own booking must carry the signed request, self-pay or not", () => {
  assert.throws(
    () => assertDoctorRequestIfRequired({ isStaff: false, hasDoctorRequest: false }),
    (err) => err.statusCode === 400 && /doctor's signed request/.test(err.message)
  );
  assertDoctorRequestIfRequired({ isStaff: false, hasDoctorRequest: true });
});

test('staff are exempt: at the desk the patient hands the paper over in person', () => {
  assertDoctorRequestIfRequired({ isStaff: true, hasDoctorRequest: false });
});
