import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import RefreshButton from '../../components/ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';
import Toolbar, { SegmentedFilter } from '../../components/ui/toolbar';
import EmptyState from '../../components/ui/empty-state';
import { Button } from '../../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { StatusBadge } from '../../components/ui/status-badge';
import { SkeletonRows } from '../../components/ui/skeleton';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { CalendarClock } from 'lucide-react';
import { formatTime12 } from '../../lib/date';

const STATUS_FILTERS = ['All', 'Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show'];

// Sent to the server as `limit` — GET /appointments pages at the database now [1.29.0].
const PAGE_SIZE = 15;

// Module 12: appointments oversight — read-only. Rescheduling/cancelling is Receptionist's
// (Module 7) or the Client's own (Module 3) job; this view is visibility only, per
// MODULE_SCOPE.md's "oversight" wording.
const AppointmentsOversight = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed fetch used to reach console.error and stop there, so the screen rendered its
  // EMPTY state — "No appointments yet" over a 500. That is the one thing empty-state.jsx's own
  // docstring says must never happen: a quiet clinic and a broken server call for opposite
  // responses, and one of them was being reported as the other.
  const [loadError, setLoadError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Paged at the server. [1.29.0] This pulled every appointment the clinic has ever booked and
  // sliced fifteen out here.
  const fetchAppointments = useCallback(async (nextPage = 1) => {
    setLoading(true);
    setLoadError('');
    try {
      const params = { page: nextPage, limit: PAGE_SIZE };
      if (statusFilter !== 'All') params.status = statusFilter;
      const res = await api.get('/appointments', { params });
      const { appointments: rows, total: count, totalPages: pages } = res.data.data;
      setAppointments(rows || []);
      setTotal(count ?? (rows || []).length);
      setTotalPages(pages || 1);
      setPage(nextPage);
    } catch (err) {
      // Recorded, not just logged: a swallowed failure renders as an empty list.
      console.error('Failed to fetch appointments:', err);
      setLoadError(err.response?.data?.message || 'The server did not respond. The list below may be out of date.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // `appointments` IS the page — the server sent exactly these rows.
  const pagedAppointments = appointments;

  // Bookings arrive from the patient portal while this screen is open, so a list fetched on
  // mount is out of date the moment somebody books.
  const updatedAt = useFreshness(loading, loadError);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oversight"
        icon={CalendarClock}
        title="Appointments"
        description="Clinic-wide view of every booked appointment. Read-only — rescheduling and cancellation belong to Reception or the patient."
        meta={(loadError || loading) ? undefined : (
          <span>
            <strong className="font-semibold text-slate-700">{total}</strong>{' '}
            {statusFilter === 'All' ? 'total' : statusFilter.toLowerCase()}
          </span>
        )}
        actions={
          <RefreshButton onRefresh={() => fetchAppointments(page)} loading={loading} updatedAt={updatedAt} />
        }
      />

      {/* Toolbar and table are one object, so they are wrapped in a bare div — the page's
          `space-y` would otherwise insert a gap between a filter row and the list it filters. */}
      <div>
        <Toolbar attached>
          <SegmentedFilter
            ariaLabel="Filter appointments by status"
            options={STATUS_FILTERS.map(s => ({ value: s, label: s }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </Toolbar>

        <Panel className="overflow-hidden rounded-t-none">
          <PanelBody flush>
          <Table>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Visit Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Error before empty. A failed fetch used to fall through to the empty branch,
                  so a 500 rendered as "nothing here yet" — which is a false statement about the
                  clinic's data, not merely an unhelpful one. */}
              {loadError ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      tone="error"
                      title="Could not load appointments"
                      description={loadError}
                      action={<Button variant="outline" size="sm" onClick={() => fetchAppointments()}>Try again</Button>}
                    />
                  </TableCell>
                </TableRow>
              ) : loading ? (
                <SkeletonRows rows={6} columns={5} />
              ) : pagedAppointments.length > 0 ? (
                pagedAppointments.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-fine text-slate-500">{a.appointment_reference}</TableCell>
                    <TableCell className="font-semibold text-slate-900">{a.first_name} {a.last_name}</TableCell>
                    <TableCell>
                      {new Date(a.scheduled_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} &bull; {formatTime12(a.scheduled_time)}
                    </TableCell>
                    <TableCell className="text-slate-500">{a.visit_type}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      icon={CalendarClock}
                      title={statusFilter === 'All' ? 'No appointments booked' : `Nothing is ${statusFilter.toLowerCase()}`}
                      description={
                        statusFilter === 'All'
                          ? 'Appointments booked online or by phone appear here.'
                          : 'Try another status filter, or switch back to All.'
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </PanelBody>
          <Pagination page={page} totalPages={totalPages} onPageChange={fetchAppointments} total={loadError ? 0 : total} pageSize={PAGE_SIZE} />
        </Panel>
      </div>
    </div>
  );
};

export default AppointmentsOversight;
