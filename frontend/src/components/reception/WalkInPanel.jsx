import React from 'react';
import { AlertCircle, CheckCircle, CheckCircle2, Users } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel } from '../ui/panel';
import { Input } from '../ui/input';
import WalkInRegistration from './WalkInRegistration';

/**
 * Registering someone who walked in — find an existing record first, or create a new one.
 *
 * Lifted out of ReceptionistDashboard, which rendered four unrelated screens from one
 * 1,048-line file. The props are the hooks this screen actually reads — listed rather than
 * reached for, so what each view depends on is visible at its top instead of inferred by
 * scrolling.
 */
/**
 * @param {object} props
 * @param {boolean} [props.compact]  Rendered in the queue screen's side column rather than as its
 *   own full-width screen. Drops the reading-width cap, which exists to stop a form sprawling
 *   across a 27" monitor and is exactly wrong once the form IS the narrow column.
 */
export default function WalkInPanel({ queue, lookup, checkIn, reference, compact = false }) {
  const panelWidth = compact ? '' : 'max-w-3xl';
  return (
        <div className="space-y-4">

          {/* Existing Patient Lookup (Module 7: patient record lookup) */}
          <Panel className={`${panelWidth} p-6`}>
            <div className="border-b border-line pb-3 mb-4">
              <h2 className="m-0 flex items-center gap-2 text-lead font-bold tracking-tight text-slate-900">
                <Users className="h-4 w-4 text-brand-600" />
                <span>Find Existing Patient</span>
              </h2>
              <p className="mt-1 text-fine leading-relaxed text-slate-500">Search before registering — a returning patient should be checked in, not re-registered.</p>
            </div>

            {lookup.notice && (
              <div role="status" className="mb-4 alert alert-success">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{lookup.notice}</span>
              </div>
            )}
            {lookup.error && (
              <div role="alert" className="mb-4 alert alert-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{lookup.error}</span>
              </div>
            )}

            <form onSubmit={lookup.search} className="flex space-x-2">
              <Input
                aria-label="Search existing patients by name"
                placeholder="Search by patient name..."
                value={lookup.query}
                onChange={e => lookup.setQuery(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" variant="secondary" loading={lookup.searching}>
                Search
              </Button>
            </form>

            {lookup.results && (
              <div className="mt-4 space-y-2">
                {lookup.results.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-3">No matching patient records found. Register them as a new patient below.</p>
                ) : (
                  lookup.results.map(patient => (
                    <div key={patient.id} className="flex items-center justify-between border border-line rounded-xl p-3 bg-slate-50/70">
                      <div className="text-xs">
                        <span className="block font-bold text-slate-900">{patient.first_name} {patient.last_name} <span className="text-meta text-gray-400 font-normal">PT-{patient.id}</span></span>
                        <span className="block text-gray-500">{patient.patient_type_name} &middot; DOB {new Date(patient.birthdate).toLocaleDateString()}</span>
                        {/* Phase D: previously zero visit/financial context at lookup — a
                            returning patient's unpaid balance from a prior visit was invisible
                            at check-in. */}
                        <span className="flex items-center gap-2 mt-1">
                          <span className="text-meta font-semibold text-gray-400">
                            {Number(patient.visit_count) > 0
                              ? `${patient.visit_count} prior visit${Number(patient.visit_count) === 1 ? '' : 's'} · last ${new Date(patient.last_visit_at).toLocaleDateString()}`
                              : 'No prior visits'}
                          </span>
                          {Number(patient.unpaid_visit_count) > 0 && (
                            <span className="text-meta font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">
                              {patient.unpaid_visit_count} unpaid visit{Number(patient.unpaid_visit_count) === 1 ? '' : 's'}
                            </span>
                          )}
                        </span>
                      </div>
                      <Button
                        type="button"
                        onClick={() => checkIn.request('walkin', patient)}
                        className="text-fine font-bold rounded-lg flex items-center space-x-1.5 px-3 py-1.5"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Check In This Patient</span>
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </Panel>

          <WalkInRegistration
            patientTypes={reference.patientTypes}
            testCatalog={reference.testCatalog}
            packages={reference.packages}
            onRegistered={() => queue.refresh()}
          />
        </div>
  );
}
