import React from 'react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import { Calendar, CreditCard, FileCheck, AlertCircle } from 'lucide-react';

const SECTIONS = [
  {
    icon: Calendar,
    title: 'Appointments & Cancellations',
    body: `Appointments booked through this system reserve a specific date, time, and diagnostic service.
      Please cancel through your account or contact the clinic as early as possible if you cannot make it,
      so the slot can be offered to another patient. Repeated no-shows may affect your ability to book
      online.`,
  },
  {
    icon: CreditCard,
    title: 'Billing & Payment',
    body: `Prices shown for each test reflect the rate at the time of your visit and may change for future
      visits. HMO coverage is applied per test based on an approved pre-authorization on file; any portion
      not covered is payable at the clinic. Payment is due at the time of service unless other
      arrangements have been made with billing staff.`,
  },
  {
    icon: FileCheck,
    title: 'Diagnostic Results',
    body: `Results are prepared by qualified clinic staff and released once findings are finalized. Results
      are provided for your own reference and for use by your attending physician — they are not a
      substitute for professional medical advice, diagnosis, or treatment, and should be discussed with
      your doctor.`,
  },
  {
    icon: AlertCircle,
    title: 'Account Responsibility',
    body: `You are responsible for keeping your login credentials confidential and for the accuracy of the
      information you provide when registering a patient profile or booking a visit. Notify us promptly if
      you suspect unauthorized access to your account.`,
  },
];

const TermsOfService = ({ onNavigate }) => {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab="terms" onNavigate={onNavigate} />

      <section className="bg-primary-navy text-white py-10 sm:py-14 px-4 sm:px-6 lg:px-8 border-b border-rail-line">
        <div className="max-w-4xl mx-auto space-y-3">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Terms of Service</h1>
          <p className="text-rail-ink-soft text-sm max-w-2xl leading-relaxed">
            The terms that apply when you book appointments, receive services, or make payments through
            Enlogada Ultrasound &amp; Diagnostic Clinic.
          </p>
        </div>
      </section>

      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full space-y-6">
        {SECTIONS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-surface border border-line rounded-2xl p-6 space-y-3">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4.5 h-4.5" />
              </div>
              <h2 className="m-0 text-lead font-bold tracking-tight text-slate-900">{title}</h2>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed m-0">{body}</p>
          </div>
        ))}

        <p className="text-xs text-gray-400 text-center pt-4">
          Questions about these terms? Contact us at enlogadaclinic2011@gmail.com.
        </p>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default TermsOfService;
