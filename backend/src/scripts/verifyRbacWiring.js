/**
 * Cross-checks every permission-gated route against the seeded role-permission matrix.
 *
 * Wiring `authorizePermissions` onto a route that one of its own `authorizeRoles` entries lacks
 * the permission for does not fail loudly — it produces a 403 for a role the route was explicitly
 * written to allow, in a flow nobody may exercise until a real user hits it. That is the exact
 * hazard the old "do not wire this ad hoc" note in auth.js warned about, and eyeballing 84 routes
 * is not a control.
 *
 * So this reads the route files, extracts every (roles, permission) pair, and asserts that each
 * named role actually holds that permission in the database. Run it after any change to routes or
 * to setupRbac.js.
 *
 *   node src/scripts/verifyRbacWiring.js
 *
 * Exits non-zero on a mismatch, so it can gate a deploy.
 */
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../config/logger');

const ROUTES_DIR = path.join(__dirname, '..', 'routes');

// Roles that legitimately bypass the permission layer, so a gap for them is not a finding.
const BYPASS = new Set(['SuperAdmin']);

/**
 * Every router.<verb>(...) call in a source file, each flattened to a single string.
 *
 * Lines that are not part of a route call are passed through untouched, so the caller's own
 * `router.` test still decides what counts.
 */
function joinRouteCalls(source) {
  const lines = source.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^router\.(get|post|put|patch|delete)\(/.test(lines[i].trim())) {
      out.push(lines[i]);
      continue;
    }
    let call = lines[i];
    let depth = (call.match(/\(/g) || []).length - (call.match(/\)/g) || []).length;
    while (depth > 0 && i + 1 < lines.length) {
      i += 1;
      call += ' ' + lines[i].trim();
      depth += (lines[i].match(/\(/g) || []).length - (lines[i].match(/\)/g) || []).length;
    }
    out.push(call);
  }
  return out;
}

