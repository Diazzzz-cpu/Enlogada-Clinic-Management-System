import React from 'react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import Logo from '../../components/Logo';
import { Button } from '../../components/ui/button';
import { ShieldCheck, Clock, HeartHandshake, Award, MapPin, Phone, Mail, ChevronRight } from 'lucide-react';

const VALUES = [
  {
    icon: ShieldCheck,
    title: 'Licensed & Accredited',
    body: 'Every test is handled by certified laboratory technicians and radiologists, following standard clinical protocols from sample or scan through to release.',
  },
  {
    icon: Clock,
    title: 'Fast, Digital Results',
    body: 'Results are released digitally and reach you by email as soon as they’re finalized — no waiting for a call back or a return trip to the clinic.',
  },
  {
    icon: Award,
    title: 'HMO & Private Support',
    body: 'We work with accredited HMO partners and handle pre-authorization tracking directly, alongside straightforward private and self-pay billing.',
  },
  {
    icon: HeartHandshake,
    title: 'Patient-Centered Care',
    body: 'From walk-in registration to appointment booking, every step is built around getting you seen, tested, and informed with as little friction as possible.',
  },
];

const AboutUs = ({ onNavigate }) => {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab="about" onNavigate={onNavigate} />

      <section className="bg-primary-navy text-white py-10 sm:py-14 px-4 sm:px-6 lg:px-8 border-b border-rail-line">
        <div className="max-w-4xl mx-auto space-y-3">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">About Enlogada</h1>
          <p className="text-rail-ink-soft text-sm max-w-2xl leading-relaxed">
            A diagnostic clinic in Bugo, Cagayan de Oro, focused on accurate results, fair pricing,
            and getting patients answers as quickly as good medicine allows.
          </p>
        </div>
      </section>

      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full space-y-12">

        {/* Our Story */}
        <div className="flex flex-col md:flex-row gap-8 items-center">
          <div className="flex-shrink-0 bg-surface rounded-2xl border border-line p-8">
            <Logo className="w-28 h-28" />
          </div>
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-slate-900 m-0">Our Story</h2>
            <p className="text-sm text-gray-600 leading-relaxed m-0">
              Enlogada Ultrasound &amp; Diagnostic Clinic was founded to bring hospital-grade diagnostic
              services — laboratory testing, digital X-ray, and ultrasound — to patients
              without the wait times and overhead of a full hospital visit. We serve walk-in patients,
              scheduled appointments, and HMO-referred cases side by side, under one roof.
            </p>
          </div>
        </div>

        {/* Our Values */}
        <div className="space-y-5">
          <h2 className="text-xl font-bold text-slate-900 m-0">Why Patients Choose Us</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {VALUES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-surface border border-line rounded-2xl p-5 space-y-2.5">
                <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-gray-900 text-sm m-0">{title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed m-0">{body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Visit Us */}
        <div className="rail-gradient rail-grid relative overflow-hidden rounded-2xl border border-[#2b3a4d] p-8 md:p-10 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
          <div className="space-y-3">
            <h2 className="text-xl font-bold tracking-tight m-0">Visit Us</h2>
            <div className="space-y-2 text-sm text-rail-ink-soft">
              <div className="flex items-center space-x-2.5">
                <MapPin className="w-4 h-4 text-brand-600 flex-shrink-0" />
                <span>Bugo, Cagayan de Oro, Philippines 9000</span>
              </div>
              <div className="flex items-center space-x-2.5">
                <Phone className="w-4 h-4 text-brand-600 flex-shrink-0" />
                <span>0936 132 0650</span>
              </div>
              <div className="flex items-center space-x-2.5">
                <Mail className="w-4 h-4 text-brand-600 flex-shrink-0" />
                <span>enlogadaclinic2011@gmail.com</span>
              </div>
            </div>
          </div>
          <Button
            onClick={() => onNavigate && onNavigate('login')}
            className="bg-primary-hover hover:bg-primary-active text-white px-8 py-6 text-sm font-bold rounded-xl flex items-center space-x-2 border-0 cursor-pointer flex-shrink-0"
          >
            <span>Book an Appointment</span>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default AboutUs;
