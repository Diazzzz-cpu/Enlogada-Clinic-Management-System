import React, { useCallback, useEffect, useState } from 'react';
import { printElement } from '../../lib/printArea';
import { Panel, PanelHeader, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import RefreshButton from '../../components/ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';
import EmptyState from '../../components/ui/empty-state';
import { SearchInput } from '../../components/ui/search-input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { StatusBadge } from '../../components/ui/status-badge';
import { SkeletonList } from '../../components/ui/skeleton';
import Pagination from '../../components/ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import Toolbar, { SegmentedFilter } from '../../components/ui/toolbar';
import { SkeletonRows } from '../../components/ui/skeleton';
import api from '../../config/api';
import { formatCurrency } from '../../lib/currency';
import ResultDocument from '../../components/ResultDocument';
import PatientEditDialog from '../../components/patients/PatientEditDialog';
import { useAuth } from '../../contexts/AuthContext';
import { Users, AlertCircle, Printer, FolderSearch, FileX2, Eye, Paperclip, Building2, Pencil, Archive, ArchiveRestore, FolderOpen, CircleCheck, CircleDot } from 'lucide-react';
import { DateField, RANGE_PRESETS } from '../../components/ui/date-field';
import { formatDate } from '../../lib/date';
import { toastSuccess, toastError } from '../../lib/toast';
import FindingsText from '../../components/diagnostic/FindingsText';

// UI/UX Modernization Phase 4: search results come back in one shot with no server-side
// pagination, so a client-side page size is proportionate (VISUAL_IDENTITY.md §3a #11).
const PAGE_SIZE = 15;

// Module 12: patient-records oversight — search-first, reusing GET /patients/search (already
// Admin/SuperAdmin-authorized, built for Module 7's receptionist lookup). Read-only; editing a
// patient's own profile is Module 4's (client) or Module 7's (receptionist walk-in) domain.
const PatientRecordsOversight = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  // UI/UX Modernization Phase 11: GET /results/history/:patientId was already
  // Admin/SuperAdmin-authorized, but nothing on this page ever called it — a search result was a
  // dead end with no way to see what tests/results that patient actually has on file.
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientHistory, setPatientHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [previewDoc, setPreviewDoc] = useState(null);
  // Which departments the last search was confined to, straight from the server. Shown, because
  // a scoped result set and an empty clinic look identical otherwise — and a lab tech who finds
  // four patients where the receptionist finds twenty should be told why, not left to wonder
  // whether the search is broken.
  const [departmentScope, setDepartmentScope] = useState(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const updatedAt = useFreshness(searching, error);
  /**
   * Whether the record is FINISHED — every test seen through and every bill settled.
   *
   * A filter rather than the default. This roster is also how the desk finds a patient to correct
   * a misspelt surname, how a record gets archived, and how a technician checks whose result they
   * are holding — all of which have to reach the patient who is in the building right now,
   * mid-visit, unpaid. Defaulting to complete-only would make the screen unable to find exactly
   * the people the clinic is currently treating.
   */
  const [recordStatus, setRecordStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [canArchive, setCanArchive] = useState(false);
  const [archiving, setArchiving] = useState(null);

  // Correcting a record. PUT /patients/:id has existed since the beginning with nothing on any
  // staff screen calling it, so a misspelt name or a wrong birthdate could only be fixed in the
  // database — and birthdate and sex are what diagnostic reference ranges are banded by.
  const { hasPermission } = useAuth();
  const canEditPatients = hasPermission('patients:update');
  const [editingPatient, setEditingPatient] = useState(null);
  const [patientTypes, setPatientTypes] = useState([]);

  // Fetched once, and only for accounts that can actually edit — the dialog needs the type list
  // and there is no reason to ask for it on behalf of a read-only account.
  useEffect(() => {
    if (!canEditPatients) return;
    api.get('/patients/types')
      .then((res) => setPatientTypes(res.data.data.patientTypes || []))
      .catch(() => setPatientTypes([]));
  }, [canEditPatients]);

  /** Reflect a saved correction in the list without making the user search again. */
  const applyEdit = (updated) => {
    setResults((prev) => (prev || []).map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setSelectedPatient((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
  };

  const handleViewHistory = async (patient) => {
    setSelectedPatient(patient);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      const res = await api.get(`/results/history/${patient.id}`);
      setPatientHistory(res.data.data.results || []);
    } catch (err) {
      setHistoryError(err.response?.data?.message || 'Failed to load this patient\'s test history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  /**
   * Load the roster. [1.56.0]
   *
   * This screen used to open on "search for a patient to begin" and could show at most 20 rows,
   * un-paged — so the 21st match was unreachable by any means, and there was no way to simply
   * LOOK at the records, which is what somebody sitting down to review them wants.
   *
   * Paged, filtered and counted at the SERVER. Doing any of it here would mean fetching a roster
   * that only grows to slice twenty rows out of it.
   */
  const load = useCallback(async (opts = {}) => {
    const {
      q = query, p = 1, dateFrom = from, dateTo = to, archived = showArchived,
      status = recordStatus,
    } = opts;
    setError('');
    setSearching(true);
    try {
      const res = await api.get('/patients/search', {
        params: {
          // Omitted rather than sent empty: a blank q is "browse", and the server's own
          // two-character floor should never be argued with by an empty string.
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(dateFrom && dateTo ? { from: dateFrom, to: dateTo } : {}),
          ...(archived ? { includeArchived: 'true' } : {}),
          // Filtered at the SERVER, so the count beside the list is the count of what matches
          // rather than the count of the page in hand.
          ...(status !== 'all' ? { recordStatus: status } : {}),
          page: p,
          limit: PAGE_SIZE,
        },
      });
      const d = res.data.data;
      setResults(d.patients);
      setTotal(d.total ?? d.patients.length);
      setTotalPages(d.totalPages ?? 1);
      setPage(d.page ?? p);
      setCanArchive(Boolean(d.canArchive));
      setDepartmentScope(d.departmentScope ?? null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load patient records.');
      setResults(null);
    } finally {
      setSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, from, to, showArchived, recordStatus]);

  // Open on the roster rather than on a prompt. Recent first, which is what a live clinic's
  // records screen is for.
  useEffect(() => {
    load({ p: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    load({ p: 1 });
  };

  /**
   * Archive a record, or put it back.
   *
   * Nothing is deleted — the visits, bills and results stay exactly as they were. The list is
   * re-read afterwards rather than spliced, because archiving REMOVES the row from the default
   * view and the totals have to move with it.
   */
  const toggleArchive = async (patient) => {
    const archiving = !patient.archived_at;
    setArchiving(patient.id);
    try {
      const res = await api.patch(`/patients/${patient.id}/archive`, { archived: archiving });
      toastSuccess(res.data.message);
      await load({ p: page });
    } catch (err) {
      toastError(err.response?.data?.message || 'That record could not be archived.');
    } finally {
      setArchiving(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oversight"
        icon={FolderSearch}
        title="Patient Records"
        description="Search the clinic-wide roster, across client-owned and walk-in profiles. Opening a record is audited."
        actions={
          // Re-runs what is on screen, keeping the page. `load()` bare defaults to p = 1, which
          // would throw a reader on page 3 back to the start — a refresh that loses your place
          // is a navigation, not a refresh.
          <RefreshButton onRefresh={() => load({ p: page })} loading={searching} updatedAt={updatedAt} />
        }
      />

      <Panel>
        <PanelBody className="space-y-3">
          <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-2">
            <SearchInput
              containerClassName="min-w-[14rem] flex-1"
              placeholder="Search name or contact number… (or leave blank to browse)"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search patient records"
            />
            {/* Filters on WHEN THEY WERE LAST HERE, not when the record was typed. "Show me this
                month's patients" means their visits. Both dates or neither — a half-open range
                the reader did not intend is worse than no filter. */}
            <DateField
              presets={RANGE_PRESETS.start}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              containerClassName="w-[9.5rem]"
              aria-label="Seen from"
            />
            <span className="pb-2 text-fine text-slate-400">to</span>
            <DateField
              presets={RANGE_PRESETS.end}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              containerClassName="w-[9.5rem]"
              aria-label="Seen to"
            />
            <Button type="submit" loading={searching}>Apply</Button>
            {(query || from || to) && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setQuery(''); setFrom(''); setTo(''); load({ q: '', dateFrom: '', dateTo: '', p: 1 }); }}
              >
                Clear
              </Button>
            )}
            {/* Only for whoever can put a record back. Reading the archive is reading records
                deliberately taken out of circulation, and someone who cannot restore one has no
                reason to be shown it — the API refuses them either way. */}
            {canArchive && (
              <label className="flex cursor-pointer items-center gap-1.5 pb-1.5 text-fine font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => { setShowArchived(e.target.checked); load({ archived: e.target.checked, p: 1 }); }}
                  className="rounded text-brand-600 focus:ring-brand-500"
                />
                Show archived
              </label>
            )}
          </form>

          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-fine font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {departmentScope && (
            <p className="m-0 flex items-center gap-1.5 pt-1 text-fine text-slate-500">
              <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
              Showing patients with <strong className="font-semibold text-slate-700">{departmentScope.join(', ')}</strong> work only — that is your department. A SuperAdmin can widen this per account.
            </p>
          )}
        </PanelBody>
      </Panel>

      {results && (
        <div>
          {/* Whether the record is FINISHED, which is what somebody sitting down to REVIEW records
              means — as opposed to looking a patient up, which is the other half of what this
              screen is for and needs the whole roster. Filtered at the server, so the count in
              the panel header below is the count of what matches. [1.59.0] */}
          <Toolbar attached>
            <SegmentedFilter
              ariaLabel="Filter records by whether they are complete"
              options={[
                { value: 'all', label: 'All records' },
                { value: 'complete', label: 'Complete' },
                { value: 'open', label: 'Still open' },
              ]}
              value={recordStatus}
              onChange={(next) => { setRecordStatus(next); load({ status: next, p: 1 }); }}
            />
            <span className="text-fine text-slate-500">
              {recordStatus === 'complete'
                ? 'Every test seen through and every bill settled.'
                : recordStatus === 'open'
                  ? 'Work still outstanding, or a bill not yet settled.'
                  : 'Everyone on the roster, patients mid-visit included.'}
            </span>
          </Toolbar>

          <Panel className="overflow-hidden rounded-t-none">
            <PanelHeader
              title={`${total} record${total === 1 ? '' : 's'}`}
              description={
                query || from || to
                  ? 'Matching your filters. Select a patient to open their test history.'
                  : 'Most recently seen first. Select a patient to open their test history.'
              }
              icon={Users}
            />
            <PanelBody flush>
              <Table stack>
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Diagnostic work</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Last report</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searching ? (
                    <SkeletonRows rows={6} columns={6} />
                  ) : results.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="p-0">
                        <EmptyState
                          icon={FileX2}
                          title={query || from || to || recordStatus !== 'all'
                            ? 'No records match those filters'
                            : 'No patient records yet'}
                          description={query || from || to || recordStatus !== 'all'
                            ? 'Check the spelling, widen the dates, or clear the filters to browse everyone.'
                            : 'Records appear here as patients are registered.'}
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    results.map(patient => {
                      // "Complete" restated only to label the row. The SERVER decides membership
                      // of the filter; this decides which pip to draw beside the count.
                      const testCount = Number(patient.test_count) || 0;
                      const releasedCount = Number(patient.released_count) || 0;
                      const complete = testCount > 0 && releasedCount === testCount;

                      return (
                        <TableRow
                          key={patient.id}
                          data-testid="patient-row"
                          data-patient-id={patient.id}
                          className="transition-colors hover:bg-slate-50/70"
                        >
                          <TableCell label="Patient" className="py-3.5">
                            <span className="block text-xs font-bold text-slate-900">
                              {patient.first_name} {patient.last_name}
                            </span>
                            <span className="block font-mono text-meta font-normal text-gray-400">
                              PT-{patient.id}
                            </span>
                            {patient.archived_at && (
                              <Badge variant="outline" className="mt-1">Archived</Badge>
                            )}
                          </TableCell>

                          <TableCell label="Details" className="py-3.5 text-xs text-gray-600">
                            {patient.sex} &middot; {formatDate(patient.birthdate)}
                            <span className="block text-meta text-gray-400">
                              {patient.contact_number || 'No contact on file'}
                              {patient.patient_type_name ? ` \u00b7 ${patient.patient_type_name}` : ''}
                            </span>
                          </TableCell>

                          {/* What the record CONTAINS. A visit count says they came; a released
                              count says there is something to read. Deliberately no billing
                              state — whether a bill is settled is the Billing Queue's question,
                              and a clinical records roster that answers it reads as a debtors
                              list. [1.59.0] */}
                          <TableCell label="Diagnostic work" className="py-3.5 text-xs">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                              {complete ? (
                                <CircleCheck className="h-3.5 w-3.5 flex-shrink-0 text-brand-600" aria-hidden="true" />
                              ) : (
                                <CircleDot className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" aria-hidden="true" />
                              )}
                              <span className="tabular-nums">{releasedCount}/{testCount} released</span>
                            </span>
                            <span className="block text-meta tabular-nums text-gray-400">
                              {patient.visit_count} visit{Number(patient.visit_count) === 1 ? '' : 's'}
                            </span>
                          </TableCell>

                          <TableCell label="Last seen" className="py-3.5 text-xs text-gray-500">
                            {patient.last_visit_at ? formatDate(patient.last_visit_at) : '\u2014'}
                          </TableCell>

                          <TableCell label="Last report" className="py-3.5 text-xs text-gray-500">
                            {patient.last_released_at ? formatDate(patient.last_released_at) : '\u2014'}
                          </TableCell>

                          <TableCell className="py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() => handleViewHistory(patient)}
                              >
                                <FolderOpen className="h-3 w-3" />
                                <span>Open records</span>
                              </Button>

                              {/* Only for accounts holding patients:update. Diagnostic roles hold
                                  patients:read and not the write — they may read whose result they
                                  are looking at, and must not be able to change a birthdate that
                                  decides how it is interpreted. The API enforces the same thing;
                                  this keeps the screen from offering a control it would refuse. */}
                              {canEditPatients && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="xs"
                                  onClick={() => setEditingPatient(patient)}
                                >
                                  <Pencil className="h-3 w-3" />
                                  <span>Correct</span>
                                </Button>
                              )}

                              {/* Archive is not delete, and the tooltip says so. Nothing is
                                  removed — the visits, bills and results stay; the record simply
                                  leaves the roster the front desk searches all day. */}
                              {canArchive && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="xs"
                                  loading={archiving === patient.id}
                                  onClick={() => toggleArchive(patient)}
                                  title={patient.archived_at
                                    ? 'Put this record back in the active roster'
                                    : 'Take this record out of the roster. Nothing is deleted.'}
                                >
                                  {patient.archived_at
                                    ? <ArchiveRestore className="h-3 w-3" />
                                    : <Archive className="h-3 w-3" />}
                                  <span>{patient.archived_at ? 'Restore' : 'Archive'}</span>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </PanelBody>
            {total > 0 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={(next) => load({ p: next })}
                total={total}
                pageSize={PAGE_SIZE}
                totalLabel="records"
              />
            )}
          </Panel>
        </div>
      )}

      <Dialog open={!!selectedPatient} onOpenChange={(open) => { if (!open) setSelectedPatient(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedPatient?.first_name} {selectedPatient?.last_name}'s Test Records
            </DialogTitle>
            <DialogDescription>
              PT-{selectedPatient?.id} &bull; {selectedPatient?.patient_type_name}
            </DialogDescription>
          </DialogHeader>

          {historyError && (
            <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-fine font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{historyError}</span>
            </div>
          )}

          {historyLoading ? (
            <SkeletonList rows={3} />
          ) : patientHistory.length === 0 ? (
            <EmptyState
              compact
              icon={FileX2}
              title="No tests on file"
              description="This patient has a record but has not been through a diagnostic visit yet."
            />
          ) : (
            <>
              <div className="print-area max-h-96 space-y-2 overflow-y-auto pr-1">
                <div className="mb-3 hidden border-b border-slate-200 pb-3 text-center print:block">
                  <h3 className="m-0 text-sm font-extrabold uppercase tracking-wide text-slate-900">Enlogada Ultrasound &amp; Diagnostic Clinic</h3>
                  <p className="m-0 text-fine text-slate-500">Patient Test Records — {selectedPatient?.first_name} {selectedPatient?.last_name} (PT-{selectedPatient?.id})</p>
                </div>
                {patientHistory.map(item => (
                  <div key={item.visit_test_id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-note font-semibold text-slate-900">
                        {item.test_name} <span className="text-fine font-normal text-slate-400">({item.category_name})</span>
                      </span>
                      <StatusBadge status={item.test_status} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-fine text-slate-500">
                      <span>{new Date(item.visit_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} &bull; {formatCurrency(item.price_at_time)}</span>
                      {item.released_at && <span>Released {new Date(item.released_at).toLocaleDateString()}</span>}
                    </div>
                    {item.findings && (
                      <div className="mt-2 border-t border-line-soft pt-2 text-fine leading-relaxed text-slate-600">
                        <FindingsText findings={item.findings} />
                      </div>
                    )}
                    {/* The attachment was never surfaced on this screen at all — the query has
                        returned file_path since [1.7.0] and nothing rendered it, so the one
                        person most likely to be asked "what does the report actually say" could
                        read the findings text but not open the document itself. */}
                    {item.file_path && (
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line-soft pt-2">
                        <span className="flex min-w-0 items-center gap-1.5 text-fine text-slate-500">
                          <Paperclip className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{item.file_original_name || 'Attached report'}</span>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => setPreviewDoc({
                            visitTestId: item.visit_test_id,
                            testName: item.test_name,
                            patientName: `${selectedPatient?.first_name || ''} ${selectedPatient?.last_name || ''}`.trim(),
                            fileName: item.file_original_name,
                          })}
                        >
                          <Eye className="h-3 w-3" />
                          View Report
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end border-t border-line pt-3">
                <Button type="button" variant="outline" onClick={() => printElement()}>
                  <Printer className="h-3.5 w-3.5" />
                  Print Patient Test Records
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ResultDocument
        open={Boolean(previewDoc)}
        onOpenChange={(o) => { if (!o) setPreviewDoc(null); }}
        visitTestId={previewDoc?.visitTestId}
        testName={previewDoc?.testName}
        patientName={previewDoc?.patientName}
        fileName={previewDoc?.fileName}
      />

      <PatientEditDialog
        open={Boolean(editingPatient)}
        onOpenChange={(o) => { if (!o) setEditingPatient(null); }}
        patient={editingPatient}
        patientTypes={patientTypes}
        onSaved={applyEdit}
      />
    </div>
  );
};

export default PatientRecordsOversight;
