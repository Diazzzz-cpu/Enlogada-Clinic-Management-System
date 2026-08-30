// Single source of truth for staff/admin navigation AND for which console each destination
// opens.
//
// These two facts used to live apart: SidebarLayout.jsx owned the nav items and their role
// gating, while App.jsx owned an independent set of hardcoded id lists deciding what to render.
// They drifted, and the drift was a real defect rather than untidiness — the sidebar gated items
// with "does the user hold ANY of these roles", so a user holding both Receptionist and Cashier
// was correctly shown the Billing group, but App.jsx matched roles in a fixed order and returned
// the Receptionist console for every nav id. Clicking "Billing Queue" left them on the Front Desk
// screen, with the cashier features visible in the sidebar and unreachable in practice.
//
// Keeping the destination and its console in one record means a nav item cannot be offered
// without something being able to open it, and adding a screen is a single edit here.
import {
  LayoutDashboard, Users, ClipboardList, FileText, CreditCard, Calendar,
  FolderKanban, BarChart3, Activity, ShieldCheck, UserPlus, QrCode, History,
  Receipt, FlaskConical, Stethoscope, Scan, Wallet, CalendarCog } from 'lucide-react';

// Which top-level screen component handles a destination. App.jsx maps these to real
// components; this module stays free of component imports so it can be used from anywhere
// without a cycle.
export const CONSOLE = {
  ADMIN: 'admin',
  RECEPTION: 'reception',
  CASHIER: 'cashier',
  DIAGNOSTIC: 'diagnostic',
  SERVICES_CATALOG: 'services-catalog',
  SUPERADMIN: 'superadmin',
  ACCOUNT: 'account',
};

const ADMINS = ['Admin', 'SuperAdmin'];

// The one boundary a permission can never cross. [1.20.0]
//
// Everything else about access is now delegable from the Role-Permission Matrix — including
// crossing between departments, which is the whole point of the change. This is the exception:
// a patient account is a different kind of thing from a staff account, and no tick in any
// matrix should be able to put one on a diagnostic worklist or a billing queue. A user holding
// Client *and* a staff role (the multirole test account) is staff for this purpose.
const CLIENT_ROLE = 'Client';
const isStaff = (roles = []) => roles.some((r) => r !== CLIENT_ROLE);

// Separation of duties note, retained because the reasoning still holds and is easy to lose:
// Admin is the clinic manager, and every action inside a department console is recorded under
// the actor's name — a released result carries its releasing clinician, a receipt carries the
// cashier who took the money. An Admin authoring clinical findings or capturing payment makes
// those records say something untrue about who did the work.
//
// That is now enforced by NOT granting Admin `results:write` / `billing:process` in the seeded
// matrix, rather than by a hardcoded role list here. The difference matters: a clinic that
// decides otherwise can tick the box, and one that does not, keeps the separation. The default
// is unchanged; only the ability to override it is new.

// Oversight/management destinations. Admin and SuperAdmin both reach these; the SuperAdmin-only
// console is separated out below rather than mixed in here.
export const MAIN_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roleRequired: ADMINS, console: CONSOLE.ADMIN },
  { id: 'staff', label: 'Staff Accounts', icon: Users, roleRequired: ADMINS, permission: 'staff:manage', console: CONSOLE.ADMIN },
  { id: 'service-requests', label: 'Service Requests', icon: ClipboardList, roleRequired: ADMINS, permission: 'hmo:read', console: CONSOLE.ADMIN },
  { id: 'services-cat', label: 'Services Catalog', icon: FileText, roleRequired: ADMINS, permission: 'tests:manage', console: CONSOLE.SERVICES_CATALOG },
  { id: 'cashier-monitoring', label: 'Cashier Monitoring', icon: CreditCard, roleRequired: ADMINS, permission: 'billing:read', console: CONSOLE.ADMIN },
  { id: 'appointments-list', label: 'Appointments', icon: Calendar, roleRequired: ADMINS, permission: 'appointments:read', console: CONSOLE.ADMIN },
  // Open to any member of staff who holds `patients:read` — which is all of them. [1.21.0]
  //
  // It was Admin/SuperAdmin only, which meant a lab tech could see a result but had no way to
  // look up the patient it belonged to. Widening it is safe because the *contents* are now
  // confined: without `patients:read_all_departments` a search returns only patients who have
  // had work in the searcher's own department, and opening anyone else's record 404s. The screen
  // says which departments it is showing, so a short list reads as scope rather than absence.
  { id: 'patient-records', label: 'Patient Records', icon: FolderKanban, staffOnly: true, permission: 'patients:read', console: CONSOLE.ADMIN },
  // Deliberately gated by ROLE alone, with no permission beside it. There is no `schedule:manage`
  // in the matrix, and minting one would mean a permission held by nobody until somebody
  // remembered to grant it — while the clinic's opening hours sat unchangeable, which is the state
  // this feature exists to end. Deciding when the clinic opens is the same tier as pricing and
  // staffing, both already Admin's. The API agrees: authorizeRoles('SuperAdmin', 'Admin').
  { id: 'clinic-schedule', label: 'Clinic Schedule', icon: CalendarCog, roleRequired: ADMINS, console: CONSOLE.ADMIN },
  { id: 'reports', label: 'Reports', icon: BarChart3, roleRequired: ADMINS, permission: 'reports:view', console: CONSOLE.ADMIN },
  { id: 'activity', label: 'Activity Log', icon: Activity, roleRequired: ADMINS, permission: 'audit:view', console: CONSOLE.ADMIN },
  { id: 'superadmin', label: 'Super Admin', icon: ShieldCheck, roleRequired: ['SuperAdmin'], permission: 'rbac:manage', console: CONSOLE.ADMIN },
];

