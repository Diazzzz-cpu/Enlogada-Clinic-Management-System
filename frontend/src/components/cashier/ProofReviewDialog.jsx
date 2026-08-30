import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, Maximize2, Minus, Plus, RotateCcw, ShieldAlert } from 'lucide-react';
import api from '../../config/api';
import { cn } from '../../lib/utils';
import { formatCurrency } from '../../lib/currency';
import { Button } from '../ui/button';
import DataBadge from '../ui/data-badge';
import EmptyState from '../ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';

/**
 * Deciding a proof of payment, with the evidence and the claim on screen together. [1.63.0]
 *
 * ── What was wrong with looking at them separately ──────────────────────────────────────────
 *
 * The proof opened in its own dialog on top of the queue, so the cashier read a screenshot, closed
 * it, and then decided from a row they were now remembering rather than reading. The two numbers
 * that matter — what the patient CLAIMS they sent and what the visit actually owes — were behind
 * the thing covering them.
 *
 * That is the failure [1.48.0] built this queue to prevent, arriving by another door: approval
 * bills the visit's REAL total, so approving a ₱50 claim on a ₱1,450 visit records ₱1,450 and the
 * drawer is short ₱1,400 with nothing on screen to say why.
 *
 * ── Zoom, because a phone screenshot of a bank app is small ─────────────────────────────────
 *
 * The reference is the part being read, it is thirteen digits, and it arrives as a photograph of a
 * screen taken at an angle. `object-contain` in a 70vh box makes that unreadable and the cashier's
 * only recourse was to guess or reject. Zoom and drag-to-pan, with a reset.
 *
 * ── The duplicate warning is a warning, not a block ─────────────────────────────────────────
 *
 * The same screenshot submitted twice — forwarded to a second visit, or re-sent because the
 * patient was unsure it went through — is indistinguishable from two genuine payments unless
 * something looks. But a repeated reference is not always a mistake: a patient correcting a
 * rejected submission re-sends the same one on purpose, and references are not globally unique
 * across providers. So it is surfaced loudly and the cashier still decides, exactly as they do
 * for the amount.
 */

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

