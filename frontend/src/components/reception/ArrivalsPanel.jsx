import React, { useEffect, useState } from 'react';
import { AlertCircle, CalendarCheck } from 'lucide-react';
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
export default function ArrivalsPanel({ arrivals, canCheckIn, onCheckIn }) {
  const [page, setPage] = useState(1);
  const total = arrivals.bookings.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const shown = arrivals.bookings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const columns = canCheckIn ? 6 : 5;

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
                {canCheckIn && <TableHead className="text-right">Actions</TableHead>}
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
                    {canCheckIn && (
                      <TableCell className="text-right">
                        <Button size="xs" variant="outline" onClick={() => onCheckIn(b)} aria-label={`Check in ${name}`}>
                          Check in
                        </Button>
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
      </Panel>
    </div>
  );
}
