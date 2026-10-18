import React, { useState } from 'react';
import { categoryLabel as categoryLabelFor, categoryIcon, issuesReports } from '../../lib/categories';
import { groupByVisit, statusCounts, worklistCountLabel } from '../../lib/worklistGroups';
import { cn } from '../../lib/utils';
import { CheckCircle2, ChevronRight, Clock, FileText, Send, ShieldCheck, WifiOff } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel, PanelBody } from '../ui/panel';
import Toolbar, { SegmentedFilter, ToolbarSpacer } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import MetricCard from '../ui/metric-card';
import DataBadge from '../ui/data-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { SearchInput } from '../ui/search-input';
import { StatusBadge } from '../ui/status-badge';
import Pagination from '../ui/pagination';
import { ageFromBirthdate } from '../../lib/date';
import WaitBadge from '../ui/wait-badge';
import { SkeletonRows } from '../ui/skeleton';
import { useAuth } from '../../contexts/AuthContext';
import { ConfirmDialog } from '../ui/confirm-dialog';

const PAGE_SIZE = 10;
const WORKLIST_STATUS_FILTERS = ['All', 'Processing', 'Waiting for Release'];

/** PT number, age and sex: the line under a patient's name. */
function PatientDetails({ test, className }) {
  // Age and sex, on the screen where findings are recorded. Diagnostic reference ranges are banded
  // by both — a haemoglobin that is normal for a 40-year-old man is anaemia in a child — and the
  // tech had to open a second screen to find out which band applied.
  const age = ageFromBirthdate(test.birthdate);
  return (
    <span className={cn('block text-meta font-normal text-slate-500', className)}>
      PT-{test.patient_id}
      {age !== null && <> &middot; {age}y</>}
      {test.sex && <> &middot; {test.sex}</>}
    </span>
  );
}

/** Who asked for the test [1.23.0]. The report goes back to this doctor, and a tech querying an
 *  odd result needs to know who to call. */
function Referrer({ test }) {
  if (!test.referring_physician) return null;
  return (
    <span className="block text-meta font-normal text-brand-700">Ref: {test.referring_physician}</span>
  );
}

/**
 * One test's examination, status and actions: the last three cells of a plain row, and the whole
 * of a row under a patient's name.
 */
function TestCells({ test, entry, examDone, canRecord, canRelease, showReferrer = true }) {
  // X-ray: no report here, so the exam is marked done instead. [1.129.0]
  const reportsHere = issuesReports(test.category_name);
  return (
    <>
      <TableCell label="Examination" className="py-3.5 text-fine font-bold text-slate-800">
        {test.test_name}
        <span className="block text-meta font-normal text-slate-500">{test.category_name}</span>
        {showReferrer && <Referrer test={test} />}
      </TableCell>

      <TableCell label="Status" className="py-3.5">
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={test.test_status} className="px-2.5 py-0.5" />
          {/* Phase C finding 05: HMO-approval status wasn't surfaced anywhere on the worklist — a
              tech had no on-screen signal that an expensive test's authorization was rejected
              before running it. */}
          {test.hmo_approval_status && (
            <span className="flex items-center gap-1 text-meta font-bold text-slate-500">
              <ShieldCheck className="w-3 h-3" />
              HMO:&nbsp;<StatusBadge status={test.hmo_approval_status} className="px-1.5 py-0" />
            </span>
          )}
        </div>
      </TableCell>

      <TableCell className="py-3.5 text-right">
        <div className="flex items-center justify-end gap-2">
          {canRecord && !reportsHere && (test.test_status === 'Processing' || test.test_status === 'Waiting for Release') && (
            <Button onClick={() => examDone?.ask(test)} size="xs">
              <CheckCircle2 className="h-3 w-3" />
              <span>Mark done</span>
            </Button>
          )}
          {canRecord && reportsHere && (
            <Button onClick={() => entry.openFor(test)} variant="outline" size="xs">
              <FileText className="h-3 w-3" />
              <span>{test.test_status === 'Waiting for Release' ? 'Edit Report' : 'Attach Report'}</span>
            </Button>
          )}
          {canRelease && reportsHere && test.test_status === 'Waiting for Release' && (
            <Button onClick={() => entry.openRelease(test)} size="xs">
              <Send className="h-3 w-3" />
              <span>Release Result</span>
            </Button>
          )}
        </div>
      </TableCell>
    </>
  );
}

/**
 * What this department has to do today, and the state each ticket is in.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 *
 * [1.79.0] Tidied to the rest of the staff side: the ticket is the shared queue badge (the Desk
 * draws it the same way), a failed load is the standard error state with one Try again, and the
 * secondary lines use the muted ink that clears AA rather than a grey that did not.
 *
 * [1.115.0] One row per patient. A visit with several tests is one row whose name opens them
 * underneath (lib/worklistGroups.js); a visit with one test is the ordinary row it always was.
 * Groups start closed, so the list reads as the people waiting, and stay open across the polling
 * refresh because they are remembered by visit.
 */