// Department-facing destinations, grouped so a viewer who can see several departments at once
// gets a scannable sidebar rather than one flat list.
//
// ── What changed in [1.20.0], and why ──────────────────────────────────────────────────────────
// Every item here used to carry `roleRequired: ['Cashier', 'SuperAdmin']` and friends: a hardcoded
// list that a permission could not widen. That made the Role-Permission Matrix a liar. Ticking
// `billing:process` for Laboratory Staff saved, reported success, and did nothing — the nav item
// stayed hidden because the lab role was not in the list, and the API refused for the same reason.
// A matrix that cannot actually delegate is worse than no matrix, because someone reasonably
// believes they granted access and stops thinking about it.
//
// So the role list is gone. `staffOnly` is the only structural gate left, and `department` is the
// modality axis: a worklist needs both the permission AND cover for that room. A lab tech granted
// `billing:process` now really does get the Billing Queue — Billing names no department, so
// there is nothing else to satisfy — while a cashier granted `results:write` gets a worklist only
// for departments they have actually been assigned.
export const OPS_NAV_GROUPS = [
  {
    label: 'Front Desk',
    items: [
      { id: 'reception-queue', label: 'Active Queue', icon: Calendar, staffOnly: true, permission: 'visits:read', console: CONSOLE.RECEPTION },
      { id: 'reception-walkin', label: 'Walk-In Registration', icon: UserPlus, staffOnly: true, permission: 'visits:create', console: CONSOLE.RECEPTION },
      { id: 'reception-checkin', label: 'Appointment Check-In', icon: QrCode, staffOnly: true, permission: 'appointments:update', console: CONSOLE.RECEPTION },
      { id: 'reception-history', label: 'Visit History', icon: History, staffOnly: true, permission: 'visits:read', console: CONSOLE.RECEPTION },
    ],
  },
  {
    label: 'Billing',
    items: [
      { id: 'cashier-queue', label: 'Billing Queue', icon: Receipt, staffOnly: true, permission: 'billing:process', console: CONSOLE.CASHIER },
      // Gated on billing:process, not billing:read: this screen TAKES money — verifying a proof
      // issues a receipt and releases the visit — so it is the same authority as the counter till.
      { id: 'cashier-payments', label: 'Online Payments', icon: Wallet, staffOnly: true, permission: 'billing:process', console: CONSOLE.CASHIER },
      { id: 'cashier-history', label: 'Transaction History', icon: History, staffOnly: true, permission: 'billing:read', console: CONSOLE.CASHIER },
    ],
  },
  {
    label: 'Diagnostics',
    items: [
      { id: 'lab-ops', label: 'Laboratory Worklist', icon: FlaskConical, staffOnly: true, permission: 'results:write', department: 'Laboratory', console: CONSOLE.DIAGNOSTIC },
      { id: 'lab-history', label: 'Laboratory History', icon: History, staffOnly: true, permission: 'results:read', department: 'Laboratory', console: CONSOLE.DIAGNOSTIC },
      { id: 'ultrasound-ops', label: 'Ultrasound Worklist', icon: Stethoscope, staffOnly: true, permission: 'results:write', department: 'Ultrasound', console: CONSOLE.DIAGNOSTIC },
      { id: 'ultrasound-history', label: 'Ultrasound History', icon: History, staffOnly: true, permission: 'results:read', department: 'Ultrasound', console: CONSOLE.DIAGNOSTIC },
      { id: 'xray-ops', label: 'X-Ray Worklist', icon: Scan, staffOnly: true, permission: 'results:write', department: 'Xray', console: CONSOLE.DIAGNOSTIC },
      { id: 'xray-history', label: 'X-Ray History', icon: History, staffOnly: true, permission: 'results:read', department: 'Xray', console: CONSOLE.DIAGNOSTIC },
    ],
  },
];

