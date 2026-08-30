import React from 'react';
import { AlertCircle, ClipboardList, Clock, ShieldAlert, UserCheck, UserPlus, Volume2, XCircle } from 'lucide-react';
import DataBadge from '../ui/data-badge';
import EtaBadge from '../ui/eta-badge';
import WaitBadge from '../ui/wait-badge';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';
import { Panel, PanelBody } from '../ui/panel';
import Toolbar, { ToolbarSpacer } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import { SkeletonRows } from '../ui/skeleton';
import MetricCard from '../ui/metric-card';
import { Badge } from '../ui/badge';
import { SearchInput } from '../ui/search-input';
import { StatusBadge } from '../ui/status-badge';
import Pagination from '../ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

/**
 * The Active Queue: who is waiting, and every action the front desk takes on them.
 *
 * Lifted out of ReceptionistDashboard, which rendered four unrelated screens from one
 * 1,048-line file. The props are the hooks this screen actually reads — listed rather than
 * reached for, so what each view depends on is visible at its top instead of inferred by
 * scrolling.
 */
export default function ActiveQueuePanel({ queue, disposition, hmo, testAssignment, onCallPatient, onSelectNav }) {
  /**
   * The queue is a BORROWED screen for anyone who is not the front desk. [1.53.0]
   *
   * A Cashier holds `visits:read`, so this screen is legitimately theirs to look at — knowing who
   * is waiting is half of running a till. They do NOT hold `visits:create`, `tests:assign` or
   * `hmo:request`, and the panel offered all three anyway: measured, a Cashier was shown
   * "Register Walk-In" and "Attach Tests", and both are 403 at the API.
   *
   * That is the failure CLAUDE.md names about the sidebar, happening one level down. A control
   * that cannot work is worse than a missing one: the person clicks it, gets an error that reads
   * like a fault in the system rather than a boundary, and learns to distrust the screen.
   *
   * Each action is gated on the permission its own endpoint demands, so the UI and the API answer
   * the same question. hasPermission bypasses for SuperAdmin alone — Admin is judged on what it
   * actually holds, same as everyone else.
   */
  const { hasPermission } = useAuth();
  const canRegisterWalkIn = hasPermission('visits:create');
  const canAttachTests = hasPermission('tests:assign');
  const canRaiseHmo = hasPermission('hmo:request');

  return (
        <>
          {/* KPI Metrics Header */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <MetricCard label="Active Queue Visits" value={queue.total} icon={UserCheck} tone="green" />
            <MetricCard label="Pending Intake" value={queue.pendingCount} icon={Clock} tone="amber" />
            <MetricCard label="In Diagnostic" value={queue.processingCount} icon={ClipboardList} tone="indigo" />
            <MetricCard label="Walk-Ins Today" value={queue.walkinCount} icon={UserPlus} tone="emerald" />
          </div>

          {/* UI/UX Modernization Phase 10: read-only visibility into pending HMO requests —
              approving one still happens from wherever it already does, this card only
              surfaces that they exist. */}
          {!hmo.pendingLoading && hmo.pending.length > 0 && (
            <Panel tone="notice" className="px-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 flex-shrink-0 text-amber-700" />
                {/* A count in an alert banner is not a section heading — it was an <h3>, which
                    put a heading between the page title and the queue's own and broke the
                    outline for anyone navigating by heading. */}
                <p className="m-0 text-fine font-semibold text-amber-900">
                  {hmo.pending.length} pending HMO request{hmo.pending.length === 1 ? '' : 's'} awaiting Admin approval
                </p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {/* The patient, then the provider. These chips read "1CoopHealth • 1/2
                    approved" — five of them, identical, on a queue of five different people.
                    A receptionist standing in front of a patient asking "has mine come back
                    yet?" could not answer from this, which is the only question it is here
                    to answer. */}
                {hmo.pending.slice(0, 6).map(r => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1.5 rounded-md bg-surface px-2 py-0.5 text-fine font-medium leading-5 text-amber-900 ring-1 ring-inset ring-amber-200"
                  >
                    <span className="font-semibold">
                      {r.patient_first_name ? `${r.patient_first_name} ${r.patient_last_name}` : r.provider_name}
                    </span>
                    <span className="text-amber-500">&bull;</span>
                    <span className="tabular-nums">{r.approved_test_count}/{r.test_count} approved</span>
                  </span>
                ))}
                {hmo.pending.length > 6 && (
                  <span className="self-center text-fine font-semibold text-amber-700">+{hmo.pending.length - 6} more</span>
                )}
              </div>
            </Panel>
          )}

          <div>
            {/* Search + Status Filter Toolbar */}
            <Toolbar attached>
              <SearchInput
                placeholder="Search patient name or Queue #..."
                value={queue.search}
                onChange={e => queue.onSearchChange(e.target.value)}
                containerClassName="w-full sm:w-64"
              />

              <Select value={queue.status} onValueChange={queue.onStatusChange}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Statuses</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Processing">Processing</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </SelectContent>
              </Select>
              <ToolbarSpacer />
              <span className="whitespace-nowrap text-fine font-medium text-slate-500 tabular-nums">
                Showing {queue.visits.length} of {queue.total} visit{queue.total === 1 ? '' : 's'}
              </span>
            </Toolbar>

          {/* Active Queue Table */}
          <Panel className="overflow-hidden rounded-t-none">
            <PanelBody flush>
              <Table stack>
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>Queue Ticket</TableHead>
                    <TableHead>Patient Name</TableHead>
                    <TableHead>Visit Type</TableHead>
                    <TableHead>Patient Category</TableHead>
                    <TableHead>Assigned Tests</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.error ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="p-0">
                        <EmptyState
                          tone="error"
                          icon={AlertCircle}
                          title="Couldn't load the queue"
                          description={queue.error}
                          action={
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => queue.refresh()}
                            >
                              Try again
                            </Button>
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ) : queue.loading ? (
                    <SkeletonRows rows={6} columns={7} />
                  ) : queue.visits.length > 0 ? (
                    queue.visits.map(visit => (
                      <TableRow key={visit.id}>
                        <TableCell label="Queue Ticket">
                          <div className="flex items-center gap-1">
                            {/* The ticket number is the thing a receptionist calls out and a
                                patient reads back, so it is set larger than the row around it
                                rather than smaller — it was 12px in a row of 12px text. */}
                            <DataBadge variant="queue" label="Queue ticket">
                              {visit.queue_number || `V-${visit.id}`}
                            </DataBadge>
                            {/* aria-label as well as title: `title` alone is not a reliable
                                accessible name and is invisible on touch, so a screen reader
                                announced two unlabelled buttons on every queue row. */}
                            <button
                              onClick={() => onCallPatient(visit.queue_number)}
                              title="Call Queue Number"
                              aria-label={`Call queue number ${visit.queue_number}`}
                              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                            >
                              <Volume2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {/* [1.62.0] Under the ticket rather than in a column of its own: the
                              receptionist is asked "how much longer?" while looking at this row,
                              and an eighth column would push Actions off a laptop screen.

                              Present only for a Pending visit — a 'Processing' one has been billed
                              and belongs to a department now, where this front-desk estimate has
                              nothing to say. */}
                          {/* Elapsed AND predicted, together. [1.63.0] The billing queue and the
                              diagnostic worklists have shown WaitBadge since it was extracted; this
                              console showed only the ETA that [1.62.0] added inline. A receptionist
                              is asked both questions — "how long have I been here" and "how much
                              longer" — and answering one of them is answering the wrong half. */}
                          <span className="mt-1 flex flex-wrap items-center gap-1">
                            <WaitBadge since={visit.created_at} />
                            {/* `compact` — time only, no head count — and that is a deliberate
                                editorial call rather than a space saving. In a table ordered BY
                                queue position, "2 ahead" is redundant: the two rows above this one
                                are the two patients ahead. The count earns its place on the
                                patient's own booking pass, where there is no list to read it from.

                                It is also load-bearing for layout. Both badges at full width pushed
                                the ticket column wide enough to clip the Actions column off the
                                right of a 1440px screen — the primary controls on the screen,
                                pushed off it by decoration. */}
                            <EtaBadge
                              minutes={visit.estimated_wait_minutes}
                              capped={visit.estimate_is_capped}
                              compact
                            />
                          </span>
                        </TableCell>

                        <TableCell label="Patient Name" className="font-semibold text-slate-900">
                          {visit.first_name} {visit.last_name}
                          <DataBadge variant="patient" label="Patient record" className="block">PT-{visit.patient_id}</DataBadge>
                        </TableCell>

                        <TableCell label="Visit Type">
                          <Badge variant="outline" className="text-slate-600">
                            {visit.visit_type}
                          </Badge>
                        </TableCell>

                        <TableCell label="Patient Category" className="text-slate-500">
                          {visit.patient_type_name}
                        </TableCell>

                        <TableCell label="Assigned Tests">
                          {visit.tests && visit.tests.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {visit.tests.map(t => (
                                <span key={t.id} className="inline-flex items-center gap-0.5">
                                  <Badge variant="outline" className="text-slate-600">
                                    {t.test_name}
                                    <span className="ml-1 text-slate-400">({t.test_status})</span>
                                  </Badge>
                                  {canRaiseHmo && (
                                    <button
                                      type="button"
                                      onClick={() => hmo.openFor(t)}
                                      title="Log HMO pre-authorization for this test"
                                      aria-label={`Log HMO pre-authorization for ${t.test_name}`}
                                      className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-slate-300 hover:bg-brand-50 hover:text-brand-600"
                                    >
                                      <ShieldAlert className="h-3 w-3" />
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-fine text-slate-400">No tests attached</span>
                          )}
                        </TableCell>

                        <TableCell label="Status">
                          <StatusBadge status={visit.visit_status} />
                          {/* Where the ticket actually is, in the front desk's own terms.
                              'Pending' alone doesn't say whether reception or the cashier is
                              holding it up, which is the question this row exists to answer. */}
                          <span className="mt-1 block whitespace-nowrap text-micro font-medium text-slate-400">
                            {visit.visit_status === 'Pending'
                              ? 'With cashier'
                              : visit.visit_status === 'Processing'
                                ? 'With department'
                                : ''}
                          </span>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Edit, not attach. [1.55.0] Tests are chosen at registration, so by
                                the time a visit is in this queue the list already exists and what
                                the desk needs is to CHANGE it. "Attach" described a dialog that
                                could only ever add. */}
                            {canAttachTests && (
                              <Button onClick={() => testAssignment.openFor(visit.id)} variant="outline" size="xs">
                                Edit Tests
                              </Button>
                            )}
                            {!['Completed', 'Cancelled'].includes(visit.visit_status) && (
                              <button
                                type="button"
                                onClick={() => disposition.cancel.request(visit)}
                                title="Cancel this visit"
                                aria-label={`Cancel visit for ${visit.first_name} ${visit.last_name}`}
                                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="p-0">
                        <EmptyState
                          icon={UserCheck}
                          title={queue.search || queue.status !== 'All' ? 'No visits match this filter' : 'Nobody is waiting'}
                          description={
                            queue.search || queue.status !== 'All'
                              ? 'Clear the search or switch the status filter back to All.'
                              : canRegisterWalkIn
                                ? 'The queue is clear. Register a walk-in or check in an appointment to start one.'
                                : 'The queue is clear. Nobody is waiting to be seen or billed.'
                          }
                          action={
                            !queue.search && queue.status === 'All' && canRegisterWalkIn ? (
                              <Button size="sm" onClick={() => onSelectNav?.('reception-walkin')}>
                                <UserPlus className="h-3.5 w-3.5" />
                                Register Walk-In
                              </Button>
                            ) : undefined
                          }
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </PanelBody>
            <Pagination
              page={queue.page}
              totalPages={queue.totalPages}
              onPageChange={queue.goToPage}
              totalLabel={`${queue.total} total`}
            />
          </Panel>
          </div>
        </>
  );
}
