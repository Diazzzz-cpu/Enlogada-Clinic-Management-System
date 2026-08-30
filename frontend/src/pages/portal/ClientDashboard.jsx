import React, { useState, useEffect } from 'react';
import LoadingState from '../../components/ui/loading-state';
import DashboardLayout from '../../components/DashboardLayout';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import RescheduleDialog from '../../components/booking/RescheduleDialog';
import ResultDocument from '../../components/ResultDocument';
import { formatAppointmentDate, formatTime12 } from '../../lib/date';
import { usePatientProfiles } from '../../hooks/usePatientProfiles';
import { useMyResultHistory } from '../../hooks/useMyResultHistory';
import { useMyAppointments } from '../../hooks/useMyAppointments';
import { useMyPayments } from '../../hooks/useMyPayments';
import { useClinicReferenceData } from '../../hooks/useClinicReferenceData';
import ProfileBar from '../../components/portal/ProfileBar';
import WelcomeHero from '../../components/portal/WelcomeHero';
import ResultsTab from '../../components/portal/ResultsTab';
import AppointmentsTab from '../../components/portal/AppointmentsTab';
import PaymentsTab from '../../components/portal/PaymentsTab';
import ProfileTab from '../../components/portal/ProfileTab';
import RefreshButton from '../../components/ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';

// Mirrors the 5 seeded test_categories rows exactly (database/schema.sql) so every
// category a client can actually have a result in gets a distinct, correct icon.

// UI/UX Modernization Phase 4: My Appointments and Payment History are fetched in one shot with
// no server-side pagination, so a client-side page size over each already-fetched array is
// proportionate (VISUAL_IDENTITY.md §3a #11).


