import React from 'react';
import { categoryLabel as categoryLabelFor, issuesReports } from '../../lib/categories';
import { Eye, History, Pencil, Mail, MailCheck, MailX, WifiOff } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel, PanelBody } from '../ui/panel';
import Toolbar, { ToolbarSpacer, SegmentedFilter } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import DataBadge from '../ui/data-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { SearchInput } from '../ui/search-input';
import Pagination from '../ui/pagination';
import { formatDateTime } from '../../lib/date';
import { SkeletonRows } from '../ui/skeleton';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { TurnaroundPanel } from '../reports/OperationsPanels';
import { useAuth } from '../../contexts/AuthContext';
import { HISTORY_PAGE_SIZE } from '../../hooks/useDiagnosticWorklist';

/**
 * Reports this department has already released, and its throughput beside them.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 *
 * [1.79.0] Tidied like the worklist: the shared queue badge, the standard error state, muted ink
 * that clears AA, and a View Report button sized like the buttons beside it.
 */
export default function ResultHistoryPanel({ worklist, entry, operations, onViewResult, delivery }) {
  const categoryLabel = categoryLabelFor(worklist.category);

  // Each action is gated on the permission its own endpoint demands. [1.74.0] An Admin reads every
  // department's history (`results:read`) but holds neither `results:release` (POST /:id/email) nor
  // `results:write` (POST /:id, the amendment), and was offered both: two buttons that could only
  // answer 403. The borrowed-screen rule, CLAUDE.md [1.53.0], one screen further along.
  const { hasPermission } = useAuth();
  const canSend = hasPermission('results:release');
  const canAmend = hasPermission('results:write');

  // One page, searched and counted at the server. [1.128.0] History used to filter and page the
  // last 90 days in hand; a department's released reports are not a handful of tickets.
  const paged = worklist.released;
  const totalPages = worklist.releasedPages;
  // X-ray [1.129.0]: exams marked done, with no report here to view, email or amend. An X-ray
  // report released before that change still opens.
  const reportsHere = issuesReports(worklist.category);
  const columns = reportsHere ? 6 : 5;

  return (
      <>
      <div>
        {/* Search Bar */}
        <Toolbar attached>
          {/* Released and DELIVERED are two different facts, and "not sent" is the pile worth
              having a button for: released reports the patient was never told about. It matters
              most after a mail outage, when the failures are a contiguous block with no other way
              to find them. Filtered at the server, against a partial index. [1.59.0] */}
          {reportsHere && (
            <SegmentedFilter
              ariaLabel="Filter released results by whether the patient was sent them"
              options={[
                { value: 'all', label: 'All' },
                { value: 'unsent', label: 'Not sent' },
                { value: 'sent', label: 'Sent' },
              ]}
              value={worklist.deliveryFilter}
              onChange={worklist.setDeliveryFilter}
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

      {/* Released Results Table (read-only) */}
      <Panel className="overflow-hidden rounded-t-none">
        <PanelBody flush>
          <Table stack>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Queue Ticket</TableHead>
                <TableHead>Patient Name</TableHead>
                <TableHead>Diagnostic Examination</TableHead>
                <TableHead>{reportsHere ? 'Released' : 'Done'}</TableHead>
                {/* Whether the patient was actually TOLD. Released and delivered are two different
                    facts and the screen only ever showed the first, so "has she been sent her
                    result?" had no answer anywhere in the system. [1.59.0] */}
                {reportsHere && <TableHead>Sent to patient</TableHead>}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {worklist.historyError ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns} className="p-0">
                    <EmptyState
                      compact
                      tone="error"
                      icon={WifiOff}
                      title="Couldn't load the released results"
                      description="The reports are still in the system; this screen could not read them."
                      action={<Button variant="outline" size="sm" onClick={worklist.refresh}>Try again</Button>}
                    />
                  </TableCell>
                </TableRow>
              ) : worklist.loading ? (
                <SkeletonRows rows={5} columns={columns} />
              ) : paged.length > 0 ? (
                paged.map(test => (
                  <TableRow key={test.visit_test_id} className="hover:bg-slate-50/70 transition-colors">
                    <TableCell label="Queue Ticket" className="py-3.5">
                      <DataBadge variant="queue" label="Queue ticket">{test.queue_number || `VT-${test.visit_test_id}`}</DataBadge>
                    </TableCell>

                    <TableCell label="Patient" className="py-3.5 text-fine font-bold text-slate-900">
                      {test.first_name} {test.last_name}
                    </TableCell>

                    <TableCell label="Examination" className="py-3.5 text-fine font-bold text-slate-800">
                      {test.test_name}
                      {/* A corrected report is not the same document as a first one, and this
                          screen's own description promises "including amended versions" while
                          showing nothing that distinguished them. A v2 read exactly like a v1,
                          so somebody scanning the history could not tell which reports had been
                          re-issued — which is the first thing you want to know when a patient
                          or a referring doctor rings up about one. `version` was already in the
                          payload; nothing displayed it. */}
                      {test.version > 1 && (
                        <span className="ml-1.5 inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-200">
                          Amended &middot; v{test.version}
                        </span>
                      )}
                      <span className="block text-meta font-normal text-slate-500">{test.category_name}</span>
                    </TableCell>

                    <TableCell label={reportsHere ? 'Released' : 'Done'} className="py-3.5 text-fine text-slate-600">
                      {test.performed_at ? (
                        <>
                          {formatDateTime(test.performed_at)}
                          {test.performed_by_first_name && (
                            <span className="block text-meta text-slate-500">by {test.performed_by_first_name} {test.performed_by_last_name}</span>
                          )}
                        </>
                      ) : (
                        <>
                          {test.released_at ? formatDateTime(test.released_at) : '—'}
                          {test.released_by_first_name && (
                            <span className="block text-meta text-slate-500">by {test.released_by_first_name} {test.released_by_last_name}</span>
                          )}
                        </>
                      )}
                    </TableCell>

                    {reportsHere && (
                    <TableCell label="Sent to patient" className="py-3.5 text-fine">
                      {test.emailed_at ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-brand-700">
                          <MailCheck className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                          <span>
                            {formatDateTime(test.emailed_at)}
                            <span className="block font-normal text-meta text-slate-500">
                              {test.emailed_to}
                              {test.email_count > 1 && ` · sent ${test.email_count}×`}
                            </span>
                          </span>
                        </span>
                      ) : test.patient_email ? (
                        // Released, has an address, not emailed. Since [1.113.0] that is the
                        // normal state: releasing does not email, and the button beside this sends
                        // it when the patient asks.
                        <span className="inline-flex items-center gap-1.5 text-slate-600">
                          <Mail className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                          Not sent
                        </span>
                      ) : (
                        // Most walk-ins. Not a fault — a patient registered at the counter has no
                        // account, so there is nowhere to send. Saying so here stops a technician
                        // pressing a button that can only ever refuse.
                        <span className="inline-flex items-center gap-1.5 text-slate-500">
                          <MailX className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                          No email on file
                        </span>
                      )}
                    </TableCell>
                    )}

                    <TableCell className="py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(reportsHere || test.result_id) && (
                          <Button onClick={() => onViewResult(test)} variant="outline" size="xs">
                            <Eye className="h-3 w-3" />
                            <span>View Report</span>
                          </Button>
                        )}
                        {canSend && reportsHere && (
                          <Button
                            onClick={() => delivery.requestSend(test)}
                            variant="outline"
                            size="xs"
                            loading={delivery.sendingId === test.visit_test_id}
                            disabled={!test.patient_email}
                            title={test.patient_email
                              ? `Send this report to ${test.patient_email}`
                              : 'This patient has no email address on file. Add one in Patient Records first.'}
                          >
                            <Mail className="h-3 w-3" />
                            <span>{test.emailed_at ? 'Send again' : 'Email'}</span>
                          </Button>
                        )}
                        {canAmend && reportsHere && (
                          <Button
                            onClick={() => entry.openForEdit(test)}
                            variant="outline"
                            size="xs"
                          >
                            <Pencil className="h-3 w-3" />
                            <span>Edit</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns} className="p-0">
                    <EmptyState
                      icon={History}
                      title={
                        worklist.search
                          ? 'Nothing matches that search'
                          : worklist.deliveryFilter === 'unsent'
                            ? 'Every released report has reached its patient'
                            : worklist.deliveryFilter === 'sent'
                              ? 'No sends recorded yet'
                              : reportsHere ? `No released ${categoryLabel} results yet` : `No ${categoryLabel} exams done yet`
                      }
                      description={
                        worklist.search
                          ? 'Try a surname, a test name, or a queue ticket number.'
                          : worklist.deliveryFilter === 'unsent'
                            ? 'Nothing is waiting to be sent.'
                            : worklist.deliveryFilter === 'sent'
                              ? 'Reports released before this was recorded show as unsent — that means unknown, not that the patient was never told.'
                              : reportsHere
                                ? 'A result appears here once it has been authorised for release from the worklist.'
                                : 'An exam appears here once it has been marked done on the worklist.'
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PanelBody>
        <Pagination
          page={worklist.historyPage}
          totalPages={totalPages}
          onPageChange={worklist.setHistoryPage}
          total={worklist.releasedTotal} pageSize={HISTORY_PAGE_SIZE}
        />
      </Panel>

      {/* Turnaround for this department. The worklist counts what is waiting; this is the
          only place that says how long the waiting takes. */}
      <div className="mt-4">
        <TurnaroundPanel
          diagnostics={operations.report?.diagnostics}
          loading={operations.loading}
          error={operations.error}
          onRetry={operations.refresh}
          title="Your turnaround"
          description="From payment to released report, last 7 days"
        />
      </div>
      </div>

      {/* Asked before sending, because a report reaching a patient is not an undoable click —
          and on a re-send the patient has already had one copy, so a second arriving
          unexpectedly is its own small alarm. */}
      <ConfirmDialog
        open={Boolean(delivery.confirming)}
        onOpenChange={(open) => { if (!open) delivery.dismissSend(); }}
        title={delivery.confirming?.emailed_at ? 'Send this report again?' : 'Email this report?'}
        description={delivery.confirming
          ? `${delivery.confirming.test_name} for ${delivery.confirming.first_name} ${delivery.confirming.last_name} will be sent to ${delivery.confirming.patient_email}.`
          : ''}
        confirmLabel="Send"
        loading={Boolean(delivery.sendingId)}
        onConfirm={delivery.confirmSend}
      />
      </>
  );
}
