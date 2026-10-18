import React, { useEffect, useState } from 'react';
import { AlertCircle, CalendarCheck, CalendarClock } from 'lucide-react';
import { Button } from '../ui/button';
import { StatusBadge } from '../ui/status-badge';
import { Panel, PanelBody } from '../ui/panel';
import Toolbar from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import { SkeletonRows } from '../ui/skeleton';
import Pagination from '../ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { formatTime12 } from '../../lib/date';

const PAGE_SIZE = 8;

/**
 * Today's bookings that have not arrived yet, as a table like today's queue. [1.130.0]
 *
 * They were a row of name buttons under the Who's here box ([1.75.0]), which stopped at eight with
 * "and N more" and turned into a wall of chips on a busy day. A table says more about each booking
 * (what it is for, whether it is paid) and pages like every other list here. Bounded by one day's
 * bookings, so it pages in the browser. `arrivals` is useTodaysBookings, shared with the box,
 * which still finds a booking by name or reference.
 */
export default function ArrivalsPanel({ arrivals, canCheckIn, onCheckIn, canReschedule, onReschedule }) {
  const [page, setPage] = useState(1);
  const total = arrivals.bookings.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const shown = arrivals.bookings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasActions = canCheckIn || canReschedule;
  const columns = hasActions ? 6 : 5;
  const lapsed = arrivals.lapsed || [];

  return (
    <div data-testid="arrivals">
      <Toolbar attached>
        <h2 className="m-0 text-note font-semibold text-slate-900">Still to arrive today</h2>
      </Toolbar>
      <Panel className="overflow-hidden rounded-t-none">
        <PanelBody flush>
          <Table stack>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Patient Name</TableHead>
                <TableHead>Patient Category</TableHead>
                <TableHead>Booked Tests</TableHead>
                <TableHead>Payment</TableHead>
                {hasActions && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {arrivals.error ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns} className="p-0">
                    <EmptyState
                      compact
                      tone="error"
                      icon={AlertCircle}
                      title="Couldn't load today's bookings"
                      description={arrivals.error}
                      action={<Button variant="outline" size="sm" onClick={arrivals.reload}>Try again</Button>}
                    />
                  </TableCell>
                </TableRow>
              ) : arrivals.loading ? (
                <SkeletonRows rows={3} columns={columns} />
              ) : total === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns} className="p-0">
                    <EmptyState
                      compact
                      icon={CalendarCheck}
                      title="No bookings left to arrive today"
                      description="Everyone booked for today has been checked in, or nobody was booked."
                    />
                  </TableCell>
                </TableRow>
              ) : shown.map((b) => {
                const name = `${b.first_name} ${b.last_name}`;
                return (
                  <TableRow key={b.id} data-testid="arrival-row">
                    <TableCell label="Time" className="whitespace-nowrap font-semibold text-slate-900">
                      {formatTime12(b.scheduled_time)}
                    </TableCell>
                    <TableCell label="Patient Name" className="font-semibold text-slate-900">
                      {name}
                      <span className="block font-mono text-meta font-normal text-slate-400">{b.appointment_reference}</span>
                      {/* Moved, and why. [1.105.0] Shown here too, so the desk sees it before the patient says so. */}
                      {b.rescheduled_at && (
                        <span className="mt-0.5 flex items-center gap-1 text-fine font-normal text-slate-500">
                          <CalendarClock className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                          Moved · {b.reschedule_reason || 'no reason recorded'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell label="Patient Category" className="text-slate-500">
                      {b.patient_type_name || '—'}
                    </TableCell>
                    <TableCell label="Booked Tests" className="text-fine text-slate-600">
                      {(b.booked_test_names || []).length ? b.booked_test_names.join(', ') : '—'}
                    </TableCell>
                    <TableCell label="Payment">
                      {/* As on the booking's check-in card: paid from home, or to pay at the counter. */}
                      <StatusBadge status={b.is_paid ? 'Paid' : 'Pending'} />
                    </TableCell>
                    {hasActions && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canReschedule && (
                            <Button size="xs" variant="outline" onClick={() => onReschedule(b)} aria-label={`Reschedule ${name}`}>
                              Reschedule
                            </Button>
                          )}
                          {canCheckIn && (
                            <Button size="xs" onClick={() => onCheckIn(b)} aria-label={`Check in ${name}`}>
                              Check in
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </PanelBody>
        {!arrivals.error && total > 0 && (
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
        )}
        {/* [1.130.0] Not paid within their time to pay, so their slots were released and they are
            not listed above. Named, so a patient who comes anyway is not a surprise. */}
        {!arrivals.error && lapsed.length > 0 && (
          <p data-testid="arrivals-lapsed" className="m-0 border-t border-line px-4 py-2.5 text-fine text-slate-500">
            Not listed: {lapsed.map((b) => `${b.first_name} ${b.last_name} (${formatTime12(b.scheduled_time)})`).join(', ')}.{' '}
            {lapsed.length === 1 ? 'The booking was' : 'These bookings were'} not paid in time, so the slot was released.
            If they come, start a walk-in visit.
          </p>
        )}
      </Panel>
    </div>
  );
}