function extractRouteGuards(source) {
  const found = [];
  // The `// rbac-narrowing:` opt-out is written ABOVE the route, because that is where a person
  // naturally puts an explanation — and the joined router call does not include it. Carrying the
  // preceding comment block along is what makes the marker actually work; without this the
  // annotation reads correctly to a human and is invisible to the check, which is the worst of
  // both worlds.
  let pendingComment = '';
  // A router.<verb>( ... ) call, however many lines it is spread over.
  //
  // This used to read one LINE at a time, on the stated convention that every route fits on one.
  // A route written across several lines — which a long guard chain invites — was therefore not
  // examined at all: it did not appear in the count, and its permissions were never checked
  // against the catalogue. Caught when a route gated on a permission that did not exist was
  // reported as "All good", which is the one thing this script exists to make impossible.
  for (const line of joinRouteCalls(source)) {
    const trimmed = line.trim();
    if (!/^router\.(get|post|put|patch|delete)\(/.test(trimmed)) {
      // Accumulate an unbroken run of comment lines; anything else clears it, so a marker cannot
      // drift onto a route it was not written for.
      pendingComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
        ? `${pendingComment}
${trimmed}`
        : '';
      continue;
    }

    const leading = pendingComment;
    pendingComment = '';

    const permMatch = line.match(/authorizePermissions\(([^)]*)\)/);
    if (!permMatch) continue;

    const perms = [...permMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const rolesMatch = line.match(/authorizeRoles\(([^)]*)\)/);
    const roles = rolesMatch ? [...rolesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
    const spread = rolesMatch ? [...rolesMatch[1].matchAll(/\.\.\.([A-Z_]+)/g)].map((m) => m[1]) : [];

    // `\s*` after the paren: a route spread over several lines joins with whitespace there,
    // and without this every multi-line route was reported as "?".
    const pathMatch = line.match(/router\.\w+\(\s*'([^']*)'/);
    found.push({ path: pathMatch ? pathMatch[1] : '?', perms, roles, spread, line: trimmed, leading });
  }
  return found;
}

/** Resolves `...SOME_CONST` role lists declared as an array literal in the same file. */
function resolveConstants(source) {
  const consts = {};
  for (const m of source.matchAll(/const\s+([A-Z_]+)\s*=\s*\[([^\]]*)\]/g)) {
    consts[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return consts;
}

async function main() {
  const matrix = {};
  const rows = await db.query(`
    SELECT r.name AS role, p.name AS permission
    FROM roles r
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
  `);
  for (const row of rows.rows) {
    (matrix[row.role] = matrix[row.role] || new Set()).add(row.permission);
  }

  const knownPermissions = new Set(
    (await db.query('SELECT name FROM permissions')).rows.map((r) => r.name)
  );

  const problems = [];
  // Reviewable rather than fatal — see CHECK 5.
  const narrowings = [];
  let gated = 0;
  let staffGated = 0;
  const routePermissions = new Set();

  for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const consts = resolveConstants(source);

    for (const route of extractRouteGuards(source)) {
      gated += 1;
      route.perms.forEach((p) => routePermissions.add(p));

      // CHECK 1 — a permission that does not exist can never be held, so the route is unreachable
      // by anyone but SuperAdmin. This is the failure mode that produced `tests:read_assigned`
      // being invented at a call site and gating a route nobody could pass.
      for (const perm of route.perms) {
        if (!knownPermissions.has(perm)) {
          problems.push(`${file} ${route.path} — requires "${perm}", which is not in the permissions catalogue`);
        }
      }

      // CHECK 2 — nobody holds it. Since [1.20.0] most routes are gated on permission alone, so a
      // permission no role grants is a route only SuperAdmin can reach. Sometimes deliberate;
      // usually a seeding omission, and either way worth saying out loud.
      for (const perm of route.perms) {
        if (!knownPermissions.has(perm)) continue;
        const holders = Object.entries(matrix).filter(([role, set]) => role !== 'Client' && set.has(perm));
        if (holders.length === 0) {
          problems.push(`${file} ${route.path} — no staff role holds "${perm}"; only SuperAdmin can reach this`);
        }
      }

      const roles = [...route.roles, ...route.spread.flatMap((name) => consts[name] || [])];
      if (roles.length === 0) {
        staffGated += 1;
        continue; // permission-only route; checks 1 and 2 above are the whole check
      }

      // CHECK 3 — the original one, still valid for the routes that keep an explicit role list
      // (the patient-facing ones, and RBAC administration). Wiring a permission onto a route that
      // one of its own allowed roles lacks produces a 403 for a role the route was written to
      // permit, in a flow nobody exercises until a real user hits it.
      for (const role of roles) {
        if (BYPASS.has(role)) continue;
        for (const perm of route.perms) {
          if (!matrix[role] || !matrix[role].has(perm)) {
            problems.push(`${file} ${route.path} — role "${role}" is allowed by authorizeRoles but lacks "${perm}"`);
          }
        }
      }

      // CHECK 5 — the OTHER direction, which nothing was asking. [1.63.0]
      //
      // Check 3 asks "does every role NAMED on this route hold the permission?". It never asked
      // "does every role that HOLDS the permission appear on this route?" — and that gap hid a
      // real disagreement: the Cashier was granted `billing:submit_proof` in the matrix while both
      // routes using it named only SuperAdmin, Admin, Receptionist and Client. A cashier holding
      // the permission got a 403 from the role gate, and this script reported "All good".
      //
      // That is precisely the "matrix that lies" shape [1.20.0] removed from 45 routes: somebody
      // ticks a box, it saves, it reports success, and nothing happens.
      //
      // ── Why a WARNING and not a failure ────────────────────────────────────────────────────
      //
      // Because a narrower role list is sometimes the whole point. `PATCH /patients/:id/archive`
      // is gated on `patients:update` AND restricted to Admin: reception holds that permission for
      // CORRECTING a record and must not be able to archive one. That is a deliberate narrowing,
      // not a bug, and a check that failed on it would be turned off within a week.
      //
      // So these are listed for review, and a route can opt out by saying why:
      //     // rbac-narrowing: reception may correct a record but not archive one
      for (const [role, held] of Object.entries(matrix)) {
        if (BYPASS.has(role) || role === 'Client') continue;
        if (roles.includes(role)) continue;
        if (/rbac-narrowing:/.test(route.line) || /rbac-narrowing:/.test(route.leading)) continue;
        if (route.perms.length === 0) continue;
        if (!route.perms.every((perm) => held.has(perm))) continue;

        narrowings.push(
          `${file} ${route.path} — "${role}" holds ${route.perms.map((p) => `"${p}"`).join(' + ')} ` +
          `but is not named in authorizeRoles, so the grant does nothing`
        );
      }
    }
  }

  // CHECK 4 — nav/API parity. The sidebar gates each destination on a permission string; if that
  // string is not one the API actually enforces, the two have drifted and the nav is either
  // hiding a reachable screen or offering an unreachable one. This is the guarantee that used to
  // be provided by both sides sharing a hardcoded role list, and it needs stating now that they
  // do not.
  const navPath = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'config', 'navigation.js');
  if (fs.existsSync(navPath)) {
    const nav = fs.readFileSync(navPath, 'utf8');
    const navPerms = new Set([...nav.matchAll(/permission:\s*'([^']+)'/g)].map((m) => m[1]));
    for (const perm of navPerms) {
      if (!knownPermissions.has(perm)) {
        problems.push(`navigation.js — gates a nav item on "${perm}", which is not a real permission`);
      } else if (!routePermissions.has(perm)) {
        problems.push(`navigation.js — gates a nav item on "${perm}", which no API route enforces`);
      }
    }
    logger.info(`Cross-checked ${navPerms.size} sidebar permission(s) against the API.`);
  }

  logger.info(`Checked ${gated} permission-gated route(s) — ${staffGated} decided by permission alone.`);

  // Listed before the verdict, and never fatal. A grant that does nothing is not a broken route —
  // it is a matrix saying something the API does not honour, which somebody has to decide about.
  if (narrowings.length > 0) {
    logger.warn(`${narrowings.length} grant(s) that the route's role list overrides — review, do not ignore:`);
    for (const n of narrowings) logger.warn(`   ${n}`);
    logger.warn('   Either name the role on the route, drop the grant, or add a `// rbac-narrowing:` note saying why.');
  }

  if (problems.length === 0) {
    logger.info('All good — every gated route is reachable by the roles that should reach it.');
    process.exit(0);
  }

  logger.error(`${problems.length} problem(s):`);
  for (const p of problems) logger.error(`   ${p}`);
  logger.error('Fix by granting the permission in setupRbac.js, or by correcting the route/nav.');
  process.exit(1);
}

main().catch((err) => {
  logger.error(`RBAC wiring check failed: ${err.message}`);
  process.exit(1);
});