/**
 * Whether this user may see a destination. Three gates; all must pass.
 *
 * 1. STRUCTURE — `roleRequired` on the management items, `staffOnly` on the departmental ones.
 *    Not editable from any screen. This is the line a permission cannot cross: no tick in any
 *    matrix puts a patient on a worklist.
 *
 * 2. PERMISSION — the delegable layer, driven by the Role-Permission Matrix plus this account's
 *    own overrides. Both are already resolved into one list by the server before it reaches here
 *    (see userRepository's EFFECTIVE_PERMISSIONS), so the sidebar does not need to know whether a
 *    permission came from the role template or from an exception made for this one person.
 *
 * 3. DEPARTMENT — for a modality worklist only. `departments === null` means unrestricted, which
 *    is how Admin and SuperAdmin arrive here; `[]` means none, and the two must not be conflated.
 *
 * The same three facts gate the API routes behind these screens, so the sidebar cannot advertise
 * something the server will refuse — that equivalence is the whole reason the nav reads the
 * server's answer rather than deriving its own.
 *
 * SuperAdmin bypasses gates 2 and 3, matching authorizePermissions on the backend: somebody has
 * to be able to repair a matrix misconfigured into locking everyone out, and it is the role that
 * edits it.
 */
export const canSee = (item, roles = [], permissions = [], departments = null) => {
  if (item.roleRequired && !item.roleRequired.some((r) => roles.includes(r))) return false;
  if (item.staffOnly && !isStaff(roles)) return false;

  if (roles.includes('SuperAdmin')) return true;

  if (item.permission && !permissions.includes(item.permission)) return false;
  // `null` is unrestricted, so only an actual array can exclude anything.
  if (item.department && departments !== null && !(departments || []).includes(item.department)) return false;
  return true;
};

export const visibleMainNavItems = (roles, permissions, departments) =>
  MAIN_NAV_ITEMS.filter((i) => canSee(i, roles, permissions, departments));

export const visibleOpsGroups = (roles, permissions, departments) =>
  OPS_NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((i) => canSee(i, roles, permissions, departments)) }))
    .filter((group) => group.items.length > 0);

const allItems = () => [
  ...MAIN_NAV_ITEMS,
  ...OPS_NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, groupLabel: g.label }))),
];

export const findNavItem = (navId) => allItems().find((i) => i.id === navId);

// The console a destination should open for this user, or null when their roles do not grant it.
// Returning null rather than a fallback keeps the check honest: the caller decides what to do
// with an unreachable destination instead of silently landing somewhere unrelated.
export const consoleForNav = (navId, roles, permissions, departments) => {
  const item = findNavItem(navId);
  if (!item || !canSee(item, roles, permissions, departments)) return null;
  return item.console;
};

/**
 * Where a user lands on sign-in.
 *
 * Originally hardcoded to 'dashboard' — a destination only Admin/SuperAdmin can open, so every
 * other role landed on an id it did not own. That was fixed by taking the first *reachable*
 * destination, which worked while the management items were Admin-only.
 *
 * It stopped working the moment Patient Records opened up to all staff [1.21.0]: that item sits
 * near the top of MAIN_NAV_ITEMS, so a lab tech signing in was dropped on the records search
 * instead of their worklist. Reachable is not the same as home.
 *
 * So: land on the first destination that *belongs* to a role you hold — the Laboratory Worklist
 * for a lab tech, the Billing Queue for a cashier — and only fall back to first-reachable for
 * someone whose roles own no departmental screen, which is Admin and SuperAdmin.
 */
export const defaultNavForRoles = (roles, permissions, departments) => {
  const ops = visibleOpsGroups(roles, permissions, departments).flatMap((g) => g.items);
  const home = ops.find((item) => !isBorrowedScreen(item.id, roles));
  if (home) return home.id;

  const [first] = [...visibleMainNavItems(roles, permissions, departments), ...ops];
  return first ? first.id : null;
};

// The role a departmental screen belongs to — who would normally be sitting at it.
//
// This used to be read off `roleRequired`, which no longer exists on these items: access is
// permission-driven now, so the item itself no longer names a role. The association is still real
// though — the Billing Queue is the cashier's screen whoever happens to be standing at it — so it
// is stated here instead of inferred.
const NAV_HOME_ROLE = {
  'Front Desk': 'Receptionist',
  Billing: 'Cashier',
  Laboratory: 'Laboratory Staff',
  Xray: 'Xray Staff',
  Ultrasound: 'Ultrasound Staff',
};

export const nativeRoleForNav = (navId) => {
  const item = findNavItem(navId);
  if (!item) return null;
  // A Diagnostics item belongs to its modality's role; a Front Desk / Billing item to its group's.
  return NAV_HOME_ROLE[item.department] ?? NAV_HOME_ROLE[item.groupLabel] ?? null;
};

/**
 * Whether this person is working a screen that is not natively theirs — an Admin covering the
 * front desk, or a lab tech who has been granted the billing queue. Drives the "Acting as" chip.
 *
 * Widened in [1.20.0] from "is an Admin borrowing this" to "does this person hold the role this
 * screen belongs to". Now that a permission can put anyone on any staff screen, the chip matters
 * more, not less: whatever you do here is recorded under your name, and the person most likely to
 * forget that is the one who does not normally sit at this screen.
 */
export const isBorrowedScreen = (navId, roles = []) => {
  const homeRole = nativeRoleForNav(navId);
  if (!homeRole) return false;
  return !roles.includes(homeRole);
};
