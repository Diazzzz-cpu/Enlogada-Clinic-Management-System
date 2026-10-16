/**
 * Where an HMO claimed test stands, from BOTH of its decisions. [1.125.0]
 *
 * A claim is decided at two levels: the claim (hmo_requests.status, approve/reject) and each test
 * on it (hmo_request_tests.approval_status). The bill read only the test's own column, so after an
 * Admin approved a whole claim every test on it still read Pending at the till: the cashier was
 * told "The bill is ready to settle", the bill showed no coverage, and the till then refused to
 * take payment over tests "still waiting for the HMO". Before [1.123.0] it charged the patient in
 * full instead. The HMO report already combined the two, so it disagreed with the till about the
 * same claim.
 *
 * One rule, for the bill, the worklist and the report:
 *   - a refusal at EITHER level wins (a withdrawn claim, 'Cancelled', counts as refused);
 *   - otherwise an approval at EITHER level covers the test;
 *   - otherwise it is still Pending.
 *
 * @param {string} hr   alias of hmo_requests
 * @param {string} hrt  alias of hmo_request_tests
 * @returns {string} a SQL expression yielding 'Rejected' | 'Approved' | 'Pending'
 */
const hmoEffectiveStatus = (hr, hrt) => `CASE
    WHEN ${hr}.status IN ('Rejected', 'Cancelled') OR ${hrt}.approval_status = 'Rejected' THEN 'Rejected'
    WHEN ${hr}.status = 'Approved' OR ${hrt}.approval_status = 'Approved' THEN 'Approved'
    ELSE 'Pending'
  END`;

module.exports = { hmoEffectiveStatus };
