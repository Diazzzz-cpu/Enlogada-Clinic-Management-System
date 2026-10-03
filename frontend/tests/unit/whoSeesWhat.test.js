import { describe, it, expect } from 'vitest';
import {
  COLUMNS, SPLIT_COLUMNS, LOCKED, areasFor, areaCell, cellState, changedRoles, describeChanges,
  draftFrom, heldByNobody, toggle,
} from '../../src/lib/whoSeesWhat.js';

// The clinic's default templates, as backend/src/scripts/setupRbac.js seeds them.
const RECEPTION = [
  'patients:create', 'patients:read', 'patients:update', 'visits:create', 'visits:read', 'visits:update',
  'appointments:read', 'appointments:update', 'appointments:cancel', 'appointments:reschedule',
  'tests:assign', 'tests:read_assigned', 'hmo:read', 'hmo:request',
  'billing:submit_proof', 'billing:discount', 'patients:read_all_departments',
];
const CASHIER = [
  'patients:read', 'patients:read_all_departments', 'visits:read', 'visits:update',
  'billing:read', 'billing:process', 'billing:refund', 'billing:discount', 'hmo:read',
];
const MODALITY = [
  'results:read', 'results:write', 'results:release',
  'patients:read', 'tests:read_assigned',
];
const ADMIN = [
  'patients:create', 'patients:read', 'patients:read_all_departments', 'patients:update',
  'visits:create', 'visits:read', 'visits:update',
  'appointments:read', 'appointments:update', 'appointments:cancel', 'appointments:reschedule',
  'tests:manage', 'tests:assign', 'tests:read_assigned', 'results:read',
  'billing:read', 'billing:refund', 'billing:discount', 'billing:submit_proof',
  'hmo:read', 'hmo:request', 'hmo:approve', 'reports:view', 'audit:view', 'staff:manage',
];
const TEMPLATES = {
  Receptionist: RECEPTION, Cashier: CASHIER, Admin: ADMIN,
  'Laboratory Staff': MODALITY, 'Xray Staff': MODALITY, 'Ultrasound Staff': MODALITY,
};
const ALL = [...new Set([...Object.values(TEMPLATES).flat(), 'appointments:create', 'rbac:manage'])]
  .map((name) => ({ name, description: name }));

const areas = areasFor(ALL);
const area = (key) => areas.find((a) => a.key === key);
const [DESK, TILL, ROOMS, ADMIN_COL] = COLUMNS;
const fresh = () => draftFrom(TEMPLATES);

describe('a cell reads like the picture', () => {
  it('front desk: patient records, the queue, bookings and money', () => {
    const d = fresh();
    expect(areaCell(area('patients'), d, DESK)).toEqual({ mark: 'yes', text: 'Find, register and edit, every department' });
    expect(areaCell(area('queue'), d, DESK)).toEqual({ mark: 'yes', text: 'See and manage it' });
    expect(areaCell(area('bookings'), d, DESK).text).toBe('See, check in, move and cancel');
    expect(areaCell(area('money'), d, DESK)).toEqual({ mark: 'part', text: "Discount and send in online proofs; can't see takings" });
  });

  it('cashier takes payments; Admin sees the money and cannot take it', () => {
    const d = fresh();
    expect(areaCell(area('money'), d, TILL).text).toBe('See takings, take payments, refund and discount');
    expect(areaCell(area('money'), d, ADMIN_COL).text).toBe("See takings, refund, discount and send in online proofs; can't take payments");
    expect(areaCell(area('bookings'), d, TILL)).toEqual({ mark: 'no', text: 'No' });
  });

  it('the departments work on their own patients and results', () => {
    const d = fresh();
    expect(areaCell(area('patients'), d, ROOMS)).toEqual({ mark: 'part', text: 'Find, own department only' });
    expect(areaCell(area('results'), d, ROOMS)).toEqual({ mark: 'yes', text: 'Read, write and release, own department' });
    expect(areaCell(area('results'), d, ADMIN_COL)).toEqual({ mark: 'part', text: "Read them; can't write or release" });
  });

  it('staff accounts leave who-sees-what to SuperAdmin, and that switch is not counted', () => {
    const d = fresh();
    expect(LOCKED['rbac:manage']).toBeTruthy();
    // Admin holds staff:manage, the only switchable permission in the row, so the mark is full.
    expect(areaCell(area('staff'), d, ADMIN_COL)).toEqual({ mark: 'yes', text: 'Staff accounts; permissions are SuperAdmin only' });
  });
});

