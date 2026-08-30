import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import MetricCard from '../../components/ui/metric-card';
import PageHeader from '../../components/ui/page-header';
import { Panel, PanelHeader, PanelBody } from '../../components/ui/panel';
import EmptyState from '../../components/ui/empty-state';
import { StatusBadge } from '../../components/ui/status-badge';
import { SkeletonList } from '../../components/ui/skeleton';
import RevenueTrendChart from '../../components/charts/RevenueTrendChart';
import {
  DollarSign, FileText, UserCheck, Users, CreditCard, BarChart3, ClipboardList,
  ArrowRight, LayoutDashboard, TrendingUp, History, WifiOff, CalendarClock
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../config/api';
import { todayStr, daysAgoStr } from '../../lib/date';
import { formatCurrency } from '../../lib/currency';
import StaffAccounts from './StaffAccounts';
import ServiceRequests from './ServiceRequests';
import CashierMonitoring from './CashierMonitoring';
import AppointmentsOversight from './AppointmentsOversight';
import PatientRecordsOversight from './PatientRecordsOversight';
import ReportsOverview from './ReportsOverview';
import SuperAdminManagement from './SuperAdminManagement';
import ActivityLog from './ActivityLog';
import ClinicSchedule from './ClinicSchedule';

const NAV_TITLES = {
  dashboard: 'Management Console',
  staff: 'Staff Accounts',
  'service-requests': 'Service Requests',
  'cashier-monitoring': 'Cashier Monitoring',
  'appointments-list': 'Appointments Oversight',
  'patient-records': 'Patient Records Oversight',
  reports: 'Clinic Reports',
  activity: 'Activity Log',
  superadmin: 'Super Admin Management',
};


// Visual Design Improvement Plan Phase V2: the overview previously ended at the stat row,
// leaving the rest of the page blank (see the plan's Section 08, finding 01). Revenue Trend and
// Recent Activity below reuse GET /reports/summary and GET /visits/history — both already built
// for ReportsOverview.jsx / Receptionist's Visit History — rather than adding new backend surface.
const QUICK_ACTIONS = [
  { id: 'staff', label: 'Staff Accounts', icon: Users },
  { id: 'cashier-monitoring', label: 'Cashier Monitoring', icon: CreditCard },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'service-requests', label: 'Service Requests', icon: ClipboardList },
];

