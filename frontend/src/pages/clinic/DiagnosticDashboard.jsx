import React, { useEffect, useRef, useState } from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import PageHeader from '../../components/ui/page-header';
import { useAuth } from '../../contexts/AuthContext';
import ResultDocument from '../../components/ResultDocument';
import useOperationsReport from '../../hooks/useOperationsReport';
import { useDiagnosticWorklist } from '../../hooks/useDiagnosticWorklist';
import WorklistPanel from '../../components/diagnostic/WorklistPanel';
import ResultHistoryPanel from '../../components/diagnostic/ResultHistoryPanel';
import ResultViewerDialog from '../../components/diagnostic/ResultViewerDialog';
import ResultEntryDialog from '../../components/diagnostic/ResultEntryDialog';
import { useResultEntry } from '../../hooks/useResultEntry';
import { useMarkExamDone } from '../../hooks/useMarkExamDone';
import { issuesReports } from '../../lib/categories';
import { usePatientResultHistory } from '../../hooks/usePatientResultHistory';
import { useResultDelivery } from '../../hooks/useResultDelivery';
import { categoryLabel as categoryLabelFor, categoryIcon } from '../../lib/categories';
import { findNavItem } from '../../config/navigation';

// A ticket only reaches this console once the receptionist/cashier has released it, at which
// point it is already 'Processing'. 'Pending' is therefore not a state this screen can ever
// show — it belongs to the front desk and cashier.


// Phase B: mirrors backend/src/config/upload.js's own allowlist/size cap, so a mismatched file
// is rejected instantly instead of round-tripping to the server first.

const DiagnosticDashboard = ({ activeNav = 'lab-ops', onSelectNav, intent }) => {
  const { user } = useAuth();
  // UI/UX Phase 1: 'worklist' (pending/processing, actionable) vs 'history' (already-released,
  // read-only) — each diagnostic role now has a real second nav destination for the latter,
  // which previously had no UI anywhere (released results just vanished from this screen).
  const mode = activeNav.endsWith('-history') ? 'history' : 'worklist';
  // How this department is actually performing, on the History screen where someone is looking
  // back rather than working the queue. Department-scoped server-side, so a lab account sees
  // Laboratory turnaround and nobody else's.
  const operations = useOperationsReport({ days: 7, enabled: mode === 'history' });
  const [viewingResult, setViewingResult] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);

  const patientHistory = usePatientResultHistory();

  const entry = useResultEntry({
    user,
    // Context for whoever is writing: what this patient's previous reports said.
    onOpened: (test) => patientHistory.loadFor(test.patient_id, test.visit_test_id),
    // Both outcomes re-read whichever list this console is showing. Recording happens from the
    // worklist and amending from History, so "the current mode's list" is always the right one.
    onRecorded: () => worklist.refresh(),
    onReleased: () => worklist.refresh(),
  });

  // Declared after `entry` because it reads it: polling is suspended while the findings dialog
  // is open, so a refetch cannot swap the list out from under someone typing into it.
  const worklist = useDiagnosticWorklist({
    activeNav,
    roles: user?.roles,
    mode,
    paused: entry.open,
  });

  // Today's "Open History" for reports never sent arrives with History already showing only those.
  // [1.77.0] Once per navigation, like every intent (see App.jsx).
  const handledIntent = useRef(null);
  useEffect(() => {
    if (!intent || mode !== 'history' || handledIntent.current === intent) return;
    handledIntent.current = intent;
    if (intent.delivery) worklist.setDeliveryFilter(intent.delivery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, mode]);

  // Re-reads the released list after a send, so the "Sent to patient" column shows the delivery
  // that just happened rather than the state it was fetched with.
  const delivery = useResultDelivery({ onDelivered: worklist.refresh });

  // X-ray: an exam is marked done, not reported here. [1.129.0]
  const examDone = useMarkExamDone({ onDone: () => worklist.refresh() });
  const reportsHere = issuesReports(worklist.category);




  // Display name, not the database name. `test_categories.name` is 'Xray' — a perfectly good
  // identifier and not how anyone writes it, so every heading on this console read "Xray
  // Operations Worklist". The value itself stays untouched: it is the join key for the worklist
  // queries and the department scope, and renaming it in the database to fix a caption would be
  // the wrong end of the problem.
  const categoryLabel = categoryLabelFor(worklist.category);
  const modalityIcon = categoryIcon(worklist.category);
  // What the sidebar calls it, so the sidebar, the breadcrumb and the heading agree. [1.79.0] It was
  // "Laboratory Operations Worklist" under a sidebar item reading "Laboratory Worklist": one screen,
  // two names, and someone told to "open the Laboratory Worklist" looked for a heading they never saw.
  const pageTitle = findNavItem(activeNav)?.label
    || (mode === 'history' ? `${categoryLabel} History` : `${categoryLabel} Worklist`);

  return (
    <SidebarLayout title={pageTitle} activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-5">
        <PageHeader
          icon={modalityIcon}
          title={pageTitle}
          description={
            !reportsHere
              ? (mode === 'history'
                ? `Every ${categoryLabel} exam this department has done. Results are given through the ${categoryLabel} department's own system, not here.`
                : `Patients whose ${categoryLabel} exam has been paid for and released to this department. Mark each exam done once it has been taken; results are given through the ${categoryLabel} department's own system.`)
              : mode === 'history'
                ? `Every ${categoryLabel} result this department has released, including amended versions.`
                : `Patients whose ${categoryLabel} exam has been paid for and released to this department. Record findings, then authorise the release of the report.`
          }
        />

        {mode === 'worklist' && (
          <WorklistPanel worklist={worklist} entry={entry} examDone={examDone} />
        )}

        {mode === 'history' && (
          <ResultHistoryPanel
            worklist={worklist}
            entry={entry}
            operations={operations}
            onViewResult={setViewingResult}
            delivery={delivery}
          />
        )}

        {/* Read-only Released Result Viewer */}
        <ResultViewerDialog
          result={viewingResult}
          onOpenChange={(open) => { if (!open) setViewingResult(null); }}
          onPreviewDocument={setPreviewDoc}
        />

        <ResultEntryDialog entry={entry} patientHistory={patientHistory} />

      </div>
      <ResultDocument
        open={Boolean(previewDoc)}
        onOpenChange={(o) => { if (!o) setPreviewDoc(null); }}
        visitTestId={previewDoc?.visitTestId}
        testName={previewDoc?.testName}
        patientName={previewDoc?.patientName}
        fileName={previewDoc?.fileName}
      />
    </SidebarLayout>
  );
};

export default DiagnosticDashboard;
