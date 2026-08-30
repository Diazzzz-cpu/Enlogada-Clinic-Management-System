import React from 'react';
import { printElement } from '../../lib/printArea';
import { AlertCircle, CheckCircle2, FileText, Printer, Send } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { TEMPLATES_BY_CATEGORY } from '../../lib/resultTemplates';
import MeasurementGrid from './MeasurementGrid';
import ResultReport from '../ResultReport';

/**
 * Recording findings, and authorising the release that sends them to the patient.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 * 
 * The release confirmation travels with it: authorising is irreversible from this screen
 * and emails the patient, so the question and the form asking it belong together.
 * Record Diagnostic Findings & Result Entry Modal
 */
export default function ResultEntryDialog({ worklist, entry, patientHistory }) {
  return (
    <>
      <Dialog
        open={entry.open}
        onOpenChange={(next) => { if (!next) entry.close(); }}
      >
        <DialogContent className="max-w-2xl">
          {entry.justReleased ? (
            <div className="space-y-4">
              <div className="flex items-center space-x-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm font-bold">Result released successfully.</span>
              </div>

              {/* The clinic's copy of what was just released, rendered by the same component that
                  renders the patient's copy in the portal. They were two different documents
                  before [1.50.0] — this one hardcoded the clinic's name and showed no referring
                  physician, so the sheet filed here and the sheet the patient downloads disagreed
                  about what the report said. */}
              <ResultReport result={entry.justReleased} measurements={entry.justReleased.measurements || []} signatories={entry.justReleased.signatories || []} fieldSet={entry.fieldSet} />

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => printElement(null, 'printing-report')} className="text-xs font-bold flex items-center space-x-1.5">
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Now</span>
                </Button>
                <Button
                  type="button"
                  onClick={entry.close}
                  className="text-xs font-bold"
                >
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900">
              {entry.isEditing ? 'Correct Released Result' : 'Record Findings & Release Diagnostic Certificate'}
            </DialogTitle>
            <DialogDescription>
              Patient: <strong>{entry.activeTest?.first_name} {entry.activeTest?.last_name}</strong> &bull; Examination: <strong>{entry.activeTest?.test_name}</strong>
              {entry.isEditing && ' — re-submitting will notify the patient again by email.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={entry.record} className="space-y-4 pt-2">
            {entry.error && (
              <div role="alert" className="alert alert-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{entry.error}</span>
              </div>
            )}

            {/* Phase C finding 02: past results for this same patient, surfaced at the point
                of writing new findings — GET /results/history/:patientId already existed but
                nothing on this screen ever called it. */}
            {(patientHistory.loading || patientHistory.results.length > 0) && (
              <div className="space-y-1.5">
                <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Past Results for This Patient</span>
                {patientHistory.loading ? (
                  <p className="text-fine text-gray-400 m-0">Loading history…</p>
                ) : (
                  <div className="border border-gray-200 rounded-xl divide-y divide-[#eef2f6] max-h-32 overflow-y-auto">
                    {patientHistory.results.map(h => (
                      <div key={h.visit_test_id} className="px-3 py-2 flex items-center justify-between gap-2 text-fine">
                        <span className="font-semibold text-gray-700 truncate">{h.category_name} &middot; {h.test_name}</span>
                        <span className="text-gray-400 whitespace-nowrap">{new Date(h.visit_date).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quick Template Generator Buttons — scoped to this department's category */}
            {TEMPLATES_BY_CATEGORY[worklist.category]?.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Clinical Report Templates</span>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATES_BY_CATEGORY[worklist.category].map(t => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => entry.applyTemplate(t.key)}
                      className="text-fine font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-lg border border-gray-200 cursor-pointer"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Only for a test whose modality records measurements. Everything else is the
                free-text form it has always been — a data-driven switch rather than a category
                branch, so turning X-ray on later is seed data and not a code change. */}
            <MeasurementGrid
              fieldSet={entry.fieldSet}
              values={entry.measurements}
              patientSex={entry.activeTest?.sex}
              onChange={entry.setMeasurements}
              disabled={entry.saving}
            />

            <div className="space-y-1.5">
              <label htmlFor="diagnosticdashboard-findings-impression-required" className="field-label">Findings & Impression (Required)</label>
              <textarea id="diagnosticdashboard-findings-impression-required"
                rows={6}
                placeholder="Enter detailed laboratory/imaging findings, measurements, and impression..."
                value={entry.findings}
                onChange={e => entry.setFindings(e.target.value)}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="diagnosticdashboard-remarks-recommendations-optional" className="field-label">Remarks / Recommendations (Optional)</label>
              <Input id="diagnosticdashboard-remarks-recommendations-optional"
                placeholder="e.g. Clinical correlation recommended..."
                value={entry.remarks}
                onChange={e => entry.setRemarks(e.target.value)}
                className="text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="diagnosticdashboard-attach-report-file-optional" className="field-label">Attach Report File (Optional)</label>
              <input id="diagnosticdashboard-attach-report-file-optional"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={entry.chooseFile}
                className="w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-brand-50 file:text-brand-600 hover:file:bg-brand-100 file:cursor-pointer cursor-pointer"
              />
              <p className="text-fine text-gray-400 m-0">
                PDF, JPEG, or PNG — up to 15MB.
                {entry.isEditing && (entry.activeTest?.file_path || entry.activeTest?.file_url) && !entry.resultFile && ' A file is already attached — leave blank to keep it, or attach a new one to replace it.'}
              </p>
              {entry.resultFile && (
                <p className="text-fine font-semibold text-slate-700 m-0">{entry.resultFile.name} ({(entry.resultFile.size / 1024).toFixed(0)} KB)</p>
              )}
            </div>

            {/* Why a released report is being changed. Required on an amendment because the
                audit entry is otherwise "something changed" and nothing more — the superseded
                version is kept, but without a reason nobody can tell why it was replaced. */}
            {entry.isAmendingReleased && (
              <div className="space-y-1.5">
                <label htmlFor="amendment-reason" className="field-label">
                  Reason for Amendment <span className="text-rose-600">*</span>
                </label>
                <Input
                  id="amendment-reason"
                  placeholder="e.g. Transcription error in the original report"
                  value={entry.amendmentReason}
                  onChange={e => entry.setAmendmentReason(e.target.value)}
                  className="text-xs rounded-xl"
                />
                <p className="text-fine text-gray-400 m-0">
                  The previous version is kept and stays readable in this test&apos;s history — it is
                  superseded, not overwritten. The patient is told their report was updated.
                </p>
              </div>
            )}

            {/* Critical value. Deliberately styled as a warning rather than a quiet checkbox:
                flagging it is what triggers the callback, and missing it is the most dangerous
                thing that can happen on this screen. */}
            <label
              className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                entry.isCritical ? 'bg-rose-50 border-rose-300' : 'bg-slate-50/80 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={entry.isCritical}
                onChange={e => entry.setIsCritical(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-rose-600 cursor-pointer flex-shrink-0"
              />
              <span className="space-y-0.5">
                <span className={`block text-xs font-bold ${entry.isCritical ? 'text-rose-700' : 'text-gray-700'}`}>
                  Flag as a CRITICAL result requiring patient callback
                </span>
                <span className="block text-fine text-gray-500">
                  Alerts the front desk and administrators to telephone the patient, and replaces
                  the routine &quot;results are ready&quot; email with one asking them to contact the clinic.
                </span>
              </span>
            </label>

            <div className="flex justify-end space-x-2 pt-2 border-t border-line">
              <Button type="button" variant="outline" onClick={entry.close}>Cancel</Button>
              <Button
                type="submit"
                disabled={entry.saving || (entry.isAmendingReleased && entry.amendmentReason.trim().length < 4)}
                variant="outline"
                className="font-bold text-xs px-5 py-2 rounded-xl border-gray-200 flex items-center space-x-1.5"
              >
                <FileText className="w-4 h-4" />
                <span>{entry.saving ? 'Saving…' : 'Save Findings'}</span>
              </Button>
              <Button
                type="button"
                onClick={entry.requestRelease}
                className="font-bold text-xs px-5 py-2 rounded-xl flex items-center space-x-1.5"
              >
                <Send className="w-4 h-4" />
                <span>{entry.isEditing ? 'Save Correction & Re-notify' : 'Authorize & Release Result'}</span>
              </Button>
            </div>
          </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Result release confirmation — irreversible/clinically significant, see .agents Phase 12 */}
      <ConfirmDialog
        open={entry.confirmingRelease}
        onOpenChange={(next) => { if (!next) entry.dismissReleaseConfirm(); }}
        title={entry.isEditing ? 'Save Correction' : 'Authorize & Release Result'}
        description={entry.activeTest ? (
          entry.isEditing
            ? `Save the corrected ${entry.activeTest.test_name} findings for ${entry.activeTest.first_name} ${entry.activeTest.last_name}? The patient will receive a new "results ready" email.`
            : `Release ${entry.activeTest.test_name} findings for ${entry.activeTest.first_name} ${entry.activeTest.last_name}? This finalizes the result and cannot be undone from this screen.`
        ) : ''}
        confirmLabel={entry.isEditing ? 'Save Correction' : 'Authorize & Release'}
        onConfirm={entry.release}
        loading={entry.releasing}
        error={entry.error}
      />
    </>
  );
}
