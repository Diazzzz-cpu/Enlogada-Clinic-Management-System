import React from 'react';
import LoadingState from '../ui/loading-state';
import { Edit2, Plus, Wallet, QrCode, AlertTriangle } from 'lucide-react';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import EmptyState from '../ui/empty-state';
import RefreshButton from '../ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';

/**
 * The clinic's own GCash and bank accounts, as published to patients.
 *
 * The warning banner is not decoration. Everything on this screen is an instruction to a patient
 * about where to send money, and it is the one screen in the application where a typo costs the
 * clinic real cash with no error anywhere to signal it.
 */
export default function PaymentMethodsPanel({ paymentMethods }) {
  const updatedAt = useFreshness(paymentMethods.loading, paymentMethods.error);
  const active = paymentMethods.methods.filter((m) => m.is_active);

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Payment Methods"
        description="The accounts patients pay into when they settle a booking online"
        icon={Wallet}
        actions={
          <>
            <RefreshButton compact onRefresh={paymentMethods.reload} loading={paymentMethods.loading} updatedAt={updatedAt} />
            <Button size="sm" onClick={paymentMethods.openAdd}>
              <Plus className="h-3.5 w-3.5" />
              Add Method
            </Button>
          </>
        }
      />
      <PanelBody flush>
        {paymentMethods.error ? (
          <EmptyState
            tone="error"
            compact
            title="Could not load payment methods"
            description={paymentMethods.error}
            action={<Button variant="outline" size="sm" onClick={paymentMethods.reload}>Try again</Button>}
          />
        ) : paymentMethods.loading ? (
          <LoadingState label="Loading payment methods…" />
        ) : paymentMethods.methods.length === 0 ? (
          <EmptyState
            compact
            title="No payment methods yet"
            description="Until one is added, patients have nowhere to send money and can only pay at the counter."
            action={<Button size="sm" onClick={paymentMethods.openAdd}>Add the first one</Button>}
          />
        ) : (
          <>
            {/* Said once, at the top, rather than on every row. */}
            <div className="flex items-start gap-2 border-b border-line bg-amber-50 px-4 py-2.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
              <p className="m-0 text-fine leading-relaxed text-amber-900">
                Patients send real money to these numbers. Check every digit — a wrong one fails
                silently, and the clinic only finds out when the payment does not arrive. Every
                change here is recorded against your name.
              </p>
            </div>

            <div className="relative w-full overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>QR</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentMethods.methods.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <span className="block font-semibold text-slate-900">{m.label}</span>
                        <span className="block text-meta uppercase tracking-[0.08em] text-slate-400">
                          {m.kind}{m.bank_name ? ` · ${m.bank_name}` : ''}
                        </span>
                      </TableCell>
                      <TableCell>
                        {/* Tabular figures, because this is a number somebody will read back
                            digit by digit against a bank app. */}
                        <span className="block font-mono text-note font-semibold tabular-nums text-slate-800">
                          {m.account_number}
                        </span>
                        {m.account_name && (
                          <span className="block text-fine text-slate-500">{m.account_name}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {m.has_qr ? (
                          <span className="inline-flex items-center gap-1.5 text-fine font-semibold text-brand-700">
                            <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                            Uploaded
                          </span>
                        ) : (
                          <span className="text-fine text-slate-400">None</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => paymentMethods.askToggle(m)}
                          className="cursor-pointer border-0 bg-transparent p-0"
                        >
                          <Badge variant={m.is_active ? 'default' : 'secondary'}>
                            {m.is_active ? 'Offered' : 'Hidden'}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => paymentMethods.openEdit(m)}>
                          <Edit2 className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* A patient with nowhere to pay is the failure this screen exists to prevent, and it
                is invisible from a list that has rows in it. */}
            {active.length === 0 && (
              <div className="border-t border-line bg-rose-50 px-4 py-2.5">
                <p className="m-0 text-fine font-semibold text-rose-800">
                  Every method is hidden, so patients cannot pay online at all — only at the counter.
                </p>
              </div>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
