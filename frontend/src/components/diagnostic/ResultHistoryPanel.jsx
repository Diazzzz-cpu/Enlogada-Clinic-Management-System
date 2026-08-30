import React from 'react';
import { categoryLabel as categoryLabelFor } from '../../lib/categories';

const PAGE_SIZE = 10;
import { Eye, History, Pencil, Mail, MailCheck, MailX } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel, PanelBody } from '../ui/panel';
import Toolbar, { ToolbarSpacer, SegmentedFilter } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { SearchInput } from '../ui/search-input';
import Pagination from '../ui/pagination';
import { formatDateTime } from '../../lib/date';
import { SkeletonRows } from '../ui/skeleton';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { TurnaroundPanel } from '../reports/OperationsPanels';

/**
 * Reports this department has already released, and its throughput beside them.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 */
export default function ResultHistoryPanel({ worklist, entry, operations, onViewResult, delivery }) {
  const categoryLabel = categoryLabelFor(worklist.category);

  // Client-side, because the worklist a department holds at once is small — a handful of
  // tickets, not the payments table. Filtering here keeps the search instant while the polling
  // in useDiagnosticWorklist keeps the underlying list fresh.
  const filtered = worklist.released.filter((t) => {
    const term = worklist.search.toLowerCase();
    const matchesSearch = !worklist.search ||
      `${t.first_name} ${t.last_name}`.toLowerCase().includes(term) ||
      t.test_name.toLowerCase().includes(term) ||
      (t.queue_number && t.queue_number.toLowerCase().includes(term));
    return matchesSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((worklist.historyPage - 1) * PAGE_SIZE, worklist.historyPage * PAGE_SIZE);

  return (
      <>
      <div>
        {/* Search Bar */}
        <Toolbar attached>
          {/* Released and DELIVERED are two different facts, and "not sent" is the pile worth
              having a button for: released reports the patient was never told about. It matters
              most after a mail outage, when the failures are a contiguous block with no other way
              to find them. Filtered at the server, against a partial index. [1.59.0] */}
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
          <span className="text-fine font-medium tabular-nums text-slate-500">
            {filtered.length} result{filtered.length === 1 ? '' : 's'}
          </span>
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
                <TableHead>Released</TableHead>
                {/* Whether the patient was actually TOLD. Released and delivered are two different
                    facts and the screen only ever showed the first, so "has she been sent her
                    result?" had no answer anywhere in the system. [1.59.0] */}
                <TableHead>Sent to patient</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {worklist.historyError ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-xs text-rose-600 font-semibold">
                    {worklist.historyError}{' '}
                    <button
                      type="button"
                      onClick={worklist.refresh}
                      className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-700"
                    >
                      Retry
                    </button>
                  </TableCell>
                </TableRow>
              ) : worklist.loading ? (
                <SkeletonRows rows={5} columns={6} />
              ) : paged.length > 0 ? (
                paged.map(test => (
                  <TableRow key={test.visit_test_id} className="hover:bg-slate-50/70 transition-colors">
                    <TableCell label="Queue Ticket" className="py-3.5">
                      <span className="font-extrabold text-xs text-slate-900 bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
                        {test.queue_number || `VT-${test.visit_test_id}`}
                      </span>
                    </TableCell>

                    <TableCell label="Patient" className="py-3.5 font-bold text-xs text-slate-900">
                      {test.first_name} {test.last_name}
                    </TableCell>

                    <TableCell label="Examination" className="py-3.5 text-xs font-bold text-gray-800">
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
                      <span className="block text-meta text-gray-400 font-normal">{test.category_name}</span>
                    </TableCell>

                    <TableCell label="Released" className="py-3.5 text-xs text-gray-500">
                      {test.released_at ? formatDateTime(test.released_at) : '—'}
                      {test.released_by_first_name && (
                        <span className="block text-meta text-gray-400">by {test.released_by_first_name} {test.released_by_last_name}</span>
                      )}
                    </TableCell>

                    <TableCell label="Sent to patient" className="py-3.5 text-xs">
                      {test.emailed_at ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-brand-700">
                          <MailCheck className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                          <span>
                            {formatDateTime(test.emailed_at)}
                            <span className="block font-normal text-meta text-gray-400">
                              {test.emailed_to}
                              {test.email_count > 1 && ` · sent ${test.email_count}×`}
                            </span>
                          </span>
                        </span>
                      ) : test.patient_email ? (
                        // Released, has an address, and no record of a send. Either it predates
                        // [1.59.0] (nothing was written down, so this honestly says "unknown")
                        // or the send failed at release. Both are cases for the button beside it.
                        <span className="inline-flex items-center gap-1.5 text-gray-500">
                          <Mail className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                          Not recorded
                        </span>
                      ) : (
                        // Most walk-ins. Not a fault — a patient registered at the counter has no
                        // account, so there is nowhere to send. Saying so here stops a technician
                        // pressing a button that can only ever refuse.
                        <span className="inline-flex items-center gap-1.5 text-gray-400">
                          <MailX className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                          No email on file
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="py-3.5 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <Button
                          onClick={() => onViewResult(test)}
                          variant="outline"
                          className="text-fine font-bold border-gray-200 hover:bg-brand-500 hover:text-white rounded-lg py-1 px-2.5 flex items-center space-x-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Report</span>
                        </Button>
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
                        <Button
                          onClick={() => entry.openForEdit(test)}
                          variant="outline"
                          size="xs"
                        >
                          <Pencil className="h-3 w-3" />
                          <span>Edit</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      icon={History}
                      title={
                        worklist.search
                          ? 'Nothing matches that search'
                          : worklist.deliveryFilter === 'unsent'
                            ? 'Every released report has reached its patient'
                            : worklist.deliveryFilter === 'sent'
                              ? 'No sends recorded yet'
                              : `No released ${categoryLabel} results yet`
                      }
                      description={
                        worklist.search
                          ? 'Try a surname, a test name, or a queue ticket number.'
                          : worklist.deliveryFilter === 'unsent'
                            ? 'Nothing is waiting to be sent.'
                            : worklist.deliveryFilter === 'sent'
                              ? 'Reports released before this was recorded show as unsent — that means unknown, not that the patient was never told.'
                              : 'A result appears here once it has been authorised for release from the worklist.'
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
          total={filtered.length} pageSize={PAGE_SIZE}
        />
      </Panel>

      {/* Turnaround for this department. The worklist counts what is waiting; this is the
          only place that says how long the waiting takes. */}
      <div className="mt-4">
        <TurnaroundPanel
          diagnostics={operations.report?.diagnostics}
          loading={operations.loading}
          title="Your turnaround"
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
