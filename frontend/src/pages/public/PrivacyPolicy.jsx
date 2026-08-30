import React from 'react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import { ShieldCheck, Lock, Eye, Mail } from 'lucide-react';

const SECTIONS = [
  {
    icon: Eye,
    title: 'What We Collect',
    body: `When you register an account, book an appointment, or visit the clinic, we collect the personal
      and medical information needed to provide diagnostic services — your name, contact details, birthdate,
      address, and the test results, findings, and visit history tied to your patient record. Payment
      transactions record the amount, method, and reference number, not full card or account details.`,
  },
  {
    icon: Lock,
    title: 'How We Use It',
    body: `Your information is used to register and check you in for visits, bill for services rendered,
      release diagnostic results to you and to staff directly involved in your care, and to send
      appointment or result-ready notifications. We do not sell patient data, and we do not use it for
      advertising.`,
  },
  {
    icon: ShieldCheck,
    title: 'Who Can See It',
    body: `Access is role-based: front-desk staff see visit and scheduling details, diagnostic staff see
      only the test categories relevant to their department, and billing staff see payment information.
      Your diagnostic results are visible to you and to the staff who processed them. Administrative roles
      oversee the system for clinic operations, not to read individual results without cause.`,
  },
  {
    icon: Mail,
    title: 'Your Rights',
    body: `Under the Philippine Data Privacy Act of 2012, you may request access to, correction of, or
      deletion of your personal data, subject to our recordkeeping obligations as a healthcare provider.
      To make a request, contact us using the details below.`,
  },
];

const PrivacyPolicy = ({ onNavigate }) => {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab="privacy" onNavigate={onNavigate} />

      <section className="bg-primary-navy text-white py-10 sm:py-14 px-4 sm:px-6 lg:px-8 border-b border-rail-line">
        <div className="max-w-4xl mx-auto space-y-3">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Privacy Policy</h1>
          <p className="text-rail-ink-soft text-sm max-w-2xl leading-relaxed">
            How Enlogada Ultrasound &amp; Diagnostic Clinic collects, uses, and protects your personal and
            medical information.
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
          Questions about this policy? Contact us at enlogadaclinic2011@gmail.com.
        </p>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default PrivacyPolicy;
