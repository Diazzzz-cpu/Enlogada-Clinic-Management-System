import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import EmptyState from './ui/empty-state';
import { Skeleton } from './ui/skeleton';
import api from '../config/api';
import { canRenderPdfInline, previewKindFor } from '../lib/preview';
import { FileText, Download, Printer, AlertCircle, ExternalLink } from 'lucide-react';

/**
 * Viewing the attached report, rather than downloading it to find out what it says.
 *
 * Every screen that surfaced a result file — the Client's history, the diagnostic worklist, the
 * Admin's patient records — offered exactly one thing: "Download Attachment". So checking whether
 * the right PDF was attached to the right patient meant saving a file, leaving the browser,
 * opening it, and coming back. On the Client's side it meant a patient on a phone downloading a
 * file to a device they may not have a PDF reader on, to read a result they were already looking
 * at the summary of.
 *
 * ── Why a blob, and not just <iframe src="/api/results/…"> ────────────────────────────────────
 * The file route is authenticated. A bare src attribute cannot carry the Authorization header, so
 * the browser would issue an anonymous request and get a 401 — this is the same reason
 * ClientDashboard's downloadResultFile already fetches through `api` and builds an object URL.
 * The URL is revoked on close; leaking one keeps the whole file alive in memory for the tab's
 * lifetime, which on a reception machine left open all day is a real amount of PHI sitting in a
 * process nobody is looking at.
 *
 * ── Why not preview everything ────────────────────────────────────────────────────────────────
 * PDFs and images render inline; anything else offers a download and says why. The upload
 * allowlist is pdf/jpeg/png (backend/src/config/upload.js), so "anything else" is only reachable
 * through a legacy `file_url` typed in before uploads existed — but a viewer that renders a blank
 * grey box for an unknown type is worse than one that admits it cannot show it.
 */

const ResultDocument = ({ open, onOpenChange, visitTestId, testName, patientName, fileName }) => {
  const [state, setState] = useState({ status: 'idle', url: null, kind: null, error: '' });
  // Held in a ref as well as state so the cleanup effect can revoke the *current* URL without
  // taking `state` as a dependency, which would re-run cleanup on every render and revoke a URL
  // the iframe is still displaying.
  const urlRef = useRef(null);

  const revoke = useCallback(() => {
    if (urlRef.current) {
      window.URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open || !visitTestId) return undefined;
    let cancelled = false;
    setState({ status: 'loading', url: null, kind: null, error: '' });

    (async () => {
      try {
        const res = await api.get(`/results/${visitTestId}/file`, { responseType: 'blob' });
        if (cancelled) return;
        const kind = previewKindFor(res.data?.type);
        const url = window.URL.createObjectURL(res.data);
        urlRef.current = url;
        setState({ status: 'ready', url, kind, error: '' });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          url: null,
          kind: null,
          // 404 here means the row references a file that is not on disk, which is a different
          // problem from "you may not see this" and worth saying differently.
          error:
            err.response?.status === 404
              ? 'The report file is missing from storage. The record references it, but it is not there.'
              : err.response?.status === 403
                ? 'You do not have access to this report.'
                : 'Could not load the report. Check your connection and try again.',
        });
      }
    })();

    return () => {
      cancelled = true;
      revoke();
    };
  }, [open, visitTestId, revoke]);

  const download = () => {
    if (!state.url) return;
    const link = document.createElement('a');
    link.href = state.url;
    link.download = fileName || `${testName || 'result'}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // Printing an <iframe> means printing its document, not the page around it — so this deliberately
  // does not use the .print-area trick the rest of the app uses for printing a DOM subtree.
  const printDocument = () => {
    const frame = document.getElementById('result-document-frame');
    if (frame?.contentWindow) frame.contentWindow.print();
    else window.open(state.url, '_blank', 'noopener');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{testName || 'Diagnostic Report'}</DialogTitle>
          <DialogDescription>
            {patientName ? `${patientName} · ` : ''}
            {fileName || 'Attached report'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[60vh] overflow-hidden rounded-lg border border-line bg-slate-50">
          {state.status === 'loading' && (
            <div className="space-y-3 p-6">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-[52vh] w-full rounded-lg" />
            </div>
          )}

          {state.status === 'error' && (
            <EmptyState tone="error" icon={AlertCircle} title="Report unavailable" description={state.error} />
          )}

          {state.status === 'ready' && state.kind === 'pdf' && (
            canRenderPdfInline() ? (
              <iframe
                id="result-document-frame"
                title={`${testName || 'Diagnostic report'} preview`}
                src={state.url}
                className="h-[60vh] w-full border-0 bg-white"
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="This browser can't display PDFs inline"
                description="The report loaded fine — your browser just has no built-in PDF viewer. Open it in a new tab or download it."
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => window.open(state.url, '_blank', 'noopener')}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in new tab
                    </Button>
                    <Button size="sm" onClick={download}>
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </Button>
                  </div>
                }
              />
            )
          )}

          {state.status === 'ready' && state.kind === 'image' && (
            <div className="flex h-[60vh] items-center justify-center overflow-auto bg-white p-4">
              <img src={state.url} alt={`${testName || 'Diagnostic report'} preview`} className="max-h-full max-w-full object-contain" />
            </div>
          )}

          {state.status === 'ready' && !state.kind && (
            <EmptyState
              icon={FileText}
              title="This file type can't be shown here"
              description="Download it to open in the right application. PDFs and images preview inline."
              action={<Button size="sm" onClick={download}><Download className="h-3.5 w-3.5" />Download</Button>}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {state.status === 'ready' && (
            <>
              <Button variant="outline" onClick={() => window.open(state.url, '_blank', 'noopener')}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open in new tab
              </Button>
              {state.kind === 'pdf' && canRenderPdfInline() && (
                <Button variant="outline" onClick={printDocument}>
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </Button>
              )}
              <Button onClick={download}>
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ResultDocument;
