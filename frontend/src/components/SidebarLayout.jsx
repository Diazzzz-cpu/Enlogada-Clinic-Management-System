import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Logo from './Logo';
import ErrorBoundary from './ErrorBoundary';
import { usePolling } from '../hooks/usePolling';
import { Button } from './ui/button';
import api from '../config/api';
import { cn } from '../lib/utils';
import {
  Bell,
  LogOut,
  X,
  Menu,
  ChevronRight,
  CalendarDays,
  AlertTriangle,
  CheckCheck,
  BellOff,
  Eye,
} from 'lucide-react';
import { visibleMainNavItems, visibleOpsGroups, nativeRoleForNav, isBorrowedScreen } from '../config/navigation';
import { ThemeToggle } from './ui/theme-toggle';
import TextScaleControl from './ui/text-scale-control';

// The shared shell for every staff and admin console.
//
// ── What changed and why ─────────────────────────────────────────────────────────────────────
// The rail had three structural problems that no amount of restyling would fix:
//
//  1. It could not scroll. The aside was `justify-between` with a fixed account block at the
//     bottom, so a SuperAdmin — who legitimately sees ten management destinations plus twelve
//     departmental ones — had the account button pushed off the bottom of a 768px-tall laptop
//     screen, with no way to reach it. The nav column now scrolls on its own and the brand and
//     account blocks are pinned.
//  2. Every group was permanently expanded, so that same SuperAdmin scanned twenty-two items to
//     find one. Groups collapse now, remembered per user in localStorage, and the group holding
//     the current screen always opens regardless of what was remembered — a collapsed state must
//     never hide where you actually are.
//  3. The "Acting as" notice was a full-width banner inside the content area, which pushed the
//     work down the page on every borrowed screen. It is a fact about the current screen, not a
//     message about the content, so it belongs in the header beside the title.
//
// The active-item treatment also changed, from a solid green pill to a brand-tinted row with an
// indicator bar down its leading edge. A solid fill of the primary colour is the strongest visual
// device the interface has, and spending it on "you are here" left nothing louder for the
// buttons that actually do something.
const GROUP_STATE_KEY = 'enlogada.nav.collapsedGroups';

