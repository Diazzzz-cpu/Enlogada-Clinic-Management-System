import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';

/**
 * Adding or renaming an HMO provider.
 *
 * Lifted out of ServicesCatalog, which held the service list, the provider list and their
 * four dialogs in one 688-line file.
 */
export default function HmoProviderFormDialog({ hmoAdmin }) {
  return (
      <Dialog open={hmoAdmin.showModal} onOpenChange={(open) => { if (!open) hmoAdmin.closeModal(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {hmoAdmin.editing ? 'Rename HMO Provider' : 'Add HMO Provider'}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              {hmoAdmin.editing ? 'Update this provider\'s name.' : 'Add a new accredited HMO partner.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={hmoAdmin.save} className="space-y-4 pt-2">
            {hmoAdmin.modalError && (
              <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 flex items-center space-x-2 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{hmoAdmin.modalError}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="servicescatalog-provider-name" className="text-xs font-semibold text-gray-700">Provider Name</label>
              <Input id="servicescatalog-provider-name"
                type="text"
                placeholder="e.g. Maxicare"
                value={hmoAdmin.name}
                onChange={e => hmoAdmin.setName(e.target.value)}
                className="rounded-xl"
                required
                autoFocus
              />
            </div>
            <div className="flex justify-end space-x-2 pt-3 border-t border-line">
              <Button type="button" variant="outline" onClick={hmoAdmin.closeModal}>Cancel</Button>
              <Button type="submit" disabled={hmoAdmin.submitting} className="bg-primary hover:bg-primary-hover text-primary-foreground">
                {hmoAdmin.submitting ? 'Saving…' : hmoAdmin.editing ? 'Save Changes' : 'Add Provider'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
  );
}
