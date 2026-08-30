import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/ui/page-header';
import { Panel, PanelHeader, PanelBody } from '../../components/ui/panel';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import EmptyState from '../../components/ui/empty-state';
import LoadingState from '../../components/ui/loading-state';
import { DateField } from '../../components/ui/date-field';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { CalendarCog, CalendarX2, RefreshCw, Plus, Trash2, AlertTriangle } from 'lucide-react';
import api from '../../config/api';
import { toastSuccess, toastError } from '../../lib/toast';
import { todayStr, formatTime12 } from '../../lib/date';

/**
 * When the clinic is open, and how many patients an hour it can take. [1.57.0]
 *
 * `clinic_operating_hours` had existed since the first release and booking had always read it, but
 * nothing could WRITE it — no route, no screen. The clinic's hours, its slot length and its
 * per-slot capacity could be changed only by someone with a database client, which in practice
 * meant they were never changed at all.
 *
 * Two panels, because there are two genuinely different questions:
 *
 *   THE USUAL WEEK   what the clinic does most weeks. Editing Thursday changes every Thursday.
 *   SPECIFIC DATES   what it does on one day instead — a holiday, a day short-staffed.
 *
 * Keeping them apart is the whole point. The mistake this screen exists to prevent is closing next
 * Thursday by editing the Thursday row, and closing every Thursday from now on.
 */

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

const draftFrom = (day) => ({
  isOpen: day.is_open,
  openTime: hhmm(day.open_time) || '08:00',
  closeTime: hhmm(day.close_time) || '17:00',
  slotIntervalMinutes: day.slot_interval_minutes,
  maxConcurrentBookings: day.max_concurrent_bookings,
});

/** One weekday, edited in place. Saved per row, so a half-finished Friday cannot ruin Monday. */
function DayRow({ day, onSave, saving }) {
  const [draft, setDraft] = useState(() => draftFrom(day));

  // Follow the server after a save or a reload, so the row shows what was actually stored rather
  // than what was typed — they differ whenever the server normalises something.
  useEffect(() => { setDraft(draftFrom(day)); }, [day]);

  const dirty = draft.isOpen !== day.is_open
    || (draft.isOpen && (
      draft.openTime !== hhmm(day.open_time)
      || draft.closeTime !== hhmm(day.close_time)
      || Number(draft.slotIntervalMinutes) !== Number(day.slot_interval_minutes)
      || Number(draft.maxConcurrentBookings) !== Number(day.max_concurrent_bookings)
    ));

  // How many bookings this weekday holds, at the numbers currently on screen. The two fields that
  // decide it are far apart in meaning and easy to set to something nobody intended — 15-minute
  // slots at 4 per slot is 144 patients a day, and nothing else on the screen would say so.
  const dailyCapacity = useMemo(() => {
    if (!draft.isOpen) return 0;
    const [oh, om] = draft.openTime.split(':').map(Number);
    const [ch, cm] = draft.closeTime.split(':').map(Number);
    const minutes = (ch * 60 + cm) - (oh * 60 + om);
    const interval = Number(draft.slotIntervalMinutes) || 0;
    if (!Number.isFinite(minutes) || minutes <= 0 || interval <= 0) return 0;
    return Math.ceil(minutes / interval) * Number(draft.maxConcurrentBookings || 0);
  }, [draft]);

  return (
    <TableRow data-testid={`schedule-day-${day.day_of_week}`}>
      <TableCell className="font-bold text-slate-900">{day.day_name}</TableCell>
      <TableCell>
        <label className="flex cursor-pointer items-center gap-2 text-fine font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={draft.isOpen}
            onChange={(e) => setDraft((d) => ({ ...d, isOpen: e.target.checked }))}
            className="h-4 w-4 cursor-pointer accent-brand-500"
            aria-label={day.day_name + ' open'}
          />
          {draft.isOpen ? 'Open' : 'Closed'}
        </label>
      </TableCell>
      <TableCell>
        {draft.isOpen ? (
          <div className="flex items-center gap-1.5">
            <Input
              type="time" value={draft.openTime} aria-label={day.day_name + ' opening time'}
              onChange={(e) => setDraft((d) => ({ ...d, openTime: e.target.value }))}
              className="w-28"
            />
            <span className="text-fine text-slate-400">to</span>
            <Input
              type="time" value={draft.closeTime} aria-label={day.day_name + ' closing time'}
              onChange={(e) => setDraft((d) => ({ ...d, closeTime: e.target.value }))}
              className="w-28"
            />
          </div>
        ) : (
          <span className="text-fine text-slate-400">&mdash;</span>
        )}
      </TableCell>
      <TableCell>
        {draft.isOpen ? (
          <Input
            type="number" min={5} max={240} step={5} value={draft.slotIntervalMinutes}
            aria-label={day.day_name + ' slot length in minutes'}
            onChange={(e) => setDraft((d) => ({ ...d, slotIntervalMinutes: e.target.value }))}
            className="w-20"
          />
        ) : <span className="text-fine text-slate-400">&mdash;</span>}
      </TableCell>
      <TableCell>
        {draft.isOpen ? (
          <Input
            type="number" min={0} max={50} value={draft.maxConcurrentBookings}
            aria-label={day.day_name + ' bookings per slot'}
            onChange={(e) => setDraft((d) => ({ ...d, maxConcurrentBookings: e.target.value }))}
            className="w-20"
          />
        ) : <span className="text-fine text-slate-400">&mdash;</span>}
      </TableCell>
      <TableCell className="text-fine tabular-nums text-slate-500">
        {draft.isOpen ? dailyCapacity + ' bookings/day' : '—'}
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant={dirty ? 'default' : 'outline'}
          disabled={!dirty}
          loading={saving}
          onClick={() => onSave(day.day_of_week, draft)}
        >
          Save
        </Button>
      </TableCell>
    </TableRow>
  );
}

