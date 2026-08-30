const db = require('../config/database');
const testRepository = require('../repositories/testRepository');
const packageService = require('./packageService');
const visitRepository = require('../repositories/visitRepository');
const patientService = require('./patientService');
const auditService = require('./auditService');
const paymentRepository = require('../repositories/paymentRepository');

// Mirrors appointmentService.js's assertClientOwnsPatient exactly. POST /tests/visit-tests
// authorizes the Client role (for self-service booking) but previously performed no ownership
// check at all — a client could attach tests to, and be billed against, any arbitrary
// patientVisitId. Known gap, deferred since the pre-implementation remediation pass; fixed here
// as part of Module 15 (visit_tests attachment is this module's own scope).
async function assertClientOwnsVisit(requestingUser, patientVisitId) {
  if (!requestingUser?.roles?.includes('Client')) return; // staff roles are not ownership-restricted
  const visit = await visitRepository.findVisitById(patientVisitId);
  if (!visit) {
    const error = new Error('Visit not found');
    error.statusCode = 404;
    throw error;
  }
  const patient = await patientService.getPatientById(visit.patient_id);
  if (patient.user_id !== requestingUser.userId) {
    const error = new Error('Access forbidden. This visit does not belong to your account.');
    error.statusCode = 403;
    throw error;
  }
}

class TestService {
  async getAllTests(includeInactive = false) {
    return await testRepository.findAllTests(includeInactive);
  }

  async getTestById(id) {
    const test = await testRepository.findTestById(id);
    if (!test) {
      const error = new Error('Test not found');
      error.statusCode = 404;
      throw error;
    }
    return test;
  }

  async createTest(testData) {
    return await testRepository.createTest(testData);
  }

  /**
   * An omitted field keeps what the row already has. It does NOT reset it.
   *
   * `testRepository.updateTest` writes every column unconditionally, so a caller that sends only
   * the fields it cares about silently destroys the ones it left out. The Services Catalogue's
   * status toggle did exactly that: it sent categoryId, name, price and isActive, and every
   * activate/deactivate wiped the test's patient preparation. Reproduced on Fasting Blood Sugar,
   * where it deleted "Nothing to eat or drink except water for 8 hours" — the sentence [1.25.0]
   * puts in the day-before reminder. The patient is then reminded of an appointment with no
   * fasting instruction, eats breakfast, and the visit is wasted.
   *
   * `isActive` had the same shape from the other direction: the controller defaulted an absent
   * value to `true`, so a PUT that omitted it would quietly re-activate a service someone had
   * deliberately taken off the public booking form.
   *
   * Distinguishing `undefined` (not sent) from `''`/`null` (sent, meaning clear it) is what makes
   * a partial update safe. Deciding it here rather than in the controller keeps it true for every
   * caller, including any future one that never reads this comment.
   */
  async updateTest(id, testData) {
    const existing = await testRepository.findTestById(id);
    if (!existing) {
      const error = new Error('Test not found');
      error.statusCode = 404;
      throw error;
    }
    return await testRepository.updateTest(id, {
      ...testData,
      preparation: testData.preparation === undefined ? existing.preparation : testData.preparation,
      isActive: testData.isActive === undefined ? existing.is_active : testData.isActive,
    });
  }

  async updateTestPrice(id, price) {
    const existing = await testRepository.findTestById(id);
    if (!existing) {
      const error = new Error('Test not found');
      error.statusCode = 404;
      throw error;
    }
    return await testRepository.updateTestPrice(id, price);
  }

  async getCategories() {
    return await testRepository.findAllCategories();
  }

