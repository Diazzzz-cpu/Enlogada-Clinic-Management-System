const resultRepository = require('../repositories/resultRepository');
const env = require('../config/environment');
const { NotFoundError, ValidationError } = require('../errors');
const { normalizeCode, formatCode, patientInitials } = require('../utils/verificationCode');

/**
 * Is this report genuine? [1.126.0]
 *
 * Asked by whoever the patient showed their report to: an employer, a school, an HMO. Public, so
 * the answer states only what lets them match it to the paper in their hand: the clinic, the test,
 * the patient's initials, the release date, and whether a correction has since replaced it. Never
 * a finding, a figure or the file. Whoever holds the report already has those; whoever only holds
 * a forwarded link should learn nothing more than that a report exists.
 *
 * Two answers besides "genuine", and both matter:
 *   replaced   a correction was released after this report. The paper is real but out of date,
 *              which an employer reading a fitness result needs to know.
 *   not found  no report carries this code. The page says to call the clinic rather than
 *              "this is a forgery": a code misread off a crumpled print reads the same way.
 */
class VerificationService {
  async verify(rawCode) {
    const code = normalizeCode(rawCode);
    if (!code) {
      throw new ValidationError('That is not a verification code. It has 10 letters and numbers, like ABCDE-12345.');
    }

    const report = await resultRepository.findByVerificationCode(code);
    if (!report) {
      throw new NotFoundError(
        'No report from this clinic carries that code. Check it against the report, or call the clinic to confirm it.'
      );
    }

    return {
      code: formatCode(code),
      status: report.replaced_at ? 'replaced' : 'genuine',
      clinic: env.CLINIC_NAME,
      clinicPhone: env.CLINIC_PHONE,
      testName: report.test_name,
      department: report.category_name,
      patientInitials: patientInitials(report.first_name, report.last_name),
      releasedAt: report.authorised_at,
      version: report.version,
      replacedAt: report.replaced_at || null,
    };
  }
}

module.exports = new VerificationService();
