import React, { useState } from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import PageHeader from '../../components/ui/page-header';
import { useAuth } from '../../contexts/AuthContext';
import ResultDocument from '../../components/ResultDocument';
import useOperationsReport from '../../hooks/useOperationsReport';
import { useDiagnosticWorklist } from '../../hooks/useDiagnosticWorklist';
import { useCriticalCallbacks } from '../../hooks/useCriticalCallbacks';
import WorklistPanel from '../../components/diagnostic/WorklistPanel';
import ResultHistoryPanel from '../../components/diagnostic/ResultHistoryPanel';
import ResultViewerDialog from '../../components/diagnostic/ResultViewerDialog';
import ResultEntryDialog from '../../components/diagnostic/ResultEntryDialog';
import CriticalCallbackDialog from '../../components/diagnostic/CriticalCallbackDialog';
import { useResultEntry } from '../../hooks/useResultEntry';
import { usePatientResultHistory } from '../../hooks/usePatientResultHistory';
import { useResultDelivery } from '../../hooks/useResultDelivery';
import { categoryLabel as categoryLabelFor, categoryIcon } from '../../lib/categories';

// A ticket only reaches this console once the receptionist/cashier has released it, at which
// point it is already 'Processing'. 'Pending' is therefore not a state this screen can ever
// show — it belongs to the front desk and cashier.


// Phase B: mirrors backend/src/config/upload.js's own allowlist/size cap, so a mismatched file
// is rejected instantly instead of round-tripping to the server first.

const DiagnosticDashboard = ({ activeNav = 'lab-ops', onSelectNav }) => {
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

  const criticals = useCriticalCallbacks({ enabled: mode === 'worklist', paused: entry.open });

  // Re-reads the released list after a send, so the "Sent to patient" column shows the delivery
  // that just happened rather than the state it was fetched with.
  const delivery = useResultDelivery({ onDelivered: worklist.refresh });




  // Display name, not the database name. `test_categories.name` is 'Xray' — a perfectly good
  // identifier and not how anyone writes it, so every heading on this console read "Xray
  // Operations Worklist". The value itself stays untouched: it is the join key for the worklist
  // queries and the department scope, and renaming it in the database to fix a caption would be
  // the wrong end of the problem.
  const categoryLabel = categoryLabelFor(worklist.category);
  const modalityIcon = categoryIcon(worklist.category);
  const pageTitle = mode === 'history' ? `${categoryLabel} Result History` : `${categoryLabel} Operations Worklist`;

  return (
    <SidebarLayout title={pageTitle} activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-5">
        <PageHeader
          icon={modalityIcon}
          title={pageTitle}
          description={
            mode === 'history'
              ? `Every ${categoryLabel} result this department has released, including amended versions.`
              : `Patients whose ${categoryLabel} exam has been paid for and released to this department. Record findings, then authorise the release of the report.`
          }
        />

        {mode === 'worklist' && (
          <WorklistPanel worklist={worklist} entry={entry} criticals={criticals} />
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

        <ResultEntryDialog worklist={worklist} entry={entry} patientHistory={patientHistory} />

      </div>
      <ResultDocument
        open={Boolean(previewDoc)}
        onOpenChange={(o) => { if (!o) setPreviewDoc(null); }}
        visitTestId={previewDoc?.visitTestId}
        testName={previewDoc?.testName}
        patientName={previewDoc?.patientName}
        fileName={previewDoc?.fileName}
      />

      <CriticalCallbackDialog criticals={criticals} />
    </SidebarLayout>
  );
};

export default DiagnosticDashboard;
