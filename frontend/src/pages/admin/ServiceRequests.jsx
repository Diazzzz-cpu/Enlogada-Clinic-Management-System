import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import RefreshButton from '../../components/ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';
import Toolbar, { SegmentedFilter } from '../../components/ui/toolbar';
import EmptyState from '../../components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { StatusBadge } from '../../components/ui/status-badge';
import { SkeletonRows, SkeletonList } from '../../components/ui/skeleton';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { formatCurrency } from '../../lib/currency';
import { toastSuccess } from '../../lib/toast';
import { canRenderPdfInline, previewKindFor } from '../../lib/preview';
import { ShieldCheck, AlertCircle, Check, X } from 'lucide-react';

const STATUS_FILTERS = ['All', 'Pending', 'Approved', 'Rejected', 'Cancelled'];

// Sent to the server as `limit` — GET /hmo/requests pages at the database now [1.29.0].
const PAGE_SIZE = 15;

// Module 15 (Test and Service Request): the approval half of the HMO request/approval flow.
// Module 7 built request *initiation*; approval existed on the backend
// (PUT /hmo/request/:id/approve, PUT /hmo/request-test/:id) but had no UI anywhere, and there
// was no way to even discover pending requests (no "list" endpoint existed before this pass).
const ServiceRequests = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed fetch used to reach console.error and stop there, so the screen rendered its
  // EMPTY state — "No HMO requests yet" over a 500. That is the one thing empty-state.jsx's own
  // docstring says must never happen: a quiet clinic and a broken server call for opposite
  // responses, and one of them was being reported as the other.
  const [loadError, setLoadError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [detailRequest, setDetailRequest] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approvalCode, setApprovalCode] = useState('');
  const [detailError, setDetailError] = useState('');
  const [card, setCard] = useState({ url: '', kind: null });
  const [cardError, setCardError] = useState('');
  const [detailSubmitting, setDetailSubmitting] = useState(false);
  // Which test is being refused, and the reason being typed for it. A refusal opens an inline row
  // rather than a dialog: the coordinator is reading down a list of tests deciding each one, and
  // a modal per refusal loses the list they are working from. Approving stays one click — it is
  // the refusal that has to be explained at the counter later.
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  // The same pair for the claim as a whole, which is a separate decision from any one test.
  const [rejectingClaim, setRejectingClaim] = useState(false);
  const [claimReason, setClaimReason] = useState('');

  // Paged at the server. [1.29.0] The approval worklist showed fifteen and this fetched every
  // claim the clinic has ever filed.
  const fetchRequests = useCallback(async (nextPage = 1) => {
    setLoading(true);
    setLoadError('');
    try {
      const params = { page: nextPage, limit: PAGE_SIZE };
      if (statusFilter !== 'All') params.status = statusFilter;
      const res = await api.get('/hmo/requests', { params });
      const { requests: rows, total: count, totalPages: pages } = res.data.data;
      setRequests(rows || []);
      setTotal(count ?? (rows || []).length);
      setTotalPages(pages || 1);
      setPage(nextPage);
    } catch (err) {
      // Recorded, not just logged: a swallowed failure renders as an empty list.
      console.error('Failed to fetch HMO requests:', err);
      setLoadError(err.response?.data?.message || 'The server did not respond. The list below may be out of date.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const openDetail = async (requestId) => {
    setDetailError('');
    setApprovalCode('');
    setDetailLoading(true);
    setDetailRequest({ id: requestId });
    try {
      const res = await api.get(`/hmo/request/${requestId}`);
      setDetailRequest(res.data.data.request);
    } catch (err) {
      setDetailError(err.response?.data?.message || 'Failed to load request details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (requestId) => {
    const res = await api.get(`/hmo/request/${requestId}`);
    setDetailRequest(res.data.data.request);
    fetchRequests();
  };

  const handleApproveRequest = async (e) => {
    e.preventDefault();
    if (!approvalCode.trim()) {
      setDetailError('An approval/LOA code is required to approve the request.');
      return;
    }
    setDetailSubmitting(true);
    setDetailError('');
    try {
      await api.put(`/hmo/request/${detailRequest.id}/approve`, { approvalCode });
      await refreshDetail(detailRequest.id);
      // The detail panel does re-render with the new status, but this is a three-step handoff —
      // reception raises the claim, an Admin decides it, the cashier bills on the outcome — and
      // the person deciding needs to know the decision was recorded, not just displayed.
      toastSuccess('Claim approved. The cashier will bill against it.');
    } catch (err) {
      setDetailError(err.response?.data?.message || 'Failed to approve request.');
    } finally {
      setDetailSubmitting(false);
    }
  };

  // Turning the whole claim down. [1.28.0] Until now the screen could only say yes, so a claim
  // the provider refused was either approved anyway or left Pending forever.
  const handleRejectRequest = async (e) => {
    e.preventDefault();
    setDetailSubmitting(true);
    setDetailError('');
    try {
      await api.put(`/hmo/request/${detailRequest.id}/reject`, { decisionReason: claimReason.trim() });
      setRejectingClaim(false);
      setClaimReason('');
      await refreshDetail(detailRequest.id);
      toastSuccess('Claim refused, with your reason on the record. The patient will be billed.');
    } catch (err) {
      setDetailError(err.response?.data?.message || 'Failed to record the refusal.');
    } finally {
      setDetailSubmitting(false);
    }
  };

  const handleSetTestApproval = async (hmoRequestTestId, approvalStatus, decisionReason = null) => {
    setDetailError('');
    try {
      await api.put(`/hmo/request-test/${hmoRequestTestId}`, { approvalStatus, decisionReason });
      setRejecting(null);
      setRejectReason('');
      await refreshDetail(detailRequest.id);
      toastSuccess(
        approvalStatus === 'Approved'
          ? 'Test approved on this claim.'
          : 'Test refused, with your reason on the record.'
      );
    } catch (err) {
      setDetailError(err.response?.data?.message || 'Failed to update test approval.');
    }
  };

  // `requests` IS the page — the server sent exactly these rows.
  const pagedRequests = requests;

  // The card image behind the claim. Fetched as a blob rather than pointed at with an <img src>,
  // because the route requires a bearer token that a plain browser image request cannot send —
  // the same reason ClientDashboard downloads results this way.
  //
  // The kind is read off the blob rather than assumed, because a card may be a PDF: reception
  // scans arrive that way and the upload allowlist accepts them. Rendering one in an <img> gives
  // Admin a broken-image icon under the heading "HMO Card" and no way to tell that apart from a
  // claim filed without evidence — on the screen where they are about to approve coverage.
  useEffect(() => {
    let revoked = false;
    let objectUrl = '';
    setCard({ url: '', kind: null });
    setCardError('');

    if (!detailRequest?.id || !detailRequest?.card_file_path) return undefined;

    (async () => {
      try {
        const res = await api.get(`/hmo/request/${detailRequest.id}/card`, { responseType: 'blob' });
        if (revoked) return;
        objectUrl = URL.createObjectURL(res.data);
        setCard({ url: objectUrl, kind: previewKindFor(res.data?.type) });
      } catch (err) {
        if (!revoked) setCardError(err.response?.status === 410
          ? 'This card image was removed under the retention policy.'
          : 'The card image could not be loaded.');
      }
    })();

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [detailRequest?.id, detailRequest?.card_file_path]);

  // Reception logs a claim and an Admin decides it — two people, two screens, and this
  // one used to fetch once and then sit. An admin who left it open after lunch was
  // reading a queue as it stood before lunch, with nothing on screen to say so.
  const updatedAt = useFreshness(loading, loadError);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oversight"
        icon={ShieldCheck}
        title="Service & HMO Requests"
        description="Review and approve HMO pre-authorisation logged by Reception. Approval is Admin-only — Reception can log a request but not clear it."
        meta={(loadError || loading)
          ? undefined
          : <span><strong className="font-semibold text-slate-700">{total}</strong> request{total === 1 ? '' : 's'}</span>}
        actions={
          <RefreshButton
            onRefresh={() => fetchRequests(page)}
            loading={loading}
            updatedAt={updatedAt}
          />
        }
      />

      <div>
        <Toolbar attached>
          <SegmentedFilter
            ariaLabel="Filter HMO requests by status"
            options={STATUS_FILTERS.map(s => ({ value: s, label: s }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </Toolbar>

        <Panel className="overflow-hidden rounded-t-none">
          <PanelBody flush>
            <Table>
              <TableHeader sticky>
                <TableRow>
                  {/* Patient first. It is the only thing that distinguishes one row from the
                      next — seven claims from the same provider on the same day were seven
                      identical rows, and the only way to learn whose insurance you were about to
                      approve was to open each one in turn. */}
                  <TableHead>Patient</TableHead>
                  <TableHead>Provider &amp; member</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Tests decided</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Error before empty. A failed fetch used to fall through to the empty branch,
                    so a 500 rendered as "nothing here yet" — which is a false statement about the
                    clinic's data, not merely an unhelpful one. */}
                {loadError ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        tone="error"
                        title="Could not load the HMO requests"
                        description={loadError}
                        action={<Button variant="outline" size="sm" onClick={() => fetchRequests()}>Try again</Button>}
                      />
                    </TableCell>
                  </TableRow>
                ) : loading ? (
                  <SkeletonRows rows={5} columns={5} />
                ) : pagedRequests.length > 0 ? (
                  pagedRequests.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <span className="block font-semibold text-slate-900">
                          {r.patient_first_name ? `${r.patient_first_name} ${r.patient_last_name}` : 'Unlinked claim'}
                        </span>
                        {r.queue_number && (
                          <span className="text-fine tabular-nums text-slate-500">Ticket {r.queue_number}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="block text-slate-700">{r.provider_name}</span>
                        {r.member_number && (
                          <span className="text-fine tabular-nums text-slate-500">{r.member_number}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-500">{new Date(r.request_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</TableCell>
                      {/* Approved AND refused, not just approved. "1 / 2" left the reader unable to
                          tell a claim half-decided from one where the other half was turned down. */}
                      <TableCell className="font-medium tabular-nums">
                        <span className="text-emerald-700">{r.approved_test_count}</span>
                        {parseInt(r.rejected_test_count, 10) > 0 && (
                          <>
                            <span className="text-slate-300"> / </span>
                            <span className="text-rose-700">{r.rejected_test_count} refused</span>
                          </>
                        )}
                        <span className="text-slate-400"> of {r.test_count}</span>
                      </TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-right">
                        <Button onClick={() => openDetail(r.id)} variant="outline" size="xs">
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        icon={ShieldCheck}
                        title={statusFilter === 'All' ? 'No HMO requests logged' : `Nothing is ${statusFilter.toLowerCase()}`}
                        description="Reception logs a pre-authorisation against a visit; it appears here for approval."
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </PanelBody>
          <Pagination page={page} totalPages={totalPages} onPageChange={fetchRequests} total={loadError ? 0 : total} pageSize={PAGE_SIZE} />
        </Panel>
      </div>

      <Dialog open={!!detailRequest} onOpenChange={(open) => { if (!open) setDetailRequest(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>HMO Request Review</DialogTitle>
            <DialogDescription>
              {detailRequest?.patient_first_name
                ? `${detailRequest.patient_first_name} ${detailRequest.patient_last_name} — ${detailRequest.provider_name}`
                : detailRequest?.provider_name}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <SkeletonList rows={3} />
          ) : (
            <div className="space-y-4">
              {detailError && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle />
                  <span>{detailError}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-fine font-medium text-slate-500">Request Status</span>
                <StatusBadge status={detailRequest?.status} />
              </div>

              {/* The doctor the LOA is issued against. Mandatory on a claim, so its absence here
                  means an older claim filed before the rule — worth showing as such rather than
                  leaving Admin to wonder whether the screen simply does not display it. */}
              <div className="flex items-start justify-between gap-4">
                <span className="text-fine font-medium text-slate-500">Referring Physician</span>
                <span className="text-right text-fine">
                  {detailRequest?.referring_physician ? (
                    <>
                      <span className="block font-semibold text-slate-900">{detailRequest.referring_physician}</span>
                      {detailRequest.referring_physician_prc && (
                        <span className="block text-micro text-slate-500">
                          PRC {detailRequest.referring_physician_prc}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-500">Not recorded — this claim predates the requirement.</span>
                  )}
                </span>
              </div>

              {/* The evidence the claim rests on. A client booking online must attach a photo of
                  their card; a receptionist filing at the desk is recorded as having seen the
                  physical card instead. Approving without being able to see either would make
                  the requirement pointless. */}
              <div className="space-y-1.5">
                <span className="text-fine font-medium text-slate-500">HMO Card</span>

                {card.url && card.kind === 'image' && (
                  <a href={card.url} target="_blank" rel="noopener noreferrer" className="block">
                    <img
                      src={card.url}
                      alt="Photo of the patient's HMO card"
                      className="max-h-56 w-full rounded-xl border border-line bg-sunken object-contain"
                    />
                    <span className="text-micro font-semibold text-brand-700">Open full size</span>
                  </a>
                )}

                {card.url && card.kind === 'pdf' && (
                  canRenderPdfInline() ? (
                    <>
                      <iframe
                        title="Scan of the patient's HMO card"
                        src={card.url}
                        className="h-56 w-full rounded-xl border border-line bg-surface"
                      />
                      <a href={card.url} target="_blank" rel="noopener noreferrer" className="text-micro font-semibold text-brand-700">
                        Open full size
                      </a>
                    </>
                  ) : (
                    <p className="m-0 text-fine text-slate-600">
                      The card is a PDF and this browser has no viewer for it.{' '}
                      <a href={card.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700">
                        Open it in a new tab
                      </a>{' '}
                      to review the claim.
                    </p>
                  )
                )}

                {card.url && !card.kind && (
                  <p className="m-0 text-fine text-slate-600">
                    The attached file is not a format this page can display.{' '}
                    <a href={card.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700">
                      Open it in a new tab
                    </a>.
                  </p>
                )}

                {cardError && (
                  <div role="alert" className="alert alert-warning">
                    <AlertCircle />
                    <span>{cardError}</span>
                  </div>
                )}

                {!detailRequest?.card_file_path && !cardError && (
                  <p className="m-0 text-fine text-slate-600">
                    {detailRequest?.card_verified_by
                      ? 'No image — the physical card was confirmed at the front desk.'
                      : detailRequest?.card_purged_at
                        ? 'The card image was removed under the retention policy.'
                        : 'No card on file.'}
                  </p>
                )}
              </div>

              {/* The decision. [1.28.0] This used to be an approve-only form, and it appeared for
                  any claim that was not already Approved — so a refused one still offered an
                  Approve button and nothing else, which is how a refusal gets recorded as an
                  approval. Undecided claims get both actions; decided ones get the record. */}
              {detailRequest?.status === 'Pending' ? (
                <div className="rounded-xl border border-line bg-slate-50/80 p-3 space-y-2.5">
                  <div>
                    <span className="field-label">Record the provider&apos;s decision</span>
                    <p className="m-0 text-fine text-slate-500">
                      The cashier is notified either way — they cannot settle this bill until you decide.
                    </p>
                  </div>

                  {!rejectingClaim ? (
                    <>
                      <form onSubmit={handleApproveRequest} className="space-y-1.5">
                        <label htmlFor="loa-code" className="field-label">Approval / LOA code</label>
                        <div className="flex gap-2">
                          <Input
                            id="loa-code"
                            placeholder="e.g. LOA-2026-00481"
                            value={approvalCode}
                            onChange={e => setApprovalCode(e.target.value)}
                            disabled={detailSubmitting}
                          />
                          <Button type="submit" disabled={detailSubmitting || !approvalCode.trim()}>
                            {detailSubmitting ? 'Approving…' : 'Approve'}
                          </Button>
                        </div>
                      </form>
                      <button
                        type="button"
                        onClick={() => { setRejectingClaim(true); setClaimReason(''); }}
                        className="cursor-pointer border-0 bg-transparent p-0 text-fine font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-800"
                      >
                        The provider turned this claim down
                      </button>
                    </>
                  ) : (
                    /* Secondary until chosen, then it owns the panel — a refusal is the rarer
                       outcome, but once it is what happened it is the only thing being recorded. */
                    <form onSubmit={handleRejectRequest} className="space-y-1.5">
                      <label htmlFor="claim-reason" className="field-label">
                        Why did they refuse it? <span className="text-rose-600">*</span>
                      </label>
                      <Input
                        id="claim-reason"
                        autoFocus
                        placeholder="e.g. Member's policy lapsed on 01 Aug"
                        value={claimReason}
                        onChange={e => setClaimReason(e.target.value)}
                        disabled={detailSubmitting}
                      />
                      <p className="m-0 text-fine text-slate-500">
                        The patient pays in full. This reason is what the cashier tells them.
                      </p>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button" variant="outline" size="sm"
                          onClick={() => { setRejectingClaim(false); setClaimReason(''); }}
                          disabled={detailSubmitting}
                        >
                          Back
                        </Button>
                        <Button type="submit" size="sm" disabled={detailSubmitting || claimReason.trim().length < 4}>
                          {detailSubmitting ? 'Recording…' : 'Record refusal'}
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                <div
                  className={`rounded-xl border p-3 text-xs ${
                    detailRequest?.status === 'Approved'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-line bg-slate-50/80 text-slate-700'
                  }`}
                >
                  <p className="m-0 font-semibold">
                    {detailRequest?.status === 'Approved'
                      ? `Approved${detailRequest?.approval_code ? ` — LOA ${detailRequest.approval_code}` : ''}`
                      : `${detailRequest?.status}${detailRequest?.decision_reason ? ` — ${detailRequest.decision_reason}` : ''}`}
                  </p>
                  {detailRequest?.decided_by_first_name && (
                    <p className="m-0 mt-0.5 text-fine opacity-80">
                      Recorded by {detailRequest.decided_by_first_name} {detailRequest.decided_by_last_name}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <span className="field-label">Linked Tests</span>
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {(detailRequest?.tests || []).map(t => (
                    <div key={t.id} className="rounded-lg border border-line p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="block truncate text-note font-semibold text-slate-900">{t.test_name}</span>
                          <span className="text-fine text-slate-500">{t.category_name} &bull; {formatCurrency(t.price_at_time)}</span>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1">
                          <StatusBadge status={t.approval_status} />
                          {t.approval_status !== 'Approved' && (
                            <button
                              type="button"
                              onClick={() => handleSetTestApproval(t.id, 'Approved')}
                              aria-label={`Approve ${t.test_name}`}
                              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-emerald-600 hover:bg-emerald-50"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {t.approval_status !== 'Rejected' && (
                            <button
                              type="button"
                              onClick={() => { setRejecting(t.id); setRejectReason(''); }}
                              aria-label={`Reject ${t.test_name}`}
                              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-rose-600 hover:bg-rose-50"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Why the HMO refused. Asked at the moment of refusal, because it is the
                          one moment the coordinator still has the provider's response in front of
                          them — an hour later it is a guess. */}
                      {rejecting === t.id && (
                        <div className="mt-2 space-y-1.5 border-t border-line pt-2">
                          <label htmlFor={`reject-reason-${t.id}`} className="field-label">
                            Why did the HMO refuse this? <span className="text-rose-600">*</span>
                          </label>
                          <Input
                            id={`reject-reason-${t.id}`}
                            autoFocus
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            placeholder="e.g. Not covered under the member's plan"
                            className="text-xs rounded-lg"
                          />
                          <p className="text-fine text-slate-500 m-0">
                            The cashier sees this on the bill — the patient is charged for this test
                            and will ask why.
                          </p>
                          <div className="flex justify-end gap-1.5">
                            <Button
                              type="button" variant="outline" size="sm"
                              onClick={() => { setRejecting(null); setRejectReason(''); }}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button" size="sm"
                              disabled={rejectReason.trim().length < 4}
                              onClick={() => handleSetTestApproval(t.id, 'Rejected', rejectReason.trim())}
                            >
                              Record refusal
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* What was recorded, once it has been. Shown on the row rather than behind a
                          hover, because whoever opens this claim next is usually opening it to
                          answer exactly this question. */}
                      {t.approval_status === 'Rejected' && rejecting !== t.id && t.decision_reason && (
                        <p className="mt-1.5 border-t border-line pt-1.5 text-fine text-slate-600 m-0">
                          <span className="font-semibold text-slate-700">Refused:</span> {t.decision_reason}
                          {t.decided_by_first_name && (
                            <span className="text-slate-400">
                              {' '}&bull; recorded by {t.decided_by_first_name} {t.decided_by_last_name}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ServiceRequests;
