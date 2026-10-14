import React, { useState, useEffect } from 'react';
import LoadingState from '../../components/ui/loading-state';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { TabsContent } from '../../components/ui/tabs';
import RescheduleDialog from '../../components/booking/RescheduleDialog';
import BookingDialog from '../../components/booking/BookingDialog';
import ResultDocument from '../../components/ResultDocument';
import { formatAppointmentDate, formatTime12 } from '../../lib/date';
import { usePatientProfiles } from '../../hooks/usePatientProfiles';
import { useMyResultHistory } from '../../hooks/useMyResultHistory';
import { useMyAppointments } from '../../hooks/useMyAppointments';
import { useMyPayments } from '../../hooks/useMyPayments';
import { useMyPendingFeedback } from '../../hooks/useMyPendingFeedback';
import FeedbackDialog from '../../components/portal/FeedbackDialog';
import { useClinicReferenceData } from '../../hooks/useClinicReferenceData';
import PortalLayout from '../../components/portal/PortalLayout';
import PortalBand from '../../components/portal/PortalBand';
import HomeTab from '../../components/portal/HomeTab';
import ResultsTab from '../../components/portal/ResultsTab';
import AppointmentsTab from '../../components/portal/AppointmentsTab';
import PaymentsTab from '../../components/portal/PaymentsTab';
import ProfileTab from '../../components/portal/ProfileTab';
import RefreshButton from '../../components/ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';

/**
 * The patient portal: Home, Appointments, Results, Payments and Profile. [1.81.0]
 *
 * Layout A2 from the gallery Steven picked, in the Flat colouring. The tab is App's (`tab` /
 * `onTabChange`), so going to My Account and back lands on the tab the patient left. It used to be
 * an uncontrolled Tabs that forgot its place on every page change.
 *
 * Every tab opens with its band, then the one Refresh, then the tab itself. Radix unmounts the tabs
 * that are not showing, so the page holds one heading, one Refresh and at most one booking dialog
 * at a time.
 */
const ClientDashboard = ({ onNavigate, tab = 'home', onTabChange }) => {
  const [previewDoc, setPreviewDoc] = useState(null);

  const reference = useClinicReferenceData();
  const profiles = usePatientProfiles();
  const results = useMyResultHistory({ patientId: profiles.selectedId });
  const bookings = useMyAppointments();
  const payments = useMyPayments();
  // [1.112.0] Finished visits to rate, and the one being rated.
  const feedback = useMyPendingFeedback();
  const [rating, setRating] = useState(null);

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
    feedback.reload?.();
  };
  const onBooked = () => {
    results.reload();
    bookings.reload();
  };

  if (profiles.loading) {
    return (
      <PortalLayout tab={tab} onTabChange={onTabChange} onNavigate={onNavigate}>
        <LoadingState size="lg" label="Loading your patient profile…" className="py-24" />
      </PortalLayout>
    );
  }

  // The patient portal has no notification bell — email is the only channel that reaches a patient
  // ([1.49.0]). So the sequence is: the clinic releases a result, the email arrives, and the
  // patient switches back to the tab they left open this morning, still showing what it fetched
  // then. This button is the whole answer to that, and the time beside it is how they know it was
  // worth pressing.
  const refresh = <RefreshButton onRefresh={refreshEverything} loading={portalLoading} updatedAt={updatedAt} />;

  const bookButton = (
    <BookingDialog
      selectedProfileId={profiles.selectedId}
      selectedProfile={profiles.selected}
      testCatalog={reference.testCatalog}
      packages={reference.packages}
      hmoProviders={reference.hmoProviders}
      onBooked={onBooked}
    />
  );

  const screen = (band, content, { withRefresh = true } = {}) => (
    <div className="space-y-5">
      {band}
      {withRefresh && <div className="flex justify-end">{refresh}</div>}
      {content}
    </div>
  );

  return (
    <PortalLayout tab={tab} onTabChange={onTabChange} profiles={profiles} onNavigate={onNavigate} screen={tab}>
      <TabsContent value="home" className="m-0">
        <HomeTab
          profiles={profiles}
          results={results}
          bookings={bookings}
          payments={payments}
          onOpenTab={onTabChange}
          refresh={refresh}
          bookButton={bookButton}
          feedback={feedback.visits}
          onRate={setRating}
        />
        <FeedbackDialog
          visit={rating}
          onOpenChange={(open) => { if (!open) setRating(null); }}
          onSent={feedback.reload}
        />
      </TabsContent>

      <TabsContent value="appointments" className="m-0">
        {screen(
          <PortalBand
            title="Appointments"
            subtitle="Your bookings, the pass you show at the front desk, and paying ahead."
            actions={bookButton}
          />,
          <AppointmentsTab bookings={bookings} />
        )}
      </TabsContent>

      <TabsContent value="results" className="m-0">
        {screen(
          <PortalBand title="Results" subtitle="Reports the clinic has released, to read and print." />,
          <ResultsTab profiles={profiles} results={results} onPreviewDocument={setPreviewDoc} />
        )}
      </TabsContent>

      <TabsContent value="payments" className="m-0">
        {screen(
          <PortalBand title="Payments" subtitle="What you have paid, with the receipt for each." />,
          <PaymentsTab payments={payments} />
        )}
      </TabsContent>

      {/* No Refresh here: it reloads results, bookings and payments, and nothing on this tab. */}
      <TabsContent value="profile" className="m-0">
        {screen(
          <PortalBand title="Profile" subtitle="The patient's details, and the family on this account." />,
          <div className="max-w-2xl">
            <ProfileTab profiles={profiles} reference={reference} />
          </div>,
          { withRefresh: false }
        )}
      </TabsContent>

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

      <ResultDocument
        open={Boolean(previewDoc)}
        onOpenChange={(o) => { if (!o) setPreviewDoc(null); }}
        visitTestId={previewDoc?.visitTestId}
        testName={previewDoc?.testName}
        patientName={previewDoc?.patientName}
        fileName={previewDoc?.fileName}
      />
    </PortalLayout>
  );
};

export default ClientDashboard;
