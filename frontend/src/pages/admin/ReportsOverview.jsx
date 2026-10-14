/**
 * The reporting console: a tab shell over four independent panels. [1.63.0] [1.111.0]
 *
 * Each panel lives in `components/reports/` and owns its own date range and its own request: the
 * tabs answer different questions over different periods, and a shared range would mean opening
 * Trends silently re-scoping the HMO figures somebody was reading.
 *
 * ── What was taken out [1.111.0] ────────────────────────────────────────────────────────────
 *
 * Three tabs said again what another screen already says:
 *
 *   Today          the Today screen, which every Admin and SuperAdmin lands on, holds the
 *                  same figures — today's takings, the queue, the payment methods.
 *   Access Matrix  a read-only copy of "Who sees what" on Access Control, where the same grid
 *                  can be changed.
 *   Analytics      its turnaround chart repeated the Departments table against targets nobody
 *                  has set, and its revenue comparison repeated Trends. Its one figure found
 *                  nowhere else, arrivals by hour, moved to Trends.
 *
 * Four are left, one per question: what each department did (Departments), how money and volume
 * move over time (Trends), what the HMOs owe (HMO Claims), and who did how much (Staff Workload).
 */
import React from 'react';
import PageHeader from '../../components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { BarChart3 } from 'lucide-react';

import DateRangeReports from '../../components/reports/DateRangeReports';
import HmoClaimsReport from '../../components/reports/HmoClaimsReport';
import StaffWorkload from '../../components/reports/StaffWorkload';
import OperationsReport from '../../components/reports/OperationsReport';

const ReportsOverview = () => (
  <div className="space-y-5">
    <PageHeader
      icon={BarChart3}
      title="Reports"
      description="Each department's figures, trends over time, HMO claims and staff workload, for any date range."
    />

    <Tabs defaultValue="operations" className="w-full space-y-4">
      <TabsList>
        <TabsTrigger value="operations">Departments</TabsTrigger>
        <TabsTrigger value="range">Trends</TabsTrigger>
        <TabsTrigger value="hmo">HMO Claims</TabsTrigger>
        <TabsTrigger value="workload">Staff Workload</TabsTrigger>
      </TabsList>
      <TabsContent value="operations" className="m-0">
        <OperationsReport />
      </TabsContent>
      <TabsContent value="range" className="m-0">
        <DateRangeReports />
      </TabsContent>
      <TabsContent value="hmo" className="m-0">
        <HmoClaimsReport />
      </TabsContent>
      <TabsContent value="workload" className="m-0">
        <StaffWorkload />
      </TabsContent>
    </Tabs>
  </div>
);

export default ReportsOverview;
