import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelHeader, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import RefreshButton from '../../components/ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';
import EmptyState from '../../components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { SearchInput } from '../../components/ui/search-input';
import { SkeletonRows } from '../../components/ui/skeleton';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { toastSuccess } from '../../lib/toast';
import { UserPlus, AlertCircle, KeyRound, CheckCircle2, Pencil, Users, UserX } from 'lucide-react';

// Module 12: staff account management, scoped to the 5 operational roles only (Admin/SuperAdmin
// account management is Module 13's explicit responsibility — see adminService.js's
// MANAGEABLE_ROLES, enforced server-side, not just hidden here).
const MANAGEABLE_ROLES = ['Receptionist', 'Cashier', 'Laboratory Staff', 'Ultrasound Staff', 'Xray Staff'];

// Visual Design Improvement Plan Phase V1: this list has no server-side pagination endpoint,
// so a client-side page size over an already-fetched, search-filtered array is proportionate —
// see VISUAL_IDENTITY.md §3a #11.
const PAGE_SIZE = 15;

const StaffAccounts = () => {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed fetch used to reach console.error and stop there, so the screen rendered its
  // EMPTY state — "No staff accounts yet" over a 500. That is the one thing empty-state.jsx's own
  // docstring says must never happen: a quiet clinic and a broken server call for opposite
  // responses, and one of them was being reported as the other.
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', contactNumber: '', password: '', role: '' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [statusTarget, setStatusTarget] = useState(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [statusError, setStatusError] = useState('');

  // Feature Gap Plan Phase A: a locked-out staff member (forgotten password + no access to the
  // email tied to their account) previously had no recourse short of deactivate-and-recreate,
  // which loses the account's history association.
  const [resetPwdTarget, setResetPwdTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resettingPwd, setResettingPwd] = useState(false);
  const [resetPwdError, setResetPwdError] = useState('');
  const [resetPwdSuccess, setResetPwdSuccess] = useState(false);

  // UI/UX Modernization Phase 11: previously the only recourse for a typo'd name/email/contact
  // number was deactivating and recreating the whole account. Deliberately excludes role — that
  // stays a separate, more sensitive action.
  const [editTarget, setEditTarget] = useState(null);
  const [editData, setEditData] = useState({ firstName: '', lastName: '', email: '', contactNumber: '' });
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchStaff = useCallback(async () => {
    try {
      const res = await api.get('/admin/staff');
      setStaff(res.data.data.staff || []);
    } catch (err) {
      // Recorded, not just logged: a swallowed failure renders as an empty list.
      console.error('Failed to fetch staff accounts:', err);
      setLoadError(err.response?.data?.message || 'The server did not respond. The list below may be out of date.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const handleOpenAdd = () => {
    setFormData({ firstName: '', lastName: '', email: '', contactNumber: '', password: '', role: '' });
    setFormError('');
    setShowAddModal(true);
  };

  const handleAddStaff = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!formData.firstName.trim() || !formData.lastName.trim() || !formData.email.trim() || !formData.password || !formData.role) {
      setFormError('First name, last name, email, password, and role are required.');
      return;
    }
    if (formData.password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/admin/staff', formData);
      setShowAddModal(false);
      fetchStaff();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to create staff account.');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmToggleStatus = async () => {
    if (!statusTarget) return;
    setTogglingStatus(true);
    setStatusError('');
    try {
      await api.patch(`/admin/staff/${statusTarget.id}/status`, { status: !statusTarget.status });
      setStatusTarget(null);
      fetchStaff();
    } catch (err) {
      setStatusError(err.response?.data?.message || 'Failed to update staff account status.');
    } finally {
      setTogglingStatus(false);
    }
  };

  const handleOpenResetPwd = (s) => {
    setResetPwdTarget(s);
    setNewPassword('');
    setResetPwdError('');
    setResetPwdSuccess(false);
  };

  const confirmResetPassword = async (e) => {
    e.preventDefault();
    if (!resetPwdTarget) return;
    if (newPassword.length < 8) {
      setResetPwdError('Password must be at least 8 characters.');
      return;
    }
    setResettingPwd(true);
    setResetPwdError('');
    try {
      await api.patch(`/admin/staff/${resetPwdTarget.id}/password`, { newPassword });
      setResetPwdSuccess(true);
    } catch (err) {
      setResetPwdError(err.response?.data?.message || 'Failed to reset password.');
    } finally {
      setResettingPwd(false);
    }
  };

  const handleOpenEdit = (s) => {
    setEditTarget(s);
    setEditData({ firstName: s.first_name, lastName: s.last_name, email: s.email, contactNumber: s.contact_number || '' });
    setEditError('');
  };

  const confirmEditStaff = async (e) => {
    e.preventDefault();
    if (!editTarget) return;
    if (!editData.firstName.trim() || !editData.lastName.trim() || !editData.email.trim()) {
      setEditError('First name, last name, and email are required.');
      return;
    }
    setSavingEdit(true);
    setEditError('');
    try {
      await api.patch(`/admin/staff/${editTarget.id}`, editData);
      setEditTarget(null);
      toastSuccess('Staff account details updated.');
      fetchStaff();
    } catch (err) {
      setEditError(err.response?.data?.message || 'Failed to update staff account.');
    } finally {
      setSavingEdit(false);
    }
  };

  const filteredStaff = staff.filter(s => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      // Every role, not just the first. Searching "receptionist" used to miss the combined
      // Receptionist+Cashier account entirely, because that account's first role is Cashier.
      (s.roles || []).some((r) => (r || '').toLowerCase().includes(q))
    );
  });
  const totalPages = Math.max(1, Math.ceil(filteredStaff.length / PAGE_SIZE));
  const pagedStaff = filteredStaff.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Two admins onboarding staff at once is the ordinary case at the start of a term, and the
  // second one needs to see the first one's work without reloading the whole application.
  const updatedAt = useFreshness(loading, loadError);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        icon={Users}
        title="Staff Accounts"
        description="Receptionist, Cashier and diagnostic staff logins. Admin and SuperAdmin accounts are managed separately under RBAC administration."
        actions={
        <>
        <RefreshButton onRefresh={fetchStaff} loading={loading} updatedAt={updatedAt} />
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenAdd}>
              <UserPlus className="h-4 w-4" />
              Add Staff Account
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Staff Account</DialogTitle>
              <DialogDescription>Creates a login for a Receptionist, Cashier, or diagnostic staff member.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddStaff} className="space-y-4 pt-2">
              {formError && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="staffaccounts-first-name" className="field-label">First Name</label>
                  <Input id="staffaccounts-first-name" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} disabled={submitting} required />
                </div>
                <div className="space-y-1">
                  <label htmlFor="staffaccounts-last-name" className="field-label">Last Name</label>
                  <Input id="staffaccounts-last-name" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} disabled={submitting} required />
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="staffaccounts-email" className="field-label">Email</label>
                <Input id="staffaccounts-email" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} disabled={submitting} required />
              </div>
              <div className="space-y-1">
                <label htmlFor="staffaccounts-contact-number" className="field-label">Contact Number</label>
                <Input id="staffaccounts-contact-number" value={formData.contactNumber} onChange={e => setFormData({ ...formData, contactNumber: e.target.value })} disabled={submitting} />
              </div>
              <div className="space-y-1">
                <label htmlFor="staffaccounts-temporary-password" className="field-label">Temporary Password</label>
                <Input id="staffaccounts-temporary-password" type="password" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} disabled={submitting} required />
                <p className="text-fine text-gray-400 m-0">At least 8 characters.</p>
              </div>
              <div className="space-y-1">
                <label className="field-label" htmlFor="staffaccounts-role">Role</label>
                <Select value={formData.role} onValueChange={val => setFormData({ ...formData, role: val })}>
                  <SelectTrigger className="rounded-xl" id="staffaccounts-role">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {MANAGEABLE_ROLES.map(role => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter className="border-t border-line pt-3">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)} disabled={submitting}>Cancel</Button>
                <Button type="submit" loading={submitting}>
                  Create Account
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </>
        }
      />

      <Panel>
        {/* "0 staff accounts" beside a panel that says the request failed is the same false
            claim in smaller type. The count is only stated when there is something to count. */}
        <PanelHeader
          title={(loadError || loading) ? 'Staff accounts' : `${filteredStaff.length} staff account${filteredStaff.length === 1 ? '' : 's'}`}
          description={loadError
            ? 'The list below could not be loaded.'
            : search ? `filtered from ${staff.length} total` : 'Select a status chip to activate or deactivate an account'}
          icon={Users}
          actions={
            <SearchInput
              placeholder="Search name, email, or role…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              containerClassName="w-full sm:w-64"
            />
          }
        />
        <PanelBody flush>
          <Table stack>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Error before empty. A failed fetch used to fall through to the empty branch,
                  so a 500 rendered as "nothing here yet" — which is a false statement about the
                  clinic's data, not merely an unhelpful one. */}
              {loadError ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      tone="error"
                      title="Could not load staff accounts"
                      description={loadError}
                      action={<Button variant="outline" size="sm" onClick={() => fetchStaff()}>Try again</Button>}
                    />
                  </TableCell>
                </TableRow>
              ) : loading ? (
                <SkeletonRows rows={6} columns={6} />
              ) : pagedStaff.length > 0 ? (
                pagedStaff.map(s => (
                  <TableRow key={s.id}>
                    <TableCell label="Name" className="max-w-[11.25rem] truncate font-semibold text-slate-900" title={`${s.first_name} ${s.last_name}`}>{s.first_name} {s.last_name}</TableCell>
                    <TableCell label="Email" className="max-w-[13.75rem] truncate text-slate-500" title={s.email}>{s.email}</TableCell>
                    {/* Every role this account holds. This rendered `roles[0]` only, so the
                        combined Receptionist+Cashier account appeared in the staff list as a
                        plain Cashier — the screen that exists to tell an administrator what
                        access somebody has was understating it. Combined-role accounts are a
                        supported shape here, not an edge case. */}
                    <TableCell label="Role">
                      <div className="flex flex-wrap gap-1">
                        {(s.roles || []).map((role) => (
                          <Badge key={role} variant="outline" className="text-slate-600">{role}</Badge>
                        ))}
                        {(s.roles || []).length === 0 && <span className="text-fine text-slate-400">No role</span>}
                      </div>
                    </TableCell>
                    <TableCell label="Contact" className="text-slate-500">{s.contact_number || '—'}</TableCell>
                    <TableCell label="Status">
                      {/* A button, not a Badge with an onClick. It toggles an account's ability to
                          log in, so it must be reachable by keyboard and announce itself as
                          interactive — a clickable <div> did neither. */}
                      <button
                        type="button"
                        onClick={() => { setStatusError(''); setStatusTarget(s); }}
                        title={s.status ? 'Deactivate this account' : 'Activate this account'}
                        className={`cursor-pointer rounded-md border-0 px-2 py-0.5 text-fine font-semibold leading-5 ring-1 ring-inset transition-colors ${
                          s.status
                            ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100'
                            : 'bg-slate-100 text-slate-600 ring-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        {s.status ? 'Active' : 'Deactivated'}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button type="button" variant="outline" size="xs" onClick={() => handleOpenEdit(s)}>
                          <Pencil className="h-3 w-3" />
                          Edit
                        </Button>
                        <Button type="button" variant="outline" size="xs" onClick={() => handleOpenResetPwd(s)}>
                          <KeyRound className="h-3 w-3" />
                          Reset Password
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      icon={UserX}
                      title={search ? 'No staff match that search' : 'No staff accounts yet'}
                      description={search ? 'Try a surname, an email domain, or a role name.' : 'Add the first Receptionist, Cashier or diagnostic staff login.'}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={loadError ? 0 : filteredStaff.length} pageSize={PAGE_SIZE}
          />
        </PanelBody>
      </Panel>

      <Dialog open={!!resetPwdTarget} onOpenChange={(open) => !resettingPwd && !open && setResetPwdTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              {resetPwdTarget && `Set a new temporary password for ${resetPwdTarget.first_name} ${resetPwdTarget.last_name}. Share it with them securely — they should change it after logging in.`}
            </DialogDescription>
          </DialogHeader>

          {resetPwdSuccess ? (
            <div className="space-y-4">
              <div role="status" className="alert alert-success">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>Password reset successfully.</span>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => setResetPwdTarget(null)} className="font-bold">Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={confirmResetPassword} className="space-y-4">
              {resetPwdError && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{resetPwdError}</span>
                </div>
              )}
              <div className="space-y-1">
                <label htmlFor="staffaccounts-new-temporary-password" className="field-label">New Temporary Password</label>
                <Input id="staffaccounts-new-temporary-password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} disabled={resettingPwd} required autoFocus />
                <p className="text-fine text-gray-400 m-0">At least 8 characters.</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setResetPwdTarget(null)} disabled={resettingPwd}>Cancel</Button>
                <Button type="submit" className="font-bold" disabled={resettingPwd}>
                  {resettingPwd ? 'Resetting…' : 'Reset Password'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(open) => !savingEdit && !open && setEditTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Staff Account</DialogTitle>
            <DialogDescription>
              {editTarget && `Update contact details for ${editTarget.first_name} ${editTarget.last_name}. Role and password are managed separately.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={confirmEditStaff} className="space-y-4">
            {editError && (
              <div role="alert" className="alert alert-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{editError}</span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="staffaccounts-first-name" className="field-label">First Name</label>
                <Input id="staffaccounts-first-name" value={editData.firstName} onChange={e => setEditData({ ...editData, firstName: e.target.value })} disabled={savingEdit} required />
              </div>
              <div className="space-y-1">
                <label htmlFor="staffaccounts-last-name" className="field-label">Last Name</label>
                <Input id="staffaccounts-last-name" value={editData.lastName} onChange={e => setEditData({ ...editData, lastName: e.target.value })} disabled={savingEdit} required />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="staffaccounts-email" className="field-label">Email</label>
              <Input id="staffaccounts-email" type="email" value={editData.email} onChange={e => setEditData({ ...editData, email: e.target.value })} disabled={savingEdit} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="staffaccounts-contact-number" className="field-label">Contact Number</label>
              <Input id="staffaccounts-contact-number" value={editData.contactNumber} onChange={e => setEditData({ ...editData, contactNumber: e.target.value })} disabled={savingEdit} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)} disabled={savingEdit}>Cancel</Button>
              <Button type="submit" className="font-bold" disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(open) => { if (!open) { setStatusTarget(null); setStatusError(''); } }}
        title={statusTarget?.status ? 'Deactivate Staff Account' : 'Activate Staff Account'}
        description={statusTarget && `${statusTarget.status ? 'Deactivate' : 'Activate'} ${statusTarget.first_name} ${statusTarget.last_name}'s account? ${statusTarget.status ? 'They will no longer be able to log in.' : 'They will be able to log in again.'}`}
        confirmLabel={statusTarget?.status ? 'Deactivate' : 'Activate'}
        onConfirm={confirmToggleStatus}
        loading={togglingStatus}
        error={statusError}
      />
    </div>
  );
};

export default StaffAccounts;
