import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import EmptyState from '../ui/empty-state';
import { Button } from '../ui/button';
import ExportCsvButton from '../ui/export-csv-button';
import api from '../../config/api';
// `todayStr` / `daysAgoStr` were re-implemented locally at the top of this file. The local copies
// were correct (built from local getters, not toISOString), but a second correct copy is still a
// second place for the toISOString bug to come back — see the dates note in CLAUDE.md.
import { todayStr, daysAgoStr } from '../../lib/date';
import { ClipboardList, RefreshCw, Users, FlaskConical } from 'lucide-react';
import { DateField, RANGE_PRESETS } from '../ui/date-field';

const StaffWorkload = () => {
  const [startDate, setStartDate] = useState(daysAgoStr(6));
  const [endDate, setEndDate] = useState(todayStr());
  const [receptionWorkload, setReceptionWorkload] = useState([]);
  const [diagnosticWorkload, setDiagnosticWorkload] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchWorkload = useCallback(async (from, to) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/reports/staff-workload', { params: { startDate: from, endDate: to } });
      setReceptionWorkload(res.data.data.workload?.receptionWorkload || []);
      setDiagnosticWorkload(res.data.data.workload?.diagnosticWorkload || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load staff workload.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkload(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Diagnostic results are grouped by (staff, category) server-side — collapse to one row per
  // staff member here, with a per-category breakdown, so the two tables read the same way.
  const diagnosticByStaff = diagnosticWorkload.reduce((acc, row) => {
    const key = row.staff_id;
    if (!acc[key]) acc[key] = { staff_id: key, first_name: row.first_name, last_name: row.last_name, total: 0, byCategory: [] };
    acc[key].total += parseInt(row.result_count, 10);
    acc[key].byCategory.push({ category: row.category_name, count: parseInt(row.result_count, 10) });
    return acc;
  }, {});
  const diagnosticRows = Object.values(diagnosticByStaff).sort((a, b) => b.total - a.total);

  const maxReceptionCount = Math.max(1, ...receptionWorkload.map(r => parseInt(r.visit_count, 10)));
  const maxDiagnosticCount = Math.max(1, ...diagnosticRows.map(r => r.total));

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-surface p-5 rounded-xl border border-line">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-900 m-0">Per-Staff Workload</h3>
          <p className="text-xs text-gray-500 m-0">Reception check-ins and Diagnostic results released, by staff member.</p>
        </div>
        <div className="flex items-center space-x-2">
          <DateField presets={RANGE_PRESETS.start} value={startDate} onChange={(e) => setStartDate(e.target.value)} containerClassName="w-36" aria-label="Workload start date" />
          <span className="text-xs text-gray-400">to</span>
          <DateField presets={RANGE_PRESETS.end} value={endDate} onChange={(e) => setEndDate(e.target.value)} containerClassName="w-36" aria-label="Workload end date" />
          <Button variant="outline" onClick={() => fetchWorkload(startDate, endDate)} className="flex items-center space-x-1.5 text-xs font-semibold">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Apply</span>
          </Button>
          <ExportCsvButton
            path="/reports/staff-workload"
            params={{ startDate, endDate }}
            fallbackName={`staff-workload-${startDate}_to_${endDate}.csv`}
            className="text-xs font-semibold"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl p-3 flex items-center gap-2">
          {error}{' '}
          <button type="button" onClick={() => fetchWorkload(startDate, endDate)} className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-800">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-line rounded-xl bg-surface overflow-hidden">
          <CardHeader className="flex flex-row items-center gap-2.5 border-b border-line px-5 py-3.5">
            <Users className="w-4 h-4 text-brand-600" />
            <CardTitle className="text-note font-semibold text-slate-900">Reception — Check-Ins by Staff</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-skeleton" />
            ) : receptionWorkload.length === 0 ? (
              <EmptyState compact icon={ClipboardList} title="No visits in this range" description="Walk-ins and checked-in appointments both count as visits." />
            ) : (
              receptionWorkload.map(row => (
                <div key={row.staff_id} className="space-y-1">
                  <div className="flex justify-between text-fine font-semibold text-gray-700">
                    <span>{row.first_name} {row.last_name}</span>
                    <span className="font-bold text-slate-900">{row.visit_count}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-brand-500"
                      style={{ width: `${Math.max(4, (parseInt(row.visit_count, 10) / maxReceptionCount) * 100)}%` }}
                      role="img"
                      aria-label={`${row.visit_count} check-ins by ${row.first_name} ${row.last_name}`}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-line rounded-xl bg-surface overflow-hidden">
          <CardHeader className="flex flex-row items-center gap-2.5 border-b border-line px-5 py-3.5">
            <FlaskConical className="w-4 h-4 text-brand-600" />
            <CardTitle className="text-note font-semibold text-slate-900">Diagnostic — Results Released by Staff</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-skeleton" />
            ) : diagnosticRows.length === 0 ? (
              <p className="py-10 text-center text-fine text-slate-500">No results released in this range.</p>
            ) : (
              diagnosticRows.map(row => (
                <div key={row.staff_id} className="space-y-1">
                  <div className="flex justify-between text-fine font-semibold text-gray-700">
                    <span>
                      {row.first_name} {row.last_name}
                      <span className="text-gray-400 font-normal"> &middot; {row.byCategory.map(c => `${c.category} ${c.count}`).join(', ')}</span>
                    </span>
                    <span className="font-bold text-slate-900">{row.total}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-indigo-500"
                      style={{ width: `${Math.max(4, (row.total / maxDiagnosticCount) * 100)}%` }}
                      role="img"
                      aria-label={`${row.total} results released by ${row.first_name} ${row.last_name}`}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// Module 12 originally built this page's "Today's Snapshot" as an honest, minimal entry point
// and explicitly deferred historical trends, date-range filtering, and the RBAC matrix report
// to this module. That live snapshot logic is unchanged here — only added to, not replaced.
/**
 * Every department's operating figures on one page. [1.22.0]
 *
 * The roll-up the Admin asked for: the same panels each console shows its own department, side by
 * side and unrestricted. Literally the same components — a manager querying a department's
 * numbers has to be reading the version that department reads, or the conversation starts with an
 * argument about whose figures are right.
 */

export default StaffWorkload;
