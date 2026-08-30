/**
 * The reporting console: a tab shell over six independent panels. [1.63.0]
 *
 * ── Why this file is 97 lines and not 935 ───────────────────────────────────────────────────
 *
 * It held every panel inline — Today's Snapshot, Trends, Analytics, HMO Claim Value, Staff
 * Workload, the Departments report and the RBAC matrix — each with its own state, its own fetch
 * and its own date range. Seven unrelated screens in one file, well past the 300-500 line guidance
 * this repo sets for itself, and the practical cost was that changing the HMO panel meant
 * scrolling through the staff workload one to find it.
 *
 * They are now siblings in `components/reports/`, which is where `OperationsPanels` and
 * `AnalyticsPanels` already lived — so the split follows a convention the folder had rather than
 * inventing one.
 *
 * ── What did NOT change ─────────────────────────────────────────────────────────────────────
 *
 * Every panel moved verbatim. No state was lifted, no fetch was shared, no prop was introduced.
 * Each still owns its own range and its own request, which is deliberate: the tabs answer
 * different questions over different periods, and a shared range would mean opening Trends
 * silently re-scoping the HMO figures somebody was reading.
 *
 * What is left here is the shell — the tab groups, and which panel each opens.
 */
import React from 'react';
import PageHeader from '../../components/ui/page-header';
import { useAuth } from '../../contexts/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { BarChart3 } from 'lucide-react';

// The six tab panels. Each was inline here until [1.63.0]; see the note on ReportsOverview.
import TodaySnapshot from '../../components/reports/TodaySnapshot';
import DateRangeReports from '../../components/reports/DateRangeReports';
import HmoClaimsReport from '../../components/reports/HmoClaimsReport';
import RbacMatrixReport from '../../components/reports/RbacMatrixReport';
import StaffWorkload from '../../components/reports/StaffWorkload';
import OperationsReport from '../../components/reports/OperationsReport';
import AnalyticsReport from '../../components/reports/AnalyticsPanels';

const TabGroup = ({ label, children }) => (
  <div className="space-y-1.5">
    <span className="block px-0.5 text-micro font-semibold uppercase tracking-[0.12em] text-slate-400">
      {label}
    </span>
    <TabsList>{children}</TabsList>
  </div>
);

const ReportsOverview = () => {
  // SuperAdmin bypasses in hasPermission; an Admin is judged on what they actually hold, and does
  // not hold rbac:manage. Both the trigger and the panel are gated — a hidden trigger still leaves
  // the panel mountable by anything that sets the tab value.
  const { hasPermission } = useAuth();
  const canSeeRbac = hasPermission('rbac:manage');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oversight"
        icon={BarChart3}
        title="Clinic Reports"
        description="Live activity, historical trends, and every department's operating figures in one place."
      />

      <Tabs defaultValue="snapshot" className="w-full space-y-4">
        {/* Grouped by the QUESTION each report answers, not left as one undifferentiated row of
            five. "Today" and "Staff Workload" sat side by side looking like alternatives, when one
            is a live clinic view and the other is a management read over a date range.

            The groups describe what is actually here — there is no report behind a label that has
            no data. Anything the clinic does not measure (HMO claim outcomes, appointment
            no-shows) is deliberately absent rather than given an empty tab. */}
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <TabGroup label="Clinic">
            <TabsTrigger value="snapshot">Today</TabsTrigger>
            <TabsTrigger value="operations">Departments</TabsTrigger>
          </TabGroup>
          <TabGroup label="Revenue &amp; Volume">
            <TabsTrigger value="range">Trends</TabsTrigger>
            {/* [1.62.0] Sits beside Trends rather than under Clinic: both answer "how are we
                doing over time", where Departments answers "what happened today". */}
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabGroup>
          <TabGroup label="HMO">
            <TabsTrigger value="hmo">Claim Value</TabsTrigger>
          </TabGroup>
          <TabGroup label="People">
            <TabsTrigger value="workload">Staff Workload</TabsTrigger>
            {canSeeRbac && <TabsTrigger value="rbac">Access Matrix</TabsTrigger>}
          </TabGroup>
        </div>
        <TabsContent value="snapshot" className="m-0">
          <TodaySnapshot />
        </TabsContent>
        <TabsContent value="operations" className="m-0">
          <OperationsReport />
        </TabsContent>
        <TabsContent value="range" className="m-0">
          <DateRangeReports />
        </TabsContent>
        <TabsContent value="analytics" className="m-0">
          <AnalyticsReport />
        </TabsContent>
        <TabsContent value="hmo" className="m-0">
          <HmoClaimsReport />
        </TabsContent>
        <TabsContent value="workload" className="m-0">
          <StaffWorkload />
        </TabsContent>
        {canSeeRbac && (
          <TabsContent value="rbac" className="m-0">
            <RbacMatrixReport />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default ReportsOverview;
