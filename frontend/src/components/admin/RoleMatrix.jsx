import React from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Panel, PanelHeader, PanelBody, PanelFooter } from '../ui/panel';
import EmptyState from '../ui/empty-state';
import { SearchInput } from '../ui/search-input';
import { SkeletonList } from '../ui/skeleton';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import RefreshButton from '../ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';

// A person-level exception is a coloured chip, so the eye separates "this is what the role
// gives" from "someone made a decision about this individual".
const OVERRIDE_TONE = {
  grant: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  revoke: 'bg-rose-50 text-rose-800 ring-rose-200',
};
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

/**
 * Access control, edited by role template or by the individual person.
 *
 * Lifted out of SuperAdminManagement, which held two whole screens plus a tab wrapper in one
 * 774-line file. State and saving live in useAccessControl.
 */
export default function RoleMatrix({ access }) {
  const updatedAt = useFreshness(access.loading, access.loadError);
  return (
  <div className="space-y-4">
    {/* This banner used to read "Advisory only — not yet enforced", and the note here explained
        that authorizePermissions was wired to zero routes so revoking a permission changed
        nothing. Both were honest at the time and are now the opposite of true: permissions gate
        48 API routes and the sidebar, and Admin no longer bypasses them. */}
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-fine leading-relaxed text-brand-800 ring-1 ring-inset ring-brand-200"
    >
      <ShieldCheck className="mt-px h-4 w-4 flex-shrink-0 text-brand-600" />
      <span>
        <strong className="font-bold">Live — these permissions are enforced.</strong> A change
        reaches the person&apos;s API access immediately and their sidebar within a minute, with
        no need for them to sign out. The one thing not governed here is the staff/patient
        boundary: no tick can put a patient on a worklist. <strong>SuperAdmin</strong> bypasses
        every check, so a matrix misconfigured into locking everyone out can always be repaired.
      </span>
    </div>

    <Panel className="overflow-hidden">
      <PanelHeader
        title="Access Control"
        description="Edit the template a role gives everyone, or the exceptions for one person"
        icon={ShieldCheck}
        actions={
          <>
          <RefreshButton compact onRefresh={access.reload} loading={access.loading} updatedAt={updatedAt} />
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {[
              { value: 'role', label: 'By Role' },
              { value: 'person', label: 'By Person' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => access.changeMode(option.value)}
                className={`cursor-pointer rounded-[7px] border-0 px-3 py-1.5 text-fine font-semibold transition-colors ${
                  access.mode === option.value
                    ? 'bg-surface text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]'
                    : 'bg-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          </>
        }
      />

      {/* Subject picker + permission search. Both dropdowns, because the alternative — the old
          table of every role with an Edit button — does not scale to a staff list and gave no
          way to jump straight to the person you are being asked about. */}
      <div className="flex flex-wrap items-end gap-3 border-b border-line bg-slate-50/70 p-4">
        {access.mode === 'role' ? (
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="rbac-role" className="field-label m-0">Role</label>
            <Select value={String(access.selectedRoleId)} onValueChange={access.setSelectedRoleId}>
              <SelectTrigger id="rbac-role" className="w-[15rem]">
                <SelectValue placeholder="Choose a role…" />
              </SelectTrigger>
              <SelectContent>
                {access.roles.map((role) => (
                  <SelectItem key={role.id} value={String(role.id)}>
                    {role.name} · {(access.rolePermissions[role.name] || []).length} permissions
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="rbac-person" className="field-label m-0">Staff member</label>
            <Select value={String(access.selectedUserId)} onValueChange={access.setSelectedUserId}>
              <SelectTrigger id="rbac-person" className="w-[18.75rem]">
                <SelectValue placeholder="Choose a staff member…" />
              </SelectTrigger>
              <SelectContent>
                {access.accounts.map((account) => (
                  <SelectItem key={account.id} value={String(account.id)}>
                    {account.firstName} {account.lastName} · {account.roles.join(', ')}
                    {account.overrides?.length ? ` · ${account.overrides.length} exception${account.overrides.length === 1 ? '' : 's'}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {access.subjectChosen && (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="rbac-search" className="field-label m-0">Find a permission</label>
            <SearchInput
              id="rbac-search"
              placeholder="e.g. billing, results, refund…"
              value={access.search}
              onChange={(e) => access.setSearch(e.target.value)}
              containerClassName="max-w-xs"
            />
          </div>
        )}
      </div>

      <PanelBody>
        {access.loading ? (
          <SkeletonList rows={5} />
        ) : access.loadError ? (
          <EmptyState
            tone="error"
            title="Could not load access control"
            description={access.loadError}
            action={<Button variant="outline" size="sm" onClick={access.reload}>Try again</Button>}
          />
        ) : !access.subjectChosen ? (
          <EmptyState
            icon={ShieldCheck}
            title={access.mode === 'role' ? 'Choose a role to edit' : 'Choose a staff member'}
            description={
              access.mode === 'role'
                ? 'A role is the template everyone holding it inherits. Changing it affects every one of them.'
                : 'An exception applies to this person only, and survives later changes to their role.'
            }
          />
        ) : (
          <div className="space-y-5">
            {access.mode === 'person' && (
              <>
                {/* What this person ends up with, stated before the checkboxes. Someone opening
                    this screen is usually answering a question about a person, not editing —
                    and the answer should not require reading 27 checkboxes. */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-line p-3">
                    <span className="field-label">Roles held</span>
                    <div className="flex flex-wrap gap-1">
                      {access.selectedUser.roles.map((r) => (
                        <Badge key={r} variant="outline" className="text-slate-600">{r}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-line p-3">
                    <span className="field-label">Effective permissions</span>
                    <span className="text-lead font-bold tabular-nums text-slate-900">
                      {access.selectedUser.effectivePermissions.length}
                      <span className="ml-1 text-fine font-normal text-slate-500">of {access.permissions.length}</span>
                    </span>
                  </div>
                  <div className={`rounded-lg border p-3 ${access.overrideCount ? 'border-amber-200 bg-amber-50/60' : 'border-line'}`}>
                    <span className="field-label">Exceptions</span>
                    <span className="flex items-center gap-2">
                      <span className="text-lead font-bold tabular-nums text-slate-900">{access.overrideCount}</span>
                      {access.overrideCount > 0 && (
                        <button
                          type="button"
                          onClick={access.resetToRoles}
                          className="cursor-pointer border-0 bg-transparent p-0 text-fine font-semibold text-brand-700 underline underline-offset-2"
                        >
                          Reset to role defaults
                        </button>
                      )}
                    </span>
                  </div>
                </div>

                {/* Departments. A separate axis from permissions: `results:write` says they may
                    write a result, this says whose. Roles imply their own and are shown ticked
                    and disabled — removing one means removing the role. */}
                <div className="rounded-lg border border-line p-3">
                  <span className="field-label">Department access</span>
                  <p className="m-0 mb-2 text-fine leading-relaxed text-slate-500">
                    Which modalities&apos; patients and results this person may open. Ticks from their
                    role are fixed; add one to cover another room without giving them a second role.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {access.categories.map((category) => {
                      const fromRole = (access.selectedUser.roleDepartments || []).includes(category.name);
                      const checked = fromRole || access.departmentDraft.has(category.id);
                      return (
                        <label
                          key={category.id}
                          title={fromRole ? `Comes with the ${access.selectedUser.roles.join('/')} role` : undefined}
                          className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-fine font-medium ${
                            fromRole
                              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
                              : 'cursor-pointer border-line hover:border-brand-300 hover:bg-brand-50/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded accent-[#53843b]"
                            checked={checked}
                            disabled={fromRole}
                            onChange={() => access.toggleDepartment(category.id)}
                          />
                          {category.name}
                          {fromRole && <span className="text-micro text-slate-400">via role</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {Object.entries(access.permissionsByModule).map(([module, modulePermissions]) => {
              const visible = modulePermissions.filter(access.matchesSearch);
              if (visible.length === 0) return null;
              return (
                <div key={module}>
                  <span className="field-label">{module}</span>
                  <div className="space-y-1">
                    {visible.map((permission) => {
                      const checked = access.mode === 'role' ? access.roleDraft.has(permission.id) : access.personHas(permission);
                      const override = access.mode === 'person' ? access.personDraft[permission.id] : null;
                      const fromRole = access.mode === 'person' && access.roleGrantedNames.has(permission.name);
                      return (
                        <label
                          key={permission.id}
                          className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 transition-colors ${
                            override
                              ? 'border-amber-200 bg-amber-50/50'
                              : 'border-line hover:border-brand-300 hover:bg-brand-50/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded accent-[#53843b]"
                            checked={checked}
                            onChange={() =>
                              access.mode === 'role' ? access.toggleRole(permission) : access.togglePerson(permission)
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-fine font-semibold text-slate-900">{permission.name}</span>
                            {permission.description && (
                              <span className="block text-fine text-slate-500">{permission.description}</span>
                            )}
                          </span>
                          {/* Where this state came from. Without it, a ticked box is ambiguous
                              between "the role gives this" and "someone decided this for them",
                              and only one of those is a thing you should feel free to change. */}
                          {access.mode === 'person' && (
                            override ? (
                              <span className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-micro font-semibold uppercase leading-5 ring-1 ring-inset ${OVERRIDE_TONE[override]}`}>
                                {override === 'grant' ? 'Granted' : 'Revoked'}
                              </span>
                            ) : fromRole ? (
                              <span className="flex-shrink-0 text-micro font-medium text-slate-400">via role</span>
                            ) : null
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PanelBody>

      {access.subjectChosen && !access.loading && (
        <PanelFooter>
          <span className="text-fine text-slate-500">
            {access.mode === 'role'
              ? `Applies to everyone holding ${access.selectedRole?.name}.`
              : `Applies to ${access.selectedUser?.firstName} ${access.selectedUser?.lastName} only.`}
          </span>
          <span className="flex items-center gap-3">
            {access.saveError && (
              <span role="alert" className="text-fine font-semibold text-rose-700">{access.saveError}</span>
            )}
            {access.savedAt && !access.saveError && (
              <span role="status" className="inline-flex items-center gap-1 text-fine font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
            <Button onClick={access.save} disabled={access.saving}>
              {access.saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </span>
        </PanelFooter>
      )}
    </Panel>
  </div>
  );
}
