import React from 'react';
import { ArrowUpDown, Inbox, Receipt } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel, PanelHeader } from '../ui/panel';
import EmptyState from '../ui/empty-state';
import { Badge } from '../ui/badge';
import { SearchInput } from '../ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import WaitBadge from '../ui/wait-badge';
import { SkeletonList } from '../ui/skeleton';
import DataBadge from '../ui/data-badge';

/**
 * Tickets waiting to be charged, and picking one up.
 *
 * Lifted out of CashierDashboard, which rendered the whole till, the queue beside it and
 * the transaction log from one 971-line file. The props are the hooks this piece reads —
 * listed rather than reached for, so its dependencies are visible at the top.
 */
export default function BillingQueuePanel({ queue, checkout }) {
  return (
        <div className="lg:col-span-5">
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Pending Billing Queue"
              icon={Receipt}
              actions={
                <Badge variant="outline" className="border-brand-200 bg-brand-50 text-brand-700">
                  {queue.visits.length} waiting
                </Badge>
              }
            />

            {/* Filters sit in a sunken well rather than loose in the panel body, so the list
                below reads as the panel's content and these read as controls over it. */}
            <div className="space-y-2 border-b border-line bg-slate-50/70 p-3">
              <SearchInput
                placeholder="Search ticket # or name..."
                value={queue.searchQuery}
                onChange={e => queue.setSearchQuery(e.target.value)}
              />

              <div className="flex items-center gap-2">
                <Select value={queue.typeFilter} onValueChange={queue.setTypeFilter}>
                  <SelectTrigger className="flex-1" aria-label="Filter the billing queue by patient type">
                    <SelectValue placeholder="Patient Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Types</SelectItem>
                    {queue.patientTypes.map(t => (
                      <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => queue.setSortOrder(o => (o === 'oldest' ? 'newest' : 'oldest'))}
                  title="Toggle sort order"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  {queue.sortOrder === 'oldest' ? 'Oldest first' : 'Newest first'}
                </Button>
              </div>
            </div>

            <div className="max-h-[520px] space-y-2 overflow-y-auto p-3">
              {queue.loading ? (
                <SkeletonList rows={4} />
              ) : queue.visits.length > 0 ? (
                queue.visits.map(visit => {
                  const isSelected = checkout.selectedVisit?.id === visit.id;
                  return (
                    // A button, not a div with onClick. This is how a cashier picks the visit
                    // they are about to take money for; it has to be reachable by keyboard and
                    // announce its selected state.
                    <button
                      key={visit.id}
                      type="button"
                      onClick={() => checkout.select(visit)}
                      aria-pressed={isSelected}
                      className={`w-full cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                        isSelected
                          ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-400'
                          : 'border-line bg-surface hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-note font-semibold text-slate-900">{visit.first_name} {visit.last_name}</span>
                          <DataBadge variant="patient" label="Queue ticket" className="block">{visit.queue_number || `V-${visit.id}`}</DataBadge>
                        </span>
                        <span className="flex flex-shrink-0 flex-col items-end gap-1">
                          <span className="flex items-center gap-1">
                            <Badge variant="outline" className={visit.visit_type === 'Walk in' ? 'text-slate-600' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}>
                              {visit.visit_type}
                            </Badge>
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                              {visit.patient_type_name || 'Self Pay'}
                            </Badge>
                          </span>
                          <WaitBadge since={visit.created_at} />
                        </span>
                      </span>
                      <span className="mt-2 flex items-center justify-between border-t border-line-soft pt-2 text-fine">
                        <span className="text-slate-500">{visit.tests?.length || 0} diagnostic item{visit.tests?.length === 1 ? '' : 's'}</span>
                        <span className={`font-semibold ${isSelected ? 'text-brand-700' : 'text-slate-400'}`}>
                          {isSelected ? 'Open in terminal' : 'Select for checkout →'}
                        </span>
                      </span>
                    </button>
                  );
                })
              ) : (
                /* "Nothing awaiting payment" is false when seven people are waiting and the
                   search simply matched none of them — and it sends the cashier looking for
                   Reception instead of clearing their own filter. The two situations get
                   different words, as they do on every other queue in the app. */
                <EmptyState
                  compact
                  icon={Inbox}
                  title={(queue.searchQuery || queue.typeFilter !== 'All') ? 'No tickets match this filter' : 'Nothing awaiting payment'}
                  description={(queue.searchQuery || queue.typeFilter !== 'All')
                    ? 'Clear the search or choose All Types to see the whole queue.'
                    : 'Visits appear here once Reception attaches tests to them.'}
                />
              )}
            </div>
          </Panel>
        </div>
  );
}
