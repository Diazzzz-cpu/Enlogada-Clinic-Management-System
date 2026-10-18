import React, { useState } from 'react';
import { AlertCircle, ArrowRight, CalendarClock } from 'lucide-react';
import { Button } from '../ui/button';
import EmptyState from '../ui/empty-state';
import DataBadge from '../ui/data-badge';
import { StatusBadge } from '../ui/status-badge';
import { SkeletonList } from '../ui/skeleton';
import { formatDate } from '../../lib/date';
import { testProgress } from '../../lib/testProgress';
import LinkAccountDialog from './LinkAccountDialog';

const VISITS_SHOWN = 8;

// [1.130.0] A test's own state, beside its name: finished, still being worked on, or neither.
const TONE = {
  done: 'font-semibold text-emerald-700',
  working: 'font-semibold text-amber-700',
  quiet: 'text-slate-500',
};

/**
 * A patient's file, for the front desk and the till. [1.116.0]
 *
 * Opened from the patient's name on Patient Records by whoever cannot read results. It holds what
 * a returning patient's record is for: what else is on file, when they came and what for, and the
 * way to start their next visit without typing them in again. Never a result, and never the
 * details the row above it already shows (sex, birthdate, contact, type): a fact said once.
 *
 * [1.130.0] A record holds what is FINAL, as Steven asked of Patient Records: finished visits, each
 * test with how it ended (released, X-ray done, cancelled). A visit still open is not on the
 * record; one line says it exists and that the Desk shows where it stands (today's queue, or its
 * "From earlier days" table), which is where work in progress belongs.
 *
 * "Start a visit" goes to the Desk with the patient already found, rather than creating the visit
 * here, because the Desk is where a visit is started safely: it will not offer a second visit to
 * someone already in today's queue. Someone already in it gets "Find at the Desk" instead.
 */
export default function PatientFile({ id, entry, patientName, archived, canStartVisit, onStartVisit, canLinkAccount, onRetry }) {
  const [linking, setLinking] = useState(false);
  if (!entry || entry.status === 'loading') {
    return <div id={id} className="p-4"><SkeletonList rows={3} /></div>;
  }
  if (entry.status === 'error') {
    return (
      <div id={id}>
        <EmptyState
          compact
          tone="error"
          icon={AlertCircle}
          title="Couldn't load this patient's file"
          description={entry.error}
          action={<Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
        />
      </div>
    );
  }

  const { patient, visits } = entry;
  const inQueue = visits.find((v) => v.in_todays_queue);
  const onRecord = visits.filter((v) => v.status === 'Completed' || v.status === 'Cancelled');
  const stillOpen = visits.filter((v) => v.status === 'Pending' || v.status === 'Processing');
  const shown = onRecord.slice(0, VISITS_SHOWN);
  const onFile = [
    ['Address', patient.address],
    ['Email', patient.email],
    ['Emergency contact', patient.emergency_contact],
    ['Portal account', patient.user_id ? 'Yes, they book and read results online' : 'No, a walk-in record'],
  ];

  return (
    <div id={id} data-testid="patient-file" className="grid gap-5 px-4 py-4 sm:pl-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section aria-label="On file" className="space-y-3">
        <h3 className="m-0 text-meta font-semibold uppercase tracking-wider text-slate-500">Also on file</h3>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-fine">
          {onFile.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-slate-500">{label}</dt>
              <dd className="m-0 break-words font-medium text-slate-800">
                {value || <span className="font-normal text-slate-400">Not on file</span>}
              </dd>
            </React.Fragment>
          ))}
        </dl>

        {/* A walk-in who has since signed up: put this record in their portal. [1.123.0] */}
        {canLinkAccount && !patient.user_id && !archived && (
          <Button size="sm" variant="outline" onClick={() => setLinking(true)} data-testid="patient-file-link">
            Link to a portal account
          </Button>
        )}
        <LinkAccountDialog
          open={linking}
          onOpenChange={setLinking}
          patientId={patient.id}
          patientName={patientName}
          onLinked={onRetry}
        />

        {canStartVisit && !archived && (
          <div className="space-y-1.5 pt-1">
            <Button size="sm" onClick={onStartVisit} data-testid="patient-file-desk">
              {inQueue ? 'Find at the Desk' : 'Start a visit'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <p className="m-0 text-meta text-slate-500">
              {inQueue
                ? `${patientName} is already in today's queue${inQueue.queue_number ? `, ticket ${inQueue.queue_number}` : ''}.`
                : `Opens the Desk with ${patientName} found, so nothing is typed again.`}
            </p>
          </div>
        )}
      </section>

      <section aria-label="Visits" className="min-w-0 space-y-2">
        <h3 className="m-0 text-meta font-semibold uppercase tracking-wider text-slate-500">Visits</h3>
        {stillOpen.length > 0 && (
          <p data-testid="patient-file-open" className="m-0 text-fine text-slate-600">
            {stillOpen.length === 1
              ? `A visit from ${formatDate(stillOpen[0].created_at)} is still open`
              : `${stillOpen.length} visits are still open (${stillOpen.map((v) => formatDate(v.created_at)).join(', ')})`}
            , and goes on the record once it is finished. The Desk shows where {stillOpen.length === 1 ? 'it stands' : 'they stand'}.
          </p>
        )}
        {visits.length === 0 ? (
          <p className="m-0 flex items-center gap-1.5 text-fine text-slate-500">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            No visits yet. The record was registered and has not been used.
          </p>
        ) : onRecord.length === 0 ? (
          <p className="m-0 text-fine text-slate-500">Nothing finished on the record yet.</p>
        ) : (
          <>
            <ul data-testid="patient-file-visits" className="m-0 list-none divide-y divide-line rounded-lg border border-line bg-surface p-0">
              {shown.map((v) => (
                <li key={v.id} data-testid="patient-file-visit" className="space-y-1.5 px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-fine font-semibold text-slate-900">
                      {formatDate(v.created_at)}
                      {v.queue_number && <DataBadge variant="queue" label="Queue ticket">{v.queue_number}</DataBadge>}
                      <span className="font-normal text-slate-500">{v.visit_type}</span>
                    </p>
                    <StatusBadge status={v.status} className="px-2 py-0.5" />
                  </div>
                  {v.tests?.length ? (
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {v.tests.map((t) => {
                        const progress = testProgress(t, { paid: v.is_paid, since: v.created_at });
                        return (
                          <li
                            key={t.id}
                            data-testid="patient-file-test"
                            data-state={progress.state}
                            className="flex flex-wrap items-baseline justify-between gap-x-3 text-fine"
                          >
                            <span className="min-w-0 text-slate-700">{t.name}</span>
                            <span className={TONE[progress.tone]}>
                              {progress.label}
                              {progress.detail && <span className="font-normal text-slate-500"> · {progress.detail}</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="m-0 text-fine text-slate-600">No tests added</p>
                  )}
                </li>
              ))}
            </ul>
            {onRecord.length > VISITS_SHOWN && (
              <p className="m-0 text-meta text-slate-500">
                And {onRecord.length - VISITS_SHOWN} earlier visit{onRecord.length - VISITS_SHOWN === 1 ? '' : 's'}.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
