import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cn } from '../../lib/utils';
import PortalHeader from './PortalHeader';
import { PORTAL_TABS } from './portalTabs';

// Where the tabs move from the bottom bar up into the header. 1280, not 1024: a media query is
// measured in the browser's default pixels and ignores the reader's text size, and at 1024 with
// "Larger" text the tabs, the wordmark and the patient chip no longer fit in the pill together.
const WIDE = '(min-width: 1280px)';

function PortalTabList({ bar = false }) {
  return (
    <TabsList
      aria-label="Patient portal"
      className={cn(bar && 'grid w-full grid-cols-5 gap-0 rounded-none bg-transparent p-0')}
    >
      {PORTAL_TABS.map(({ value, label, icon: Icon }) => (
        <TabsTrigger
          key={value}
          value={value}
          className={cn(
            bar && 'min-w-0 flex-col gap-1 rounded-none border-t-2 border-transparent px-1 pb-2 pt-2.5 text-micro text-ink-muted data-[state=active]:border-brand-600 data-[state=active]:bg-transparent data-[state=active]:text-brand-700 data-[state=active]:shadow-none'
          )}
        >
          {bar && <Icon className="h-5 w-5" aria-hidden="true" />}
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/**
 * The patient portal's shell: the header, the page, and ONE list of tabs. [1.81.0]
 *
 * On a wide screen the tabs sit in the header; below that they are a bar fixed to the bottom of the
 * screen, where a thumb reaches them. Only one of the two is ever rendered, so each tab name is on
 * the page once and the Radix ids stay unique. The page keeps room at the bottom for the bar, so it
 * never covers the last thing on the page.
 *
 * `tab` is held by App, so a trip to My Account and back lands on the tab the patient left. The
 * account page passes `tab="account"`, which no tab carries: none is shown as current there, and
 * choosing one goes back to it.
 */
export default function PortalLayout({ tab, onTabChange, profiles, onNavigate, screen = 'dashboard', children }) {
  const wide = useMediaQuery(WIDE);

  return (
    <Tabs value={tab} onValueChange={onTabChange} className="flex min-h-screen flex-col bg-canvas">
      <PortalHeader profiles={profiles} onNavigate={onNavigate} tabs={wide ? <PortalTabList /> : null} />

      <main
        className={cn(
          'mx-auto box-border w-full max-w-6xl flex-1 px-4 pt-22 sm:px-6 lg:px-8',
          wide ? 'pb-12' : 'pb-28'
        )}
      >
        {/* Keyed on the screen, so it plays on navigation and not on the portal's own refreshes.
            Opacity only [1.128.0], like the staff shell: the old rise moved the page on every tab. */}
        <div key={screen} className="animate-screen-in">
          {children}
        </div>
      </main>

      {!wide && (
        <div
          data-testid="portal-tab-bar"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-float"
        >
          <PortalTabList bar />
        </div>
      )}
    </Tabs>
  );
}
