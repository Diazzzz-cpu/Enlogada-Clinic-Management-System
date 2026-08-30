import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { AlertCircle } from 'lucide-react';
import { formatCurrency } from '../../lib/currency';

/**
 * Creating or editing a package deal.
 *
 * The component list is grouped by department, because that is the thing a package is FOR — a
 * bundle that never leaves one department could have been a single test, and the grid makes it
 * obvious at a glance which departments a bundle actually spans.
 *
 * The running comparison at the bottom is the part that earns its place. A package priced above
 * the sum of its components is a surcharge, and the only way to see that is to total them while
 * the price is being typed.
 */
export default function PackageFormDialog({ packageAdmin }) {
  const { form, tests, listTotal, editing, submitting, modalError } = packageAdmin;

  const grouped = useMemo(() => {
    const byCategory = new Map();
    for (const t of tests) {
      const key = t.category_name || 'Other';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(t);
    }
    return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tests]);

  const price = Number(form.price || 0);
  const saving = listTotal - price;

  return (
    <Dialog open={packageAdmin.showModal} onOpenChange={(open) => { if (!open) packageAdmin.close(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : 'New Package Deal'}</DialogTitle>
          <DialogDescription>
            A fixed price for a set of tests. The patient pays this figure, not the sum of the parts,
            and the amount is spread across the components so each department is credited its share.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={packageAdmin.submit} className="space-y-4">
          {modalError && (
            <div role="alert" className="alert alert-error">
              <AlertCircle />
              <span>{modalError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[7rem_1fr_9rem]">
            <div>
              <label htmlFor="pkg-code" className="field-label">Code</label>
              <Input
                id="pkg-code"
                value={form.code}
                onChange={(e) => packageAdmin.setField('code', e.target.value)}
                placeholder="A"
                maxLength={20}
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="pkg-name" className="field-label">Name</label>
              <Input
                id="pkg-name"
                value={form.name}
                onChange={(e) => packageAdmin.setField('name', e.target.value)}
                placeholder="Package A"
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="pkg-price" className="field-label">Price</label>
              <Input
                id="pkg-price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => packageAdmin.setField('price', e.target.value)}
                placeholder="1450.00"
                disabled={submitting}
              />
            </div>
          </div>

          <div>
            <label htmlFor="pkg-desc" className="field-label">Description <span className="font-normal text-slate-400">(optional)</span></label>
            <Textarea
              id="pkg-desc"
              rows={2}
              value={form.description}
              onChange={(e) => packageAdmin.setField('description', e.target.value)}
              placeholder="Who this package is for, if it needs saying."
              disabled={submitting}
            />
          </div>

          <div>
            <span className="field-label">Tests included</span>
            <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-line bg-slate-50/70 p-3">
              {grouped.map(([category, items]) => (
                <div key={category} className="space-y-1">
                  <p className="m-0 px-1 text-micro font-semibold uppercase tracking-[0.08em] text-slate-500">
                    {category}
                  </p>
                  {items.map((t) => (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface p-2 transition-colors hover:border-azure-300"
                    >
                      <input
                        type="checkbox"
                        checked={form.testIds.includes(String(t.id))}
                        onChange={() => packageAdmin.toggleTest(String(t.id))}
                        disabled={submitting}
                        className="rounded text-azure-600 focus:ring-azure-500"
                      />
                      <span className="flex flex-1 items-center justify-between gap-2">
                        <span className="text-fine font-semibold text-slate-800">{t.name}</span>
                        <span className="text-fine font-bold tabular-nums text-slate-500">
                          {formatCurrency(t.price)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* The check that matters, live while the price is being typed. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sunken px-3 py-2.5">
            <span className="text-fine text-slate-500">
              {form.testIds.length} test{form.testIds.length === 1 ? '' : 's'} · individually{' '}
              <strong className="tabular-nums text-slate-700">{formatCurrency(listTotal)}</strong>
            </span>
            {form.testIds.length > 0 && price > 0 && (
              saving > 0 ? (
                <span className="text-note font-semibold text-brand-700">
                  Patient saves {formatCurrency(saving)}
                </span>
              ) : (
                <span className="text-note font-semibold text-rose-600">
                  {formatCurrency(-saving)} MORE than buying separately
                </span>
              )
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={packageAdmin.close} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {editing ? 'Save changes' : 'Create package'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
