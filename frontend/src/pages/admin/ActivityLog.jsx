import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelHeader, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import RefreshButton from '../../components/ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';
import EmptyState from '../../components/ui/empty-state';
import { SkeletonList } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { Activity as ActivityIcon, ScrollText } from 'lucide-react';
import { formatDateTime } from '../../lib/date';

// Server-side paged: the API takes this as `limit`, and the footer states the range it covers.
const PAGE_SIZE = 25;

// Feature Gap Plan Phase D: previously the only "who did what" visibility was per-row
// attribution columns (processed_by, released_by, ...) — no queryable history of edits and no
// aggregate feed. Backed by the new audit_log table + GET /admin/activity, scoped to the
// sensitive actions this session's other phases added logging for (payments, staff accounts,
// HMO providers, result corrections) rather than every write in the app.
const ACTION_TONES = {
  'payment.refunded': 'text-rose-700 bg-rose-50 ring-rose-200',
  'payment.cancelled': 'text-rose-700 bg-rose-50 ring-rose-200',
  'staff.password_reset': 'text-indigo-700 bg-indigo-50 ring-indigo-200',
  'staff.activated': 'text-emerald-700 bg-emerald-50 ring-emerald-200',
  'staff.deactivated': 'text-slate-600 bg-slate-100 ring-slate-200',
  'hmo_provider.created': 'text-emerald-700 bg-emerald-50 ring-emerald-200',
  'hmo_provider.updated': 'text-amber-700 bg-amber-50 ring-amber-200',
  'result.corrected': 'text-amber-700 bg-amber-50 ring-amber-200',
  // UI/UX Modernization Phase 12: HMO approval moved from self-service (Receptionist) to
  // Admin/SuperAdmin-only, now audit-logged for the first time.
  'hmo_request.approved': 'text-emerald-700 bg-emerald-50 ring-emerald-200',
  'hmo_request_test.approved': 'text-emerald-700 bg-emerald-50 ring-emerald-200',
  'hmo_request_test.rejected': 'text-rose-700 bg-rose-50 ring-rose-200',
};
const DEFAULT_TONE = 'text-slate-600 bg-slate-100 ring-slate-200';

const ActivityLog = () => {
  const [entries, setEntries] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchActivity = useCallback(async (pageNum) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/activity', { params: { page: pageNum, limit: PAGE_SIZE } });
      setEntries(res.data.data.entries || []);
      setTotalPages(res.data.data.totalPages || 1);
      setTotal(res.data.data.total || 0);
    } catch (err) {
      console.error('Failed to fetch activity log:', err);
      setError('Could not load the activity log. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivity(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // An audit trail is consulted precisely when something has just happened, so "is this the
  // current list?" is the first question its reader has.
  const updatedAt = useFreshness(loading, error);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oversight"
        icon={ScrollText}
        title="Activity Log"
        description="Who did what — payment refunds and cancellations, staff account changes, HMO provider changes, and result corrections."
        meta={<span><strong className="font-semibold text-slate-700">{total}</strong> recorded action{total === 1 ? '' : 's'}</span>}
        actions={
          <RefreshButton onRefresh={() => fetchActivity(page)} loading={loading} updatedAt={updatedAt} />
        }
      />

      <Panel>
        <PanelHeader title="Recorded Actions" description="Newest first" icon={ActivityIcon} />
        <PanelBody flush>
          {error ? (
            <EmptyState
              tone="error"
              title="Could not load the activity log"
              description={error}
              action={
                <Button variant="outline" size="sm" onClick={() => fetchActivity(page)}>
                  Try again
                </Button>
              }
            />
          ) : loading ? (
            <div className="p-4">
              <SkeletonList rows={6} />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title="No recorded activity yet"
              description="Sensitive actions are logged here as staff perform them — refunds, account changes and result corrections."
            />
          ) : (
            <ul className="m-0 list-none divide-y divide-[#eef2f6] p-0">
              {entries.map(entry => (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="m-0 text-note font-medium text-slate-800">{entry.description}</p>
                    <p className="m-0 mt-0.5 text-fine text-slate-500">
                      {entry.actor_name} &middot; {formatDateTime(entry.created_at)}
                    </p>
                  </div>
                  <span
                    className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-micro font-semibold uppercase leading-5 tracking-[0.06em] ring-1 ring-inset ${ACTION_TONES[entry.action] || DEFAULT_TONE}`}
                  >
                    {entry.action.replace(/[._]/g, ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
      </Panel>
    </div>
  );
};

export default ActivityLog;