/** The uploaded file, fetched with the session's auth header, zoomable and pannable. */
function ProofCanvas({ submissionId }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  const [isPdf, setIsPdf] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    // A bare <img src> would 401 — the route is authenticated because this is a patient's banking
    // screen. Fetched as a blob through the configured axios instance, which carries the token.
    api.get(`/payment-submissions/${submissionId}/proof`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        setIsPdf(res.data.type === 'application/pdf');
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      // Revoked on unmount: an un-revoked object URL pins the whole blob for the life of the
      // document, and a cashier works through dozens of these in a shift.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [submissionId]);

  // Panning is only meaningful once zoomed in; resetting the offset with the zoom stops the image
  // being left parked off-centre when it snaps back to fit.
  const setZoomSafely = useCallback((next) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    setZoom(clamped);
    if (clamped === 1) setOffset({ x: 0, y: 0 });
  }, []);

  const onPointerDown = (e) => {
    if (zoom === 1) return;
    drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  };
  const onPointerUp = () => { drag.current = null; };

  if (failed) {
    return (
      <EmptyState
        tone="error"
        compact
        title="The file could not be opened"
        description="It may have been removed from storage. Decide from the reference number, or ask the patient to send it again."
      />
    );
  }

  // A PDF is rendered by the browser's own viewer, which already has zoom — adding ours on top
  // would be two zoom controls fighting over one document.
  if (isPdf) {
    return src
      ? <iframe src={src} title="Proof of payment" className="h-[60vh] w-full rounded-lg border border-line" />
      : <div className="h-[60vh] animate-pulse rounded-lg bg-skeleton" aria-hidden="true" />;
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          // `bg-sunken`, not a tinted slate-900. The neutral ramp inverts for the INK role in
          // dark mode, so even at 5% opacity that shade is the wrong half of a paired decision —
          // `checkFillRoles.js` caught it here, which is the third time that guard has paid for
          // itself. A sunken well is what this actually is: a recess the screenshot sits in, so a
          // white receipt on a white panel still has an edge.
          'relative h-[60vh] overflow-hidden rounded-lg border border-line bg-sunken',
          zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {src ? (
          <img
            src={src}
            alt="Proof of payment"
            draggable={false}
            className="h-full w-full select-none object-contain transition-transform duration-100"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-skeleton" aria-hidden="true" />
        )}
      </div>

      <div className="flex items-center justify-center gap-1">
        <Button type="button" variant="outline" size="icon-sm" onClick={() => setZoomSafely(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[3.5rem] text-center text-fine font-semibold tabular-nums text-ink-muted">
          {Math.round(zoom * 100)}%
        </span>
        <Button type="button" variant="outline" size="icon-sm" onClick={() => setZoomSafely(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" onClick={() => setZoomSafely(1)} disabled={zoom === 1} aria-label="Reset zoom">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={() => window.open(src, '_blank', 'noopener')} disabled={!src}>
          <Maximize2 className="h-3 w-3" />
          Full size
        </Button>
      </div>
      {zoom > 1 && (
        <p className="m-0 text-center text-micro text-ink-muted">Drag the image to move around it.</p>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.submission  A row from the pending queue.
 * @param {() => void} props.onClose
 * @param {(s: object) => void} [props.onVerify]
 * @param {(s: object) => void} [props.onReject]
 * @param {boolean} [props.busy]
 */
export default function ProofReviewDialog({ submission, onClose, onVerify, onReject, busy = false }) {
  if (!submission) return null;

  const claimed = Number(submission.amount_claimed);
  const due = Number(submission.amount_due);
  // A centavo of slack: both are NUMERIC(10,2) and this is a comparison for a human, not a
  // reconciliation. Flagging a 0.001 difference would cry wolf on every visit.
  const mismatch = Number.isFinite(claimed) && Number.isFinite(due) && Math.abs(claimed - due) > 0.01;
  const duplicates = Number(submission.duplicate_count) || 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* Wider than the old viewer, because it now holds two columns rather than one image. */}
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Review proof of payment</DialogTitle>
          <DialogDescription>
            {submission.first_name} {submission.last_name}
            {submission.queue_number ? ` · queue ${submission.queue_number}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* ── The evidence ──────────────────────────────────────────────────────────────── */}
          <div className="min-w-0">
            {submission.has_proof ? (
              <ProofCanvas submissionId={submission.id} />
            ) : (
              <EmptyState
                compact
                title="No proof was attached"
                description="Decide from the reference number, or ask the patient to send a screenshot."
              />
            )}
          </div>

          {/* ── The claim ─────────────────────────────────────────────────────────────────── */}
          <div className="min-w-0 space-y-3">
            {duplicates > 0 && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-700" aria-hidden="true" />
                <span className="text-fine leading-relaxed text-rose-900">
                  <strong className="font-bold">This reference has been used before.</strong>{' '}
                  It appears on {duplicates} other {duplicates === 1 ? 'record' : 'records'} — another
                  claim, or a receipt already settled at the counter. Check this is not the same
                  transfer being counted twice before approving.
                </span>
              </div>
            )}

            <dl className="m-0 space-y-2.5">
              <div>
                <dt className="text-micro font-semibold uppercase tracking-wide text-ink-muted">Reference</dt>
                <dd className="m-0 mt-0.5">
                  <DataBadge variant="reference" label="Payment reference" copyable>
                    {submission.reference_number}
                  </DataBadge>
                </dd>
              </div>

              <div>
                <dt className="text-micro font-semibold uppercase tracking-wide text-ink-muted">Channel</dt>
                <dd className="m-0 mt-0.5 text-fine font-semibold text-ink">
                  {submission.method_label || submission.method_kind || 'Not stated'}
                </dd>
              </div>

              {/* The two figures, together. [1.48.0] The claimed amount is EVIDENCE; approval bills
                  the recomputed total. Showing only one of them is how a drawer ends up short with
                  nothing on screen to explain it. */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-line bg-sunken p-2.5">
                  <dt className="text-micro font-semibold uppercase tracking-wide text-ink-muted">Patient claims</dt>
                  <dd className="m-0 mt-0.5 text-note font-bold tabular-nums text-ink">{formatCurrency(claimed || 0)}</dd>
                </div>
                <div className={cn(
                  'rounded-lg border p-2.5',
                  mismatch ? 'border-amber-300 bg-amber-50' : 'border-line bg-sunken'
                )}>
                  <dt className="text-micro font-semibold uppercase tracking-wide text-ink-muted">Visit owes</dt>
                  <dd className={cn('m-0 mt-0.5 text-note font-bold tabular-nums', mismatch ? 'text-amber-900' : 'text-ink')}>
                    {formatCurrency(due || 0)}
                  </dd>
                </div>
              </div>

              {mismatch && (
                <p className="m-0 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-fine leading-relaxed text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  <span>
                    These do not match. Approving records{' '}
                    <strong className="font-bold">{formatCurrency(due || 0)}</strong> — the visit's real
                    total — not the {formatCurrency(claimed || 0)} claimed.
                  </span>
                </p>
              )}
            </dl>

            {(onVerify || onReject) && (
              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                {onVerify && (
                  <Button type="button" onClick={() => onVerify(submission)} loading={busy} className="flex-1">
                    Verify &amp; issue receipt
                  </Button>
                )}
                {onReject && (
                  <Button type="button" variant="outline" onClick={() => onReject(submission)} disabled={busy} className="flex-1">
                    Reject
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { ProofCanvas };
