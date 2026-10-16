import React from 'react';
import LoadingState from '../ui/loading-state';
import { Edit2, Plus, ShieldPlus } from 'lucide-react';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import EmptyState from '../ui/empty-state';
/**
 * The HMO providers the clinic is accredited with.
 *
 * Lifted out of ServicesCatalog, which held the service list, the provider list and their
 * four dialogs in one 688-line file. That screen's one Refresh reloads this list too, so it has
 * none of its own. [1.79.0]
 */
export default function HmoProvidersPanel({ hmoAdmin }) {
  return (
      <Panel className="overflow-hidden">
        <PanelHeader
          title="HMO Providers"
          description="Accredited insurers whose pre-authorisations Reception can log against a visit"
          icon={ShieldPlus}
          actions={
            <Button size="sm" onClick={hmoAdmin.openAdd}>
              <Plus className="h-3.5 w-3.5" />
              Add Provider
            </Button>
          }
        />
        <PanelBody flush>
          {hmoAdmin.error ? (
            <EmptyState
              tone="error"
              compact
              title="Could not load HMO providers"
              description={hmoAdmin.error}
              action={<Button variant="outline" size="sm" onClick={hmoAdmin.reload}>Try again</Button>}
            />
          ) : hmoAdmin.loading ? (
            // A label, where there was none. A bare spinner says something is happening and not
            // WHAT — which on a panel that also renders an empty state and an error state leaves
            // the reader guessing which of the three they are looking at.
            <LoadingState label="Loading HMO providers…" />
          ) : hmoAdmin.providers.length === 0 ? (
            <EmptyState
              compact
              icon={ShieldPlus}
              title="No HMO providers yet"
              description="Add the providers this clinic is accredited with; reception picks from this list when logging a claim."
              action={<Button size="sm" variant="outline" onClick={hmoAdmin.openAdd}><Plus className="h-3.5 w-3.5" />Add Provider</Button>}
            />
          ) : (
            <Table>
              <TableHeader className="bg-slate-50/70">
                <TableRow>
                  <TableHead className="text-xs font-bold uppercase">Provider Name</TableHead>
                  <TableHead className="text-xs font-bold uppercase">Status</TableHead>
                  <TableHead className="text-xs font-bold uppercase text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hmoAdmin.providers.map(provider => (
                  <TableRow key={provider.id}>
                    <TableCell className="font-semibold text-xs text-slate-800">{provider.name}</TableCell>
                    <TableCell>
                      {/* A real button around the badge, as Packages and Payment Methods do, so the
                          switch is reachable by keyboard. [1.128.0] */}
                      <button
                        type="button"
                        onClick={() => hmoAdmin.requestToggle(provider)}
                        className="cursor-pointer rounded-full border-0 bg-transparent p-0"
                      >
                        <Badge
                          className={`text-meta font-bold px-2.5 py-0.5 rounded-full ${
                            provider.is_active
                              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200'
                              : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          {provider.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => hmoAdmin.openEdit(provider)}
                        className="h-8 text-xs font-bold flex items-center space-x-1.5 ml-auto"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Rename</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>
  );
}