const BLANK_OVERRIDE = {
  date: '', isOpen: false, openTime: '', closeTime: '',
  slotIntervalMinutes: '', maxConcurrentBookings: '', note: '',
};

export default function ClinicSchedule() {
  const [week, setWeek] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingDay, setSavingDay] = useState(null);
  const [form, setForm] = useState(BLANK_OVERRIDE);
  const [submitting, setSubmitting] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [w, o] = await Promise.all([
        api.get('/schedule/week'),
        api.get('/schedule/overrides'),
      ]);
      setWeek(w.data.data.week);
      setOverrides(o.data.data.overrides);
    } catch (err) {
      // A failed load must not read as "the clinic has no schedule" — that is a screen telling an
      // administrator something false about their own opening hours.
      setError(err.response?.data?.message || 'Could not load the schedule.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveDay = async (dayOfWeek, draft) => {
    setSavingDay(dayOfWeek);
    try {
      const res = await api.put('/schedule/week/' + dayOfWeek, draft);
      toastSuccess(res.data.message);
      await load();
    } catch (err) {
      toastError(err.response?.data?.message || 'Could not save that day.');
    } finally {
      setSavingDay(null);
    }
  };

  const submitOverride = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.put('/schedule/overrides', {
        date: form.date,
        isOpen: form.isOpen,
        // Blank means "keep the weekday's answer", so the field is omitted rather than sent empty.
        // Sending '' would be a request to clear it, which is a different instruction.
        ...(form.isOpen && form.openTime && form.closeTime
          ? { openTime: form.openTime, closeTime: form.closeTime } : {}),
        ...(form.isOpen && form.maxConcurrentBookings !== ''
          ? { maxConcurrentBookings: form.maxConcurrentBookings } : {}),
        note: form.note,
      });
      const affected = res.data.data.affectedBookings;
      // Bookings already on that date are why this cannot be a silent success. It goes in the
      // toast as well as the table, because the person doing it is about to navigate away.
      if (affected) toastError(res.data.message, 'Those patients still hold their slot.');
      else toastSuccess(res.data.message);
      setForm(BLANK_OVERRIDE);
      await load();
    } catch (err) {
      toastError(err.response?.data?.message || 'Could not save that date.');
    } finally {
      setSubmitting(false);
    }
  };

  const removeOverride = async () => {
    const date = pendingRemoval;
    setPendingRemoval(null);
    try {
      const res = await api.delete('/schedule/overrides/' + date);
      toastSuccess(date + ' — ' + res.data.message);
      await load();
    } catch (err) {
      toastError(err.response?.data?.message || 'Could not remove that date.');
    }
  };

  const openDays = week.filter((d) => d.is_open).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Clinic Schedule"
        description="When the clinic opens, how long a slot is, and how many patients it can take at once. Patients see this on the booking calendar."
        actions={
          <Button variant="outline" size="sm" onClick={load} loading={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {error && (
        <EmptyState
          tone="error"
          title="Could not load the schedule"
          description={error}
          action={<Button variant="outline" size="sm" onClick={load}>Try again</Button>}
        />
      )}

      {loading && week.length === 0 ? (
        <LoadingState label="Loading the schedule…" />
      ) : error ? null : (
        <>
          <Panel className="overflow-hidden">
            <PanelHeader
              title="The usual week"
              description={openDays + ' of 7 days open. Changing a row here changes that weekday from now on.'}
              icon={CalendarCog}
            />
            <PanelBody flush>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Slot (min)</TableHead>
                      <TableHead>Per slot</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead className="text-right">&nbsp;</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {week.map((day) => (
                      <DayRow
                        key={day.day_of_week}
                        day={day}
                        saving={savingDay === day.day_of_week}
                        onSave={saveDay}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </PanelBody>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Specific dates"
              description="A holiday, or a day the clinic runs short. Overrides only the date named — the weekly pattern is untouched."
              icon={CalendarX2}
            />
            <PanelBody>
              <form onSubmit={submitOverride} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <label htmlFor="override-date" className="field-label">Date</label>
                  <DateField
                    id="override-date"
                    value={form.date}
                    min={todayStr()}
                    required
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <span className="field-label">On this date</span>
                  <div className="flex h-10 items-center gap-4">
                    {[
                      { value: false, label: 'Closed' },
                      { value: true, label: 'Open, but different' },
                    ].map((opt) => (
                      <label
                        key={String(opt.value)}
                        className="flex cursor-pointer items-center gap-1.5 text-fine font-semibold text-slate-600"
                      >
                        <input
                          type="radio"
                          name="override-open"
                          checked={form.isOpen === opt.value}
                          onChange={() => setForm((f) => ({ ...f, isOpen: opt.value }))}
                          className="h-3.5 w-3.5 cursor-pointer accent-brand-500"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                {form.isOpen && (
                  <>
                    <div className="space-y-1">
                      <label htmlFor="override-hours" className="field-label">Hours (optional)</label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          id="override-hours" type="time" value={form.openTime}
                          onChange={(e) => setForm((f) => ({ ...f, openTime: e.target.value }))}
                        />
                        <span className="text-fine text-slate-400">to</span>
                        <Input
                          type="time" value={form.closeTime} aria-label="Closing time on this date"
                          onChange={(e) => setForm((f) => ({ ...f, closeTime: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="override-cap" className="field-label">Bookings per slot (optional)</label>
                      <Input
                        id="override-cap" type="number" min={0} max={50}
                        placeholder="Same as usual"
                        value={form.maxConcurrentBookings}
                        onChange={(e) => setForm((f) => ({ ...f, maxConcurrentBookings: e.target.value }))}
                      />
                    </div>
                  </>
                )}

                <div className={form.isOpen ? 'space-y-1 lg:col-span-3' : 'space-y-1'}>
                  <label htmlFor="override-note" className="field-label">
                    {form.isOpen ? 'Reason (optional)' : 'Reason — the patient reads this'}
                  </label>
                  <Input
                    id="override-note" maxLength={200}
                    placeholder={form.isOpen ? 'e.g. One sonographer only' : 'e.g. Holy Week'}
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  />
                </div>

                <div className="flex items-end">
                  <Button type="submit" loading={submitting} disabled={!form.date} className="w-full sm:w-auto">
                    <Plus className="h-3.5 w-3.5" />
                    Save date
                  </Button>
                </div>
              </form>

              {!form.isOpen && (
                <p className="mt-2 mb-0 flex items-start gap-1.5 text-micro leading-relaxed text-slate-500">
                  <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />
                  A closed date with no reason shows the patient a bare &ldquo;closed&rdquo;, which
                  reads as a fault in the website. Naming it reads as a clinic that is shut.
                </p>
              )}
            </PanelBody>

            <PanelBody flush>
              {overrides.length === 0 ? (
                <EmptyState
                  compact
                  title="No dates set aside"
                  description="Every date follows the weekly pattern above."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Hours</TableHead>
                        <TableHead>Per slot</TableHead>
                        <TableHead>Reason shown to patients</TableHead>
                        <TableHead>Set by</TableHead>
                        <TableHead className="text-right">&nbsp;</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overrides.map((o) => (
                        <TableRow key={o.id} data-testid={'schedule-override-' + o.override_date}>
                          <TableCell className="font-bold tabular-nums text-slate-900">
                            {o.override_date}
                          </TableCell>
                          <TableCell>
                            <Badge variant={o.is_open ? 'default' : 'destructive'}>
                              {o.is_open ? 'Open' : 'Closed'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-fine text-slate-600">
                            {o.open_time
                              ? formatTime12(hhmm(o.open_time)) + ' – ' + formatTime12(hhmm(o.close_time))
                              : <span className="text-slate-400">As usual</span>}
                          </TableCell>
                          <TableCell className="text-fine tabular-nums text-slate-600">
                            {o.max_concurrent_bookings === null
                              ? <span className="text-slate-400">As usual</span>
                              : o.max_concurrent_bookings}
                          </TableCell>
                          <TableCell className="text-fine text-slate-600">
                            {o.note || <span className="text-slate-400">&mdash;</span>}
                          </TableCell>
                          <TableCell className="text-fine text-slate-500">
                            {o.created_by_first_name
                              ? (o.created_by_first_name + ' ' + (o.created_by_last_name || '')).trim()
                              : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => setPendingRemoval(o.override_date)}
                              aria-label={'Remove the override for ' + o.override_date}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </PanelBody>
          </Panel>
        </>
      )}

      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}
        title="Follow the normal schedule again?"
        description={(pendingRemoval || 'This date') + ' will go back to whatever its weekday says, and become bookable again if that weekday is open.'}
        confirmLabel="Remove"
        onConfirm={removeOverride}
      />
    </div>
  );
}
