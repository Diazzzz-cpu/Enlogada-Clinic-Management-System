import React from 'react';
import { CheckCircle2, ShieldCheck, UserCog } from 'lucide-react';
import { Panel, PanelHeader, PanelBody, PanelFooter } from '../ui/panel';
import EmptyState from '../ui/empty-state';
import { SearchInput } from '../ui/search-input';
import { SkeletonList } from '../ui/skeleton';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import RefreshButton from '../ui/refresh-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useFreshness } from '../../hooks/useFreshness';
import WhoSeesWhat from './WhoSeesWhat';
import { UNUSED } from '../../lib/whoSeesWhat';

// A permission nothing checks is not offered as an exception either: granting it would save and
// change nothing. [1.79.0] The grid already leaves it off (lib/whoSeesWhat.js).
const usable = (name) => !UNUSED[name];

// A person-level exception is a coloured chip, so the eye separates "this is what the role
// gives" from "someone made a decision about this individual".
const OVERRIDE_TONE = {
  grant: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  revoke: 'bg-rose-50 text-rose-800 ring-rose-200',
};

/**
 * Access control: the "Who sees what" grid for every role (`mode="role"`), or the exceptions for one
 * person (`mode="person"`). Each is a Super Admin tab of its own.
 *
 * [1.78.0] The role half was a role picker over a list of bare permission checkboxes; it is now the
 * grid Steven chose (WhoSeesWhat.jsx). The person half is unchanged, because an exception applies
 * to one named account and is audited, which is a different job from setting what a role gives.
 * Neither panel repeats its tab's name as a title: the tab already says it, right above.
 */
export default function RoleMatrix({ access, grid, mode }) {
  return (
    <div className="space-y-4">
      {/* This banner used to read "Advisory only — not yet enforced". It is the opposite now:
          permissions gate the API routes and the sidebar, and Admin no longer bypasses them. */}
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-fine leading-relaxed text-brand-800 ring-1 ring-inset ring-brand-200"
      >
        <ShieldCheck className="mt-px h-4 w-4 flex-shrink-0 text-brand-600" />
        <span>
          <strong className="font-bold">Live — these permissions are enforced.</strong> A change
          reaches the person&apos;s API access immediately and their sidebar within a minute, with
          no need for them to sign out. The one thing not governed here is the staff/patient
          boundary: no switch can put a patient on a worklist. <strong>SuperAdmin</strong> bypasses
          every check, so a grid switched into locking everyone out can always be put right.
        </span>
      </div>

      {access.loading ? (
        <Panel>
          <PanelBody><SkeletonList rows={6} /></PanelBody>
        </Panel>
      ) : access.loadError ? (
        <Panel>
          <EmptyState
            tone="error"
            title="Could not load access control"
            description={access.loadError}
            action={<Button variant="outline" size="sm" onClick={access.reload}>Try again</Button>}
          />
        </Panel>
      ) : mode === 'role' ? (
        <WhoSeesWhat access={access} grid={grid} />
      ) : (
        <PersonAccess access={access} />
      )}
    </div>
  );
}

/** The exceptions for one named person, on top of what their roles give. Audited on save. */
function PersonAccess({ access }) {
  const updatedAt = useFreshness(access.loading, access.loadError);
  return (
    <Panel className="overflow-hidden">
      {/* A child rather than `description`, which truncates on a phone. */}
      <PanelHeader actions={<RefreshButton compact onRefresh={access.reload} loading={access.loading} updatedAt={updatedAt} />}>
        <p className="m-0 text-fine text-slate-500">
          Exceptions for one named person, on top of what their roles give. Each one is recorded in the activity log.
        </p>
      </PanelHeader>

      {/* A dropdown rather than a table of everyone: it scales to a staff list and goes straight to
          the person being asked about. */}
      <div className="flex flex-wrap items-end gap-3 border-b border-line bg-slate-50/70 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="rbac-person" className="field-label m-0">Staff member</label>
          <Select value={String(access.selectedUserId)} onValueChange={access.setSelectedUserId}>
            <SelectTrigger id="rbac-person" className="w-[18.75rem] max-w-full">
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

        {access.subjectChosen && (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="rbac-search" className="field-label m-0">Find a permission</label>
            <SearchInput
              id="rbac-search"
              placeholder="e.g. billing, results, discount…"
              value={access.search}
              onChange={(e) => access.setSearch(e.target.value)}
              containerClassName="max-w-xs"
            />
          </div>
        )}
      </div>

      <PanelBody>
        {!access.subjectChosen ? (
          <EmptyState
            icon={UserCog}
            title="Choose a staff member"
            description="An exception applies to this person only, and survives later changes to their role."
          />
        ) : (
          <div className="space-y-5">
            {/* What this person ends up with, stated before the checkboxes. Someone opening this is
                usually answering a question about a person, not editing, and the answer should not
                require reading 32 checkboxes. */}
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
                  {access.selectedUser.effectivePermissions.filter(usable).length}
                  <span className="ml-1 text-fine font-normal text-slate-500">of {access.permissions.filter((p) => usable(p.name)).length}</span>
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

            {/* Departments. A separate axis from permissions: `results:write` says they may write a
                result, this says whose. Roles imply their own and are shown ticked and disabled —
                removing one means removing the role. */}
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

            {Object.entries(access.permissionsByModule).map(([module, modulePermissions]) => {
              const visible = modulePermissions.filter((p) => usable(p.name) && access.matchesSearch(p));
              if (visible.length === 0) return null;
              return (
                <div key={module}>
                  <span className="field-label">{module}</span>
                  <div className="space-y-1">
                    {visible.map((permission) => {
                      const override = access.personDraft[permission.id];
                      const fromRole = access.roleGrantedNames.has(permission.name);
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
                            checked={access.personHas(permission)}
                            onChange={() => access.togglePerson(permission)}
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
                          {override ? (
                            <span className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-micro font-semibold uppercase leading-5 ring-1 ring-inset ${OVERRIDE_TONE[override]}`}>
                              {override === 'grant' ? 'Granted' : 'Revoked'}
                            </span>
                          ) : fromRole ? (
                            <span className="flex-shrink-0 text-micro font-medium text-slate-400">via role</span>
                          ) : null}
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

      {access.subjectChosen && (
        <PanelFooter>
          <span className="text-fine text-slate-500">
            Applies to {access.selectedUser?.firstName} {access.selectedUser?.lastName} only.
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
            <Button onClick={access.save} loading={access.saving}>Save Changes</Button>
          </span>
        </PanelFooter>
      )}
    </Panel>
  );
}
