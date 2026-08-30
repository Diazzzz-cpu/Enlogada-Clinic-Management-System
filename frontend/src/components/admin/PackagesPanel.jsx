import React from 'react';
import LoadingState from '../ui/loading-state';
import { Edit2, Plus, Package } from 'lucide-react';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import EmptyState from '../ui/empty-state';
import RefreshButton from '../ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';
import { formatCurrency } from '../../lib/currency';

/**
 * The clinic's package deals, and what is in them.
 *
 * The saving column is the one worth having. A package is only a package if it comes in under the
 * cost of buying its components one at a time, and that is not visible until something totals it —
 * four of the five real bundles read as *surcharges* when HIV Screening was loaded without a price,
 * and nobody would have noticed from the price alone.
 */
export default function PackagesPanel({ packageAdmin }) {
  const updatedAt = useFreshness(packageAdmin.loading, packageAdmin.error);
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Package Deals"
        description="Fixed-price bundles. A patient pays the package price, not the sum of the tests inside it."
        icon={Package}
        actions={
          <>
            <RefreshButton compact onRefresh={packageAdmin.reload} loading={packageAdmin.loading} updatedAt={updatedAt} />
            <Button size="sm" onClick={packageAdmin.openAdd}>
              <Plus className="h-3.5 w-3.5" />
              Add Package
            </Button>
          </>
        }
      />
      <PanelBody flush>
        {packageAdmin.error ? (
          <EmptyState
            tone="error"
            compact
            title="Could not load package deals"
            description={packageAdmin.error}
            action={<Button variant="outline" size="sm" onClick={packageAdmin.reload}>Try again</Button>}
          />
        ) : packageAdmin.loading ? (
          <LoadingState label="Loading packages…" />
        ) : packageAdmin.packages.length === 0 ? (
          <EmptyState
            compact
            title="No package deals yet"
            description="A package bundles tests from more than one department at a single price."
            action={<Button size="sm" onClick={packageAdmin.openAdd}>Add the first one</Button>}
          />
        ) : (
          <div className="relative w-full overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Includes</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Patient saves</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packageAdmin.packages.map((pkg) => {
                  const listTotal = (pkg.tests || []).reduce((sum, t) => sum + Number(t.price || 0), 0);
                  const saving = listTotal - Number(pkg.price);
                  return (
                    <TableRow key={pkg.id}>
                      <TableCell>
                        <span className="block font-semibold text-slate-900">{pkg.name}</span>
                        <span className="block text-meta uppercase tracking-[0.08em] text-slate-400">
                          {pkg.code}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[22rem]">
                        <span className="block text-fine leading-relaxed text-slate-600">
                          {(pkg.tests || []).map((t) => t.name).join(', ') || '— nothing yet'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums text-slate-900">
                        {formatCurrency(pkg.price)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {/* A bundle that costs MORE than its parts is stated plainly rather than
                            shown as a negative saving, which reads as a discount at a glance. */}
                        {saving > 0 ? (
                          <span className="font-semibold text-brand-700">{formatCurrency(saving)}</span>
                        ) : (
                          <span className="font-semibold text-rose-600">
                            {formatCurrency(-saving)} more
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => packageAdmin.askToggle(pkg)}
                          className="cursor-pointer border-0 bg-transparent p-0"
                        >
                          <Badge variant={pkg.isActive ? 'default' : 'secondary'}>
                            {pkg.isActive ? 'Offered' : 'Retired'}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => packageAdmin.openEdit(pkg)}>
                          <Edit2 className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
