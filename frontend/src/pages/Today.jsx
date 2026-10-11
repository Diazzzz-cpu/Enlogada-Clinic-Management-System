import React, { useEffect, useState } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import PageHeader from '../components/ui/page-header';
import RefreshButton from '../components/ui/refresh-button';
import NeedsPanel from '../components/today/NeedsPanel';
import DeskToday from '../components/today/DeskToday';
import TillToday from '../components/today/TillToday';
import DepartmentToday from '../components/today/DepartmentToday';
import ClinicToday from '../components/today/ClinicToday';
import { useAuth } from '../contexts/AuthContext';
import { useTodayReads } from '../hooks/useTodayReads';
import { homeNavIds } from '../config/navigation';
import api from '../config/api';
import { daysAgoStr, todayStr } from '../lib/date';
import { categoryLabel } from '../lib/categories';
import {
  decisionNeed, departmentNeeds, deskNeeds, failedNeed, greeting, tillNeeds, waitingToPay,
} from '../lib/today';

/** The department worklists, and the History each one's sent-or-not lives on. */
const WORKLISTS = [
  { nav: 'lab-ops', history: 'lab-history', category: 'Laboratory' },
  { nav: 'ultrasound-ops', history: 'ultrasound-history', category: 'Ultrasound' },
  { nav: 'xray-ops', history: 'xray-history', category: 'Xray' },
];

/** What "Nothing needs you right now" offers instead: the person's own first screen. */
const WORK_LABEL = {
  'reception-queue': 'Open the Desk',
  'cashier-queue': 'Open the till',
  'lab-ops': 'Open my worklist',
  'ultrasound-ops': 'Open my worklist',
  'xray-ops': 'Open my worklist',
};

const body = (res) => res.data.data;

/**
 * Today — every member of staff's first screen. [1.77.0]
 *
 * Steven chose it on the decisions page: "Today" first in every sidebar, and the screen sign-in
 * lands on. It answers two questions, in this order: what needs me now, and how is today going.
 *
 * WHAT A PERSON SEES IS WHAT THEY ALREADY HOLD. Nothing here widens access. The sections follow the
 * person's own screens (homeNavIds): the front desk's for whoever the Desk belongs to, the till's
 * for the Billing Queue's, a department's for each worklist they work, and the clinic's for whoever
 * reads reports — which is how Admin's Dashboard became Admin's Today, so an Admin has one home, not
 * two. Every read is the endpoint that person's own screens already call, gated on the same
 * permission, so a figure they may not see is absent rather than a 403.
 *
 * ONE "NEEDS YOU NOW", however many sections. Each row is something waiting on this person, with the
 * one button that deals with it — and a button that opens another screen can say what to do on
 * arrival (an `intent`, see App.jsx): open this booking's check-in, this visit's tests, the reports
 * not yet sent. A fact appears once: a count that is a need is not also a figure.
 *
 * ONE REFRESH. A failed read says so where its figure or list would have been, and "Needs you now"
 * names what it could not check. No Try again beside each: they would all do what Refresh does.
 */