describe('switches', () => {
  it('the departments move together, and a difference between them is said', () => {
    let d = fresh();
    // Only X-Ray loses the release: the shared column is now mixed.
    d = toggle(d, 'results:release', ['Xray Staff']);
    expect(cellState(d, 'results:release', ROOMS.roles)).toBe('mixed');
    expect(areaCell(area('results'), d, ROOMS)).toEqual({ mark: 'part', text: 'Read and write, own department (differs by department)' });

    // A mixed switch turns on for all three; on again, off for all three.
    d = toggle(d, 'results:release', ROOMS.roles);
    expect(cellState(d, 'results:release', ROOMS.roles)).toBe('on');
    d = toggle(d, 'results:release', ROOMS.roles);
    expect(cellState(d, 'results:release', ROOMS.roles)).toBe('off');
    // Split, each department is its own column again.
    expect(SPLIT_COLUMNS.map((c) => c.label)).toEqual(['Front desk', 'Cashier', 'Laboratory', 'X-Ray', 'Ultrasound', 'Admin']);
  });

  it('never changes the draft it was given', () => {
    const d = fresh();
    toggle(d, 'billing:refund', DESK.roles);
    expect(d.Receptionist.has('billing:refund')).toBe(false);
  });
});

describe('the unsaved changes', () => {
  it('are sentences, one per change, with the departments named together', () => {
    const original = fresh();
    let d = toggle(original, 'billing:refund', DESK.roles);
    d = toggle(d, 'results:release', ROOMS.roles);
    expect(describeChanges(original, d, areas).map((c) => c.text)).toEqual([
      'Front desk can now refund or void a payment.',
      'Lab, X-Ray and Ultrasound can no longer release a result to the patient.',
    ]);
    expect(changedRoles(original, d)).toEqual(['Receptionist', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff']);
    expect(changedRoles(original, toggle(d, 'billing:refund', DESK.roles))).not.toContain('Receptionist');
  });

  it('say when nobody but SuperAdmin would be able to do something', () => {
    // Nobody holds appointments:create by default (patients book online, as Clients), and the
    // locked permission is never reported.
    expect(heldByNobody(fresh(), areas)).toEqual(['appointments:create']);
    const d = toggle(fresh(), 'billing:process', TILL.roles);
    expect(heldByNobody(d, areas)).toEqual(['appointments:create', 'billing:process']);
  });
});

describe('rows', () => {
  it('a permission no row names still gets a switch, under Other', () => {
    const rows = areasFor([...ALL, { name: 'lab:calibrate', description: 'calibrate the analyser' }]);
    const other = rows.find((r) => r.key === 'other');
    expect(other.permissions).toEqual([{ name: 'lab:calibrate', label: 'Calibrate the analyser' }]);
    expect(areaCell(other, fresh(), DESK)).toEqual({ mark: 'no', text: 'No' });
  });

  it('a permission nothing checks is left off, rather than shown as a switch that does nothing', () => {
    const rows = areasFor([...ALL, { name: 'tests:results_write', description: 'Enter diagnostic test results' }]);
    expect(rows.find((r) => r.key === 'other')).toBeUndefined();
    expect(rows.flatMap((r) => r.permissions).map((p) => p.name)).not.toContain('tests:results_write');
  });
});
