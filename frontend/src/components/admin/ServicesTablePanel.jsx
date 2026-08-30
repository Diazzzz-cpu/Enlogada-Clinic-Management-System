import React from 'react';
import LoadingState from '../ui/loading-state';
import { Edit2, Info, Layers, Plus } from 'lucide-react';
import { Panel, PanelBody } from '../ui/panel';
import Toolbar, { ToolbarSpacer } from '../ui/toolbar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { formatCurrency } from '../../lib/currency';
import EmptyState from '../ui/empty-state';
import Pagination from '../ui/pagination';

/**
 * Every service the clinic sells, its price, and the filter over them.
 *
 * Lifted out of ServicesCatalog, which held the service list, the provider list and their four
 * dialogs in one 688-line file.
 * 
 * The category counts sit inside the filter control rather than in a KPI row above it: "how
 * many Ultrasound services do we offer" and "show me the Ultrasound services" are the same
 * question, so they belong on the same element.
 */
export default function ServicesTablePanel({ catalogue }) {
  return (
      <div>
        {/* Category filter. The counts live in the control rather than in a separate KPI row:
            "how many Ultrasound services do we offer" and "show me the Ultrasound services"
            are the same question, so they belong on the same element. */}
        <Toolbar attached>
          <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
        <button
          onClick={() => catalogue.setFilterCategory('all')}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border-0 px-2.5 py-1.5 text-fine font-semibold transition-colors ${
            catalogue.filterCategory === 'all'
              ? 'bg-surface text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]'
              : 'bg-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          All Categories
          <span className={`rounded px-1 py-px text-micro font-bold tabular-nums ${catalogue.filterCategory === 'all' ? 'bg-brand-100 text-brand-700' : 'bg-slate-200/80 text-slate-600'}`}>
            {catalogue.tests.length}
          </span>
        </button>
        {catalogue.categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => catalogue.setFilterCategory(cat.id.toString())}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border-0 px-2.5 py-1.5 text-fine font-semibold transition-colors ${
              catalogue.filterCategory === cat.id.toString()
                ? 'bg-surface text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]'
                : 'bg-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {cat.name}
            <span className={`rounded px-1 py-px text-micro font-bold tabular-nums ${catalogue.filterCategory === cat.id.toString() ? 'bg-brand-100 text-brand-700' : 'bg-slate-200/80 text-slate-600'}`}>
              {catalogue.tests.filter(t => t.category_id === cat.id).length}
            </span>
          </button>
        ))}
          </div>
          <ToolbarSpacer />
          <span className="whitespace-nowrap text-fine font-medium tabular-nums text-slate-500">
            {catalogue.filtered.length} shown
          </span>
        </Toolbar>

      {/* Services Table */}
      <Panel className="overflow-hidden rounded-t-none">
        <PanelBody flush>
          {catalogue.error ? (
            <EmptyState
              tone="error"
              title="Could not load the services catalogue"
              description={catalogue.error}
              action={<Button variant="outline" size="sm" onClick={catalogue.reload}>Try again</Button>}
            />
          ) : catalogue.loading ? (
            <LoadingState size="lg" label="Loading the catalogue…" />
          ) : catalogue.filtered.length === 0 ? (
            /* The last two bare grey lines in the app — the exact "centred line of small italic
               grey text" that empty-state.jsx was written to replace, and it said "in this
               category" even when the filter was All. Filter-aware now, so a genuinely empty
               catalogue and a category nobody has added a service to read differently. */
            <EmptyState
              icon={Layers}
              title={catalogue.filterCategory === 'all' ? 'No services in the catalogue yet' : 'Nothing in this category yet'}
              description={catalogue.filterCategory === 'all'
                ? 'Add the first service — it appears on the public website and in the booking form immediately.'
                : 'Pick another category above, or add a service to this one.'}
              action={<Button size="sm" onClick={catalogue.openAdd}><Plus className="h-3.5 w-3.5" />Add New Service</Button>}
            />
          ) : (
            <Table data-testid="services-table">
              <TableHeader className="bg-slate-50/70">
                <TableRow>
                  <TableHead className="text-xs font-bold uppercase">ID</TableHead>
                  <TableHead className="text-xs font-bold uppercase">Service Name</TableHead>
                  <TableHead className="text-xs font-bold uppercase">Category</TableHead>
                  <TableHead className="text-xs font-bold uppercase">Price (PHP)</TableHead>
                  <TableHead className="text-xs font-bold uppercase">Status</TableHead>
                  <TableHead className="text-xs font-bold uppercase text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogue.paged.map(test => (
                  <TableRow key={test.id}>
                    <TableCell className="font-bold text-xs text-slate-900">SRV-{test.id}</TableCell>
                    {/* Whether this service tells the patient how to prepare. [1.24.0] added
                        `tests.preparation` and every patient-facing screen reads it, but this
                        screen — the one where it is written — gave no sign of which services
                        had it. Finding the gaps meant opening all fifteen in turn, so in
                        practice nobody did, and a Fasting Blood Sugar with no instruction looks
                        exactly like one that needs none. Shown truncated: the point is to see
                        at a glance which rows are blank. */}
                    <TableCell className="font-semibold text-xs text-slate-800">
                      {test.name}
                      {test.preparation && (
                        <span
                          className="mt-0.5 flex items-start gap-1 text-fine font-normal text-slate-500"
                          title={test.preparation}
                        >
                          <Info className="mt-px h-3 w-3 flex-shrink-0 text-brand-600" />
                          <span className="line-clamp-1">{test.preparation}</span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-gray-600 font-medium">{test.category_name}</TableCell>
                    <TableCell className="font-bold text-xs text-slate-900">{formatCurrency(test.price)}</TableCell>
                    <TableCell>
                      <Badge
                        onClick={() => catalogue.requestToggle(test)}
                        className={`cursor-pointer text-meta font-bold px-2.5 py-0.5 rounded-full ${
                          test.is_active
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200'
                            : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        {test.is_active ? 'Active (Live)' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => catalogue.openEdit(test)}
                        className="h-8 text-xs font-bold flex items-center space-x-1.5 ml-auto"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
        {/* Only once there is more than one page — a control that can never do anything is noise
            on a catalogue the clinic may only have a dozen rows in. */}
        {!catalogue.loading && !catalogue.error && catalogue.totalPages > 1 && (
          <Pagination
            page={catalogue.page}
            totalPages={catalogue.totalPages}
            onPageChange={catalogue.setPage}
            total={catalogue.filtered.length}
            totalLabel="services"
            className="border-t border-line px-4 py-2.5"
          />
        )}
      </Panel>
      </div>
  );
}