const Today = ({ onSelectNav }) => {
  const { user, hasPermission } = useAuth();
  const home = homeNavIds(user?.roles || [], user?.permissions || [], user?.departments ?? null);

  const desk = home.includes('reception-queue');
  const till = home.includes('cashier-queue');
  const worklists = WORKLISTS.filter((w) => home.includes(w.nav));
  const clinic = hasPermission('reports:view');

  // Each read on the permission its own endpoint demands. [1.53.0]
  const can = {
    visits: hasPermission('visits:read'),
    billing: hasPermission('billing:read'),
    bookings: hasPermission('appointments:read'),
    hmo: hasPermission('hmo:read'),
    decide: hasPermission('hmo:approve'),
    results: hasPermission('results:read'),
    send: hasPermission('results:release'),
    checkIn: hasPermission('appointments:read') && hasPermission('appointments:update'),
    takeMoney: hasPermission('billing:process'),
  };

  const today = todayStr();
  const yesterday = daysAgoStr(1);
  const range = { startDate: today, endDate: today };

  const fetchers = {
    // The whole list only where someone is named from it; the clinic view needs the counts alone,
    // and asks the same one-row page the sidebar's count does, so the two share a cached answer.
    queue: (desk || till || clinic) && can.visits && (() => api.get('/visits/active', {
      params: desk || till ? undefined : { page: 1, limit: 1 },
    }).then(body)),
    paid: (till || clinic) && can.billing && (() => api.get('/payments/transactions', { params: range }).then(body)),
    // One row: only its `summary` is wanted, and that is computed across the whole range.
    yesterday: (till || clinic) && can.billing && (() => api.get('/payments/transactions', {
      params: { startDate: yesterday, endDate: yesterday, page: 1, limit: 1 },
    }).then(body)),
    online: (till || clinic) && can.billing && (() => api.get('/payment-submissions/pending').then((r) => body(r).submissions || [])),
    bookings: desk && can.bookings && (() => api.get('/appointments', {
      params: { dateFrom: today, dateTo: today, limit: 100 },
    }).then((r) => body(r).appointments || [])),
    hmo: (desk || (clinic && can.decide)) && can.hmo && (() => api.get('/hmo/requests', {
      params: { status: 'Pending' },
    }).then((r) => body(r).requests || [])),
    hours: desk && (() => api.get('/schedule/public').then(body)),
    // One request for every section's figures: the server returns only the slices this account holds.
    ops: (desk || till || worklists.length > 0 || clinic) && (() => api.get('/reports/operations', { params: range }).then((r) => body(r).report)),
    analytics: (worklists.length > 0 || clinic) && (can.results || can.visits)
      && (() => api.get('/reports/analytics', { params: range }).then((r) => body(r).report)),
  };
  worklists.forEach(({ category }) => {
    fetchers[`pending:${category}`] = can.results
      && (() => api.get(`/results/pending/${category}`).then((r) => body(r).pending || []));
    fetchers[`unsent:${category}`] = can.results && can.send
      && (() => api.get(`/results/released/${category}`, { params: { delivery: 'unsent', days: 7 } }).then((r) => body(r).released || []));
  });

  const reads = useTodayReads(fetchers);

  // The waits in "Needs you now" are worked out from the clock, so the clock has to move.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(tick);
  }, []);

  const queue = reads.read('queue');
  const paid = reads.read('paid');
  const online = reads.read('online');
  const hmo = reads.read('hmo');
  const ops = reads.read('ops');
  const analytics = reads.read('analytics');
  const before = reads.read('yesterday');

  const needs = [];
  const couldNot = [];
  if (desk) {
    if (queue.failed) couldNot.push('the queue');
    needs.push(...deskNeeds(queue.data?.visits || [], now));
  }
  if (till) {
    if (queue.failed || paid.failed) couldNot.push('who is waiting to pay');
    if (online.failed) couldNot.push('online payments');
    const counted = queue.data && paid.data;
    needs.push(...tillNeeds({
      waiting: counted ? waitingToPay(queue.data.visits || [], paid.data.transactions || []) : [],
      online: online.data || [],
      canCheck: can.takeMoney,
      now,
    }));
  }
  worklists.forEach(({ nav, history, category }) => {
    const pending = reads.read(`pending:${category}`);
    const unsent = reads.read(`unsent:${category}`);
    if (pending.failed) couldNot.push(`the ${categoryLabel(category)} worklist`);
    if (unsent.failed) couldNot.push('reports not yet sent');
    needs.push(...departmentNeeds({
      category,
      pending: pending.data || [],
      unsent: unsent.data || [],
      nav,
      historyNav: history,
      canSend: can.send,
      labelled: worklists.length > 1,
      now,
    }));
  });
  if (clinic && can.decide) {
    if (hmo.failed) couldNot.push('HMO requests');
    needs.push(...decisionNeed(hmo.data || []));
  }
  // What could not be checked goes first: until it loads, the rest of the list is not the whole truth.
  const allNeeds = [...failedNeed(couldNot), ...needs];

  const onAction = (action) => {
    if (action.go) onSelectNav?.(action.go, action.intent || null);
  };

  const work = home.find((id) => WORK_LABEL[id]);
  const emptyAction = work ? { label: WORK_LABEL[work], onClick: () => onSelectNav?.(work) } : undefined;

  const refresh = () => reads.reload();

  const sections = [
    desk && { key: 'desk', label: 'Front desk' },
    till && { key: 'till', label: 'Billing' },
    ...worklists.map((w) => ({ key: w.category, label: categoryLabel(w.category), worklist: w })),
    clinic && { key: 'clinic', label: 'Clinic' },
  ].filter(Boolean);
  const several = sections.length > 1;

  const needsPanel = (
    <NeedsPanel needs={allNeeds} loading={!reads.ready} onAction={onAction} emptyAction={emptyAction} />
  );
  // The list sits in the first section's work column, where the eye starts.
  const slot = (key) => (sections[0]?.key === key ? needsPanel : null);
  const headingFor = (section) => (several ? section.label : undefined);

  return (
    <SidebarLayout title="Today" activeNav="today" onSelectNav={onSelectNav}>
      <div className="space-y-6">
        <PageHeader
          // No eyebrow. The rail's group heading already names the person's department, and a second
          // "FRONT DESK" on the same screen would be the same words twice.
          title={`${greeting(now)}, ${user?.firstName || 'there'}`}
          description="What needs you now, and how today is going."
          actions={<RefreshButton onRefresh={refresh} loading={reads.loading} updatedAt={reads.updatedAt} />}
        />

        {sections.length === 0 && needsPanel}

        {sections.map((section) => {
          if (section.key === 'desk') {
            return (
              <DeskToday
                key="desk"
                heading={headingFor(section)}
                needs={slot('desk')}
                queue={queue}
                ops={ops}
                bookings={reads.read('bookings')}
                hmo={hmo}
                hours={reads.read('hours')}
                canCheckIn={can.checkIn}
                onGo={onSelectNav}
                now={now}
              />
            );
          }
          if (section.key === 'till') {
            return (
              <TillToday
                key="till"
                heading={headingFor(section)}
                needs={slot('till')}
                paid={paid}
                yesterday={before}
                ops={ops}
              />
            );
          }
          if (section.key === 'clinic') {
            return (
              <ClinicToday
                key="clinic"
                heading={headingFor(section)}
                needs={slot('clinic')}
                queue={queue}
                paid={paid}
                yesterday={before}
                online={online}
                ops={ops}
                analytics={analytics}
                now={now}
              />
            );
          }
          return (
            <DepartmentToday
              key={section.key}
              heading={headingFor(section)}
              needs={slot(section.key)}
              category={section.worklist.category}
              ops={ops}
              analytics={analytics}
            />
          );
        })}
      </div>
    </SidebarLayout>
  );
};

export default Today;
