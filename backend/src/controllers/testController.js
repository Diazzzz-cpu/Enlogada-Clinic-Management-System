const testService = require('../services/testService');

class TestController {
  async getAll(req, res, next) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const tests = await testService.getAllTests(includeInactive);
      return res.status(200).json({
        status: 'success',
        data: { tests }
      });
    } catch (err) {
      next(err);
    }
  }

  async getById(req, res, next) {
    try {
      const { id } = req.params;
      const test = await testService.getTestById(id);
      return res.status(200).json({
        status: 'success',
        data: { test }
      });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const { categoryId, name, price, preparation } = req.body;

      if (!categoryId || !name || price === undefined) {
        return res.status(400).json({
          status: 'error',
          message: 'Category ID, name, and price are required.'
        });
      }

      // Optional [1.24.0]. Blank and absent both mean "no preparation needed", which is the
      // common case, so they are normalised to NULL rather than to an empty instruction.
      const test = await testService.createTest({ categoryId, name, price, preparation });
      return res.status(201).json({
        status: 'success',
        message: 'Test created successfully.',
        data: { test }
      });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const { id } = req.params;
      const { categoryId, name, price, isActive, preparation } = req.body;

      if (!categoryId || !name || price === undefined) {
        return res.status(400).json({
          status: 'error',
          message: 'Category ID, name, and price are required.'
        });
      }

      // `isActive` is passed through as-is, undefined included. It used to default to `true`
      // here, which turned "I did not mention it" into "switch it on" — see testService.updateTest.
      const test = await testService.updateTest(id, {
        categoryId,
        name,
        price,
        preparation,
        isActive
      });
      return res.status(200).json({
        status: 'success',
        message: 'Test updated successfully.',
        data: { test }
      });
    } catch (err) {
      next(err);
    }
  }

  async updatePrice(req, res, next) {
    try {
      const { id } = req.params;
      const { price } = req.body;

      if (price === undefined || isNaN(price)) {
        return res.status(400).json({
          status: 'error',
          message: 'Price is required and must be a valid number.'
        });
      }

      const test = await testService.updateTestPrice(id, parseFloat(price));
      return res.status(200).json({
        status: 'success',
        message: 'Test price updated successfully.',
        data: { test }
      });
    } catch (err) {
      next(err);
    }
  }

  async getCategories(req, res, next) {
    try {
      const categories = await testService.getCategories();
      return res.status(200).json({
        status: 'success',
        data: { categories }
      });
    } catch (err) {
      next(err);
    }
  }

  async addTestsToVisit(req, res, next) {
    try {
      const { patientVisitId, testIds, packageIds } = req.body;

      const tests = Array.isArray(testIds) ? testIds : [];
      const packages = Array.isArray(packageIds) ? packageIds : [];

      // Either is enough on its own — a patient can book Package A and nothing else.
      if (!patientVisitId || (tests.length === 0 && packages.length === 0)) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient visit ID and at least one test or package are required.'
        });
      }

      const visitTests = await testService.addTestsToVisit(patientVisitId, tests, req.user, packages);
      return res.status(201).json({
        status: 'success',
        message: `${visitTests.length} test(s) added to visit.`,
        data: { visitTests }
      });
    } catch (err) {
      next(err);
    }
  }

  async removeTestFromVisit(req, res, next) {
    try {
      const result = await testService.removeTestFromVisit(
        parseInt(req.params.visitTestId, 10),
        req.user
      );
      return res.status(200).json({
        status: 'success',
        // Names what was ACTUALLY removed: asking to remove one component of a package removes
        // the bundle, and a screen that reports "removed" without saying so leaves the reader
        // wondering why four rows disappeared.
        message: result.packageName
          ? `Removed ${result.packageName} — all ${result.removed} tests in the package.`
          : `Removed ${result.testName}.`,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async getVisitTests(req, res, next) {
    try {
      const { visitId } = req.params;
      const visitTests = await testService.getVisitTests(visitId);
      return res.status(200).json({
        status: 'success',
        data: { visitTests }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new TestController();
