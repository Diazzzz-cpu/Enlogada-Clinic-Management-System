import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';
import api from '../../config/api';
// `todayStr` / `daysAgoStr` were re-implemented locally at the top of this file. The local copies
// were correct (built from local getters, not toISOString), but a second correct copy is still a
// second place for the toISOString bug to come back — see the dates note in CLAUDE.md.
import { ShieldCheck } from 'lucide-react';

// --- RBAC Matrix report (read-only), SuperAdmin only. ---------------------------------------
//
// This tab used to render for anyone who could open Reports, which in practice meant Admin — the
// role the matrix is most sensitive to. It lists every role, every permission, and by omission
// exactly which permissions the reader does not hold, which is the reconnaissance an Admin would
// need to attempt escalation. GET /rbac/matrix is gated on `rbac:manage` server-side now; hiding
// the tab keeps the UI from advertising a screen the API will refuse, which is the whole point of
// canSee() in navigation.js.
const RbacMatrixReport = () => {
  const [roles, setRoles] = useState([]);
  const [rolePermissions, setRolePermissions] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/rbac/matrix');
        setRoles(res.data.data.roles || []);
        setRolePermissions(res.data.data.rolePermissions || {});
      } catch (err) {
        console.error('Failed to fetch RBAC matrix:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-3">
      <Card className="border-line rounded-xl bg-surface overflow-hidden">
        <CardHeader className="border-b border-line px-5 py-3.5">
          <CardTitle className="flex items-center gap-2 text-note font-semibold text-slate-900">
            <ShieldCheck className="w-4 h-4 text-brand-600" />
            <span>Roles &amp; Their Assigned Permissions</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Permissions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={2} className="py-10 text-center text-fine text-slate-400">Loading role matrix…</TableCell></TableRow>
              ) : (
                roles.map((role) => (
                  <TableRow key={role.id} className="align-top">
                    <TableCell className="py-3 font-bold text-xs text-slate-900 whitespace-nowrap">{role.name}</TableCell>
                    <TableCell className="py-3">
                      {/* Sorted, so the rows can be compared against each other — which is the
                          only thing a matrix is for. They arrived in whatever order the join
                          returned, so `patients:read_all_departments` sat last on SuperAdmin,
                          first on Admin and last again on Cashier, and checking whether two roles
                          differ meant reading every chip in both rows rather than scanning down a
                          column. Sorting is by the resource before the colon and then the action,
                          which is how the permission names are already built. */}
                      <div className="flex flex-wrap gap-1 max-w-2xl">
                        {(rolePermissions[role.name] || []).length > 0 ? (
                          [...(rolePermissions[role.name] || [])].sort((a, b) => a.localeCompare(b)).map((permName) => (
                            <Badge key={permName} variant="outline" className="text-meta font-semibold border-gray-200">{permName}</Badge>
                          ))
                        ) : (
                          <span className="text-fine text-slate-500">No permissions assigned</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-fine text-gray-400 px-1">Read-only. Editing role permissions is a SuperAdmin-only capability under Super Admin Management.</p>
    </div>
  );
};

// Feature Gap Plan Phase D finding 04: staff workload visibility existed for Cashier only
// (CashierMonitoring.jsx's byCashier) — Reception and Diagnostic had no per-staff throughput
// view at all. Mirrors that same "group collections by staff member" shape, server-side, for
// the other two departments.

export default RbacMatrixReport;
