import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import EmptyState from './ui/empty-state';
import { Skeleton } from './ui/skeleton';
import api from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { printElement } from '../lib/printArea';
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
 *
 * ── Every copy is logged [1.108.0] ─────────────────────────────────────────────────────────────
 * Opening the report fetches it, and the server logs that fetch. Printing it and saving it happen
 * here, on the copy already fetched, so for staff they are reported to POST /results/:id/copies
 * before they happen. Best-effort: a failed log never stops the print, because the report is
 * already on the screen in front of them and refusing to print it would protect nothing.
 *
 * `authorisedOnly` asks for the report that went out rather than an amendment still being
 * written — what Patient Records shows. `autoPrint` prints as soon as the report has loaded, for
 * a Print button on a list.
 *
 * ── A patient views and prints; they are not offered a download [1.113.0] ──────────────────────
 * The clinic's choice: a patient who wants their own copy asks for it to be emailed, and the clinic
 * sends it. So for a Client there is no Download and no "Open in new tab" (a tab is a download one
 * click later), and the PDF viewer's own toolbar is asked to hide (`#toolbar=0`, honoured by Chrome
 * and Edge). This is what the portal OFFERS, not a lock: a report on someone's screen can still be
 * kept by whoever is looking at it. The one exception is a phone with no PDF viewer, where a new tab
 * is the only way to read it at all.
 *
 * ── What a patient is served is the DIGITAL COPY [1.114.0] ─────────────────────────────────────
 * The server marks it on every page (backend/src/utils/digitalCopy.js) and it is always a PDF; the
 * original stays on the staff side, which is where the clinic prints it. A Word or Excel report
 * cannot be marked, so the server refuses it with a 409 and this dialog shows the reason it gives.
 */

const ResultDocument = ({
  open, onOpenChange, visitTestId, testName, patientName, fileName,
  authorisedOnly = false, autoPrint = false,
}) => {
  const { hasRole } = useAuth();
  const isPatient = hasRole('Client');
  const [state, setState] = useState({ status: 'idle', url: null, kind: null, error: '' });
  // Held in a ref as well as state so the cleanup effect can revoke the *current* URL without
  // taking `state` as a dependency, which would re-run cleanup on every render and revoke a URL
  // the iframe is still displaying.
  const urlRef = useRef(null);
  const imageRef = useRef(null);
  // One automatic print per opening, however many times the frame reports that it loaded.
  const autoPrintedRef = useRef(false);

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
    autoPrintedRef.current = false;

    (async () => {
      try {
        const res = await api.get(`/results/${visitTestId}/file`, {
          responseType: 'blob',
          params: authorisedOnly ? { version: 'authorised' } : undefined,
        });
        if (cancelled) return;
        const kind = previewKindFor(res.data?.type);
        const url = window.URL.createObjectURL(res.data);
        urlRef.current = url;
        setState({ status: 'ready', url, kind, error: '' });
      } catch (err) {
        if (cancelled) return;
        // A 409 carries the server's own reason [1.114.0]: a patient's report that cannot be made
        // into a digital copy (a Word document, a damaged file) is given out at the clinic, and the
        // message says so. The body arrives as a Blob, because the request asked for one.
        let reason = '';
        if (err.response?.status === 409 && err.response.data instanceof Blob) {
          try {
            reason = JSON.parse(await err.response.data.text()).message || '';
          } catch {
            // Not JSON: the generic message below stands.
          }
        }
        if (cancelled) return;
        setState({
          status: 'error',
          url: null,
          kind: null,
          // 404 here means the row references a file that is not on disk, which is a different
          // problem from "you may not see this" and worth saying differently.
          error: reason
            || (err.response?.status === 404
              ? 'The report file is missing from storage. The record references it, but it is not there.'
              : err.response?.status === 403
                ? 'You do not have access to this report.'
                : 'Could not load the report. Check your connection and try again.'),
        });
      }
    })();

    return () => {
      cancelled = true;
      revoke();
    };
  }, [open, visitTestId, authorisedOnly, revoke]);

  // A patient's copies of their own report are not logged, as with every other read of their own
  // record; the route is staff-only and would refuse them anyway.
  const logCopy = (kind) => {
    if (hasRole('Client') || !visitTestId) return;
    api.post(`/results/${visitTestId}/copies`, { kind }).catch(() => {});
  };

  const download = () => {
    if (!state.url) return;
    logCopy('download');
    const link = document.createElement('a');
    link.href = state.url;
    link.download = fileName || `${testName || 'result'}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // Printing an <iframe> means printing its document, not the page around it — so a PDF does not
  // use the .print-area trick the rest of the app uses for printing a DOM subtree. An image does:
  // printElement prints that one <img> on a page of its own. [1.108.0]
  const printDocument = () => {
    logCopy('print');
    if (state.kind === 'image' && imageRef.current) {
      printElement(imageRef.current);
      return;
    }
    const frame = document.getElementById('result-document-frame');
    if (frame?.contentWindow) frame.contentWindow.print();
    else window.open(state.url, '_blank', 'noopener');
  };

  const canPrint = state.status === 'ready'
    && (state.kind === 'image' || (state.kind === 'pdf' && canRenderPdfInline()));

  // Called from the frame's or the image's onLoad: printing before the document has drawn prints
  // a blank page. The short wait is for the PDF viewer, which reports load before it has painted.
  const printIfAsked = () => {
    if (!autoPrint || autoPrintedRef.current) return;
    autoPrintedRef.current = true;
    setTimeout(printDocument, 300);
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
                src={isPatient ? `${state.url}#toolbar=0&navpanes=0` : state.url}
                onLoad={printIfAsked}
                className="h-[60vh] w-full border-0 bg-white"
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="This browser can't display PDFs inline"
                description={isPatient
                  ? 'The report loaded fine — your browser just has no built-in PDF viewer. Open it in a new tab to read it.'
                  : 'The report loaded fine — your browser just has no built-in PDF viewer. Open it in a new tab or download it.'}
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => window.open(state.url, '_blank', 'noopener')}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in new tab
                    </Button>
                    {!isPatient && (
                      <Button size="sm" onClick={download}>
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    )}
                  </div>
                }
              />
            )
          )}

          {state.status === 'ready' && state.kind === 'image' && (
            <div className="flex h-[60vh] items-center justify-center overflow-auto bg-white p-4">
              <img
                ref={imageRef}
                src={state.url}
                alt={`${testName || 'Diagnostic report'} preview`}
                onLoad={printIfAsked}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}

          {state.status === 'ready' && !state.kind && (
            isPatient ? (
              <EmptyState
                icon={FileText}
                title="This report can't be shown here"
                description="It is a Word document or a spreadsheet, which a browser cannot display. Please visit the clinic and ask for it."
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="This file type can't be shown here"
                description="Download it to open in the right application. PDFs and images preview inline."
                action={<Button size="sm" onClick={download}><Download className="h-3.5 w-3.5" />Download</Button>}
              />
            )
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {state.status === 'ready' && (
            <>
              {!isPatient && (
                <Button variant="outline" onClick={() => window.open(state.url, '_blank', 'noopener')}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in new tab
                </Button>
              )}
              {canPrint && (
                <Button variant={isPatient ? 'default' : 'outline'} onClick={printDocument}>
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </Button>
              )}
              {!isPatient && (
                <Button onClick={download}>
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ResultDocument;
