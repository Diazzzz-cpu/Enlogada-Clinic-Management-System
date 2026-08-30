import React from 'react';
import { printElement } from '../../lib/printArea';
import VersionTimeline from './VersionTimeline';
import useResultVersions from '../../hooks/useResultVersions';
import { Eye, Paperclip, Printer } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import ResultReport from '../ResultReport';

/**
 * A released report, read back.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 */
export default function ResultViewerDialog({ result, onOpenChange, onPreviewDocument }) {
  // Only fetched when there IS a history to fetch. A first issue is version 1 and its chain is one
  // row — the overwhelming majority of reports — so asking for those would put a request behind
  // every report anyone opens to buy nothing. `version` is already in the payload.
  const history = useResultVersions(result?.visit_test_id, (result?.version ?? 1) > 1);

  return (
      <Dialog open={!!result} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900">Diagnostic Report</DialogTitle>
            <DialogDescription>
              Patient: <strong>{result?.first_name} {result?.last_name}</strong> &bull; Examination: <strong>{result?.test_name}</strong>
            </DialogDescription>
          </DialogHeader>

          {/* This screen printed findings and remarks with NO letterhead at all — a clinical
              document with nothing on it saying which clinic issued it. Same component as the
              patient's copy now, so there is one report rather than three that drifted. */}
          <ResultReport result={result} measurements={result?.measurements || []} signatories={result?.signatories || []}>
            {result?.file_path && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-slate-50/80 p-3 no-print">
                <span className="flex min-w-0 items-center gap-1.5 text-fine text-slate-600">
                  <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  <span className="truncate">{result.file_original_name || 'Attached report'}</span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onPreviewDocument({
                    visitTestId: result.visit_test_id,
                    testName: result.test_name,
                    patientName: `${result.first_name} ${result.last_name}`,
                    fileName: result.file_original_name,
                  })}
                >
                  <Eye className="h-3 w-3" />
                  View Attachment
                </Button>
              </div>
            )}
          </ResultReport>

          {/* What this report used to say, and why it changed. [1.63.0] OUTSIDE the printable
              document: the handed-over copy is the current report, and printing superseded
              findings alongside it is how somebody ends up acting on a value that was withdrawn. */}
          <VersionTimeline
            versions={history.versions}
            loading={history.loading}
            error={history.error}
          />

          <div className="flex justify-end pt-2 border-t border-line">
            <Button onClick={() => printElement(null, 'printing-report')} variant="outline">
              <Printer className="h-3.5 w-3.5" />
              Print Report
            </Button>
          </div>
        </DialogContent>
      </Dialog>
  );
}