// The 'dashboard' overview's own summary cards — kept lightweight and separate from
// ReportsOverview.jsx (the dedicated 'reports' section), which goes further (yesterday
// comparison, payment method breakdown). Both independently fetch real data; neither
// hardcodes numbers, unlike this component's previous version (see TRACEABILITY.md).
const DashboardOverview = ({ onSelectNav }) => {
  const { user } = useAuth();
  const [catalogCount, setCatalogCount] = useState(0);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [staffCount, setStaffCount] = useState(0);
  const [hmoPartnerCount, setHmoPartnerCount] = useState(0);
  const [revenueTrend, setRevenueTrend] = useState([]);
  const [recentVisits, setRecentVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [secondaryError, setSecondaryError] = useState(false);
  const [primaryError, setPrimaryError] = useState(false);

  const fetchOverview = useCallback(async () => {
    try {
      const today = todayStr();
      // Staff accounts rather than the RBAC matrix. Two reasons, and the second is the one that
      // matters: reading the matrix is now SuperAdmin's alone, so an Admin loading this dashboard
      // would have taken a 403 — and because these four run in one Promise.all, that single
      // refusal would have blanked the revenue, the catalogue and the HMO count with it.
      //
      // It is also just a better card. "Operational Roles: 8" is a constant the clinic cannot
      // change and never needs to look at; how many staff accounts exist is a number an Admin
      // actually acts on, and it comes from staff:manage, which is theirs.
      const [testsRes, txRes, staffRes, hmoRes] = await Promise.all([
        api.get('/tests'),
        api.get('/payments/transactions', { params: { startDate: today, endDate: today } }),
        api.get('/admin/staff'),
        api.get('/hmo/providers'),
      ]);
      setCatalogCount((testsRes.data.data.tests || []).length);
      // From the endpoint's own summary, not a reduce over the rows: the list includes reversed
      // receipts, so summing it would report refunded money as revenue.
      setTodayRevenue(Number(txRes.data.data.summary?.collected || 0));
      setStaffCount((staffRes.data.data.staff || []).length);
      setHmoPartnerCount((hmoRes.data.data.providers || []).filter(p => p.is_active).length);
      setPrimaryError(false);
    } catch (err) {
      console.error('Failed to fetch dashboard overview:', err);
      // Without this the four metric cards keep their initial zeros and render them as fact:
      // "Today's Revenue ₱0.00", "0 Staff Accounts", "0 Services". An administrator cannot tell a quiet
      // morning from an unreachable backend, and ₱0.00 is the more alarming of the two readings
      // to get wrong. The cards show an em dash instead while this is set — the same treatment
      // `secondaryError` already gives the charts below.
      setPrimaryError(true);
    } finally {
      setLoading(false);
    }

    try {
      const weekAgo = daysAgoStr(6);
      const today = todayStr();
      const [summaryRes, visitsRes] = await Promise.all([
        api.get('/reports/summary', { params: { startDate: weekAgo, endDate: today } }),
        api.get('/visits/history', { params: { startDate: weekAgo, endDate: today } }),
      ]);
      setRevenueTrend(summaryRes.data.data.report?.revenueTrend || []);
      setRecentVisits((visitsRes.data.data.visits || []).slice(0, 6));
    } catch (err) {
      console.error('Failed to fetch dashboard activity/trend:', err);
      setSecondaryError(true);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  return (
    <div className="space-y-5">
      {/* Quick actions live inside the hero rather than in a row of four cards below it. They are
          shortcuts to sidebar destinations — chrome, not content — and giving them the same card
          treatment as the KPI figures put a navigation aid and a revenue total on equal footing. */}
      <PageHeader
        variant="hero"
        eyebrow="Clinic Administration"
        icon={LayoutDashboard}
        title={`Good day, ${user?.firstName || 'Admin'}`}
        description="Oversight across staff, billing, appointments and patient records. Departmental tools are grouped under Clinical Operations in the sidebar."
      >
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                onClick={() => onSelectNav && onSelectNav(action.id)}
                className="group inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2 text-fine font-semibold text-rail-ink transition-colors hover:bg-white/[0.13] hover:text-white"
              >
                <Icon className="h-3.5 w-3.5 text-brand-300" />
                {action.label}
                <ArrowRight className="h-3 w-3 text-rail-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-rail-ink-soft" />
              </button>
            );
          })}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Services Catalog"
          value={loading ? '…' : primaryError ? '—' : catalogCount}
          caption="Lab, X-Ray, Ultrasound & more"
          captionTone="slate"
          icon={FileText}
          tone="green"
        />
        <MetricCard
          label="Today's Revenue"
          value={loading ? '…' : primaryError ? '—' : formatCurrency(todayRevenue)}
          caption={primaryError ? 'Could not load — check connection' : 'See Reports for trend'}
          captionTone={primaryError ? 'rose' : 'slate'}
          icon={DollarSign}
          tone="emerald"
        />
        <MetricCard
          label="Staff Accounts"
          value={loading ? '…' : primaryError ? '—' : staffCount}
          caption="Active operational staff"
          captionTone="slate"
          icon={Users}
          tone="indigo"
        />
        <MetricCard
          label="HMO Partners"
          value={loading ? '…' : primaryError ? '—' : hmoPartnerCount}
          caption="Accredited providers"
          captionTone="slate"
          icon={UserCheck}
          tone="purple"
        />
      </div>

      {secondaryError && (
        <Panel tone="alert" className="px-4 py-3">
          <div role="alert" className="flex items-center gap-2.5 text-fine font-semibold text-rose-800">
            <WifiOff className="h-4 w-4 flex-shrink-0" />
            <span>Couldn't load the revenue trend or recent activity below.</span>
            <button
              onClick={fetchOverview}
              className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-bold text-rose-700 underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </Panel>
      )}

      {/* 3:2 rather than 1:1. The chart needs the horizontal room — seven daily columns squeezed
          into half a page is where a trend stops being readable — and the activity list is a
          stack of short rows that gains nothing from the extra width. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <PanelHeader title="Revenue Trend" description="Last 7 days" icon={TrendingUp} />
          <PanelBody>
            {loading ? (
              <div className="h-48 animate-pulse rounded-lg bg-skeleton" />
            ) : revenueTrend.length === 0 ? (
              <EmptyState
                compact
                icon={TrendingUp}
                title="No paid transactions yet this week"
                description="The trend fills in as the cashier settles bills."
              />
            ) : (
              <RevenueTrendChart data={revenueTrend} />
            )}
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Recent Activity"
            description="Latest visits across the clinic"
            icon={History}
            actions={
              <button
                onClick={() => onSelectNav && onSelectNav('patient-records')}
                className="cursor-pointer border-0 bg-transparent p-0 text-fine font-semibold text-brand-600 hover:text-brand-700"
              >
                View all
              </button>
            }
          />
          <PanelBody flush>
            {loading ? (
              <div className="p-4">
                <SkeletonList rows={4} />
              </div>
            ) : recentVisits.length === 0 ? (
              <EmptyState
                compact
                icon={CalendarClock}
                title="No visits in the last 7 days"
                description="Walk-ins and checked-in appointments appear here as reception registers them."
              />
            ) : (
              <ul className="m-0 list-none divide-y divide-[#eef2f6] p-0">
                {recentVisits.map(v => (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="m-0 truncate text-note font-semibold text-slate-900">{v.first_name} {v.last_name}</p>
                      <p className="m-0 text-fine text-slate-500">
                        {v.visit_type} &middot; {new Date(v.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
                      </p>
                    </div>
                    <StatusBadge status={v.visit_status} className="flex-shrink-0" />
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
};

const AdminDashboard = ({ activeNav = 'dashboard', onSelectNav }) => {
  const { user } = useAuth();

  const renderContent = () => {
    switch (activeNav) {
      case 'staff':
        return <StaffAccounts />;
      case 'service-requests':
        return <ServiceRequests />;
      case 'cashier-monitoring':
        return <CashierMonitoring />;
      case 'appointments-list':
        return <AppointmentsOversight />;
      case 'patient-records':
        return <PatientRecordsOversight />;
      case 'clinic-schedule':
        return <ClinicSchedule />;
      case 'reports':
        return <ReportsOverview />;
      case 'activity':
        return <ActivityLog />;
      case 'superadmin':
        // Backend endpoints already enforce SuperAdmin-only; this just avoids rendering a
        // confusing broken tab for an Admin whose activeNav somehow ended up here (the nav
        // item itself is already hidden from Admin in SidebarLayout).
        return user?.roles?.includes('SuperAdmin') ? <SuperAdminManagement /> : <DashboardOverview onSelectNav={onSelectNav} />;
      default:
        return <DashboardOverview onSelectNav={onSelectNav} />;
    }
  };

  return (
    <SidebarLayout title={NAV_TITLES[activeNav] || 'Management Console'} activeNav={activeNav} onSelectNav={onSelectNav}>
      {renderContent()}
    </SidebarLayout>
  );
};

export default AdminDashboard;
