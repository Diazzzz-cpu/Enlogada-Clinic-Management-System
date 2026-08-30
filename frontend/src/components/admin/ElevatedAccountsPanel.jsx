import React from 'react';
import { ELEVATED_PAGE_SIZE } from '../../hooks/useElevatedAccounts';
import { AlertCircle, UserPlus } from 'lucide-react';
import { Panel, PanelBody } from '../ui/panel';
import { SkeletonRows } from '../ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ConfirmDialog } from '../ui/confirm-dialog';

// The two roles this screen exists to administer; everything else is an ordinary staff account.
const ELEVATED_ROLES = ['Admin', 'SuperAdmin'];
import Pagination from '../ui/pagination';

/**
 * The Admin and SuperAdmin accounts, and the two things you can do to one.
 *
 * Lifted out of SuperAdminManagement. State and mutations live in useElevatedAccounts.
 */
export default function ElevatedAccountsPanel({ elevated }) {
  return (
  <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h3 className="m-0 text-lead font-bold tracking-tight text-slate-900">Elevated Accounts (Admin / SuperAdmin)</h3>
        <p className="m-0 mt-1 text-fine leading-relaxed text-slate-500">Select a status chip to activate or deactivate an account — the same gesture as Staff Accounts. You cannot deactivate your own, to prevent locking the clinic out of elevated administration.</p>
      </div>
      <Dialog open={elevated.showAdd} onOpenChange={(open) => { if (!open) elevated.closeAdd(); }}>
        <DialogTrigger asChild>
          <Button onClick={elevated.openAdd}>
            <UserPlus className="h-4 w-4" />
            Add Elevated Account
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Elevated Account</DialogTitle>
            <DialogDescription>Creates an Admin or SuperAdmin login. Grant this power carefully.</DialogDescription>
          </DialogHeader>
          <form onSubmit={elevated.submitAdd} className="space-y-4 pt-2">
            {elevated.formError && (
              <div role="alert" className="alert alert-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{elevated.formError}</span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="superadminmanagement-first-name" className="field-label">First Name</label>
                <Input id="superadminmanagement-first-name" value={elevated.form.firstName} onChange={e => elevated.setForm({ ...elevated.form, firstName: e.target.value })} disabled={elevated.submitting} required />
              </div>
              <div className="space-y-1">
                <label htmlFor="superadminmanagement-last-name" className="field-label">Last Name</label>
                <Input id="superadminmanagement-last-name" value={elevated.form.lastName} onChange={e => elevated.setForm({ ...elevated.form, lastName: e.target.value })} disabled={elevated.submitting} required />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="superadminmanagement-email" className="field-label">Email</label>
              <Input id="superadminmanagement-email" type="email" value={elevated.form.email} onChange={e => elevated.setForm({ ...elevated.form, email: e.target.value })} disabled={elevated.submitting} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="superadminmanagement-contact-number" className="field-label">Contact Number</label>
              <Input id="superadminmanagement-contact-number" value={elevated.form.contactNumber} onChange={e => elevated.setForm({ ...elevated.form, contactNumber: e.target.value })} disabled={elevated.submitting} />
            </div>
            <div className="space-y-1">
              <label htmlFor="superadminmanagement-temporary-password" className="field-label">Temporary Password</label>
              <Input id="superadminmanagement-temporary-password" type="password" value={elevated.form.password} onChange={e => elevated.setForm({ ...elevated.form, password: e.target.value })} disabled={elevated.submitting} required />
              <p className="text-fine text-gray-400 m-0">At least 8 characters.</p>
            </div>
            <div className="space-y-1">
              <label className="field-label" htmlFor="superadminmanagement-role">Role</label>
              <Select value={elevated.form.role} onValueChange={val => elevated.setForm({ ...elevated.form, role: val })}>
                <SelectTrigger className="rounded-xl" id="superadminmanagement-role">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {ELEVATED_ROLES.map(role => (
                    <SelectItem key={role} value={role}>{role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end space-x-2 pt-2 border-t border-line">
              <Button type="button" variant="outline" onClick={elevated.closeAdd} disabled={elevated.submitting}>Cancel</Button>
              <Button type="submit" className="font-bold" disabled={elevated.submitting}>
                {elevated.submitting ? 'Creating…' : 'Create Account'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>

    <Panel className="overflow-hidden">
      <PanelBody flush>
        <Table>
          <TableHeader sticky>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {elevated.loading ? (
              <SkeletonRows rows={4} columns={4} />
            ) : elevated.paged.length > 0 ? (
              elevated.paged.map(a => {
                const isSelf = elevated.currentUser?.id === a.id;
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-semibold text-slate-900">
                      {a.first_name} {a.last_name} {isSelf && <span className="font-normal text-slate-400">(you)</span>}
                    </TableCell>
                    <TableCell className="text-slate-500">{a.email}</TableCell>
                    {/* Every role, like the Staff Accounts table. An account holding both
                        Admin and SuperAdmin would otherwise be listed under one of them, on the
                        screen whose entire purpose is elevated-access oversight. */}
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(a.roles || []).map((role) => (
                          <Badge key={role} variant="outline" className="text-slate-600">{role}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {/* A real button, and genuinely disabled for your own row rather than
                          just dimmed — the previous version was a clickable <div> whose
                          "cannot deactivate yourself" rule lived only in an early return. */}
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => elevated.requestStatusChange(a)}
                        title={isSelf ? 'You cannot deactivate your own account' : a.status ? 'Deactivate this account' : 'Activate this account'}
                        className={`rounded-md border-0 px-2 py-0.5 text-fine font-semibold leading-5 ring-1 ring-inset transition-colors ${
                          isSelf ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                        } ${
                          a.status
                            ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 enabled:hover:bg-emerald-100'
                            : 'bg-slate-100 text-slate-600 ring-slate-200 enabled:hover:bg-slate-200'
                        }`}
                      >
                        {a.status ? 'Active' : 'Deactivated'}
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-10 text-center text-fine text-slate-500">No elevated accounts yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </PanelBody>
      <Pagination page={elevated.page} totalPages={elevated.totalPages} onPageChange={elevated.setPage} total={elevated.accounts.length} pageSize={ELEVATED_PAGE_SIZE} />
    </Panel>

    <ConfirmDialog
      open={!!elevated.statusTarget}
      onOpenChange={(open) => { if (!open) elevated.dismissStatusChange(); }}
      title={elevated.statusTarget?.status ? 'Deactivate Elevated Account' : 'Activate Elevated Account'}
      description={elevated.statusTarget && `${elevated.statusTarget.status ? 'Deactivate' : 'Activate'} ${elevated.statusTarget.first_name} ${elevated.statusTarget.last_name}'s ${elevated.statusTarget.roles?.[0]} account?`}
      confirmLabel={elevated.statusTarget?.status ? 'Deactivate' : 'Activate'}
      onConfirm={elevated.confirmStatusChange}
      loading={elevated.togglingStatus}
      error={elevated.statusError}
    />
  </div>
  );
}
