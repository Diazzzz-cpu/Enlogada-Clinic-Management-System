import React from 'react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import PageShell from '../../components/ui/page-shell';
import { Button } from '../../components/ui/button';
import PageHero from '../../components/public/PageHero';
import SectionHeading from '../../components/public/SectionHeading';
import FeatureCard from '../../components/public/FeatureCard';
import ClinicShowcase from '../../components/public/ClinicShowcase';
import frontDesk from '../../assets/clinic/front-desk.webp';
import ClinicHours from '../../components/public/ClinicHours';
import CtaBand from '../../components/public/CtaBand';
import DecorBlobs from '../../components/public/DecorBlobs';
import Reveal from '../../components/public/Reveal';
import FacebookIcon from '../../components/public/FacebookIcon';
import { useClinic, httpsUrl, displayUrl } from '../../lib/clinic';
import {
  ShieldCheck,
  Clock,
  HeartHandshake,
  Award,
  MapPin,
  Phone,
  Mail,
  ArrowRight,
  BookOpen,
  Navigation,
  CalendarCheck,
} from 'lucide-react';

/**
 * About the clinic. [1.72.0]
 *
 * Its story, what it stands for, and where to find it — on the same Aurora structure as Home.
 *
 * Every contact detail comes from useClinic(), and the hours from Clinic Schedule. This page typed
 * them in before: the short "Bugo, Cagayan de Oro, Philippines 9000" went on showing after the full
 * address had been corrected on the footer and the printed result form, so About disagreed with the
 * paper in the patient's hand about where to go.
 *
 * The values say what the system and the clinic's own reports say — the signatories named on the
 * result forms, the discounts the cashier applies — and nothing a marketing page would invent.
 */

const VALUES = [
  {
    icon: ShieldCheck,
    title: 'Licensed people',
    body: 'Licensed medical technologists, a pathologist and a radiologist-sonologist handle every test — the people whose names are on your report.',
  },
  {
    icon: Clock,
    title: 'Fast, digital results',
    body: 'Laboratory and ultrasound results appear in your patient portal as soon as they are signed off, and the clinic emails a copy on request. X-ray results are given by the X-ray department.',
  },
  {
    icon: Award,
    title: 'HMO and private billing',
    body: 'Accredited HMO providers with the claim raised for you, straightforward self-pay billing, and the Senior Citizen and PWD discount at the counter.',
  },
  {
    icon: HeartHandshake,
    title: 'Built around the patient',
    body: 'Walk in or book ahead, check in with your booking pass, and follow your visit from the portal — as little waiting and paperwork as we can manage.',
  },
];

const LINK = 'font-semibold text-brand-700 no-underline underline-offset-2 hover:underline';

/** An icon on the brand tint, beside one line of contact detail. */
function DetailIcon({ children }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand-100 to-azure-100 text-brand-700"
    >
      {children}
    </span>
  );
}