  /**
   * Attaches a set of tests to a visit, pricing each at the catalogue price right now.
   *
   * All-or-nothing, and it did not used to be. The loop committed each test as it went, so a bad
   * id partway through — a test deleted since the page loaded, or simply mistyped — left the
   * earlier tests attached and then threw. The receptionist sees an error and retries the whole
   * list, which now collides with uq_visit_tests_visit_test and surfaces as a bare 500. Nothing
   * in any endpoint tells them which of the tests actually landed, and getBillingSummary prices
   * strictly from visit_tests, so the patient is billed for a partial workup while the missing
   * test never reaches its modality.
   *
   * Validating every id up front means a bad id costs nothing: the batch rolls back and the retry
   * is clean.
   *
   * No transaction and no ownership check of its own — both belong to the caller, because the two
   * callers need different ones. `addTestsToVisit` below wraps it for Reception's walk-in flow;
   * `appointmentService.createAppointment` calls it inside the transaction that is also minting
   * the visit.
   *
   * It must NOT call assertClientOwnsVisit. Under the booking transaction that helper would be
   * reading a `patient_visits` row the transaction has not committed — which used to mean a
   * different pooled connection and a guaranteed 404, and even now that every query joins the
   * ambient transaction it is redundant: appointmentService asserts ownership on the patient
   * before it opens the transaction, and then mints the visit itself.
   */
  async attachTests(patientVisitId, testIds) {
    // Normalised to numbers up front: JSON callers send numbers, multipart sends strings, and the
    // catalogue Map below is keyed on the integer id Postgres returns. A string id would miss
    // every lookup and report a perfectly real test as "not found".
    const uniqueIds = [...new Set((testIds || []).map((id) => parseInt(id, 10)))];
    if (uniqueIds.length === 0) return [];

    // One query for every price instead of one per test — this is the receptionist's hot path,
    // and a six-test workup was twelve round trips. It also matters inside the booking
    // transaction, where the per-id loop held the slot's advisory lock for its whole duration.
    const catalogue = await testRepository.findTestsByIds(uniqueIds);
    const byId = new Map(catalogue.map((t) => [t.id, t]));

    // Every id checked before anything is written, and all of them reported at once — the old
    // loop named only the first bad id, so a receptionist fixed them one round trip at a time.
    const missing = uniqueIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const error = new Error(
        `Test${missing.length > 1 ? 's' : ''} with ID ${missing.join(', ')} not found`
      );
      error.statusCode = 404;
      throw error;
    }

    for (const testId of uniqueIds) {
      await testRepository.addTestToVisit({
        patientVisitId,
        testId,
        priceAtTime: byId.get(testId).price
      });
    }

