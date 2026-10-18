/**
 * Single source of truth for the test_category <-> diagnostic-staff-role relationship.
 *
 * This mapping previously existed only as a private const inside resultService.js
 * (STAFF_CATEGORY_MAP). It is now needed in a second place — routing a released ticket's
 * notification to the correct modality department — so it lives here rather than being
 * duplicated, per the backend `constants/` layer in .agents/PROJECT_STRUCTURE.md.
 *
 * [1.50.0] '2D Echo' was removed from all three maps when the clinic confirmed it does not offer
 * the service and the last visit_tests row referencing it was gone. 'ECG' remains absent from
 * CATEGORY_TO_STAFF_ROLE for its own, older reason — see below.
 */

// Role name -> the test_categories this role may act on.
const STAFF_ROLE_TO_CATEGORIES = {
  'Laboratory Staff': ['Laboratory'],
  'Xray Staff': ['Xray'],
  'Ultrasound Staff': ['Ultrasound']
};

// test_categories.name -> the role that should be notified when a ticket in that category is
// released. 'ECG' is deliberately absent: it is a real seeded category with no dedicated staff
// role, so its tickets are overseen by Admin/SuperAdmin only. Returning undefined for it is
// correct behaviour, not a missing entry.
const CATEGORY_TO_STAFF_ROLE = {
  Laboratory: 'Laboratory Staff',
  Xray: 'Xray Staff',
  Ultrasound: 'Ultrasound Staff'
};

// The categories a diagnostic worklist may legitimately be queried for.
const DIAGNOSTIC_CATEGORIES = ['Laboratory', 'Xray', 'Ultrasound'];

/**
 * Departments whose results are NOT issued through this system. [1.129.0]
 *
 * The X-ray department gives its results through its own system, so nothing is uploaded,
 * released, emailed or verified here for an X-ray test. It still queues, bills and is counted
 * like any other: the worklist marks an exam DONE (visit_tests.performed_at / performed_by), and
 * the reports count those exams beside the released reports of the other departments.
 *
 * Mirrored in frontend/src/lib/categories.js (`NO_REPORT_CATEGORIES`). Change both together.
 */
const NO_REPORT_CATEGORIES = ['Xray'];

/** Whether results for this department are uploaded and released in this system. */
const issuesReports = (categoryName) => !NO_REPORT_CATEGORIES.includes(categoryName);

/** A department's name as people say it: 'Xray' is stored, "X-ray" is written. */
const CATEGORY_LABELS = { Xray: 'X-ray' };
const categoryLabel = (categoryName) => CATEGORY_LABELS[categoryName] || categoryName;

/** Given a set of category names, the distinct staff roles that own them. */
function staffRolesForCategories(categoryNames = []) {
  const roles = new Set();
  for (const name of categoryNames) {
    const role = CATEGORY_TO_STAFF_ROLE[name];
    if (role) roles.add(role);
  }
  return [...roles];
}

/**
 * Which modalities an account may act on. [1.20.0]
 *
 * Two sources, unioned: the departments implied by the account's roles (a Laboratory Staff always
 * has Laboratory), and any granted directly to the account in user_departments — which is how a
 * lab tech covers the X-Ray room for a week without being given a second role.
 *
 * Admin and SuperAdmin get every category. They are the oversight roles; a department-scoped
 * Admin could not answer "which room is behind today?", which is most of the job. If the clinic
 * later wants a department-scoped Admin, that is a permission (`patients:read_all_departments`),
 * not a change here.
 *
 * Returns `null` — not an empty array — for the unrestricted case, so a caller can tell "may see
 * everything" apart from "may see nothing". Those two collapsing into `[]` is the classic way an
 * access check ends up inverted.
 */
function departmentsForUser(user) {
  const roles = user?.roles || [];
  if (roles.includes('SuperAdmin') || roles.includes('Admin')) return null;

  const departments = new Set(user?.granted_departments || user?.grantedDepartments || []);
  for (const role of roles) {
    for (const category of STAFF_ROLE_TO_CATEGORIES[role] || []) {
      departments.add(category);
    }
  }
  return [...departments].sort();
}

/** Whether this user may act on `categoryName`. `null` departments means unrestricted. */
function userCoversCategory(departments, categoryName) {
  if (departments === null) return true;
  return (departments || []).includes(categoryName);
}

module.exports = {
  STAFF_ROLE_TO_CATEGORIES,
  CATEGORY_TO_STAFF_ROLE,
  DIAGNOSTIC_CATEGORIES,
  NO_REPORT_CATEGORIES,
  issuesReports,
  categoryLabel,
  staffRolesForCategories,
  departmentsForUser,
  userCoversCategory
};
