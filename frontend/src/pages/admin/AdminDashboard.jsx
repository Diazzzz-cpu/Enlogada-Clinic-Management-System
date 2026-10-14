import React from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import { useAuth } from '../../contexts/AuthContext';
import StaffAccounts from './StaffAccounts';
import ServiceRequests from './ServiceRequests';
import CashierMonitoring from './CashierMonitoring';
import AppointmentsOversight from './AppointmentsOversight';
import PatientRecordsOversight from './PatientRecordsOversight';
import ReportsOverview from './ReportsOverview';
import PatientFeedback from './PatientFeedback';
import SuperAdminManagement from './SuperAdminManagement';
import ActivityLog from './ActivityLog';
import ClinicSchedule from './ClinicSchedule';
import { findNavItem } from '../../config/navigation';

/**
 * The management screens.
 *
 * This console used to open on its own overview — a "Good day" hero, four cards and a revenue
 * trend. [1.77.0] That became Admin's Today (pages/Today.jsx, components/today/ClinicToday.jsx), so
 * an Admin has one home rather than two, and it answers what the clinic is doing today instead of
 * how big the catalogue is. The 'dashboard' id is gone with it.
 *
 * App routes only a destination this person holds (consoleForNav), so nothing below needs a screen
 * to fall back to.
 */
const AdminDashboard = ({ activeNav = 'staff', onSelectNav }) => {
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
        return <PatientRecordsOversight onSelectNav={onSelectNav} />;
      case 'clinic-schedule':
        return <ClinicSchedule />;
      case 'reports':
        return <ReportsOverview />;
      case 'patient-feedback':
        return <PatientFeedback />;
      case 'activity':
        return <ActivityLog />;
      case 'superadmin':
        // The API enforces SuperAdmin-only and the nav item is hidden from Admin; this only avoids
        // drawing a broken screen for an activeNav that somehow ended up here.
        return user?.roles?.includes('SuperAdmin') ? <SuperAdminManagement /> : null;
      default:
        return null;
    }
  };

  // The breadcrumb reads the sidebar's own label, so the two cannot name one screen differently.
  // [1.79.0] A list of titles kept here had drifted: "Appointments Oversight" and "Clinic Reports"
  // in the bar, "Appointments" and "Reports" in the sidebar.
  return (
    <SidebarLayout title={findNavItem(activeNav)?.label || 'Management'} activeNav={activeNav} onSelectNav={onSelectNav}>
      {renderContent()}
    </SidebarLayout>
  );
};

export default AdminDashboard;
