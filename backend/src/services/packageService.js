const packageRepository = require('../repositories/packageRepository');
const testRepository = require('../repositories/testRepository');
const db = require('../config/database');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * The clinic's package deals. See migrations.md [1.45.0].
 *
 * ── The one piece of real logic here: allocation ─────────────────────────────────────────────
 *
 * A package is sold at a fixed price, but it is BOOKED as its component tests, because that is
 * what reaches each department's worklist. So the fixed price has to be spread back across those
 * components, and the split has to be exact — `visit_tests.price_at_time` is what every downstream
 * total is computed from (the visit subtotal, the statutory discount base, the cashier's drawer,
 * and `reportRepository`'s per-department revenue share). A split that does not sum to the package
 * price is a visit that bills the wrong amount.
 *
 * Proportional to list price, with the rounding remainder placed on the largest component:
 *
 *     Package A ₱1,450, components at list ₱1,150
 *       Pelvic Ultrasound 500 -> 630.43     CBC              180 -> 226.96
 *       Blood Typing      190 -> 239.57     Hepa B Screening 190 -> 239.57
 *       Urinalysis         90 -> 113.47     HIV Screening      0 ->   0.00
 *                                                            sum = 1450.00
 *
 * Proportional rather than even, because the components are not equal work: an even split would
 * credit a ₱90 urinalysis and a ₱500 ultrasound identically, and the per-department revenue report
 * would then quietly misstate which department earned the money.
 */
class PackageService {
  /** Active packages, shaped one object per package with a `tests` array. */
  async listActive() {
    return this.shape(await packageRepository.findActiveWithItems());
  }

  /** Every package, retired ones included, for the management screen. */
  async listAll() {
    return this.shape(await packageRepository.findAllWithItems(), true);
  }

  /** Rows (one per component) -> one object per package with a `tests` array. */
  shape(rows, includeInactive = false) {
    const byId = new Map();
    for (const r of rows) {
      if (!byId.has(r.id)) {
        byId.set(r.id, {
          id: r.id, code: r.code, name: r.name, price: r.price,
          description: r.description,
          ...(includeInactive ? { isActive: r.is_active } : {}),
          tests: [],
        });
      }
      // LEFT JOIN: a package with no components yet yields one row of nulls, and it is a real
      // package that the screen has to be able to show and finish.
      if (r.test_id) {
        byId.get(r.id).tests.push({
          id: r.test_id, name: r.test_name, price: r.test_price,
          preparation: r.test_preparation, categoryName: r.category_name,
        });
      }
    }
    return [...byId.values()];
  }

  /**
   * Create or update a package and its component list together, in one transaction.
   *
   * Together, because a package IS its price plus its components: committing one without the other
   * leaves a bundle that charges for work it no longer contains, or contains work it does not
   * charge for. Both are wrong in a way that reaches a patient's bill.
   */
  async save(id, { code, name, price, description, isActive, testIds }) {
    if (testIds !== undefined) {
      if (!Array.isArray(testIds)) {
        const error = new Error('List the tests in the package.');
        error.statusCode = 400;
        throw error;
      }
      const unique = [...new Set(testIds.map((t) => parseInt(t, 10)))];
      if (unique.length < 2) {
        const error = new Error('A package needs at least two tests — otherwise it is just a test.');
        error.statusCode = 400;
        throw error;
      }
      const found = await testRepository.findTestsByIds(unique);
      const missing = unique.filter((tid) => !found.some((t) => t.id === tid));
      if (missing.length) {
        const error = new Error(`Test${missing.length > 1 ? 's' : ''} with ID ${missing.join(', ')} not found`);
        error.statusCode = 404;
        throw error;
      }
      // [1.124.0] A probe built a package around a retired test: booking it would put a service
      // the clinic no longer does onto a patient's visit, at a share of the package price.
      const retired = found.filter((t) => !t.is_active);
      if (retired.length) {
        const error = new Error(`${retired.map((t) => t.name).join(', ')} ${retired.length > 1 ? 'are' : 'is'} no longer offered, so it cannot be in a package.`);
        error.statusCode = 400;
        throw error;
      }
    }

    return await db.withTransaction(async () => {
      let pkg;
      if (id) {
        pkg = await packageRepository.update(id, { code, name, price, description, isActive });
        if (!pkg) {
          const error = new Error(`Package ${id} not found`);
          error.statusCode = 404;
          throw error;
        }
      } else {
        pkg = await packageRepository.create({ code, name, price, description });
      }
      if (testIds !== undefined) {
        await packageRepository.setItems(pkg.id, [...new Set(testIds.map((t) => parseInt(t, 10)))]);
      }
      return pkg;
    });
  }

  /**
   * Spread a package price across its components so the parts sum to the whole, exactly.
   *
   * Returns [{ testId, priceAtTime }]. Exported for its own sake so the arithmetic can be tested
   * without touching a visit.
   */
  allocate(packagePrice, components) {
    const price = round2(packagePrice);
    if (components.length === 0) return [];

    const listTotal = components.reduce((sum, c) => sum + Number(c.price || 0), 0);

    // Every component priceless (or a free package): fall back to an even split, because
    // proportional has nothing to be proportional TO. Same exact-sum guarantee.
    const shares = components.map((c) => {
      const weight = listTotal > 0 ? Number(c.price || 0) / listTotal : 1 / components.length;
      return { testId: c.testId, listPrice: Number(c.price || 0), priceAtTime: round2(price * weight) };
    });

    // Rounding remainder onto the largest component, so the sum is the package price to the
    // centavo. Largest rather than first: a few centavos land where they are least visible as a
    // proportion, and it is deterministic for the same input.
    const allocated = shares.reduce((sum, s) => sum + s.priceAtTime, 0);
    const remainder = round2(price - allocated);
    if (remainder !== 0) {
      let target = 0;
      for (let i = 1; i < shares.length; i += 1) {
        if (shares[i].priceAtTime > shares[target].priceAtTime) target = i;
      }
      shares[target].priceAtTime = round2(shares[target].priceAtTime + remainder);
    }

    return shares.map(({ testId, priceAtTime }) => ({ testId, priceAtTime }));
  }

  /**
   * Attach one or more packages to a visit, expanded into their component tests.
   *
   * No transaction of its own — the caller owns that, exactly as `testService.attachTests` does,
   * because booking calls this inside the transaction that is also minting the visit.
   *
   * A component that is ALSO booked individually on the same visit collides with
   * `uq_visit_tests_visit_test`. `addTestToVisit` is ON CONFLICT DO NOTHING, so the row that
   * landed first wins and the patient is not charged twice for one test — which is the right
   * outcome, and the reason the caller re-reads rather than trusting what it inserted.
   */
  async attachPackages(patientVisitId, packageIds) {
    const uniqueIds = [...new Set((packageIds || []).map((id) => parseInt(id, 10)))]
      .filter((id) => Number.isInteger(id));
    if (uniqueIds.length === 0) return [];

    const rows = await packageRepository.findByIdsWithItems(uniqueIds);

    // Group, then check every requested id resolved — all of them reported at once rather than
    // one round trip per bad id.
    const packages = new Map();
    for (const r of rows) {
      if (!packages.has(r.id)) {
        packages.set(r.id, { id: r.id, code: r.code, price: r.price, isActive: r.is_active, components: [] });
      }
      packages.get(r.id).components.push({ testId: r.test_id, price: r.test_price });
    }

    const missing = uniqueIds.filter((id) => !packages.has(id));
    if (missing.length > 0) {
      const error = new Error(
        `Package${missing.length > 1 ? 's' : ''} with ID ${missing.join(', ')} not found`
      );
      error.statusCode = 404;
      throw error;
    }

    const inactive = [...packages.values()].filter((p) => p.isActive === false);
    if (inactive.length > 0) {
      const error = new Error(
        `Package ${inactive.map((p) => p.code).join(', ')} is no longer offered`
      );
      error.statusCode = 400;
      throw error;
    }

    for (const pkg of packages.values()) {
      for (const { testId, priceAtTime } of this.allocate(pkg.price, pkg.components)) {
        await testRepository.addTestToVisit({
          patientVisitId,
          testId,
          priceAtTime,
          packageId: pkg.id,
        });
      }
    }

    return await testRepository.findTestsByVisitId(patientVisitId);
  }
}

module.exports = new PackageService();