const ClientDashboard = ({ onNavigate }) => {
  const [previewDoc, setPreviewDoc] = useState(null);

  const reference = useClinicReferenceData();
  const profiles = usePatientProfiles();
  const results = useMyResultHistory({ patientId: profiles.selectedId });
  const bookings = useMyAppointments();
  const payments = useMyPayments();

  // Returning from the provider's hosted page. The URL flag is presentational only — it says
  // "the browser came back", not "the money arrived", and is deliberately not trusted to mark
  // anything paid. The authoritative update is the signed webhook, so we simply re-fetch and
  // let the server state speak. The query string is then stripped so a refresh doesn't replay
  // the banner.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('payment');
    if (!outcome) return;

    if (outcome === 'success') {
      bookings.clearPayError();
      bookings.reload();
      payments.reload();
    } else if (outcome === 'cancelled') {
      bookings.notePaymentCancelled();
    }

    window.history.replaceState({}, '', window.location.pathname);
    // Both reloads are stable useCallbacks; the rule cannot see that through the hook objects,
    // and depending on the objects themselves would re-run this on every render — replaying the
    // banner the last line just stripped the query string to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // One control for all three lists. A patient thinks "has anything changed?", not "reload my
  // payments"; and their own data is a handful of rows, so fetching all three costs nothing.
  const portalLoading = results.loading || bookings.loading || payments.loading;
  const updatedAt = useFreshness(portalLoading, results.error || bookings.error || payments.error);
  const refreshEverything = () => {
    results.reload?.();
    bookings.reload?.();
    payments.reload?.();
  };

  if (profiles.loading) {
    return (
      <DashboardLayout onNavigate={onNavigate} activeTab="dashboard">
        <LoadingState size="lg" label="Loading your patient profile…" className="flex-1" />
      </DashboardLayout>
    );
  }

  // The API returns bookings newest-scheduled-date first, which buries the one booking the
  // patient can actually act on: a far-future cancelled booking outranks tomorrow's paid visit,
  // so a QR booking pass could sit pages deep behind rows that do nothing. Order by what the
  // patient needs — still-open bookings first (soonest first, since the next visit is the one
  // that matters), then closed ones (most recent first, as history usually reads).



  return (
    <DashboardLayout onNavigate={onNavigate} activeTab="dashboard">
      <div className="flex flex-col space-y-6">
        
        {/* Top Active Profile Bar */}
        <ProfileBar profiles={profiles} reference={reference} />

        {/* Hero Welcome Banner & Stats */}
        <WelcomeHero profiles={profiles} results={results} bookings={bookings} reference={reference} />
        {/* UI/UX Phase 1: previously one long stacked page with no way to jump to a section —
            Payment History sat 3rd of 3 cards in a compressed right sidebar, requiring a client
            to scroll past everything else to reach it (the exact complaint that prompted this
            restructure). Each section now gets its own full-width tab. */}
        {/* The patient portal has no notification bell — email is the only channel that reaches
            a patient ([1.49.0]). So the sequence is: the clinic releases a result, the email
            arrives, and the patient switches back to the tab they left open this morning, which
            is still showing what it fetched this morning. This button is the whole answer to
            that, and the timestamp beside it is how they know it was worth pressing. */}
        <Tabs defaultValue="results" className="w-full space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="results">Diagnostic Results</TabsTrigger>
              <TabsTrigger value="appointments">Appointments</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="profile">Profile</TabsTrigger>
            </TabsList>
            <RefreshButton onRefresh={refreshEverything} loading={portalLoading} updatedAt={updatedAt} />
          </div>

          <TabsContent value="results" className="m-0 space-y-4">
            <ResultsTab profiles={profiles} results={results} onPreviewDocument={setPreviewDoc} />
          </TabsContent>

          {/* My Appointments (Module 3: view/cancel own appointments) — full width now, no
              more max-h scroll-box compression forced by sharing a column with two other
              cards.

              The card said "full width" and carried max-w-2xl, so on a laptop it sat in the left
              672px of a 1440px page with the whole right half empty — and each booking carries a
              QR pass, so the list is tall as well as narrow and a patient with two bookings
              scrolled past a screenful of nothing. The panel fills the page now and the bookings
              themselves lay out two-up once there is room for it, which is the shape that
              actually uses a wide screen: each pass stays its natural size and two fit side by
              side instead of stacking. */}
          <TabsContent value="appointments" className="m-0">
            <AppointmentsTab bookings={bookings} />
          </TabsContent>

          {/* Payment History (Module 14: client-side payment visibility) — the exact section
              the "scroll to find payments" complaint was about; now its own full-width tab
              instead of 3rd-of-3 in a compressed sidebar. */}
          <TabsContent value="payments" className="m-0">
            <PaymentsTab payments={payments} />
          </TabsContent>

          {/* Patient Profile Summary + HMO info — grouped under one Profile tab */}
          <TabsContent value="profile" className="m-0 space-y-4 max-w-2xl">
            <ProfileTab profiles={profiles} />
          </TabsContent>

        </Tabs>

        {/* Cancel appointment confirmation */}
        <ConfirmDialog
          open={!!bookings.cancelTarget}
          onOpenChange={(open) => { if (!open) bookings.dismissCancel(); }}
          title="Cancel Appointment"
          description={bookings.cancelTarget ? `Cancel your appointment on ${formatAppointmentDate(bookings.cancelTarget.scheduled_date)} at ${formatTime12(bookings.cancelTarget.scheduled_time)}? This cannot be undone.` : ''}
          confirmLabel="Cancel Appointment"
          cancelLabel="Keep Appointment"
          onConfirm={bookings.confirmCancel}
          loading={bookings.cancelling}
          error={bookings.cancelError}
        />

        <RescheduleDialog
          open={Boolean(bookings.rescheduling)}
          onOpenChange={(open) => { if (!open) bookings.openReschedule(null); }}
          appointment={bookings.rescheduling}
          onRescheduled={() => bookings.reload()}
        />

      </div>
      <ResultDocument
        open={Boolean(previewDoc)}
        onOpenChange={(o) => { if (!o) setPreviewDoc(null); }}
        visitTestId={previewDoc?.visitTestId}
        testName={previewDoc?.testName}
        patientName={previewDoc?.patientName}
        fileName={previewDoc?.fileName}
      />

    </DashboardLayout>
  );
};

export default ClientDashboard;
