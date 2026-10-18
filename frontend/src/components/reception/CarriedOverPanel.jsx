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
import { formatDate } from '../../lib/date';
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
export default function CarriedOverPanel({ carried }) {
  const [page, setPage] = useState(1);
  const total = carried.visits.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  if (carried.loading || (!carried.error && total === 0)) return null;
  const shown = carried.visits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
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
  );
}
