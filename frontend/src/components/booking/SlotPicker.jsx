import React, { useCallback, useEffect, useState } from 'react';
import { DateField } from '../ui/date-field';
import api from '../../config/api';
import { todayStr, formatTime12, toDateInput } from '../../lib/date';
import { CalendarX2, Clock, Info } from 'lucide-react';

/**
 * Pick a date, then a time the clinic actually has free.
 *
 * Extracted from the booking wizard when rescheduling needed the same control. Two copies of this
 * would have been two answers to "which slots are free" — and they would drift, because the copy
 * you are not looking at is the one that keeps the old rule. It owns its own availability fetch
 * for the same reason: a caller that forgot to refetch on a date change would silently offer
 * yesterday's slots.
 *
 * `currentTime` marks the slot the caller already holds. Rescheduling without it is disorienting:
 * the patient sees a grid of times with no indication of where they are now, and the slot they
 * currently occupy looks free — which it is, to them, and to nobody else.
 */
const SlotPicker = ({
  date,
  time,
  onDateChange,
  onTimeChange,
  currentDate = null,
  currentTime = null,
  disabled = false,
  minDate = todayStr(),
  label = 'Date',
  // Bump to force a refetch. The caller needs this after a 409 on submit: somebody took the slot
  // while the patient was filling the rest of the form, and the grid is now showing a free time
  // that is not free. Without it the patient re-submits the same slot and is refused again.
  refreshKey = 0,
}) => {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dayIsOpen, setDayIsOpen] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  // Closed dates, so the calendar can grey them BEFORE the patient picks one. Without this the
  // only way to learn the clinic is shut on the 30th is to choose the 30th — and then guess again.
  const [unavailable, setUnavailable] = useState({});

  const fetchAvailability = useCallback(async (forDate) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/appointments/availability', { params: { date: forDate } });
      const data = res.data.data;
      setSlots(data.slots || []);
      setDayIsOpen(data.isOpen !== false);
      setNote(data.note || '');
    } catch {
      // Distinguished from "no slots": an empty grid after a failed request reads as a fully
      // booked day, which is a different thing to tell a patient than "we could not check".
      setSlots([]);
      setDayIsOpen(true);
      setNote('');
      setError('Could not load available times. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!date) {
      setSlots([]);
      return;
    }
    fetchAvailability(date);
  }, [date, refreshKey, fetchAvailability]);

  // The clinic's published diary: which weekdays it opens, and which upcoming dates differ.
  // Fetched once — it changes when an administrator edits it, not while a patient fills a form.
  // A failure here is silent on purpose: it costs a marked calendar, and the availability call
  // still refuses a closed date. Blocking booking because a decoration would not load is worse.
  useEffect(() => {
    let cancelled = false;
    api.get('/schedule/public')
      .then((res) => {
        if (cancelled) return;
        const { week = [], upcoming = [] } = res.data.data || {};
        const map = {};

        // Weekdays the clinic never opens, marked across the window the patient can browse.
        const closedWeekdays = new Set(week.filter((d) => !d.isOpen).map((d) => d.dayOfWeek));
        if (closedWeekdays.size) {
          const cursor = new Date();
          for (let i = 0; i < 180; i += 1) {
            if (closedWeekdays.has(cursor.getDay())) {
              map[toDateInput(cursor)] = 'Closed';
            }
            cursor.setDate(cursor.getDate() + 1);
          }
        }

        // Then the per-date overrides, which WIN — including reopening a day the weekly pattern
        // calls closed. Applied second for exactly that reason: a clinic that opens specially on
        // a Sunday must not have the weekday rule grey it out.
        upcoming.forEach((o) => {
          if (o.isOpen) delete map[o.date];
          else map[o.date] = o.note || 'Closed';
        });

        setUnavailable(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // A slot chosen a moment ago can be taken by somebody else before submit. Clearing it here means
  // the form cannot carry a selection the server will refuse — the alternative is a 409 explaining
  // that a time the screen is still showing as chosen is gone.
  useEffect(() => {
    if (!time || slots.length === 0) return;
    const stillFree = slots.some((s) => s.time === time && s.available);
    const isTheOneWeAlreadyHold = date === currentDate && time === currentTime;
    if (!stillFree && !isTheOneWeAlreadyHold) onTimeChange('');
    // onTimeChange is intentionally excluded: callers pass an inline arrow, so including it would
    // re-run this on every render and fight the user's selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, time, date, currentDate, currentTime]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="slotpicker-label" className="field-label">{label}</label>
        <DateField id="slotpicker-label"
          value={date || ''}
          min={minDate}
          unavailable={unavailable}
          disabled={disabled}
          onChange={(e) => onDateChange(e.target.value)}
          required
        />
      </div>

      {date && (
        <div className="space-y-1.5">
          <label className="field-label">Available Time</label>

          {loading ? (
            <div className="flex items-center gap-2 py-2 text-fine font-semibold text-slate-400">
              <Clock className="h-3.5 w-3.5 animate-pulse" />
              Loading available times…
            </div>
          ) : error ? (
            <div role="alert" className="alert alert-error">{error}</div>
          ) : !dayIsOpen ? (
            <div className="alert alert-warning">
              <CalendarX2 />
              {/* The reason, when the clinic gave one. "Closed" alone reads as a fault in the
                  website; "Closed — Holy Week" reads as a clinic that is shut. */}
              <span>
                {note
                  ? `The clinic is closed on this date — ${note}. Please choose another.`
                  : 'The clinic is closed on this date. Please choose another.'}
              </span>
            </div>
          ) : slots.length === 0 ? (
            <div className="py-2 text-fine font-semibold text-slate-400">
              No time slots are configured for this date.
            </div>
          ) : slots.every((s) => !s.available) ? (
            // Open, but every slot is spoken for. Rendering the grid struck through end to end
            // leaves the patient hunting for a gap that is not there.
            <div className="alert alert-warning">
              <CalendarX2 />
              <span>
                {note
                  ? `Fully booked on this date — ${note}. Please choose another day.`
                  : 'Every time on this date is already booked. Please choose another day.'}
              </span>
            </div>
          ) : (
            <>
              {/* Open, but the clinic has said something about this date — shortened hours, one
                  radiographer. Shown above the grid, because it explains why the grid is small. */}
              {note && (
                <div className="alert alert-info">
                  <Info />
                  <span>{note}</span>
                </div>
              )}
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto p-0.5">
                {slots.map((slot) => {
                  const isHeldByUs = date === currentDate && slot.time === currentTime;
                  const selected = time === slot.time;
                  const selectable = slot.available || isHeldByUs;
                  return (
                    <button
                      key={slot.time}
              // The 24-hour value the API speaks, so a test can find this button without
              // depending on how the clinic happens to render a clock. CLAUDE.md's rule about
              // not coupling a test to presentation, applied to text instead of a class. [1.36.0]
              data-testid={`slot-${slot.time}`}
                      type="button"
                      disabled={disabled || !selectable}
                      onClick={() => onTimeChange(slot.time)}
                      aria-pressed={selected}
                      title={isHeldByUs ? 'Your current appointment time' : undefined}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : isHeldByUs
                            ? 'border-brand-300 bg-brand-50 text-brand-700'
                            : selectable
                              ? 'border-gray-200 bg-surface text-slate-700 hover:border-brand-500'
                              : 'cursor-not-allowed border-line bg-gray-100 text-gray-300 line-through'
                      }`}
                    >
                      {formatTime12(slot.time)}
                    </button>
                  );
                })}
              </div>
              {currentDate === date && currentTime && (
                <p className="m-0 text-micro text-slate-500">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-300 align-middle" />
                  Your current time. Struck-through slots are already taken.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SlotPicker;
