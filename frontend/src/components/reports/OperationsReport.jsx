import { printElement } from '../../lib/printArea';
import useOperationsReport from '../../hooks/useOperationsReport';
import { BillingTotalsPanel, SalesByServicePanel, ReceptionThroughputPanel, TurnaroundPanel } from './OperationsPanels';
import Toolbar, { ToolbarField, ToolbarSpacer } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import { Button } from '../ui/button';
import ExportCsvButton from '../ui/export-csv-button';
// `todayStr` / `daysAgoStr` were re-implemented locally at the top of this file. The local copies
// were correct (built from local getters, not toISOString), but a second correct copy is still a
// second place for the toISOString bug to come back — see the dates note in CLAUDE.md.
import { Info, RefreshCw, ShieldCheck, Printer } from 'lucide-react';
import { DateField, RANGE_PRESETS } from '../ui/date-field';

const OperationsReport = () => {
  const { report, loading, error, range, setRange, refresh } = useOperationsReport({ days: 7 });

  if (error === 'forbidden') {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No departments to report on"
        description="This account holds no billing, visit or result permission, so there is nothing here to show."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Toolbar>
        <ToolbarField label="From" htmlFor="ops-from">
          <DateField
            id="ops-from"
            presets={RANGE_PRESETS.start}
            value={range.startDate}
            onChange={(e) => setRange((r) => ({ ...r, startDate: e.target.value }))}
            containerClassName="w-[9.375rem]"
          />
        </ToolbarField>
        <ToolbarField label="To" htmlFor="ops-to">
          <DateField
            id="ops-to"
            presets={RANGE_PRESETS.end}
            value={range.endDate}
            onChange={(e) => setRange((r) => ({ ...r, endDate: e.target.value }))}
            containerClassName="w-[9.375rem]"
          />
        </ToolbarField>
        <div className="flex items-end self-stretch">
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            Apply
          </Button>
        </div>
        <ToolbarSpacer />
        {/* The export contains exactly the slices the API returned, so an account that cannot see
            takings gets a file without them rather than a file of zeroes. */}
        <ExportCsvButton
          path="/reports/operations"
          params={{ startDate: range.startDate, endDate: range.endDate }}
          fallbackName={`operations-${range.startDate}_to_${range.endDate}.csv`}
        />
        <Button variant="outline" onClick={() => printElement()}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </Toolbar>

      {error && error !== 'forbidden' && (
        <div role="alert" className="alert alert-error">
          <Info />
          <span>{error}</span>
        </div>
      )}

      <div className="print-area space-y-4">
        {report?.billing && (
          <>
            <BillingTotalsPanel billing={report.billing} loading={loading} />
            <SalesByServicePanel billing={report.billing} loading={loading} />
          </>
        )}
        {report?.reception && <ReceptionThroughputPanel reception={report.reception} loading={loading} />}
        {report?.diagnostics && <TurnaroundPanel diagnostics={report.diagnostics} loading={loading} />}
      </div>
    </div>
  );
};

// Module 12 originally built this page's "Today's Snapshot" as an honest, minimal entry point
// and explicitly deferred historical trends, date-range filtering, and the RBAC matrix report
// to this module. That live snapshot logic is unchanged here — only added to, not replaced.
/**
 * One category of reports: a quiet label over its own segmented strip.
 *
 * A separate TabsList per group rather than dividers inside one, because Radix drives arrow-key
 * roving focus from the List — putting non-trigger children inside it makes the keyboard order
 * disagree with the visual one. Three small lists keep both correct.
 */

export default OperationsReport;
