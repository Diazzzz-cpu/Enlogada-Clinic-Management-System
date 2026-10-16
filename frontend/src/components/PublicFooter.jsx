import React from 'react';
import Logo from './Logo';
import FacebookIcon from './public/FacebookIcon';
import { useAuth } from '../contexts/AuthContext';
import { useClinic, httpsUrl } from '../lib/clinic';
import { scrollToSection } from '../lib/scroll';
import { Phone, Mail, MapPin } from 'lucide-react';

/**
 * The public site's footer. [1.72.0]
 *
 * The reference site closes on a quiet, light footer. This one keeps what a clinic's footer is
 * actually for — where it is and how to reach it — on the page's own surface, instead of a third
 * dark slab beneath the dark call-to-action band.
 *
 * Every contact detail comes from useClinic(). The previous footer typed them in, so when the
 * address was corrected on the printed result form it went on showing the old, shorter one: the
 * page and the paper in the patient's hand disagreeing about where to go.
 *
 * Spacing is explicit (`mt-*`), not `space-y-*`. Tailwind v4's space-y spaces children by giving
 * each a bottom margin, and the `m-0` every paragraph and heading here carries cancels it — the
 * headings sat on their first link and the Facebook link on the sentence above it.
 */
const PublicFooter = ({ onNavigate }) => {
  const { user } = useAuth();
  const CLINIC = useClinic();
  const tel = CLINIC.phone.replace(/\s/g, '');
  const facebook = httpsUrl(CLINIC.facebook);
  const year = new Date().getFullYear();

  const go = (tab, options) => onNavigate?.(tab, options);

  // Scrolls if this page has the FAQ (Home); otherwise goes to Home and lets it scroll. Offered
  // signed-out only, for the same reason as the header: a signed-in patient's home is a dashboard.
  const goFaq = () => {
    if (!scrollToSection('faq')) go('home', { section: 'faq' });
  };

  const linkClass =
    'cursor-pointer border-0 bg-transparent p-0 text-left text-note text-ink-soft transition-colors hover:text-brand-700';

  return (
    <footer className="relative border-t border-line bg-surface">
      {/* The brand gradient as a hairline, so the footer's top edge carries the colouring too. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-gradient-brand" />

      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div>
          <div className="flex items-center gap-3">
            {/* A white chip in both themes: the mark always gets a light ground. */}
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-line">
              <Logo className="h-8 w-8" />
            </span>
            <div className="leading-tight">
              <p className="m-0 text-lead font-bold tracking-tight text-ink">ENLOGADA</p>
              <p className="m-0 text-micro font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Ultrasound &amp; Diagnostic Clinic
              </p>
            </div>
          </div>
          <p className="m-0 mt-4 max-w-sm text-note leading-relaxed text-ink-soft">
            Quality diagnostic care with professional service, transparency and compassionate expertise —
            in Bugo since 2011.
          </p>
          {facebook && (
            <a
              href={facebook}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 flex w-fit items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-4 text-note font-semibold text-ink-soft no-underline transition-colors hover:border-azure-200 hover:text-ink"
            >
              {/* Facebook's own blue, so the mark is recognised at a glance: 4.2:1 on white, and
                  above the 3:1 a non-text mark needs on the dark surface. */}
              <FacebookIcon className="h-7 w-7 text-[#1877F2]" />
              Follow us on Facebook
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>

        <nav aria-label="Footer">
          <h2 className="m-0 text-fine font-bold uppercase tracking-[0.12em] text-ink">Explore</h2>
          <ul className="m-0 mt-4 list-none space-y-2 p-0">
            <li>
              <button type="button" onClick={() => go('services')} className={linkClass}>
                Services &amp; prices
              </button>
            </li>
            <li>
              <button type="button" onClick={() => go('about')} className={linkClass}>
                About us
              </button>
            </li>
            {!user && (
              <li>
                <button type="button" onClick={goFaq} className={linkClass}>
                  FAQ
                </button>
              </li>
            )}
            <li>
              <button type="button" onClick={() => go('verify')} className={linkClass}>
                Verify a report
              </button>
            </li>
            <li>
              <button type="button" onClick={() => go('privacy')} className={linkClass}>
                Privacy Policy
              </button>
            </li>
            <li>
              <button type="button" onClick={() => go('terms')} className={linkClass}>
                Terms of Service
              </button>
            </li>
          </ul>
        </nav>

        <div>
          <h2 className="m-0 text-fine font-bold uppercase tracking-[0.12em] text-ink">Contact</h2>
          <ul className="m-0 mt-4 list-none space-y-2.5 p-0 text-note text-ink-soft">
            <li>
              <a href={`tel:${tel}`} className="flex items-center gap-2.5 text-ink-soft no-underline hover:text-brand-700">
                <Phone className="h-4 w-4 flex-shrink-0 text-brand-700" aria-hidden="true" />
                {CLINIC.phone}
              </a>
            </li>
            <li>
              <a
                href={`mailto:${CLINIC.email}`}
                className="flex items-center gap-2.5 text-ink-soft no-underline [overflow-wrap:anywhere] hover:text-brand-700"
              >
                <Mail className="h-4 w-4 flex-shrink-0 text-brand-700" aria-hidden="true" />
                {CLINIC.email}
              </a>
            </li>
            <li className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-700" aria-hidden="true" />
              {/* Wraps rather than truncates — a clipped address is a wrong address. */}
              <span className="leading-relaxed">{CLINIC.address}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-center text-fine text-ink-muted sm:flex-row sm:px-6 sm:text-left lg:px-8">
          <p className="m-0">
            © {year} {CLINIC.name}. All rights reserved.
          </p>
          <p className="m-0">Ultrasound · Laboratory · Digital X-Ray</p>
        </div>
      </div>
    </footer>
  );
};

export default PublicFooter;
