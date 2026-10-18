import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import DataBadge from '../ui/data-badge';
import WaitBadge from '../ui/wait-badge';
import { Panel, PanelBody } from '../ui/panel';
import Toolbar from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import Pagination from '../ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { formatDate, formatTime12 } from '../../lib/date';
import { testProgress } from '../../lib/testProgress';

const PAGE_SIZE = 8;

const TONE = {
  done: 'font-semibold text-emerald-700',
  working: 'font-semibold text-amber-700',
  quiet: 'text-slate-500',
};

/**
 * Visits from an earlier day still with a department. [1.130.0]
 *
 * Today's queue is today's, so these fell off the Desk the night they were paid, while their tests
 * were still on the department worklists. Here the desk sees who they are and where each test
 * stands, to answer the patient who comes back or calls. Nothing to do from here: the work is the
 * department's. Shown only when there is something to show, or when it could not be checked.
 */
export default function CarriedOverPanel({ carried, canReschedule = false, onReschedule }) {
  const [page, setPage] = useState(1);
  const total = carried.visits.length;
  const missed = carried.missedBookings || [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  if (carried.loading || (!carried.error && total === 0 && missed.length === 0)) return null;
  const shown = carried.visits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
    {missed.length > 0 && (
      <div data-testid="missed-bookings">
        <Toolbar attached>
          <h2 className="m-0 text-note font-semibold text-slate-900">Paid bookings nobody came for</h2>
          <span className="text-fine text-slate-500">A paid booking is moved, never written off: contact the patient for a new date.</span>
        </Toolbar>
        <Panel className="overflow-hidden rounded-t-none">
          <PanelBody flush>
            <Table stack>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Booked For</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Booked Tests</TableHead>
                  {canReschedule && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {missed.map((b) => (
                  <TableRow key={b.id} data-testid="missed-booking-row">
                    <TableCell label="Booked For" className="whitespace-nowrap font-semibold text-slate-900">
                      {formatDate(b.scheduled_date)}
                      <span className="block font-normal text-fine text-slate-500">{formatTime12(b.scheduled_time)}</span>
                    </TableCell>
                    <TableCell label="Patient Name" className="font-semibold text-slate-900">
                      {b.first_name} {b.last_name}
                      <span className="block font-mono text-meta font-normal text-slate-400">{b.appointment_reference}</span>
                    </TableCell>
                    <TableCell label="Booked Tests" className="text-fine text-slate-600">
                      {(b.booked_test_names || []).join(', ') || '—'}
                    </TableCell>
                    {canReschedule && (
                      <TableCell className="text-right">
                        <Button size="xs" variant="outline" onClick={() => onReschedule(b)} aria-label={`Reschedule ${b.first_name} ${b.last_name}`}>
                          Reschedule
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PanelBody>
        </Panel>
      </div>
    )}
    {(total > 0 || carried.error) && (
    <div data-testid="carried-over">
      <Toolbar attached>
        <h2 className="m-0 text-note font-semibold text-slate-900">From earlier days, still with a department</h2>
      </Toolbar>
      <Panel className="overflow-hidden rounded-t-none">
        <PanelBody flush>
          <Table stack>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Visit</TableHead>
                <TableHead>Patient Name</TableHead>
                <TableHead>Patient Category</TableHead>
                <TableHead>Tests</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {carried.error ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="p-0">
                    <EmptyState
                      compact
                      tone="error"
                      icon={AlertCircle}
                      title="Couldn't load unfinished visits from earlier days"
                      description={carried.error}
                      action={<Button variant="outline" size="sm" onClick={carried.reload}>Try again</Button>}
                    />
                  </TableCell>
                </TableRow>
              ) : shown.map((v) => (
                <TableRow key={v.id} data-testid="carried-over-row">
                  <TableCell label="Visit" className="whitespace-nowrap">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                      {formatDate(v.created_at)}
                      {v.queue_number && <DataBadge variant="queue" label="Queue ticket">{v.queue_number}</DataBadge>}
                    </span>
                    <span className="mt-1 block"><WaitBadge since={v.created_at} /></span>
                  </TableCell>
                  <TableCell label="Patient Name" className="font-semibold text-slate-900">
                    {v.first_name} {v.last_name}
                    <DataBadge variant="patient" label="Patient record" className="block">PT-{v.patient_id}</DataBadge>
                  </TableCell>
                  <TableCell label="Patient Category" className="text-slate-500">{v.patient_type_name || '—'}</TableCell>
                  <TableCell label="Tests">
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {v.tests.map((t) => {
                        const progress = testProgress(t, { paid: true });
                        return (
                          <li key={t.id} data-state={progress.state} className="flex flex-wrap items-baseline justify-between gap-x-3 text-fine">
                            <span className="text-slate-700">{t.name}</span>
                            <span className={TONE[progress.tone]}>{progress.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PanelBody>
        {!carried.error && (
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
        )}
      </Panel>
    </div>
    )}
    </div>
  );
}
