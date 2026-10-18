import React, { useEffect, useRef, useState } from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import { Button } from '../../components/ui/button';
import PageHeader from '../../components/ui/page-header';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../../components/ui/sheet';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { toastSuccess, toastInfo } from '../../lib/toast';
import RescheduleDialog from '../../components/booking/RescheduleDialog';
import TestPicker from '../../components/booking/TestPicker';
import useOperationsReport from '../../hooks/useOperationsReport';
import ActiveQueuePanel from '../../components/reception/ActiveQueuePanel';
import VisitHistoryPanel from '../../components/reception/VisitHistoryPanel';
import WalkInRegistration from '../../components/reception/WalkInRegistration';
import WhoIsHereBox from '../../components/reception/WhoIsHereBox';
import DeskCounts from '../../components/reception/DeskCounts';
import { useVisitHistory } from '../../hooks/useVisitHistory';
import { usePatientLookup } from '../../hooks/usePatientLookup';
import { useReceptionQueue } from '../../hooks/useReceptionQueue';
import { useClinicReferenceData } from '../../hooks/useClinicReferenceData';
import { useAppointmentCheckIn } from '../../hooks/useAppointmentCheckIn';
import { useTodaysBookings } from '../../hooks/useTodaysBookings';
import { useVisitDisposition } from '../../hooks/useVisitDisposition';
import { useTestAssignment } from '../../hooks/useTestAssignment';
import { useHmoLogging } from '../../hooks/useHmoLogging';
import { UserCheck, UserPlus, AlertCircle, History, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import LoadingState from '../../components/ui/loading-state';
import { formatCurrency } from '../../lib/currency';

/**
 * The front desk: the Desk to work from, and Visit History to look back. [1.75.0]
 *
 * It was four screens — Active Queue, Walk-In Registration, Appointment Check-In and Visit
 * History — and one arriving patient needed three of them: looked up on one, checked in on
 * another, watched on the third. Steven picked option F1 from the gallery: one Desk where a Who's
 * here box finds the person (a booking, a record, or nobody yet) above the queue it feeds, and
 * registration opens in a side panel so the queue stays where it was.
 *
 * Nothing underneath changed. Every hook, endpoint and confirmation dialog is the one the four
 * screens used. The two retired screen ids no longer exist, and App sends a stale one here.
 */
// The sidebar's own names, so the sidebar, the breadcrumb and the heading agree. Not "Front Desk"
// for the Desk: that is the GROUP, which a phone's top bar shows on its own, and the heading under
// it would have said the same two words again.
const PAGE_TITLES = {
  'reception-queue': 'Desk',
  'reception-history': 'Visit History',
};

const PAGE_ICONS = {
  'reception-queue': UserCheck,
  'reception-history': History,
};

// One sentence per screen, written for someone in their first week on the desk.
const PAGE_BLURBS = {
  'reception-queue': 'Check in a booking, start a visit for someone on file, or register someone new, without leaving the queue.',
  // Says what the screen does. It described itself as "Completed and cancelled visits" while
  // showing Pending and Processing ones too — findVisitsByDateRange is deliberately any-status,
  // so the copy was the half that was wrong. A receptionist looking a patient up does not know
  // what state the visit reached, which is usually why they are looking.
  'reception-history': 'Every visit in a chosen date range, whatever state it reached. Read-only.',
};
const VALID_VIEWS = Object.keys(PAGE_TITLES);

const ReceptionistDashboard = ({ activeNav = 'reception-queue', onSelectNav, intent }) => {
  const { hasPermission } = useAuth();
  // Any nav value this component doesn't recognize (e.g. a stale/default 'dashboard') falls
  // back to the Desk, mirroring DiagnosticDashboard's existing fallback pattern.
  const view = VALID_VIEWS.includes(activeNav) ? activeNav : 'reception-queue';
  const onDesk = view === 'reception-queue';

  // What this person may do at the desk, each from the permission its own endpoint demands.
  // [1.53.0] A Cashier reads this queue legitimately (`visits:read`) and holds none of the rest, so
  // it gets the queue with its own search and no Who's here box, exactly as before.
  const can = {
    checkIn: hasPermission('appointments:read') && hasPermission('appointments:update'),
    reschedule: hasPermission('appointments:reschedule'),
    // [1.129.0] A visit is opened with its tests, so the server asks for both; registering a new
    // patient with it asks for patients:create too.
    startVisit: hasPermission('visits:create') && hasPermission('tests:assign'),
    registerPatient: hasPermission('visits:create') && hasPermission('tests:assign') && hasPermission('patients:create'),
    searchRecords: hasPermission('patients:read'),
    seeBookings: hasPermission('appointments:read'),
    // [1.112.0] Typing in a walk-in's paper feedback form, from Visit History.
    recordFeedback: hasPermission('feedback:record'),
  };
  const showWho = can.checkIn || can.startVisit;

  // Registration opens beside the queue rather than replacing it.
  const [registering, setRegistering] = useState(false);

  // Desk performance, on Visit History where someone is reviewing rather than checking people
  // in. The queue counts who is waiting; nothing measured how long they wait.
  const operations = useOperationsReport({ days: 7, enabled: view === 'reception-history' });
  const queue = useReceptionQueue({ enabled: onDesk });
  const reference = useClinicReferenceData();
  const history = useVisitHistory({ enabled: view === 'reception-history' });
  const arrivals = useTodaysBookings({ enabled: onDesk && can.seeBookings });
  // Existing Patient Lookup State (Module 7: patient record lookup)
  const lookup = usePatientLookup();

  const checkIn = useAppointmentCheckIn({
    // What a successful admission means to the rest of the screen. The hook does not know the
    // queue or the box exist; it reports what happened and this decides.
    onCheckedIn: ({ type, patient, visit }) => {
      if (type === 'walkin') {
        // The name stays in the box, so the queue below goes on showing the visit just opened.
        lookup.noteCheckedIn(`${patient.first_name} ${patient.last_name} checked in! Physical Queue Ticket: ${visit.queue_number}`);
      } else {
        arrivals.reload();
      }
      queue.refresh();
    },
  });

  const disposition = useVisitDisposition({
    // Every disposition changes who is waiting, so the queue is always re-read. A no-show also
    // clears the verified booking: leaving it on screen invites checking in someone who is not
    // coming.
    onChanged: ({ type }) => {
      if (type === 'noShow') {
        checkIn.clearResult();
        arrivals.reload();
      }
      queue.refresh();
    },
  });

  const testAssignment = useTestAssignment({ onAssigned: () => queue.refresh() });

  // Manual HMO logging State
  const hmo = useHmoLogging({ onLogged: () => queue.refresh() });

  // What a Today button asked for on arrival. [1.77.0] "Check in" opens that booking's card, "Add
  // tests" opens that visit's tests with the queue narrowed to the person, each through the same flow
  // the Desk's own buttons use and on the same permission. Acted on once: App clears the intent on
  // the next navigation, and the ref stops a re-render acting on this one twice.
  const handledIntent = useRef(null);
  useEffect(() => {
    if (!intent || !onDesk || handledIntent.current === intent) return;
    handledIntent.current = intent;
    if (intent.find) {
      lookup.setQuery(intent.find);
      queue.onSearchChange(intent.find);
      if (can.searchRecords) lookup.searchFor(intent.find);
    }
    if (intent.verify && can.checkIn) checkIn.verify(null, intent.verify);
    if (intent.editTests && hasPermission('tests:assign')) testAssignment.openFor(intent.editTests);
    // The hooks' functions are new each render; the intent is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, onDesk]);

  /**
   * Calls the patient by voice. [1.54.0] The queue row's other control — a per-row reprint of the
   * physical slip — is gone: the ticket is printed once at registration, the number is on screen
   * and called aloud, and a second copy answered a question nobody was asking. Its slip markup and
   * handler went with it rather than being left behind for someone to wonder about.
   */
  const speakQueueNumber = (queueNum) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(`Queue Number ${queueNum}, please proceed to the desk`);
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    } else {
      toastInfo(`Calling Queue Number ${queueNum}`);
    }
  };

  return (
    <SidebarLayout
      title={PAGE_TITLES[view]}
      activeNav={view}
      onSelectNav={onSelectNav}
      // In the rail on a desk screen, from either front-desk screen; the header keeps a copy for
      // phones only, where the rail is behind the menu. [1.76.0]
      railActions={can.registerPatient ? (
        <Button className="w-full justify-center" onClick={() => setRegistering(true)}>
          <UserPlus className="h-4 w-4" />
          Register Walk-In
        </Button>
      ) : undefined}
    >
      <div className="space-y-5">
        <PageHeader
          icon={PAGE_ICONS[view]}
          title={PAGE_TITLES[view]}
          description={PAGE_BLURBS[view]}
          actions={
            /* Only for someone who can actually register one. [1.53.0] Gated on the permission the
               endpoint itself demands, so the button and the API agree. The one Register button on
               the screen: the queue's empty state and the box's "nobody found" line point here
               rather than carrying a second copy of it. */
            onDesk && can.registerPatient ? (
              // Phones only: from `lg` up the same button is in the rail. [1.76.0]
              <Button variant="outline" className="lg:hidden" onClick={() => setRegistering(true)}>
                <UserPlus className="h-4 w-4" />
                Register Walk-In
              </Button>
            ) : undefined
          }
        />

        {reference.error && (
          <div role="alert" className="alert alert-warning">
            <AlertCircle />
            <span>{reference.error}</span>
            <button type="button" onClick={reference.reload} className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-bold text-amber-900 underline underline-offset-2">Retry</button>
          </div>
        )}

        {onDesk && (
          <>
            {showWho && (
              <WhoIsHereBox
                lookup={lookup}
                checkIn={checkIn}
                disposition={disposition}
                arrivals={arrivals}
                queue={queue}
                can={can}
              />
            )}
            <DeskCounts queue={queue} />
            <ActiveQueuePanel
              queue={queue}
              disposition={disposition}
              hmo={hmo}
              testAssignment={testAssignment}
              onCallPatient={speakQueueNumber}
              showSearch={!showWho}
            />
          </>
        )}

        {view === 'reception-history' && (
          <VisitHistoryPanel history={history} operations={operations} canRecordFeedback={can.recordFeedback} />
        )}

        {/* Mounted only while open (Radix unmounts a closed dialog), so the form's ids exist once. */}
        {can.registerPatient && (
          <Sheet open={registering} onOpenChange={setRegistering}>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Walk-In Registration</SheetTitle>
                <SheetDescription>
                  For someone new to the clinic: their details, then what they came for. Someone
                  already on file is started from the Who's here box instead, not registered twice.
                </SheetDescription>
              </SheetHeader>
              <WalkInRegistration
                bare
                patientTypes={reference.patientTypes}
                testCatalog={reference.testCatalog}
                packages={reference.packages}
                onRegistered={() => queue.refresh()}
              />
            </SheetContent>
          </Sheet>
        )}

        {/* Attach Diagnostic Tests Modal */}
        <Dialog open={testAssignment.open} onOpenChange={(next) => { if (!next) testAssignment.close(); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Tests on This Visit</DialogTitle>
              <DialogDescription>
                What this visit is for. Tests are usually chosen at registration — change them
                here if the patient adds one, or if one was picked in error.
              </DialogDescription>
            </DialogHeader>

            {/* What the visit ALREADY carries, first. [1.55.0] This dialog used to open on an
                empty picker, so the desk could not see what was attached and could only add to it
                — and a test picked in error stayed on the visit until the cashier had to explain
                the charge to a patient standing at the counter. */}
            <div className="space-y-1.5 pt-2">
              <span className="field-label">Currently on this visit</span>
              {testAssignment.loading ? (
                <LoadingState size="sm" label="Loading this visit's tests…" />
              ) : testAssignment.existing.length === 0 ? (
                <p className="m-0 rounded-lg border border-dashed border-line px-3 py-2.5 text-fine text-slate-500">
                  Nothing attached yet — choose below.
                </p>
              ) : (
                <ul className="m-0 max-h-40 list-none space-y-1 overflow-y-auto p-0">
                  {testAssignment.existing.map((line) => {
                    const locked = testAssignment.lockReason(line);
                    return (
                      <li
                        key={line.id}
                        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-fine font-semibold text-slate-800">
                            {line.test_name}
                            {line.package_name && (
                              <span className="ml-1.5 font-normal text-azure-700">
                                · {line.package_name}
                              </span>
                            )}
                          </span>
                          {/* Why it cannot come off, said beside it rather than only on refusal. */}
                          {locked && (
                            <span className="block text-micro text-slate-500">{locked}</span>
                          )}
                        </span>
                        <span className="flex-shrink-0 text-fine font-semibold tabular-nums text-slate-600">
                          {formatCurrency(line.price_at_time)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={Boolean(locked) || testAssignment.removing === line.id}
                          loading={testAssignment.removing === line.id}
                          onClick={() => testAssignment.remove(line)}
                          aria-label={`Remove ${line.test_name} from this visit`}
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <form onSubmit={testAssignment.submit} className="space-y-4 pt-2">
              <span className="field-label">Add more</span>
              {/* Same control as the registration form, so the two cannot drift on grouping, the
                  running total, or the preparation warning. */}
              <TestPicker
                tests={reference.testCatalog}
                selectedIds={testAssignment.selectedTestIds}
                onToggle={testAssignment.toggleTest}
                packages={reference.packages}
                selectedPackageIds={testAssignment.selectedPackageIds}
                onTogglePackage={testAssignment.togglePackage}
                disabled={testAssignment.submitting}
              />

              <div className="flex justify-end space-x-2 pt-2 border-t border-line">
                <Button type="button" variant="outline" onClick={testAssignment.close}>Cancel</Button>
                <Button
                  type="submit"
                  loading={testAssignment.submitting}
                  disabled={
                    testAssignment.selectedTestIds.length === 0
                    && testAssignment.selectedPackageIds.length === 0
                  }
                  className="font-bold"
                >
                  Add to Visit
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* HMO Pre-Authorization Logging Modal (Module 7: HMO request initiation) */}
        <Dialog open={hmo.open} onOpenChange={(next) => { if (!next) hmo.close(); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Log HMO Pre-Authorization</DialogTitle>
              <DialogDescription>
                For <strong>{hmo.visitTest?.test_name}</strong>. This logs the request for Admin review — it does not approve coverage on its own, even if a code is entered below.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={hmo.submit} className="space-y-4 pt-2">
              {hmo.error && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{hmo.error}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="field-label" htmlFor="receptionistdashboard-hmo-provider">HMO Provider <span className="text-rose-600">*</span></label>
                <Select value={hmo.providerId} onValueChange={hmo.setProviderId}>
                  <SelectTrigger className="rounded-xl" id="receptionistdashboard-hmo-provider">
                    <SelectValue placeholder="Select HMO provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {reference.hmoProviders.map(hmo => (
                      <SelectItem key={hmo.id} value={hmo.id.toString()}>
                        {hmo.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Two fields, not one. This was a single box labelled "Card / LOA Number" writing
                  into approval_code — but a member number and an LOA code are different things
                  with different lifetimes. The member number is printed on the card and identifies
                  the patient to the provider forever; the LOA code is issued per claim when the
                  HMO approves it, and the Admin approval screen writes that same column. Typing a
                  member number here therefore filed it as an approval code on an unapproved claim.

                  The member number also had nowhere to live at all: it was legible only by opening
                  the card photo, and pruneHmoCards deletes those after 180 days while the claim
                  itself is kept for seven years. */}
              <div className="space-y-1.5">
                <label htmlFor="hmo-member-number" className="field-label">
                  Member number <span className="font-normal text-slate-400">(from the card)</span>
                </label>
                <Input
                  id="hmo-member-number"
                  placeholder="The patient's number with this provider"
                  value={hmo.memberNumber}
                  onChange={e => hmo.setMemberNumber(e.target.value)}
                />
                <p className="m-0 text-fine text-slate-500">
                  What the provider looks the claim up by when you telephone them.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="hmo-loa-code" className="field-label">
                  LOA code <span className="font-normal text-slate-400">(only if they already have one)</span>
                </label>
                <Input
                  id="hmo-loa-code"
                  placeholder="Leave blank — an Admin fills this in on approval"
                  value={hmo.approvalCode}
                  onChange={e => hmo.setApprovalCode(e.target.value)}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-line">
                <Button type="button" variant="outline" onClick={hmo.close}>Cancel</Button>
                <Button type="submit" className="font-bold">Log HMO Request</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Check-in confirmation — one dialog for both check-in paths (a booking from the box, and
            a record started as a walk-in), see .agents Phase 12 and UI/UX Phase 3 */}
        <ConfirmDialog
          open={!!checkIn.target}
          onOpenChange={(open) => { if (!open) checkIn.cancel(); }}
          title="Confirm Check-In"
          description={
            checkIn.target?.type === 'appointment'
              ? `Check in ${checkIn.target.data.first_name} ${checkIn.target.data.last_name} (${checkIn.target.data.appointment_reference})? This confirms their appointment and gives them today's queue ticket.`
              : checkIn.target?.type === 'walkin'
              ? `Check in ${checkIn.target.data.first_name} ${checkIn.target.data.last_name} as a walk-in? Choose what they are here for: the visit, its queue ticket and these tests are created together.`
              : ''
          }
          confirmLabel="Confirm Check-In"
          onConfirm={checkIn.confirm}
          loading={checkIn.submitting}
          error={checkIn.error}
          // A walk-in visit is for something [1.129.0]: it is never opened empty.
          wide={checkIn.target?.type === 'walkin'}
          confirmDisabled={checkIn.target?.type === 'walkin' && !checkIn.walkInChosen}
        >
          {checkIn.target?.type === 'walkin' && (
            <div className="space-y-1.5">
              <span className="field-label">
                Tests Requested <span className="text-rose-600" aria-hidden="true">*</span>
              </span>
              <TestPicker
                tests={reference.testCatalog}
                selectedIds={checkIn.walkInTestIds}
                onToggle={checkIn.toggleWalkInTest}
                packages={reference.packages}
                selectedPackageIds={checkIn.walkInPackageIds}
                onTogglePackage={checkIn.toggleWalkInPackage}
                disabled={checkIn.submitting}
                maxHeight="max-h-56"
              />
            </div>
          )}
        </ConfirmDialog>

        <ConfirmDialog
          open={!!disposition.cancel.target}
          onOpenChange={(open) => { if (!open) disposition.cancel.dismiss(); }}
          title="Cancel Visit"
          description={disposition.cancel.target && `Cancel the visit for ${disposition.cancel.target.first_name} ${disposition.cancel.target.last_name} (Queue ${disposition.cancel.target.queue_number})? This removes it from the active queue.`}
          confirmLabel="Cancel Visit"
          onConfirm={disposition.cancel.confirm}
          loading={disposition.cancel.submitting}
          error={disposition.cancel.error}
        />

        <ConfirmDialog
          open={!!disposition.noShow.target}
          onOpenChange={(open) => { if (!open) disposition.noShow.dismiss(); }}
          title="Mark as No-Show"
          description={disposition.noShow.target && `Mark ${disposition.noShow.target.first_name} ${disposition.noShow.target.last_name}'s appointment (${disposition.noShow.target.appointment_reference}) as a no-show? This does not check them in.`}
          confirmLabel="Mark No-Show"
          onConfirm={disposition.noShow.confirm}
          loading={disposition.noShow.submitting}
          error={disposition.noShow.error}
        />

        {/* Same dialog the patient sees on their own booking, so the receptionist on the phone and
            the patient on the app are working from one set of rules and one availability grid. */}
        <RescheduleDialog
          open={Boolean(disposition.reschedule.appointment)}
          onOpenChange={(open) => { if (!open) disposition.reschedule.close(); }}
          appointment={disposition.reschedule.appointment}
          onRescheduled={(moved) => {
            // Keep the booking on screen showing its new time, rather than clearing the card and
            // making the receptionist look it up again to confirm the move landed. A booking moved
            // to another day also leaves today's "still to arrive".
            checkIn.applyToResult(moved);
            arrivals.reload();
            toastSuccess('Appointment rescheduled.');
          }}
        />

      </div>
    </SidebarLayout>
  );
};

export default ReceptionistDashboard;