export default function WorklistPanel({ worklist, entry, examDone }) {
  const categoryLabel = categoryLabelFor(worklist.category);
  // Each action gated on the permission its own endpoint demands. [1.74.0] The worklist itself is
  // gated on `results:write` in navigation.js, so whoever sees it can record; releasing is
  // `results:release`, a separate permission a role can be granted write without. CLAUDE.md [1.53.0].
  const { hasPermission } = useAuth();
  const canRecord = hasPermission('results:write');
  const canRelease = hasPermission('results:release');
  const modalityIcon = categoryIcon(worklist.category);
  // 'Processing' = released to this department, exam not yet done.
  // 'Waiting for Release' = exam done and findings recorded, awaiting authorisation.
  const processingCount = worklist.pending.filter((t) => t.test_status === 'Processing').length;
  const awaitingReleaseCount = worklist.pending.filter((t) => t.test_status === 'Waiting for Release').length;
  // A failed load empties `pending`, so the counts above would read 0. That is a claim about the
  // department's workload, and a false one — the tiles say they don't know instead. [1.74.0]
  const worklistFailed = Boolean(worklist.worklistError);
  // X-ray marks exams done rather than releasing reports [1.129.0], so it has no "awaiting
  // release" stage to count or filter by.
  const reportsHere = issuesReports(worklist.category);

  // Client-side, because the worklist a department holds at once is small — a handful of
  // tickets, not the payments table. Filtering here keeps the search instant while the polling
  // in useDiagnosticWorklist keeps the underlying list fresh.
  const filtered = worklist.pending.filter((t) => {
    const term = worklist.search.toLowerCase();
    const matchesSearch = !worklist.search ||
      `${t.first_name} ${t.last_name}`.toLowerCase().includes(term) ||
      t.test_name.toLowerCase().includes(term) ||
      (t.queue_number && t.queue_number.toLowerCase().includes(term));
    const matchesStatus = worklist.status === 'All' || t.test_status === worklist.status;
    if (!matchesStatus) return false;
    return matchesSearch;
  });

  // Paged by patient, not by test, so one person's tests are never split across two pages.
  const groups = groupByVisit(filtered);
  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const paged = groups.slice((worklist.worklistPage - 1) * PAGE_SIZE, worklist.worklistPage * PAGE_SIZE);

  const [openGroups, setOpenGroups] = useState(() => new Set());
  const toggleGroup = (key) => setOpenGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return (
      <>
      {/* Department Modality Worklist Header Cards */}
      <div className={cn('grid grid-cols-1 gap-4', reportsHere && 'sm:grid-cols-2')}>
        {/* "—" on a failure, and the table below says why with its Try again — not a caption here too. */}
        <MetricCard label="Awaiting Exam" value={worklistFailed ? '—' : processingCount} caption="Paid and released to you" captionTone="slate" icon={Clock} tone="indigo" />
        {reportsHere && (
          <MetricCard label="Awaiting Release" value={worklistFailed ? '—' : awaitingReleaseCount} caption="Report attached, not authorised" captionTone="slate" icon={FileText} tone="amber" />
        )}
      </div>

      <div>
        {/* Search + Status Filter Toolbar */}
        <Toolbar attached>
          {reportsHere && (
            <SegmentedFilter
              ariaLabel="Filter worklist by status"
              options={WORKLIST_STATUS_FILTERS.map(f => ({ value: f, label: f }))}
              value={worklist.status}
              onChange={worklist.setStatus}
            />
          )}
          <ToolbarSpacer />
          <SearchInput
            placeholder="Search patient, test, queue..."
            value={worklist.search}
            onChange={e => worklist.setSearch(e.target.value)}
            containerClassName="w-full sm:w-64"
          />
        </Toolbar>

      {/* Modality Worklist Data Table */}
      <Panel className="overflow-hidden rounded-t-none">
        <PanelBody flush>
          <Table stack>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Queue Ticket</TableHead>
                <TableHead>Patient Name</TableHead>
                <TableHead>Diagnostic Examination</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {worklist.worklistError ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    {/* The standard error state, the same as every other list's. [1.79.0] It was a
                        line of red text with an underlined "Retry" inside a table cell. */}
                    <EmptyState
                      compact
                      tone="error"
                      icon={WifiOff}
                      title="Couldn't load the worklist"
                      description="The tickets are still in the system; this screen could not read them."
                      action={<Button variant="outline" size="sm" onClick={worklist.refresh}>Try again</Button>}
                    />
                  </TableCell>
                </TableRow>
              ) : worklist.loading ? (
                <SkeletonRows rows={5} columns={5} />
              ) : paged.length > 0 ? (
                paged.map(({ key, first, tests }) => {
                  const name = `${first.first_name} ${first.last_name}`;
                  const ticket = (
                    <TableCell label="Queue Ticket" className="py-3.5">
                      <DataBadge variant="queue" label="Queue ticket">{first.queue_number || `VT-${first.visit_test_id}`}</DataBadge>
                    </TableCell>
                  );

                  if (tests.length === 1) {
                    return (
                      <TableRow key={key} className="hover:bg-slate-50/70 transition-colors">
                        {ticket}
                        <TableCell label="Patient" className="py-3.5 text-fine font-bold text-slate-900">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{name}</span>
                            {/* The oldest ticket is usually the one to pick up next. */}
                            <WaitBadge since={first.visit_created_at} />
                          </div>
                          <PatientDetails test={first} />
                        </TableCell>
                        <TestCells test={first} entry={entry} examDone={examDone} canRecord={canRecord} canRelease={canRelease} />
                      </TableRow>
                    );
                  }

                  const open = openGroups.has(key);
                  return (
                    <React.Fragment key={key}>
                      <TableRow data-testid="worklist-group" className="hover:bg-slate-50/70 transition-colors">
                        {ticket}
                        <TableCell label="Patient" className="py-3.5 text-fine font-bold text-slate-900">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* The name is the dropdown: their tests open underneath it. */}
                            <button
                              type="button"
                              onClick={() => toggleGroup(key)}
                              aria-expanded={open}
                              className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 text-left font-bold text-slate-900 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                            >
                              <ChevronRight
                                aria-hidden="true"
                                className={cn('h-4 w-4 flex-shrink-0 text-slate-500 transition-transform', open && 'rotate-90')}
                              />
                              {name}
                            </button>
                            <WaitBadge since={first.visit_created_at} />
                          </div>
                          <PatientDetails test={first} className="pl-4" />
                        </TableCell>
                        <TableCell label="Examination" className="py-3.5 text-fine font-bold text-slate-800">
                          {tests.length} tests
                          {/* Which tests, while they are hidden; once open, the rows below say it. */}
                          {!open && (
                            <span className="block max-w-[14rem] truncate text-meta font-normal text-slate-500">
                              {tests.map((t) => t.test_name).join(', ')}
                            </span>
                          )}
                          {/* A visit names one requesting doctor, so it is said once, here. */}
                          <Referrer test={first} />
                        </TableCell>
                        <TableCell label="Status" className="py-3.5">
                          <div className="flex flex-col items-start gap-1">
                            {statusCounts(tests).map(({ status, count }) => (
                              <StatusBadge key={status} status={status} className="px-2.5 py-0.5">
                                {count} {status}
                              </StatusBadge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5" />
                      </TableRow>

                      {open && tests.map((test) => (
                        <TableRow
                          key={test.visit_test_id}
                          data-subrow="true"
                          data-testid="worklist-group-test"
                          className="bg-slate-50/60 hover:bg-slate-50 transition-colors"
                        >
                          <TableCell className="py-3" />
                          <TableCell className="py-3" />
                          <TestCells test={test} entry={entry} examDone={examDone} canRecord={canRecord} canRelease={canRelease} showReferrer={false} />
                        </TableRow>
                      ))}
                    </React.Fragment>
                  );
                })
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      icon={modalityIcon}
                      title={worklist.search || worklist.status !== 'All' ? 'Nothing matches this filter' : `Nothing waiting in ${categoryLabel}`}
                      description={
                        worklist.search || worklist.status !== 'All'
                          ? 'Clear the search box or switch the status filter back to All.'
                          : 'A ticket reaches this worklist once the cashier has taken payment and released the visit to your department.'
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PanelBody>
        <Pagination
          page={worklist.worklistPage}
          totalPages={totalPages}
          onPageChange={worklist.setWorklistPage}
          totalLabel={groups.length > 0
            ? worklistCountLabel({ groups: groups.length, tests: filtered.length, page: worklist.worklistPage, pageSize: PAGE_SIZE })
            : undefined}
        />
      </Panel>
      </div>
      {examDone && (
        <ConfirmDialog
          open={Boolean(examDone.target)}
          onOpenChange={(open) => { if (!open) examDone.cancel(); }}
          title="Mark this exam done?"
          description={examDone.target
            ? `${examDone.target.test_name} for ${examDone.target.first_name} ${examDone.target.last_name}. It leaves the worklist and is counted as done. The result is given through the department's own system, not here.`
            : ''}
          confirmLabel="Mark done"
          onConfirm={examDone.confirm}
          loading={examDone.busy}
          error={examDone.error}
        />
      )}
      </>
  );
}
