import React, { useEffect } from 'react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import PageShell from '../../components/ui/page-shell';
import { Button } from '../../components/ui/button';
import HeroQuickDock from '../../components/public/HeroQuickDock';
import HeroCarousel from '../../components/public/HeroCarousel';
import SectionHeading from '../../components/public/SectionHeading';
import FeatureCard from '../../components/public/FeatureCard';
import DecorBlobs from '../../components/public/DecorBlobs';
import Reveal from '../../components/public/Reveal';
import ClinicFaq from '../../components/public/ClinicFaq';
import ClinicShowcase from '../../components/public/ClinicShowcase';
import clinicSign from '../../assets/clinic/clinic-sign.webp';
import ultrasoundRoom from '../../assets/clinic/ultrasound-room.webp';
import xrayRoom from '../../assets/clinic/xray-room.webp';
import fetalMonitor from '../../assets/clinic/fetal-monitor.webp';
import CtaBand from '../../components/public/CtaBand';
import { scrollToSection } from '../../lib/scroll';
import {
  ShieldCheck,
  Clock,
  Award,
  Stethoscope,
  FlaskConical,
  Scan,
  ArrowRight,
  CalendarCheck,
  CircleQuestionMark,
  HeartHandshake,
} from 'lucide-react';

/**
 * The public front page, on the reference site's structure. [1.72.0]
 *
 * Top to bottom: a full-height Aurora hero under the floating header; the three errands a visitor
 * arrives to run (HeroQuickDock, unchanged in behaviour); why patients choose the clinic; its three
 * departments; an About teaser; how a visit works; the FAQ; a closing call to action. Each section
 * reveals once as it scrolls into view, with the reference site's timings (Reveal).
 *
 * The hero keeps "Book Now" and "View Services", NOT "Book an Appointment": the dock's primary card
 * carries that name and public-queue-status.spec.js finds it by role, so a second match would be a
 * strict-mode failure on the one test proving the live queue card renders signed-out.
 *
 * Every sentence states something the system does. The staff titles are the report signatories'
 * own; the payment channels are the ones `payments` accepts.
 */

// The three departments the clinic runs. 2D Echo and ECG are not offered and are not advertised
// (see CLAUDE.md) — historical results still name them, a sales page must not.
const DEPARTMENTS = [
  {
    id: 'ultrasound',
    icon: Stethoscope,
    name: 'Ultrasound',
    body: 'Abdominal, pelvic, thyroid, kidney and prostate scans, each read and signed by a radiologist-sonologist.',
  },
  {
    id: 'laboratory',
    icon: FlaskConical,
    name: 'Laboratory',
    body: 'Blood chemistry, CBC, urinalysis, blood typing and more — with any fasting instruction printed beside the test.',
  },
  {
    id: 'xray',
    icon: Scan,
    name: 'Digital X-Ray',
    // [1.129.0] X-ray results are given by the X-ray department's own system, not through this one.
    body: 'Chest and other views on digital X-ray. The X-ray department gives you your result.',
  },
];

const STEPS = [
  {
    title: 'Book online, or walk in',
    body: 'Reserve a time from your phone and we will tell you when to arrive — or come in during clinic hours and join the queue.',
  },
  {
    title: 'Check in and get tested',
    body: 'Show your booking pass or give your name at the desk, settle the bill by cash, GCash or bank transfer, and go to the department.',
  },
  {
    title: 'Receive your results',
    // [1.113.0] [1.129.0] Emailed on request, not automatically; X-ray results come from the X-ray department.
    body: 'Laboratory and ultrasound results appear in your patient portal if you have an account, and the clinic emails a copy on request.',
  },
];

