/**
 * "Who sees what": the access matrix in the clinic's own words. [1.78.0]
 *
 * Steven asked for the grid from the decisions page as the screen SuperAdmin assigns access on:
 * plain rows for the kinds of information (patient records, the queue, money…), a column for each
 * kind of staff, and in every cell a mark and a sentence saying what that role can do there. The
 * old screen was 32 checkboxes named `billing:process` and `patients:read_all_departments`, which
 * is how the system spells access and not how a clinic thinks about it.
 *
 * Nothing new is stored. The grid reads and writes the same role templates the old screen did
 * (`GET /rbac/matrix`, `PUT /rbac/roles/:id/permissions`); each row opens into one switch per
 * permission per role, and a cell's mark and sentence are worked out from those switches, so the
 * words can never disagree with what the server enforces. Pure, so the sentences are unit-tested
 * (tests/unit/whoSeesWhat.test.js).
 */

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** "a", "a and b", "a, b and c". */
function listWords(words) {
  const list = words.filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const sentence = (verbs) => capitalize(listWords(verbs));

/** The staff roles the grid edits, and how the clinic calls each one. */
export const ROLE_LABEL = {
  Receptionist: 'Front desk',
  Cashier: 'Cashier',
  'Laboratory Staff': 'Laboratory',
  'Xray Staff': 'X-Ray',
  'Ultrasound Staff': 'Ultrasound',
  Admin: 'Admin',
};
export const GRID_ROLES = Object.keys(ROLE_LABEL);

const ROOMS = ['Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'];

/**
 * The columns, as in the picture. The three departments share one: their roles are the same by
 * default, and a switch there sets all three. `SPLIT_COLUMNS` gives each its own for a clinic that
 * wants them to differ.
 */
export const COLUMNS = [
  { key: 'desk', label: 'Front desk', roles: ['Receptionist'] },
  { key: 'till', label: 'Cashier', roles: ['Cashier'] },
  { key: 'rooms', label: 'Lab, X-Ray, Ultrasound', roles: ROOMS, ownDepartment: true },
  { key: 'admin', label: 'Admin', roles: ['Admin'] },
];
export const SPLIT_COLUMNS = [
  COLUMNS[0],
  COLUMNS[1],
  { key: 'lab', label: 'Laboratory', roles: ['Laboratory Staff'], ownDepartment: true },
  { key: 'xray', label: 'X-Ray', roles: ['Xray Staff'], ownDepartment: true },
  { key: 'ultrasound', label: 'Ultrasound', roles: ['Ultrasound Staff'], ownDepartment: true },
  COLUMNS[3],
];

/**
 * Not switchable here. Deciding who may do what is the one thing that separates SuperAdmin from a
 * very capable Admin, so the grid shows it and leaves it alone.
 */
export const LOCKED = { 'rbac:manage': 'SuperAdmin only' };

/**
 * In the permissions table, and checked by nothing. `tests:results_write` is referenced by no route,
 * no service and no seed script, and held by no role (checked 2026-09-14); `results:write` is the
 * permission that gates recording findings. A switch for it would change nothing, which is worse
 * than no switch: someone flips it, sees it save, and believes they granted something. [1.53.0]
 */
export const UNUSED = { 'tests:results_write': 'results:write is the permission that is checked' };

/**
 * The rows. Each permission has the words a switch is labelled with, which also finish the sentence
 * "Front desk can now …" in the list of unsaved changes, so every label starts with a verb.
 */
const AREAS = [
  {
    key: 'patients', label: 'Patient records', note: 'find, register, edit',
    permissions: [
      { name: 'patients:read', label: 'Find and open patient records' },
      { name: 'patients:create', label: 'Register new patients' },
      { name: 'patients:update', label: "Correct a patient's details" },
      { name: 'patients:read_all_departments', label: 'Open records from every department, not only their own' },
    ],
    summarize: (h) => {
      const verbs = [h('patients:read') && 'find', h('patients:create') && 'register', h('patients:update') && 'edit'];
      if (!verbs.some(Boolean)) return 'No';
      if (h('patients:read_all_departments')) return `${sentence(verbs)}, every department`;
      return h('patients:read') ? `${sentence(verbs)}, own department only` : sentence(verbs);
    },
  },
  {
    key: 'queue', label: "Today's queue", note: 'visits and their tests',
    permissions: [
      { name: 'visits:read', label: "See today's queue and visit history" },
      { name: 'visits:create', label: 'Register a walk-in and give a queue ticket' },
      { name: 'visits:update', label: 'Change or cancel a visit' },
      { name: 'tests:assign', label: 'Add or remove tests on a visit' },
      { name: 'tests:read_assigned', label: 'See which tests are on a visit' },
    ],
    summarize: (h, all) => {
      if (all) return 'See and manage it';
      const verbs = [h('visits:read') && 'see it', h('visits:create') && 'register walk-ins', h('visits:update') && 'change visits', h('tests:assign') && 'add tests'];
      if (verbs.some(Boolean)) return sentence(verbs);
      return h('tests:read_assigned') ? 'See the tests on a visit' : 'No';
    },
  },
  {
    key: 'bookings', label: 'Bookings', note: 'appointments',
    permissions: [
      { name: 'appointments:read', label: 'See bookings' },
      { name: 'appointments:create', label: 'Book an appointment' },
      { name: 'appointments:update', label: 'Check in a booking, or mark a no-show' },
      { name: 'appointments:reschedule', label: 'Move a booking to another time' },
      { name: 'appointments:cancel', label: 'Cancel a booking' },
    ],
    summarize: (h) => {
      const verbs = [
        h('appointments:read') && 'see', h('appointments:create') && 'book', h('appointments:update') && 'check in',
        h('appointments:reschedule') && 'move', h('appointments:cancel') && 'cancel',
      ];
      return verbs.some(Boolean) ? sentence(verbs) : 'No';
    },
  },
  {
    key: 'money', label: 'Money', note: 'takings and receipts',
    permissions: [
      { name: 'billing:read', label: 'See takings, bills and receipts' },
      { name: 'billing:process', label: 'Take payments and issue receipts' },
      { name: 'billing:refund', label: 'Refund or void a payment' },
      { name: 'billing:discount', label: 'Give a Senior Citizen, PWD or other discount' },
      { name: 'billing:submit_proof', label: 'Send in proof of an online payment for a patient' },
    ],
    summarize: (h) => {
      const verbs = [
        h('billing:read') && 'see takings', h('billing:process') && 'take payments', h('billing:refund') && 'refund',
        h('billing:discount') && 'discount', h('billing:submit_proof') && 'send in online proofs',
      ];
      if (!verbs.some(Boolean)) return 'No';
      if (!h('billing:read')) return `${sentence(verbs)}; can't see takings`;
      return h('billing:process') ? sentence(verbs) : `${sentence(verbs)}; can't take payments`;
    },
  },
  {
    key: 'hmo', label: 'HMO claims',
    permissions: [
      { name: 'hmo:read', label: 'See HMO requests' },
      { name: 'hmo:request', label: 'Log an HMO request' },
      { name: 'hmo:approve', label: 'Approve or refuse HMO coverage' },
    ],
    summarize: (h) => {
      const verbs = [h('hmo:read') && 'see requests', h('hmo:request') && 'log them', h('hmo:approve') && 'decide them'];
      return verbs.some(Boolean) ? sentence(verbs) : 'No';
    },
  },
  {
    key: 'results', label: 'Results and reports',
    permissions: [
      { name: 'results:read', label: 'See worklists and released results' },
      { name: 'results:write', label: 'Write findings' },
      { name: 'results:release', label: 'Release a result to the patient' },
    ],
    summarize: (h, all, column) => {
      const verbs = [h('results:read') && 'read', h('results:write') && 'write', h('results:release') && 'release'];
      if (!verbs.some(Boolean)) return 'No';
      if (h('results:read') && !h('results:write') && !h('results:release')) return "Read them; can't write or release";
      return column?.ownDepartment ? `${sentence(verbs)}, own department` : sentence(verbs);
    },
  },
  {
    key: 'reports', label: 'Clinic reports', note: 'revenue, workload, the activity log',
    permissions: [
      { name: 'reports:view', label: 'See clinic reports' },
      { name: 'audit:view', label: 'See the activity log' },
    ],
    summarize: (h) => {
      const what = [h('reports:view') && 'clinic reports', h('audit:view') && 'the activity log'];
      return what.some(Boolean) ? `See ${listWords(what)}` : 'No';
    },
  },
  {
    key: 'services', label: 'Services and prices', note: 'the catalogue',
    permissions: [{ name: 'tests:manage', label: 'Change services, packages and prices' }],
    summarize: (h) => (h('tests:manage') ? 'Change services and prices' : 'No'),
  },
  {
    key: 'staff', label: 'Staff accounts', note: 'and permissions',
    permissions: [
      { name: 'staff:manage', label: 'Add and manage staff accounts' },
      { name: 'rbac:manage', label: 'Change who sees what' },
    ],
    summarize: (h) => (h('staff:manage') ? 'Staff accounts; permissions are SuperAdmin only' : 'No'),
  },
];

/**
 * The rows for the permissions the server actually has. A permission no row names — one added to
 * the catalogue after this was written — lands in "Other", under its own description, rather than
 * becoming a switch nobody can find.
 */
export function areasFor(permissions = []) {
  const known = new Map(permissions.map((p) => [p.name, p]));
  const placed = new Set();
  const rows = AREAS.map((area) => {
    const present = area.permissions.filter((p) => known.has(p.name));
    present.forEach((p) => placed.add(p.name));
    return { ...area, permissions: present };
  }).filter((area) => area.permissions.length > 0);

  const leftovers = permissions.filter((p) => !placed.has(p.name) && !UNUSED[p.name]);
  if (leftovers.length) {
    rows.push({
      key: 'other', label: 'Other',
      permissions: leftovers.map((p) => ({ name: p.name, label: capitalize(p.description || p.name) })),
      summarize: (h, all, column, area) => {
        const n = area.permissions.filter((p) => h(p.name)).length;
        return n ? `${n} of ${area.permissions.length}` : 'No';
      },
    });
  }
  return rows;
}

/** The words a permission's switch carries, wherever it is shown. */
export function permissionLabel(areas, name) {
  for (const area of areas) {
    const found = area.permissions.find((p) => p.name === name);
    if (found) return found.label;
  }
  return name;
}

/** The working copy: each grid role's permission names, as sets. */
export function draftFrom(rolePermissions = {}) {
  return Object.fromEntries(GRID_ROLES.map((role) => [role, new Set(rolePermissions[role] || [])]));
}

/** 'on' when every role in the column holds it, 'off' when none does, 'mixed' in between. */
export function cellState(draft, permission, roles) {
  const holding = roles.filter((role) => draft[role]?.has(permission)).length;
  if (holding === 0) return 'off';
  return holding === roles.length ? 'on' : 'mixed';
}

/**
 * Flip one switch. A column of several roles moves together: off or mixed turns it on for all of
 * them, on turns it off for all of them. A new draft, never a mutated one.
 */
export function toggle(draft, permission, roles) {
  const turnOn = cellState(draft, permission, roles) !== 'on';
  const next = { ...draft };
  roles.forEach((role) => {
    const set = new Set(next[role] || []);
    if (turnOn) set.add(permission);
    else set.delete(permission);
    next[role] = set;
  });
  return next;
}

/** One cell of a row: its mark and its sentence, from the switches underneath it. */
export function areaCell(area, draft, column) {
  const editable = area.permissions.filter((p) => !LOCKED[p.name]);
  const states = editable.map((p) => cellState(draft, p.name, column.roles));
  const mark = states.every((s) => s === 'on') ? 'yes' : states.every((s) => s === 'off') ? 'no' : 'part';
  const held = new Set(area.permissions.filter((p) => cellState(draft, p.name, column.roles) === 'on').map((p) => p.name));
  const text = area.summarize((name) => held.has(name), mark === 'yes', column, area);
  return { mark, text: states.includes('mixed') ? `${text} (differs by department)` : text };
}

/** Which roles' templates the draft changes, so only those are saved. */
export function changedRoles(original, draft) {
  return GRID_ROLES.filter((role) => {
    const before = original[role] || new Set();
    const after = draft[role] || new Set();
    return before.size !== after.size || [...after].some((p) => !before.has(p));
  });
}

function whoLabel(roles) {
  const together = ROOMS.every((r) => roles.includes(r));
  const names = roles.filter((r) => !(together && ROOMS.includes(r))).map((r) => ROLE_LABEL[r]);
  if (together) names.push('Lab, X-Ray and Ultrasound');
  return listWords(names);
}

/**
 * The unsaved changes, as sentences: "Front desk can now refund or void a payment." One per
 * permission and direction, with the roles it applies to named together, so a switch in the
 * departments' column reads as one change rather than three.
 */
export function describeChanges(original, draft, areas) {
  const groups = new Map();
  const note = (permission, on, role) => {
    const key = `${on ? 'on' : 'off'}|${permission}`;
    if (!groups.has(key)) groups.set(key, { permission, on, roles: [] });
    groups.get(key).roles.push(role);
  };
  GRID_ROLES.forEach((role) => {
    const before = original[role] || new Set();
    const after = draft[role] || new Set();
    after.forEach((p) => { if (!before.has(p)) note(p, true, role); });
    before.forEach((p) => { if (!after.has(p)) note(p, false, role); });
  });
  return [...groups.values()].map((g) => ({
    ...g,
    text: `${whoLabel(g.roles)} ${g.on ? 'can now' : 'can no longer'} ${lowerFirst(permissionLabel(areas, g.permission))}.`,
  }));
}

/**
 * Permissions no staff role would hold. Not refused — a clinic may mean it — but said, because only
 * SuperAdmin could then do it, and verifyRbacWiring reports exactly that as a fault.
 */
export function heldByNobody(draft, areas) {
  return areas
    .flatMap((area) => area.permissions)
    .filter((p) => !LOCKED[p.name] && GRID_ROLES.every((role) => !draft[role]?.has(p.name)))
    .map((p) => p.name);
}
