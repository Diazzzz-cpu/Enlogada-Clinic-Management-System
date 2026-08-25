import React from 'react';
import { Eye, Paperclip, Printer } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import ResultReport from '../ResultReport';
import { printReport } from '../../lib/printReport';

/**
 * A released report, read back.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 */
export default function ResultViewerDialog({ result, onOpenChange, onPreviewDocument }) {
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
          <ResultReport result={result} measurements={result?.measurements || []}>
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

          <div className="flex justify-end pt-2 border-t border-[#e6ebf1]">
            <Button onClick={printReport} variant="outline">
              <Printer className="h-3.5 w-3.5" />
              Print Report
            </Button>
          </div>
        </DialogContent>
      </Dialog>
  );
}
