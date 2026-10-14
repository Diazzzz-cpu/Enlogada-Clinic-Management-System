import React, { Fragment, useCallback, useEffect, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import RefreshButton from '../../components/ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';
import EmptyState from '../../components/ui/empty-state';
import { SearchInput } from '../../components/ui/search-input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { SkeletonList, SkeletonRows } from '../../components/ui/skeleton';
import Pagination from '../../components/ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import api from '../../config/api';
import ResultDocument from '../../components/ResultDocument';
import PatientEditDialog from '../../components/patients/PatientEditDialog';
import PatientFile from '../../components/patients/PatientFile';
import { useAuth } from '../../contexts/AuthContext';
import {
  Users, AlertCircle, Printer, FolderSearch, FileX2, Eye, Building2, Pencil, Archive,
  ArchiveRestore, ChevronRight, FileText,
} from 'lucide-react';
import { DateField, RANGE_PRESETS } from '../../components/ui/date-field';
import { formatDate } from '../../lib/date';
import { previewKindFor } from '../../lib/preview';
import { toastSuccess, toastError } from '../../lib/toast';

// UI/UX Modernization Phase 4: search results come back in one shot with no server-side
// pagination, so a client-side page size is proportionate (VISUAL_IDENTITY.md §3a #11).
const PAGE_SIZE = 15;

/**
 * Patient Records: the roster, and each patient's FINAL record under their name. [1.108.0]
 *
 * Two audiences, one screen, decided by permission rather than by role:
 *
 * - Whoever holds `results:read` (Admin, SuperAdmin, the departments) can open a patient: their
 *   released results drop down under the name, newest visit first, each with View and Print.
 *   Only AUTHORISED reports — a test still being worked on is the worklist's business, not a
 *   record. A department sees its own department's results, and the count beside the name is of
 *   the same set.
 * - The front desk and the till see who the patient is — contact, birthdate, type, how often and
 *   when they were last here — which is what recognising a returning patient takes. No result
 *   column, and the server does not send them the counts either. [1.116.0] Their name opens the
 *   patient's FILE instead (components/patients/PatientFile.jsx): what else is on file, the visits
 *   and what each was for, and, for whoever can start one, the way to the Desk with the patient
 *   already found, so a returning patient is never typed in again.
 *
 * It replaced a dialog that listed every test ever ordered, "Pending" ones included, behind an
 * "Open records" button that a receptionist could press and get a 403 from.
 *
 * Opening a patient's records, opening a report, printing it and downloading it each write a
 * line in the Activity Log.
 */
const PatientRecordsOversight = ({ onSelectNav }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  // Which departments the last search was confined to, straight from the server. Shown, because
  // a scoped result set and an empty clinic look identical otherwise.
  const [departmentScope, setDepartmentScope] = useState(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const updatedAt = useFreshness(searching, error);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [canArchive, setCanArchive] = useState(false);
  const [archiving, setArchiving] = useState(null);

  const { hasPermission } = useAuth();
  const canReadResults = hasPermission('results:read');
  const canEditPatients = hasPermission('patients:update');
  const canStartVisit = hasPermission('visits:create') && Boolean(onSelectNav);
  const [editingPatient, setEditingPatient] = useState(null);
  const [patientTypes, setPatientTypes] = useState([]);

  // One patient open at a time, and each patient's records fetched once per opening of the
  // screen: closing and reopening the same row does not ask (and log) again. Refresh forgets them.
  const [expandedId, setExpandedId] = useState(null);
  const [records, setRecords] = useState({});
  // The report being viewed or printed. `autoPrint` is the row's Print button.
  const [doc, setDoc] = useState(null);

  // Fetched once, and only for accounts that can actually edit.
  useEffect(() => {
    if (!canEditPatients) return;
    api.get('/patients/types')
      .then((res) => setPatientTypes(res.data.data.patientTypes || []))
      .catch(() => setPatientTypes([]));
  }, [canEditPatients]);

  /** Reflect a saved correction in the list without making the user search again. */
  const applyEdit = (updated) => {
    setResults((prev) => (prev || []).map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
  };

  // What a name opens: the released results for whoever may read them, the patient's file for
  // everyone else. Opening the file reads the record, which the server logs as a PHI read.
  const loadRecords = useCallback(async (patientId) => {
    setRecords((prev) => ({ ...prev, [patientId]: { status: 'loading', rows: [], error: '' } }));
    try {
      if (!canReadResults) {
        const [record, history] = await Promise.all([
          api.get(`/patients/${patientId}`),
          api.get(`/visits/patient/${patientId}`),
        ]);
        setRecords((prev) => ({
          ...prev,
          [patientId]: {
            status: 'ready', rows: [], error: '',
            patient: record.data.data.patient,
            visits: history.data.data.visits || [],
          },
        }));
        return;
      }
      const res = await api.get(`/results/history/${patientId}`, { params: { released: 'true' } });
      setRecords((prev) => ({ ...prev, [patientId]: { status: 'ready', rows: res.data.data.results || [], error: '' } }));
    } catch (err) {
      setRecords((prev) => ({
        ...prev,
        [patientId]: {
          status: 'error',
          rows: [],
          error: err.response?.data?.message || "This patient's records could not be loaded.",
        },
      }));
    }
  }, [canReadResults]);

  const toggleRecords = (patient) => {
    if (expandedId === patient.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(patient.id);
    if (!records[patient.id] || records[patient.id].status === 'error') loadRecords(patient.id);
  };

  /**
   * Load the roster. [1.56.0] Paged, filtered and counted at the SERVER.
   */
  const load = useCallback(async (opts = {}) => {
    const { q = query, p = 1, dateFrom = from, dateTo = to, archived = showArchived } = opts;
    setError('');
    setSearching(true);
    try {
      const res = await api.get('/patients/search', {
        params: {
          // Omitted rather than sent empty: a blank q is "browse".
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(dateFrom && dateTo ? { from: dateFrom, to: dateTo } : {}),
          ...(archived ? { includeArchived: 'true' } : {}),
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
  }, [query, from, to, showArchived]);

  // Open on the roster, most recently seen first.
  useEffect(() => {
    load({ p: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setExpandedId(null);
    load({ p: 1 });
  };

  // Re-runs what is on screen, keeping the page, and re-reads the open patient's records.
  const refresh = () => {
    setRecords({});
    load({ p: page });
    if (expandedId) loadRecords(expandedId);
  };

  /** Archive a record, or put it back. Nothing is deleted. */
  const toggleArchive = async (patient) => {
    const archivingNow = !patient.archived_at;
    setArchiving(patient.id);
    try {
      const res = await api.patch(`/patients/${patient.id}/archive`, { archived: archivingNow });
      toastSuccess(res.data.message);
      await load({ p: page });
    } catch (err) {
      toastError(err.response?.data?.message || 'That record could not be archived.');
    } finally {
      setArchiving(null);
    }
  };

  const columnCount = canReadResults ? 5 : 4;
  const fullName = (p) => `${p.first_name || ''} ${p.last_name || ''}`.trim();

  return (
    <div className="space-y-5">
      <PageHeader
        icon={FolderSearch}
        title="Patient Records"
        description={canReadResults
          ? "Search a patient, then open their name to see their released results. Opening, printing and downloading a report are recorded in the Activity Log."
          : canStartVisit
            ? 'Search a patient, then open their name to see their file and start their next visit without typing them in again.'
            : 'Search a patient, then open their name to see their file and their past visits.'}
        actions={<RefreshButton onRefresh={refresh} loading={searching} updatedAt={updatedAt} />}
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
            {/* Filters on WHEN THEY WERE LAST HERE, not when the record was typed. Both dates or
                neither — a half-open range the reader did not intend is worse than no filter. */}
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
                onClick={() => { setQuery(''); setFrom(''); setTo(''); setExpandedId(null); load({ q: '', dateFrom: '', dateTo: '', p: 1 }); }}
              >
                Clear
              </Button>
            )}
            {/* Only for whoever can put a record back; the API refuses everyone else either way. */}
            {canArchive && (
              <label className="flex cursor-pointer items-center gap-1.5 pb-1.5 text-fine font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => { setShowArchived(e.target.checked); setExpandedId(null); load({ archived: e.target.checked, p: 1 }); }}
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
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Patients"
            description={
              query || from || to
                ? `Matching your filters. ${canReadResults ? 'Open a name to see their released results.' : 'Open a name to see their file.'}`
                : `Most recently seen first. ${canReadResults ? 'Open a name to see their released results.' : 'Open a name to see their file.'}`
            }
            icon={Users}
          />
          <PanelBody flush>
            <Table stack>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Visits</TableHead>
                  {canReadResults && <TableHead>Results</TableHead>}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {searching ? (
                  <SkeletonRows rows={6} columns={columnCount} />
                ) : results.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={columnCount} className="p-0">
                      <EmptyState
                        icon={FileX2}
                        title={query || from || to ? 'No records match those filters' : 'No patient records yet'}
                        description={query || from || to
                          ? 'Check the spelling, widen the dates, or clear the filters to browse everyone.'
                          : 'Records appear here as patients are registered.'}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  results.map((patient) => {
                    const open = expandedId === patient.id;
                    const released = Number(patient.released_count) || 0;
                    const visits = Number(patient.visit_count) || 0;
                    return (
                      <Fragment key={patient.id}>
                        <TableRow
                          data-testid="patient-row"
                          data-patient-id={patient.id}
                          className={open ? 'bg-brand-50/40 hover:bg-brand-50/60' : 'transition-colors hover:bg-slate-50/70'}
                        >
                          <TableCell label="Patient" className="py-3.5">
                            {/* The name opens the patient: results for a results reader, the file
                                for everyone else. [1.116.0] */}
                            <button
                              type="button"
                              onClick={() => toggleRecords(patient)}
                              aria-expanded={open}
                              aria-controls={`${canReadResults ? 'patient-results' : 'patient-file'}-${patient.id}`}
                              data-testid="patient-records-toggle"
                              className="flex items-start gap-1.5 border-0 bg-transparent p-0 text-left cursor-pointer"
                            >
                              <ChevronRight
                                aria-hidden="true"
                                className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90 text-brand-600' : ''}`}
                              />
                              <span>
                                <span className="block text-xs font-bold text-slate-900 underline-offset-2 hover:underline">
                                  {fullName(patient)}
                                </span>
                                <span className="block font-mono text-meta font-normal text-gray-400">PT-{patient.id}</span>
                              </span>
                            </button>
                            {patient.archived_at && (
                              <Badge variant="outline" className="mt-1">Archived</Badge>
                            )}
                          </TableCell>

                          <TableCell label="Details" className="py-3.5 text-xs text-gray-600">
                            {patient.sex} &middot; {formatDate(patient.birthdate)}
                            <span className="block text-meta text-gray-400">
                              {patient.contact_number || 'No contact on file'}
                              {patient.patient_type_name ? ` · ${patient.patient_type_name}` : ''}
                            </span>
                          </TableCell>

                          {/* How often and when: what tells the desk this is a returning patient. */}
                          <TableCell label="Visits" className="py-3.5 text-xs">
                            <span className="font-semibold tabular-nums text-slate-700">
                              {visits} visit{visits === 1 ? '' : 's'}
                            </span>
                            <span className="block text-meta text-gray-400">
                              {patient.last_visit_at ? `Last seen ${formatDate(patient.last_visit_at)}` : 'Not seen yet'}
                            </span>
                          </TableCell>

                          {canReadResults && (
                            <TableCell label="Results" className="py-3.5 text-xs">
                              <span className="font-semibold tabular-nums text-slate-700">
                                {released > 0 ? `${released} released` : 'None released yet'}
                              </span>
                              {patient.last_released_at && (
                                <span className="block text-meta text-gray-400">Last {formatDate(patient.last_released_at)}</span>
                              )}
                            </TableCell>
                          )}

                          <TableCell className="py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {/* Only for accounts holding patients:update; the API enforces the same. */}
                              {canEditPatients && (
                                <Button type="button" variant="outline" size="xs" onClick={() => setEditingPatient(patient)}>
                                  <Pencil className="h-3 w-3" />
                                  <span>Correct</span>
                                </Button>
                              )}
                              {/* Archive is not delete: the record leaves the roster, nothing is removed. */}
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
                                  {patient.archived_at ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                                  <span>{patient.archived_at ? 'Restore' : 'Archive'}</span>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {open && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={columnCount} className="bg-slate-50/60 p-0">
                              {canReadResults ? (
                                <PatientResults
                                  id={`patient-results-${patient.id}`}
                                  entry={records[patient.id]}
                                  scoped={Boolean(departmentScope)}
                                  onRetry={() => loadRecords(patient.id)}
                                  onView={(row) => setDoc({ row, patientName: fullName(patient), autoPrint: false })}
                                  onPrint={(row) => setDoc({ row, patientName: fullName(patient), autoPrint: true })}
                                />
                              ) : (
                                <PatientFile
                                  id={`patient-file-${patient.id}`}
                                  entry={records[patient.id]}
                                  patientName={fullName(patient)}
                                  archived={Boolean(patient.archived_at)}
                                  canStartVisit={canStartVisit}
                                  // The Desk's own lookup, with the name typed in for them: it lists
                                  // the record with Start visit, or the queue row if already here.
                                  onStartVisit={() => onSelectNav('reception-queue', { find: fullName(patient) })}
                                  onRetry={() => loadRecords(patient.id)}
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
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
              onPageChange={(next) => { setExpandedId(null); load({ p: next }); }}
              total={total}
              pageSize={PAGE_SIZE}
              totalLabel="records"
            />
          )}
        </Panel>
      )}

      <ResultDocument
        open={Boolean(doc)}
        onOpenChange={(o) => { if (!o) setDoc(null); }}
        visitTestId={doc?.row.visit_test_id}
        testName={doc?.row.test_name}
        patientName={doc?.patientName}
        fileName={doc?.row.file_original_name}
        authorisedOnly
        autoPrint={Boolean(doc?.autoPrint)}
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

/**
 * The released results under a patient's name, newest visit first.
 *
 * A report that is a PDF or an image can be printed from here; a Word document or a spreadsheet
 * cannot be printed by a browser, so it offers View, which opens it to download.
 */
function PatientResults({ id, entry, scoped, onRetry, onView, onPrint }) {
  if (!entry || entry.status === 'loading') {
    return <div id={id} className="p-4"><SkeletonList rows={2} /></div>;
  }
  if (entry.status === 'error') {
    return (
      <div id={id}>
        <EmptyState
          compact
          tone="error"
          icon={AlertCircle}
          title="Couldn't load this patient's records"
          description={entry.error}
          action={<Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
        />
      </div>
    );
  }
  if (entry.rows.length === 0) {
    return (
      <div id={id}>
        <EmptyState
          compact
          icon={FileX2}
          title="No released results yet"
          description={scoped
            ? 'Nothing from your department has been released for this patient.'
            : 'A result appears here once its report has been released.'}
        />
      </div>
    );
  }

  return (
    <ul id={id} data-testid="patient-results" className="m-0 list-none divide-y divide-line p-0">
      {entry.rows.map((row) => {
        const printable = Boolean(previewKindFor(row.file_mime_type));
        const releasedBy = [row.released_by_first_name, row.released_by_last_name].filter(Boolean).join(' ');
        return (
          <li
            key={row.visit_test_id}
            data-testid="patient-result"
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:pl-10"
          >
            <div className="min-w-0">
              <p className="m-0 flex flex-wrap items-center gap-1.5 text-note font-semibold text-slate-900">
                {row.test_name}
                <Badge variant="outline">{row.category_name}</Badge>
                {Number(row.version) > 1 && <Badge variant="outline">Amended</Badge>}
              </p>
              <p className="m-0 text-fine text-slate-500">
                Visit {formatDate(row.visit_date)} · Released {formatDate(row.authorised_at)}
                {releasedBy ? ` by ${releasedBy}` : ''}
              </p>
              {row.has_file && row.file_original_name && (
                <p className="m-0 flex items-center gap-1 text-meta text-slate-400">
                  <FileText className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                  <span className="truncate">{row.file_original_name}</span>
                </p>
              )}
            </div>
            {row.has_file ? (
              <div className="flex flex-shrink-0 items-center gap-2">
                <Button type="button" variant="outline" size="xs" onClick={() => onView(row)}>
                  <Eye className="h-3 w-3" />
                  View
                </Button>
                {printable && (
                  <Button type="button" variant="outline" size="xs" onClick={() => onPrint(row)}>
                    <Printer className="h-3 w-3" />
                    Print
                  </Button>
                )}
              </div>
            ) : (
              <span className="text-fine text-slate-400">No report file attached</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default PatientRecordsOversight;