    // Re-read rather than collecting the inserts: addTestToVisit is ON CONFLICT DO NOTHING, so a
    // row that already existed returns undefined. Reading back gives the caller the true set.
    return await testRepository.findTestsByVisitId(patientVisitId);
  }

  /**
   * Take a test off a visit. [1.55.0]
   *
   * Reception attaches tests at registration, so the queue's job is EDITING that list — a patient
   * who changes their mind at the desk, or a test picked in error. There was no way to do it: the
   * dialog only ever added, so a wrong test stayed on the visit and reached the cashier as a
   * charge somebody had to explain.
   *
   * ── Four reasons to refuse, and each is a different kind of damage ──────────────────────────
   *
   *   the visit is PAID      the receipt froze what was charged. Removing a line afterwards makes
   *                          the bill disagree with a document the patient is holding, and the
   *                          drawer disagree with both.
   *   a RESULT exists        that is a clinical record. Superseded versions count: an amended
   *                          report's history is as much a record as its current version.
   *   status is not Pending  'Processing' means the department already has it; 'Waiting for
   *                          Release' means findings are written. Neither is reception's to undo.
   *   it belongs to a PACKAGE removing one component leaves the rest summing to less than the
   *                          bundle's fixed price while still calling itself that bundle. So the
   *                          whole package goes, or none of it does — and only if every line in it
   *                          passes the tests above.
   *
   * Returns what was actually removed, because for a package that is more than the caller asked
   * for and the screen has to be able to say so.
   */
  async removeTestFromVisit(visitTestId, requestingUser) {
    const line = await testRepository.findVisitTestForRemoval(visitTestId);
    if (!line) {
      const error = new Error('That test is not on this visit.');
      error.statusCode = 404;
      throw error;
    }

    await assertClientOwnsVisit(requestingUser, line.patient_visit_id);

    const refuse = (message) => {
      const error = new Error(message);
      error.statusCode = 409;
      throw error;
    };

    if (line.visit_paid) {
      refuse('This visit has already been paid. Removing a test now would change a bill the patient has a receipt for — reverse the payment first if it was charged in error.');
    }
    if (line.has_result) {
      refuse(`${line.test_name} already has a result recorded. A result is a clinical record and cannot be removed by taking the test off the visit.`);
    }
    if (line.status !== 'Pending') {
      refuse(`${line.test_name} is already with the department (${line.status}). Cancel it there rather than removing it here.`);
    }

    // A bundle is removed whole. Every line in it must pass the same tests, or none moves.
    let ids = [visitTestId];
    let removedPackage = null;
    if (line.package_id) {
      const lines = await testRepository.findPackageLinesOnVisit(line.patient_visit_id, line.package_id);
      const blocked = lines.find((l) => l.has_result || l.status !== 'Pending');
      if (blocked) {
        refuse(`${line.package_name || 'This package'} cannot be removed: ${blocked.test_name} is already ${blocked.has_result ? 'reported' : blocked.status.toLowerCase()}. A package is billed as one price, so it is removed as one thing.`);
      }
      ids = lines.map((l) => l.id);
      removedPackage = line.package_name;
    }

    const removed = await testRepository.deleteVisitTests(ids);

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'visit_test.removed',
      entityType: 'patient_visit',
      entityId: line.patient_visit_id,
      description: removedPackage
        ? `Removed package ${removedPackage} (${removed.length} tests) from the visit`
        : `Removed ${line.test_name} from the visit`,
    });

    return { removed: removed.length, packageName: removedPackage, testName: line.test_name };
  }

  async addTestsToVisit(patientVisitId, testIds, requestingUser, packageIds = []) {
    await assertClientOwnsVisit(requestingUser, patientVisitId);

    // ── A settled visit takes no more work ──────────────────────────────────────────────────
    //
    // Measured before this guard existed: pay a ₱190 visit, add a ₱190 Laboratory test, and the
    // new row is created with status 'Processing' — released straight to the department worklist,
    // because the visit is paid. The bill does not move, and POST /payments then refuses with
    // "This visit has already been paid" (uq_payments_one_paid_per_visit allows one settled row
    // per visit). So the clinic performs the test and has no way to charge for it.
    //
    // Refusing is the honest fix rather than re-opening billing: a second settled payment per
    // visit is exactly what that unique index exists to prevent, and a receipt already handed to
    // the patient should not silently acquire another line.
    //
    // Removal is refused on the same visits for the mirror reason — it would change a bill the
    // patient holds a receipt for. A paid visit is finished in both directions.
    if (await paymentRepository.hasPaidPayment(patientVisitId)) {
      const error = new Error(
        'This visit has already been paid, so tests can no longer be added to it. Open a new visit for the extra work, or reverse the payment first if the bill was wrong.'
      );
      error.statusCode = 409;
      throw error;
    }

    // Standalone callers (Reception's walk-in flow) get their own transaction. Previously this
    // looped bare db.query calls, so a failure partway through left a half-attached visit.
    //
    // Packages ride inside the SAME transaction as the individual tests. A visit that took the
    // loose tests and then failed on the bundle would be billed for half a workup, and the patient
    // would be told the booking succeeded.
    //
    // Packages go in FIRST, deliberately. Both writes are ON CONFLICT DO NOTHING against
    // uq_visit_tests_visit_test, so whichever lands first sets the price for a test that appears
    // in both. The package's allocated share is the one to keep: a component inside a fixed-price
    // bundle must not silently revert to its list price and inflate the bundle.
    return await db.withTransaction(async () => {
      await packageService.attachPackages(patientVisitId, packageIds);
      await this.attachTests(patientVisitId, testIds);
      // Re-read rather than returning attachTests' value: it short-circuits to [] when there are
      // no loose tests, which for a package-only booking discarded the rows the line above had
      // just written and reported "0 test(s) added" for a visit carrying six.
      return await testRepository.findTestsByVisitId(patientVisitId);
    });
  }

  async getVisitTests(patientVisitId) {
    return await testRepository.findTestsByVisitId(patientVisitId);
  }

  async updateVisitTestStatus(visitTestId, status) {
    return await testRepository.updateVisitTestStatus(visitTestId, status);
  }
}

module.exports = new TestService();
