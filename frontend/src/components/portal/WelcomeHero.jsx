import React from 'react';
import { CheckCircle, Clock, FileText, Receipt, Sparkles } from 'lucide-react';
import MetricCard from '../ui/metric-card';
import BookingDialog from '../booking/BookingDialog';

/**
 * The greeting, the headline numbers, and the way to book.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 */
export default function WelcomeHero({ profiles, results, bookings, reference }) {
  return (
      <div className="rail-gradient rail-grid relative overflow-hidden rounded-2xl border border-[#2b3a4d] p-6 text-white sm:p-8">
        <div className="relative z-10 space-y-4">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-micro font-semibold uppercase tracking-[0.14em] text-rail-accent ring-1 ring-inset ring-white/10">
            <Sparkles className="h-3 w-3" />
            <span>Patient Portal</span>
          </div>

          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div className="space-y-1.5">
              <h1 className="m-0 text-2xl font-bold tracking-tight text-white md:text-3xl">
                {profiles.selected ? `Welcome, ${profiles.selected.first_name}` : 'Welcome to Enlogada'}
              </h1>
              <p className="m-0 max-w-xl text-note leading-relaxed text-rail-ink-soft">
                Book Laboratory, Ultrasound and X-Ray appointments, follow a visit as it moves through the clinic, and download your certified reports.
              </p>
            </div>

            {/* Action Button */}
            <BookingDialog
              selectedProfileId={profiles.selectedId}
              selectedProfile={profiles.selected}
              testCatalog={reference.testCatalog}
              packages={reference.packages}
              hmoProviders={reference.hmoProviders}
              onBooked={() => { results.reload(); bookings.reload(); }}
            />
          </div>

          {/* Quick Metrics Bar inside Hero */}
          <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-5 md:grid-cols-4">
            <MetricCard variant="dark" label="Pending Requests" value={results.pendingCount} icon={Clock} tone="amber" />
            <MetricCard variant="dark" label="Completed Reports" value={results.completedCount} icon={CheckCircle} tone="emerald" />
            <MetricCard variant="dark" label="Total Test History" value={results.history.length} icon={FileText} tone="slate" />
            <MetricCard variant="dark" label="Billing Type" value={profiles.selected?.patient_type_name || 'Standard'} icon={Receipt} tone="green" />
          </div>

        </div>

      </div>

  );
}
