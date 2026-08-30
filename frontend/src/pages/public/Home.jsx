import React from 'react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import PageShell from '../../components/ui/page-shell';
import Logo from '../../components/Logo';
import { Button } from '../../components/ui/button';
import HeroQuickDock from '../../components/public/HeroQuickDock';
import { ShieldCheck, Clock, Award, ChevronRight, Stethoscope, FlaskConical, Scan } from 'lucide-react';

// Mirrors the 5 seeded test_categories rows exactly (database/schema.sql), same icon mapping
// ClientDashboard.jsx already uses per category — static/decorative, not live data, so the
// hero's right column doesn't need a fabricated stat to fill the space.
// 2D Echo and ECG were removed here when the clinic confirmed it does not offer them. Their
// test_categories rows still exist, because historical results point at them and a past visit has
// to keep being able to say what it was for — but nothing advertises or sells them.
const SERVICE_PREVIEW = [
  { label: 'Ultrasound', icon: Stethoscope },
  { label: 'Laboratory', icon: FlaskConical },
  { label: 'Digital X-Ray', icon: Scan },
];

const Home = ({ onNavigate }) => {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <PublicHeader currentTab="home" onNavigate={onNavigate} />

      {/* Hero Banner Section */}
      <section className="rail-gradient rail-grid relative flex min-h-[420px] items-center overflow-hidden text-white sm:min-h-[500px]">
        {/* UI/UX Phase 4: replaces a generic, unrelated stock photo with a brand-forward
            treatment — the clinic's own mark, large and faint, plus a subtle dot grid — so the
            hero reads as this clinic's, not a stock library's. */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(circle, #ffffff 1.5px, transparent 1.5px)',
            backgroundSize: '28px 28px'
          }}
        />
        <div className="absolute -right-20 top-1/2 -translate-y-1/2 opacity-[0.08] pointer-events-none hidden md:block">
          <Logo className="w-[30rem] h-[480px]" />
        </div>

        {/* The flat left-to-right overlay that used to sit here was primary-navy fading into
            primary-navy — the same colour at three opacities, so it darkened the hero without
            adding anything. The shared `rail-gradient` on the section carries the light source
            now, and it is the logo's own azure and green. */}

        <PageShell className="relative py-14 sm:py-20 z-10 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="space-y-5 sm:space-y-6">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
              ENLOGADA - Your Trusted Diagnostic Partner
            </h1>
            <p className="text-rail-ink-soft text-sm sm:text-base leading-relaxed max-w-lg">
              Professional ultrasound and diagnostic services with all the care and attention you deserve. We're experienced healthcare professionals dedicated to your well-being.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 pt-2">
              <Button
                onClick={() => onNavigate && onNavigate('login')}
                size="lg"
                className="w-full sm:w-auto"
              >
                Book Now
              </Button>
              <Button
                onClick={() => onNavigate && onNavigate('services')}
                variant="outline"
                size="lg"
                className="w-full sm:w-auto"
              >
                View Services
              </Button>
            </div>
          </div>

          {/* UI/UX Modernization Phase 8: the right column previously rendered nothing but the
              faint background logo — filled with a static services-preview card instead of a
              stock photo or a fabricated stat (e.g. "10,000+ patients"), consistent with Phase
              4's earlier decision to keep this hero brand-forward rather than reach for imagery. */}
          <div className="flex justify-center">
            <div className="glass-card w-full max-w-sm rounded-2xl p-6 shadow-float sm:p-7">
              <span className="text-micro font-semibold uppercase tracking-[0.14em] text-brand-700">What We Offer</span>
              <h2 className="mb-5 mt-1 text-lg font-bold tracking-tight text-slate-900">Our Diagnostic Services</h2>
              <ul className="space-y-3 list-none p-0 m-0">
                {SERVICE_PREVIEW.map(({ label, icon: Icon }) => (
                  <li key={label} className="flex items-center space-x-3">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                      <Icon className="w-4.5 h-4.5" />
                    </span>
                    <span className="text-sm font-semibold text-slate-700">{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </PageShell>
      </section>

      {/* The three errands a visitor arrives to run. [1.63.0] The hero's own two buttons sit
          inside a dark banner competing with a headline, so somebody who came to check a result
          had to read past a marketing paragraph to find out where to go. The dock straddles the
          seam, which is where the eye lands after the headline, and names errands rather than
          screens. */}
      <HeroQuickDock onNavigate={onNavigate} />

      {/* Key Highlights Banner */}
      <section className="bg-surface pb-10 pt-14 sm:pb-12 sm:pt-16 border-b border-line">
        <PageShell className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
          {/* One tone across all three, not three.
              These are one set of related claims about the clinic, and they wore a green, a blue
              and an indigo — so they read as three different KINDS of thing rather than three
              reasons to trust the same clinic. It is the same mistake the metric card's own notes
              describe: state the tone once, quietly, and let the content differ. Brand green,
              because these are the clinic's own promises and green is the clinic's colour. */}
          <div className="flex items-start space-x-4 p-4 rounded-xl bg-slate-50/70 border border-line">
            <div className="p-3 bg-brand-50 text-brand-600 rounded-xl">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="m-0 text-lead font-bold tracking-tight text-slate-900">Licensed Diagnostics</h3>
              <p className="m-0 text-fine leading-relaxed text-slate-500">Certified laboratory tech & radiologists handling your medical tests.</p>
            </div>
          </div>

          <div className="flex items-start space-x-4 p-4 rounded-xl bg-slate-50/70 border border-line">
            <div className="p-3 bg-brand-50 text-brand-600 rounded-xl">
              <Clock className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="m-0 text-lead font-bold tracking-tight text-slate-900">Fast & Accurate Results</h3>
              <p className="m-0 text-fine leading-relaxed text-slate-500">Digital result releasing notified directly to your email inbox.</p>
            </div>
          </div>

          <div className="flex items-start space-x-4 p-4 rounded-xl bg-slate-50/70 border border-line">
            <div className="p-3 bg-brand-50 text-brand-600 rounded-xl">
              <Award className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="m-0 text-lead font-bold tracking-tight text-slate-900">HMO & Private Support</h3>
              <p className="m-0 text-fine leading-relaxed text-slate-500">HMO verification integrated with manual authorization code tracking.</p>
            </div>
          </div>
        </PageShell>
      </section>

      {/* Call to Action Bar */}
      <PageShell as="section" className="py-12 sm:py-16">
        <div className="rail-gradient rail-grid relative flex flex-col items-center justify-between gap-5 overflow-hidden rounded-2xl border border-[#2b3a4d] p-6 text-white sm:p-10 md:flex-row">
          <div className="relative space-y-2 text-center md:text-left">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Need a Diagnostic Appointment?</h2>
            <p className="text-xs sm:text-sm text-rail-ink-soft">Sign in to your account or register to schedule an appointment today.</p>
          </div>
          <Button
            onClick={() => onNavigate && onNavigate('login')}
            size="lg"
            className="relative w-full flex-shrink-0 md:w-auto"
          >
            <span>Access Portal</span>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </PageShell>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default Home;
