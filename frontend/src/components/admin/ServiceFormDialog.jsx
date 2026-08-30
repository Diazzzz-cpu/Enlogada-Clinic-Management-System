import React from 'react';
import PreparationField from './PreparationField';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

/**
 * Adding or editing a service.
 *
 * Lifted out of ServicesCatalog, which held the service list, the provider list and their
 * four dialogs in one 688-line file.
 * 
 * The preparation field is the point of this form as much as the price: it is the sentence
 * the day-before reminder carries, and the only place anyone can write it.
 */
export default function ServiceFormDialog({ catalogue }) {
  return (
      <Dialog open={catalogue.showModal} onOpenChange={(open) => { if (!open) catalogue.closeModal(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900">
              {catalogue.editingTest ? 'Edit Diagnostic Service' : 'Add New Diagnostic Service'}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              {catalogue.editingTest
                ? 'Update service details and price. Changes will take effect immediately.'
                : 'Add a new service to the clinic catalog and public website.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={catalogue.save} className="space-y-4 pt-2">
            {catalogue.modalError && (
              <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 flex items-center space-x-2 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{catalogue.modalError}</span>
              </div>
            )}

            {catalogue.modalSuccess && (
              <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl p-3 flex items-center space-x-2 text-xs">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{catalogue.modalSuccess}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700" htmlFor="servicescatalog-diagnostic-category">Diagnostic Category</label>
              <Select
                value={catalogue.form.categoryId}
                onValueChange={val => catalogue.setForm({...catalogue.form, categoryId: val})}
              >
                <SelectTrigger className="rounded-xl" id="servicescatalog-diagnostic-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {catalogue.categories.map(cat => (
                    <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="servicescatalog-service-name" className="text-xs font-semibold text-gray-700">Service Name</label>
              <Input id="servicescatalog-service-name"
                type="text"
                placeholder="e.g. Abdominal Ultrasound"
                value={catalogue.form.name}
                onChange={e => catalogue.setForm({...catalogue.form, name: e.target.value})}
                className="rounded-xl"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="servicescatalog-price-php" className="text-xs font-semibold text-gray-700">Price (PHP ₱)</label>
              <Input id="servicescatalog-price-php"
                type="number"
                step="0.01"
                placeholder="e.g. 1500.00"
                value={catalogue.form.price}
                onChange={e => catalogue.setForm({...catalogue.form, price: e.target.value})}
                className="rounded-xl"
                required
              />
            </div>

            {/* [1.24.0] The one field that stops a wasted trip. It reaches the patient in the
                booking confirmation email and while they are choosing tests, so it is written
                to them directly — "Nothing to eat…", not "Patient must fast". */}
            <PreparationField
              value={catalogue.form.preparation}
              onChange={(next) => catalogue.setForm({ ...catalogue.form, preparation: next })}
            />

            {catalogue.editingTest && (
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={catalogue.form.isActive}
                  onChange={e => catalogue.setForm({...catalogue.form, isActive: e.target.checked})}
                  className="rounded text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="isActive" className="text-xs font-semibold text-gray-700 cursor-pointer">
                  Active Service (Visible on website & patient booking)
                </label>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-3 border-t border-line">
              <Button type="button" variant="outline" onClick={catalogue.closeModal}>Cancel</Button>
              <Button
                type="submit"
                disabled={catalogue.submitting}
                className="bg-brand-500 hover:bg-primary-hover text-white"
              >
                {catalogue.submitting ? 'Saving…' : catalogue.editingTest ? 'Update Service' : 'Add Service'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
  );
}