const Home = ({ onNavigate, section = null }) => {
  // Arriving from another page's FAQ link: App passes the section down, and it is scrolled to once
  // this page has rendered. Plain navigation passes null, so returning to Home does not jump.
  useEffect(() => {
    if (section) scrollToSection(section);
  }, [section]);

  const go = (tab) => onNavigate?.(tab);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <PublicHeader overlay currentTab="home" onNavigate={onNavigate} />

      {/* ── Hero ────────────────────────────────────────────────────────────────────────────── */}
      <section
        aria-labelledby="hero-heading"
        className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-aurora-base"
      >
        {/* The clinic's own photographs, which the Aurora slides stood in for until it sent them.
            [1.84.0] The rooms are portrait photos cropped to a wide hero, so each names the point
            to keep in view. The rooms come first: the sign's own lettering sits right behind the
            headline, so it is the last slide rather than the one every visitor lands on (and the
            only one a visitor who asked for reduced motion ever sees). */}
        <HeroCarousel
          slides={[
            { id: 'ultrasound', src: ultrasoundRoom, position: '45% 55%' },
            { id: 'xray', src: xrayRoom, position: '55% 58%' },
            { id: 'sign', src: clinicSign, position: '50% 45%' },
          ]}
        />
        <div className="relative z-[1] flex flex-1 items-end pb-32 pt-36 sm:pb-40">
          <PageShell className="flex flex-col items-center text-center">
            {/* Each department wraps as a whole — on a phone the plain string broke inside "X-Ray". */}
            <Reveal as="p" className="m-0 text-meta font-semibold uppercase tracking-[0.2em] text-aurora-soft">
              <span className="whitespace-nowrap">Ultrasound ·</span>{' '}
              <span className="whitespace-nowrap">Laboratory ·</span>{' '}
              <span className="whitespace-nowrap">Digital X-Ray</span>
            </Reveal>
            <Reveal index={1}>
              <h1
                id="hero-heading"
                className="m-0 mt-4 max-w-4xl text-3xl font-black uppercase leading-tight tracking-[0.06em] text-aurora-ink sm:text-5xl sm:tracking-[0.1em] lg:text-6xl"
              >
                Your trusted <span className="text-gradient-aurora">diagnostic</span> partner
              </h1>
            </Reveal>
            <Reveal as="p" index={2} className="m-0 mt-5 max-w-2xl text-sm leading-relaxed text-aurora-soft sm:text-lg">
              Ultrasound, laboratory and digital X-ray in Bugo, Cagayan de Oro — with your laboratory and
              ultrasound results in your patient portal.
            </Reveal>
            <Reveal index={3} className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
              <Button variant="brand" size="lg" onClick={() => go('login')} className="rounded-full px-8">
                Book Now
              </Button>
              <Button variant="glass" size="lg" onClick={() => go('services')} className="rounded-full px-8">
                View Services
              </Button>
            </Reveal>
          </PageShell>
        </div>
      </section>

      {/* The three errands, straddling the hero's lower edge. [1.63.0] */}
      <HeroQuickDock onNavigate={onNavigate} />

      {/* ── Why Enlogada ────────────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="why-heading" className="wash-aurora relative overflow-hidden py-20 sm:py-24">
        <DecorBlobs />
        <PageShell className="relative">
          <SectionHeading
            id="why-heading"
            icon={ShieldCheck}
            title="Why patients choose Enlogada"
            subtitle="Licensed people, fast digital results and HMO support — under one roof in Bugo since 2011."
          />
          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
            <FeatureCard index={0} icon={ShieldCheck} title="Licensed Diagnostics">
              Licensed medical technologists, a pathologist and a radiologist-sonologist — the people whose
              names are on your report.
            </FeatureCard>
            <FeatureCard index={1} icon={Clock} title="Fast, Digital Results">
              Laboratory and ultrasound results appear in your patient portal as soon as they are released,
              and a copy is emailed on request.
            </FeatureCard>
            <FeatureCard index={2} icon={Award} title="HMO & Private Support">
              Accredited HMO providers, private and self-pay billing, and the Senior Citizen and PWD discount
              at the counter.
            </FeatureCard>
          </div>
        </PageShell>
      </section>

      {/* ── Departments ─────────────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="services-heading" className="py-20 sm:py-24">
        <PageShell>
          <SectionHeading
            id="services-heading"
            icon={Stethoscope}
            title="Our diagnostic services"
            subtitle="Three departments, one visit. Every test and its price is on the price list — no account needed."
          />
          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
            {DEPARTMENTS.map(({ id, icon: Icon, name, body }, i) => (
              <Reveal key={id} variant="rise" index={i} className="h-full">
                <article className="edge-gradient flex h-full flex-col rounded-2xl p-6 transition duration-200 hover:-translate-y-0.5 hover:shadow-raised">
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-brand text-primary-foreground"
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="m-0 mt-5 text-lg font-bold tracking-tight text-ink">{name}</h3>
                  <p className="m-0 mt-2 flex-1 text-note leading-relaxed text-ink-soft">{body}</p>
                </article>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-10 flex justify-center">
            <Button variant="outline" size="lg" onClick={() => go('services')} className="rounded-full px-7">
              See the full price list
              <ArrowRight />
            </Button>
          </Reveal>
        </PageShell>
      </section>

      {/* ── About teaser ────────────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="about-heading" className="wash-aurora relative overflow-hidden py-20 sm:py-24">
        <PageShell className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <ClinicShowcase
            photo={{
              src: fetalMonitor,
              alt: "The fetal monitor beside the ultrasound machine in Enlogada's ultrasound room",
              position: '50% 55%',
            }}
          />
          <div>
            <SectionHeading
              id="about-heading"
              icon={HeartHandshake}
              align="left"
              title="About Enlogada"
              className="items-center text-center md:items-start md:text-left"
            />
            <Reveal as="p" index={1} className="m-0 mt-6 text-center text-sm leading-relaxed text-ink-soft sm:text-base md:text-left">
              Enlogada Ultrasound &amp; Diagnostic Clinic brings hospital-grade diagnostics — laboratory
              testing, digital X-ray and ultrasound — to patients without the wait and overhead of a full
              hospital visit. Walk-ins, scheduled appointments and HMO-referred patients are seen side by
              side, under one roof.
            </Reveal>
            <Reveal index={2} className="mt-8 flex justify-center md:justify-start">
              <Button variant="outline" size="lg" onClick={() => go('about')} className="rounded-full px-7">
                Learn more about us
                <ArrowRight />
              </Button>
            </Reveal>
          </div>
        </PageShell>
      </section>

      {/* ── How a visit works ───────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="how-heading" className="py-20 sm:py-24">
        <PageShell>
          <SectionHeading
            id="how-heading"
            icon={CalendarCheck}
            title="How a visit works"
            subtitle="Book ahead or walk in — either way, it is three steps."
          />
          <ol className="m-0 mt-12 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-3 md:gap-6">
            {STEPS.map((step, i) => (
              <Reveal as="li" key={step.title} variant="rise" index={i} className="h-full">
                <div className="edge-gradient flex h-full flex-col rounded-2xl p-6">
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-brand text-lead font-bold text-primary-foreground"
                  >
                    {i + 1}
                  </span>
                  <h3 className="m-0 mt-4 text-lg font-bold tracking-tight text-ink">{step.title}</h3>
                  <p className="m-0 mt-2 text-note leading-relaxed text-ink-soft">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </PageShell>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────────────────────────── */}
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="wash-aurora relative scroll-mt-20 overflow-hidden py-20 sm:py-24"
      >
        <DecorBlobs />
        <PageShell width="5xl" className="relative">
          <SectionHeading
            id="faq-heading"
            icon={CircleQuestionMark}
            title="Frequently asked questions"
            subtitle="What patients ask us most. For anything else, call or email us."
          />
          <Reveal className="mt-10">
            <ClinicFaq />
          </Reveal>
        </PageShell>
      </section>

      {/* ── Closing call to action ──────────────────────────────────────────────────────────── */}
      <CtaBand
        id="cta-heading"
        title="Need a diagnostic appointment?"
        body="Sign in to book a time and follow your visit, or create an account in a minute."
      >
        <Button variant="brand" size="lg" onClick={() => go('login')} className="rounded-full px-8">
          Access Portal
          <ArrowRight />
        </Button>
      </CtaBand>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default Home;
