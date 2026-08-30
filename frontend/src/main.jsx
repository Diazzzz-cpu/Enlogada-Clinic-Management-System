import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import api from './config/api'
import { applyClinicIdentity } from './lib/clinic'
import { applyStoredScale } from './lib/textScale'

// The clinic's name, address and statutory identifiers, fetched once at start-up.
//
// Fire-and-forget on purpose: every one of these has a sensible built-in fallback, so a failure
// here must not delay or block the first render. The worst case is a receipt printing the
// compiled-in address instead of a configured one — and holding the whole app behind a request
// for the footer text would be the more damaging trade. See lib/clinic.js for why this is not
// build-time env any more.
api.get('/clinic')
  .then((res) => applyClinicIdentity(res.data?.data?.clinic))
  .catch(() => { /* defaults stand */ })

// The reader's chosen text size, applied to <html> BEFORE React mounts.
//
// Synchronous and local (localStorage, no request), unlike the clinic identity above, because the
// cost of deferring it is visible: the app would paint at the default size and jump one frame
// later, on every load, for exactly the people who chose a larger size because reading is hard.
applyStoredScale()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* ── Toasts ─────────────────────────────────────────────────────────────────────────────
        `expand` so a second toast does not stack UNDER the first as a folded edge. Two things
        can succeed in quick succession here — verifying a payment refreshes a queue, releasing a
        result notifies a department — and a message the reader cannot see is the same as no
        message.

        `closeButton` because the errors this app raises are not all glanceable. "Result released
        — email notification failed, patient was not notified" is a sentence somebody has to read
        and then act on; it must not vanish on a timer chosen for "Saved".

        `gap` and `offset` keep the stack clear of the notification bell, which sits in the same
        top-right corner on every staff console. Duration is per-type in lib/toast.js: an error
        is given more than twice the dwell of a success, because a success confirms something the
        reader just did and an error asks them to do something differently. */}
    <Toaster
      position="top-right"
      expand
      closeButton
      gap={10}
      offset={16}
      toastOptions={{
        classNames: {
          toast: 'rounded-xl border shadow-float font-sans',
          title: 'font-semibold text-sm',
          description: '!text-slate-500',
          closeButton: '!bg-surface !border-line !text-slate-500 hover:!text-slate-800',
          /* Through the surface token, not a pinned white. These fire in the corner of whatever
             screen the user is on, so a hardcoded white toast on a dark console is a small
             flash-bang every time something succeeds. [1.39.0] */
          success: '!bg-surface !border-brand-300 !text-ink [&_[data-icon]]:!text-brand-600',
          error: '!bg-surface !border-rose-200 !text-ink [&_[data-icon]]:!text-rose-500',
          warning: '!bg-surface !border-amber-300 !text-ink [&_[data-icon]]:!text-amber-600',
          info: '!bg-surface !border-azure-200 !text-ink [&_[data-icon]]:!text-azure-600',
        },
      }}
    />
    {/* Outermost backstop. The Toaster sits outside it deliberately, so error toasts still
        render if the app tree itself is the thing that failed. */}
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