const AboutUs = ({ onNavigate }) => {
  const CLINIC = useClinic();
  const tel = CLINIC.phone.replace(/\s/g, '');
  const facebook = httpsUrl(CLINIC.facebook);
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(CLINIC.address)}`;
  const go = (tab) => onNavigate?.(tab);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <PublicHeader overlay currentTab="about" onNavigate={onNavigate} />

      <PageHero
        id="about-title"
        eyebrow="About us"
        title={<>About <span className="text-gradient-aurora">Enlogada</span></>}
        subtitle="A diagnostic clinic in Bugo, Cagayan de Oro, focused on accurate results, fair pricing, and getting patients answers as quickly as good medicine allows."
      />

      <main className="flex-1">
        {/* ── Our story ─────────────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="story-heading" className="py-20 sm:py-24">
          <PageShell className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
            <ClinicShowcase
              photo={{
                src: frontDesk,
                alt: "Enlogada Clinic's lobby, with the lit clinic sign and the front desk",
                position: '50% 58%',
              }}
            />
            <div>
              <SectionHeading
                id="story-heading"
                icon={BookOpen}
                align="left"
                title="Our story"
                className="items-center text-center md:items-start md:text-left"
              />
              <Reveal as="p" index={1} className="m-0 mt-6 text-center text-sm leading-relaxed text-ink-soft sm:text-base md:text-left">
                Enlogada Ultrasound &amp; Diagnostic Clinic was founded to bring hospital-grade diagnostic
                services — laboratory testing, digital X-ray and ultrasound — to patients without the wait
                times and overhead of a full hospital visit.
              </Reveal>
              <Reveal as="p" index={2} className="m-0 mt-4 text-center text-sm leading-relaxed text-ink-soft sm:text-base md:text-left">
                Walk-in patients, scheduled appointments and HMO-referred cases are seen side by side, under
                one roof in Bugo, Cagayan de Oro — as they have been since 2011.
              </Reveal>
            </div>
          </PageShell>
        </section>

        {/* ── What we stand for ─────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="values-heading" className="wash-aurora relative overflow-hidden py-20 sm:py-24">
          <DecorBlobs />
          <PageShell className="relative">
            <SectionHeading
              id="values-heading"
              icon={HeartHandshake}
              title="What we stand for"
              subtitle="Four things a patient can hold us to, on every visit."
            />
            <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              {VALUES.map(({ icon, title, body }, i) => (
                <FeatureCard key={title} index={i} icon={icon} title={title}>
                  {body}
                </FeatureCard>
              ))}
            </div>
          </PageShell>
        </section>

        {/* ── Visit us ──────────────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="visit-heading" className="py-20 sm:py-24">
          <PageShell>
            <SectionHeading
              id="visit-heading"
              icon={MapPin}
              title="Visit us"
              subtitle="Walk in during clinic hours, or book a time and we will tell you when to arrive."
            />
            <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
              <Reveal variant="rise" className="h-full">
                <div className="edge-gradient flex h-full flex-col rounded-2xl p-6 sm:p-8">
                  <h3 className="m-0 text-lead font-bold tracking-tight text-ink">Find us</h3>
                  <ul className="m-0 mt-5 list-none space-y-4 p-0 text-note text-ink-soft">
                    <li className="flex items-start gap-3">
                      <DetailIcon><MapPin className="h-4 w-4" /></DetailIcon>
                      {/* Wraps rather than truncates — a clipped address is a wrong address. */}
                      <span data-testid="about-address" className="pt-1.5 leading-relaxed">{CLINIC.address}</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <DetailIcon><Phone className="h-4 w-4" /></DetailIcon>
                      <a href={`tel:${tel}`} className={LINK}>{CLINIC.phone}</a>
                    </li>
                    <li className="flex items-center gap-3">
                      <DetailIcon><Mail className="h-4 w-4" /></DetailIcon>
                      <a href={`mailto:${CLINIC.email}`} className={`${LINK} [overflow-wrap:anywhere]`}>{CLINIC.email}</a>
                    </li>
                    {facebook && (
                      <li className="flex items-center gap-3">
                        <DetailIcon><FacebookIcon className="h-4 w-4" /></DetailIcon>
                        <a href={facebook} target="_blank" rel="noopener noreferrer" className={`${LINK} [overflow-wrap:anywhere]`}>
                          {displayUrl(facebook)}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      </li>
                    )}
                  </ul>
                  <div className="mt-auto pt-7">
                    <a
                      href={directions}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-6 text-sm font-semibold text-ink no-underline transition-colors hover:border-azure-200 hover:bg-sunken"
                    >
                      <Navigation className="h-4 w-4 text-brand-700" aria-hidden="true" />
                      Get directions
                      <span className="sr-only"> (opens Google Maps in a new tab)</span>
                    </a>
                  </div>
                </div>
              </Reveal>

              <Reveal variant="rise" index={1} className="h-full">
                <div className="edge-gradient flex h-full flex-col rounded-2xl p-6 sm:p-8">
                  <h3 className="m-0 text-lead font-bold tracking-tight text-ink">Clinic hours</h3>
                  <div className="mt-5 text-note text-ink-soft">
                    <ClinicHours>
                      <p className="m-0 mt-4 text-fine leading-relaxed text-ink-soft">
                        Holidays and other closed dates are marked on the booking calendar before you pick a
                        time.
                      </p>
                    </ClinicHours>
                  </div>
                </div>
              </Reveal>
            </div>
          </PageShell>
        </section>

        <CtaBand
          id="about-cta"
          title="Ready when you are"
          body="Book a time online and we will tell you when to arrive — or walk in during clinic hours."
        >
          <Button variant="brand" size="lg" onClick={() => go('login')} className="rounded-full px-8">
            <CalendarCheck />
            Book an appointment
          </Button>
          <Button variant="glass" size="lg" onClick={() => go('services')} className="rounded-full px-8">
            See services and prices
            <ArrowRight />
          </Button>
        </CtaBand>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default AboutUs;
