import React from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import { Button } from '../../components/ui/button';
import PageHeader from '../../components/ui/page-header';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { toastSuccess, toastInfo } from '../../lib/toast';
import RescheduleDialog from '../../components/booking/RescheduleDialog';
import TestPicker from '../../components/booking/TestPicker';
import useOperationsReport from '../../hooks/useOperationsReport';
import ActiveQueuePanel from '../../components/reception/ActiveQueuePanel';
import VisitHistoryPanel from '../../components/reception/VisitHistoryPanel';
import WalkInPanel from '../../components/reception/WalkInPanel';
import CheckInPanel from '../../components/reception/CheckInPanel';
import { useVisitHistory } from '../../hooks/useVisitHistory';
import { usePatientLookup } from '../../hooks/usePatientLookup';
import { useReceptionQueue } from '../../hooks/useReceptionQueue';
import { useClinicReferenceData } from '../../hooks/useClinicReferenceData';
import { useAppointmentCheckIn } from '../../hooks/useAppointmentCheckIn';
import { useVisitDisposition } from '../../hooks/useVisitDisposition';
import { useTestAssignment } from '../../hooks/useTestAssignment';
import { useHmoLogging } from '../../hooks/useHmoLogging';
import { UserCheck, UserPlus, QrCode, AlertCircle, History, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import LoadingState from '../../components/ui/loading-state';
import { formatCurrency } from '../../lib/currency';

const PAGE_TITLES = {
  'reception-queue': 'Active Patient Queue',
  'reception-walkin': 'Walk-In Registration',
  'reception-checkin': 'Appointment Check-In',
  'reception-history': 'Visit History',
};

// One sentence per screen, written for someone in their first week on the desk. The four views
// previously opened straight onto a KPI strip or a bare form with nothing saying what the screen
// was for or how it related to the other three.
const PAGE_ICONS = {
  'reception-queue': UserCheck,
  'reception-walkin': UserPlus,
  'reception-checkin': QrCode,
  'reception-history': History,
};

const PAGE_BLURBS = {
  'reception-queue': "Everyone who has checked in today, in arrival order. Attach tests, print a ticket, or send a patient through to billing.",
  'reception-walkin': 'Register a patient who arrived without an appointment. Creates the patient record if they are new, then opens a visit.',
  'reception-checkin': 'Scan a booking pass or key in the reference code to turn a confirmed appointment into a live visit.',
  // Says what the screen does. It described itself as "Completed and cancelled visits" while
  // showing Pending and Processing ones too — findVisitsByDateRange is deliberately any-status,
  // so the copy was the half that was wrong. A receptionist looking a patient up does not know
  // what state the visit reached, which is usually why they are looking.
  'reception-history': 'Every visit in a chosen date range, whatever state it reached. Read-only.',
};
const VALID_VIEWS = Object.keys(PAGE_TITLES);

const ReceptionistDashboard = ({ activeNav = 'reception-queue', onSelectNav }) => {
  const { hasPermission } = useAuth();
  // Any nav value this component doesn't recognize (e.g. a stale/default 'dashboard') falls
  // back to the primary queue view, mirroring DiagnosticDashboard's existing fallback pattern.
  const view = VALID_VIEWS.includes(activeNav) ? activeNav : 'reception-queue';
  // Desk performance, on Visit History where someone is reviewing rather than checking people
  // in. The queue KPIs count who is waiting; nothing measured how long they wait.
  const operations = useOperationsReport({ days: 7, enabled: view === 'reception-history' });
  const queue = useReceptionQueue({ enabled: view === 'reception-queue' });
  const reference = useClinicReferenceData();

  const history = useVisitHistory({ enabled: view === 'reception-history' });

  const checkIn = useAppointmentCheckIn({
    // What a successful admission means to the rest of the screen. The hook does not know the
    // queue or the lookup panel exist; it reports what happened and this decides.
    onCheckedIn: ({ type, patient, visit }) => {
      if (type === 'walkin') {
        lookup.noteCheckedIn(`${patient.first_name} ${patient.last_name} checked in! Physical Queue Ticket: ${visit.queue_number}`);
        lookup.setQuery('');
      }
      queue.refresh();
    },
  });

  const disposition = useVisitDisposition({
    // Every disposition changes who is waiting, so the queue is always re-read. A no-show also
    // clears the verified booking: leaving it on screen invites checking in someone who is not
    // coming.
    onChanged: ({ type }) => {
      if (type === 'noShow') checkIn.clearResult();
      queue.refresh();
    },
  });

  const testAssignment = useTestAssignment({ onAssigned: () => queue.refresh() });

  // Existing Patient Lookup State (Module 7: patient record lookup)
  const lookup = usePatientLookup();

  // Walk-in Registration State

  // The form holds the patient type as an id; the referral rule is expressed in names. Resolved
  // here rather than comparing against a hardcoded id, which a reseed could renumber.
  // Manual HMO logging State
  const hmo = useHmoLogging({ onLogged: () => queue.refresh() });

  // UI/UX Modernization Phase 10: read-only visibility into pending HMO requests, shown on the
  // Active Queue landing view.

  // UI/UX Modernization Phase 10: GET /hmo/requests has always been authorized for
  // Receptionist, but nothing on this dashboard ever called it — pending requests were
  // effectively invisible unless someone already knew to look at Admin's Service Requests page.
  // Read-only here: approving stays wherever it already lives, this just surfaces the list.
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
    <SidebarLayout title={PAGE_TITLES[view]} activeNav={view} onSelectNav={onSelectNav}>
      <div className="space-y-5">
        <PageHeader
          icon={PAGE_ICONS[view]}
          title={PAGE_TITLES[view]}
          description={PAGE_BLURBS[view]}
          actions={
            /* Only for someone who can actually register one. [1.53.0] A Cashier holds
               `visits:read` and so reaches this queue legitimately — knowing who is waiting is
               half of running a till — but not `visits:create`. This button sent them to a screen
               their own sidebar does not list, to submit a request the API answers with 403.
               Gated on the permission the endpoint itself demands, so the two agree. */
            view === 'reception-queue' && hasPermission('visits:create') ? (
              <Button variant="outline" onClick={() => onSelectNav?.('reception-walkin')}>
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

        {/* Queue and registration together, on a screen wide enough to hold both. [1.63.0]
            ── Why 2xl and not lg ──────────────────────────────────────────────────────────────
            A reception monitor is 1920 wide; a laptop at the desk is 1280-1440. Splitting at `lg`
            would squeeze the queue table — which has seven columns and is the primary content —
            on exactly the machines that can least afford it. At 2xl there is genuinely room for
            both, and below it the layout is unchanged, which is also why no existing test moves.

            Registration is the SECOND column, not the first. The queue is what a receptionist
            watches continuously; registering a walk-in is what they do intermittently. Putting
            the form on the left would put the interruption where the attention lives.

            The two views stay mutually exclusive elsewhere, so the form is never mounted twice —
            `reception-walkin` still renders it alone, full width, for the narrower screens where
            that is the only way to give it room. */}
        {view === 'reception-queue' && (
          <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
            {/* The wrapper is load-bearing, not tidiness. ActiveQueuePanel returns a FRAGMENT, so
                without it the panel's three children — the metric row, the HMO band and the queue
                table — each became a separate grid item and got dealt alternately into the two
                columns. Found by screenshotting it: the metrics sat left, the HMO band top-right,
                the table left again.

                `items-start` for the same class of reason: grid items stretch to the tallest row
                by default, which inflated the metric cards into tall empty boxes to match the
                band beside them.

                3fr/1fr rather than 2fr/1fr because the queue table has seven columns. At 2fr it
                fitted the viewport but clipped Actions — the primary controls — off its own right
                edge. The table scrolls inside its panel as a backstop, but a horizontal scrollbar
                to reach "Edit Tests" is a worse answer than giving the table the room. */}
            <div className="min-w-0 space-y-5">
              <ActiveQueuePanel
                queue={queue}
                disposition={disposition}
                hmo={hmo}
                testAssignment={testAssignment}
                onCallPatient={speakQueueNumber}
                onSelectNav={onSelectNav}
              />
            </div>
            {/* Only for someone who may actually register one — the same permission the button in
                the header answers to, and the same 403 it exists to avoid. */}
            {hasPermission('visits:create') && (
              <div className="hidden 2xl:block">
                <WalkInPanel queue={queue} lookup={lookup} checkIn={checkIn} reference={reference} compact />
              </div>
            )}
          </div>
        )}

        {view === 'reception-history' && (
          <VisitHistoryPanel history={history} operations={operations} />
        )}

        {view === 'reception-walkin' && (
          <WalkInPanel queue={queue} lookup={lookup} checkIn={checkIn} reference={reference} />
        )}

        {view === 'reception-checkin' && (
          <CheckInPanel checkIn={checkIn} disposition={disposition} />
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
              {/* Same control as the registration form below, so the two cannot drift on
                  grouping, the running total, or the preparation warning. */}
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

        {/* Check-in confirmation — one dialog for both check-in paths (QR/reference verify and
            existing-patient lookup), see .agents Phase 12 and UI/UX Phase 3 */}
        <ConfirmDialog
          open={!!checkIn.target}
          onOpenChange={(open) => { if (!open) checkIn.cancel(); }}
          title="Confirm Check-In"
          description={
            checkIn.target?.type === 'appointment'
              ? `Check in ${checkIn.target.data.first_name} ${checkIn.target.data.last_name} (Queue ${checkIn.target.data.queue_number})? This confirms their appointment and moves them into processing.`
              : checkIn.target?.type === 'walkin'
              ? `Check in ${checkIn.target.data.first_name} ${checkIn.target.data.last_name} as a walk-in? This creates a new visit and queue ticket.`
              : ''
          }
          confirmLabel="Confirm Check-In"
          onConfirm={checkIn.confirm}
          loading={checkIn.submitting}
          error={checkIn.error}
        />

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
          description={disposition.noShow.target && `Mark ${disposition.noShow.target.first_name} ${disposition.noShow.target.last_name}'s appointment (Queue ${disposition.noShow.target.queue_number}) as a no-show? This does not check them in.`}
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
            // Keep the verified booking on screen showing its new time, rather than clearing the
            // panel and making the receptionist re-scan to confirm the move landed.
            checkIn.applyToResult(moved);
            toastSuccess('Appointment rescheduled.');
          }}
        />

      </div>
    </SidebarLayout>
  );
};

export default ReceptionistDashboard;