const readCollapsedGroups = () => {
  try {
    const raw = localStorage.getItem(GROUP_STATE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    // A corrupt or unavailable localStorage must not take the whole shell down with it.
    return [];
  }
};

const SidebarLayout = ({ title = 'Dashboard', activeNav = 'dashboard', onSelectNav, children }) => {
  const { user, logout } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(readCollapsedGroups);

  const userRoles = user?.roles || [];
  // Drives the permission half of nav visibility — see canSee in config/navigation.js. Refreshed
  // from the server by AuthContext, so a matrix change reaches the sidebar without a re-login.
  // Already the *effective* set: the role template plus this account's own grants, minus its
  // revokes, resolved server-side so the sidebar cannot disagree with the API.
  const userPermissions = user?.permissions || [];
  // The modality axis. `null` is unrestricted, `[]` is none — see departmentsForUser.
  const userDepartments = user?.departments ?? null;

  // UI/UX Modernization Phase 7: ops destinations are deliberately shared — Admin/SuperAdmin see
  // every department's screens, not just their own (§3a intentional superset, not a bug). The
  // dense combined sidebar this produces was flagged as a clarity gap in the redesign audit: an
  // Admin viewing e.g. the Receptionist's Active Queue had no on-screen signal they were on a
  // screen "borrowed" from another role rather than an Admin-exclusive tool. Resolved below, not
  // by shrinking the sidebar (Admin genuinely needs full operational access), but by naming the
  // context once a borrowed screen is open.
  //
  // The items themselves now come from config/navigation.js, which App.jsx also routes from —
  // one record per destination carrying both its role gating and the console it opens, so the
  // sidebar can no longer advertise a screen the router will not open.
  const mainNavItems = visibleMainNavItems(userRoles, userPermissions, userDepartments);

  // Module 18 UI/UX Phase 1: every operational role previously had exactly one nav destination
  // (some even shared a "Dashboard" item that silently routed to the same page). Split into real,
  // focused destinations per role, grouped by department so Admin/SuperAdmin — who see all of
  // these at once — get a scannable sidebar instead of twelve undifferentiated items.
  //
  // visibleOpsGroups applies all three gates (structure, permission, department). The old code
  // re-filtered the result by role alone, which was redundant and, had the two ever disagreed,
  // would have been the looser of the two checks winning.
  const opsNavGroups = visibleOpsGroups(userRoles, userPermissions, userDepartments);

  // Resolve the currently-open ops screen and whether this person is working one that is not
  // natively theirs.
  //
  // Previously this only fired for Admin/SuperAdmin, on the assumption that they were the only
  // ones who could ever be on a borrowed screen. Since [1.20.0] a permission can put anyone on
  // any staff screen, so the check is now simply "do you hold the role this screen belongs to" —
  // which matters more, not less: whatever you do here is recorded under your name, and the
  // person most likely to forget that is the one who does not normally sit here.
  const activeOpsItem = opsNavGroups
    .flatMap((group) => group.items.map((item) => ({ ...item, groupLabel: group.label })))
    .find((item) => item.id === activeNav);
  const activeOpsNativeRole = nativeRoleForNav(activeNav);
  const isActingOutsideOwnRole = Boolean(activeOpsItem) && isBorrowedScreen(activeNav, userRoles);

  const toggleGroup = (label) => {
    setCollapsedGroups((prev) => {
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label];
      try {
        localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(next));
      } catch {
        /* a full or disabled localStorage just means the preference does not survive a reload */
      }
      return next;
    });
  };

  // Module 18 (Notification): real, per-user notifications from the backend, replacing the
  // static 3-item mock list that previously rendered identically for every user regardless of
  // role or actual events.
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data.data.notifications || []);
      setUnreadCount(res.data.data.unreadCount || 0);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // The bell only ever refreshed when it was clicked, so the unread dot could not appear on its
  // own — staff had to guess there was something to look at. Slower than the queues because a
  // notification is an FYI, not something anyone is waiting on.
  usePolling(fetchNotifications, 60000);

  // Close the tray on Escape and on a click outside it. It previously stayed open until the bell
  // was clicked again, so it sat over the top-right of whatever screen you navigated to next.
  useEffect(() => {
    if (!showNotifications) return undefined;
    const onKey = (e) => e.key === 'Escape' && setShowNotifications(false);
    const onClick = (e) => {
      if (!e.target.closest('[data-notification-tray]')) setShowNotifications(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [showNotifications]);

  const handleToggleNotifications = () => {
    const opening = !showNotifications;
    setShowNotifications(opening);
    if (opening) fetchNotifications();
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      await api.patch(`/notifications/${notificationId}/read`);
      setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  const timeAgo = (isoString) => {
    const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // The clinic's local date, shown in the header.
  //
  // Not cosmetic. Every "today" screen in this app filters on the server's CURRENT_DATE, and the
  // gap between that and what someone assumes the date is has already produced two real bugs (see
  // the toISOString note in CLAUDE.md). Printing the date the console is actually working against
  // means an empty queue at 00:30 reads as "it is a new day" rather than "the queue is broken".
  // Built from local getters via toLocaleDateString, never from an ISO string.
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    []
  );

  const initials = `${user?.firstName?.charAt(0) || ''}${user?.lastName?.charAt(0) || ''}`.toUpperCase() || 'U';

  const NavButton = ({ item, isActive }) => {
    const Icon = item.icon;
    return (
      <button
        onClick={() => {
          onSelectNav?.(item.id);
          setMobileOpen(false);
        }}
        aria-current={isActive ? 'page' : undefined}
        // Addressed by id rather than by label, so a sweep across every role's sidebar does not
        // break when a screen is renamed.
        data-testid="nav-item"
        data-nav-id={item.id}
        className={cn(
          'group relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 py-2 pl-3 pr-2.5 text-left text-note font-medium transition-colors',
          isActive
            ? 'bg-brand-500/[0.16] font-semibold text-white'
            : 'bg-transparent text-rail-ink-muted hover:bg-white/[0.05] hover:text-rail-ink'
        )}
      >
        {isActive && (
          <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-brand-400" />
        )}
        <Icon
          className={cn(
            'h-[15px] w-[15px] flex-shrink-0 transition-colors',
            isActive ? 'text-brand-400' : 'text-rail-ink-faint group-hover:text-rail-ink-soft'
          )}
        />
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  const renderNavContent = () => (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Brand — flat on the rail rather than a white card floating inside it. A light panel in a
          dark sidebar is the heaviest element on the screen, which put the most emphasis on the
          one part of the interface nobody needs to look at twice. */}
      <div className="flex flex-shrink-0 items-center gap-2.5 px-3 pb-4 pt-1">
        <Logo className="h-8 w-8 flex-shrink-0" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-note font-bold tracking-tight text-white">Enlogada</span>
          <span className="truncate text-micro font-medium uppercase tracking-[0.12em] text-rail-ink-faint">
            Diagnostic Clinic
          </span>
        </div>
      </div>

      {/* The only scrolling region in the rail. */}
      <div className="scroll-dark min-h-0 flex-1 space-y-5 overflow-y-auto pb-2 pr-0.5">
        {mainNavItems.length > 0 && (
          <div>
            <span className="mb-1.5 block px-3 text-micro font-semibold uppercase tracking-[0.14em] text-rail-ink-dim">
              Management
            </span>
            <nav className="space-y-0.5">
              {mainNavItems.map((item) => (
                <NavButton key={item.id} item={item} isActive={activeNav === item.id} />
              ))}
            </nav>
          </div>
        )}

        {opsNavGroups.map((group) => {
          const holdsActive = group.items.some((item) => item.id === activeNav);
          // A remembered collapse never hides the screen you are on.
          const collapsed = collapsedGroups.includes(group.label) && !holdsActive;
          return (
            <div key={group.label}>
              <button
                onClick={() => toggleGroup(group.label)}
                aria-expanded={!collapsed}
                className="mb-1.5 flex w-full cursor-pointer items-center gap-1 border-0 bg-transparent px-3 text-micro font-semibold uppercase tracking-[0.14em] text-rail-ink-dim transition-colors hover:text-rail-ink-muted"
              >
                <ChevronRight
                  className={cn('h-3 w-3 transition-transform duration-150', !collapsed && 'rotate-90')}
                />
                <span>{group.label}</span>
                {collapsed && (
                  <span className="ml-auto rounded bg-white/5 px-1 text-micro tabular-nums text-rail-ink-faint">
                    {group.items.length}
                  </span>
                )}
              </button>
              {!collapsed && (
                <nav className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavButton key={item.id} item={item} isActive={activeNav === item.id} />
                  ))}
                </nav>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const accountButton = (
    <button
      onClick={() => {
        onSelectNav?.('account');
        setMobileOpen(false);
      }}
      aria-label="My Account"
      className={cn(
        'mt-3 flex w-full flex-shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors',
        activeNav === 'account'
          ? 'border-brand-500/40 bg-brand-500/[0.14]'
          : 'border-white/[0.07] bg-white/[0.04] hover:bg-white/[0.08]'
      )}
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500 text-micro font-bold text-white">
        {initials}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        {/* The person, then what they are here as. Both, in that order: the name is who is
            accountable for what happens under this session, and on a shared reception machine
            "am I still logged in as the right person" is the question this block answers. */}
        <span className="truncate text-fine font-semibold text-white">
          {user?.firstName} {user?.lastName}
        </span>
        <span className="truncate text-micro text-rail-ink-faint">{userRoles.join(' · ') || 'No role assigned'}</span>
      </span>
    </button>
  );

  return (
    // `h-screen overflow-hidden` on the shell, and the content pane is the only thing that
    // scrolls. It was `min-h-screen`, which lets the whole document scroll — so the rail scrolled
    // away with the page and a member of staff halfway down a long worklist had no navigation
    // until they scrolled back to the top. The rail is the one element that must never leave.
    <div className="flex h-screen overflow-hidden bg-canvas font-sans text-slate-800">
      {/* Desktop rail */}
      <aside className="z-20 hidden h-full w-[15.5rem] flex-shrink-0 flex-col border-r border-white/[0.06] bg-rail p-3 lg:flex">
        {renderNavContent()}
        {accountButton}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-scrim/60 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 flex w-full max-w-[17rem] flex-col bg-rail p-3 shadow-overlay">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute right-2.5 top-2.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-white/5 text-rail-ink-muted hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            {renderNavContent()}
            {accountButton}
          </div>
        </div>
      )}

      {/* Main content area. `min-h-0` is what lets <main> below actually scroll: without it a
          flex child refuses to shrink past its content, the column grows taller than the shell,
          and the overflow lands on the body instead — which is the rail scrolling away again. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 py-2.5 backdrop-blur-md lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-surface text-slate-600 hover:bg-slate-50 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            {/* A breadcrumb, not a second page title.

                Every console screen renders its own PageHeader — a 20px heading with a
                description and the screen's primary action. A bold 15px copy of the same words
                sitting 40px above that read as a mistake, which is exactly what it looked like
                once both were on screen together. So this bar states *where you are* and the
                page states *what this is*: the two say different things, and the breadcrumb is
                the half worth keeping sticky, because it is what you lose when you scroll.

                It also earns the space it takes: "Visit History" exists under Front Desk and,
                near enough, under Diagnostics too, and only the department tells them apart. */}
            {/* On a phone the two halves swap, rather than the group simply dropping out.
                Hiding the group below `sm` left the bar showing the page title alone — the exact
                words of the <h1> 40px underneath, which is the duplication the comment above
                exists to prevent, reintroduced at the width where vertical space is scarcest.
                And it dropped the half that carries the information: the group is what tells
                Front Desk's "Visit History" from Diagnostics'.

                So: phone shows the group, wider shows "Group / Screen". Screens with no group —
                the Admin management ones — fall back to the title, because a breadcrumb with
                nothing in it is worse than a repeated word. */}
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="m-0 flex list-none items-center gap-1.5 p-0">
                {activeOpsItem ? (
                  <>
                    <li className="min-w-0 truncate text-note font-semibold text-slate-800 sm:font-normal sm:text-slate-400">
                      {activeOpsItem.groupLabel}
                    </li>
                    <li aria-hidden="true" className="hidden text-slate-300 sm:block">/</li>
                    <li
                      className="hidden min-w-0 truncate text-note font-semibold text-slate-800 sm:block"
                      aria-current="page"
                    >
                      {title}
                    </li>
                  </>
                ) : (
                  <li className="min-w-0 truncate text-note font-semibold text-slate-800" aria-current="page">
                    {title}
                  </li>
                )}
              </ol>
            </nav>
            {isActingOutsideOwnRole && (
              <span
                title={`You hold Admin access, not ${activeOpsNativeRole}. Actions here are recorded under your name.`}
                className="hidden flex-shrink-0 items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-micro font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 md:inline-flex"
              >
                <Eye className="h-3 w-3" />
                Acting as {activeOpsNativeRole}
              </span>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {/* Two preferences, one slot, both 36px bordered icon buttons so they read as a
                pair. `hidden sm:inline-flex` on the theme control matches the text-size one's
                intent: this bar is tight on a phone, and the mobile drawer carries both. */}
            <ThemeToggle className="hidden sm:inline-flex" />

            {/* Text size sits in the chrome, not buried in account settings: a shared reception
                terminal is used by different people through the day and each needs it reachable
                in one press. */}
            <TextScaleControl className="hidden lg:inline-flex" />

            <span className="hidden items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-fine font-semibold text-slate-600 md:inline-flex">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
              {todayLabel}
            </span>

            <div className="relative" data-notification-tray>
              <button
                onClick={handleToggleNotifications}
                aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
                className={cn(
                  'relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border transition-colors',
                  showNotifications
                    ? 'border-slate-300 bg-slate-100 text-slate-900'
                    : 'border-slate-200 bg-surface text-slate-600 hover:bg-slate-50'
                )}
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  // A count, not a dot. "There is something" is barely more useful than nothing;
                  // "there are eleven" tells staff whether to open it now or after this patient.
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-nano font-bold tabular-nums text-white ring-2 ring-surface">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="animate-fade-in absolute right-0 mt-2 w-[21.25rem] overflow-hidden rounded-xl border border-line bg-surface shadow-float">
                  <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                    <span className="text-note font-bold text-slate-900">
                      Notifications
                      {unreadCount > 0 && (
                        <span className="ml-1.5 rounded bg-rose-50 px-1.5 py-0.5 text-micro font-bold text-rose-700">
                          {unreadCount} new
                        </span>
                      )}
                    </span>
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllAsRead}
                        className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-fine font-semibold text-brand-600 hover:text-brand-700"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-[380px] overflow-y-auto p-1.5">
                    {notifLoading ? (
                      <p className="py-8 text-center text-fine text-slate-400">Loading…</p>
                    ) : notifications.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-8 text-center">
                        <BellOff className="h-5 w-5 text-slate-300" />
                        <p className="m-0 text-fine text-slate-500">Nothing new. You're up to date.</p>
                      </div>
                    ) : (
                      notifications.map((n) => {
                        // Severity was ignored here entirely — every notification rendered the
                        // same, so a critical result awaiting a patient callback looked exactly
                        // like "New Appointment Booked". A panic value has to be findable in a
                        // list at a glance, and stay visibly urgent even after it is read.
                        const isCritical = n.type === 'critical';
                        return (
                          <button
                            key={n.id}
                            onClick={() => !n.is_read && handleMarkAsRead(n.id)}
                            className={cn(
                              'flex w-full cursor-pointer gap-2.5 rounded-lg border-0 px-2.5 py-2 text-left transition-colors',
                              isCritical
                                ? 'bg-rose-50/70 hover:bg-rose-50'
                                : n.is_read
                                  ? 'bg-transparent hover:bg-slate-50'
                                  : 'bg-brand-50/60 hover:bg-brand-50'
                            )}
                          >
                            {/* Icon as well as colour: this must survive a colour-vision
                                deficiency and a sunlit reception monitor. */}
                            <span className="mt-1 flex-shrink-0">
                              {isCritical ? (
                                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 text-rose-600" />
                              ) : (
                                <span
                                  className={cn(
                                    'block h-1.5 w-1.5 rounded-full',
                                    n.is_read ? 'bg-slate-300' : 'bg-brand-500'
                                  )}
                                />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-2">
                                <span
                                  className={cn(
                                    'truncate text-fine font-semibold',
                                    isCritical ? 'text-rose-800' : 'text-slate-900'
                                  )}
                                >
                                  {n.title}
                                </span>
                                <span className="flex-shrink-0 text-micro text-slate-400">{timeAgo(n.created_at)}</span>
                              </span>
                              <span
                                className={cn(
                                  'mt-0.5 block text-fine leading-snug',
                                  isCritical ? 'font-medium text-rose-700' : 'text-slate-500'
                                )}
                              >
                                {n.message}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <span aria-hidden="true" className="hidden h-6 w-px bg-slate-200 sm:block" />

            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Log out"
              title="Log out"
              className="text-slate-500 hover:bg-rose-50 hover:text-rose-600"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Dynamic screen view content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-7 lg:py-6">
          {/* The mobile counterpart of the header chip — there is no room for it up there below
              `md`, and it is the one piece of context a borrowed screen must not lose. */}
          {isActingOutsideOwnRole && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-fine font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 md:hidden">
              <Eye className="h-3.5 w-3.5 flex-shrink-0" />
              <span>
                Acting as {activeOpsNativeRole} — {activeOpsItem.groupLabel}
              </span>
            </div>
          )}
          {/* Scoped to the console body only. A crash in a dashboard leaves the sidebar and top
              bar mounted, so staff can navigate to another screen instead of reloading — which,
              with no router, would drop them back at the default tab. Keyed on the active screen
              so navigating away from a broken console clears the error rather than sticking. */}
          {/* The screen fades up as it arrives. Keyed on `activeNav`, which is what makes this
              safe: a CSS animation replays on mount, and this subtree mounts on navigation and
              only on navigation. Four of these consoles poll every few seconds — hanging the
              animation off a re-render instead would strobe the whole page at the poll interval.
              Anyone who has asked the OS for less motion gets the rule in index.css instead. */}
          <ErrorBoundary key={activeNav}>
            <div className="animate-fade-in">{children}</div>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
};

export default SidebarLayout;
